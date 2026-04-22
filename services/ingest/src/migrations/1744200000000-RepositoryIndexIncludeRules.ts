import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RepositoryIndexIncludeRules1744200000000 implements MigrationInterface {
  name = 'RepositoryIndexIncludeRules1744200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "repositories"
      ADD COLUMN IF NOT EXISTS "index_include_rules" jsonb NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "repositories" DROP COLUMN IF EXISTS "index_include_rules"
    `);
  }
}
