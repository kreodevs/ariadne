import { resolveOrchestratorLlmProvider } from './orchestrator-llm-config';
import {
  googleCallLlm,
  googleCallLlmWithTools,
  googleChatSimple,
} from './google-llm.adapter';
import {
  openaiCallLlm,
  openaiCallLlmWithTools,
  openaiChatSimple,
  type OpenAiStyleMessage,
} from './openai-llm.adapter';

export type { OpenAiStyleMessage };

export async function callOrchestratorLlm(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  maxTokens: number,
): Promise<string> {
  const p = resolveOrchestratorLlmProvider();
  if (p === 'google') return googleCallLlm(messages, maxTokens);
  return openaiCallLlm(messages, maxTokens);
}

export async function callOrchestratorLlmWithTools(
  messages: OpenAiStyleMessage[],
  tools: unknown[],
  maxTokens: number,
): Promise<{
  content?: string;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
}> {
  const p = resolveOrchestratorLlmProvider();
  if (p === 'google') return googleCallLlmWithTools(messages, tools, maxTokens);
  return openaiCallLlmWithTools(messages, tools, maxTokens);
}

/** System + user (workflow SDD: revisión de código, tests). */
export async function orchestratorChatSimple(system: string, user: string): Promise<string> {
  const p = resolveOrchestratorLlmProvider();
  if (p === 'google') return googleChatSimple(system, user);
  return openaiChatSimple(system, user);
}
