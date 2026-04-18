/**
 * @fileoverview Visibilidad dirigida entre dominios (C4 / shards Falkor: qué otros dominios se incluyen en el contexto).
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
import { DomainEntity } from './domain.entity';

@Entity('domain_domain_visibility')
@Unique(['fromDomainId', 'toDomainId'])
@Index(['fromDomainId'])
@Index(['toDomainId'])
export class DomainDomainVisibilityEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'from_domain_id', type: 'uuid' })
  fromDomainId!: string;

  @ManyToOne(() => DomainEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'from_domain_id' })
  fromDomain!: DomainEntity;

  @Column({ name: 'to_domain_id', type: 'uuid' })
  toDomainId!: string;

  @ManyToOne(() => DomainEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'to_domain_id' })
  toDomain!: DomainEntity;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
