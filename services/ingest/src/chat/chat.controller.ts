/**
 * @fileoverview Controlador REST para chat NL→Cypher y análisis (diagnóstico, duplicados, reingeniería).
 */
import { Body, Controller, Get, InternalServerErrorException, Param, Post, Query } from '@nestjs/common';
import {
  ChatService,
  type AnalyzeMode,
  type AnalyzeResult,
  type ChatRequest,
  type ChatResponse,
  type ChatScope,
  type FullAuditResult,
  type ModificationPlanResult,
} from './chat.service';

/** Controlador de chat y análisis (GET graph-summary, POST chat, POST analyze). */
@Controller('repositories')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get(':id/graph-summary')
  async getGraphSummary(
    @Param('id') id: string,
    @Query('full') full?: string,
  ) {
    return this.chatService.getGraphSummary(id, full === '1' || full === 'true');
  }

  @Post(':id/full-audit')
  async fullAudit(@Param('id') id: string): Promise<FullAuditResult> {
    try {
      return await this.chatService.runFullAudit(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const hint =
        msg.includes('connect') || msg.includes('ECONNREFUSED')
          ? ' Verifica que FalkorDB esté corriendo.'
          : msg.includes('401') || msg.includes('403')
            ? ' Revisa credenciales del repo.'
            : '';
      throw new InternalServerErrorException(msg + hint);
    }
  }

  @Post(':id/analyze')
  async analyze(
    @Param('id') id: string,
    @Body() body: { mode?: AnalyzeMode },
    @Query('mode') modeQuery?: string,
  ): Promise<AnalyzeResult> {
    const mode = (body?.mode ?? modeQuery ?? 'diagnostico') as AnalyzeMode;
    try {
      return await this.chatService.analyze(id, mode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const hint =
        msg.includes('OPENAI_API_KEY') ? ' Configura OPENAI_API_KEY en el servidor.' :
        msg.includes('context_length_exceeded') ? ' El repo es muy grande; el análisis trunca datos automáticamente. Si persiste, contacta soporte.' :
        msg.includes('connect') || msg.includes('ECONNREFUSED') ? ' Verifica que FalkorDB esté corriendo (FALKOR_HOST/PORT).' :
        msg.includes('401') || msg.includes('403') ? ' Revisa credenciales del repo o API keys.' : '';
      throw new InternalServerErrorException(msg + hint);
    }
  }

  @Post(':id/chat')
  async chat(@Param('id') id: string, @Body() body: ChatRequest): Promise<ChatResponse> {
    return this.chatService.chat(id, body);
  }

  /**
   * Plan de modificación para flujo legacy (MaxPrime): archivos a modificar (solo rutas del grafo) + preguntas de afinación (solo negocio/funcionalidad).
   */
  @Post(':id/modification-plan')
  async getModificationPlan(
    @Param('id') id: string,
    @Body() body: { userDescription: string; scope?: ChatScope },
  ): Promise<ModificationPlanResult> {
    const userDescription = body?.userDescription?.trim() ?? '';
    if (!userDescription) {
      return { filesToModify: [], questionsToRefine: [] };
    }
    return this.chatService.getModificationPlan(id, userDescription, body?.scope);
  }
}
