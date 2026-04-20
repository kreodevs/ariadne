import { resolveOrchestratorLlmProvider } from './orchestrator-llm-config';
import {
  googleCallLlm,
  googleCallLlmWithTools,
  googleChatSimple,
} from './google-llm.adapter';
import {
  kimiCallLlm,
  kimiCallLlmWithTools,
  kimiChatSimple,
} from './kimi-llm.adapter';
import { withLlmRequestThrottle } from './llm-request-throttle';
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
  return withLlmRequestThrottle(() => {
    const p = resolveOrchestratorLlmProvider();
    if (p === 'google') return googleCallLlm(messages, maxTokens);
    if (p === 'kimi') return kimiCallLlm(messages, maxTokens);
    return openaiCallLlm(messages, maxTokens);
  });
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
  return withLlmRequestThrottle(() => {
    const p = resolveOrchestratorLlmProvider();
    if (p === 'google') return googleCallLlmWithTools(messages, tools, maxTokens);
    if (p === 'kimi') return kimiCallLlmWithTools(messages, tools, maxTokens);
    return openaiCallLlmWithTools(messages, tools, maxTokens);
  });
}

/** System + user (workflow SDD: revisión de código, tests). */
export async function orchestratorChatSimple(system: string, user: string): Promise<string> {
  return withLlmRequestThrottle(() => {
    const p = resolveOrchestratorLlmProvider();
    if (p === 'google') return googleChatSimple(system, user);
    if (p === 'kimi') return kimiChatSimple(system, user);
    return openaiChatSimple(system, user);
  });
}
