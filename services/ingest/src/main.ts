/**
 * @fileoverview Punto de entrada del microservicio **Ingest** (NestJS, puerto por defecto 3002).
 *
 * Responsabilidades en arranque: ejecutar migraciones TypeORM opcionales (`INGEST_SKIP_MIGRATIONS`),
 * aplicar `FALKOR_FLUSH_ALL_ONCE` si está configurado, backfill de `repoId` en Falkor cuando no hay
 * sharding por proyecto, y crear la app Nest con `rawBody` para verificación de webhooks.
 *
 * @see Archivo `LICENSE` en la raíz del monorepo (Apache-2.0).
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 * @author Jorge Correa <jcorrea@e-personal.net>
 */
import { DataSource } from 'typeorm';
import { NestFactory } from '@nestjs/core';
import { FalkorDB } from 'falkordb';
import { AppModule } from './app.module';
import { getFalkorConfig, GRAPH_NAME, isProjectShardingEnabled } from './pipeline/falkor';
import { runFalkorRepoIdBackfill } from './pipeline/producer';
import * as express from 'express';

/** Clave en `ingest_runtime_flags`: evita repetir FLUSHALL en reinicios si el env sigue puesto. */
const FALKOR_FLUSH_FLAG_KEY = 'falkor_flushall_once';

function isTruthyEnv(v: string | undefined): boolean {
  if (!v?.trim()) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/**
 * Si `FALKOR_FLUSH_ALL_ONCE` está activo y la flag no está en Postgres: ejecuta FLUSHALL en FalkorDB
 * y registra la flag. Así el próximo deploy puede llevar el env una vez sin borrar el grafo en cada reinicio.
 */
async function runFalkorFlushAllOnceIfRequested(): Promise<void> {
  if (!isTruthyEnv(process.env.FALKOR_FLUSH_ALL_ONCE)) return;

  const pgDs = new DataSource({
    type: 'postgres',
    host: process.env.PGHOST ?? 'localhost',
    port: parseInt(process.env.PGPORT ?? '5432', 10),
    username: process.env.PGUSER ?? 'falkorspecs',
    password: process.env.PGPASSWORD ?? 'falkorspecs',
    database: process.env.PGDATABASE ?? 'falkorspecs',
  });
  await pgDs.initialize();
  try {
    const existing = await pgDs.query(
      `SELECT 1 AS x FROM ingest_runtime_flags WHERE flag_key = $1 LIMIT 1`,
      [FALKOR_FLUSH_FLAG_KEY],
    );
    if (Array.isArray(existing) && existing.length > 0) {
      console.log(
        `[ingest] FALKOR_FLUSH_ALL_ONCE omitido: ya aplicado (flag ${FALKOR_FLUSH_FLAG_KEY}). Quita el env si no lo necesitas.`,
      );
      return;
    }
  } finally {
    await pgDs.destroy();
  }

  const config = getFalkorConfig();
  let falkor: Awaited<ReturnType<typeof FalkorDB.connect>> | null = null;
  try {
    falkor = await FalkorDB.connect({ socket: { host: config.host, port: config.port } });
    const redis = await falkor.connection;
    const flush = (redis as { flushAll?: () => Promise<unknown> }).flushAll;
    if (typeof flush !== 'function') {
      throw new Error('Cliente Redis sin método flushAll');
    }
    await flush.call(redis);
    console.warn('[ingest] FalkorDB: FLUSHALL ejecutado (FALKOR_FLUSH_ALL_ONCE). Re-sincroniza los repos.');
  } catch (err) {
    console.error('[ingest] FALKOR_FLUSH_ALL_ONCE falló:', (err as Error)?.message ?? err);
    throw err;
  } finally {
    if (falkor) await falkor.close();
  }

  const pgInsert = new DataSource({
    type: 'postgres',
    host: process.env.PGHOST ?? 'localhost',
    port: parseInt(process.env.PGPORT ?? '5432', 10),
    username: process.env.PGUSER ?? 'falkorspecs',
    password: process.env.PGPASSWORD ?? 'falkorspecs',
    database: process.env.PGDATABASE ?? 'falkorspecs',
  });
  await pgInsert.initialize();
  try {
    await pgInsert.query(`INSERT INTO ingest_runtime_flags (flag_key) VALUES ($1)`, [FALKOR_FLUSH_FLAG_KEY]);
  } finally {
    await pgInsert.destroy();
  }
}

/**
 * Ejecuta migraciones TypeORM pendientes antes de arrancar (necesario en prod con synchronize=false).
 * Se llama en **cada** bootstrap: al desplegar una imagen nueva con `.js` en `dist/migrations/`, Postgres queda al día sin paso manual.
 * Desactivar solo en emergencia: `INGEST_SKIP_MIGRATIONS=1` (riesgo de esquema desalineado).
 */
async function runMigrations(): Promise<void> {
  if (isTruthyEnv(process.env.INGEST_SKIP_MIGRATIONS)) {
    console.warn('[ingest] INGEST_SKIP_MIGRATIONS activo: no se ejecutan migraciones al arrancar.');
    return;
  }
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.PGHOST ?? 'localhost',
    port: parseInt(process.env.PGPORT ?? '5432', 10),
    username: process.env.PGUSER ?? 'falkorspecs',
    password: process.env.PGPASSWORD ?? 'falkorspecs',
    database: process.env.PGDATABASE ?? 'falkorspecs',
    migrations: [__dirname + '/migrations/*.js'],
    migrationsRun: false,
  });
  await ds.initialize();
  try {
    const executed = await ds.runMigrations();
    if (executed.length > 0) {
      console.log(`[ingest] Migraciones ejecutadas: ${executed.map((m) => m.name).join(', ')}`);
    } else {
      console.log('[ingest] Migraciones PostgreSQL: ninguna pendiente (tabla migrations al día).');
    }
  } finally {
    await ds.destroy();
  }
}

/**
 * Backfill repoId en el grafo Falkor (nodos antiguos sin repoId). Idempotente.
 * Si Falkor no está disponible, solo se registra y se sigue (no bloquea arranque).
 */
async function runFalkorRepoIdMigration(): Promise<void> {
  if (isProjectShardingEnabled()) {
    console.warn(
      '[ingest] Falkor repoId backfill omitido: FALKOR_SHARD_BY_PROJECT activo (migrar por shard si aplica).',
    );
    return;
  }
  const config = getFalkorConfig();
  let client: Awaited<ReturnType<typeof FalkorDB.connect>> | null = null;
  try {
    client = await FalkorDB.connect({ socket: { host: config.host, port: config.port } });
    const graph = client.selectGraph(GRAPH_NAME);
    const graphClient = { query: (cypher: string) => graph.query(cypher) };
    await runFalkorRepoIdBackfill(graphClient);
  } catch (err) {
    console.warn('[ingest] Falkor repoId backfill omitido (Falkor no disponible o error):', (err as Error)?.message ?? err);
  } finally {
    if (client) await client.close();
  }
}

/** Arranca NestJS con body parser (rawBody para webhooks) y CORS. */
async function bootstrap() {
  console.log('[ingest] Starting bootstrap (1741cde)');
  await runMigrations();
  await runFalkorFlushAllOnceIfRequested();
  await runFalkorRepoIdMigration();
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    abortOnError: false,
  });
  const bodyLimit = process.env.BODY_LIMIT ?? '10mb';
  app.use(
    express.json({
      limit: bodyLimit,
      verify: (req: express.Request & { rawBody?: Buffer }, _res: express.Response, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );
  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : true,
    credentials: true,
  });
  const port = process.env.PORT ?? 3002;
  await app.listen(port);
  console.log(`Ingest service (NestJS) listening on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('[ingest] FATAL bootstrap error:');
  console.error(err);
  if (err?.stack) {
    console.error('[ingest] Stack trace:', err.stack);
  }
  process.exit(1);
});
