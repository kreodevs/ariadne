/**
 * @fileoverview Módulo Chat: NL→Cypher. Pipeline unificado Retriever (Cypher + archivos + RAG) → Synthesizer.
 */
import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ProjectChatController } from './project-chat.controller';
import { ChatService } from './chat.service';
import { ChatCypherService } from './chat-cypher.service';
import { ChatLlmService } from './chat-llm.service';
import { ChatAntipatternsService } from './chat-antipatterns.service';
import { ChatHandlersService } from './chat-handlers.service';
import { ChatRetrieverToolsService } from './chat-retriever-tools.service';
import { InternalChatToolsController } from './internal-chat-tools.controller';
import { InternalProjectToolsController } from './internal-project-tools.controller';
import { InternalApiGuard } from './internal-api.guard';
import { RepositoriesModule } from '../repositories/repositories.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [RepositoriesModule, EmbeddingModule, ProjectsModule],
  controllers: [
    ChatController,
    ProjectChatController,
    InternalChatToolsController,
    InternalProjectToolsController,
  ],
  providers: [
    InternalApiGuard,
    ChatCypherService,
    ChatLlmService,
    ChatAntipatternsService,
    ChatHandlersService,
    ChatRetrieverToolsService,
    ChatService,
  ],
})
/** Módulo del chat con grafo FalkorDB (preguntas en NL, Cypher, análisis). */
export class ChatModule {}
