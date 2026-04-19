/**
 * Kimi Open Platform (Moonshot): API compatible con OpenAI en ${base}/chat/completions y ${base}/embeddings.
 * @see https://platform.kimi.ai/docs/api/overview
 */
import { kimiApiKeyForLlm } from '../chat/llm-unified';

export function moonshotBaseUrl(): string {
  return (process.env.MOONSHOT_BASE_URL?.trim() || 'https://api.moonshot.ai/v1').replace(/\/$/, '');
}

export function moonshotApiKey(): string | null {
  return kimiApiKeyForLlm();
}

/**
 * Kimi: muchos modelos solo admiten `temperature: 1`. Override con `LLM_TEMPERATURE` / `KIMI_TEMPERATURE`.
 */
export function llmChatTemperature(_opts?: { workflowSimple?: boolean }): number {
  const raw = process.env.LLM_TEMPERATURE?.trim() || process.env.KIMI_TEMPERATURE?.trim();
  if (raw !== undefined && raw !== '') {
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 2) return n;
  }
  return 1;
}
