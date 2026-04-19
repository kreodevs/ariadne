/**
 * LLM en ingest (solo OpenAI y Kimi en código local). Mismas env homologadas que orchestrator.
 * @see services/orchestrator/src/llm/llm-unified.ts
 */
export type IngestLlmId = 'openai' | 'kimi';

export function openAiApiKeyForLlm(): string | null {
  return process.env.LLM_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || null;
}

export function kimiApiKeyForLlm(): string | null {
  return (
    process.env.LLM_API_KEY?.trim() ||
    process.env.MOONSHOT_API_KEY?.trim() ||
    process.env.KIMI_API_KEY?.trim() ||
    null
  );
}

function openAiKeyOnly(): string | null {
  return process.env.OPENAI_API_KEY?.trim() || null;
}
function kimiKeyOnly(): string | null {
  return process.env.MOONSHOT_API_KEY?.trim() || process.env.KIMI_API_KEY?.trim() || null;
}

export function resolveIngestLlmProvider(): IngestLlmId {
  const raw =
    process.env.LLM_PROVIDER?.trim().toLowerCase() ||
    process.env.INGEST_LLM_PROVIDER?.trim().toLowerCase() ||
    '';
  if (raw === 'kimi' || raw === 'moonshot') return 'kimi';
  if (raw === 'openai') return 'openai';
  const o = openAiKeyOnly();
  const k = kimiKeyOnly();
  const u = process.env.LLM_API_KEY?.trim();
  if (o && !k) return 'openai';
  if (!o && k) return 'kimi';
  if (u && !o && !k) return 'openai';
  return 'openai';
}

export function resolveIngestLlmModel(provider: IngestLlmId): string {
  const unified = process.env.LLM_MODEL?.trim();
  if (unified) return unified;
  if (provider === 'kimi') {
    return process.env.KIMI_LLM_MODEL?.trim() || process.env.MOONSHOT_MODEL?.trim() || 'kimi-k2.5';
  }
  return process.env.CHAT_MODEL?.trim() || 'gpt-4o-mini';
}

export function hasIngestLlmCredentials(provider: IngestLlmId): boolean {
  if (provider === 'kimi') return !!kimiApiKeyForLlm();
  return !!openAiApiKeyForLlm();
}
