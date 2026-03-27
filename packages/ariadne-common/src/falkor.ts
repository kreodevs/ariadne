/**
 * Configuración FalkorDB compartida (ingest, API, MCP, cartographer).
 *
 * Sharding: `FALKOR_SHARD_BY_PROJECT=true` usa un grafo Redis distinto por `projectId`
 * (`AriadneSpecs:<projectId>`) para repartir nodos entre grafos y acercarse al límite ~100k.
 *
 * Sharding por sub-dominio (p. ej. primer segmento de ruta en monorepo): `FALKOR_SHARD_BY_DOMAIN=true`
 * o `projects.falkor_shard_mode = 'domain'` tras superar `FALKOR_GRAPH_NODE_SOFT_LIMIT` con
 * `FALKOR_AUTO_DOMAIN_OVERFLOW=true` → grafos `AriadneSpecs:<projectId>:<segmento>`.
 *
 * Grafo externo (opcional): `FALKOR_EXTERNAL_GRAPH_ENABLED=true` + `FALKOR_EXTERNAL_GRAPH`
 * reservado para aislar dependencias de terceros en un grafo secundario (escritura en producer pendiente).
 */

export const GRAPH_NAME = 'AriadneSpecs';

/** Un grafo por proyecto (legacy). Varias particiones por proyecto (p. ej. carpeta superior del repo). */
export type FalkorShardMode = 'project' | 'domain';

export interface GraphNameForProjectOptions {
  shardMode?: FalkorShardMode;
  /** Segmento sanitizado (p. ej. `apps`, `packages_api`); obligatorio si shardMode es domain. */
  domainSegment?: string | null;
}

/** Grafo shadow SDD (legacy monolítico; preferir {@link shadowGraphNameForSession}). */
export const SHADOW_GRAPH_NAME = 'FalkorSpecsShadow';

/**
 * Grafo FalkorDB aislado por sesión SDD (shadow indexing en memoria lógica separada del grafo principal).
 * Cada POST /shadow puede usar un id nuevo o reutilizar uno para reindexar solo ese namespace.
 */
export function shadowGraphNameForSession(sessionId: string): string {
  const safe = String(sessionId).trim().replace(/[^a-zA-Z0-9:_-]/g, '_');
  if (!safe || safe.length > 200) {
    throw new Error('shadowSessionId inválido o demasiado largo');
  }
  return `${SHADOW_GRAPH_NAME}:${safe}`;
}

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

/** Límite orientativo de nodos por grafo Falkor (~100k); usado para activar partición por dominio. */
export function getGraphNodeSoftLimit(): number {
  const raw = process.env.FALKOR_GRAPH_NODE_SOFT_LIMIT ?? '100000';
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 100_000;
}

/** Fuerza partición por primer segmento de ruta en todos los proyectos (además de FALKOR_SHARD_BY_PROJECT). */
export function isEnvDomainShardingEnabled(): boolean {
  const v = process.env.FALKOR_SHARD_BY_DOMAIN ?? '';
  return v === '1' || v.toLowerCase() === 'true';
}

/**
 * Tras un sync, si el grafo monolítico del proyecto supera el soft limit, se puede fijar modo domain en BD.
 * Requiere resync para repartir datos en los nuevos grafos.
 */
export function isAutoDomainOverflowEnabled(): boolean {
  const v = process.env.FALKOR_AUTO_DOMAIN_OVERFLOW ?? '';
  return v === '1' || v.toLowerCase() === 'true';
}

function sanitizeIdPart(s: string): string {
  return String(s).replace(/[^a-zA-Z0-9:_-]/g, '_');
}

/**
 * Modo efectivo: variable de entorno global o valor persistido por proyecto (`domain`).
 */
export function effectiveShardMode(dbMode?: FalkorShardMode | null): FalkorShardMode {
  if (isEnvDomainShardingEnabled()) return 'domain';
  return dbMode === 'domain' ? 'domain' : 'project';
}

/**
 * Primer segmento de la ruta relativa al repo = subdominio lógico (módulo de negocio / paquete raíz).
 * Raíz del repo → `_root`.
 */
export function domainSegmentFromRepoPath(relPath: string): string {
  const norm = String(relPath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const first = norm.split('/').filter(Boolean)[0];
  return first ? sanitizeIdPart(first).slice(0, 64) || '_root' : '_root';
}

/**
 * Nombres de grafo candidatos para resolución MCP/API (mono + cada shard conocido).
 */
export function listGraphNamesForProjectRouting(
  projectId: string,
  shardMode: FalkorShardMode,
  domainSegments: string[],
): string[] {
  if (!isProjectShardingEnabled()) {
    return [GRAPH_NAME];
  }
  const mono = graphNameForProject(projectId);
  if (shardMode !== 'domain') {
    return [mono];
  }
  const out = new Set<string>([mono]);
  const seen = new Set(domainSegments.map((s) => sanitizeIdPart(s).slice(0, 64)));
  for (const seg of seen) {
    if (seg) {
      out.add(
        graphNameForProject(projectId, { shardMode: 'domain', domainSegment: seg }),
      );
    }
  }
  return [...out];
}

/**
 * Resuelve el nombre lógico del grafo en FalkorDB.
 * Sin sharding: siempre `GRAPH_NAME`.
 * Con sharding: `GRAPH_NAME:projectId` (projectId sanitizado).
 * Con sharding por dominio: `GRAPH_NAME:projectId:segmento`.
 */
export function graphNameForProject(
  projectId?: string | null,
  opts?: GraphNameForProjectOptions | null,
): string {
  if (!isProjectShardingEnabled() || !projectId) {
    return GRAPH_NAME;
  }
  const safe = sanitizeIdPart(String(projectId));
  const mode = opts?.shardMode ?? 'project';
  if (mode === 'domain' && opts?.domainSegment) {
    const seg = sanitizeIdPart(String(opts.domainSegment)).slice(0, 64) || '_root';
    return `${GRAPH_NAME}:${safe}:${seg}`;
  }
  return `${GRAPH_NAME}:${safe}`;
}
