import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rol opcional de cada repositorio dentro de un proyecto (p. ej. frontend, backend).
 * Timestamp `1743200000000`: evita colisión con `1739180800000-EmbeddingSpaces` en este repo.
 * Ver `docs/comparativa/MIGRACIONES_CADENA_ARIADNE.md`.
 */
export class ProjectRepositoryRole1743200000000 implements MigrationInterface {
  name = 'ProjectRepositoryRole1743200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "project_repositories"
      ADD COLUMN IF NOT EXISTS "role" character varying(128) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "project_repositories" DROP COLUMN IF EXISTS "role"`);
  }
}
