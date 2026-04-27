/**
 * @fileoverview Servicio de embeddings para RAG vía OpenRouter. Ver providers/.
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
   * ID del provider (p. ej. 'openrouter') o null si no hay provider.
   * @returns {string | null}
   */
  getProviderId(): string | null {
    return this.provider?.id ?? null;
  }

  /**
   * Dimensión del vector de embedding (p. ej. 1536 para text-embedding-3-small). Lanza si no hay provider.
   * @returns {number}
   */
  getDimension(): number {
    if (!this.provider) {
      throw new Error(
        'No embedding provider configured. Set OPENROUTER_API_KEY and EMBEDDING_PROVIDER=openrouter (or openai alias).',
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
        'No embedding provider configured. Set OPENROUTER_API_KEY and EMBEDDING_PROVIDER=openrouter (or openai alias).',
      );
    }
    return this.provider.embed(text);
  }
}
