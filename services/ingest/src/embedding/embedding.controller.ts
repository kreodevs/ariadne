import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { EmbeddingSpaceService } from './embedding-space.service';

@Controller()
export class EmbeddingController {
  constructor(
    private readonly embedding: EmbeddingService,
    private readonly embeddingSpaces: EmbeddingSpaceService,
  ) {}

  /**
   * Vector de consulta para RAG. Con `repositoryId`, usa el espacio de **lectura** del repo
   * (vectorProperty + modelo acordes al catálogo). Sin repo, comportamiento histórico (EMBEDDING_PROVIDER).
   */
  @Get('embed')
  async embed(
    @Query('text') text: string | undefined,
    @Query('repositoryId') repositoryId: string | undefined,
  ) {
    if (!text?.trim()) {
      throw new BadRequestException('Query param "text" is required');
    }
    const trimmed = text.trim();
    if (repositoryId?.trim()) {
      const b = await this.embeddingSpaces.getReadBindingForRepository(repositoryId.trim());
      if (!b.provider?.isAvailable()) {
        throw new BadRequestException(
          'Embedding provider for this repository read space is not configured (keys, OLLAMA_HOST, or space provider).',
        );
      }
      const embedding = await b.provider.embed(trimmed);
      return {
        embedding,
        vectorProperty: b.graphProperty,
        dimension: b.provider.getDimension(),
      };
    }
    if (!this.embedding.isAvailable()) {
      throw new BadRequestException(
        'Embedding provider not configured. Set EMBEDDING_PROVIDER=openai|google|kimi|ollama and the matching API keys / KIMI_EMBEDDING_* for kimi.',
      );
    }
    const embedding = await this.embedding.embed(trimmed);
    return { embedding };
  }
}
