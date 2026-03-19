/**
 * @fileoverview Unión muchos a muchos: repo participa en proyecto. Un repo puede estar en 0, 1 o N proyectos.
 */
import { Entity, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { RepositoryEntity } from './repository.entity';
import { ProjectEntity } from '../../projects/entities/project.entity';

@Entity('project_repositories')
export class ProjectRepositoryEntity {
  @PrimaryColumn({ name: 'repo_id', type: 'uuid' })
  repoId!: string;

  @PrimaryColumn({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => RepositoryEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repo_id' })
  repository!: RepositoryEntity;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;
}
