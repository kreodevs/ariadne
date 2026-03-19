/**
 * @fileoverview Módulo Workflow: LangGraph, refactor, SDD.
 */
import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
/** Módulo de workflows LangGraph. */
export class WorkflowModule {}
