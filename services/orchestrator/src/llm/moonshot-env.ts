/** Kimi Open Platform — misma convención que ingest. */
export function moonshotBaseUrl(): string {
  return (process.env.MOONSHOT_BASE_URL?.trim() || 'https://api.moonshot.ai/v1').replace(/\/$/, '');
}

export function moonshotApiKey(): string | null {
  const k = process.env.MOONSHOT_API_KEY?.trim() || process.env.KIMI_API_KEY?.trim();
  return k || null;
}
