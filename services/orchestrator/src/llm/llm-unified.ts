/**
 * LLM vía LLM_PROVIDER env (openrouter por defecto). Variables: OPENROUTER_API_KEY, OPENROUTER_CHAT_MODEL, LLM_MODEL, etc.
 * @see llm-config.ts
 */
import { OPENROUTER_DEFAULT_CHAT_MODEL, resolveOpenRouterApiKey } from './llm-config';

export type UnifiedLlmProvider = string;

export function resolveLlmProvider(): UnifiedLlmProvider {
  return process.env.LLM_PROVIDER?.trim() || 'openrouter';
}

export function resolveLlmModel(_provider: UnifiedLlmProvider): string {
  return (
    process.env.ORCHESTRATOR_LLM_MODEL?.trim() ||
    process.env.LLM_MODEL?.trim() ||
    process.env.OPENROUTER_CHAT_MODEL?.trim() ||
    process.env.CHAT_MODEL?.trim() ||
    OPENROUTER_DEFAULT_CHAT_MODEL
  );
}

export function hasLlmCredentials(_provider: UnifiedLlmProvider): boolean {
  return Boolean(resolveOpenRouterApiKey());
}

/** @deprecated Claves directas a proveedores eliminadas; usar resolveOpenRouterApiKey en llm-config. */
export function openAiApiKeyForLlm(): string | null {
  const k = resolveOpenRouterApiKey();
  return k || null;
}
