/**
 * @fileoverview Webhooks Bitbucket/GitHub: push → encola sync incremental.
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FalkorDB } from 'falkordb';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { SyncJob } from '../repositories/entities/sync-job.entity';
import { IndexedFile } from '../repositories/entities/indexed-file.entity';
import { RepositoriesService } from '../repositories/repositories.service';
import { BitbucketService } from '../bitbucket/bitbucket.service';
import { getFalkorConfig } from '../pipeline/falkor';
import { GRAPH_NAME } from '../pipeline/falkor';
import { parseSource } from '../pipeline/parser';
import { extractDomainConcepts } from '../pipeline/domain-extract';
import {
  buildCypherForFile,
  buildCypherDeleteFile,
  resolveCrossFileCalls,
  resolveImportPath,
  runCypherBatch,
} from '../pipeline/producer';
import { buildProjectMergeCypher } from '../pipeline/project';
import type { ParsedFile } from '../pipeline/parser';

interface PushPayload {
  repository?: { full_name?: string; name?: string };
  push?: {
    changes?: Array<{
      new?: { name?: string; type?: string };
      commits?: Array<{ hash?: string }>;
    }>;
  };
}

/** Procesa webhooks de push (Bitbucket) y encola sync. */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly bitbucket: BitbucketService,
    private readonly repos: RepositoriesService,
    @InjectRepository(RepositoryEntity)
    private readonly repoRepo: Repository<RepositoryEntity>,
    @InjectRepository(SyncJob)
    private readonly syncJobRepo: Repository<SyncJob>,
    @InjectRepository(IndexedFile)
    private readonly indexedFileRepo: Repository<IndexedFile>,
  ) {}

  /**
   * Procesa un evento repo:push de Bitbucket: localiza repo, obtiene diff por commits e indexa cambios en FalkorDB.
   * @param {PushPayload} payload - Payload del webhook (repository.full_name, push.changes con commits).
   * @returns {Promise<void>}
   */
  async handleBitbucketPush(payload: PushPayload): Promise<void> {
    const repoInfo = payload.repository;
    if (!repoInfo?.full_name) return;
    const [workspace, repoSlug] = repoInfo.full_name.split('/');
    if (!workspace || !repoSlug) return;

    const repo = await this.repoRepo.findOne({
      where: { provider: 'bitbucket', projectKey: workspace, repoSlug },
    });
    if (!repo) return;

    const changes = payload.push?.changes ?? [];
    const branch = changes[0]?.new?.name ?? repo.defaultBranch;
    const allCommits: string[] = [];
    for (const ch of changes) {
      for (const c of ch.commits ?? []) {
        if (c.hash) allCommits.push(c.hash);
      }
    }
    if (allCommits.length === 0) return;

    const job = this.syncJobRepo.create({
      repositoryId: repo.id,
      type: 'incremental',
      startedAt: new Date(),
      status: 'running',
      payload: { branch, commits: allCommits },
    });
    await this.syncJobRepo.save(job);

    try {
      const changedPathsSet = new Set<string>();
      for (const hash of allCommits) {
        const paths = await this.bitbucket.getChangedPathsInCommit(
          workspace,
          repoSlug,
          hash,
          repo.credentialsRef,
        );
        paths.forEach((p) => changedPathsSet.add(p));
      }
      const pathsToProcess = Array.from(changedPathsSet);
      if (pathsToProcess.length === 0) {
        const latestSha = allCommits[allCommits.length - 1] ?? null;
        await this.repoRepo.update(repo.id, {
          lastSyncAt: new Date(),
          lastCommitSha: latestSha,
          status: 'ready',
        });
        await this.syncJobRepo.update(job.id, {
          finishedAt: new Date(),
          status: 'completed',
          payload: { ...job.payload, indexed: 0, deleted: 0 },
        });
        await this.repos.pruneOldJobs(repo.id, 5);
        return;
      }

      const existingFiles = await this.indexedFileRepo.find({
        where: { repositoryId: repo.id },
        select: ['path'],
      });
      const pathSet = new Set([
        ...pathsToProcess,
        ...existingFiles.map((f) => f.path),
      ]);

      const config = getFalkorConfig();
      const client = await FalkorDB.connect({
        socket: { host: config.host, port: config.port },
      });
      const graph = client.selectGraph(GRAPH_NAME);
      const graphClient = { query: (cypher: string) => graph.query(cypher) };

      const projectIdsFromJunction = await this.repos.getProjectIdsForRepo(repo.id);
      const allProjectIds =
        projectIdsFromJunction.length > 0 ? projectIdsFromJunction : [repo.id];
      const repoId = repo.id;
      const projectName = `${repo.projectKey}/${repo.repoSlug}`;
      for (const projectId of allProjectIds) {
        await graph.query(buildProjectMergeCypher({ projectId, projectName, rootPath: repoSlug }));
      }

      const commitSha = allCommits[allCommits.length - 1] ?? null;
      const chunkingContext = commitSha ? { commitSha } : undefined;

      let indexed = 0;
      let deleted = 0;
      const parsedFiles: ParsedFile[] = [];

      for (const relPath of pathsToProcess) {
        let content: string | null = null;
        try {
          content = await this.bitbucket.getFileContent(
            workspace,
            repoSlug,
            branch,
            relPath,
            repo.credentialsRef,
          );
        } catch (err) {
          const msg = String(err instanceof Error ? err.message : err);
          if (msg.includes('404') || msg.includes('Not Found')) {
            for (const projectId of allProjectIds) {
              await runCypherBatch(graphClient, buildCypherDeleteFile(relPath, projectId, repoId));
            }
            const existing = await this.indexedFileRepo.findOne({
              where: { repositoryId: repo.id, path: relPath },
            });
            if (existing) {
              await this.indexedFileRepo.delete(existing.id);
              deleted++;
            }
          } else {
            console.error(`Webhook: error fetching ${relPath}:`, err);
          }
          continue;
        }

        if (!content) continue;
        const out = parseSource(relPath, content, { extractDomainConcepts });
        const parsed = out && 'root' in out ? out.parsed : out;
        if (!parsed) continue;
        parsedFiles.push(parsed);
      }

      const resolvePath = (from: string, spec: string) =>
        resolveImportPath(from, spec, pathSet, { prefix: '' });
      const resolvedCalls = resolveCrossFileCalls(
        parsedFiles,
        pathSet,
        resolvePath,
      );

      for (const parsed of parsedFiles) {
        try {
          const resolvedImports: string[] = [];
          for (const imp of parsed.imports) {
            const r = resolvePath(parsed.path, imp.specifier);
            if (r) resolvedImports.push(r);
          }
          const callsForFile = resolvedCalls.filter(
            (rc) => rc.callerPath === parsed.path,
          );
          for (const projectId of allProjectIds) {
            const statements = buildCypherForFile(
              parsed,
              resolvedImports,
              pathSet,
              callsForFile,
              projectId,
              repoId,
              chunkingContext,
            );
            await runCypherBatch(graphClient, statements);
          }
          const existing = await this.indexedFileRepo.findOne({
            where: { repositoryId: repo.id, path: parsed.path },
          });
          if (existing) {
            await this.indexedFileRepo.update(existing.id, {
              indexedAt: new Date(),
              revision: commitSha,
            });
          } else {
            await this.indexedFileRepo.save(
              this.indexedFileRepo.create({
                repositoryId: repo.id,
                path: parsed.path,
                revision: commitSha,
                indexedAt: new Date(),
              }),
            );
          }
          indexed++;
        } catch (err) {
          console.error(`Webhook: error indexing ${parsed.path}:`, err);
        }
      }

      await client.close();
      await this.repoRepo.update(repo.id, {
        lastSyncAt: new Date(),
        lastCommitSha: commitSha,
        status: 'ready',
      });
      await this.syncJobRepo.update(job.id, {
        finishedAt: new Date(),
        status: 'completed',
        payload: {
          ...job.payload,
          indexed,
          deleted,
          paths: pathsToProcess.slice(0, 50),
        },
      });
      await this.repos.pruneOldJobs(repo.id, 5);
    } catch (err) {
      await this.syncJobRepo.update(job.id, {
        finishedAt: new Date(),
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      await this.repoRepo.update(repo.id, { status: 'error' });
      await this.repos.pruneOldJobs(repo.id, 5);
      throw err;
    }
  }
}
