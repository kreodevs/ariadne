/**
 * API interna por projectId: prep analyze agents/skill y listado de archivos del modification-plan.
 */
import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { InternalApiGuard } from './internal-api.guard';
import {
  ChatService,
  type AnalyzeOrchestratorPrepDto,
  type ChatScope,
} from './chat.service';

@Controller('internal/projects')
@UseGuards(InternalApiGuard)
export class InternalProjectToolsController {
  constructor(private readonly chat: ChatService) {}

  @Post(':projectId/analyze-prep')
  async analyzePrep(
    @Param('projectId') projectId: string,
    @Body() body: { mode: 'agents' | 'skill' },
  ): Promise<AnalyzeOrchestratorPrepDto> {
    return this.chat.prepareAnalyzeByProjectOrchestrator(projectId, body.mode);
  }

  @Post(':projectId/modification-plan-files')
  async modificationPlanFiles(
    @Param('projectId') projectId: string,
    @Body() body: { userDescription: string; scope?: ChatScope; currentFilePath?: string },
  ): Promise<{ filesToModify: Array<{ path: string; repoId: string }> }> {
    const desc = body.userDescription?.trim() ?? '';
    if (!desc) return { filesToModify: [] };
    return {
      filesToModify: await this.chat.getModificationPlanFilesOnlyByProject(
        projectId,
        desc,
        body.scope,
        body.currentFilePath?.trim() || null,
      ),
    };
  }
}
