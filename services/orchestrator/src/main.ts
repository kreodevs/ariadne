/**
 * @fileoverview Entry point Orchestrator: NestJS + LangGraph.
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
