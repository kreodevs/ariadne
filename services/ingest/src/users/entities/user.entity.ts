/**
 * @fileoverview Entidad users: usuarios con rol y token MCP para autenticación multi-usuario.
 */
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type UserRole = 'admin' | 'developer';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 512, unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 256, nullable: true })
  name!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'developer' })
  role!: UserRole;

  /** bcrypt hash del token MCP para validación. */
  @Column({ name: 'mcp_token_hash', type: 'varchar', length: 512, nullable: true })
  mcpTokenHash!: string | null;

  /** Prefijo del token (primeros 8 chars) para mostrar en UI. Se guarda solo para referencia visual. */
  @Column({ name: 'mcp_token_prefix', type: 'varchar', length: 16, nullable: true })
  mcpTokenPrefix!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
