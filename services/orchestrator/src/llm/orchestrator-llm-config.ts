/**
 * Proveedor LLM del orchestrator: OpenAI, Google (Gemini) o Kimi (Moonshot, API compatible OpenAI).
 */
import { moonshotApiKey } from './moonshot-env';

export type OrchestratorLlmProvider = 'openai' | 'google' | 'kimi';

export function resolveOrchestratorLlmProvider(): OrchestratorLlmProvider {
  const raw = process.env.ORCHESTRATOR_LLM_PROVIDER?.trim().toLowerCase();
  if (raw === 'google' || raw === 'gemini') return 'google';
  if (raw === 'kimi' || raw === 'moonshot') return 'kimi';
  if (raw === 'openai') return 'openai';
  const hasOpenAi = !!process.env.OPENAI_API_KEY?.trim();
  const hasGoogle = !!process.env.GOOGLE_API_KEY?.trim();
  const hasKimi = !!moonshotApiKey();
  if (!hasOpenAi && hasGoogle) return 'google';
  if (!hasOpenAi && !hasGoogle && hasKimi) return 'kimi';
  return 'openai';
}

export function orchestratorLlmModel(): string {
  const p = resolveOrchestratorLlmProvider();
  if (p === 'google') {
    // No usar CHAT_MODEL/ORCHESTRATOR_LLM_MODEL aquí: en Docker suelen ser gpt-4o-mini y Gemini no los acepta.
    return process.env.GOOGLE_LLM_MODEL?.trim() || 'gemini-2.0-flash';
  }
  if (p === 'kimi') {
    // Igual: compose pone CHAT_MODEL/ORCHESTRATOR_LLM_MODEL=gpt-4o-mini por defecto.
    return process.env.KIMI_LLM_MODEL?.trim() || process.env.MOONSHOT_MODEL?.trim() || 'kimi-k2.5';
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
  if (p === 'kimi') return !!moonshotApiKey();
  return !!process.env.OPENAI_API_KEY?.trim();
}
