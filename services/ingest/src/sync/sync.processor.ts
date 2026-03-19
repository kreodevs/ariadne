/**
 * @fileoverview Worker BullMQ que procesa jobs de full sync.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { SyncService } from './sync.service';

/** Nombre de la cola BullMQ para sync. */
export const SYNC_QUEUE = 'sync';

/** Procesa jobs sync encolados (concurrency 1, limiter 2/min). */
@Processor(SYNC_QUEUE, {
  concurrency: 1,
  limiter: { max: 2, duration: 60_000 },
})
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(private readonly syncService: SyncService) {
    super();
  }

  /**
   * Procesa un job de sync: ejecuta runFullSync del SyncService para el repositorio indicado.
   * @param job - Job BullMQ con repositoryId, opcional syncJobId y opcional onlyProjectId (resync solo ese proyecto).
   * @returns jobId e indexed.
   */
  async process(
    job: Job<{ repositoryId: string; syncJobId?: string; onlyProjectId?: string }>,
  ): Promise<{ jobId: string; indexed: number }> {
    const { repositoryId, syncJobId, onlyProjectId } = job.data;
    this.logger.log(
      `Processing sync job ${job.id} for repository ${repositoryId}${onlyProjectId ? ` (project ${onlyProjectId})` : ''}`,
    );
    try {
      const result = await this.syncService.runFullSync(repositoryId, syncJobId, {
        ...(onlyProjectId && { onlyProjectId }),
      });
      this.logger.log(`Sync job ${job.id} completed — indexed ${result.indexed} files`);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Sync job ${job.id} failed: ${msg}`);
      throw err;
    }
  }
}
