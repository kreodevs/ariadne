/**
 * @fileoverview Módulo Chat: NL→Cypher. Pipeline unificado Retriever (Cypher + archivos + RAG) → Synthesizer.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IndexedFile } from '../repositories/entities/indexed-file.entity';
import { ChatController } from './chat.controller';
import { ProjectChatController } from './project-chat.controller';
import { ChatService } from './chat.service';
import { AnalyticsService } from './analytics.service';
import { AnalyzeDistributedCacheService } from './analyze-distributed-cache.service';
import { ChatCypherService } from './chat-cypher.service';
import { ChatLlmService } from './chat-llm.service';
import { ChatAntipatternsService } from './chat-antipatterns.service';
import { ChatHandlersService } from './chat-handlers.service';
import { ChatRetrieverToolsService } from './chat-retriever-tools.service';
import { InternalChatToolsController } from './internal-chat-tools.controller';
import { InternalProjectToolsController } from './internal-project-tools.controller';
import { RepositoriesModule } from '../repositories/repositories.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [TypeOrmModule.forFeature([IndexedFile]), RepositoriesModule, EmbeddingModule, ProjectsModule],
  controllers: [
    ChatController,
    ProjectChatController,
    InternalChatToolsController,
    InternalProjectToolsController,
  ],
  providers: [
    ChatCypherService,
    ChatLlmService,
    ChatAntipatternsService,
    ChatHandlersService,
    ChatRetrieverToolsService,
    AnalyzeDistributedCacheService,
    ChatService,
    AnalyticsService,
  ],
})
/** Módulo del chat con grafo FalkorDB (preguntas en NL, Cypher, análisis). */
export class ChatModule {}
