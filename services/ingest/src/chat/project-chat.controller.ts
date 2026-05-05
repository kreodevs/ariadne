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
  type AnalyzeRequestOptions,
  type ChatRequest,
  type ChatResponse,
  type ChatScope,
  type ModificationPlanResult,
  type ModificationPlanQuestionsMode,
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
      scope?: ChatScope;
      crossPackageDuplicates?: boolean;
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
      const analyzeOpts: AnalyzeRequestOptions | undefined =
        body?.scope || body?.crossPackageDuplicates
          ? {
              ...(body.scope ? { scope: body.scope } : {}),
              ...(body.crossPackageDuplicates ? { crossPackageDuplicates: true } : {}),
            }
          : undefined;
      return await this.analyticsService.analyzeByProjectId(projectId, mode, {
        idePath: body?.idePath,
        repositoryId: body?.repositoryId,
        analyzeOptions: analyzeOpts,
      });
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const hint = msg.includes('LLM_API_KEY')
        ? ' Configura LLM_API_KEY en el servidor.'
        : msg.includes('connect') || msg.includes('ECONNREFUSED')
          ? ' Verifica que FalkorDB esté corriendo.'
          : '';
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
   * Plan de modificación: multi-root vía `scope.repoIds` / `currentFilePath` / un solo repo; ver `modification-plan-resolve.util.ts`.
   */
  @Post(':projectId/modification-plan')
  async getModificationPlan(
    @Param('projectId') projectId: string,
    @Body()
    body: {
      userDescription: string;
      scope?: ChatScope;
      currentFilePath?: string;
      questionsMode?: ModificationPlanQuestionsMode;
    },
  ): Promise<ModificationPlanResult> {
    const userDescription = body?.userDescription?.trim() ?? '';
    if (!userDescription) {
      return {
        filesToModify: [],
        questionsToRefine: [],
        diagnostic: {
          code: 'MISSING_USER_DESCRIPTION',
          message: 'Se requiere userDescription (texto no vacío).',
        },
      };
    }
    return this.chatService.getModificationPlanByProject(
      projectId,
      userDescription,
      body?.scope,
      body?.currentFilePath?.trim() || null,
      body?.questionsMode,
    );
  }
}
