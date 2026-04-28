/**
 * @fileoverview Paquete **ariadne-common**: tipos y utilidades compartidas para FalkorDB, Cypher y rutas de grafo
 * usadas por **ingest**, pipelines históricos y **mcp-ariadne**. Punto único de verdad para nombres de grafo,
 * sharding por proyecto/dominio y helpers de batch Cypher.
 *
 * @module ariadne-common
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 */

export { escapeCypherString, cypherSafe } from './cypher.js';
export {
  GRAPH_NAME,
  SHADOW_GRAPH_NAME,
  shadowGraphNameForSession,
  getFalkorConfig,
  graphNameForProject,
  isProjectShardingEnabled,
  externalGraphName,
  isExternalGraphRoutingEnabled,
  getGraphNodeSoftLimit,
  isEnvDomainShardingEnabled,
  isAutoDomainOverflowEnabled,
  effectiveShardMode,
  domainSegmentFromRepoPath,
  listGraphNamesForProjectRouting,
  type FalkorConfig,
  type FalkorShardMode,
  type GraphNameForProjectOptions,
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
export {
  FALKOR_EMBEDDABLE_NODE_LABELS,
  FALKOR_DOCUMENTATION_DOC_LABELS,
  type FalkorEmbeddableLabel,
  type FalkorDocumentationDocLabel,
} from './graph-labels.js';
