/**
 * LLM (OpenRouter compatible) — misma convención que The Forge.
 */

export const LLM_DEFAULT_BASE = 'https://openrouter.ai/api/v1';
export const LLM_DEFAULT_CHAT_MODEL = 'google/gemini-2.0-flash-001';
export const LLM_DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';

export function resolveLlmApiKey(): string {
  return process.env.LLM_API_KEY?.trim() ?? '';
}

export function resolveLlmBaseUrl(): string {
  return process.env.LLM_BASE_URL?.trim() || LLM_DEFAULT_BASE;
}

export function llmDefaultHeaders(): Record<string, string> | undefined {
  const referer = process.env.LLM_HTTP_REFERER?.trim();
  const title = process.env.LLM_APP_TITLE?.trim();
  if (!referer && !title) return undefined;
  return {
    ...(referer ? { 'HTTP-Referer': referer } : {}),
    ...(title ? { 'X-OpenRouter-Title': title } : {}),
  };
}

export function resolveLlmChatModel(): string {
  return (
    process.env.LLM_MODEL_INGEST?.trim() ||
    process.env.LLM_MODEL?.trim() ||
    process.env.LLM_CHAT_MODEL?.trim() ||
    LLM_DEFAULT_CHAT_MODEL
  );
}

export function resolveLlmEmbeddingModel(): string {
  return process.env.LLM_EMBEDDING_MODEL?.trim() || LLM_DEFAULT_EMBEDDING_MODEL;
}

export function defaultEmbeddingDimension(): number {
  const raw = process.env.LLM_EMBEDDING_DIM?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 1) return n;
  return 1536;
}
