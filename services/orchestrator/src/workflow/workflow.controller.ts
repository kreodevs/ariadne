import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { WorkflowService, RefactorState, PropSpec } from './workflow.service';

export interface RefactorValidateBody {
  nodeId: string;
  proposedProps?: PropSpec[];
}

export interface RefactorFullBody {
  nodeId: string;
  filePath?: string;
  currentCode?: string;
  proposedProps?: PropSpec[];
  proposedCode?: string;
}

@Controller('workflow')
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  /**
   * GET /workflow/refactor/:nodeId
   * Ejecuta el flujo de validación (LangGraph): impacto y aprobación según SDD.
   */
  @Get('refactor/:nodeId')
  async runRefactor(@Param('nodeId') nodeId: string): Promise<RefactorState> {
    return this.workflowService.runRefactorFlow(nodeId);
  }

  /**
   * POST /workflow/refactor/validate
   * Valida refactor con spec propuesta: impacto + contratos. Devuelve veredicto SDD.
   */
  @Post('refactor/validate')
  async validateRefactor(
    @Body() body: RefactorValidateBody
  ): Promise<RefactorState> {
    return this.workflowService.runRefactorFlow(body.nodeId, body.proposedProps);
  }

  /**
   * POST /workflow/refactor/full
   * Pipeline completo: impacto, contratos, weaver (stub), shadow index, compare graphs.
   */
  @Post('refactor/full')
  async refactorFull(@Body() body: RefactorFullBody): Promise<RefactorState> {
    return this.workflowService.runRefactorFlowFull({
      nodeId: body.nodeId,
      filePath: body.filePath,
      currentCode: body.currentCode,
      proposedProps: body.proposedProps,
      proposedCode: body.proposedCode,
    });
  }
}
