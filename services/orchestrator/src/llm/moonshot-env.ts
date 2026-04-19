import { kimiApiKeyForLlm } from './llm-unified';

/** Kimi Open Platform — misma convención que ingest. */
export function moonshotBaseUrl(): string {
  return (process.env.MOONSHOT_BASE_URL?.trim() || 'https://api.moonshot.ai/v1').replace(/\/$/, '');
}

export function moonshotApiKey(): string | null {
  return kimiApiKeyForLlm();
}

/**
 * Kimi: muchos modelos solo admiten `temperature: 1`. Si no defines env, usamos 1.
 * `LLM_TEMPERATURE` / `KIMI_TEMPERATURE` (legacy) sobrescribe (p. ej. 0.1 si tu modelo lo permite).
 */
export function llmChatTemperature(_opts?: { workflowSimple?: boolean }): number {
  const raw = process.env.LLM_TEMPERATURE?.trim() || process.env.KIMI_TEMPERATURE?.trim();
  if (raw !== undefined && raw !== '') {
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 2) return n;
  }
  return 1;
}
