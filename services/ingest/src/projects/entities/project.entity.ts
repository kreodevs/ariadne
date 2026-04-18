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
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { FalkorShardMode } from 'ariadne-common';
import { ProjectRepositoryEntity } from '../../repositories/entities/project-repository.entity';
import { DomainEntity } from '../../domains/entities/domain.entity';

@Entity('projects')
export class ProjectEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  name!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'falkor_shard_mode', type: 'varchar', length: 16, default: 'project' })
  falkorShardMode!: FalkorShardMode;

  @Column({ name: 'falkor_domain_segments', type: 'jsonb', nullable: true })
  falkorDomainSegments!: string[] | null;

  @Column({ name: 'domain_id', type: 'uuid', nullable: true })
  domainId!: string | null;

  @ManyToOne(() => DomainEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'domain_id' })
  domain!: DomainEntity | null;

  @OneToMany(() => ProjectRepositoryEntity, (pr) => pr.project)
  projectRepos!: ProjectRepositoryEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
