/**
 * @fileoverview Entry point del microservicio Ingest. Puerto 3002.
 */
import { DataSource } from 'typeorm';
import { NestFactory } from '@nestjs/core';
import { FalkorDB } from 'falkordb';
import { AppModule } from './app.module';
import { getFalkorConfig, GRAPH_NAME, isProjectShardingEnabled } from './pipeline/falkor';
import { runFalkorRepoIdBackfill } from './pipeline/producer';
import * as express from 'express';

/**
 * Ejecuta migraciones TypeORM pendientes antes de arrancar (necesario en prod con synchronize=false).
 * @returns {Promise<void>}
 */
async function runMigrations(): Promise<void> {
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
    const pending = await ds.runMigrations();
    if (pending.length > 0) {
      console.log(`[ingest] Migraciones ejecutadas: ${pending.map((m) => m.name).join(', ')}`);
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
  await runMigrations();
  await runFalkorRepoIdMigration();
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
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
  console.error(err);
  process.exit(1);
});
