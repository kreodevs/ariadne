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

/**
 * TPM que este proceso intenta no superar en ventana 60s (estimado).
 * Default bajo (~22k) para varias réplicas contra límite típico ~64k proyecto.
 * Un solo pod: sube a ~55000. `0` desactiva la ventana TPM en el throttle.
 */
export function kimiTpmProcessBudget(): number {
  const raw = process.env.LLM_KIMI_TPM_BUDGET?.trim();
  if (raw === '0' || raw?.toLowerCase() === 'false' || raw?.toLowerCase() === 'off') return 0;
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n > 500) return Math.min(n, 2_000_000);
  return 22_000;
}

/** Igual que `kimi-llm.adapter` al armar `max_tokens` (para estimar TPM). */
export function kimiEffectiveMaxOutputTokens(requestedMax: number): number {
  const floorRaw = process.env.LLM_KIMI_MIN_MAX_TOKENS?.trim();
  let effectiveMax = requestedMax;
  if (floorRaw) {
    const floor = parseInt(floorRaw, 10);
    if (Number.isFinite(floor) && floor > 0) effectiveMax = Math.max(requestedMax, floor);
  }
  return effectiveMax;
}
