import { BadRequestException } from '@nestjs/common';

/** Propiedad Falkor usada cuando no hay fila en embedding_spaces (comportamiento histórico). */
export const LEGACY_EMBEDDING_PROPERTY = 'embedding';

/** Valida identificador Cypher seguro para interpolar en SET / índice vectorial. */
export function assertValidGraphProperty(name: string): string {
  const trimmed = name.trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(trimmed)) {
    throw new BadRequestException(
      'graph_property must match /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/',
    );
  }
  return trimmed;
}

export function suggestGraphPropertyKey(provider: string, modelId: string, dimension: number): string {
  const raw = `${provider}_${modelId}_${dimension}`.replace(/[^a-zA-Z0-9_]+/g, '_');
  let slug = raw.replace(/^_+|_+$/g, '') || 'space';
  if (/^[0-9]/.test(slug)) slug = `_${slug}`;
  const candidate = `emb_${slug}`.slice(0, 128);
  return assertValidGraphProperty(candidate);
}

export function suggestEmbeddingSpaceKey(provider: string, modelId: string, dimension: number): string {
  const raw = `${provider}_${modelId}_${dimension}`.replace(/[^a-zA-Z0-9_]+/g, '_');
  return raw.replace(/^_+|_+$/g, '') || 'default';
}
