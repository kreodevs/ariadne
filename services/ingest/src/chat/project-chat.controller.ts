/**
 * @fileoverview Rutas de chat/análisis por projectId (multi-root). Delega en ChatService.
 */
import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  InternalServerErrorException,
  Post,
  Param,
} from '@nestjs/common';
import {
  ChatService,
  type AnalyzeMode,
  type ChatRequest,
  type ChatResponse,
  type ChatScope,
  type ModificationPlanResult,
  type AnalyzeResult,
} from './chat.service';
import { AnalyticsService } from './analytics.service';

@Controller('projects')
export class ProjectChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  /**
   * Análisis por proyecto:
   * - `mode`: `agents` | `skill` → AGENTS.md / SKILL.md (comportamiento previo).
   * - `mode`: `diagnostico` | `duplicados` | … → resuelve `repositoryId` (mono-root, o multi-root con `idePath` / `repositoryId`) y delega en el mismo pipeline que `POST /repositories/:id/analyze`.
   */
  @Post(':projectId/analyze')
  async analyze(
    @Param('projectId') projectId: string,
    @Body()
    body: {
      mode?: AnalyzeMode;
      idePath?: string;
      repositoryId?: string;
    },
  ): Promise<AnalyzeResult> {
    const mode = (body?.mode ?? 'agents') as AnalyzeMode;
    try {
      if (mode === 'agents' || mode === 'skill') {
        return await this.chatService.analyzeByProject(projectId, mode);
      }
      if (!this.analyticsService.isCodeAnalysisMode(mode)) {
        throw new BadRequestException(`Modo de análisis no soportado en esta ruta: ${String(mode)}`);
      }
      return await this.analyticsService.analyzeByProjectId(projectId, mode, {
        idePath: body?.idePath,
        repositoryId: body?.repositoryId,
      });
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      if (err instanceof HttpException) throw err;
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
