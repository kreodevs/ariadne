/**
 * Normaliza salidas de LLM que envuelven el documento markdown en una sola fence.
 */
export function stripOuterMarkdownFence(text: string): string {
  if (typeof text !== 'string') return text;
  const t = text.trim();
  const withLang = t.match(/^```(?:markdown|md)\s*\r?\n([\s\S]*)\r?\n```\s*$/i);
  if (withLang) return withLang[1].trim();
  const plain = t.match(/^```\s*\r?\n([\s\S]*)\r?\n```\s*$/);
  if (plain) return plain[1].trim();
  return text;
}
