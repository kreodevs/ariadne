/**
 * @fileoverview Módulo raíz Orchestrator: RedisState, Workflow.
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
