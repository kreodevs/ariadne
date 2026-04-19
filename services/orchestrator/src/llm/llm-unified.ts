/**
 * Variables homologadas: LLM_PROVIDER, LLM_MODEL, LLM_API_KEY, LLM_TEMPERATURE.
 * Compatibilidad: ORCHESTRATOR_LLM_PROVIDER, OPENAI_API_KEY, GOOGLE_API_KEY, MOONSHOT_API_KEY, CHAT_MODEL, etc.
 */
export type UnifiedLlmProvider = 'openai' | 'google' | 'kimi';

/** Key efectiva para llamar a OpenAI (unificada o legada). */
export function openAiApiKeyForLlm(): string | null {
  return process.env.LLM_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || null;
}

export function googleApiKeyForLlm(): string | null {
  return (
    process.env.LLM_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    null
  );
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
function googleKeyOnly(): string | null {
  return process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || null;
}
function kimiKeyOnly(): string | null {
  return process.env.MOONSHOT_API_KEY?.trim() || process.env.KIMI_API_KEY?.trim() || null;
}

export function resolveLlmProvider(): UnifiedLlmProvider {
  const raw =
    process.env.LLM_PROVIDER?.trim().toLowerCase() ||
    process.env.ORCHESTRATOR_LLM_PROVIDER?.trim().toLowerCase() ||
    '';
  if (raw === 'kimi' || raw === 'moonshot') return 'kimi';
  if (raw === 'google' || raw === 'gemini') return 'google';
  if (raw === 'openai') return 'openai';
  const o = openAiKeyOnly();
  const g = googleKeyOnly();
  const k = kimiKeyOnly();
  const u = process.env.LLM_API_KEY?.trim();
  if (o && !g && !k) return 'openai';
  if (!o && g && !k) return 'google';
  if (!o && !g && k) return 'kimi';
  if (u && !o && !g && !k) return 'openai';
  return 'openai';
}

export function resolveLlmModel(provider: UnifiedLlmProvider): string {
  const unified = process.env.LLM_MODEL?.trim();
  if (unified) return unified;
  if (provider === 'google') {
    return process.env.GOOGLE_LLM_MODEL?.trim() || 'gemini-2.0-flash';
  }
  if (provider === 'kimi') {
    return process.env.KIMI_LLM_MODEL?.trim() || process.env.MOONSHOT_MODEL?.trim() || 'kimi-k2.5';
  }
  return (
    process.env.ORCHESTRATOR_LLM_MODEL?.trim() ||
    process.env.CHAT_MODEL?.trim() ||
    'gpt-4o-mini'
  );
}

export function hasLlmCredentials(provider: UnifiedLlmProvider): boolean {
  if (provider === 'google') return !!googleApiKeyForLlm();
  if (provider === 'kimi') return !!kimiApiKeyForLlm();
  return !!openAiApiKeyForLlm();
}
