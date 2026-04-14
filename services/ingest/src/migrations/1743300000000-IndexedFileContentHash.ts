import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Huella de contenido por fila en indexed_files (sync/webhook, caché de analyze).
 */
export class IndexedFileContentHash1743300000000 implements MigrationInterface {
  name = 'IndexedFileContentHash1743300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "indexed_files"
      ADD COLUMN IF NOT EXISTS "content_hash" character varying(64) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "indexed_files" DROP COLUMN IF EXISTS "content_hash"`);
  }
}
