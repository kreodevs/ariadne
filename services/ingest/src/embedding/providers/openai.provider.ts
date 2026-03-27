/**
 * Proveedor de embeddings vía OpenAI API. Default: text-embedding-3-small, 1536 dims.
 * Variable: OPENAI_API_KEY
 */
import type { EmbeddingProvider } from '../embedding.interface';

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_DIMENSION = 1536;

export type OpenAiEmbeddingProviderOptions = {
  model?: string;
  dimensions?: number;
};

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'openai';
  private readonly apiKey: string | null;
  private readonly model: string;
  private readonly dimension: number;

  constructor(opts?: OpenAiEmbeddingProviderOptions) {
    this.apiKey = process.env.OPENAI_API_KEY?.trim() ?? null;
    this.model = opts?.model?.trim() || DEFAULT_MODEL;
    this.dimension = opts?.dimensions ?? DEFAULT_DIMENSION;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  getDimension(): number {
    return this.dimension;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY required for OpenAI embeddings');
    }
    const body: Record<string, unknown> = {
      model: this.model,
      input: text.slice(0, 8191),
    };
    if (this.model.includes('text-embedding-3')) {
      body.dimensions = this.dimension;
    }
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI embedding failed: ${res.status} ${err}`);
    }
    const data = (await res.json()) as { data: [{ embedding: number[] }] };
    const vec = data.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== this.dimension) {
      throw new Error(`Unexpected embedding shape: expected ${this.dimension}`);
    }
    return vec;
  }
}
