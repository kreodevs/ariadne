import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowService } from './workflow.service';

describe('WorkflowService', () => {
  let service: WorkflowService;

  beforeEach(() => {
    service = new WorkflowService();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('runRefactorFlow returns state with approved, impactDependents, contractProps', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ dependents: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ props: [{ name: 'a', required: true }] }),
      });

    const result = await service.runRefactorFlow('MyComponent', [
      { name: 'a', required: true },
    ]);

    expect(result.approved).toBe(true);
    expect(result.impactDependents).toEqual([]);
    expect(result.contractProps).toEqual([{ name: 'a', required: true }]);
    expect(result.contractsMatch).toBe(true);
  });

  it('runRefactorFlow sets approved false when dependents exist', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            dependents: [{ name: 'Other', labels: ['Component'] }],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ props: [] }),
      });

    const result = await service.runRefactorFlow('MyComponent');

    expect(result.approved).toBe(false);
    expect(result.impactDependents).toHaveLength(1);
  });
});
