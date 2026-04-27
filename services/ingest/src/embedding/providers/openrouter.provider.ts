/**
 * Embeddings vía OpenRouter (`/v1/embeddings`, compatible OpenAI).
 */
import type { EmbeddingProvider } from '../embedding.interface';
import {
  defaultEmbeddingDimension,
  openRouterDefaultHeaders,
  resolveOpenRouterApiKey,
  resolveOpenRouterBaseUrl,
  resolveOpenRouterEmbeddingModel,
} from '../../llm/llm-config';

export type OpenRouterEmbeddingProviderOptions = {
  model?: string;
  dimensions?: number;
};

function toOpenRouterEmbeddingModel(modelId: string): string {
  const m = modelId.trim();
  if (m.includes('/')) return m;
  if (m.startsWith('text-embedding')) return `openai/${m}`;
  return m;
}

export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'openrouter';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimension: number;

  constructor(opts?: OpenRouterEmbeddingProviderOptions) {
    this.apiKey = resolveOpenRouterApiKey();
    this.model = (opts?.model?.trim() || resolveOpenRouterEmbeddingModel()).trim();
    this.dimension = opts?.dimensions ?? defaultEmbeddingDimension();
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  getDimension(): number {
    return this.dimension;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY (or AI_API_KEY / OPENAI_API_KEY) required for OpenRouter embeddings');
    }
    const base = resolveOpenRouterBaseUrl().replace(/\/$/, '');
    const body: Record<string, unknown> = {
      model: this.model,
      input: text.slice(0, 8191),
    };
    if (this.model.includes('text-embedding-3')) {
      body.dimensions = this.dimension;
    }
    const extra = openRouterDefaultHeaders();
    const res = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...extra,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenRouter embedding failed: ${res.status} ${err}`);
    }
    const data = (await res.json()) as { data: [{ embedding: number[] }] };
    const vec = data.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== this.dimension) {
      throw new Error(`Unexpected embedding shape: expected ${this.dimension}, got ${Array.isArray(vec) ? vec.length : 'n/a'}`);
    }
    return vec;
  }
}

/** Fábrica usada con filas `embedding_spaces` (openrouter u openai legado vía el mismo API). */
export function createOpenRouterProviderFromModel(
  modelId: string,
  dimension: number,
): OpenRouterEmbeddingProvider {
  return new OpenRouterEmbeddingProvider({
    model: toOpenRouterEmbeddingModel(modelId),
    dimensions: dimension,
  });
}
