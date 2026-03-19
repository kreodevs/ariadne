/**
 * Utilidades de grafo compartidas: buildExportsMap, resolveCrossFileCalls, runCypherBatch.
 */

import type { ParsedFileMinimal, ResolvedCallInfo } from './graph-types.js';

export interface GraphClient {
  query(cypher: string, params?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Construye el mapa path -> set de nombres exportados (funciones + componentes).
 */
export function buildExportsMap(
  parsedFiles: ParsedFileMinimal[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const p of parsedFiles) {
    const set = new Set<string>();
    for (const f of p.functions ?? []) set.add(f.name);
    for (const c of p.components ?? []) set.add(c.name);
    map.set(p.path, set);
  }
  return map;
}

/**
 * Resuelve llamadas entre archivos: para cada unresolvedCall, resuelve el callee por import y comprueba que esté exportado.
 */
export function resolveCrossFileCalls(
  parsedFiles: ParsedFileMinimal[],
  allFilePaths: Set<string>,
  resolvePath: (fromPath: string, specifier: string) => string | null,
): ResolvedCallInfo[] {
  const exportsMap = buildExportsMap(parsedFiles);
  const resolved: ResolvedCallInfo[] = [];
  for (const p of parsedFiles) {
    const localToSpecifier = new Map<string, { specifier: string; isDefault: boolean }>();
    for (const imp of p.imports) {
      for (const local of imp.localNames) {
        localToSpecifier.set(local, { specifier: imp.specifier, isDefault: imp.isDefault });
      }
    }
    for (const uc of p.unresolvedCalls ?? []) {
      const entry = localToSpecifier.get(uc.calleeLocalName);
      if (!entry || entry.isDefault) continue;
      const calleePath = resolvePath(p.path, entry.specifier);
      if (!calleePath || !allFilePaths.has(calleePath)) continue;
      const exported = exportsMap.get(calleePath);
      if (!exported || !exported.has(uc.calleeLocalName)) continue;
      resolved.push({
        callerPath: p.path,
        callerName: uc.caller,
        calleePath,
        calleeName: uc.calleeLocalName,
      });
    }
  }
  return resolved;
}

/** Tamaño de batch por defecto (env FALKORDB_BATCH_SIZE). */
const DEFAULT_BATCH_SIZE = parseInt(process.env.FALKORDB_BATCH_SIZE ?? '500', 10);

/**
 * Ejecuta un batch de sentencias Cypher en orden. Si batchSize se omite, usa FALKORDB_BATCH_SIZE o 500.
 * @param client - Cliente FalkorDB (query).
 * @param statements - Sentencias Cypher.
 * @param batchSize - Opcional; si se pasa 0 o no se pasa, usa env o 500.
 */
export async function runCypherBatch(
  client: GraphClient,
  statements: string[],
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<void> {
  const size = batchSize > 0 ? batchSize : statements.length;
  for (let i = 0; i < statements.length; i += size) {
    const chunk = statements.slice(i, i + size);
    for (const q of chunk) {
      await client.query(q);
    }
  }
}
