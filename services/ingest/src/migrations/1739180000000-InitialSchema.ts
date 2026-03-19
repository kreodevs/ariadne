import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1739180000000 implements MigrationInterface {
  name = 'InitialSchema1739180000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      CREATE TABLE "repositories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "provider" character varying(64) NOT NULL,
        "project_key" character varying(256) NOT NULL,
        "repo_slug" character varying(256) NOT NULL,
        "default_branch" character varying(256) NOT NULL DEFAULT 'main',
        "credentials_ref" character varying(512),
        "last_sync_at" TIMESTAMP WITH TIME ZONE,
        "status" character varying(32) NOT NULL DEFAULT 'pending',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_repositories" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "sync_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "repository_id" uuid NOT NULL,
        "type" character varying(32) NOT NULL,
        "started_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "finished_at" TIMESTAMP WITH TIME ZONE,
        "status" character varying(32) NOT NULL,
        "payload" jsonb,
        "error_message" text,
        CONSTRAINT "PK_sync_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_sync_jobs_repository" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "indexed_files" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "repository_id" uuid NOT NULL,
        "path" character varying(2048) NOT NULL,
        "revision" character varying(128),
        "indexed_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_indexed_files" PRIMARY KEY ("id"),
        CONSTRAINT "FK_indexed_files_repository" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "indexed_files"`);
    await queryRunner.query(`DROP TABLE "sync_jobs"`);
    await queryRunner.query(`DROP TABLE "repositories"`);
  }
}
