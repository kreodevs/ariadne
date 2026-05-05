/**
 * LLM (OpenRouter compatible). Alineado con ingest: `llm-config.ts` allí.
 */

export const LLM_DEFAULT_BASE = 'https://openrouter.ai/api/v1';
export const LLM_DEFAULT_CHAT_MODEL = 'google/gemini-2.0-flash-001';

/**
 * Clave LLM. Lee solo LLM_API_KEY.
 */
export function resolveLlmApiKey(): string {
  return process.env.LLM_API_KEY?.trim() ?? '';
}

export function resolveLlmBaseUrl(): string {
  return process.env.LLM_BASE_URL?.trim() || LLM_DEFAULT_BASE;
}

/** Cabeceras opcionales requeridas por OpenRouter en algunos despliegues. */
export function llmDefaultHeaders(): Record<string, string> | undefined {
  const referer = process.env.LLM_HTTP_REFERER?.trim();
  const title = process.env.LLM_APP_TITLE?.trim();
  if (!referer && !title) return undefined;
  return {
    ...(referer ? { 'HTTP-Referer': referer } : {}),
    ...(title ? { 'X-OpenRouter-Title': title } : {}),
  };
}
