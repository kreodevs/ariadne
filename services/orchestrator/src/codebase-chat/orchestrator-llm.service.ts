/**
 * LLM del orchestrator (OpenAI o Google Gemini) — ask_codebase y síntesis.
 */
import { Injectable } from '@nestjs/common';
import {
  callOrchestratorLlm,
  callOrchestratorLlmWithTools,
  type OpenAiStyleMessage,
} from '../llm/orchestrator-llm.facade';

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
    maxTokens = 1536,
  ): Promise<{
    content?: string;
    reasoning_content?: string | null;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  }> {
    return callOrchestratorLlmWithTools(messages, tools, maxTokens);
  }
}
