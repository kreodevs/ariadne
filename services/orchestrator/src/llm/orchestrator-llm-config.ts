/**
 * Proveedor LLM del orchestrator: OpenAI o Google (Gemini), desacoplado de cada adaptador.
 */
export type OrchestratorLlmProvider = 'openai' | 'google';

export function resolveOrchestratorLlmProvider(): OrchestratorLlmProvider {
  const raw = process.env.ORCHESTRATOR_LLM_PROVIDER?.trim().toLowerCase();
  if (raw === 'google' || raw === 'gemini') return 'google';
  if (raw === 'openai') return 'openai';
  // Sin ORCHESTRATOR_LLM_PROVIDER: si solo hay key de Google, usar Google (ingest suele traer GOOGLE_API_KEY).
  const hasOpenAi = !!process.env.OPENAI_API_KEY?.trim();
  const hasGoogle = !!process.env.GOOGLE_API_KEY?.trim();
  if (!hasOpenAi && hasGoogle) return 'google';
  return 'openai';
}

export function orchestratorLlmModel(): string {
  const p = resolveOrchestratorLlmProvider();
  if (p === 'google') {
    return (
      process.env.GOOGLE_LLM_MODEL?.trim() ||
      process.env.ORCHESTRATOR_LLM_MODEL?.trim() ||
      process.env.CHAT_MODEL?.trim() ||
      'gemini-2.0-flash'
    );
  }
  return (
    process.env.ORCHESTRATOR_LLM_MODEL?.trim() ||
    process.env.CHAT_MODEL?.trim() ||
    'gpt-4o-mini'
  );
}

/** Hay credenciales para el proveedor resuelto. */
export function hasOrchestratorLlmConfigured(): boolean {
  const p = resolveOrchestratorLlmProvider();
  if (p === 'google') return !!process.env.GOOGLE_API_KEY?.trim();
  return !!process.env.OPENAI_API_KEY?.trim();
}
