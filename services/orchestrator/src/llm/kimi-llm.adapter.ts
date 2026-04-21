import { llmChatTemperature, moonshotApiKey, moonshotBaseUrl } from './moonshot-env';
import { orchestratorLlmModel } from './orchestrator-llm-config';
import type { OpenAiStyleMessage } from './openai-llm.adapter';

/** Reintenta 429/503 (TPM/RPM u sobrecarga); TPM usa esperas largas (~ventana 1 min). */
const MOONSHOT_RATE_LIMIT_ATTEMPTS = 8;
const MOONSHOT_RETRY_BASE_MS = 3000;

function isTpmOrTokenRateLimitBody(body: string): boolean {
  return (
    body.includes('rate_limit_reached') ||
    body.includes('TPM') ||
    body.includes('tokens per minute') ||
    /project TPM rate limit/i.test(body)
  );
}

function moonshotTpmCooldownMs(): number {
  const raw = process.env.MOONSHOT_TPM_RETRY_COOLDOWN_MS?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 15_000) return n;
  return 58_000;
}

/** Espera antes de reintentar 429/503 (Moonshot suele no mandar Retry-After en TPM). */
function delayBeforeMoonshotRetry(
  status: number,
  errText: string,
  attempt: number,
  retryAfterHeader: string | null,
): number {
  if (retryAfterHeader) {
    const sec = parseFloat(retryAfterHeader);
    if (Number.isFinite(sec) && sec > 0) {
      return Math.min(sec * 1000, 180_000);
    }
  }
  if (status === 429 && isTpmOrTokenRateLimitBody(errText)) {
    const base = moonshotTpmCooldownMs();
    return Math.min(180_000, base + attempt * 12_000 + Math.random() * 2500);
  }
  return Math.min(MOONSHOT_RETRY_BASE_MS * 2 ** attempt + Math.random() * 1000, 90_000);
}

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

    const delayMs = delayBeforeMoonshotRetry(res.status, errText, attempt, res.headers.get('retry-after'));
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
