/**
 * Embeddings vía Kimi Open Platform (OpenAI-compatible POST /v1/embeddings).
 * Default de fábrica: modelo `moonshot-v1` y dimensión 1024 (ver `providers/index.ts` y env overrides).
 * Variables: MOONSHOT_API_KEY o KIMI_API_KEY, MOONSHOT_BASE_URL (opcional), KIMI_EMBEDDING_MODEL, KIMI_EMBEDDING_DIMENSION.
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
      const errBody = await res.text();
      let hint = '';
      if (res.status === 403) {
        hint =
          ' La API /v1/embeddings no está abierta para esta clave o cuenta (Moonshot: activar embeddings en consola o usar otra clave). Alternativas: EMBEDDING_PROVIDER=openai|google|ollama.';
        try {
          const j = JSON.parse(errBody) as { error?: { type?: string; message?: string } };
          if (j.error?.type === 'permission_denied_error') {
            hint =
              ' permission_denied: embeddings no contratados o no habilitados en Kimi/Moonshot. Usa OPENAI_API_KEY u Ollama para RAG, o habilita el producto de embeddings en la consola del proveedor.';
          }
        } catch {
          /* texto plano */
        }
      }
      throw new Error(`Kimi/Moonshot embedding failed: ${res.status} ${errBody}${hint}`);
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
