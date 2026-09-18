/**
 * @fileoverview Workflow Archify del pipeline full-sync de Ariadne.
 */
import { Injectable } from '@nestjs/common';
import {
  buildDefaultSyncWorkflowSpec,
  syncWorkflowToArchifyWorkflow,
  type ArchifyWorkflowIr,
  type SyncWorkflowSpec,
} from 'ariadne-common';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class C4WorkflowExtractor {
  constructor(private readonly projects: ProjectsService) {}

  async buildSyncWorkflow(projectId: string): Promise<{ spec: SyncWorkflowSpec; archifyIr: ArchifyWorkflowIr }> {
    const project = await this.projects.findOne(projectId);
    const spec = buildDefaultSyncWorkflowSpec(project.name ?? projectId);
    return { spec, archifyIr: syncWorkflowToArchifyWorkflow(spec) };
  }
}
