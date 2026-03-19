/**
 * @fileoverview Módulo de embeddings: OpenAI/Google para indexar y buscar texto.
 */
import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { EmbeddingController } from './embedding.controller';

@Module({
  controllers: [EmbeddingController],
  providers: [EmbeddingService],
  exports: [EmbeddingService],
})
/** Módulo de embeddings vectoriales (OpenAI, Google). */
export class EmbeddingModule {}
