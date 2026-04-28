/**
 * @fileoverview CRUD de repositorios y jobs de sync en PostgreSQL.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
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
import { parseIndexIncludeRulesFromDto } from '../providers/index-include-rules';
import { SYNC_QUEUE } from '../sync/sync.processor';

/** Servicio de repositorios: create, findAll, findOne, update, remove, jobs. */
@Injectable()
export class RepositoriesService {
  constructor(
    @InjectQueue(SYNC_QUEUE) private readonly syncQueue: Queue,
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
      indexIncludeRules?: ReturnType<typeof parseIndexIncludeRulesFromDto>;
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
    if (dto.indexIncludeRules !== undefined) {
      updates.indexIncludeRules = parseIndexIncludeRulesFromDto(dto.indexIncludeRules);
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
   * Cola global de sync: jobs en cola o en curso + terminados recientes (auditoría).
   * Los completados conservan `payload` (indexed, skipped, skippedPaths, etc.) hasta `pruneOldJobs`.
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
    const recentLimit = (() => {
      const raw = process.env.SYNC_QUEUE_RECENT_JOBS?.trim();
      const n = raw ? parseInt(raw, 10) : 100;
      return Number.isFinite(n) && n >= 1 ? Math.min(n, 500) : 100;
    })();

    const active = await this.jobsRepo.find({
      where: { status: In(['queued', 'running']) },
      relations: ['repository'],
      order: { startedAt: 'ASC' },
    });
    const recentTerminal = await this.jobsRepo.find({
      where: { status: In(['completed', 'failed']) },
      relations: ['repository'],
      order: { finishedAt: 'DESC' },
      take: recentLimit,
    });
    const activeIds = new Set(active.map((j) => j.id));
    const merged = [...active, ...recentTerminal.filter((j) => !activeIds.has(j.id))];
    merged.sort((a, b) => {
      const aAct = a.status === 'queued' || a.status === 'running' ? 0 : 1;
      const bAct = b.status === 'queued' || b.status === 'running' ? 0 : 1;
      if (aAct !== bAct) return aAct - bAct;
      if (aAct === 0) return a.startedAt.getTime() - b.startedAt.getTime();
      return (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0);
    });

    return merged.map((j) => ({
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

  /**
   * Quita de Redis (BullMQ) jobs `full-sync` que apuntan a este syncJobId.
   * Sin esto, borrar solo la fila en Postgres deja workers reintentando contra un UUID inexistente.
   */
  private async removeBullJobsForSyncJob(repositoryId: string, syncJobId: string): Promise<number> {
    let removed = 0;
    const states = ['waiting', 'delayed', 'paused', 'waiting-children', 'active'] as const;
    for (const state of states) {
      const jobs = await this.syncQueue.getJobs([state], 0, 2000);
      for (const j of jobs) {
        const d = j.data as { repositoryId?: string; syncJobId?: string };
        if (d?.repositoryId === repositoryId && d?.syncJobId === syncJobId) {
          try {
            await j.remove();
            removed++;
          } catch {
            /* active job puede estar locked por el worker */
          }
        }
      }
    }
    return removed;
  }

  /**
   * Cancela un job en cola o en curso: limpia Bull y marca el registro como failed (el worker no sobrescribe a completed).
   */
  async cancelJob(repositoryId: string, jobId: string): Promise<{ bullRemoved: number }> {
    await this.findOne(repositoryId);
    const job = await this.jobsRepo.findOne({ where: { id: jobId, repositoryId } });
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);
    if (job.status !== 'queued' && job.status !== 'running') {
      throw new BadRequestException('Solo se pueden cancelar jobs en cola o en ejecución');
    }
    const bullRemoved = await this.removeBullJobsForSyncJob(repositoryId, jobId);
    await this.jobsRepo.update(jobId, {
      status: 'failed',
      errorMessage: 'Cancelado desde la cola de sincronización',
      finishedAt: new Date(),
    });
    return { bullRemoved };
  }

  async removeJob(repositoryId: string, jobId: string): Promise<void> {
    await this.findOne(repositoryId);
    await this.removeBullJobsForSyncJob(repositoryId, jobId);
    const r = await this.jobsRepo.delete({
      id: jobId,
      repositoryId,
    });
    if (r.affected === 0) throw new NotFoundException(`Job ${jobId} not found`);
  }

  async removeAllJobs(repositoryId: string): Promise<number> {
    await this.findOne(repositoryId);
    const rows = await this.jobsRepo.find({
      where: { repositoryId },
      select: ['id'],
    });
    for (const row of rows) {
      await this.removeBullJobsForSyncJob(repositoryId, row.id);
    }
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
