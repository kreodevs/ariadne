/**
 * Proveedor de embeddings vía Google AI (Gemini embedding). Default 768 dims.
 * Variable: GOOGLE_API_KEY (API key de AI Studio / generativelanguage.googleapis.com)
 */
import type { EmbeddingProvider } from '../embedding.interface';

const DEFAULT_MODEL = 'gemini-embedding-001';
const DEFAULT_DIMENSION = 768;

export type GoogleEmbeddingProviderOptions = {
  model?: string;
  dimensions?: number;
};

export class GoogleEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'google';
  private readonly apiKey: string | null;
  private readonly model: string;
  private readonly dimension: number;

  constructor(opts?: GoogleEmbeddingProviderOptions) {
    this.apiKey = process.env.GOOGLE_API_KEY?.trim() ?? process.env.GEMINI_API_KEY?.trim() ?? null;
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
      throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY required for Google embeddings');
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${this.model}`,
        content: { parts: [{ text: text.slice(0, 2048) }] },
        outputDimensionality: this.dimension,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google embedding failed: ${res.status} ${err}`);
    }
    const data = (await res.json()) as { embedding?: { values?: number[] } };
    const vec = data.embedding?.values;
    if (!Array.isArray(vec) || vec.length !== this.dimension) {
      throw new Error(`Unexpected embedding shape: expected ${this.dimension}`);
    }
    return vec;
  }
}
