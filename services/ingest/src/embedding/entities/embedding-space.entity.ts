/**
 * @fileoverview Catálogo versionado de espacios vectoriales (proveedor, modelo, dimensión, propiedad en Falkor).
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('embedding_spaces')
export class EmbeddingSpaceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Clave estable legible (ej. openai_te3s_1536) para logs y UI. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  key!: string;

  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  @Column({ name: 'model_id', type: 'varchar', length: 256 })
  modelId!: string;

  @Column({ type: 'int' })
  dimension!: number;

  /**
   * Nombre de propiedad en nodos Falkor (Function, Component, Document). Debe ser identificador Cypher válido.
   * Convive con otras propiedades durante migración (ej. embedding vs emb_nomic_768).
   */
  @Index({ unique: true })
  @Column({ name: 'graph_property', type: 'varchar', length: 128 })
  graphProperty!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
