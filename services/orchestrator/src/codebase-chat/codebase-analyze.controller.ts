import { Body, Controller, Param, Post } from '@nestjs/common';
import { CodebaseAnalyzeService } from './codebase-analyze.service';
import type { AnalyzeMode, AnalyzeResult } from './ingest-types';

@Controller('codebase/analyze')
export class CodebaseAnalyzeController {
  constructor(private readonly analyze: CodebaseAnalyzeService) {}

  @Post('repository/:repositoryId')
  async analyzeRepository(
    @Param('repositoryId') repositoryId: string,
    @Body() body: { mode?: AnalyzeMode },
  ): Promise<AnalyzeResult> {
    const mode = (body?.mode ?? 'diagnostico') as AnalyzeMode;
    return this.analyze.analyzeRepository(repositoryId, mode);
  }

  @Post('project/:projectId')
  async analyzeProject(
    @Param('projectId') projectId: string,
    @Body() body: { mode?: 'agents' | 'skill' },
  ): Promise<AnalyzeResult> {
    const mode = body?.mode ?? 'agents';
    return this.analyze.analyzeProject(projectId, mode);
  }
}
