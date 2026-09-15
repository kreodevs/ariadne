/**
 * @fileoverview Snapshots C4Model + ruta HTML Archify por proyecto/nivel.
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { ArchifyArchitectureIr, C4Model } from 'ariadne-common';

@Entity('c4_model_snapshots')
@Index(['projectId', 'level', 'createdAt'])
export class C4SnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @Column({ name: 'repo_id', type: 'uuid', nullable: true })
  repoId!: string | null;

  @Column({ type: 'varchar', length: 32 })
  level!: string;

  @Column({ name: 'model_json', type: 'jsonb' })
  modelJson!: C4Model;

  @Column({ name: 'archify_json', type: 'jsonb', nullable: true })
  archifyJson!: ArchifyArchitectureIr | null;

  @Column({ name: 'archify_html_path', type: 'text', nullable: true })
  archifyHtmlPath!: string | null;

  @Column({ name: 'content_hash', type: 'varchar', length: 64 })
  contentHash!: string;

  @Column({ type: 'varchar', length: 16, default: 'sync' })
  generator!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
