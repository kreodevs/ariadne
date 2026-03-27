/**
 * @fileoverview Módulo de embeddings: proveedores + catálogo embedding_spaces + resolución por repo.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmbeddingService } from './embedding.service';
import { EmbeddingController } from './embedding.controller';
import { EmbeddingSpaceEntity } from './entities/embedding-space.entity';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { EmbeddingSpaceService } from './embedding-space.service';
import { EmbeddingSpacesController } from './embedding-spaces.controller';

@Module({
  imports: [TypeOrmModule.forFeature([EmbeddingSpaceEntity, RepositoryEntity])],
  controllers: [EmbeddingController, EmbeddingSpacesController],
  providers: [EmbeddingService, EmbeddingSpaceService],
  exports: [EmbeddingService, EmbeddingSpaceService],
})
/** Módulo de embeddings vectoriales (OpenAI, Google, Ollama) y metadatos Postgres. */
export class EmbeddingModule {}
