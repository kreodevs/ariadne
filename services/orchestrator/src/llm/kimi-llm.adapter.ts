import { llmChatTemperature, moonshotApiKey, moonshotBaseUrl } from './moonshot-env';
import { orchestratorLlmModel } from './orchestrator-llm-config';
import type { OpenAiStyleMessage } from './openai-llm.adapter';

async function postChatCompletions(body: Record<string, unknown>): Promise<Response> {
  const key = moonshotApiKey();
  if (!key) throw new Error('LLM_API_KEY u MOONSHOT_API_KEY u KIMI_API_KEY no configurada.');
  const url = `${moonshotBaseUrl()}/chat/completions`;
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
}

export async function kimiCallLlm(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  maxTokens: number,
): Promise<string> {
  const model = orchestratorLlmModel();
  const res = await postChatCompletions({
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

export async function kimiCallLlmWithTools(
  messages: OpenAiStyleMessage[],
  tools: unknown[],
  maxTokens: number,
): Promise<{
  content?: string;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
}> {
  const model = orchestratorLlmModel();
  const res = await postChatCompletions({
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

export async function kimiChatSimple(system: string, user: string): Promise<string> {
  if (!moonshotApiKey()) return '';
  const model = orchestratorLlmModel();
  const res = await postChatCompletions({
    model,
    temperature: llmChatTemperature({ workflowSimple: true }),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const data = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Kimi/Moonshot HTTP ${res.status}`);
  }
  return (data.choices?.[0]?.message?.content ?? '').trim();
}
