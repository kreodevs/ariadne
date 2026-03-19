import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLastCommitSha1739180100000 implements MigrationInterface {
  name = 'AddLastCommitSha1739180100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "repositories" ADD "last_commit_sha" character varying(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "repositories" DROP COLUMN "last_commit_sha"`,
    );
  }
}
