/**
 * @fileoverview CRUD de repositorios y jobs de sync en PostgreSQL.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { RepositoryEntity } from './entities/repository.entity';
import { ProjectRepositoryEntity } from './entities/project-repository.entity';
import { SyncJob } from './entities/sync-job.entity';
import { ProjectEntity } from '../projects/entities/project.entity';
import { CreateRepositoryDto } from './dto/create-repository.dto';
import { UpdateRepositoryDto } from './dto/update-repository.dto';
import { encrypt, decrypt } from '../credentials/crypto.util';
import { EmbeddingSpaceService } from '../embedding/embedding-space.service';

/** Servicio de repositorios: create, findAll, findOne, update, remove, jobs. */
@Injectable()
export class RepositoriesService {
  constructor(
    @InjectRepository(RepositoryEntity)
    private readonly repo: Repository<RepositoryEntity>,
    @InjectRepository(ProjectRepositoryEntity)
    private readonly projectRepoRepo: Repository<ProjectRepositoryEntity>,
    @InjectRepository(SyncJob)
    private readonly jobsRepo: Repository<SyncJob>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    private readonly embeddingSpaces: EmbeddingSpaceService,
  ) {}

  private encryptWebhookSecret(value: string): string | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    try {
      return encrypt(trimmed);
    } catch {
      return null;
    }
  }

  /**
   * Crea un repositorio. Si dto.projectId viene, se asocia a ese proyecto (insert en project_repositories).
   * @param {CreateRepositoryDto} dto - Datos del repositorio.
   * @returns {Promise<RepositoryEntity>} Entidad guardada.
   */
  async create(dto: CreateRepositoryDto): Promise<RepositoryEntity> {
    const entity = this.repo.create({
      provider: dto.provider,
      projectKey: dto.projectKey,
      repoSlug: dto.repoSlug,
      defaultBranch: dto.defaultBranch ?? 'main',
      credentialsRef: dto.credentialsRef ?? null,
      webhookSecretEncrypted: this.encryptWebhookSecret(dto.webhookSecret ?? '') ?? null,
      status: 'pending',
    });
    const saved = await this.repo.save(entity);
    if (dto.projectId) {
      await this.projectRepoRepo.save(
        this.projectRepoRepo.create({ repoId: saved.id, projectId: dto.projectId }),
      );
    }
    return saved;
  }

  /**
   * Lista repositorios. Si projectId se proporciona, solo los que participan en ese proyecto.
   * @param projectId - Opcional: filtrar por proyecto.
   * @returns {Promise<RepositoryEntity[]>}
   */
  async findAll(projectId?: string): Promise<RepositoryEntity[]> {
    if (!projectId) {
      return this.repo.find({ order: { createdAt: 'DESC' } });
    }
    const prs = await this.projectRepoRepo.find({
      where: { projectId },
      select: ['repoId'],
    });
    const repoIds = prs.map((pr) => pr.repoId);
    if (repoIds.length === 0) return [];
    return this.repo.find({
      where: { id: In(repoIds) },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * IDs de proyectos en los que participa el repo (muchos a muchos).
   * @param repoId - UUID del repositorio.
   * @returns {Promise<string[]>}
   */
  async getProjectIdsForRepo(repoId: string): Promise<string[]> {
    const prs = await this.projectRepoRepo.find({
      where: { repoId },
      select: ['projectId'],
    });
    return prs.map((pr) => pr.projectId);
  }

  /**
   * Asocia un repo a un proyecto (añade a project_repositories). Idempotente.
   */
  async addRepoToProject(repoId: string, projectId: string): Promise<void> {
    await this.findOne(repoId);
    const existing = await this.projectRepoRepo.findOne({
      where: { repoId, projectId },
    });
    if (!existing) {
      await this.projectRepoRepo.save(
        this.projectRepoRepo.create({ repoId, projectId }),
      );
    }
  }

  /**
   * Desasocia un repo de un proyecto (borra de project_repositories).
   */
  async removeRepoFromProject(repoId: string, projectId: string): Promise<void> {
    await this.projectRepoRepo.delete({ repoId, projectId });
  }

  /**
   * Obtiene un repositorio por ID. Lanza NotFoundException si no existe.
   * @param {string} id - UUID del repositorio.
   * @returns {Promise<RepositoryEntity>}
   */
  async findOne(id: string): Promise<RepositoryEntity> {
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Repository ${id} not found`);
    return entity;
  }

  /**
   * @description Resuelve un repositorio por UUID sin lanzar si no existe (p. ej. distinguir projectId vs repoId en rutas multi-root).
   * @param {string} id - UUID del repositorio.
   * @returns {Promise<RepositoryEntity | null>}
   */
  async findOptionalById(id: string): Promise<RepositoryEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * Actualiza un repositorio (defaultBranch, credentialsRef, webhookSecret). Campos no enviados no se modifican.
   * @param {string} id - UUID del repositorio.
   * @param {UpdateRepositoryDto} dto - Campos a actualizar.
   * @returns {Promise<RepositoryEntity>} Entidad actualizada.
   */
  async update(id: string, dto: UpdateRepositoryDto): Promise<RepositoryEntity> {
    await this.findOne(id);
    const updates: {
      defaultBranch?: string;
      credentialsRef?: string | null;
      webhookSecretEncrypted?: string | null;
      readEmbeddingSpaceId?: string | null;
      writeEmbeddingSpaceId?: string | null;
    } = {};
    if (dto.defaultBranch != null) updates.defaultBranch = dto.defaultBranch || 'main';
    if (dto.credentialsRef !== undefined) updates.credentialsRef = dto.credentialsRef ?? null;
    if (dto.webhookSecret !== undefined) {
      updates.webhookSecretEncrypted =
        dto.webhookSecret != null && dto.webhookSecret.trim() !== ''
          ? this.encryptWebhookSecret(dto.webhookSecret)
          : null;
    }
    if (dto.readEmbeddingSpaceId !== undefined) {
      const v = dto.readEmbeddingSpaceId;
      if (v) await this.embeddingSpaces.assertExists(v);
      updates.readEmbeddingSpaceId = v ?? null;
    }
    if (dto.writeEmbeddingSpaceId !== undefined) {
      const v = dto.writeEmbeddingSpaceId;
      if (v) await this.embeddingSpaces.assertExists(v);
      updates.writeEmbeddingSpaceId = v ?? null;
    }
    if (dto.projectId != null && dto.projectId.trim() !== '') await this.addRepoToProject(id, dto.projectId);
    if (Object.keys(updates).length > 0) await this.repo.update(id, updates);
    return this.findOne(id);
  }

  /** Obtiene el webhook secret del repo Bitbucket (para validar firma). Fallback a null si no hay. */
  async getWebhookSecretForBitbucket(
    workspace: string,
    repoSlug: string,
  ): Promise<string | null> {
    const entity = await this.repo.findOne({
      where: { provider: 'bitbucket', projectKey: workspace, repoSlug },
      select: ['id', 'webhookSecretEncrypted'],
    });
    if (!entity?.webhookSecretEncrypted) return null;
    try {
      return decrypt(entity.webhookSecretEncrypted);
    } catch {
      return null;
    }
  }

  async findJobsByRepositoryId(repositoryId: string): Promise<SyncJob[]> {
    await this.findOne(repositoryId); // ensure repo exists
    return this.jobsRepo.find({
      where: { repositoryId },
      order: { startedAt: 'DESC' },
      take: 100,
    });
  }

  /**
   * Jobs de sync pendientes o en curso en todo el sistema (cola global).
   * Orden: más antiguos primero (FIFO aproximado).
   */
  async findActiveJobsGlobal(): Promise<
    Array<{
      id: string;
      repositoryId: string;
      type: SyncJob['type'];
      startedAt: Date;
      finishedAt: Date | null;
      status: SyncJob['status'];
      payload: Record<string, unknown> | null;
      errorMessage: string | null;
      repository: {
        id: string;
        provider: string;
        projectKey: string;
        repoSlug: string;
        defaultBranch: string;
      };
    }>
  > {
    const rows = await this.jobsRepo.find({
      where: { status: In(['queued', 'running']) },
      relations: ['repository'],
      order: { startedAt: 'ASC' },
    });
    return rows.map((j) => ({
      id: j.id,
      repositoryId: j.repositoryId,
      type: j.type,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      status: j.status,
      payload: j.payload,
      errorMessage: j.errorMessage,
      repository: {
        id: j.repository.id,
        provider: j.repository.provider,
        projectKey: j.repository.projectKey,
        repoSlug: j.repository.repoSlug,
        defaultBranch: j.repository.defaultBranch,
      },
    }));
  }

  async removeJob(repositoryId: string, jobId: string): Promise<void> {
    await this.findOne(repositoryId);
    const r = await this.jobsRepo.delete({
      id: jobId,
      repositoryId,
    });
    if (r.affected === 0) throw new NotFoundException(`Job ${jobId} not found`);
  }

  async removeAllJobs(repositoryId: string): Promise<number> {
    await this.findOne(repositoryId);
    const r = await this.jobsRepo.delete({ repositoryId });
    return r.affected ?? 0;
  }

  /**
   * Elimina jobs antiguos, manteniendo solo los últimos `keepCount` por repositorio.
   * Llamar tras cada sync (full o incremental) completado.
   */
  async pruneOldJobs(repositoryId: string, keepCount = 5): Promise<number> {
    const keep = await this.jobsRepo.find({
      where: { repositoryId },
      order: { startedAt: 'DESC' },
      take: keepCount,
      select: ['id'],
    });
    if (keep.length < keepCount) return 0;
    const idsToKeep = new Set(keep.map((j) => j.id));
    const all = await this.jobsRepo.find({
      where: { repositoryId },
      order: { startedAt: 'DESC' },
      select: ['id'],
    });
    const toDelete = all.filter((j) => !idsToKeep.has(j.id)).map((j) => j.id);
    if (toDelete.length === 0) return 0;
    const r = await this.jobsRepo.delete({ id: In(toDelete) });
    return r.affected ?? 0;
  }

  /**
   * Elimina un repositorio por ID. Lanza si no existe.
   * @param {string} id - UUID del repositorio.
   * @returns {Promise<void>}
   */
  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.repo.delete(id);
  }

  /**
   * Repositorio con projectIds (proyectos a los que pertenece vía project_repositories).
   * Si projectIds está vacío, el sistema usa repo.id como projectId efectivo en FalkorDB.
   */
  async findOneWithProjectIds(id: string): Promise<RepositoryEntity & { projectIds: string[] }> {
    const entity = await this.findOne(id);
    const projectIds = await this.getProjectIdsForRepo(id);
    return { ...entity, projectIds };
  }
}
