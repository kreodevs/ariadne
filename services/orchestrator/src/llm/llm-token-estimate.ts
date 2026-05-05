import type { LlmMessage } from './llm.adapter';

/** Heurística barata (chars → tokens); código suele ser más denso que prose. */
function charsToTokens(chars: number): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars / 3.2);
}

function stringLen(s: string | null | undefined): number {
  return s?.length ?? 0;
}

/** Estima tokens enviados en `messages` + `tools` + cupo de salida `maxTokens` (TPM suele contar ambos). */
export function estimateLlmPayloadTokens(
  messages: LlmMessage[],
  tools: unknown[] | undefined,
  maxTokens: number,
): number {
  let chars = 0;
  for (const m of messages) {
    chars += 8;
    if (m.role === 'tool') {
      chars += stringLen(m.content) + stringLen(m.tool_call_id);
      continue;
    }
    if (m.role === 'assistant' && 'tool_calls' in m && m.tool_calls?.length) {
      for (const tc of m.tool_calls) {
        chars += stringLen(tc.id) + stringLen(tc.function?.name) + stringLen(tc.function?.arguments);
      }
    }
    if ('content' in m && m.content != null) chars += stringLen(String(m.content));
    if ('reasoning_content' in m && m.reasoning_content != null) {
      chars += stringLen(String(m.reasoning_content));
    }
  }
  if (tools?.length) {
    try {
      chars += JSON.stringify(tools).length;
    } catch {
      chars += 4000;
    }
  }
  const out = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 0;
  return Math.ceil((charsToTokens(chars) + out + 200) * 1.18);
}

export function estimateSimpleChatTokens(
  parts: Array<{ role: string; content: string }>,
  maxTokens: number,
): number {
  let chars = 0;
  for (const p of parts) {
    chars += 8 + stringLen(p.content);
  }
  const out = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 0;
  return Math.ceil((charsToTokens(chars) + out + 200) * 1.18);
}
