/**
 * Proveedor LLM del orchestrator — delega en llm-unified (LLM_* + legacy).
 */
import {
  hasLlmCredentials,
  resolveLlmModel,
  resolveLlmProvider,
  type UnifiedLlmProvider,
} from './llm-unified';

export type OrchestratorLlmProvider = UnifiedLlmProvider;

export function resolveOrchestratorLlmProvider(): OrchestratorLlmProvider {
  return resolveLlmProvider();
}

export function orchestratorLlmModel(): string {
  return resolveLlmModel(resolveLlmProvider());
}

export function hasOrchestratorLlmConfigured(): boolean {
  return hasLlmCredentials(resolveLlmProvider());
}
