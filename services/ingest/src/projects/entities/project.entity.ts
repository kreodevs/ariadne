/**
 * @fileoverview Entidad projects: agrupa uno o más repositorios (multi-root). projectId en FalkorDB = este id.
 */
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { ProjectRepositoryEntity } from '../../repositories/entities/project-repository.entity';

@Entity('projects')
export class ProjectEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  name!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @OneToMany(() => ProjectRepositoryEntity, (pr) => pr.project)
  projectRepos!: ProjectRepositoryEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
