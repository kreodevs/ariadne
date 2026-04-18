/**
 * @fileoverview Dependencia de un proyecto hacia otro dominio (whitelist / contrato entre ecosistemas).
 */
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { ProjectEntity } from '../../projects/entities/project.entity';
import { DomainEntity } from './domain.entity';

@Entity('project_domain_dependencies')
@Unique(['projectId', 'dependsOnDomainId'])
@Index(['projectId'])
@Index(['dependsOnDomainId'])
export class ProjectDomainDependencyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;

  @Column({ name: 'depends_on_domain_id', type: 'uuid' })
  dependsOnDomainId!: string;

  @ManyToOne(() => DomainEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'depends_on_domain_id' })
  dependsOnDomain!: DomainEntity;

  /** REST, gRPC, Event, GraphQL, etc. */
  @Column({ name: 'connection_type', type: 'varchar', length: 32, default: 'REST' })
  connectionType!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
