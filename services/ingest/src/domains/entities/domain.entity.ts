/**
 * @fileoverview Dominio de gobierno de arquitectura (C4 L1, color UI/PlantUML).
 */
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('domains')
export class DomainEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 256 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** Hex para UI / PlantUML (#RRGGBB). */
  @Column({ type: 'varchar', length: 16, default: '#6366f1' })
  color!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
