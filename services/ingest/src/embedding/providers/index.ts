/**
 * @fileoverview Embeddings solo vía OpenRouter.
 */
import type { EmbeddingProvider } from '../embedding.interface';
import type { EmbeddingSpaceEntity } from '../entities/embedding-space.entity';
import {
  OpenRouterEmbeddingProvider,
  createOpenRouterProviderFromModel,
} from './openrouter.provider';

/**
 * Crea el proveedor según EMBEDDING_PROVIDER (default: openrouter). `openai` se trata como alias.
 */
export function createEmbeddingProvider(): EmbeddingProvider | null {
  const id = (process.env.EMBEDDING_PROVIDER ?? 'openrouter').toLowerCase();
  if (id !== 'openrouter' && id !== 'openai') {
    return null;
  }
  const p = new OpenRouterEmbeddingProvider();
  return p.isAvailable() ? p : null;
}

/**
 * Instancia un proveedor alineado con `embedding_spaces`.
 */
export function createEmbeddingProviderFromSpace(
  space: Pick<EmbeddingSpaceEntity, 'provider' | 'modelId' | 'dimension'>,
): EmbeddingProvider | null {
  const id = space.provider.toLowerCase();
  if (id === 'openrouter' || id === 'openai') {
    const p = createOpenRouterProviderFromModel(space.modelId, space.dimension);
    return p.isAvailable() ? p : null;
  }
  return null;
}
