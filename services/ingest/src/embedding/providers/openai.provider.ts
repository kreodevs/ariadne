/**
 * Proveedor de embeddings vía OpenAI API (text-embedding-3-small, 1536 dims).
 * Variable: OPENAI_API_KEY
 */
import type { EmbeddingProvider } from '../embedding.interface';

const MODEL = 'text-embedding-3-small';
const DIMENSION = 1536;

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'openai';
  private readonly apiKey: string | null;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY?.trim() ?? null;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  getDimension(): number {
    return DIMENSION;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY required for OpenAI embeddings');
    }
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        input: text.slice(0, 8191),
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI embedding failed: ${res.status} ${err}`);
    }
    const data = (await res.json()) as { data: [{ embedding: number[] }] };
    const vec = data.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== DIMENSION) {
      throw new Error(`Unexpected embedding shape: expected ${DIMENSION}`);
    }
    return vec;
  }
}
