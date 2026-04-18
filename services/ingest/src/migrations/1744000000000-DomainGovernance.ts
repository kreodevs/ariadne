import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dominios de arquitectura, FK opcional en projects, dependencias proyecto → dominio.
 */
export class DomainGovernance1744000000000 implements MigrationInterface {
  name = 'DomainGovernance1744000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "domains" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(256) NOT NULL,
        "description" text,
        "color" character varying(16) NOT NULL DEFAULT '#6366f1',
        "metadata" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_domains" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "project_domain_dependencies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "project_id" uuid NOT NULL,
        "depends_on_domain_id" uuid NOT NULL,
        "connection_type" character varying(32) NOT NULL DEFAULT 'REST',
        "description" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_project_domain_dependencies" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_project_domain_dep" UNIQUE ("project_id", "depends_on_domain_id"),
        CONSTRAINT "FK_pdd_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pdd_domain" FOREIGN KEY ("depends_on_domain_id") REFERENCES "domains"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_pdd_project" ON "project_domain_dependencies" ("project_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_pdd_domain" ON "project_domain_dependencies" ("depends_on_domain_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "projects" ADD "domain_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "projects"
      ADD CONSTRAINT "FK_projects_domain" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "projects" DROP CONSTRAINT "FK_projects_domain"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "domain_id"`);
    await queryRunner.query(`DROP TABLE "project_domain_dependencies"`);
    await queryRunner.query(`DROP TABLE "domains"`);
  }
}
