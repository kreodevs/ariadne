/**
 * Embeddings vía Kimi Open Platform (OpenAI-compatible POST /v1/embeddings).
 * Requiere modelo y dimensión explícitos (la documentación pública no fija un modelo de embedding único).
 * Variables: MOONSHOT_API_KEY o KIMI_API_KEY, MOONSHOT_BASE_URL (opcional).
 */
import { moonshotApiKey, moonshotBaseUrl } from '../../moonshot/moonshot-env';
import type { EmbeddingProvider } from '../embedding.interface';

export type KimiEmbeddingProviderOptions = {
  model: string;
  dimensions: number;
};

export class KimiEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'kimi';
  private readonly apiKey: string | null;
  private readonly model: string;
  private readonly dimension: number;

  constructor(opts?: KimiEmbeddingProviderOptions) {
    this.apiKey = moonshotApiKey();
    this.model = opts?.model?.trim() || '';
    this.dimension = opts?.dimensions ?? 0;
  }

  isAvailable(): boolean {
    return !!this.apiKey && this.model.length > 0 && this.dimension > 0;
  }

  getDimension(): number {
    return this.dimension;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('MOONSHOT_API_KEY or KIMI_API_KEY required for Kimi embeddings');
    }
    const url = `${moonshotBaseUrl()}/embeddings`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: text.slice(0, 8191),
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Kimi/Moonshot embedding failed: ${res.status} ${err}`);
    }
    const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const vec = data.data?.[0]?.embedding;
    if (!Array.isArray(vec)) {
      throw new Error('Unexpected Kimi embedding response shape');
    }
    if (vec.length !== this.dimension) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.dimension} (config), got ${vec.length}. Adjust KIMI_EMBEDDING_DIMENSION or embedding_spaces.dimension.`,
      );
    }
    return vec;
  }
}
