import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Visibilidad dominio → dominio (C4 / whitelist de grafos entre ecosistemas).
 * Distinto de project_domain_dependencies (proyecto → dominio externo).
 */
export class DomainDomainVisibility1744100000000 implements MigrationInterface {
  name = 'DomainDomainVisibility1744100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "domain_domain_visibility" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "from_domain_id" uuid NOT NULL,
        "to_domain_id" uuid NOT NULL,
        "description" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_domain_domain_visibility" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_domain_vis_from_to" UNIQUE ("from_domain_id", "to_domain_id"),
        CONSTRAINT "FK_ddv_from" FOREIGN KEY ("from_domain_id") REFERENCES "domains"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ddv_to" FOREIGN KEY ("to_domain_id") REFERENCES "domains"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_ddv_no_self" CHECK ("from_domain_id" <> "to_domain_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_ddv_from" ON "domain_domain_visibility" ("from_domain_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_ddv_to" ON "domain_domain_visibility" ("to_domain_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "domain_domain_visibility"`);
  }
}
