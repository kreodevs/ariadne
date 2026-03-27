/**
 * Embeddings vía Ollama HTTP API (/api/embeddings). Útil para Nomic y modelos locales.
 * Variables: OLLAMA_HOST (default http://127.0.0.1:11434)
 */
import type { EmbeddingProvider } from '../embedding.interface';

export type OllamaEmbeddingProviderOptions = {
  model: string;
  dimension: number;
};

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'ollama';
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly dimension: number;

  constructor(opts: OllamaEmbeddingProviderOptions) {
    const raw = process.env.OLLAMA_HOST?.trim() || 'http://127.0.0.1:11434';
    this.baseUrl = raw.replace(/\/$/, '');
    this.model = opts.model;
    this.dimension = opts.dimension;
  }

  isAvailable(): boolean {
    return this.model.length > 0 && this.dimension > 0;
  }

  getDimension(): number {
    return this.dimension;
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text.slice(0, 32000),
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama embedding failed: ${res.status} ${err}`);
    }
    const data = (await res.json()) as { embedding?: number[] };
    const vec = data.embedding;
    if (!Array.isArray(vec) || vec.length !== this.dimension) {
      throw new Error(
        `Unexpected Ollama embedding shape: expected length ${this.dimension}, got ${vec?.length ?? 0}`,
      );
    }
    return vec;
  }
}
