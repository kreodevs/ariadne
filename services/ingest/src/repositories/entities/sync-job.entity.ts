/**
 * @fileoverview Entidad sync_jobs: job de sincronización (full, incremental).
 */
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { RepositoryEntity } from './repository.entity';

/** Tipo de sync: full o incremental. */
export type SyncJobType = 'full' | 'incremental';
/** Estado del job: queued (en cola), running, completed, failed. */
export type SyncJobStatus = 'queued' | 'running' | 'completed' | 'failed';

/** Job de sincronización (BullMQ). Payload con phase, indexed, etc. */
@Entity('sync_jobs')
export class SyncJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'repository_id', type: 'uuid' })
  repositoryId!: string;

  @ManyToOne(() => RepositoryEntity, (repo) => repo.syncJobs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repository_id' })
  repository!: RepositoryEntity;

  @Column({ type: 'varchar', length: 32 })
  type!: SyncJobType;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'varchar', length: 32 })
  status!: SyncJobStatus;

  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;
}
