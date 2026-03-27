/**
 * @fileoverview Resuelve propiedad + proveedor de embeddings por repositorio (lectura / escritura) para migraciones sin downtime.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmbeddingSpaceEntity } from './entities/embedding-space.entity';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import {
  assertValidGraphProperty,
  LEGACY_EMBEDDING_PROPERTY,
  suggestEmbeddingSpaceKey,
  suggestGraphPropertyKey,
} from './graph-property.util';
import type { EmbeddingProvider } from './embedding.interface';
import { createEmbeddingProvider, createEmbeddingProviderFromSpace } from './providers';
import type { CreateEmbeddingSpaceDto } from './dto/create-embedding-space.dto';

export type EmbeddingGraphBinding = {
  graphProperty: string;
  provider: EmbeddingProvider | null;
};

@Injectable()
export class EmbeddingSpaceService {
  constructor(
    @InjectRepository(EmbeddingSpaceEntity)
    private readonly spaces: Repository<EmbeddingSpaceEntity>,
    @InjectRepository(RepositoryEntity)
    private readonly repos: Repository<RepositoryEntity>,
  ) {}

  async assertExists(id: string): Promise<void> {
    const n = await this.spaces.count({ where: { id } });
    if (!n) throw new NotFoundException(`Embedding space ${id} not found`);
  }

  async listSpaces(): Promise<EmbeddingSpaceEntity[]> {
    return this.spaces.find({ order: { createdAt: 'DESC' } });
  }

  async createSpace(dto: CreateEmbeddingSpaceDto): Promise<EmbeddingSpaceEntity> {
    const dimension = Number(dto.dimension);
    if (!Number.isFinite(dimension) || dimension < 1) {
      throw new BadRequestException('dimension must be a positive integer');
    }
    const provider = dto.provider.trim().toLowerCase();
    const modelId = dto.modelId.trim();
    if (!provider || !modelId) {
      throw new BadRequestException('provider and modelId are required');
    }
    const key = dto.key?.trim() || suggestEmbeddingSpaceKey(provider, modelId, dimension);
    const graphProperty = dto.graphProperty?.trim()
      ? assertValidGraphProperty(dto.graphProperty)
      : suggestGraphPropertyKey(provider, modelId, dimension);
    const row = this.spaces.create({
      key,
      provider,
      modelId,
      dimension,
      graphProperty,
    });
    return this.spaces.save(row);
  }

  /**
   * Lectura RAG: espacio configurado o legado (`embedding` + EMBEDDING_PROVIDER).
   */
  async getReadBindingForRepository(repoId: string): Promise<EmbeddingGraphBinding> {
    const repo = await this.repos.findOne({
      where: { id: repoId },
      relations: ['readEmbeddingSpace'],
    });
    if (!repo) throw new NotFoundException(`Repository ${repoId} not found`);
    const space = repo.readEmbeddingSpace;
    if (space) {
      const graphProperty = assertValidGraphProperty(space.graphProperty);
      const provider = createEmbeddingProviderFromSpace(space);
      return { graphProperty, provider };
    }
    return { graphProperty: LEGACY_EMBEDDING_PROPERTY, provider: createEmbeddingProvider() };
  }

  /**
   * Escritura embed-index: write_space si existe; si no, mismo espacio que lectura; si no, legado.
   */
  async getWriteBindingForRepository(repoId: string): Promise<EmbeddingGraphBinding> {
    const repo = await this.repos.findOne({
      where: { id: repoId },
      relations: ['readEmbeddingSpace', 'writeEmbeddingSpace'],
    });
    if (!repo) throw new NotFoundException(`Repository ${repoId} not found`);
    const space = repo.writeEmbeddingSpace ?? repo.readEmbeddingSpace;
    if (space) {
      const graphProperty = assertValidGraphProperty(space.graphProperty);
      const provider = createEmbeddingProviderFromSpace(space);
      return { graphProperty, provider };
    }
    return { graphProperty: LEGACY_EMBEDDING_PROPERTY, provider: createEmbeddingProvider() };
  }
}
