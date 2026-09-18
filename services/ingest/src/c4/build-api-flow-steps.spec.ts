import { describe, expect, it } from 'vitest';
import { buildApiFlowSteps, inferHttpStatusCode } from 'ariadne-common';

describe('buildApiFlowSteps (ariadne-common)', () => {
  it('incluye retornos completos y status inferido', () => {
    const steps = buildApiFlowSteps({
      routePath: '/foo',
      screenName: 'Page',
      method: 'POST',
      handlerName: 'create',
      modelName: 'Event',
      serviceMethod: 'save',
    });
    expect(steps.at(-1)?.label).toBe('201 Created');
    expect(steps.some((s) => s.id === 'db-return' && s.from === 'db')).toBe(true);
    expect(inferHttpStatusCode('GET', 418)).toBe(418);
  });
});
