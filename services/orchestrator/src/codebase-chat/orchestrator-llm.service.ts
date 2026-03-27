/**
 * LLM OpenAI para ask_codebase (retriever con tools + sintetizador).
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class OrchestratorLlmService {
  async callLlm(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    maxTokens = 1024,
  ): Promise<string> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      throw new Error('OPENAI_API_KEY no configurada. Necesaria para ask_codebase en orchestrator.');
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.CHAT_MODEL ?? process.env.ORCHESTRATOR_LLM_MODEL ?? 'gpt-4o-mini',
        messages,
        temperature: 0.1,
        max_tokens: maxTokens,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API ${res.status}: ${err}`);
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim();
    return content ?? '';
  }

  async callLlmWithTools(
    messages: Array<
      | { role: 'user' | 'system'; content: string }
      | { role: 'assistant'; content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }
      | { role: 'tool'; tool_call_id: string; content: string }
    >,
    tools: unknown[],
    maxTokens = 1536,
  ): Promise<{
    content?: string;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  }> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new Error('OPENAI_API_KEY no configurada.');

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.CHAT_MODEL ?? process.env.ORCHESTRATOR_LLM_MODEL ?? 'gpt-4o-mini',
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.1,
        max_tokens: maxTokens,
      }),
    });

    if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
    };
    const msg = data.choices?.[0]?.message;
    return {
      content: msg?.content?.trim() ?? undefined,
      tool_calls: msg?.tool_calls?.length ? msg.tool_calls : undefined,
    };
  }
}
