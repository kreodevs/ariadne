/**
 * Re-exporta configuración FalkorDB desde ariadne-common (incl. sharding).
 */
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
} from 'ariadne-common';
