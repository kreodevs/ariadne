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

export type ProjectGraphRouting = {
  projectId: string;
  shardMode: FalkorShardMode;
  domainSegments: string[];
  graphNodeSoftLimit: number;
};

let client: Awaited<ReturnType<typeof FalkorDB.connect>> | null = null;

async function getClient() {
  if (!client) {
    const config = getFalkorConfig();
    client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
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
  return listGraphNamesForProjectRouting(
    projectId,
    mode === "domain" ? "domain" : "project",
    segments,
  );
}

/**
 * Itera todos los subgrafos candidatos (mono + dominios) hasta que fn devuelve true (early exit).
 */
export async function forEachProjectShardGraph(
  projectId: string,
  fn: (graph: ReturnType<Awaited<ReturnType<typeof getClient>>["selectGraph"]>) => Promise<boolean | void>,
): Promise<void> {
  const c = await getClient();
  if (!isProjectShardingEnabled()) {
    await fn(c.selectGraph(GRAPH_NAME));
    return;
  }
  const names = await getProjectShardGraphNames(projectId);
  for (const name of names) {
    const g = c.selectGraph(name);
    const stop = await fn(g);
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
