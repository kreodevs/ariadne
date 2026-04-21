/**
 * LLM del orchestrator (OpenAI o Google Gemini) — ask_codebase y síntesis.
 */
import { Injectable } from '@nestjs/common';
import {
  callOrchestratorLlm,
  callOrchestratorLlmWithTools,
  type OpenAiStyleMessage,
} from '../llm/orchestrator-llm.facade';

function toolCallMaxTokensFromEnv(): number {
  const raw = process.env.CHAT_TOOL_CALL_MAX_TOKENS?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 1024) return Math.min(n, 32_000);
  return 8192;
}

@Injectable()
export class OrchestratorLlmService {
  async callLlm(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    maxTokens = 1024,
  ): Promise<string> {
    return callOrchestratorLlm(messages, maxTokens);
  }

  async callLlmWithTools(
    messages: OpenAiStyleMessage[],
    tools: unknown[],
    maxTokens = toolCallMaxTokensFromEnv(),
  ): Promise<{
    content?: string;
    reasoning_content?: string | null;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  }> {
    return callOrchestratorLlmWithTools(messages, tools, maxTokens);
  }
}
