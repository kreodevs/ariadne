/**
 * LLM vía LLM_PROVIDER env (openrouter por defecto). Variables: LLM_API_KEY, LLM_CHAT_MODEL, LLM_MODEL, etc.
 * @see llm-config.ts
 */
import { LLM_DEFAULT_CHAT_MODEL, resolveLlmApiKey } from './llm-config';

export type UnifiedLlmProvider = string;

export function resolveLlmProvider(): UnifiedLlmProvider {
  return process.env.LLM_PROVIDER?.trim() || 'openrouter';
}

export function resolveLlmModel(_provider: UnifiedLlmProvider): string {
  return (
    process.env.ORCHESTRATOR_LLM_MODEL?.trim() ||
    process.env.LLM_MODEL?.trim() ||
    process.env.LLM_CHAT_MODEL?.trim() ||
    process.env.CHAT_MODEL?.trim() ||
    LLM_DEFAULT_CHAT_MODEL
  );
}

export function hasLlmCredentials(_provider: UnifiedLlmProvider): boolean {
  return Boolean(resolveLlmApiKey());
}

/** @deprecated Claves directas a proveedores eliminadas; usar resolveLlmApiKey en llm-config. */
export function openAiApiKeyForLlm(): string | null {
  const k = resolveLlmApiKey();
  return k || null;
}
