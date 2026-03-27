/**
 * @fileoverview Factory de proveedores de embedding (OpenAI, Google, Ollama).
 */
import type { EmbeddingProvider } from '../embedding.interface';
import type { EmbeddingSpaceEntity } from '../entities/embedding-space.entity';
import { OpenAiEmbeddingProvider } from './openai.provider';
import { GoogleEmbeddingProvider } from './google.provider';
import { OllamaEmbeddingProvider } from './ollama.provider';

const PROVIDERS = {
  openai: () => new OpenAiEmbeddingProvider(),
  google: () => new GoogleEmbeddingProvider(),
} as const;

/**
 * Crea el proveedor de embeddings según EMBEDDING_PROVIDER (openai | google | ollama; default openai).
 * Para ollama sin fila embedding_spaces, devuelve null (requiere modelo en catálogo).
 * @returns Instancia del provider si está disponible (API key configurada), o null.
 */
export function createEmbeddingProvider(): EmbeddingProvider | null {
  const id = (process.env.EMBEDDING_PROVIDER ?? 'openai').toLowerCase();
  if (id === 'ollama') {
    const model = process.env.OLLAMA_EMBED_MODEL?.trim();
    const dimRaw = process.env.OLLAMA_EMBED_DIMENSION;
    const dimension = dimRaw ? parseInt(dimRaw, 10) : 768;
    if (!model || !Number.isFinite(dimension) || dimension < 1) return null;
    const p = new OllamaEmbeddingProvider({ model, dimension });
    return p.isAvailable() ? p : null;
  }
  const factory = PROVIDERS[id as keyof typeof PROVIDERS];
  if (!factory) {
    return null;
  }
  const provider = factory();
  return provider.isAvailable() ? provider : null;
}

/**
 * Instancia un proveedor alineado con una fila embedding_spaces (migración sin downtime).
 */
export function createEmbeddingProviderFromSpace(
  space: Pick<EmbeddingSpaceEntity, 'provider' | 'modelId' | 'dimension'>,
): EmbeddingProvider | null {
  const id = space.provider.toLowerCase();
  if (id === 'openai') {
    const p = new OpenAiEmbeddingProvider({ model: space.modelId, dimensions: space.dimension });
    return p.isAvailable() ? p : null;
  }
  if (id === 'google') {
    const p = new GoogleEmbeddingProvider({ model: space.modelId, dimensions: space.dimension });
    return p.isAvailable() ? p : null;
  }
  if (id === 'ollama') {
    const p = new OllamaEmbeddingProvider({ model: space.modelId, dimension: space.dimension });
    return p.isAvailable() ? p : null;
  }
  return null;
}
