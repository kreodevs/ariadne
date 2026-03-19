/**
 * @fileoverview Entidad repositories: repo Bitbucket/GitHub (provider, projectKey, repoSlug, credentialsRef, webhook secret cifrado).
 */
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { SyncJob } from './sync-job.entity';
import { IndexedFile } from './indexed-file.entity';
import { ProjectRepositoryEntity } from './project-repository.entity';

export type RepositoryStatus = 'pending' | 'syncing' | 'ready' | 'error';

@Entity('repositories')
export class RepositoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  provider!: string;

  @Column({ name: 'project_key', type: 'varchar', length: 256 })
  projectKey!: string;

  @Column({ name: 'repo_slug', type: 'varchar', length: 256 })
  repoSlug!: string;

  @Column({ name: 'default_branch', type: 'varchar', length: 256, default: 'main' })
  defaultBranch!: string;

  @Column({ name: 'credentials_ref', type: 'varchar', length: 512, nullable: true })
  credentialsRef!: string | null;

  /** Webhook secret por repositorio (HMAC). Cifrado con CREDENTIALS_ENCRYPTION_KEY. */
  @Column({ name: 'webhook_secret_encrypted', type: 'varchar', length: 512, nullable: true, select: false })
  webhookSecretEncrypted!: string | null;

  @Column({ name: 'last_sync_at', type: 'timestamptz', nullable: true })
  lastSyncAt!: Date | null;

  /** Last processed commit SHA — webhook bridge for diff-based incremental sync */
  @Column({ name: 'last_commit_sha', type: 'varchar', length: 64, nullable: true })
  lastCommitSha!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: RepositoryStatus;

  /** Patrones de dominio inferidos en primera ingesta (componentPatterns, constNames). Por proyecto. */
  @Column({ name: 'domain_config', type: 'jsonb', nullable: true })
  domainConfig!: { componentPatterns?: string[]; constNames?: string[] } | null;

  @OneToMany(() => ProjectRepositoryEntity, (pr) => pr.repository)
  projectRepos!: ProjectRepositoryEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => SyncJob, (job) => job.repository)
  syncJobs!: SyncJob[];

  @OneToMany(() => IndexedFile, (file) => file.repository)
  indexedFiles!: IndexedFile[];
}
