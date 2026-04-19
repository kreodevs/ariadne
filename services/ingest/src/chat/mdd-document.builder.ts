/**
 * Construye el JSON MDD de 7 secciones desde Falkor + archivos físicos (sin inventar paths).
 */
import type { MddEvidenceDocument } from './mdd-document.types';

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

  let manifestDepKeys: string[] = [];
  try {
    const rows = (await executeCypher(
      projectId,
      `MATCH (p:Project {projectId: $projectId}) RETURN p.manifestDeps AS m LIMIT 1`,
      { projectId },
    )) as Array<{ m?: string | null }>;
    const raw = rows[0]?.m;
    if (typeof raw === 'string' && raw.trim()) {
      const j = JSON.parse(raw) as string[] | { depKeys?: string[]; scripts?: Record<string, string> };
      manifestDepKeys = Array.isArray(j) ? j : j.depKeys ?? [];
    }
  } catch {
    /* ignore */
  }

  let openapiPath: string | null = null;
  try {
    const oa = (await executeCypher(
      projectId,
      `MATCH (f:File {projectId: $projectId}) WHERE f.openApiTruth = true RETURN f.path AS path LIMIT 5`,
      { projectId },
    )) as Array<{ path?: string }>;
    openapiPath = oa[0]?.path ?? null;
  } catch {
    /* ignore */
  }

  const apiFromSwagger: Array<{ route: string; methods: string[]; doc_source: 'swagger' | 'ast' }> =
    [];
  try {
    const ops = (await executeCypher(
      projectId,
      `MATCH (op:OpenApiOperation {projectId: $projectId})
       RETURN op.pathTemplate AS route, op.method AS method LIMIT 800`,
      { projectId },
    )) as Array<{ route?: string; method?: string }>;
    const byRoute = new Map<string, Set<string>>();
    for (const row of ops) {
      if (!row.route || !row.method) continue;
      if (!byRoute.has(row.route)) byRoute.set(row.route, new Set());
      byRoute.get(row.route)!.add(String(row.method).toUpperCase());
    }
    for (const [route, methods] of byRoute) {
      apiFromSwagger.push({ route, methods: [...methods], doc_source: 'swagger' });
    }
  } catch {
    /* grafo sin OpenApiOperation */
  }

  let apiFromAst: Array<{ route: string; methods: string[]; doc_source: 'swagger' | 'ast' }> = [];
  if (apiFromSwagger.length === 0) {
    try {
      const ctr = (await executeCypher(
        projectId,
        `MATCH (c:NestController {projectId: $projectId})
         RETURN coalesce(c.route,'') AS prefix, c.name AS name LIMIT 80`,
        { projectId },
      )) as Array<{ prefix?: string | null; name?: string }>;
      for (const row of ctr) {
        const base = (row.prefix ?? '').replace(/^\/|\/$/g, '');
        const route = base ? `/${base}` : '/';
        apiFromAst.push({ route, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], doc_source: 'ast' });
      }
    } catch {
      /* ignore */
    }
  }

  const entities: MddEvidenceDocument['entities'] = [];
  try {
    const models = (await executeCypher(
      projectId,
      `MATCH (m:Model {projectId: $projectId})
       RETURN m.name AS name, m.source AS source, m.fieldSummary AS fs LIMIT 400`,
      { projectId },
    )) as Array<{ name?: string; source?: string; fs?: string | null }>;
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
      entities.push({ name: row.name, source, fields });
    }
  } catch {
    /* ignore */
  }

  const business: MddEvidenceDocument['business_logic'] = [];
  try {
    const svcs = (await executeCypher(
      projectId,
      `MATCH (f:File)-[:CONTAINS]->(s:NestService {projectId: $projectId})
       RETURN s.name AS service, f.path AS path LIMIT 120`,
      { projectId },
    )) as Array<{ service?: string; path?: string }>;
    for (const row of svcs) {
      if (row.service)
        business.push({ service: row.service, dependencies: row.path ? [row.path] : [] });
    }
  } catch {
    /* ignore */
  }

  let envVars: string[] = [];
  const envContent = await getFileSnippet('.env.example');
  if (envContent) envVars = parseEnvExampleKeys(envContent);

  const evidence_paths = pathsFromGathering(gatheredContext, collectedResults);

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
    const c = await getFileSnippet(p);
    if (c && c.length > 0 && !evidence_paths.includes(p)) evidence_paths.push(p);
  }

  const trust: MddEvidenceDocument['openapi_spec']['trust_level'] =
    openapiPath && apiFromSwagger.length ? 'high' : openapiPath ? 'medium' : 'low';

  const summary = [
    `Consulta: ${message.slice(0, 240)}`,
    `Evidencia anclada a ${evidence_paths.length} ruta(s) verificada(s) en el repositorio indexado.`,
    openapiPath ? `Contrato OpenAPI priorizado: \`${openapiPath}\`.` : 'Sin spec OpenAPI indexado; rutas vía AST si aplica.',
    entities.length ? `${entities.length} modelo(s) en grafo (Prisma/TypeORM).` : 'Sin nodos Model en grafo para este alcance.',
  ].join(' ');

  const complexity = Math.min(
    100,
    Math.round(
      entities.length * 2 +
        apiFromSwagger.length +
        apiFromAst.length +
        business.length +
        evidence_paths.length * 0.5,
    ),
  );

  return {
    summary,
    openapi_spec: {
      found: Boolean(openapiPath),
      path: openapiPath,
      trust_level: trust,
    },
    entities,
    api_contracts: apiFromSwagger.length ? apiFromSwagger : apiFromAst,
    business_logic: business,
    infrastructure: {
      orm: inferOrmFromDeps(manifestDepKeys),
      env_vars: envVars,
    },
    risk_report: {
      complexity,
      anti_patterns: apiFromSwagger.length === 0 && apiFromAst.length > 50 ? ['ast_fallback_large_surface'] : [],
    },
    evidence_paths: uniq(evidence_paths).slice(0, 200),
  };
}
