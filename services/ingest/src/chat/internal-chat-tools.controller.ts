/**
 * API interna (solo red Docker / orchestrator): ejecución de herramientas del retriever sin LLM.
 */
import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { RepositoriesService } from '../repositories/repositories.service';
import { InternalApiGuard } from './internal-api.guard';
import {
  ChatRetrieverToolsService,
  type RetrieverToolRequest,
  type RetrieverToolResult,
} from './chat-retriever-tools.service';
import {
  ChatService,
  type AnalyzeMode,
  type AnalyzeOrchestratorPrepDto,
  type AnalyzeRequestOptions,
  type ChatScope,
} from './chat.service';
import type { MddEvidenceDocument } from './mdd-document.types';

@Controller('internal/repositories')
@UseGuards(InternalApiGuard)
export class InternalChatToolsController {
  constructor(
    private readonly repos: RepositoriesService,
    private readonly retrieverTools: ChatRetrieverToolsService,
    private readonly chat: ChatService,
  ) {}

  private async resolveProjectIdForRepo(repoId: string): Promise<string> {
    const ids = await this.repos.getProjectIdsForRepo(repoId);
    return ids[0] ?? repoId;
  }

  /**
   * POST /internal/repositories/:repoId/retriever-tool
   * Body: { projectScope?, scope?, tool, arguments, fallbackMessage?, evidenceVerbosity?: 'default'|'full' }
   */
  /**
   * POST /internal/repositories/:repoId/raw-evidence-deterministic
   * Body: { message, scope?, projectScope? } — misma secuencia que `deterministicRetriever` en chat (sin LLM).
   */
  @Post(':repoId/raw-evidence-deterministic')
  async rawEvidenceDeterministic(
    @Param('repoId') repoId: string,
    @Body() body: { message: string; scope?: ChatScope; projectScope?: boolean },
  ): Promise<{ gatheredContext: string; collectedResults: unknown[]; lastCypher: string }> {
    await this.repos.findOne(repoId);
    return this.chat.gatherDeterministicRawEvidence(repoId, {
      message: body.message ?? '',
      scope: body.scope,
      projectScope: body.projectScope,
    });
  }

  @Post(':repoId/retriever-tool')
  async retrieverTool(
    @Param('repoId') repoId: string,
    @Body() body: RetrieverToolRequest,
  ): Promise<RetrieverToolResult> {
    await this.repos.findOne(repoId);
    const projectId = await this.resolveProjectIdForRepo(repoId);
    const req: RetrieverToolRequest = {
      projectScope: body.projectScope,
      scope: body.scope,
      tool: body.tool,
      arguments: body.arguments ?? {},
      fallbackMessage: body.fallbackMessage,
      evidenceVerbosity: body.evidenceVerbosity,
    };
    return this.retrieverTools.executeTool(repoId, projectId, req);
  }

  /** Prep análisis (datos + prompts) sin LLM en ingest; síntesis en orchestrator. */
  @Post(':repoId/analyze-prep')
  async analyzePrep(
    @Param('repoId') repoId: string,
    @Body() body: { mode: AnalyzeMode; scope?: ChatScope; crossPackageDuplicates?: boolean },
  ): Promise<AnalyzeOrchestratorPrepDto> {
    await this.repos.findOne(repoId);
    const opts: AnalyzeRequestOptions | undefined =
      body.scope || body.crossPackageDuplicates
        ? {
            ...(body.scope ? { scope: body.scope } : {}),
            ...(body.crossPackageDuplicates ? { crossPackageDuplicates: true } : {}),
          }
        : undefined;
    return this.chat.prepareAnalyzeOrchestrator(repoId, body.mode, opts);
  }

  /**
   * POST /internal/repositories/:repoId/mdd-evidence
   * Body: { message, gatheredContext, collectedResults, projectScope?, projectId? }
   */
  @Post(':repoId/mdd-evidence')
  async mddEvidence(
    @Param('repoId') repoId: string,
    @Body()
    body: {
      message: string;
      gatheredContext: string;
      collectedResults?: unknown[];
      projectScope?: boolean;
      projectId?: string;
    },
  ): Promise<MddEvidenceDocument> {
    await this.repos.findOne(repoId);
    const projectId = body.projectId?.trim() || (await this.resolveProjectIdForRepo(repoId));
    return this.chat.buildMddEvidenceForRepository(
      repoId,
      projectId,
      body.message ?? '',
      body.gatheredContext ?? '',
      Array.isArray(body.collectedResults) ? body.collectedResults : [],
      body.projectScope === true,
    );
  }

  @Post(':repoId/modification-plan-files')
  async modificationPlanFiles(
    @Param('repoId') repoId: string,
    @Body() body: { userDescription: string; scope?: ChatScope },
  ): Promise<{ filesToModify: Array<{ path: string; repoId: string }> }> {
    await this.repos.findOne(repoId);
    const desc = body.userDescription?.trim() ?? '';
    if (!desc) return { filesToModify: [] };
    return { filesToModify: await this.chat.getModificationPlanFilesOnly(repoId, desc, body.scope) };
  }
}
