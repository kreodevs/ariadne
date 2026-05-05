import {
  callLlm,
  callLlmWithTools,
  chatSimple,
  type LlmMessage,
} from './llm.adapter';
import { withLlmRequestThrottle } from './llm-request-throttle';

export type { LlmMessage };

export async function callOrchestratorLlm(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  maxTokens: number,
): Promise<string> {
  return withLlmRequestThrottle(() => callLlm(messages, maxTokens));
}

export async function callOrchestratorLlmWithTools(
  messages: LlmMessage[],
  tools: unknown[],
  maxTokens: number,
): Promise<{
  content?: string;
  reasoning_content?: string | null;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
}> {
  return withLlmRequestThrottle(() => callLlmWithTools(messages, tools, maxTokens));
}

/** System + user (workflow SDD: revisión de código, tests). */
export async function orchestratorChatSimple(system: string, user: string): Promise<string> {
  return withLlmRequestThrottle(() => chatSimple(system, user));
}
