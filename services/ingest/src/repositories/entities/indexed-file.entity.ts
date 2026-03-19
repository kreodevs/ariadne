/**
 * @fileoverview Entidad indexed_files: archivo indexado por repo.
 */
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { RepositoryEntity } from './repository.entity';

/** Archivo indexado en el grafo (path, revision, indexedAt). */
@Entity('indexed_files')
export class IndexedFile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'repository_id', type: 'uuid' })
  repositoryId!: string;

  @ManyToOne(() => RepositoryEntity, (repo) => repo.indexedFiles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repository_id' })
  repository!: RepositoryEntity;

  @Column({ type: 'varchar', length: 2048 })
  path!: string; // unique per repository_id (see unique constraint in migration)

  @Column({ type: 'varchar', length: 128, nullable: true })
  revision!: string | null;

  @Column({ name: 'indexed_at', type: 'timestamptz' })
  indexedAt!: Date;
}
