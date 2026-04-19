import { moonshotApiKey } from '../moonshot/moonshot-env';

/** Chat NL en ingest: OpenAI directo o Kimi (Moonshot, compatible OpenAI). */
export type IngestChatLlmProvider = 'openai' | 'kimi';

export function resolveIngestChatLlmProvider(): IngestChatLlmProvider {
  const raw = process.env.INGEST_LLM_PROVIDER?.trim().toLowerCase();
  if (raw === 'kimi' || raw === 'moonshot') return 'kimi';
  if (raw === 'openai') return 'openai';
  const hasOpenAi = !!process.env.OPENAI_API_KEY?.trim();
  const hasKimi = !!moonshotApiKey();
  if (!hasOpenAi && hasKimi) return 'kimi';
  return 'openai';
}

export function ingestChatLlmModel(): string {
  if (resolveIngestChatLlmProvider() === 'kimi') {
    return (
      process.env.KIMI_LLM_MODEL?.trim() ||
      process.env.MOONSHOT_MODEL?.trim() ||
      process.env.CHAT_MODEL?.trim() ||
      'kimi-k2.5'
    );
  }
  return process.env.CHAT_MODEL?.trim() || 'gpt-4o-mini';
}

export function hasIngestLlmConfigured(): boolean {
  const p = resolveIngestChatLlmProvider();
  if (p === 'kimi') return !!moonshotApiKey();
  return !!process.env.OPENAI_API_KEY?.trim();
}
