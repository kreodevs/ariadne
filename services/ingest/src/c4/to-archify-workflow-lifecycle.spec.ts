import { describe, expect, it } from 'vitest';
import {
  buildDefaultSyncWorkflowSpec,
  buildRouteFlowWorkflowSpec,
  buildSyncJobLifecycleSpec,
  entityLifecycleToArchifyLifecycle,
  syncWorkflowToArchifyWorkflow,
} from 'ariadne-common';

describe('archify workflow/lifecycle mappers', () => {
  it('syncWorkflowToArchifyWorkflow produce IR workflow válido', () => {
    const spec = buildDefaultSyncWorkflowSpec('demo');
    const ir = syncWorkflowToArchifyWorkflow(spec);
    expect(ir.diagram_type).toBe('workflow');
    expect(ir.schema_version).toBe(1);
    expect(ir.edges.every((e) => !('id' in e))).toBe(true);
    expect(ir.nodes.every((n) => n.col <= 5)).toBe(true);
    expect(ir.mainPath).toContain('writing_graph');
    expect(ir.nodes.some((n) => n.id === 'failed')).toBe(true);
  });

  it('buildRouteFlowWorkflowSpec cabe en columnas Archify', () => {
    const spec = buildRouteFlowWorkflowSpec({
      routePath: '/admin/evento',
      screenName: 'EventoPage',
      method: 'GET',
      apiPath: '/api/eventos/:id',
      handlerName: 'findOne',
    });
    const ir = syncWorkflowToArchifyWorkflow(spec);
    expect(ir.nodes.every((n) => n.col <= 5)).toBe(true);
    expect(ir.mainPath).toContain('handler');
  });

  it('entityLifecycleToArchifyLifecycle incluye estados terminal', () => {
    const spec = buildSyncJobLifecycleSpec('demo');
    const ir = entityLifecycleToArchifyLifecycle(spec);
    expect(ir.diagram_type).toBe('lifecycle');
    expect(ir.states.some((s) => s.id === 'failed' && s.type === 'failure')).toBe(true);
    expect(ir.transitions.some((t) => t.to === 'failed')).toBe(true);
    expect(ir.transitions.every((t) => !('id' in t))).toBe(true);
    expect(ir.meta.quality_profile).toBeUndefined();
  });
});
