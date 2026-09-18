/**
 * @fileoverview Workflow Archify: sync pipeline, flujos por ruta y :Flow indexados en Falkor.
 */
import { Injectable, Logger } from '@nestjs/common';
import { FalkorDB } from 'falkordb';
import {
  buildDefaultSyncWorkflowSpec,
  buildRouteFlowWorkflowSpec,
  indexedFlowPayloadToWorkflowSpec,
  syncWorkflowToArchifyWorkflow,
  type ArchifyWorkflowIr,
  type C4WorkflowTargetOption,
  type IndexedFlowPayload,
  type SyncWorkflowSpec,
} from 'ariadne-common';
import { getFalkorConfig, graphNameForProject, isProjectShardingEnabled } from '../pipeline/falkor';
import { ProjectsService } from '../projects/projects.service';
import { C4SequenceExtractor } from './c4-sequence.extractor';

interface FlowNodeRow {
  flowId: string;
  kind: string;
  label: string;
  description?: string;
  sourcePath?: string;
  payloadJson?: string;
}

@Injectable()
export class C4WorkflowExtractor {
  private readonly logger = new Logger(C4WorkflowExtractor.name);

  constructor(
    private readonly projects: ProjectsService,
    private readonly sequenceExtractor: C4SequenceExtractor,
  ) {}

  async listTargets(projectId: string): Promise<C4WorkflowTargetOption[]> {
    await this.projects.findOne(projectId);
    const targets: C4WorkflowTargetOption[] = [];

    const routes = await this.sequenceExtractor.listRoutes(projectId);
    for (const route of routes) {
      targets.push({
        id: `route:${route.routePath}`,
        kind: 'route-flow',
        label: route.routePath,
        description:
          [route.screenName, route.apiSummary].filter(Boolean).join(' · ') ||
          'Flujo feature por ruta indexada',
        routePath: route.routePath,
      });
    }

    const indexed = await this.fetchFlowNodes(projectId);
    for (const row of indexed) {
      if (targets.some((t) => t.id === row.flowId)) continue;
      targets.push({
        id: row.flowId,
        kind: row.kind as C4WorkflowTargetOption['kind'],
        label: row.label,
        description: row.description ?? row.kind,
        sourcePath: row.sourcePath ?? null,
      });
    }

    targets.push({
      id: 'sync-pipeline',
      kind: 'sync-pipeline',
      label: 'Sync pipeline (Ariadne)',
      description: 'Proceso full-sync interno: mapping → Falkor → embeddings → C4',
    });

    const defaultId = this.pickDefaultTargetId(targets, routes);
    return targets.map((t) => ({ ...t, isDefault: t.id === defaultId }));
  }

  async buildWorkflow(
    projectId: string,
    targetId = 'sync-pipeline',
  ): Promise<{ spec: SyncWorkflowSpec; archifyIr: ArchifyWorkflowIr; targetId: string }> {
    const project = await this.projects.findOne(projectId);

    if (targetId === 'sync-pipeline') {
      const spec = buildDefaultSyncWorkflowSpec(project.name ?? projectId);
      return { spec, archifyIr: syncWorkflowToArchifyWorkflow(spec), targetId };
    }

    if (targetId.startsWith('route:')) {
      const routePath = targetId.slice('route:'.length);
      const row = await this.sequenceExtractor.resolveRouteFlowRow(projectId, routePath);
      const spec = buildRouteFlowWorkflowSpec({
        routePath,
        screenName: row?.screenName ?? 'Screen',
        method: String(row?.method ?? 'GET'),
        apiPath: row?.apiPath,
        backendPath: row?.backendPath,
        handlerName: row?.handlerName,
        modelName: row?.modelName,
        modelTable: row?.modelTable,
        serviceMethod: row?.serviceMethod,
        httpStatusCode: row?.httpStatusCode,
      });
      return { spec, archifyIr: syncWorkflowToArchifyWorkflow(spec), targetId };
    }

    const flowNode = await this.fetchFlowNode(projectId, targetId);
    if (flowNode?.payloadJson) {
      try {
        const payload = JSON.parse(flowNode.payloadJson) as IndexedFlowPayload;
        const spec = indexedFlowPayloadToWorkflowSpec(payload);
        return { spec, archifyIr: syncWorkflowToArchifyWorkflow(spec), targetId };
      } catch (err) {
        this.logger.warn(
          `Flow payload inválido ${targetId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const spec = buildDefaultSyncWorkflowSpec(project.name ?? projectId);
    return { spec, archifyIr: syncWorkflowToArchifyWorkflow(spec), targetId: 'sync-pipeline' };
  }

  private pickDefaultTargetId(
    targets: C4WorkflowTargetOption[],
    routes: Array<{ routePath: string; hasApiLink: boolean; isPublicEntry: boolean }>,
  ): string {
    const preferredRoute = routes.find((r) => r.isPublicEntry && r.hasApiLink) ?? routes.find((r) => r.hasApiLink) ?? routes[0];
    if (preferredRoute) {
      const id = `route:${preferredRoute.routePath}`;
      if (targets.some((t) => t.id === id)) return id;
    }
    const enumFlow = targets.find((t) => t.kind === 'enum-status');
    if (enumFlow) return enumFlow.id;
    const journey = targets.find((t) => t.kind === 'journey');
    if (journey) return journey.id;
    return targets[0]?.id ?? 'sync-pipeline';
  }

  private async fetchFlowNodes(projectId: string): Promise<FlowNodeRow[]> {
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
        MATCH (fl:Flow)
        WHERE fl.projectId = $projectId
        RETURN fl.flowId AS flowId, fl.kind AS kind, fl.label AS label,
               fl.description AS description, fl.sourcePath AS sourcePath,
               fl.payloadJson AS payloadJson
        ORDER BY fl.kind, fl.label
        LIMIT 80
      `;

      const rows: FlowNodeRow[] = [];
      const seen = new Set<string>();
      for (const shard of shards) {
        const graph = client.selectGraph(shard.graphName);
        const res = (await graph.query(q, { params: { projectId: shard.cypherProjectId } })) as {
          data?: Array<Record<string, unknown>>;
        };
        for (const row of res.data ?? []) {
          const flowId = String(row.flowId ?? '');
          if (!flowId || seen.has(flowId)) continue;
          seen.add(flowId);
          rows.push({
            flowId,
            kind: String(row.kind ?? 'wizard'),
            label: String(row.label ?? flowId),
            description: row.description != null ? String(row.description) : undefined,
            sourcePath: row.sourcePath != null ? String(row.sourcePath) : undefined,
            payloadJson: row.payloadJson != null ? String(row.payloadJson) : undefined,
          });
        }
      }
      return rows;
    } catch (err) {
      this.logger.warn(`C4 workflow list flows: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    } finally {
      await client.close();
    }
  }

  private async fetchFlowNode(projectId: string, flowId: string): Promise<FlowNodeRow | null> {
    const nodes = await this.fetchFlowNodes(projectId);
    return nodes.find((n) => n.flowId === flowId) ?? null;
  }
}
