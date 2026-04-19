/** Kimi Open Platform — misma convención que ingest. */
export function moonshotBaseUrl(): string {
  return (process.env.MOONSHOT_BASE_URL?.trim() || 'https://api.moonshot.ai/v1').replace(/\/$/, '');
}

export function moonshotApiKey(): string | null {
  const k = process.env.MOONSHOT_API_KEY?.trim() || process.env.KIMI_API_KEY?.trim();
  return k || null;
}

/**
 * Varios modelos Kimi (p. ej. *thinking*) solo admiten `temperature: 1`.
 * `KIMI_TEMPERATURE` fuerza el valor (0–2) para todos los requests.
 */
export function kimiChatTemperature(model: string, opts?: { workflowSimple?: boolean }): number {
  const raw = process.env.KIMI_TEMPERATURE?.trim();
  if (raw !== undefined && raw !== '') {
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 2) return n;
  }
  if (/thinking/i.test(model)) return 1;
  return opts?.workflowSimple ? 0.2 : 0.1;
}
