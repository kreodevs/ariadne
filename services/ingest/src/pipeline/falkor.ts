/**
 * @fileoverview Configuración de FalkorDB (host, port) y nombres de grafos.
 * Re-exporta desde ariadne-common; solo SHADOW_GRAPH_NAME es propio de ingest.
 */
export { GRAPH_NAME, getFalkorConfig, type FalkorConfig } from 'ariadne-common';

/** Nombre del grafo shadow (compare SDD). */
export const SHADOW_GRAPH_NAME = 'FalkorSpecsShadow';
