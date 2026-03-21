/**
 * @fileoverview Rutas de chat/análisis por projectId (multi-root). Delega en ChatService.
 */
import { Body, Controller, InternalServerErrorException, Post, Param } from '@nestjs/common';
import {
  ChatService,
  type ChatRequest,
  type ChatResponse,
  type ChatScope,
  type ModificationPlanResult,
  type AnalyzeResult,
} from './chat.service';

@Controller('projects')
export class ProjectChatController {
  constructor(private readonly chatService: ChatService) {}

  /** Análisis por proyecto: AGENTS.md y SKILL.md (formato markdown para el codebase). */
  @Post(':projectId/analyze')
  async analyze(
    @Param('projectId') projectId: string,
    @Body() body: { mode?: 'agents' | 'skill' },
  ): Promise<AnalyzeResult> {
    const mode = (body?.mode ?? 'agents') as 'agents' | 'skill';
    try {
      return await this.chatService.analyzeByProject(projectId, mode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const hint =
        msg.includes('OPENAI_API_KEY') ? ' Configura OPENAI_API_KEY en el servidor.' :
        msg.includes('connect') || msg.includes('ECONNREFUSED') ? ' Verifica que FalkorDB esté corriendo.' : '';
      throw new InternalServerErrorException(msg + hint);
    }
  }

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
