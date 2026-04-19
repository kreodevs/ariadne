import { kimiApiKeyForLlm } from './llm-unified';

/** Kimi Open Platform — misma convención que ingest. */
export function moonshotBaseUrl(): string {
  return (process.env.MOONSHOT_BASE_URL?.trim() || 'https://api.moonshot.ai/v1').replace(/\/$/, '');
}

export function moonshotApiKey(): string | null {
  return kimiApiKeyForLlm();
}

/**
 * `LLM_TEMPERATURE` o `KIMI_TEMPERATURE` (legacy); si no, 0.1 o 0.2 en workflow SDD.
 */
export function llmChatTemperature(opts?: { workflowSimple?: boolean }): number {
  const raw = process.env.LLM_TEMPERATURE?.trim() || process.env.KIMI_TEMPERATURE?.trim();
  if (raw !== undefined && raw !== '') {
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 2) return n;
  }
  return opts?.workflowSimple ? 0.2 : 0.1;
}
