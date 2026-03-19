/**
 * @fileoverview Factory de proveedores de embedding (OpenAI, Google).
 */
import type { EmbeddingProvider } from '../embedding.interface';
import { OpenAiEmbeddingProvider } from './openai.provider';
import { GoogleEmbeddingProvider } from './google.provider';

const PROVIDERS = {
  openai: () => new OpenAiEmbeddingProvider(),
  google: () => new GoogleEmbeddingProvider(),
} as const;

/** Identificador de proveedor (openai, google). */
export type EmbeddingProviderId = keyof typeof PROVIDERS;

/**
 * Crea el proveedor de embeddings según EMBEDDING_PROVIDER (openai | google; default openai).
 * @returns Instancia del provider si está disponible (API key configurada), o null.
 */
export function createEmbeddingProvider(): EmbeddingProvider | null {
  const id = (process.env.EMBEDDING_PROVIDER ?? 'openai').toLowerCase();
  const factory = PROVIDERS[id as EmbeddingProviderId];
  if (!factory) {
    return null;
  }
  const provider = factory();
  return provider.isAvailable() ? provider : null;
}
