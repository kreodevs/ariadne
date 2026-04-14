/**
 * @fileoverview Unión muchos a muchos: repo participa en proyecto. Un repo puede estar en 0, 1 o N proyectos.
 */
import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { RepositoryEntity } from './repository.entity';
import { ProjectEntity } from '../../projects/entities/project.entity';

@Entity('project_repositories')
export class ProjectRepositoryEntity {
  @PrimaryColumn({ name: 'repo_id', type: 'uuid' })
  repoId!: string;

  @PrimaryColumn({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  /** Etiqueta opcional multi-root (p. ej. frontend / backend) para inferencia de alcance en chat. */
  @Column({ name: 'role', type: 'varchar', length: 128, nullable: true })
  role!: string | null;

  @ManyToOne(() => RepositoryEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repo_id' })
  repository!: RepositoryEntity;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;
}
