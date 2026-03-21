/**
 * @fileoverview DataSource TypeORM para CLI de migraciones (typeorm migration:run).
 */
import { DataSource } from 'typeorm';

/** Configuración Postgres para migraciones. */
export default new DataSource({
  type: 'postgres',
  host: process.env.PGHOST ?? 'localhost',
  port: parseInt(process.env.PGPORT ?? '5432', 10),
  username: process.env.PGUSER ?? 'falkorspecs',
  password: process.env.PGPASSWORD ?? 'falkorspecs',
  database: process.env.PGDATABASE ?? 'falkorspecs',
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});
