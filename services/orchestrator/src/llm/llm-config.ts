/**
 * LLM vía OpenRouter (API compatible OpenAI). Alineado con The Forge: `llm-config.ts` allí.
 */

export const OPENROUTER_DEFAULT_BASE = 'https://openrouter.ai/api/v1';
export const OPENROUTER_DEFAULT_CHAT_MODEL = 'nousresearch/hermes-3-llama-3.1-405b';

/**
 * Clave LLM. Lee solo LLM_API_KEY.
 */
export function resolveLlmApiKey(): string {
  return process.env.LLM_API_KEY?.trim() ?? '';
}

export function resolveOpenRouterBaseUrl(): string {
  return process.env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_DEFAULT_BASE;
}

/** Cabeceras opcionales requeridas por OpenRouter en algunos despliegues. */
export function openRouterDefaultHeaders(): Record<string, string> | undefined {
  const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
  const title = process.env.OPENROUTER_APP_TITLE?.trim();
  if (!referer && !title) return undefined;
  return {
    ...(referer ? { 'HTTP-Referer': referer } : {}),
    ...(title ? { 'X-OpenRouter-Title': title } : {}),
  };
}
