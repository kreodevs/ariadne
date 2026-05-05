/**
 * Chat completions vía OpenRouter (API compatible OpenAI).
 */
import { Injectable } from '@nestjs/common';
import { ingestChatLlmModel } from './chat-llm-config';
import {
  openRouterDefaultHeaders,
  resolveLlmApiKey,
  resolveOpenRouterBaseUrl,
} from '../llm/llm-config';

/** Límite de salida en fase retriever (tool_calls + argumentos JSON pueden ser largos). */
export function toolCallMaxTokensFromEnv(): number {
  const raw = process.env.CHAT_TOOL_CALL_MAX_TOKENS?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 1024) return Math.min(n, 32_000);
  return 8192;
}

function chatUrl(): string {
  return `${resolveOpenRouterBaseUrl().replace(/\/$/, '')}/chat/completions`;
}

function authHeaders(): Record<string, string> {
  const key = resolveLlmApiKey();
  if (!key) {
    throw new Error('LLM_API_KEY no configurada. Necesaria para chat.');
  }
  const extra = openRouterDefaultHeaders();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    ...extra,
  };
}

@Injectable()
export class ChatLlmService {
  async callLlm(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    maxTokens = 1024,
  ): Promise<string> {
    const res = await fetch(chatUrl(), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        model: ingestChatLlmModel(),
        messages,
        temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.1') || 0.1,
        max_tokens: maxTokens,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenRouter API ${res.status}: ${err}`);
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
    maxTokens = toolCallMaxTokensFromEnv(),
  ): Promise<{
    content?: string;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  }> {
    const res = await fetch(chatUrl(), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        model: ingestChatLlmModel(),
        messages,
        tools,
        tool_choice: 'auto',
        temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.1') || 0.1,
        max_tokens: maxTokens,
      }),
    });

    if (!res.ok) throw new Error(`OpenRouter API ${res.status}: ${await res.text()}`);

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
