/**
 * Kimi Open Platform (Moonshot): API compatible con OpenAI en ${base}/chat/completions y ${base}/embeddings.
 * @see https://platform.kimi.ai/docs/api/overview
 */
export function moonshotBaseUrl(): string {
  return (process.env.MOONSHOT_BASE_URL?.trim() || 'https://api.moonshot.ai/v1').replace(/\/$/, '');
}

export function moonshotApiKey(): string | null {
  const k = process.env.MOONSHOT_API_KEY?.trim() || process.env.KIMI_API_KEY?.trim();
  return k || null;
}
