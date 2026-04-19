import { orchestratorLlmModel } from './orchestrator-llm-config';
import { openAiApiKeyForLlm } from './llm-unified';

export type OpenAiStyleMessage =
  | { role: 'user' | 'assistant' | 'system'; content: string }
  | {
      role: 'assistant';
      content?: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export async function openaiCallLlm(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  maxTokens: number,
): Promise<string> {
  const key = openAiApiKeyForLlm();
  if (!key) throw new Error('LLM_API_KEY u OPENAI_API_KEY no configurada.');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: orchestratorLlmModel(),
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

export async function openaiCallLlmWithTools(
  messages: OpenAiStyleMessage[],
  tools: unknown[],
  maxTokens: number,
): Promise<{
  content?: string;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
}> {
  const key = openAiApiKeyForLlm();
  if (!key) throw new Error('LLM_API_KEY u OPENAI_API_KEY no configurada.');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: orchestratorLlmModel(),
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

/** Chat simple system+user (workflow SDD). */
export async function openaiChatSimple(system: string, user: string): Promise<string> {
  const key = openAiApiKeyForLlm();
  if (!key) return '';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: orchestratorLlmModel(),
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(data.error?.message ?? `OpenAI HTTP ${res.status}`);
  }
  return (data.choices?.[0]?.message?.content ?? '').trim();
}
