/**
 * @fileoverview Entidad credentials: credencial cifrada (provider, kind, encryptedValue, name, extra).
 */
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CredentialProvider = 'bitbucket' | 'github';
export type CredentialKind =
  | 'token'           // OAuth/PAT
  | 'app_password'   // Bitbucket App Password (needs username)
  | 'webhook_secret'; // Webhook HMAC secret (one per provider)

@Entity('credentials')
export class CredentialEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  provider!: CredentialProvider;

  @Column({ type: 'varchar', length: 32 })
  kind!: CredentialKind;

  /** Label for UI (e.g. "Workspace X token") */
  @Column({ type: 'varchar', length: 256, nullable: true })
  name!: string | null;

  /** AES-256-GCM encrypted payload (IV:12 + authTag:16 + ciphertext) */
  @Column({ name: 'encrypted_value', type: 'text' })
  encryptedValue!: string;

  /** Extra JSON: { username } for app_password */
  @Column({ type: 'jsonb', nullable: true })
  extra!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
