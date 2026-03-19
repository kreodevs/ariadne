import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Muchos a muchos: tabla project_repositories; se elimina repositories.project_id.
 * Un repo puede participar en 0, 1 o N proyectos. Backfill desde project_id.
 */
export class ProjectRepositoriesManyToMany1739180700000 implements MigrationInterface {
  name = 'ProjectRepositoriesManyToMany1739180700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "project_repositories" (
        "repo_id" uuid NOT NULL,
        "project_id" uuid NOT NULL,
        CONSTRAINT "PK_project_repositories" PRIMARY KEY ("repo_id", "project_id"),
        CONSTRAINT "FK_project_repositories_repo" FOREIGN KEY ("repo_id") REFERENCES "repositories"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_project_repositories_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_project_repositories_project_id" ON "project_repositories" ("project_id")
    `);
    await queryRunner.query(`
      INSERT INTO "project_repositories" ("repo_id", "project_id")
      SELECT "id", "project_id" FROM "repositories" WHERE "project_id" IS NOT NULL
    `);
    await queryRunner.query(`ALTER TABLE "repositories" DROP COLUMN "project_id"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "repositories" ADD COLUMN "project_id" uuid NULL REFERENCES "projects"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      UPDATE "repositories" r SET "project_id" = (
        SELECT pr."project_id" FROM "project_repositories" pr WHERE pr."repo_id" = r."id" LIMIT 1
      )
    `);
    await queryRunner.query(`DROP TABLE "project_repositories"`);
  }
}
