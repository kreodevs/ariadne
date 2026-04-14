/**
 * @fileoverview API REST de proyectos (multi-root): listar, detalle, file, crear, actualizar, eliminar.
 */
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { FileContentService } from '../repositories/file-content.service';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly service: ProjectsService,
    private readonly fileContent: FileContentService,
  ) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** Contenido de un archivo buscando en todos los repos del proyecto (multi-root). MCP y chat por proyecto. */
  /** Enrutamiento Falkor (sharding por proyecto / por dominio) para MCP y API. */
  @Get(':id/graph-routing')
  graphRouting(@Param('id') id: string) {
    return this.service.getGraphRouting(id);
  }

  @Get(':id/file')
  async getFile(
    @Param('id') projectId: string,
    @Query('path') path: string,
    @Query('ref') ref?: string,
  ) {
    const content = await this.fileContent.getFileContentSafeByProject(projectId, path?.trim() ?? '');
    if (content == null) return { content: null };
    return { content };
  }

  /** Heurística multi-root: qué `repositories.id` encaja con la ruta local (IDE). */
  @Get(':id/resolve-repo-for-path')
  resolveRepoForPath(@Param('id') projectId: string, @Query('path') path: string) {
    return this.service.resolveRepoForPath(projectId, path?.trim() ?? '');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() body: { name?: string | null; description?: string | null }) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { name?: string | null; description?: string | null }) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
  }

  /** Regenera el ID del proyecto (sin perder datos). Redirigir al cliente al nuevo ID. */
  @Post(':id/regenerate-id')
  async regenerateId(@Param('id') id: string) {
    return this.service.regenerateId(id);
  }
}
