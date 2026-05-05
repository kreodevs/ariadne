/**
 * Construye el JSON MDD de 7 secciones desde Falkor + archivos físicos (sin inventar paths).
 */
import type { MddEvidenceDocument } from './mdd-document.types';
import { getMddBuilderLimits } from './mdd-limits';

function uniq(paths: string[]): string[] {
  return [...new Set(paths.filter((p) => typeof p === 'string' && p.length > 0))];
}

function pathsFromGathering(gatheredContext: string, collectedResults: unknown[]): string[] {
  const out: string[] = [];
  const blob = `${gatheredContext}\n${JSON.stringify(collectedResults)}`;
  const re = /\b[\w.-]+(?:\/[\w.-]+)+\.(?:prisma|tsx?|jsx?|json|ya?ml|md|mjs|cjs|env\.example)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) !== null) {
    out.push(m[0]);
  }
  for (const r of collectedResults) {
    if (r && typeof r === 'object') {
      const o = r as Record<string, unknown>;
      const p = o.path ?? o.fnPath ?? o.file;
      if (typeof p === 'string') out.push(p);
    }
  }
  return uniq(out);
}

function inferOrmFromDeps(depKeys: string[]): string {
  const s = depKeys.join(' ').toLowerCase();
  if (s.includes('prisma') || s.includes('@prisma/client')) return 'prisma';
  if (s.includes('typeorm')) return 'typeorm';
  if (s.includes('sequelize')) return 'sequelize';
  if (s.includes('mongoose')) return 'mongoose';
  return depKeys.length ? 'unknown' : 'none';
}

function parseEnvExampleKeys(content: string): string[] {
  const keys: string[] = [];
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) keys.push(t.slice(0, eq).trim());
  }
  return keys.slice(0, 80);
}

/** Manifest agregado multi-repo: indica uso típico de Swagger en Nest. */
function inferSwaggerDependencies(depKeys: string[]): boolean {
  return depKeys.some((k) => {
    const l = k.toLowerCase();
    return l.includes('swagger') || l.includes('openapi');
  });
}

/** Inventarios / PRD que documentan endpoints aunque no haya OpenAPI indexado en el grafo. */
function pickSupplementaryApiDocPaths(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const lower = p.toLowerCase();
    if (!lower.endsWith('.md') && !lower.endsWith('.mdx')) continue;
    if (
      (lower.includes('inventario') && lower.includes('endpoint')) ||
      lower.includes('inventario-endpoint') ||
      lower.includes('endpoints.md') ||
      (lower.includes('/docs/') &&
        (lower.includes('api') || lower.includes('openapi') || lower.includes('endpoint'))) ||
      ((lower.includes('diseño') || lower.includes('diseno')) &&
        lower.includes('documentacion') &&
        lower.includes('api'))
    ) {
      out.push(p);
    }
  }
  return uniq(out);
}

function buildOpenApiSpecNotes(params: {
  openapiPath: string | null;
  swaggerDeps: boolean;
  swaggerRelatedPaths: string[];
  supplementaryDocs: string[];
  apiFromSwagger: number;
  apiFromAst: number;
}): string | undefined {
  const { openapiPath, swaggerDeps, swaggerRelatedPaths, supplementaryDocs, apiFromSwagger, apiFromAst } =
    params;
  if (openapiPath) return undefined;
  const parts: string[] = [];
  if (swaggerDeps) {
    parts.push(
      'Dependencias swagger/openapi en package.json agregado del proyecto; la UI Swagger en runtime no implica archivo openapi.json/yml indexado en Falkor.',
    );
  }
  if (swaggerRelatedPaths.length > 0) {
    parts.push(
      `Archivos de configuración o rutas con "swagger"/"openapi" en el path (${swaggerRelatedPaths.length} en grafo).`,
    );
  }
  if (supplementaryDocs.length > 0) {
    parts.push(
      'Hay documentación Markdown que puede listar endpoints; no sustituye contrato OpenAPI en el índice.',
    );
  }
  if (
    apiFromSwagger === 0 &&
    apiFromAst === 0 &&
    (swaggerDeps || swaggerRelatedPaths.length > 0 || supplementaryDocs.length > 0)
  ) {
    parts.push(
      'Sin nodos OpenApiOperation ni NestController para este projectId: revisar sync del repo backend o ejecutar export OpenAPI y re-indexar el artefacto.',
    );
  }
  return parts.length ? parts.join(' ') : undefined;
}

export async function buildMddEvidenceDocument(params: {
  projectId: string;
  message: string;
  gatheredContext: string;
  collectedResults: unknown[];
  executeCypher: (
    projectId: string,
    cypher: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown[]>;
  getFileSnippet: (relPath: string) => Promise<string | null>;
}): Promise<MddEvidenceDocument> {
  const { projectId, message, gatheredContext, collectedResults, executeCypher, getFileSnippet } =
    params;
  const L = getMddBuilderLimits();

  // ── Phase 1: All independent Cypher queries + file reads in parallel ──────────
  const [
    manifestDepKeys,
    openapiPath,
    swaggerRelatedPaths,
    apiFromSwagger,
    apiFromAst,
    entities,
    business,
    envContent,
  ] = await Promise.all([
    // 1. manifestDepKeys
    (async (): Promise<string[]> => {
      try {
        const rows = (await executeCypher(
          projectId,
          `MATCH (p:Project {projectId: $projectId}) RETURN p.manifestDeps AS m LIMIT 1`,
          { projectId },
        )) as Array<{ m?: string | null }>;
        const raw = rows[0]?.m;
        if (typeof raw === 'string' && raw.trim()) {
          const j = JSON.parse(raw) as string[] | { depKeys?: string[]; scripts?: Record<string, string> };
          return Array.isArray(j) ? j : j.depKeys ?? [];
        }
      } catch {
        /* ignore */
      }
      return [];
    })(),

    // 2. openapiPath
    (async (): Promise<string | null> => {
      try {
        const oa = (await executeCypher(
          projectId,
          `MATCH (f:File {projectId: $projectId}) WHERE f.openApiTruth = true RETURN f.path AS path LIMIT ${L.openApiFileCandidates}`,
          { projectId },
        )) as Array<{ path?: string }>;
        return oa[0]?.path ?? null;
      } catch {
        /* ignore */
      }
      return null;
    })(),

    // 3. swaggerRelatedPaths
    (async (): Promise<string[]> => {
      try {
        const sw = (await executeCypher(
          projectId,
          `MATCH (f:File {projectId: $projectId})
           WHERE toLower(f.path) CONTAINS 'swagger'
              OR toLower(f.path) CONTAINS 'openapi'
           RETURN f.path AS path LIMIT ${L.swaggerRelatedFiles}`,
          { projectId },
        )) as Array<{ path?: string }>;
        return uniq(
          sw.map((r) => r.path).filter((p): p is string => typeof p === 'string' && p.length > 0),
        );
      } catch {
        /* ignore */
      }
      return [];
    })(),

    // 4. apiFromSwagger (OpenApiOperation nodes)
    (async (): Promise<
      Array<{ route: string; methods: string[]; doc_source: 'swagger' | 'ast' }>
    > => {
      try {
        const ops = (await executeCypher(
          projectId,
          `MATCH (op:OpenApiOperation {projectId: $projectId})
           RETURN op.pathTemplate AS route, op.method AS method LIMIT ${L.openApiOperations}`,
          { projectId },
        )) as Array<{ route?: string; method?: string }>;
        const byRoute = new Map<string, Set<string>>();
        for (const row of ops) {
          if (!row.route || !row.method) continue;
          if (!byRoute.has(row.route)) byRoute.set(row.route, new Set());
          byRoute.get(row.route)!.add(String(row.method).toUpperCase());
        }
        const result: Array<{ route: string; methods: string[]; doc_source: 'swagger' | 'ast' }> = [];
        for (const [route, methods] of byRoute) {
          result.push({ route, methods: [...methods], doc_source: 'swagger' });
        }
        return result;
      } catch {
        /* grafo sin OpenApiOperation */
      }
      return [];
    })(),

    // 5. apiFromAst (NestController nodes) — run unconditionally in parallel
    (async (): Promise<
      Array<{ route: string; methods: string[]; doc_source: 'swagger' | 'ast' }>
    > => {
      try {
        const ctr = (await executeCypher(
          projectId,
          `MATCH (c:NestController {projectId: $projectId})
           RETURN coalesce(c.route,'') AS prefix, c.name AS name LIMIT ${L.nestControllers}`,
          { projectId },
        )) as Array<{ prefix?: string | null; name?: string }>;
        const result: Array<{ route: string; methods: string[]; doc_source: 'swagger' | 'ast' }> = [];
        for (const row of ctr) {
          const base = (row.prefix ?? '').replace(/^\/|\/$/g, '');
          const route = base ? `/${base}` : '/';
          result.push({ route, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], doc_source: 'ast' });
        }
        return result;
      } catch {
        /* ignore */
      }
      return [];
    })(),

    // 6. entities (Model nodes)
    (async (): Promise<MddEvidenceDocument['entities']> => {
      try {
        const models = (await executeCypher(
          projectId,
          `MATCH (m:Model {projectId: $projectId})
           RETURN m.name AS name, m.source AS source, m.fieldSummary AS fs LIMIT ${L.models}`,
          { projectId },
        )) as Array<{ name?: string; source?: string; fs?: string | null }>;
        const result: MddEvidenceDocument['entities'] = [];
        for (const row of models) {
          if (!row.name) continue;
          if (row.source !== 'prisma' && row.source !== 'typeorm' && !row.fs) continue;
          const source = row.source === 'typeorm' ? 'typeorm' : 'prisma';
          let fields: string[] = [];
          if (row.fs) {
            try {
              fields = JSON.parse(row.fs) as string[];
            } catch {
              fields = [];
            }
          }
          result.push({ name: row.name, source, fields });
        }
        return result;
      } catch {
        /* ignore */
      }
      return [];
    })(),

    // 7. business (NestService nodes)
    (async (): Promise<MddEvidenceDocument['business_logic']> => {
      try {
        const svcs = (await executeCypher(
          projectId,
          `MATCH (f:File)-[:CONTAINS]->(s:NestService {projectId: $projectId})
           RETURN s.name AS service, f.path AS path LIMIT ${L.nestServices}`,
          { projectId },
        )) as Array<{ service?: string; path?: string }>;
        const result: MddEvidenceDocument['business_logic'] = [];
        for (const row of svcs) {
          if (row.service)
            result.push({ service: row.service, dependencies: row.path ? [row.path] : [] });
        }
        return result;
      } catch {
        /* ignore */
      }
      return [];
    })(),

    // 8. envContent — read once, shared between envVars extraction and physicalPriority
    (async (): Promise<string | null> => {
      try {
        return await getFileSnippet('.env.example');
      } catch {
        return null;
      }
    })(),
  ]);

  // ── Phase 2: Build the MDD object from parallel results ──────────────────────

  // envVars from cached envContent
  const envVars: string[] = envContent ? parseEnvExampleKeys(envContent) : [];

  // evidence paths from gathered context + collected results
  const evidence_paths = pathsFromGathering(gatheredContext, collectedResults);

  // physicalPriority files — reuse cached .env.example to avoid a second read
  const physicalPriority = [
    'package.json',
    'schema.prisma',
    'prisma/schema.prisma',
    'swagger.json',
    'openapi.yaml',
    'openapi.yml',
    'tsconfig.json',
    '.env.example',
  ];
  for (const p of physicalPriority) {
    // Reuse the already-fetched .env.example content
    const c = p === '.env.example' ? envContent : await getFileSnippet(p);
    if (c && c.length > 0 && !evidence_paths.includes(p)) evidence_paths.push(p);
  }

  const mergedEvidencePaths = uniq(evidence_paths);
  const supplementaryDocPaths = pickSupplementaryApiDocPaths(mergedEvidencePaths);
  const swaggerDeps = inferSwaggerDependencies(manifestDepKeys);

  // Decide which API contracts to use: prefer swagger-derived, fall back to AST
  const api_contracts = apiFromSwagger.length ? apiFromSwagger : apiFromAst;

  const trust: MddEvidenceDocument['openapi_spec']['trust_level'] =
    openapiPath && apiFromSwagger.length ? 'high' : openapiPath ? 'medium' : 'low';

  const summaryParts = [
    `Consulta: ${message.slice(0, L.summaryMessageChars)}`,
    `Evidencia anclada a ${mergedEvidencePaths.length} ruta(s) verificada(s) en el repositorio indexado.`,
    openapiPath ? `Contrato OpenAPI priorizado: \`${openapiPath}\`.` : 'Sin spec OpenAPI indexado; rutas vía AST si aplica.',
    entities.length ? `${entities.length} modelo(s) en grafo (Prisma/TypeORM).` : 'Sin nodos Model en grafo para este alcance.',
  ];
  if (!openapiPath && (swaggerDeps || swaggerRelatedPaths.length > 0)) {
    summaryParts.push(
      'Swagger/OpenAPI en dependencias o rutas de archivo detectado(s) sin artefacto OpenAPI indexado como File.openApiTruth.',
    );
  }
  if (supplementaryDocPaths.length > 0) {
    summaryParts.push(
      `Documentación de endpoints en Markdown (evidencia): ${supplementaryDocPaths
        .slice(0, 5)
        .map((p) => `\`${p}\``)
        .join(', ')}${supplementaryDocPaths.length > 5 ? '…' : ''}.`,
    );
  }
  const summary = summaryParts.join(' ');

  const complexity = Math.min(
    100,
    Math.round(
      entities.length * 2 +
        apiFromSwagger.length +
        apiFromAst.length +
        business.length +
        mergedEvidencePaths.length * 0.5,
    ),
  );

  const openApiNotes = buildOpenApiSpecNotes({
    openapiPath,
    swaggerDeps,
    swaggerRelatedPaths,
    supplementaryDocs: supplementaryDocPaths,
    apiFromSwagger: apiFromSwagger.length,
    apiFromAst: apiFromAst.length,
  });

  return {
    summary,
    openapi_spec: {
      found: Boolean(openapiPath),
      path: openapiPath,
      trust_level: trust,
      ...(swaggerDeps ? { swagger_dependencies: true } : {}),
      ...(swaggerRelatedPaths.length > 0 ? { swagger_related_paths: swaggerRelatedPaths } : {}),
      ...(supplementaryDocPaths.length > 0 ? { supplementary_doc_paths: supplementaryDocPaths } : {}),
      ...(openApiNotes ? { notes: openApiNotes } : {}),
    },
    entities,
    api_contracts,
    business_logic: business,
    infrastructure: {
      orm: inferOrmFromDeps(manifestDepKeys),
      env_vars: envVars,
    },
    risk_report: {
      complexity,
      anti_patterns: apiFromSwagger.length === 0 && apiFromAst.length > 50 ? ['ast_fallback_large_surface'] : [],
    },
    evidence_paths: mergedEvidencePaths.slice(0, L.evidencePaths),
  };
}
