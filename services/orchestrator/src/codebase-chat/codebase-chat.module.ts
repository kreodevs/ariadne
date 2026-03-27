import { Module } from '@nestjs/common';
import { RedisStateModule } from '../redis-state/redis-state.module';
import { CodebaseAnalyzeController } from './codebase-analyze.controller';
import { CodebaseAnalyzeService } from './codebase-analyze.service';
import { CodebaseChatController } from './codebase-chat.controller';
import { CodebaseChatService } from './codebase-chat.service';
import { CodebaseModificationPlanController } from './codebase-modification-plan.controller';
import { CodebaseModificationPlanService } from './codebase-modification-plan.service';
import { IngestChatClient } from './ingest-chat.client';
import { OrchestratorLlmService } from './orchestrator-llm.service';

@Module({
  imports: [RedisStateModule],
  controllers: [
    CodebaseChatController,
    CodebaseAnalyzeController,
    CodebaseModificationPlanController,
  ],
  providers: [
    IngestChatClient,
    OrchestratorLlmService,
    CodebaseChatService,
    CodebaseAnalyzeService,
    CodebaseModificationPlanService,
  ],
})
export class CodebaseChatModule {}
