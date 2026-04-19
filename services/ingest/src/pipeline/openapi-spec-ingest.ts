/**
 * Ingesta swagger.json / openapi.yaml como fuente de verdad para contratos HTTP (MDD §4).
 * Nodos :OpenApiOperation { pathTemplate, method, specPath, docSource } enlazados al :File del spec.
 */
import { parse as parseYaml } from 'yaml';
import { cypherSafe } from 'ariadne-common';

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

function tryParseOpenApi(content: string, path: string): Record<string, unknown> | null {
  const t = path.toLowerCase();
  try {
    if (t.endsWith('.json') || content.trim().startsWith('{')) {
      return JSON.parse(content) as Record<string, unknown>;
    }
  } catch {
    /* fall through yaml */
  }
  try {
    const doc = parseYaml(content);
    return typeof doc === 'object' && doc !== null ? (doc as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Genera MERGE para File (marcado como spec OpenAPI) y nodos OpenApiOperation por cada ruta×método.
 */
export function buildCypherForOpenApiSpec(
  specPath: string,
  content: string,
  projectId: string,
  repoId: string,
): string[] {
  const pid = cypherSafe(projectId);
  const rid = cypherSafe(repoId);
  const path = specPath;
  const ext = path.slice(path.lastIndexOf('.'));
  const now = new Date().toISOString();
  const statements: string[] = [];

  const root = tryParseOpenApi(content, path);
  if (!root) return statements;

  const paths = root.paths;
  if (!paths || typeof paths !== 'object' || Array.isArray(paths)) return statements;

  statements.push(
    `MERGE (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET f.extension = ${cypherSafe(ext)}, f.lastScan = ${cypherSafe(now)}, f.openApiTruth = true, f.specKind = 'openapi' ON MATCH SET f.extension = ${cypherSafe(ext)}, f.lastScan = ${cypherSafe(now)}, f.openApiTruth = true, f.specKind = 'openapi'`,
  );
  statements.push(
    `MATCH (p:Project {projectId: ${pid}}) MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MERGE (p)-[:CONTAINS]->(f)`,
  );

  for (const [pathTemplate, pathItem] of Object.entries(paths as Record<string, unknown>)) {
    if (!pathItem || typeof pathItem !== 'object' || Array.isArray(pathItem)) continue;
    const ops = pathItem as Record<string, unknown>;
    for (const [method, opVal] of Object.entries(ops)) {
      const m = method.toLowerCase();
      if (!HTTP_METHODS.has(m)) continue;
      const opObj = opVal && typeof opVal === 'object' && !Array.isArray(opVal) ? (opVal as Record<string, unknown>) : {};
      const summary =
        typeof opObj.summary === 'string'
          ? opObj.summary
          : typeof opObj.operationId === 'string'
            ? opObj.operationId
            : '';
      const sum = summary ? `, op.summary = ${cypherSafe(summary.slice(0, 500))}` : '';
      statements.push(
        `MERGE (op:OpenApiOperation {pathTemplate: ${cypherSafe(pathTemplate)}, method: ${cypherSafe(m.toUpperCase())}, specPath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET op.docSource = 'swagger'${sum} ON MATCH SET op.docSource = 'swagger'${sum}`,
      );
      statements.push(
        `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (op:OpenApiOperation {pathTemplate: ${cypherSafe(pathTemplate)}, method: ${cypherSafe(m.toUpperCase())}, specPath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:DEFINES_OP]->(op)`,
      );
    }
  }

  return statements;
}
