/**
 * Re-exporta configuración FalkorDB desde ariadne-common (incl. sharding).
 */
export {
  GRAPH_NAME,
  SHADOW_GRAPH_NAME,
  getFalkorConfig,
  graphNameForProject,
  isProjectShardingEnabled,
  externalGraphName,
  isExternalGraphRoutingEnabled,
  type FalkorConfig,
} from 'ariadne-common';
