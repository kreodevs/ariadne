/**
 * @fileoverview Cliente FalkorDB para MCP. Sharding: getGraph(projectId).
 */
import { FalkorDB } from "falkordb";
import { GRAPH_NAME, getFalkorConfig, graphNameForProject } from "ariadne-common";

export { GRAPH_NAME, getFalkorConfig };
export type { FalkorConfig } from "ariadne-common";

let client: Awaited<ReturnType<typeof FalkorDB.connect>> | null = null;

/** Grafo Ariadne; con FALKOR_SHARD_BY_PROJECT usar el projectId del índice. */
export async function getGraph(projectId?: string | null) {
  if (!client) {
    const config = getFalkorConfig();
    client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
  }
  return client.selectGraph(graphNameForProject(projectId ?? undefined));
}

export async function closeFalkor() {
  if (client) {
    await client.close();
    client = null;
  }
}
