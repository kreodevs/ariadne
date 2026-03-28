import { MigrationInterface, QueryRunner } from 'typeorm';

/** Tabla mínima para marcar operaciones de arranque ya aplicadas (p. ej. FLUSHALL Falkor una sola vez). */
export class IngestRuntimeFlags1743100000000 implements MigrationInterface {
  name = 'IngestRuntimeFlags1743100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ingest_runtime_flags" (
        "flag_key" character varying(128) NOT NULL,
        "applied_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ingest_runtime_flags" PRIMARY KEY ("flag_key")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ingest_runtime_flags"`);
  }
}
