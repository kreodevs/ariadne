import { llmChatTemperature, moonshotApiKey, moonshotBaseUrl } from '../moonshot/moonshot-env';
import { ingestChatLlmModel } from './chat-llm-config';

async function post(body: Record<string, unknown>): Promise<Response> {
  const key = moonshotApiKey();
  if (!key) throw new Error('LLM_API_KEY u MOONSHOT_API_KEY u KIMI_API_KEY no configurada.');
  return fetch(`${moonshotBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
}

export async function kimiIngestCallLlm(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  maxTokens: number,
): Promise<string> {
  const model = ingestChatLlmModel();
  const res = await post({
    model,
    messages,
    temperature: llmChatTemperature(),
    max_tokens: maxTokens,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Kimi/Moonshot API ${res.status}: ${err}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

export async function kimiIngestCallLlmWithTools(
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
  maxTokens: number,
): Promise<{
  content?: string;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
}> {
  const model = ingestChatLlmModel();
  const res = await post({
    model,
    messages,
    tools,
    tool_choice: 'auto',
    temperature: llmChatTemperature(),
    max_tokens: maxTokens,
  });
  if (!res.ok) throw new Error(`Kimi/Moonshot API ${res.status}: ${await res.text()}`);
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
