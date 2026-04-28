/**
 * @fileoverview Módulo raíz **AppModule** del Orchestrator: estado Redis, workflows LangGraph,
 * codebase-chat y capa legacy según el diseño del servicio.
 *
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 */
import { Module } from '@nestjs/common';
import { CodebaseChatModule } from './codebase-chat/codebase-chat.module';
import { LegacyModule } from './legacy/legacy.module';
import { RedisStateModule } from './redis-state/redis-state.module';
import { WorkflowModule } from './workflow/workflow.module';

@Module({
  imports: [RedisStateModule, WorkflowModule, CodebaseChatModule, LegacyModule],
})
/** Módulo principal del Orchestrator. */
export class AppModule {}
