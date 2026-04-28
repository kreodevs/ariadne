/**
 * @fileoverview Punto de entrada del **Orchestrator** (NestJS + LangGraph, puerto por defecto 3001).
 *
 * Coordina flujos de agentes, estado en Redis y módulos de chat/legacy documentados en el monorepo.
 * No contiene la ingesta de repositorios; consume APIs y grafos ya materializados por ingest/API.
 *
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 * @author Jorge Correa <jcorrea@e-personal.net>
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/** Inicia el servidor del Orchestrator. */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = parseInt(process.env.PORT ?? '3001', 10);
  await app.listen(port);
  console.log(`Orchestrator (NestJS + LangGraph) listening on port ${port}`);
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
