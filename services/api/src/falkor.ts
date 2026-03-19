/**
 * @fileoverview Cliente FalkorDB para la API. Conexión singleton al grafo principal y al grafo shadow.
 */
import { FalkorDB } from "falkordb";

/** Nombre del grafo principal (índice de repositorios). */
export const GRAPH_NAME = "FalkorSpecs";

/** Nombre del grafo shadow usado para comparar código propuesto (flujo SDD). */
export const SHADOW_GRAPH_NAME = "FalkorSpecsShadow";

/**
 * Obtiene la configuración de conexión desde variables de entorno.
 * @returns {{ host: string; port: number }} Host y puerto de FalkorDB.
 * @internal
 */
function getConfig() {
  return {
    host: process.env.FALKORDB_HOST ?? "localhost",
    port: parseInt(process.env.FALKORDB_PORT ?? "6379", 10),
  };
}

let client: Awaited<ReturnType<typeof FalkorDB.connect>> | null = null;

/**
 * Devuelve el grafo principal FalkorDB (conexión singleton).
 * @returns {Promise<Graph>} Instancia del grafo FalkorSpecs.
 */
export async function getGraph() {
  if (!client) {
    const config = getConfig();
    client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
  }
  return client.selectGraph(GRAPH_NAME);
}

/**
 * Devuelve el grafo shadow FalkorDB para comparación de código propuesto (conexión singleton).
 * @returns {Promise<Graph>} Instancia del grafo FalkorSpecsShadow.
 */
export async function getShadowGraph() {
  if (!client) {
    const config = getConfig();
    client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
  }
  return client.selectGraph(SHADOW_GRAPH_NAME);
}

/**
 * Cierra la conexión a FalkorDB y libera el cliente singleton.
 * @returns {Promise<void>}
 */
export async function closeFalkor() {
  if (client) {
    await client.close();
    client = null;
  }
}
