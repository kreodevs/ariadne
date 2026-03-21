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
import { RepositoriesModule } from '../repositories/repositories.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [RepositoriesModule, EmbeddingModule, ProjectsModule],
  controllers: [ChatController, ProjectChatController],
  providers: [ChatCypherService, ChatLlmService, ChatAntipatternsService, ChatHandlersService, ChatService],
})
/** Módulo del chat con grafo FalkorDB (preguntas en NL, Cypher, análisis). */
export class ChatModule {}
