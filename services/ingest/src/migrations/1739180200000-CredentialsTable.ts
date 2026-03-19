import { MigrationInterface, QueryRunner } from 'typeorm';

export class CredentialsTable1739180200000 implements MigrationInterface {
  name = 'CredentialsTable1739180200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "credentials" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "provider" character varying(32) NOT NULL,
        "kind" character varying(32) NOT NULL,
        "name" character varying(256),
        "encrypted_value" text NOT NULL,
        "extra" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_credentials" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "credentials"`);
  }
}
