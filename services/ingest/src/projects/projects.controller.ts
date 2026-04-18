/**
 * @fileoverview API REST de proyectos (multi-root): listar, detalle, file, crear, actualizar, eliminar.
 */
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { FileContentService } from '../repositories/file-content.service';
import { JobAnalysisService } from '../repositories/job-analysis.service';
import { C4DslGeneratorService } from '../architecture/c4-dsl-generator.service';
import { DomainsService } from '../domains/domains.service';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly service: ProjectsService,
    private readonly fileContent: FileContentService,
    private readonly jobAnalysis: JobAnalysisService,
    private readonly c4Dsl: C4DslGeneratorService,
    private readonly domains: DomainsService,
  ) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** DSL PlantUML C4 (niveles 1–3) y diff opcional con shadow graph. */
  @Get(':id/architecture/c4')
  getArchitectureC4(
    @Param('id') id: string,
    @Query('level') level?: string,
    @Query('sessionId') sessionId?: string,
  ) {
    const lv = Math.min(3, Math.max(1, parseInt(level ?? '1', 10) || 1)) as 1 | 2 | 3;
    return this.c4Dsl.generate(id, { level: lv, sessionId: sessionId?.trim() || undefined });
  }

  @Get(':id/domain-dependencies')
  listDomainDependencies(@Param('id') id: string) {
    return this.domains.listProjectDependencies(id);
  }

  @Post(':id/domain-dependencies')
  addDomainDependency(
    @Param('id') id: string,
    @Body()
    body: { dependsOnDomainId: string; connectionType?: string; description?: string | null },
  ) {
    return this.domains.addProjectDependency(id, body);
  }

  @Delete(':id/domain-dependencies/:depId')
  async removeDomainDependency(@Param('id') id: string, @Param('depId') depId: string) {
    await this.domains.removeProjectDependency(id, depId);
    return { ok: true };
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

  /**
   * Análisis de job incremental por **proyecto** + `jobId` (el job ya ancla `repositoryId`; se valida enlace `project_repositories`).
   * Alternativa: `GET /repositories/:repositoryId/jobs/:jobId/analysis`.
   */
  @Get(':id/jobs/:jobId/analysis')
  getJobAnalysis(@Param('id') projectId: string, @Param('jobId') jobId: string) {
    return this.jobAnalysis.analyzeJobForProject(projectId, jobId);
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
  update(
    @Param('id') id: string,
    @Body() body: { name?: string | null; description?: string | null; domainId?: string | null },
  ) {
    return this.service.update(id, body);
  }

  /** Rol opcional del repo en el proyecto (chat multi-root: inferencia de alcance). */
  @Patch(':id/repositories/:repoId')
  setRepoRole(
    @Param('id') projectId: string,
    @Param('repoId') repoId: string,
    @Body() body: { role?: string | null },
  ) {
    return this.service.setRepositoryRole(projectId, repoId, body.role);
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
