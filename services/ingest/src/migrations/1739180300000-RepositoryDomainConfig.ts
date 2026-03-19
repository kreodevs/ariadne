import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepositoryDomainConfig1739180300000 implements MigrationInterface {
  name = 'RepositoryDomainConfig1739180300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "repositories" ADD COLUMN "domain_config" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "repositories" DROP COLUMN "domain_config"`,
    );
  }
}
