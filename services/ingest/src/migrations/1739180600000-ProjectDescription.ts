import { MigrationInterface, QueryRunner } from 'typeorm';

/** Añade columna description a projects (ej. "solo main", "mixto"). */
export class ProjectDescription1739180600000 implements MigrationInterface {
  name = 'ProjectDescription1739180600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "projects"
      ADD COLUMN "description" text NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "description"`);
  }
}
