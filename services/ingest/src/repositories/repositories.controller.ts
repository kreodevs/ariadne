/**
 * @fileoverview CRUD repos, branches, file content, embed-index, jobs.
 */
import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RepositoriesService } from './repositories.service';
import { JobAnalysisService } from './job-analysis.service';
import { CreateRepositoryDto } from './dto/create-repository.dto';
import { UpdateRepositoryDto } from './dto/update-repository.dto';
import { FileContentService } from './file-content.service';
import { EmbedIndexService } from '../embedding/embed-index.service';
import { SyncService } from '../sync/sync.service';

/** Rutas /repositories (CRUD, branches, file, embed-index, jobs). */
@Controller('repositories')
export class RepositoriesController {
  constructor(
    private readonly service: RepositoriesService,
    private readonly fileContent: FileContentService,
    private readonly jobAnalysis: JobAnalysisService,
    private readonly embedIndexSvc: EmbedIndexService,
    private readonly sync: SyncService,
  ) {}

  @Post()
  create(@Body() dto: CreateRepositoryDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRepositoryDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.sync.clearGraphDataForRepository(id);
    await this.service.remove(id);
  }

  @Get()
  findAll(@Query('projectId') projectId?: string) {
    return this.service.findAll(projectId);
  }

  @Get(':id/branches')
  async listBranches(
    @Param('id') id: string,
    @Query('credentialsRef') credentialsRef: string | undefined,
  ) {
    const branches = await this.fileContent.listBranches(id, credentialsRef ?? null);
    return { branches };
  }

  /** Obtiene el contenido de un archivo del repo (Bitbucket/GitHub). path puede ser relativo (src/App.tsx) o del grafo (repo-slug/src/App.tsx). */
  @Get(':id/file')
  async getFile(
    @Param('id') id: string,
    @Query('path') path: string | undefined,
    @Query('ref') ref: string | undefined,
  ) {
    if (!path?.trim()) {
      throw new BadRequestException('Query param "path" is required');
    }
    const content = await this.fileContent.getFileContent(id, path.trim(), ref);
    return { content };
  }

  @Post(':id/embed-index')
  async runEmbedIndex(@Param('id') id: string) {
    return this.embedIndexSvc.runEmbedIndex(id);
  }

  @Get(':id/jobs')
  findJobs(@Param('id') id: string) {
    return this.service.findJobsByRepositoryId(id);
  }

  @Delete(':id/jobs')
  async removeAllJobs(@Param('id') id: string) {
    const deleted = await this.service.removeAllJobs(id);
    return { deleted };
  }

  @Delete(':id/jobs/:jobId')
  removeJob(@Param('id') id: string, @Param('jobId') jobId: string) {
    return this.service.removeJob(id, jobId);
  }

  /** Análisis de cambios de un job incremental: impacto, seguridad, resumen. */
  @Get(':id/jobs/:jobId/analysis')
  getJobAnalysis(@Param('id') id: string, @Param('jobId') jobId: string) {
    return this.jobAnalysis.analyzeJob(id, jobId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.service.findOneWithProjectIds(id);
  }
}
