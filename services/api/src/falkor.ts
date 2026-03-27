/**
 * @fileoverview Cliente FalkorDB (rutas Express legacy). Nest usa FalkorService.
 */
import { FalkorDB } from "falkordb";
import {
  SHADOW_GRAPH_NAME,
  graphNameForProject,
  shadowGraphNameForSession,
} from "ariadne-common";

export { GRAPH_NAME, SHADOW_GRAPH_NAME } from "ariadne-common";

let client: Awaited<ReturnType<typeof FalkorDB.connect>> | null = null;

function getConfig() {
  return {
    host: process.env.FALKORDB_HOST ?? "localhost",
    port: parseInt(process.env.FALKORDB_PORT ?? "6379", 10),
  };
}

/** Grafo principal; con sharding indicar projectId (UUID índice). */
export async function getGraph(projectId?: string | null) {
  if (!client) {
    const config = getConfig();
    client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
  }
  return client.selectGraph(graphNameForProject(projectId ?? undefined));
}

export async function getShadowGraph(shadowSessionId?: string | null) {
  if (!client) {
    const config = getConfig();
    client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
  }
  const name =
    shadowSessionId && String(shadowSessionId).trim()
      ? shadowGraphNameForSession(String(shadowSessionId).trim())
      : SHADOW_GRAPH_NAME;
  return client.selectGraph(name);
}

export async function closeFalkor() {
  if (client) {
    await client.close();
    client = null;
  }
}
