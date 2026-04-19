/**
 * Chat completions (OpenAI o Kimi/Moonshot, API compatible).
 */
import { Injectable } from '@nestjs/common';
import { ingestChatLlmModel, resolveIngestChatLlmProvider } from './chat-llm-config';
import { kimiIngestCallLlm, kimiIngestCallLlmWithTools } from './kimi-chat.adapter';

@Injectable()
export class ChatLlmService {
  async callLlm(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    maxTokens = 1024,
  ): Promise<string> {
    const p = resolveIngestChatLlmProvider();
    if (p === 'kimi') return kimiIngestCallLlm(messages, maxTokens);

    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      throw new Error('OPENAI_API_KEY no configurada. Necesaria para chat.');
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: ingestChatLlmModel(),
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
      | {
          role: 'assistant';
          content?: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        }
      | { role: 'tool'; tool_call_id: string; content: string }
    >,
    tools: unknown[],
    maxTokens = 1536,
  ): Promise<{
    content?: string;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  }> {
    const p = resolveIngestChatLlmProvider();
    if (p === 'kimi') return kimiIngestCallLlmWithTools(messages, tools, maxTokens);

    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new Error('OPENAI_API_KEY no configurada.');

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: ingestChatLlmModel(),
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
