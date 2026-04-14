/**
 * @fileoverview Fachada de análisis multi-root: resuelve repositoryId (proyecto + path opcional) y delega en ChatService.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { RepositoriesService } from '../repositories/repositories.service';
import {
  ChatService,
  type AnalyzeMode,
  type AnalyzeRequestOptions,
  type AnalyzeResult,
} from './chat.service';

const CODE_ANALYSIS_MODES: AnalyzeMode[] = [
  'diagnostico',
  'duplicados',
  'reingenieria',
  'codigo_muerto',
  'seguridad',
];

export type ResolveAnalysisTargetInput = {
  projectId: string;
  repositoryId?: string;
  idePath?: string;
};

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly repos: RepositoriesService,
    private readonly chat: ChatService,
  ) {}

  isCodeAnalysisMode(mode: AnalyzeMode): boolean {
    return CODE_ANALYSIS_MODES.includes(mode);
  }

  /**
   * Determina el repositorio sobre el que corre el análisis (embeddings/Falkor por repo).
   */
  async resolveRepositoryIdForAnalysis(input: ResolveAnalysisTargetInput): Promise<string> {
    const projectId = input.projectId?.trim();
    if (!projectId) throw new BadRequestException('projectId requerido');

    const repositoryId = input.repositoryId?.trim();
    if (repositoryId) {
      await this.repos.findOne(repositoryId);
      const reposInProject = await this.repos.findAll(projectId);
      const ok = reposInProject.some((r) => r.id === repositoryId);
      if (!ok) {
        throw new BadRequestException(
          `repositoryId ${repositoryId} no está asociado al proyecto ${projectId}`,
        );
      }
      return repositoryId;
    }

    await this.projects.findOne(projectId);
    const reposInProject = await this.repos.findAll(projectId);
    if (reposInProject.length === 0) {
      throw new BadRequestException(`Proyecto ${projectId} sin repositorios asociados`);
    }
    if (reposInProject.length === 1) {
      return reposInProject[0].id;
    }

    const idePath = input.idePath?.trim();
    if (!idePath) {
      throw new BadRequestException(
        'Proyecto multi-root: envíe repositoryId (roots[].id de list_known_projects) o idePath para resolver el repositorio',
      );
    }

    const resolved = await this.projects.resolveRepoForPath(projectId, idePath);
    if (!resolved.repoId) {
      throw new BadRequestException(
        'No se pudo inferir el repositorio desde idePath; use repositoryId explícito o una ruta que contenga projectKey/repoSlug del root',
      );
    }
    return resolved.repoId;
  }

  async analyzeByProjectId(
    projectId: string,
    mode: AnalyzeMode,
    opts: { repositoryId?: string; idePath?: string; analyzeOptions?: AnalyzeRequestOptions },
  ): Promise<AnalyzeResult> {
    const repositoryId = await this.resolveRepositoryIdForAnalysis({
      projectId,
      repositoryId: opts.repositoryId,
      idePath: opts.idePath,
    });
    return this.chat.analyze(repositoryId, mode, opts.analyzeOptions);
  }
}
