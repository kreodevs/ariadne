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
  BLOCKED_CYPHER_CLAUSES,
  CypherGuardError,
  appendLimitIfMissing,
  guardCypherQuery,
  injectProjectScope,
  queryHasLimit,
  queryReferencesProjectId,
  validateReadOnlyCypher,
  type BlockedCypherClause,
  type CypherGuardResult,
  type GuardCypherOptions,
} from './cypher-guard.js';
export {
  buildDetectChangesResult,
  classifySymbolImpact,
  gitDiffCommand,
  parseChangedFilesFromDiff,
  parseDiffMode,
  parseDiffSymbols,
  type DetectChangesResult,
  type DetectChangesSummary,
  type DiffMode,
  type ParsedDiffSymbols,
  type SymbolChangeKind,
  type SymbolImpactRow,
} from './diff-impact.js';
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
  isFalkorDebugCypherEnabled,
  setFalkorRuntimeOverrides,
  effectiveShardMode,
  domainSegmentFromRepoPath,
  listGraphNamesForProjectRouting,
  type FalkorConfig,
  type FalkorRuntimeOverrides,
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
export { createLogger, extractRequestId } from './logger.js';
export type { Logger } from 'pino';
export type { ChatIntent, ChatIntentRouteResult } from './chat-intent.types.js';
export { CHAT_INTENTS } from './chat-intent.types.js';
export {
  SCHEMA_MODEL_SOURCES,
  wantsArchitectureDomainQuestion,
  wantsReengineeringQuestion,
  wantsSchemaDatabaseQuestion,
} from './chat-schema-question.util.js';
export {
  parseIntegrationHandoffMessage,
  wantsIntegrationHandoffQuestion,
  type IntegrationHandoffDetectOptions,
  type ParsedIntegrationHandoff,
} from './integration-handoff-message.util.js';
export {
  buildIntegrationHandoffSearchQueries,
  integrationHandoffComponentTerms,
  integrationHandoffPathPatternTerms,
  mergeIntegrationHandoffFileCandidates,
  scoreIntegrationHandoffFile,
} from './integration-handoff-plan.util.js';
export {
  LlmContextLengthError,
  buildLlmContextLengthMessage,
  extractOpenRouterProviderMessage,
  isContextLengthProviderMessage,
  isLlmContextLengthError,
  mapOpenRouterHttpError,
  parseContextLengthFromMessage,
} from './llm-openrouter-error.util.js';
export type {
  C4Level,
  C4ElementKind,
  C4EvidenceSource,
  C4StackRole,
  C4Evidence,
  C4Element,
  C4Relationship,
  C4Model,
} from './c4/c4-model.types.js';
export { hashC4ModelPayload } from './c4/content-hash.js';
export {
  infrastructureSpecToC4Model,
  mergeC4ContainerModels,
  type C4ContainerKind,
  type C4ContainerSpec,
  type C4CommunicationSpec,
  type C4InfrastructureSpec,
} from './c4/from-infrastructure.js';
export {
  domainContextSpecToC4Model,
  type C4ContextSpec,
  type C4ContextDomainRef,
  type C4ContextRepoRef,
  type C4ContextDependency,
  type C4ContextVisibilityEdge,
} from './c4/from-domains.js';
export {
  falkorSubgraphToC4ComponentModel,
  type C4ComponentGraphNode,
  type C4ComponentGraphEdge,
  type C4ComponentBuildInput,
} from './c4/from-falkor.components.js';
export {
  diffC4Models,
  type C4ModelDiff,
  type C4ElementDiff,
  type C4RelationshipDiff,
} from './c4/c4-model.diff.js';
export {
  apiFlowToArchifySequence,
  type ApiFlowSpec,
  type ApiFlowStep,
  type ArchifySequenceIr,
} from './c4/to-archify-sequence.js';
export {
  buildApiFlowSteps,
  buildDbQueryLabel,
  formatHttpResponseLabel,
  inferHttpStatusCode,
  type ApiFlowStepInput,
} from './c4/build-api-flow-steps.js';
export {
  buildDefaultSyncWorkflowSpec,
  syncWorkflowToArchifyWorkflow,
  type ArchifyWorkflowIr,
  type SyncWorkflowSpec,
} from './c4/to-archify-workflow.js';
export { buildRouteFlowWorkflowSpec } from './c4/build-route-flow-workflow.js';
export {
  buildEnumStatusWorkflowSpec,
  buildJourneyWorkflowSpec,
  buildServiceChainWorkflowSpec,
  indexedFlowPayloadToWorkflowSpec,
} from './c4/build-indexed-flow-workflow.js';
export {
  type C4WorkflowTargetKind,
  type C4WorkflowTargetOption,
  type IndexedFlowPayload,
} from './c4/workflow-targets.types.js';
export {
  buildApiRequestLifecycleSpec,
  buildSyncJobLifecycleSpec,
  entityLifecycleToArchifyLifecycle,
  type ArchifyLifecycleIr,
  type EntityLifecycleSpec,
} from './c4/to-archify-lifecycle.js';
export { buildC4MarkdownBundle, type C4MarkdownFile } from './c4/c4-markdown-export.js';
export { wantsArchitectureDiagramQuestion } from './c4/chat-architecture-diagram.util.js';
export {
  c4ModelToArchifyArchitecture,
  type ArchifyArchitectureIr,
  type ArchifyComponentType,
} from './c4/to-archify.mapper.js';
export {
  sanitizeArchifyArchitectureIr,
  sanitizeArchifySequenceIr,
} from './c4/archify-ir-sanitize.js';
export {
  ARCHIFY_WIRE_PROTOCOL,
  formatHttpCallLabel,
  inferMonorepoSegmentLabel,
  isArchifyWireProtocol,
} from './c4/api-flow-labels.util.js';
export type { C4SequenceRouteOption } from './c4/c4-sequence.types.js';
