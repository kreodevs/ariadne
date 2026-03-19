import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepositoryWebhookSecret1739180400000 implements MigrationInterface {
  name = 'RepositoryWebhookSecret1739180400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "repositories" ADD COLUMN "webhook_secret_encrypted" varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "repositories" DROP COLUMN "webhook_secret_encrypted"`,
    );
  }
}
