import { orchestratorLlmModel } from './orchestrator-llm-config';
import { openAiApiKeyForLlm } from './llm-unified';

export type OpenAiStyleMessage =
  | { role: 'user' | 'assistant' | 'system'; content: string }
  | {
      role: 'assistant';
      content?: string | null;
      /** Kimi k2.5 / thinking: obligatorio reenviar en multi-turn con tools */
      reasoning_content?: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    }
  | { role: 'tool'; tool_call_id: string; content: string };

/** OpenAI/Gemini no aceptan reasoning_content en el body. */
export function stripReasoningFromMessages(messages: OpenAiStyleMessage[]): OpenAiStyleMessage[] {
  return messages.map((m) => {
    if (m.role !== 'assistant' || !('reasoning_content' in m)) return m;
    const { reasoning_content: _r, ...rest } = m as {
      reasoning_content?: string | null;
      role: 'assistant';
      content?: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
    return rest as OpenAiStyleMessage;
  });
}

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
  reasoning_content?: string | null;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
}> {
  const key = openAiApiKeyForLlm();
  if (!key) throw new Error('LLM_API_KEY u OPENAI_API_KEY no configurada.');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: orchestratorLlmModel(),
      messages: stripReasoningFromMessages(messages),
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
  const msg = data.choices?.[0]?.message as {
    content?: string | null;
    reasoning_content?: string | null;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  };
  const base: {
    content?: string;
    reasoning_content?: string | null;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  } = {
    content: msg?.content?.trim() ?? undefined,
    tool_calls: msg?.tool_calls?.length ? msg.tool_calls : undefined,
  };
  if (msg && 'reasoning_content' in msg) {
    base.reasoning_content =
      msg.reasoning_content == null ? null : String(msg.reasoning_content);
  }
  return base;
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
