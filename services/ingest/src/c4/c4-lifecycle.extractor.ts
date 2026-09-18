/**
 * @fileoverview Lifecycle Archify: sync job y request HTTP.
 */
import { Injectable } from '@nestjs/common';
import {
  buildApiRequestLifecycleSpec,
  buildSyncJobLifecycleSpec,
  entityLifecycleToArchifyLifecycle,
  type ArchifyLifecycleIr,
  type EntityLifecycleSpec,
} from 'ariadne-common';
import { ProjectsService } from '../projects/projects.service';

export interface C4LifecycleTarget {
  id: string;
  label: string;
  description: string;
}

const TARGETS: C4LifecycleTarget[] = [
  {
    id: 'sync-job',
    label: 'Sync job',
    description: 'Estados queued → running → fases → completed | failed',
  },
  {
    id: 'api-request',
    label: 'Request HTTP',
    description: 'Ciclo navegación → handler → DB → respuesta UI',
  },
];

@Injectable()
export class C4LifecycleExtractor {
  constructor(private readonly projects: ProjectsService) {}

  listTargets(): C4LifecycleTarget[] {
    return TARGETS;
  }

  async buildLifecycle(
    projectId: string,
    target = 'sync-job',
    routePath?: string,
  ): Promise<{ spec: EntityLifecycleSpec; archifyIr: ArchifyLifecycleIr; target: string }> {
    const project = await this.projects.findOne(projectId);
    const spec =
      target === 'api-request'
        ? buildApiRequestLifecycleSpec(routePath)
        : buildSyncJobLifecycleSpec(project.name ?? projectId);
    return {
      spec,
      archifyIr: entityLifecycleToArchifyLifecycle(spec),
      target,
    };
  }
}
