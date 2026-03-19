/**
 * Configuración de conexión FalkorDB (host, port) compartida por ingest, cartographer y MCP.
 */

export const GRAPH_NAME = 'FalkorSpecs';

export interface FalkorConfig {
  host: string;
  port: number;
}

/**
 * Obtiene la configuración de conexión a FalkorDB desde variables de entorno.
 * FALKORDB_HOST (default localhost), FALKORDB_PORT (default 6379).
 */
export function getFalkorConfig(): FalkorConfig {
  return {
    host: process.env.FALKORDB_HOST ?? 'localhost',
    port: parseInt(process.env.FALKORDB_PORT ?? '6379', 10),
  };
}
