import { Body, Controller, Param, Post } from '@nestjs/common';
import { CodebaseChatService, type ChatRequest, type ChatResponse } from './codebase-chat.service';

/**
 * ask_codebase centralizado: LangGraph en orchestrator; ingest solo sirve herramientas de datos.
 */
@Controller('codebase/chat')
export class CodebaseChatController {
  constructor(private readonly codebaseChat: CodebaseChatService) {}

  @Post('repository/:repositoryId')
  async chatRepository(
    @Param('repositoryId') repositoryId: string,
    @Body() body: ChatRequest,
  ): Promise<ChatResponse> {
    return this.codebaseChat.chatRepository(repositoryId, body);
  }

  @Post('project/:projectId')
  async chatProject(
    @Param('projectId') projectId: string,
    @Body() body: ChatRequest,
  ): Promise<ChatResponse> {
    return this.codebaseChat.chatProject(projectId, body);
  }
}
