import { describe, expect, it } from 'vitest';
import {
  buildDefaultSyncWorkflowSpec,
  buildSyncJobLifecycleSpec,
  entityLifecycleToArchifyLifecycle,
  syncWorkflowToArchifyWorkflow,
} from 'ariadne-common';

describe('archify workflow/lifecycle mappers', () => {
  it('syncWorkflowToArchifyWorkflow produce IR workflow válido', () => {
    const spec = buildDefaultSyncWorkflowSpec('demo');
    const ir = syncWorkflowToArchifyWorkflow(spec);
    expect(ir.diagram_type).toBe('workflow');
    expect(ir.schema_version).toBe(2);
    expect(ir.mainPath).toContain('writing_graph');
    expect(ir.nodes.some((n) => n.id === 'failed')).toBe(true);
  });

  it('entityLifecycleToArchifyLifecycle incluye estados terminal', () => {
    const spec = buildSyncJobLifecycleSpec('demo');
    const ir = entityLifecycleToArchifyLifecycle(spec);
    expect(ir.diagram_type).toBe('lifecycle');
    expect(ir.states.some((s) => s.id === 'failed' && s.type === 'failure')).toBe(true);
    expect(ir.transitions.some((t) => t.to === 'failed')).toBe(true);
  });
});
