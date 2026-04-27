import {
  openaiCallLlm,
  openaiCallLlmWithTools,
  openaiChatSimple,
  type OpenAiStyleMessage,
} from './openai-llm.adapter';
import { withLlmRequestThrottle } from './llm-request-throttle';

export type { OpenAiStyleMessage };

export async function callOrchestratorLlm(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  maxTokens: number,
): Promise<string> {
  return withLlmRequestThrottle(() => openaiCallLlm(messages, maxTokens));
}

export async function callOrchestratorLlmWithTools(
  messages: OpenAiStyleMessage[],
  tools: unknown[],
  maxTokens: number,
): Promise<{
  content?: string;
  reasoning_content?: string | null;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
}> {
  return withLlmRequestThrottle(() => openaiCallLlmWithTools(messages, tools, maxTokens));
}

/** System + user (workflow SDD: revisión de código, tests). */
export async function orchestratorChatSimple(system: string, user: string): Promise<string> {
  return withLlmRequestThrottle(() => openaiChatSimple(system, user));
}
