/**
 * @fileoverview Controlador para encolar sync (full), resync (borrar grafo + sync) y resync solo por proyecto.
 */
import { Body, Controller, Param, Post } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SYNC_QUEUE } from './sync.processor';
import { SyncService } from './sync.service';

/** Endpoints POST /repositories/:id/sync, :id/resync, :id/resync-for-project. */
@Controller('repositories')
export class SyncController {
  constructor(
    @InjectQueue(SYNC_QUEUE) private readonly syncQueue: Queue,
    private readonly syncService: SyncService,
  ) {}

  /**
   * Encola un job de sync completo para el repositorio (todos los proyectos del repo).
   */
  @Post(':id/sync')
  async triggerSync(@Param('id') id: string) {
    const syncJob = await this.syncService.createQueuedJob(id);
    await this.syncQueue.add(
      'full-sync',
      { repositoryId: id, syncJobId: syncJob.id },
      { removeOnComplete: { count: 100 } },
    );
    return { jobId: syncJob.id, queued: true };
  }

  /**
   * Borra solo los nodos Falkor de este repo (por participación projectId+repoId) y encola sync completo.
   */
  @Post(':id/resync')
  async resync(@Param('id') id: string) {
    const { deletedNodes } = await this.syncService.clearRepositoryForResync(id);
    const syncJob = await this.syncService.createQueuedJob(id);
    await this.syncQueue.add(
      'full-sync',
      { repositoryId: id, syncJobId: syncJob.id },
      { removeOnComplete: { count: 100 } },
    );
    return { jobId: syncJob.id, queued: true, deletedNodes };
  }

  /**
   * Resync solo para un proyecto: borra nodos (projectId, repoId) y encola sync que solo escribe en ese proyecto.
   * Body: { projectId: string }.
   */
  @Post(':id/resync-for-project')
  async resyncForProject(
    @Param('id') id: string,
    @Body() body: { projectId: string },
  ) {
    const projectId = body?.projectId?.trim();
    if (!projectId) {
      return { jobId: null, queued: false, error: 'projectId required' };
    }
    const syncJob = await this.syncService.createQueuedJob(id);
    await this.syncQueue.add(
      'full-sync',
      { repositoryId: id, syncJobId: syncJob.id, onlyProjectId: projectId },
      { removeOnComplete: { count: 100 } },
    );
    return { jobId: syncJob.id, queued: true };
  }
}
