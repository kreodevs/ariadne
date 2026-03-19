import { BadRequestException, Controller, Get, Post, Query } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';

@Controller()
export class EmbeddingController {
  constructor(private readonly embedding: EmbeddingService) {}

  /** Devuelve el vector de embedding para el texto (para RAG). Requiere EMBEDDING_PROVIDER + API key. */
  @Get('embed')
  async embed(@Query('text') text: string | undefined) {
    if (!text?.trim()) {
      throw new BadRequestException('Query param "text" is required');
    }
    if (!this.embedding.isAvailable()) {
      throw new BadRequestException('Embedding provider not configured. Set EMBEDDING_PROVIDER=openai|google and OPENAI_API_KEY or GOOGLE_API_KEY.');
    }
    const embedding = await this.embedding.embed(text.trim());
    return { embedding };
  }
}
