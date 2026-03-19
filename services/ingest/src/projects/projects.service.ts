/**
 * @fileoverview CRUD de proyectos (multi-root). Un proyecto agrupa N repositorios.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProjectEntity } from './entities/project.entity';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { ProjectRepositoryEntity } from '../repositories/entities/project-repository.entity';

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
            select: ['projectId', 'repoId'],
          })
        : [];
    const repoIdsByProject = new Map<string, string[]>();
    for (const pr of prs) {
      if (!repoIdsByProject.has(pr.projectId)) repoIdsByProject.set(pr.projectId, []);
      repoIdsByProject.get(pr.projectId)!.push(pr.repoId);
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
        })),
    }));
  }

  async findOne(id: string): Promise<ProjectWithRepos> {
    const project = await this.projectRepo.findOne({ where: { id } });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    const prs = await this.projectRepoRepo.find({
      where: { projectId: id },
      select: ['repoId'],
    });
    const repoIds = prs.map((pr) => pr.repoId);
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
}
