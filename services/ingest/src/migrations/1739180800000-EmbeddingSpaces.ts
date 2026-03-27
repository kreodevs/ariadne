import { MigrationInterface, QueryRunner } from 'typeorm';

export class EmbeddingSpaces1739180800000 implements MigrationInterface {
  name = 'EmbeddingSpaces1739180800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "embedding_spaces" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "key" character varying(128) NOT NULL,
        "provider" character varying(32) NOT NULL,
        "model_id" character varying(256) NOT NULL,
        "dimension" integer NOT NULL,
        "graph_property" character varying(128) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_embedding_spaces" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_embedding_spaces_key" ON "embedding_spaces" ("key")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_embedding_spaces_graph_property" ON "embedding_spaces" ("graph_property")`,
    );
    await queryRunner.query(`
      ALTER TABLE "repositories"
      ADD "read_embedding_space_id" uuid,
      ADD "write_embedding_space_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "repositories"
      ADD CONSTRAINT "FK_repositories_read_embedding_space"
        FOREIGN KEY ("read_embedding_space_id") REFERENCES "embedding_spaces"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "repositories"
      ADD CONSTRAINT "FK_repositories_write_embedding_space"
        FOREIGN KEY ("write_embedding_space_id") REFERENCES "embedding_spaces"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "repositories" DROP CONSTRAINT "FK_repositories_write_embedding_space"`,
    );
    await queryRunner.query(
      `ALTER TABLE "repositories" DROP CONSTRAINT "FK_repositories_read_embedding_space"`,
    );
    await queryRunner.query(`
      ALTER TABLE "repositories" DROP COLUMN "write_embedding_space_id",
      DROP COLUMN "read_embedding_space_id"
    `);
    await queryRunner.query(`DROP TABLE "embedding_spaces"`);
  }
}
