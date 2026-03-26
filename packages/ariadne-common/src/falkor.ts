/**
 * Configuración FalkorDB compartida (ingest, API, MCP, cartographer).
 *
 * Sharding: `FALKOR_SHARD_BY_PROJECT=true` usa un grafo Redis distinto por `projectId`
 * (`AriadneSpecs:<projectId>`) para repartir nodos entre grafos y acercarse al límite ~100k.
 *
 * Grafo externo (opcional): `FALKOR_EXTERNAL_GRAPH_ENABLED=true` + `FALKOR_EXTERNAL_GRAPH`
 * reservado para aislar dependencias de terceros en un grafo secundario (escritura en producer pendiente).
 */

export const GRAPH_NAME = 'AriadneSpecs';

/** Grafo shadow SDD (unificado con ingest). */
export const SHADOW_GRAPH_NAME = 'FalkorSpecsShadow';

export interface FalkorConfig {
  host: string;
  port: number;
}

/** FalkorDB: host/puerto desde env. */
export function getFalkorConfig(): FalkorConfig {
  return {
    host: process.env.FALKORDB_HOST ?? 'localhost',
    port: parseInt(process.env.FALKORDB_PORT ?? '6379', 10),
  };
}

/** Partición por dominio (UUID proyecto en ingest / Falkor projectId). */
export function isProjectShardingEnabled(): boolean {
  const v = process.env.FALKOR_SHARD_BY_PROJECT ?? '';
  return v === '1' || v.toLowerCase() === 'true';
}

/** Nombre del grafo secundario para npm/externos (MVP: solo naming + env). */
export function externalGraphName(): string {
  return process.env.FALKOR_EXTERNAL_GRAPH?.trim() || 'AriadneSpecs:external';
}

export function isExternalGraphRoutingEnabled(): boolean {
  const v = process.env.FALKOR_EXTERNAL_GRAPH_ENABLED ?? '';
  return v === '1' || v.toLowerCase() === 'true';
}

/**
 * Resuelve el nombre lógico del grafo en FalkorDB.
 * Sin sharding: siempre `GRAPH_NAME`.
 * Con sharding: `GRAPH_NAME:projectId` (projectId sanitizado).
 */
export function graphNameForProject(projectId?: string | null): string {
  if (!isProjectShardingEnabled() || !projectId) {
    return GRAPH_NAME;
  }
  const safe = String(projectId).replace(/[^a-zA-Z0-9:_-]/g, '_');
  return `${GRAPH_NAME}:${safe}`;
}
