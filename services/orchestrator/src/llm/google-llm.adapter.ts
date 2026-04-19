import { randomUUID } from 'node:crypto';
import { orchestratorLlmModel } from './orchestrator-llm-config';
import { googleApiKeyForLlm } from './llm-unified';
import { stripReasoningFromMessages, type OpenAiStyleMessage } from './openai-llm.adapter';

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

function googleGenerateUrl(): string {
  const key = googleApiKeyForLlm();
  if (!key) throw new Error('LLM_API_KEY u GOOGLE_API_KEY no configurada.');
  const model = orchestratorLlmModel();
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
}

function openAiToolsToGeminiDeclarations(tools: unknown[]): { functionDeclarations: Array<Record<string, unknown>> } {
  const functionDeclarations: Array<Record<string, unknown>> = [];
  for (const t of tools as Array<{ type?: string; function?: { name: string; description?: string; parameters?: unknown } }>) {
    if (t?.type === 'function' && t.function?.name) {
      functionDeclarations.push({
        name: t.function.name,
        description: t.function.description ?? '',
        parameters: t.function.parameters ?? { type: 'object', properties: {} },
      });
    }
  }
  return { functionDeclarations };
}

/** Separa system del resto (formato OpenAI chat). */
function extractSystemAndRest(messages: OpenAiStyleMessage[]): { system?: string; rest: OpenAiStyleMessage[] } {
  const sys: string[] = [];
  let i = 0;
  while (i < messages.length && messages[i].role === 'system') {
    sys.push((messages[i] as { content: string }).content);
    i++;
  }
  return { system: sys.length ? sys.join('\n\n') : undefined, rest: messages.slice(i) };
}

function openAiHistoryToGeminiContents(rest: OpenAiStyleMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  let i = 0;
  while (i < rest.length) {
    const m = rest[i];
    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.content }] });
      i++;
      continue;
    }
    if (m.role === 'assistant') {
      if ('tool_calls' in m && m.tool_calls?.length) {
        const parts = m.tool_calls.map((tc) => ({
          functionCall: {
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>,
          },
        }));
        contents.push({ role: 'model', parts });
        i++;
        for (const tc of m.tool_calls) {
          const tm = rest[i];
          if (!tm || tm.role !== 'tool' || tm.tool_call_id !== tc.id) {
            throw new Error('Secuencia assistant/tool inválida para Gemini');
          }
          contents.push({
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: tc.function.name,
                  response: { result: tm.content },
                },
              },
            ],
          });
          i++;
        }
        continue;
      }
      const text = m.content?.trim();
      if (text) {
        contents.push({ role: 'model', parts: [{ text }] });
      }
      i++;
      continue;
    }
    throw new Error(`Rol inesperado en historial para Gemini: ${(m as { role?: string }).role}`);
  }
  return contents;
}

function parseGeminiText(parts: GeminiPart[] | undefined): string {
  if (!parts?.length) return '';
  const chunks: string[] = [];
  for (const p of parts) {
    if ('text' in p && typeof p.text === 'string') chunks.push(p.text);
  }
  return chunks.join('').trim();
}

function parseGeminiToolCalls(parts: GeminiPart[] | undefined): Array<{
  id: string;
  function: { name: string; arguments: string };
}> {
  const out: Array<{ id: string; function: { name: string; arguments: string } }> = [];
  if (!parts?.length) return out;
  for (const p of parts) {
    if ('functionCall' in p && p.functionCall?.name) {
      const args = p.functionCall.args ?? {};
      out.push({
        id: `call_${randomUUID()}`,
        function: {
          name: p.functionCall.name,
          arguments: JSON.stringify(args),
        },
      });
    }
  }
  return out;
}

async function postGemini(body: Record<string, unknown>): Promise<unknown> {
  const url = googleGenerateUrl();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Google Generative Language API ${res.status}: ${raw.slice(0, 2000)}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Respuesta Gemini no JSON');
  }
}

export async function googleCallLlm(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  maxTokens: number,
): Promise<string> {
  const systemParts: string[] = [];
  const contents: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
      continue;
    }
    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.content }] });
      continue;
    }
    contents.push({ role: 'model', parts: [{ text: m.content }] });
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: maxTokens,
    },
  };
  if (systemParts.length) {
    body.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] };
  }

  const data = (await postGemini(body)) as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(data.error.message);
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini bloqueó el prompt: ${data.promptFeedback.blockReason}`);
  }
  const parts = data.candidates?.[0]?.content?.parts;
  return parseGeminiText(parts);
}

export async function googleCallLlmWithTools(
  messages: OpenAiStyleMessage[],
  tools: unknown[],
  maxTokens: number,
): Promise<{
  content?: string;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
}> {
  const { system, rest } = extractSystemAndRest(stripReasoningFromMessages(messages));
  const contents = openAiHistoryToGeminiContents(rest);
  const geminiTools = openAiToolsToGeminiDeclarations(tools);

  const body: Record<string, unknown> = {
    contents,
    tools: [geminiTools],
    toolConfig: {
      functionCallingConfig: {
        mode: 'AUTO',
      },
    },
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: maxTokens,
    },
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  const data = (await postGemini(body)) as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(data.error.message);
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini bloqueó el prompt: ${data.promptFeedback.blockReason}`);
  }
  const parts = data.candidates?.[0]?.content?.parts;
  const text = parseGeminiText(parts);
  const tool_calls = parseGeminiToolCalls(parts);
  return {
    content: text || undefined,
    tool_calls: tool_calls.length ? tool_calls : undefined,
  };
}

export async function googleChatSimple(system: string, user: string): Promise<string> {
  if (!process.env.GOOGLE_API_KEY?.trim()) return '';
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }] as GeminiContent[],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
    },
  };
  const data = (await postGemini(body)) as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(data.error.message);
  return parseGeminiText(data.candidates?.[0]?.content?.parts);
}
