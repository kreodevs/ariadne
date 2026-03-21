/**
 * @fileoverview Cliente FalkorDB para MCP FalkorSpecs. Conexión y selección de grafo.
 */
import { FalkorDB } from "falkordb";
import { GRAPH_NAME, getFalkorConfig } from "ariadne-common";

export { GRAPH_NAME, getFalkorConfig };
export type { FalkorConfig } from "ariadne-common";

let client: Awaited<ReturnType<typeof FalkorDB.connect>> | null = null;

/** Devuelve el grafo FalkorDB (conexión singleton). */
export async function getGraph() {
  if (!client) {
    const config = getFalkorConfig();
    client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
  }
  return client.selectGraph(GRAPH_NAME);
}

/** Cierra la conexión FalkorDB. */
export async function closeFalkor() {
  if (client) {
    await client.close();
    client = null;
  }
}
