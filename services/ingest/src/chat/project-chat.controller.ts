/**
 * @fileoverview Rutas de chat/análisis por projectId (multi-root). Delega en ChatService.
 */
import { Body, Controller, Post, Param } from '@nestjs/common';
import {
  ChatService,
  type ChatRequest,
  type ChatResponse,
  type ChatScope,
  type ModificationPlanResult,
} from './chat.service';

@Controller('projects')
export class ProjectChatController {
  constructor(private readonly chatService: ChatService) {}

  /** Chat a nivel proyecto: grafo de todos los repos del proyecto; get_file_content busca en cualquier repo. */
  @Post(':projectId/chat')
  async chat(
    @Param('projectId') projectId: string,
    @Body() body: ChatRequest,
  ): Promise<ChatResponse> {
    return this.chatService.chatByProject(projectId, body);
  }

  /**
   * Plan de modificación: `projectId` puede ser UUID de **proyecto** Ariadne o UUID de **repositorio** (`roots[].id`; recomendado en multi-root para elegir el root correcto, p. ej. frontend).
   */
  @Post(':projectId/modification-plan')
  async getModificationPlan(
    @Param('projectId') projectId: string,
    @Body() body: { userDescription: string; scope?: ChatScope },
  ): Promise<ModificationPlanResult> {
    const userDescription = body?.userDescription?.trim() ?? '';
    if (!userDescription) {
      return { filesToModify: [], questionsToRefine: [] };
    }
    return this.chatService.getModificationPlanByProject(projectId, userDescription, body?.scope);
  }
}
