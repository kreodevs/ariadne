/**
 * ariadne-common: tipos y utilidades compartidas para FalkorDB/Cypher (ingest, cartographer, MCP).
 */

export { escapeCypherString, cypherSafe } from './cypher.js';
export {
  GRAPH_NAME,
  SHADOW_GRAPH_NAME,
  getFalkorConfig,
  graphNameForProject,
  isProjectShardingEnabled,
  externalGraphName,
  isExternalGraphRoutingEnabled,
  type FalkorConfig,
} from './falkor.js';
export {
  type ResolvedCallInfo,
  type ParsedFileMinimal,
  type ImportInfoMinimal,
  type UnresolvedCallMinimal,
} from './graph-types.js';
export {
  buildExportsMap,
  resolveCrossFileCalls,
  runCypherBatch,
  type GraphClient,
} from './graph-utils.js';
