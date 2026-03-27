import { Body, Controller, Get, Post } from '@nestjs/common';
import { EmbeddingSpaceService } from './embedding-space.service';
import type { CreateEmbeddingSpaceDto } from './dto/create-embedding-space.dto';

/** CRUD mínimo del catálogo embedding_spaces (operación / administración). */
@Controller('embedding-spaces')
export class EmbeddingSpacesController {
  constructor(private readonly spaces: EmbeddingSpaceService) {}

  @Get()
  list() {
    return this.spaces.listSpaces();
  }

  @Post()
  create(@Body() dto: CreateEmbeddingSpaceDto) {
    return this.spaces.createSpace(dto);
  }
}
