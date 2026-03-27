import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Modo de partición Falkor por proyecto: monolítico vs por sub-dominio (segmento de ruta).
 */
export class ProjectFalkorShardRouting1740000000000 implements MigrationInterface {
  name = 'ProjectFalkorShardRouting1740000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'projects',
      new TableColumn({
        name: 'falkor_shard_mode',
        type: 'varchar',
        length: '16',
        default: "'project'",
      }),
    );
    await queryRunner.addColumn(
      'projects',
      new TableColumn({
        name: 'falkor_domain_segments',
        type: 'jsonb',
        isNullable: true,
      }),
    );
    await queryRunner.query(
      `UPDATE projects SET falkor_domain_segments = '[]'::jsonb WHERE falkor_domain_segments IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('projects', 'falkor_domain_segments');
    await queryRunner.dropColumn('projects', 'falkor_shard_mode');
  }
}
