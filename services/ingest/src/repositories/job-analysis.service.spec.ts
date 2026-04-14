import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JobAnalysisService } from './job-analysis.service';
import type { Repository } from 'typeorm';
import type { SyncJob } from './entities/sync-job.entity';
import type { RepositoryEntity } from './entities/repository.entity';
import type { ProjectRepositoryEntity } from './entities/project-repository.entity';
import type { FileContentService } from './file-content.service';

describe('JobAnalysisService.analyzeJobForProject', () => {
  it('404 si el job no existe', async () => {
    const jobsRepo = {
      findOne: vi.fn().mockResolvedValue(null),
    } as unknown as Repository<SyncJob>;
    const projectRepoLink = { findOne: vi.fn() } as unknown as Repository<ProjectRepositoryEntity>;
    const instance = new JobAnalysisService(
      jobsRepo,
      {} as unknown as Repository<RepositoryEntity>,
      projectRepoLink,
      {} as unknown as FileContentService,
    );
    await expect(instance.analyzeJobForProject('p1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('400 si el repo del job no está enlazado al proyecto', async () => {
    const jobsRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'job-1',
        repositoryId: 'repo-1',
        type: 'incremental',
        status: 'completed',
        payload: { paths: ['x.ts'] },
      }),
    } as unknown as Repository<SyncJob>;
    const projectRepoLink = {
      findOne: vi.fn().mockResolvedValue(null),
    } as unknown as Repository<ProjectRepositoryEntity>;
    const instance = new JobAnalysisService(
      jobsRepo,
      {} as unknown as Repository<RepositoryEntity>,
      projectRepoLink,
      {} as unknown as FileContentService,
    );
    await expect(instance.analyzeJobForProject('p1', 'job-1')).rejects.toThrow(BadRequestException);
  });

  it('delega en analyzeJob cuando el enlace proyecto–repo existe', async () => {
    const jobsRepo = {
      findOne: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'job-1',
          repositoryId: 'repo-1',
          type: 'incremental',
          status: 'completed',
          payload: { paths: ['x.ts'] },
        })
        .mockResolvedValueOnce({
          id: 'job-1',
          repositoryId: 'repo-1',
          type: 'incremental',
          status: 'completed',
          payload: { paths: ['x.ts'] },
        }),
    } as unknown as Repository<SyncJob>;

    const repoRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'repo-1', repoSlug: 'slug' }),
    } as unknown as Repository<RepositoryEntity>;

    const projectRepoLink = {
      findOne: vi.fn().mockResolvedValue({ projectId: 'p1', repoId: 'repo-1' }),
    } as unknown as Repository<ProjectRepositoryEntity>;

    const fileContent = {
      getFileContentSafe: vi.fn().mockResolvedValue(null),
    } as unknown as FileContentService;

    const instance = new JobAnalysisService(jobsRepo, repoRepo, projectRepoLink, fileContent);
    const spy = vi.spyOn(instance as unknown as { analyzeJob: typeof instance.analyzeJob }, 'analyzeJob');
    spy.mockResolvedValue({
      jobId: 'job-1',
      repositoryId: 'repo-1',
      type: 'incremental',
      paths: ['x.ts'],
      summary: {
        riskScore: 1,
        totalPaths: 1,
        securityFindings: 0,
        dependentModules: 0,
      },
      impacto: { dependents: [] },
      seguridad: { findings: [] },
      resumenEjecutivo: 'ok',
    });

    const out = await instance.analyzeJobForProject('p1', 'job-1');
    expect(out.jobId).toBe('job-1');
    expect(spy).toHaveBeenCalledWith('repo-1', 'job-1');
    spy.mockRestore();
  });
});
