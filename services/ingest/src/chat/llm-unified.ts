/**
 * Ingest: LLM vía LLM_PROVIDER env (openrouter por defecto).
 * @see ../llm/llm-config.ts
 */
import { resolveOpenRouterApiKey, resolveOpenRouterChatModel, OPENROUTER_DEFAULT_CHAT_MODEL } from '../llm/llm-config';

export type IngestLlmId = string;

export function resolveIngestLlmProvider(): IngestLlmId {
  return process.env.LLM_PROVIDER?.trim() || 'openrouter';
}

export function resolveIngestLlmModel(_provider: IngestLlmId): string {
  return resolveOpenRouterChatModel() || OPENROUTER_DEFAULT_CHAT_MODEL;
}

export function hasIngestLlmCredentials(_provider: IngestLlmId): boolean {
  return Boolean(resolveOpenRouterApiKey());
}

/** @deprecated Usar resolveOpenRouterApiKey en llm-config. */
export function openAiApiKeyForLlm(): string | null {
  const k = resolveOpenRouterApiKey();
  return k || null;
}
