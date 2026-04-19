/**
 * @fileoverview Servicio de embeddings para RAG. Provider agnóstico (OpenAI, Google, Kimi). Ver providers/.
 */
import { Injectable } from '@nestjs/common';
import { createEmbeddingProvider } from './providers';
import type { EmbeddingProvider } from './embedding.interface';

@Injectable()
export class EmbeddingService {
  private readonly provider: EmbeddingProvider | null;

  constructor() {
    this.provider = createEmbeddingProvider();
  }

  /**
   * Indica si hay un provider de embeddings configurado.
   * @returns {boolean}
   */
  isAvailable(): boolean {
    return this.provider !== null;
  }

  /**
   * ID del provider ('openai' | 'google' | 'kimi' | …) o null si no hay provider.
   * @returns {string | null}
   */
  getProviderId(): string | null {
    return this.provider?.id ?? null;
  }

  /**
   * Dimensión del vector de embedding (OpenAI 1536, Google 768). Lanza si no hay provider.
   * @returns {number}
   */
  getDimension(): number {
    if (!this.provider) {
      throw new Error(
        'No embedding provider configured. Set EMBEDDING_PROVIDER and the corresponding API key (openai|google|kimi|ollama).',
      );
    }
    return this.provider.getDimension();
  }

  /**
   * Genera el vector de embedding para un texto. Lanza si no hay provider configurado.
   * @param {string} text - Texto a embedir.
   * @returns {Promise<number[]>} Vector de dimensión getDimension().
   */
  async embed(text: string): Promise<number[]> {
    if (!this.provider) {
      throw new Error(
        'No embedding provider configured. Set EMBEDDING_PROVIDER and keys (OPENAI_API_KEY, GOOGLE_API_KEY, MOONSHOT_API_KEY+kimi params, or ollama).'
      );
    }
    return this.provider.embed(text);
  }
}
