import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import type { ProjectsService } from '../projects/projects.service';
import type { RepositoriesService } from '../repositories/repositories.service';
import type { ChatService } from './chat.service';

const repoA = { id: 'repo-a', projectKey: 'acme', repoSlug: 'backend' } as const;
const repoB = { id: 'repo-b', projectKey: 'acme', repoSlug: 'frontend' } as const;

function svc(
  overrides: Partial<{
    findOneRepo: RepositoriesService['findOne'];
    findAllRepos: RepositoriesService['findAll'];
    findOneProject: ProjectsService['findOne'];
    resolveRepoForPath: ProjectsService['resolveRepoForPath'];
  }> = {},
) {
  const repos = {
    findOne: overrides.findOneRepo ?? vi.fn().mockResolvedValue({ id: 'repo-a' }),
    findAll: overrides.findAllRepos ?? vi.fn().mockResolvedValue([repoA]),
  } as unknown as RepositoriesService;

  const projects = {
    findOne: overrides.findOneProject ?? vi.fn().mockResolvedValue({ id: 'proj-1' }),
    resolveRepoForPath:
      overrides.resolveRepoForPath ??
      vi.fn().mockResolvedValue({ repoId: 'repo-b', kind: 'unique' as const }),
  } as unknown as ProjectsService;

  const chat = { analyze: vi.fn() } as unknown as ChatService;

  return { analytics: new AnalyticsService(projects, repos, chat), repos, projects, chat };
}

describe('AnalyticsService.resolveRepositoryIdForAnalysis', () => {
  it('rechaza projectId vacío', async () => {
    const { analytics } = svc();
    await expect(analytics.resolveRepositoryIdForAnalysis({ projectId: '  ' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('con repositoryId válido en el proyecto, lo devuelve', async () => {
    const findAll = vi.fn().mockResolvedValue([repoA, repoB]);
    const findOne = vi.fn().mockResolvedValue({ id: 'repo-b' });
    const { analytics, repos } = svc({ findAllRepos: findAll, findOneRepo: findOne });
    const id = await analytics.resolveRepositoryIdForAnalysis({
      projectId: 'proj-1',
      repositoryId: 'repo-b',
    });
    expect(id).toBe('repo-b');
    expect(findOne).toHaveBeenCalledWith('repo-b');
    expect(findAll).toHaveBeenCalledWith('proj-1');
  });

  it('rechaza repositoryId que no pertenece al proyecto', async () => {
    const findAll = vi.fn().mockResolvedValue([repoA]);
    const { analytics } = svc({ findAllRepos: findAll, findOneRepo: vi.fn().mockResolvedValue({}) });
    await expect(
      analytics.resolveRepositoryIdForAnalysis({
        projectId: 'proj-1',
        repositoryId: 'repo-b',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('mono-root: único repo del proyecto', async () => {
    const findAll = vi.fn().mockResolvedValue([repoA]);
    const { analytics } = svc({ findAllRepos: findAll });
    const id = await analytics.resolveRepositoryIdForAnalysis({ projectId: 'proj-1' });
    expect(id).toBe('repo-a');
 });

  it('multi-root sin repositoryId ni idePath → 400', async () => {
    const findAll = vi.fn().mockResolvedValue([repoA, repoB]);
    const { analytics } = svc({ findAllRepos: findAll });
    await expect(analytics.resolveRepositoryIdForAnalysis({ projectId: 'proj-1' })).rejects.toThrow(
      /multi-root/i,
    );
  });

  it('multi-root con idePath resuelto → repoId', async () => {
    const findAll = vi.fn().mockResolvedValue([repoA, repoB]);
    const resolveRepoForPath = vi.fn().mockResolvedValue({ repoId: 'repo-b' });
    const { analytics, projects } = svc({ findAllRepos: findAll, resolveRepoForPath });
    const id = await analytics.resolveRepositoryIdForAnalysis({
      projectId: 'proj-1',
      idePath: '/work/acme/frontend/src/App.tsx',
    });
    expect(id).toBe('repo-b');
    expect(resolveRepoForPath).toHaveBeenCalledWith('proj-1', '/work/acme/frontend/src/App.tsx');
    expect(projects.findOne).toHaveBeenCalledWith('proj-1');
  });

  it('multi-root con idePath sin match → 400', async () => {
    const findAll = vi.fn().mockResolvedValue([repoA, repoB]);
    const resolveRepoForPath = vi.fn().mockResolvedValue({ repoId: null });
    const { analytics } = svc({ findAllRepos: findAll, resolveRepoForPath });
    await expect(
      analytics.resolveRepositoryIdForAnalysis({
        projectId: 'proj-1',
        idePath: '/unknown/path',
      }),
    ).rejects.toThrow(/No se pudo inferir/);
  });

  it('proyecto sin repos → 400', async () => {
    const findAll = vi.fn().mockResolvedValue([]);
    const { analytics } = svc({ findAllRepos: findAll });
    await expect(analytics.resolveRepositoryIdForAnalysis({ projectId: 'proj-1' })).rejects.toThrow(
      /sin repositorios/,
    );
  });
});

describe('AnalyticsService.analyzeByProjectId', () => {
  it('delega en chat.analyze con el repo resuelto', async () => {
    const findAll = vi.fn().mockResolvedValue([repoA]);
    const analyze = vi.fn().mockResolvedValue({ markdown: 'ok' });
    const repos = {
      findOne: vi.fn(),
      findAll: findAll,
    } as unknown as RepositoriesService;
    const projects = {
      findOne: vi.fn().mockResolvedValue({ id: 'proj-1' }),
      resolveRepoForPath: vi.fn(),
    } as unknown as ProjectsService;
    const chat = { analyze } as unknown as ChatService;
    const analytics = new AnalyticsService(projects, repos, chat);

    const out = await analytics.analyzeByProjectId('proj-1', 'diagnostico', {
      analyzeOptions: { scope: { repoIds: ['repo-a'] } },
    });
    expect(out).toEqual({ markdown: 'ok' });
    expect(analyze).toHaveBeenCalledWith('repo-a', 'diagnostico', {
      scope: { repoIds: ['repo-a'] },
    });
  });
});
