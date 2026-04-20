/**
 * @fileoverview Cliente FalkorDB para MCP. Sharding por proyecto y por sub-dominio (ruta).
 */
import { FalkorDB } from "falkordb";
import {
  GRAPH_NAME,
  getFalkorConfig,
  graphNameForProject,
  isProjectShardingEnabled,
  effectiveShardMode,
  domainSegmentFromRepoPath,
  listGraphNamesForProjectRouting,
  type FalkorShardMode,
} from "ariadne-common";

export { GRAPH_NAME, getFalkorConfig };
export type { FalkorShardMode };

export type CypherShardContext = {
  graphName: string;
  cypherProjectId: string;
};

export type ProjectGraphRouting = {
  projectId: string;
  shardMode: FalkorShardMode;
  domainSegments: string[];
  graphNodeSoftLimit: number;
  /** Grafos Falkor de proyectos en dominios whitelist (gobierno de arquitectura). */
  extendedGraphShardNames?: string[];
  /** Par grafo + projectId en nodos (ingest). Preferido frente a solo nombres. */
  cypherShardContexts?: CypherShardContext[];
};

let client: Awaited<ReturnType<typeof FalkorDB.connect>> | null = null;

/**
 * FalkorDB reenvía errores del cliente Redis (`client.on('error', …) → emit('error')`).
 * Sin listener propio, Node usa el handler por defecto y el proceso **termina** ante `Socket closed unexpectedly`
 * (reinicio de Falkor, idle timeout de red, LB, etc.).
 */
function attachFalkorErrorHandler(c: Awaited<ReturnType<typeof FalkorDB.connect>>) {
  c.on("error", (err: Error) => {
    console.error("[mcp-ariadne] FalkorDB client error:", err?.message ?? err);
  });
}

async function getClient() {
  if (!client) {
    const config = getFalkorConfig();
    const c = await FalkorDB.connect({
      /** Evita cortes silenciosos detrás de NAT / balanceadores sin TCP keepalive. */
      pingInterval: 30_000,
      socket: {
        host: config.host,
        port: config.port,
        /** Pasado a `redis` `createClient`; los tipos de `falkordb` no declaran esta propiedad. */
        ...({
          reconnectStrategy: (retries: number) => {
            if (retries > 100) return new Error("[mcp-ariadne] FalkorDB reconnection limit exceeded");
            return Math.min(retries * 50, 2_000);
          },
        } as object),
      },
    });
    attachFalkorErrorHandler(c);
    client = c;
  }
  return client;
}

const routingCache = new Map<string, ProjectGraphRouting>();

export async function fetchProjectGraphRouting(projectId: string): Promise<ProjectGraphRouting | null> {
  const cached = routingCache.get(projectId);
  if (cached) return cached;
  const base = (process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "").replace(/\/$/, "");
  if (!base) return null;
  try {
    const res = await fetch(`${base}/projects/${projectId}/graph-routing`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as ProjectGraphRouting;
    routingCache.set(projectId, j);
    return j;
  } catch {
    return null;
  }
}

/**
 * Grafo principal para un proyecto; con partición por dominio usa la ruta relativa al repo si está disponible.
 */
export async function getGraph(
  projectId?: string | null,
  opts?: { repoRelativePath?: string | null },
) {
  const c = await getClient();
  if (!isProjectShardingEnabled() || !projectId) {
    return c.selectGraph(GRAPH_NAME);
  }
  const routing = await fetchProjectGraphRouting(projectId);
  const mode: FalkorShardMode = routing?.shardMode ?? effectiveShardMode(null);
  if (mode === "domain" && opts?.repoRelativePath) {
    return c.selectGraph(
      graphNameForProject(projectId, {
        shardMode: "domain",
        domainSegment: domainSegmentFromRepoPath(opts.repoRelativePath),
      }),
    );
  }
  return c.selectGraph(graphNameForProject(projectId));
}

export async function getProjectShardGraphNames(projectId: string): Promise<string[]> {
  if (!isProjectShardingEnabled()) {
    return [GRAPH_NAME];
  }
  const routing = await fetchProjectGraphRouting(projectId);
  const mode: FalkorShardMode = routing?.shardMode ?? effectiveShardMode(null);
  const segments = routing?.domainSegments ?? [];
  const base = listGraphNamesForProjectRouting(
    projectId,
    mode === "domain" ? "domain" : "project",
    segments,
  );
  const extra = routing?.extendedGraphShardNames;
  if (Array.isArray(extra) && extra.length > 0) {
    return [...new Set([...base, ...extra])];
  }
  return base;
}

/**
 * Itera todos los subgrafos candidatos (mono + dominios + whitelist) hasta que fn devuelve true (early exit).
 * `cypherProjectId` es el que debe usarse en `WHERE n.projectId = $projectId` al consultar ese grafo.
 */
export async function forEachProjectShardGraph(
  projectId: string,
  fn: (
    graph: ReturnType<Awaited<ReturnType<typeof getClient>>["selectGraph"]>,
    ctx: { cypherProjectId: string },
  ) => Promise<boolean | void>,
): Promise<void> {
  const c = await getClient();
  const routing = await fetchProjectGraphRouting(projectId);
  const contexts = routing?.cypherShardContexts;
  if (Array.isArray(contexts) && contexts.length > 0) {
    for (const ctx of contexts) {
      const g = c.selectGraph(ctx.graphName);
      const stop = await fn(g, { cypherProjectId: ctx.cypherProjectId });
      if (stop === true) return;
    }
    return;
  }
  if (!isProjectShardingEnabled()) {
    await fn(c.selectGraph(GRAPH_NAME), { cypherProjectId: projectId });
    return;
  }
  const names = await getProjectShardGraphNames(projectId);
  for (const name of names) {
    const g = c.selectGraph(name);
    const stop = await fn(g, { cypherProjectId: projectId });
    if (stop === true) return;
  }
}

export async function closeFalkor() {
  if (client) {
    await client.close();
    client = null;
  }
  routingCache.clear();
}
