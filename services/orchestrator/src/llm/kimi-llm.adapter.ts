import { llmChatTemperature, moonshotApiKey, moonshotBaseUrl } from './moonshot-env';
import { orchestratorLlmModel } from './orchestrator-llm-config';
import type { OpenAiStyleMessage } from './openai-llm.adapter';

/** Reintenta 429/503 (TPM/RPM u sobrecarga); respeta Retry-After si viene. */
const MOONSHOT_RATE_LIMIT_ATTEMPTS = 6;
const MOONSHOT_RETRY_BASE_MS = 3000;

async function postChatCompletions(body: Record<string, unknown>): Promise<Response> {
  const key = moonshotApiKey();
  if (!key) throw new Error('LLM_API_KEY u MOONSHOT_API_KEY u KIMI_API_KEY no configurada.');
  const url = `${moonshotBaseUrl()}/chat/completions`;
  const payload = JSON.stringify(body);

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: payload,
    });

    if (res.ok) return res;

    const errText = await res.text();
    const retryable =
      (res.status === 429 || res.status === 503) && attempt < MOONSHOT_RATE_LIMIT_ATTEMPTS - 1;
    if (!retryable) {
      return new Response(errText, { status: res.status, headers: res.headers });
    }

    const ra = res.headers.get('retry-after');
    let delayMs: number;
    if (ra) {
      const sec = parseFloat(ra);
      delayMs = Number.isFinite(sec) ? Math.min(sec * 1000, 120_000) : MOONSHOT_RETRY_BASE_MS * 2 ** attempt;
    } else {
      delayMs = Math.min(MOONSHOT_RETRY_BASE_MS * 2 ** attempt + Math.random() * 1000, 60_000);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
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
  reasoning_content?: string | null;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
}> {
  const model = orchestratorLlmModel();
  const floorRaw = process.env.LLM_KIMI_MIN_MAX_TOKENS?.trim();
  let effectiveMax = maxTokens;
  if (floorRaw) {
    const floor = parseInt(floorRaw, 10);
    if (Number.isFinite(floor) && floor > 0) effectiveMax = Math.max(maxTokens, floor);
  }
  const res = await postChatCompletions({
    model,
    messages,
    tools,
    tool_choice: 'auto',
    temperature: llmChatTemperature(),
    max_tokens: effectiveMax,
  });
  if (!res.ok) throw new Error(`Kimi/Moonshot API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
    }>;
  };
  const msg = data.choices?.[0]?.message;
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
