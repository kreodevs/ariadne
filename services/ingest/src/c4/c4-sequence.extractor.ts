/**
 * @fileoverview Flujo API desde Falkor → ApiFlowSpec (ruta elegible + nombres reales del monorepo).
 */
import { Injectable, Logger } from '@nestjs/common';
import { FalkorDB } from 'falkordb';
import {
  apiFlowToArchifySequence,
  buildApiFlowSteps,
  formatHttpCallLabel,
  inferMonorepoSegmentLabel,
  type ApiFlowSpec,
  type ArchifySequenceIr,
  type C4SequenceRouteOption,
} from 'ariadne-common';
import { getFalkorConfig, graphNameForProject, isProjectShardingEnabled } from '../pipeline/falkor';
import { ProjectsService } from '../projects/projects.service';

export interface C4SequenceExtractResult {
  spec: ApiFlowSpec;
  archifyIr: ArchifySequenceIr;
  routePath: string;
}

interface SequenceFlowRow {
  routePath?: string;
  screenName?: string;
  screenFilePath?: string;
  apiPath?: string;
  backendPath?: string;
  method?: string;
  handlerName?: string;
  controllerName?: string;
  controllerFilePath?: string;
  routeId?: string;
  isPublicEntry?: boolean;
  hasApiLink?: boolean;
  kind?: 'route' | 'api-client';
  httpStatusCode?: number;
  serviceMethod?: string;
  modelName?: string;
  modelTable?: string;
}

/** Enriquecimiento handler → servicio → Model + status HTTP desde Nest/OpenAPI. */
const SEQUENCE_BACKEND_ENRICHMENT_CYPHER = `
OPTIONAL MATCH (cf)-[:CONTAINS]->(handlerFn:Function {name: nr.handlerName, projectId: $projectId})
OPTIONAL MATCH (handlerFn)-[:CALLS*1..3]->(calleeFn:Function)
OPTIONAL MATCH (svcFile:File {projectId: $projectId})-[:CONTAINS]->(calleeFn)
OPTIONAL MATCH (svcFile)-[:CONTAINS]->(m:Model)
WITH *,
     coalesce(nr.httpStatusCode, op.successStatusCode) AS httpStatusCode,
     collect(DISTINCT calleeFn.name)[0] AS serviceMethod,
     collect(DISTINCT m.name)[0] AS modelName,
     collect(DISTINCT m.tableName)[0] AS modelTable
`;

@Injectable()
export class C4SequenceExtractor {
  private readonly logger = new Logger(C4SequenceExtractor.name);

  constructor(private readonly projects: ProjectsService) {}

  async listRoutes(projectId: string): Promise<C4SequenceRouteOption[]> {
    const routeRows = await this.fetchRouteRows(projectId);
    const apiRows = await this.fetchApiClientRouteRows(projectId);
    const merged = this.mergeRouteRows(routeRows, apiRows);
    return merged.map((row) => this.rowToRouteOption(row));
  }

  /** Fila de flujo para una ruta (workflow / secuencia). */
  async resolveRouteFlowRow(projectId: string, routePath?: string): Promise<SequenceFlowRow | null> {
    const routeRows = await this.fetchRouteRows(projectId);
    const apiRows = await this.fetchApiClientRouteRows(projectId);
    const rows = this.mergeRouteRows(routeRows, apiRows);
    if (routePath) {
      return rows.find((r) => r.routePath === routePath) ?? null;
    }
    return this.pickDefaultRoute(rows) ?? apiRows[0] ?? (await this.fetchApiClientFallback(projectId));
  }

  async buildRepresentativeFlow(
    projectId: string,
    routePath?: string,
  ): Promise<C4SequenceExtractResult> {
    const routeRows = await this.fetchRouteRows(projectId);
    const apiRows = await this.fetchApiClientRouteRows(projectId);
    const rows = this.mergeRouteRows(routeRows, apiRows);
    const row =
      (routePath ? rows.find((r) => r.routePath === routePath) : undefined) ??
      this.pickDefaultRoute(rows) ??
      apiRows[0] ??
      (await this.fetchApiClientFallback(projectId));
    const spec = this.rowToSpec(projectId, row);
    const resolvedRoute = String(row?.routePath ?? routePath ?? '/');
    return {
      spec,
      archifyIr: apiFlowToArchifySequence(spec),
      routePath: resolvedRoute,
    };
  }

  private pickDefaultRoute(rows: SequenceFlowRow[]): SequenceFlowRow | undefined {
    const withApi = rows.filter((r) => r.hasApiLink);
    const publicWithApi = withApi.find((r) => r.isPublicEntry);
    if (publicWithApi) return publicWithApi;
    if (withApi[0]) return withApi[0];
    const publicRoute = rows.find((r) => r.isPublicEntry);
    if (publicRoute) return publicRoute;
    return rows[0];
  }

  private rowToRouteOption(row: SequenceFlowRow): C4SequenceRouteOption {
    const method = String(row.method ?? 'GET');
    const apiPath = row.apiPath ?? row.backendPath;
    return {
      routePath: String(row.routePath ?? '/'),
      screenName: row.screenName ? String(row.screenName) : null,
      apiSummary: apiPath ? formatHttpCallLabel(method, String(apiPath)) : null,
      isPublicEntry: Boolean(row.isPublicEntry),
      hasApiLink: Boolean(row.hasApiLink),
      kind: row.kind ?? 'route',
      screenFilePath: row.screenFilePath ?? null,
    };
  }

  private mergeRouteRows(
    routeRows: SequenceFlowRow[],
    apiRows: SequenceFlowRow[],
  ): SequenceFlowRow[] {
    const out = [...routeRows];
    const seen = new Set(routeRows.map((r) => String(r.routePath ?? '')));
    for (const row of apiRows) {
      const key = String(row.routePath ?? '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    out.sort((a, b) => {
      const rank = (r: SequenceFlowRow) =>
        (r.kind === 'api-client' ? 2 : 0) +
        (r.isPublicEntry ? 0 : 1) * 4 +
        (r.hasApiLink ? 0 : 2);
      const diff = rank(a) - rank(b);
      return diff !== 0 ? diff : String(a.routePath).localeCompare(String(b.routePath));
    });
    return out.slice(0, 80);
  }

  private rowToSpec(projectId: string, row: SequenceFlowRow | null): ApiFlowSpec {
    const route = String(row?.routePath ?? '/');
    const screen = String(row?.screenName ?? 'Screen');
    const screenFile = row?.screenFilePath ? String(row.screenFilePath) : undefined;
    const method = String(row?.method ?? 'GET');
    const apiPath = row?.apiPath ? String(row.apiPath) : undefined;
    const backendPath = row?.backendPath ? String(row.backendPath) : apiPath;
    const handlerName = row?.handlerName ? String(row.handlerName) : undefined;
    const controllerName = row?.controllerName ? String(row.controllerName) : undefined;
    const controllerFile = row?.controllerFilePath ? String(row.controllerFilePath) : undefined;

    const webLabel =
      inferMonorepoSegmentLabel(screenFile, 'app') ??
      (screen !== 'Screen' ? screen : 'Web UI');
    const apiLabel =
      controllerName ??
      inferMonorepoSegmentLabel(controllerFile, 'service') ??
      'API Gateway';
    const backendLabel = handlerName ?? controllerName ?? inferMonorepoSegmentLabel(controllerFile, 'service') ?? 'Backend';
    const backendService = inferMonorepoSegmentLabel(controllerFile, 'service');
    const dbLabel =
      backendService?.toLowerCase().includes('ingest') ||
      backendService?.toLowerCase().includes('falkor')
        ? 'FalkorDB'
        : 'PostgreSQL';

    const title = `API flow — ${route}`;
    const steps = buildApiFlowSteps({
      routePath: route,
      screenName: screen,
      method,
      apiPath,
      backendPath,
      handlerName,
      modelName: row?.modelName,
      modelTable: row?.modelTable,
      serviceMethod: row?.serviceMethod,
      httpStatusCode: row?.httpStatusCode,
    });
    const dbSublabel = row?.modelName ?? row?.modelTable ?? 'persistencia';
    const hasEnrichedBackend = Boolean(
      row?.modelName || row?.modelTable || row?.serviceMethod || row?.httpStatusCode,
    );

    return {
      title,
      routePath: route,
      screenName: screen,
      apiPath,
      backendPath,
      method,
      participants: [
        { id: 'user', label: 'Usuario', type: 'external', sublabel: 'browser' },
        { id: 'web', label: webLabel, type: 'frontend', sublabel: screen },
        { id: 'api', label: apiLabel, type: 'backend', sublabel: 'HTTP' },
        { id: 'backend', label: backendLabel, type: 'backend', sublabel: handlerName ?? 'handler' },
        { id: 'db', label: dbLabel, type: 'database', sublabel: dbSublabel },
      ],
      steps,
      evidence: [
        {
          source: 'falkor',
          nodeId: String(row?.routeId ?? row?.routePath ?? projectId),
          filePath: screenFile,
          reason: row?.hasApiLink
            ? hasEnrichedBackend
              ? 'Route + NestRoute + Model/HTTP status en grafo'
              : 'Route + REFERENCES_API / NestRoute indexados'
            : row
              ? 'Route indexada (sin enlace API completo en el grafo)'
              : 'Flujo sintético (sin ruta indexada)',
        },
      ],
    };
  }

  private async fetchRouteRows(projectId: string): Promise<SequenceFlowRow[]> {
    const config = getFalkorConfig();
    const client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
    try {
      const contexts = await this.projects.getCypherShardContexts(projectId, {
        includeSiblingProjects: false,
      });
      const shards =
        contexts.length > 0
          ? contexts
          : [
              {
                graphName: graphNameForProject(isProjectShardingEnabled() ? projectId : undefined),
                cypherProjectId: projectId,
              },
            ];

      const rows: SequenceFlowRow[] = [];
      const seenPaths = new Set<string>();

      for (const shard of shards) {
        const graph = client.selectGraph(shard.graphName);
        const pid = shard.cypherProjectId;

        const q = `
          MATCH (rt:Route {projectId: $projectId})
          WHERE rt.path IS NOT NULL
          OPTIONAL MATCH (rt)-[:ROUTE_TO_COMPONENT]->(comp:Component)
          OPTIONAL MATCH (sf:File)-[:CONTAINS]->(comp)
          OPTIONAL MATCH (rt)-[:ENTRY_REACHES_API]->(acr:ApiClientReference)
          OPTIONAL MATCH (sf)-[:REFERENCES_API]->(acr2:ApiClientReference)
          WITH rt, comp, sf, coalesce(acr, acr2) AS acr
          OPTIONAL MATCH (acr)-[:CALLS_NEST_ROUTE]->(nr:NestRoute)
          OPTIONAL MATCH (acr)-[:CALLS_API]->(op:OpenApiOperation)-[:SAME_REST_AS]->(nr2:NestRoute)
          WITH rt, comp, sf, acr, op, coalesce(nr, nr2) AS nr
          OPTIONAL MATCH (nc:NestController)-[:DECLARES_ROUTE]->(nr)
          OPTIONAL MATCH (cf:File)-[:CONTAINS]->(nc)
          ${SEQUENCE_BACKEND_ENRICHMENT_CYPHER}
          RETURN rt.path AS routePath,
                 coalesce(comp.name, rt.componentName) AS screenName,
                 sf.path AS screenFilePath,
                 coalesce(acr.normalizedPath, acr.apiPath) AS apiPath,
                 coalesce(nr.fullPath, nr.path) AS backendPath,
                 coalesce(nr.httpMethod, op.method, 'GET') AS method,
                 nr.handlerName AS handlerName,
                 coalesce(nc.name, nr.controllerName) AS controllerName,
                 cf.path AS controllerFilePath,
                 rt.path AS routeId,
                 coalesce(rt.isPublicEntry, 'false') AS isPublicEntry,
                 (acr IS NOT NULL) AS hasApiLink,
                 'route' AS kind,
                 httpStatusCode,
                 serviceMethod,
                 modelName,
                 modelTable
          ORDER BY
            CASE WHEN coalesce(rt.isPublicEntry, 'false') = 'true' THEN 0 ELSE 1 END,
            CASE WHEN acr IS NOT NULL AND nr IS NOT NULL THEN 0 ELSE 1 END,
            rt.path
          LIMIT 80
        `;
        const res = (await graph.query(q, { params: { projectId: pid } })) as {
          data?: Array<Record<string, unknown>>;
        };
        for (const row of res.data ?? []) {
          const normalized = this.normalizeFlowRow(row);
          const path = normalized.routePath;
          if (!path || seenPaths.has(path)) continue;
          seenPaths.add(path);
          rows.push(normalized);
        }
      }

      rows.sort((a, b) => {
        const rank = (r: SequenceFlowRow) =>
          (r.isPublicEntry ? 0 : 1) * 4 + (r.hasApiLink ? 0 : 2);
        const diff = rank(a) - rank(b);
        return diff !== 0 ? diff : String(a.routePath).localeCompare(String(b.routePath));
      });

      return rows.slice(0, 80);
    } catch (err) {
      this.logger.warn(
        `C4 sequence list routes: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    } finally {
      await client.close();
    }
  }

  private async fetchApiClientRouteRows(projectId: string): Promise<SequenceFlowRow[]> {
    const config = getFalkorConfig();
    const client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
    try {
      const contexts = await this.projects.getCypherShardContexts(projectId, {
        includeSiblingProjects: false,
      });
      const shards =
        contexts.length > 0
          ? contexts
          : [
              {
                graphName: graphNameForProject(isProjectShardingEnabled() ? projectId : undefined),
                cypherProjectId: projectId,
              },
            ];

      const q = `
        MATCH (f:File)-[:REFERENCES_API]->(acr:ApiClientReference)
        WHERE f.projectId = $projectId
        OPTIONAL MATCH (acr)-[:CALLS_NEST_ROUTE]->(nr:NestRoute)
        OPTIONAL MATCH (acr)-[:CALLS_API]->(op:OpenApiOperation)-[:SAME_REST_AS]->(nr2:NestRoute)
        WITH f, acr, coalesce(nr, nr2) AS nr, op
        OPTIONAL MATCH (nc:NestController)-[:DECLARES_ROUTE]->(nr)
        OPTIONAL MATCH (cf:File)-[:CONTAINS]->(nc)
        ${SEQUENCE_BACKEND_ENRICHMENT_CYPHER}
        RETURN f.path AS screenFilePath,
               'API client' AS screenName,
               coalesce(acr.normalizedPath, acr.apiPath) AS apiPath,
               coalesce(nr.fullPath, nr.path) AS backendPath,
               coalesce(nr.httpMethod, op.method, 'GET') AS method,
               nr.handlerName AS handlerName,
               coalesce(nc.name, nr.controllerName) AS controllerName,
               cf.path AS controllerFilePath,
               f.path AS routePath,
               (nr IS NOT NULL OR acr.apiPath IS NOT NULL) AS hasApiLink,
               'api-client' AS kind,
               httpStatusCode,
               serviceMethod,
               modelName,
               modelTable
        ORDER BY f.path, apiPath
        LIMIT 80
      `;

      const rows: SequenceFlowRow[] = [];
      const seen = new Set<string>();
      for (const shard of shards) {
        const graph = client.selectGraph(shard.graphName);
        const pid = shard.cypherProjectId;
        const res = (await graph.query(q, { params: { projectId: pid } })) as {
          data?: Array<Record<string, unknown>>;
        };
        for (const row of res.data ?? []) {
          const normalized = this.normalizeFlowRow(row);
          const key = String(normalized.routePath ?? '');
          if (!key || seen.has(key)) continue;
          seen.add(key);
          rows.push(normalized);
        }
      }
      return rows;
    } catch (err) {
      this.logger.warn(
        `C4 sequence api-client routes: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    } finally {
      await client.close();
    }
  }

  private async fetchApiClientFallback(projectId: string): Promise<SequenceFlowRow | null> {
    const config = getFalkorConfig();
    const client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
    try {
      const contexts = await this.projects.getCypherShardContexts(projectId, {
        includeSiblingProjects: false,
      });
      const shards =
        contexts.length > 0
          ? contexts
          : [
              {
                graphName: graphNameForProject(isProjectShardingEnabled() ? projectId : undefined),
                cypherProjectId: projectId,
              },
            ];

      const fallbackQ = `
        MATCH (f:File)-[:REFERENCES_API]->(acr:ApiClientReference)
        WHERE f.projectId = $projectId
        OPTIONAL MATCH (acr)-[:CALLS_NEST_ROUTE]->(nr:NestRoute)
        OPTIONAL MATCH (nc:NestController)-[:DECLARES_ROUTE]->(nr)
        OPTIONAL MATCH (cf:File)-[:CONTAINS]->(nc)
        RETURN f.path AS screenFilePath,
               'API client' AS screenName,
               coalesce(acr.normalizedPath, acr.apiPath) AS apiPath,
               coalesce(nr.fullPath, nr.path) AS backendPath,
               coalesce(nr.httpMethod, 'GET') AS method,
               nr.handlerName AS handlerName,
               coalesce(nc.name, nr.controllerName) AS controllerName,
               cf.path AS controllerFilePath,
               f.path AS routePath,
               true AS hasApiLink
        LIMIT 1
      `;

      for (const shard of shards) {
        const graph = client.selectGraph(shard.graphName);
        const pid = shard.cypherProjectId;
        const fb = (await graph.query(fallbackQ, { params: { projectId: pid } })) as {
          data?: Array<Record<string, unknown>>;
        };
        const first = fb.data?.[0];
        if (first) return this.normalizeFlowRow(first);
      }
      return null;
    } catch (err) {
      this.logger.warn(
        `C4 sequence extract fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    } finally {
      await client.close();
    }
  }

  private normalizeFlowRow(row: Record<string, unknown>): SequenceFlowRow {
    return {
      routePath: row.routePath != null ? String(row.routePath) : undefined,
      screenName: row.screenName != null ? String(row.screenName) : undefined,
      screenFilePath: row.screenFilePath != null ? String(row.screenFilePath) : undefined,
      apiPath: row.apiPath != null ? String(row.apiPath) : undefined,
      backendPath: row.backendPath != null ? String(row.backendPath) : undefined,
      method: row.method != null ? String(row.method) : undefined,
      handlerName: row.handlerName != null ? String(row.handlerName) : undefined,
      controllerName: row.controllerName != null ? String(row.controllerName) : undefined,
      controllerFilePath: row.controllerFilePath != null ? String(row.controllerFilePath) : undefined,
      routeId: row.routeId != null ? String(row.routeId) : undefined,
      isPublicEntry: String(row.isPublicEntry ?? 'false') === 'true',
      hasApiLink: Boolean(row.hasApiLink),
      kind: row.kind === 'api-client' ? 'api-client' : 'route',
      httpStatusCode: this.parseOptionalInt(row.httpStatusCode),
      serviceMethod: row.serviceMethod != null ? String(row.serviceMethod) : undefined,
      modelName: row.modelName != null ? String(row.modelName) : undefined,
      modelTable: row.modelTable != null ? String(row.modelTable) : undefined,
    };
  }

  private parseOptionalInt(value: unknown): number | undefined {
    if (value == null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) && n >= 100 && n < 600 ? n : undefined;
  }
}
