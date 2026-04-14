import { describe, it, expect, afterEach } from 'vitest';
import { resolveRepositoryIdForModificationPlan } from './modification-plan-resolve.util';
import type { WorkspacePathRepoResolution } from '../projects/path-repo-resolution.util';

const repos = [
  { id: 'repo-a', projectKey: 'acme', repoSlug: 'backend', role: 'backend' },
  { id: 'repo-b', projectKey: 'acme', repoSlug: 'frontend', role: 'frontend' },
];

describe('resolveRepositoryIdForModificationPlan', () => {
  afterEach(() => {
    delete process.env.MODIFICATION_PLAN_LEGACY_FIRST_REPO;
  });

  it('elige el único repo del proyecto', async () => {
    const one = [repos[0]!];
    const r = await resolveRepositoryIdForModificationPlan('proj-1', one, {});
    expect(r).toEqual({ ok: true, repositoryId: 'repo-a' });
  });

  it('rechaza scope.repoIds si el proyecto tiene un solo repo y el id no coincide', async () => {
    const one = [repos[0]!];
    const r = await resolveRepositoryIdForModificationPlan('proj-1', one, {
      scope: { repoIds: ['repo-b'] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic.code).toBe('SCOPE_REPO_MISMATCH');
  });

  it('con varios repos y un scope.repoIds válido, ancla a ese id', async () => {
    const r = await resolveRepositoryIdForModificationPlan('proj-1', repos, {
      scope: { repoIds: ['repo-b'] },
    });
    expect(r).toEqual({ ok: true, repositoryId: 'repo-b' });
  });

  it('AMBIGUOUS_REPO_SCOPE si hay más de un repoIds', async () => {
    const r = await resolveRepositoryIdForModificationPlan('proj-1', repos, {
      scope: { repoIds: ['repo-a', 'repo-b'] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic.code).toBe('AMBIGUOUS_REPO_SCOPE');
  });

  it('INVALID_REPO_SCOPE si el uuid no está en el proyecto', async () => {
    const r = await resolveRepositoryIdForModificationPlan('proj-1', repos, {
      scope: { repoIds: ['other'] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic.code).toBe('INVALID_REPO_SCOPE');
  });

  it('resuelve por currentFilePath único', async () => {
    const resolveWorkspacePath = async (): Promise<WorkspacePathRepoResolution> => ({
      kind: 'unique',
      repositoryId: 'repo-b',
      label: 'acme/frontend',
    });
    const r = await resolveRepositoryIdForModificationPlan('proj-1', repos, {
      currentFilePath: '/work/acme/frontend/src/App.tsx',
      resolveWorkspacePath,
    });
    expect(r).toEqual({ ok: true, repositoryId: 'repo-b' });
  });

  it('AMBIGUOUS_PATH si la heurística devuelve ambiguous', async () => {
    const resolveWorkspacePath = async (): Promise<WorkspacePathRepoResolution> => ({
      kind: 'ambiguous',
      candidates: [
        { repositoryId: 'repo-a', label: 'a' },
        { repositoryId: 'repo-b', label: 'b' },
      ],
    });
    const r = await resolveRepositoryIdForModificationPlan('proj-1', repos, {
      currentFilePath: '/x/y',
      resolveWorkspacePath,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic.code).toBe('AMBIGUOUS_PATH');
  });

  it('AMBIGUOUS_SCOPE sin señal y varios repos', async () => {
    const r = await resolveRepositoryIdForModificationPlan('proj-1', repos, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic.code).toBe('AMBIGUOUS_SCOPE');
  });

  it('legacy: primer repo si MODIFICATION_PLAN_LEGACY_FIRST_REPO=true', async () => {
    process.env.MODIFICATION_PLAN_LEGACY_FIRST_REPO = 'true';
    const r = await resolveRepositoryIdForModificationPlan('proj-1', repos, {});
    expect(r).toEqual({ ok: true, repositoryId: 'repo-a' });
  });
});
