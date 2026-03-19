import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Multi-root: tabla projects y repositories.project_id.
 * Backfill: un proyecto por repo existente (id = repo.id, project_id = id).
 */
export class ProjectsAndRepositoryProjectId1739180500000 implements MigrationInterface {
  name = 'ProjectsAndRepositoryProjectId1739180500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "projects" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(512),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_projects" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      INSERT INTO "projects" ("id", "name", "created_at", "updated_at")
      SELECT "id", "project_key" || '/' || "repo_slug", "created_at", "updated_at"
      FROM "repositories"
    `);

    await queryRunner.query(`
      ALTER TABLE "repositories"
      ADD COLUMN "project_id" uuid NULL
      REFERENCES "projects"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      UPDATE "repositories" SET "project_id" = "id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "repositories" DROP COLUMN "project_id"`);
    await queryRunner.query(`DROP TABLE "projects"`);
  }
}
