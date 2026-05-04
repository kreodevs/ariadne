import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersTable1745000000000 implements MigrationInterface {
  name = 'CreateUsersTable1745000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying(512) NOT NULL,
        "name" character varying(256),
        "role" character varying(32) NOT NULL DEFAULT 'developer',
        "mcp_token_hash" character varying(512),
        "mcp_token_prefix" character varying(16),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
