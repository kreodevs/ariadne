/**
 * Adaptador de un grafo FalkorDB al contrato `GraphClient` de ariadne-common.
 *
 * Reenvía también el segundo argumento (`{ params }`). Un wrapper de la forma
 * `(cypher) => graph.query(cypher)` descarta los parámetros y FalkorDB responde
 * "Missing parameters" en cualquier sentencia con `$batch`, `$projectId`, etc.
 */
import type { GraphClient } from 'ariadne-common';

type QueryFn = (cypher: string, options?: Record<string, unknown>) => Promise<unknown>;

export function toGraphClient(graph: { query: QueryFn }): GraphClient {
  return {
    query: (cypher: string, options?: Record<string, unknown>) =>
      options === undefined ? graph.query(cypher) : graph.query(cypher, options),
  };
}
