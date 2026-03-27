import { Body, Controller, Param, Post } from '@nestjs/common';
import { CodebaseModificationPlanService } from './codebase-modification-plan.service';
import type { ChatScope } from './chat-scope.util';
import type { ModificationPlanResult } from './ingest-types';

@Controller('codebase/modification-plan')
export class CodebaseModificationPlanController {
  constructor(private readonly plan: CodebaseModificationPlanService) {}

  @Post('repository/:repositoryId')
  async planRepository(
    @Param('repositoryId') repositoryId: string,
    @Body() body: { userDescription: string; scope?: ChatScope },
  ): Promise<ModificationPlanResult> {
    return this.plan.planRepository(repositoryId, body.userDescription, body.scope);
  }

  @Post('project/:projectId')
  async planProject(
    @Param('projectId') projectId: string,
    @Body() body: { userDescription: string; scope?: ChatScope },
  ): Promise<ModificationPlanResult> {
    return this.plan.planProject(projectId, body.userDescription, body.scope);
  }
}
