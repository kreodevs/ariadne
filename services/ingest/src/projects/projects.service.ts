/**
 * @fileoverview CRUD de proyectos (multi-root). Un proyecto agrupa N repositorios.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { FalkorDB } from 'falkordb';
import { ProjectEntity } from './entities/project.entity';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { ProjectRepositoryEntity } from '../repositories/entities/project-repository.entity';
import {
  getFalkorConfig,
  graphNameForProject,
  isProjectShardingEnabled,
  effectiveShardMode,
  getGraphNodeSoftLimit,
  listGraphNamesForProjectRouting,
  type FalkorShardMode,
} from '../pipeline/falkor';
import {
  resolveRepoIdForAbsolutePath,
  resolveRepositoryIdForWorkspacePath,
  type RepoPathMatchInput,
  type WorkspacePathRepoResolution,
} from './path-repo-resolution.util';

export interface ProjectWithRepos {
  id: string;
  name: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  repositories: Array<{
    id: string;
    provider: string;
    projectKey: string;
    repoSlug: string;
    defaultBranch: string;
    status: string;
    lastSyncAt: string | null;
    role?: string | null;
  }>;
}

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(ProjectRepositoryEntity)
    private readonly projectRepoRepo: Repository<ProjectRepositoryEntity>,
    @InjectRepository(RepositoryEntity)
    private readonly repoRepo: Repository<RepositoryEntity>,
  ) {}

  async findAll(): Promise<ProjectWithRepos[]> {
    const projects = await this.projectRepo.find({
      order: { updatedAt: 'DESC' },
    });
    const projectIds = projects.map((p) => p.id);
    const prs =
      projectIds.length > 0
        ? await this.projectRepoRepo.find({
            where: { projectId: In(projectIds) },
            select: ['projectId', 'repoId', 'role'],
          })
        : [];
    const repoIdsByProject = new Map<string, string[]>();
    const roleByProjectRepo = new Map<string, string | null>();
    for (const pr of prs) {
      if (!repoIdsByProject.has(pr.projectId)) repoIdsByProject.set(pr.projectId, []);
      repoIdsByProject.get(pr.projectId)!.push(pr.repoId);
      roleByProjectRepo.set(`${pr.projectId}:${pr.repoId}`, pr.role ?? null);
    }
    const allRepoIds = [...new Set(prs.map((pr) => pr.repoId))];
    const repos =
      allRepoIds.length > 0
        ? await this.repoRepo.find({
            where: { id: In(allRepoIds) },
            select: ['id', 'provider', 'projectKey', 'repoSlug', 'defaultBranch', 'status', 'lastSyncAt'],
          })
        : [];
    const repoMap = new Map(repos.map((r) => [r.id, r]));
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      repositories: (repoIdsByProject.get(p.id) ?? [])
        .map((rid) => repoMap.get(rid))
        .filter(Boolean)
        .map((r) => ({
          id: r!.id,
          provider: r!.provider,
          projectKey: r!.projectKey,
          repoSlug: r!.repoSlug,
          defaultBranch: r!.defaultBranch,
          status: r!.status,
          lastSyncAt: r!.lastSyncAt?.toISOString() ?? null,
          role: roleByProjectRepo.get(`${p.id}:${r!.id}`) ?? null,
        })),
    }));
  }

  /**
   * Resuelve qué repositorio del proyecto encaja con una ruta del IDE (heurística multi-root).
   */
  async resolveRepoForPath(
    projectId: string,
    filePath: string,
  ): Promise<{ projectId: string; repoId: string | null; score: number; match?: string }> {
    await this.findOne(projectId);
    const prs = await this.projectRepoRepo.find({
      where: { projectId },
      select: ['repoId'],
    });
    const repoIds = prs.map((pr) => pr.repoId);
    const repositories =
      repoIds.length > 0
        ? await this.repoRepo.find({
            where: { id: In(repoIds) },
            select: ['id', 'projectKey', 'repoSlug'],
          })
        : [];
    const resolution = resolveRepoIdForAbsolutePath(filePath, repositories);
    return {
      projectId,
      repoId: resolution.repoId,
      score: resolution.score,
      match: resolution.match,
    };
  }

  /**
   * Actualiza la etiqueta `role` en `project_repositories` (inferencia de alcance en chat multi-root).
   */
  async setRepositoryRole(
    projectId: string,
    repoId: string,
    role?: string | null,
  ): Promise<{ projectId: string; repoId: string; role: string | null }> {
    await this.findOne(projectId);
    const pr = await this.projectRepoRepo.findOne({ where: { projectId, repoId } });
    if (!pr) {
      throw new NotFoundException(`Repositorio ${repoId} no asociado al proyecto ${projectId}`);
    }
    if (role !== undefined) {
      pr.role = role?.trim() ? role.trim() : null;
      await this.projectRepoRepo.save(pr);
    }
    return { projectId, repoId, role: pr.role };
  }

  /**
   * Resolución multi-root con resultado único, ninguno o ambiguo (empates en heurística de path).
   */
  async resolveRepositoryForWorkspacePath(
    projectId: string,
    workspaceAbsolutePath: string,
  ): Promise<WorkspacePathRepoResolution> {
    const { repositories } = await this.findOne(projectId);
    if (repositories.length === 0) {
      return { kind: 'none' };
    }
    const inputs: RepoPathMatchInput[] = repositories.map((r) => ({
      repositoryId: r.id,
      projectKey: r.projectKey,
      repoSlug: r.repoSlug,
    }));
    return resolveRepositoryIdForWorkspacePath(workspaceAbsolutePath, inputs);
  }

  /**
   * Bloque markdown de roles por repo para el prompt del chat multi-root.
   */
  async getRepositoryRolesContext(projectId: string): Promise<string> {
    const prs = await this.projectRepoRepo.find({
      where: { projectId },
      select: ['repoId', 'role'],
    });
    if (prs.length === 0) return '';
    const repoIds = prs.map((p) => p.repoId);
    const repos = await this.repoRepo.find({
      where: { id: In(repoIds) },
      select: ['id', 'projectKey', 'repoSlug'],
    });
    const label = new Map(repos.map((r) => [r.id, `${r.projectKey}/${r.repoSlug}`] as const));
    const lines = prs.map((pr) => {
      const slug = label.get(pr.repoId) ?? pr.repoId;
      const roleLabel = pr.role?.trim() ? pr.role.trim() : 'sin rol definido';
      return `- \`${slug}\` — \`repoId\`=\`${pr.repoId}\` — **rol:** ${roleLabel}`;
    });
    return [
      'Cuando el usuario pregunte por el backend, frontend, API, librería de componentes, etc., usa **solo** el repositorio cuyo **rol** encaje con la pregunta. Filtra rutas y resultados Cypher por `repoId` según corresponda.',
      '',
      ...lines,
    ].join('\n');
  }

  /** Metadatos de enrutamiento Falkor (MCP/API): modo mono vs dominio y segmentos conocidos. */
  async getGraphRouting(id: string): Promise<{
    projectId: string;
    shardMode: FalkorShardMode;
    domainSegments: string[];
    graphNodeSoftLimit: number;
  }> {
    const project = await this.projectRepo.findOne({ where: { id } });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    const shardMode = effectiveShardMode(project.falkorShardMode);
    const domainSegments = Array.isArray(project.falkorDomainSegments) ? project.falkorDomainSegments : [];
    return {
      projectId: id,
      shardMode,
      domainSegments,
      graphNodeSoftLimit: getGraphNodeSoftLimit(),
    };
  }

  async findOne(id: string): Promise<ProjectWithRepos> {
    const project = await this.projectRepo.findOne({ where: { id } });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    const prs = await this.projectRepoRepo.find({
      where: { projectId: id },
      select: ['repoId', 'role'],
    });
    const repoIds = prs.map((pr) => pr.repoId);
    const roleByRepo = new Map(prs.map((pr) => [pr.repoId, pr.role ?? null] as const));
    const repositories =
      repoIds.length > 0
        ? await this.repoRepo.find({
            where: { id: In(repoIds) },
            select: ['id', 'provider', 'projectKey', 'repoSlug', 'defaultBranch', 'status', 'lastSyncAt'],
          })
        : [];
    return {
      id: project.id,
      name: project.name,
      description: project.description ?? null,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      repositories: repositories.map((r) => ({
        id: r.id,
        provider: r.provider,
        projectKey: r.projectKey,
        repoSlug: r.repoSlug,
        defaultBranch: r.defaultBranch,
        status: r.status,
        lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
        role: roleByRepo.get(r.id) ?? null,
      })),
    };
  }

  async create(dto: { name?: string | null; description?: string | null }): Promise<ProjectEntity> {
    const entity = this.projectRepo.create({
      name: dto.name?.trim() || null,
      description: dto.description !== undefined ? (dto.description?.trim() || null) : null,
    });
    return this.projectRepo.save(entity);
  }

  async update(id: string, dto: { name?: string | null; description?: string | null }): Promise<ProjectEntity> {
    await this.findOne(id);
    const updates: { name?: string | null; description?: string | null } = {};
    if (dto.name !== undefined) updates.name = dto.name?.trim() || null;
    if (dto.description !== undefined) updates.description = dto.description?.trim() || null;
    if (Object.keys(updates).length > 0) {
      await this.projectRepo.update(id, updates);
    }
    return this.projectRepo.findOneOrFail({ where: { id } });
  }

  /** Elimina un proyecto. Se desasocian los repos (se borran filas de project_repositories); los repos no se eliminan. */
  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.projectRepoRepo.delete({ projectId: id });
    await this.projectRepo.delete(id);
  }

  /**
   * Regenera el ID del proyecto: nuevo UUID, migra asociaciones y FalkorDB.
   * No pierde información; los repos y el grafo se conservan.
   */
  async regenerateId(projectId: string): Promise<{ newProjectId: string }> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const newProjectId = randomUUID();
    const prs = await this.projectRepoRepo.find({
      where: { projectId },
      select: ['repoId'],
    });

    await this.projectRepo.insert({
      id: newProjectId,
      name: project.name,
      description: project.description ?? null,
      falkorShardMode: project.falkorShardMode,
      falkorDomainSegments: project.falkorDomainSegments,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    for (const pr of prs) {
      await this.projectRepoRepo.save(
        this.projectRepoRepo.create({ repoId: pr.repoId, projectId: newProjectId }),
      );
    }
    await this.projectRepoRepo.delete({ projectId });
    await this.projectRepo.delete(projectId);

    const config = getFalkorConfig();
    const client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
    try {
      const shardMode = effectiveShardMode(project.falkorShardMode);
      const segments = Array.isArray(project.falkorDomainSegments) ? project.falkorDomainSegments : [];
      const graphNames = listGraphNamesForProjectRouting(
        projectId,
        shardMode === 'domain' ? 'domain' : 'project',
        segments,
      );
      for (const gName of graphNames) {
        const graph = client.selectGraph(gName);
        try {
          await graph.query(`MATCH (n) WHERE n.projectId = $oldId SET n.projectId = $newId`, {
            params: { oldId: projectId, newId: newProjectId },
          });
          await graph.query(`MATCH (p:Project) WHERE p.projectId = $oldId SET p.projectId = $newId`, {
            params: { oldId: projectId, newId: newProjectId },
          });
        } catch {
          /* grafo ausente */
        }
      }
    } finally {
      await client.close();
    }

    return { newProjectId };
  }
}
