/**
 * Proveedor de embeddings vía Google AI (Gemini embedding, 768 dims).
 * Variable: GOOGLE_API_KEY (API key de AI Studio / generativelanguage.googleapis.com)
 */
import type { EmbeddingProvider } from '../embedding.interface';

const MODEL = 'gemini-embedding-001';
const DIMENSION = 768;

export class GoogleEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'google';
  private readonly apiKey: string | null;

  constructor() {
    this.apiKey = process.env.GOOGLE_API_KEY?.trim() ?? process.env.GEMINI_API_KEY?.trim() ?? null;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  getDimension(): number {
    return DIMENSION;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY required for Google embeddings');
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${MODEL}`,
        content: { parts: [{ text: text.slice(0, 2048) }] },
        outputDimensionality: DIMENSION,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google embedding failed: ${res.status} ${err}`);
    }
    const data = (await res.json()) as { embedding?: { values?: number[] } };
    const vec = data.embedding?.values;
    if (!Array.isArray(vec) || vec.length !== DIMENSION) {
      throw new Error(`Unexpected embedding shape: expected ${DIMENSION}`);
    }
    return vec;
  }
}
