import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FalkorDB } from 'falkordb';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { SyncJob } from '../repositories/entities/sync-job.entity';
import { IndexedFile } from '../repositories/entities/indexed-file.entity';
import { RepositoriesService } from '../repositories/repositories.service';
import { EmbedIndexService } from '../embedding/embed-index.service';
import { BitbucketService } from '../bitbucket/bitbucket.service';
import { GitHubService } from '../providers/github.service';
import { runShallowClone } from '../providers/git-clone.provider';
import { getFalkorConfig, graphNameForProject, isProjectShardingEnabled } from '../pipeline/falkor';
import { parseSource } from '../pipeline/parser';
import { extractDomainConcepts, inferDomainConfig } from '../pipeline/domain-extract';
import {
  buildCypherForFile,
  buildCypherDeleteFile,
  resolveCrossFileCalls,
  resolveImportPath,
  runCypherBatch,
  ensureFalkorIndexes,
} from '../pipeline/producer';
import { buildCypherForPrismaSchema } from '../pipeline/prisma-extract';
import { loadRepoTsconfigPaths } from '../pipeline/tsconfig-resolve';
import { chunkMarkdown } from '../pipeline/markdown-chunk';
import { buildCypherForMarkdownFile } from '../pipeline/markdown-graph';
import { buildProjectMergeCypher } from '../pipeline/project';
import type { ParsedFile } from '../pipeline/parser';
import { recordSyncJobFailed } from '../metrics/ingest-metrics';

/**
 * @fileoverview Servicio de sync: mapping, deps, chunking, FalkorDB, embed-index post-sync.
 */

/** Adaptador de provider (Bitbucket/GitHub) para listar archivos y contenido. */
interface RepoProviderAdapter {
  listFiles(owner: string, repo: string, ref: string, credentialsRef?: string | null): Promise<string[]>;
  getFileContent(owner: string, repo: string, ref: string, path: string, credentialsRef?: string | null): Promise<string>;
  getFileContentSafe?(
    owner: string,
    repo: string,
    ref: string,
    path: string,
    credentialsRef?: string | null,
  ): Promise<string | null>;
  getLatestCommitSha(owner: string, repo: string, ref: string, credentialsRef?: string | null): Promise<string | null>;
}

/** Phase 1: Map repo structure and detect languages */
interface MappingResult {
  paths: string[];
  pathSet: Set<string>;
  languages: Record<string, number>;
}

/** Phase 2: Extract dependency manifests */
function extractManifestDeps(
  pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
): string {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return JSON.stringify(Object.keys(deps || {}));
}

@Injectable()
export class SyncService {
  constructor(
    private readonly repos: RepositoriesService,
    private readonly bitbucket: BitbucketService,
    private readonly github: GitHubService,
    private readonly embedIndex: EmbedIndexService,
    @InjectRepository(SyncJob)
    private readonly syncJobRepo: Repository<SyncJob>,
    @InjectRepository(IndexedFile)
    private readonly indexedFileRepo: Repository<IndexedFile>,
    @InjectRepository(RepositoryEntity)
    private readonly repoRepo: Repository<RepositoryEntity>,
  ) {}

  /**
   * Crea un job de sync en estado queued para mostrar en la UI inmediatamente al encolar.
   * @param {string} repositoryId - ID del repositorio.
   * @returns {Promise<SyncJob>} Job creado (id, status: queued).
   */
  async createQueuedJob(repositoryId: string): Promise<SyncJob> {
    const job = this.syncJobRepo.create({
      repositoryId,
      type: 'full',
      startedAt: new Date(),
      status: 'queued',
      payload: { phase: 'queued' },
    });
    await this.syncJobRepo.save(job);
    return job;
  }

  /**
   * Borra todo el grafo e índice del proyecto (nodos con projectId, registros en indexed_file). Luego se puede re-sincronizar.
   * @param {string} repositoryId - ID del repositorio (projectId en FalkorDB para proyecto implícito 1:1).
   * @returns {Promise<{ deletedNodes: number }>} Número de nodos eliminados del grafo.
   */
  async clearProject(repositoryId: string): Promise<{ deletedNodes: number }> {
    await this.repos.findOne(repositoryId);
    const projectId = repositoryId;

    const config = getFalkorConfig();
    const client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
    try {
      const graph = client.selectGraph(
        graphNameForProject(isProjectShardingEnabled() ? projectId : undefined),
      );
      const countRes = (await graph.query(
        `MATCH (n) WHERE n.projectId = $projectId RETURN count(n) as c`,
        { params: { projectId } },
      )) as { data?: [{ c: number }] };
      const countBefore = countRes.data?.[0]?.c ?? 0;

      await graph.query(
        `MATCH (n) WHERE n.projectId = $projectId DETACH DELETE n`,
        { params: { projectId } },
      );

      await this.indexedFileRepo.delete({ repositoryId });

      return { deletedNodes: countBefore };
    } finally {
      await client.close();
    }
  }

  /**
   * Borra del grafo solo los nodos de un (projectId, repoId). Para resync solo de ese proyecto.
   */
  async clearProjectRepo(projectId: string, repoId: string): Promise<{ deletedNodes: number }> {
    const config = getFalkorConfig();
    const client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
    try {
      const graph = client.selectGraph(
        graphNameForProject(isProjectShardingEnabled() ? projectId : undefined),
      );
      const countRes = (await graph.query(
        `MATCH (n) WHERE n.projectId = $projectId AND n.repoId = $repoId RETURN count(n) as c`,
        { params: { projectId, repoId } },
      )) as { data?: [{ c: number }] };
      const countBefore = countRes.data?.[0]?.c ?? 0;
      await graph.query(
        `MATCH (n) WHERE n.projectId = $projectId AND n.repoId = $repoId DETACH DELETE n`,
        { params: { projectId, repoId } },
      );
      return { deletedNodes: countBefore };
    } finally {
      await client.close();
    }
  }

  /**
   * Ejecuta full sync: mapping → deps → chunking (parse + producer) → FalkorDB → embed-index.
   * Escribe nodos en cada proyecto al que pertenece el repo (standalone + project_repositories).
   * @param {string} repositoryId - ID del repositorio.
   * @param {string} [existingSyncJobId] - ID de job ya creado (opcional).
   * @param {object} [options] - onlyProjectId: si se pasa, solo se indexa en ese proyecto (y antes se limpia ese projectId+repoId).
   * @returns {Promise<{ jobId: string; indexed: number }>}
   */
  async runFullSync(
    repositoryId: string,
    existingSyncJobId?: string,
    options?: { onlyProjectId?: string },
  ): Promise<{ jobId: string; indexed: number }> {
    const repo = await this.repos.findOne(repositoryId);
    const provider = this.getRepoProvider(repo.provider);
    if (!provider || typeof provider.getFileContent !== 'function') {
      throw new Error(
        `Unsupported or misconfigured provider: ${repo.provider}. ` +
          'BitbucketModule and ProvidersModule must be imported.',
      );
    }

    let job: SyncJob;
    if (existingSyncJobId) {
      job = await this.syncJobRepo.findOneOrFail({
        where: { id: existingSyncJobId, repositoryId },
      });
      job.status = 'running';
      job.payload = job.payload ?? {};
      await this.syncJobRepo.save(job);
    } else {
      job = this.syncJobRepo.create({
        repositoryId,
        type: 'full',
        startedAt: new Date(),
        status: 'running',
        payload: {},
      });
      await this.syncJobRepo.save(job);
    }

    const owner = repo.projectKey;
    const repoSlug = repo.repoSlug;
    const ref = repo.defaultBranch;
    const repoId = repo.id;
    let projectIds: string[];
    if (options?.onlyProjectId) {
      await this.clearProjectRepo(options.onlyProjectId, repoId);
      projectIds = [options.onlyProjectId];
    } else {
      const projectIdsFromJunction = await this.repos.getProjectIdsForRepo(repositoryId);
      projectIds =
        projectIdsFromJunction.length > 0 ? projectIdsFromJunction : [repoId];
    }

    const hasCreds =
      repo.credentialsRef ||
      (repo.provider === 'bitbucket' && (process.env.BITBUCKET_TOKEN || process.env.BITBUCKET_APP_PASSWORD)) ||
      (repo.provider === 'github' && (process.env.GITHUB_TOKEN || process.env.GH_TOKEN));

    let cloneResult: Awaited<ReturnType<typeof runShallowClone>> | null = null;
    if (hasCreds && (repo.provider === 'bitbucket' || repo.provider === 'github')) {
      const cloneOpts =
        repo.provider === 'bitbucket'
          ? await this.bitbucket.getCloneOpts(owner, repoSlug, ref, repo.credentialsRef)
          : await this.github.getCloneOpts(owner, repoSlug, ref, repo.credentialsRef);
      if (cloneOpts?.token) {
        try {
          await this.updateJobProgress(job.id, { phase: 'mapping', message: 'cloning' });
          cloneResult = await runShallowClone({
            cloneUrl: cloneOpts.cloneUrl,
            ref: cloneOpts.ref,
            token: cloneOpts.token,
            tokenUsername: cloneOpts.tokenUsername,
          });
        } catch (err) {
          console.warn('Sync: clone failed, falling back to API:', err);
        }
      }
    }

    try {
      let paths: string[];
      let pathSet: Set<string>;
      let getContent: (relPath: string) => Promise<string | null>;
      let getLatestCommitSha: () => Promise<string | null>;

      if (cloneResult) {
        paths = cloneResult.paths;
        pathSet = new Set(paths);
        getContent = cloneResult.getContent;
        getLatestCommitSha = cloneResult.getLatestCommitSha;
      } else {
        await this.updateJobProgress(job.id, { phase: 'mapping' });
        const mapping = await this.phaseMapping(provider, owner, repoSlug, ref, repo.credentialsRef);
        paths = mapping.paths;
        pathSet = mapping.pathSet;
        const p = provider;
        if (!p?.getFileContent) {
          throw new Error(`Provider ${repo.provider} missing getFileContent (sync API fallback)`);
        }
        getContent = async (relPath: string) => {
          try {
            return await p.getFileContent(owner, repoSlug, ref, relPath, repo.credentialsRef);
          } catch {
            return null;
          }
        };
        getLatestCommitSha = () =>
          p.getLatestCommitSha(owner, repoSlug, ref, repo.credentialsRef);
      }

      await this.updateJobProgress(job.id, { phase: 'mapping_done', filesFound: paths.length });

      let manifestDeps: string | null = null;
      if (cloneResult) {
        const pkgContent = await getContent('package.json');
        if (pkgContent) {
          try {
            const pkg = JSON.parse(pkgContent) as Record<string, unknown>;
            manifestDeps = extractManifestDeps(
              pkg as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
            );
          } catch {
            /* ignore */
          }
        }
      } else {
        manifestDeps = await this.phaseDependencyAnalysis(
          provider,
          owner,
          repoSlug,
          ref,
          repo.credentialsRef,
        );
      }

      const config = getFalkorConfig();
      const client = await FalkorDB.connect({
        socket: { host: config.host, port: config.port },
      });
      const projectName = `${repo.projectKey}/${repo.repoSlug}`;
      const rootPath = repoSlug;

      await this.updateJobProgress(job.id, { phase: 'indexing', total: paths.length });
      const parsedByPath = new Map<string, ParsedFile>();
      const prismaFiles: { path: string; content: string }[] = [];
      const markdownFiles: { path: string; content: string }[] = [];
      const isFirstSync = repo.domainConfig == null;
      let fetchedCount = 0;
      const withAst: Array<{ parsed: ParsedFile; root: import('tree-sitter').SyntaxNode; source: string }> = [];
      const skipped: { fetch: string[]; parse: string[] } = { fetch: [], parse: [] };

      for (const relPath of paths) {
        try {
          const content = await getContent(relPath);
          fetchedCount++;
          if (fetchedCount % 10 === 0 || fetchedCount === paths.length) {
            await this.updateJobProgress(job.id, {
              phase: 'indexing',
              current: fetchedCount,
              total: paths.length,
              lastFile: relPath,
            });
          }
          if (!content) {
            skipped.fetch.push(relPath);
            continue;
          }
          if (relPath.toLowerCase().endsWith('.prisma')) {
            prismaFiles.push({ path: relPath, content });
            continue;
          }
          if (relPath.toLowerCase().endsWith('.md')) {
            markdownFiles.push({ path: relPath, content });
            continue;
          }
          if (isFirstSync) {
            const out = parseSource(relPath, content, { returnAst: true });
            if (out && 'root' in out) {
              withAst.push({ parsed: out.parsed, root: out.root, source: out.source });
              parsedByPath.set(relPath, out.parsed);
            } else if (out) {
              parsedByPath.set(relPath, out);
            } else if (!out) {
              skipped.parse.push(relPath);
            }
          } else {
            const parsed = parseSource(relPath, content, {
              domainConfig: repo.domainConfig,
              extractDomainConcepts,
            });
            if (parsed && !('root' in parsed)) {
              parsedByPath.set(relPath, parsed);
            } else if (!parsed) {
              skipped.parse.push(relPath);
            }
          }
        } catch (err) {
          console.error(`Sync: error fetching/parsing ${relPath}:`, err);
          skipped.parse.push(relPath);
        }
      }

      if (isFirstSync && withAst.length > 0) {
        const inferred = inferDomainConfig(withAst);
        await this.repoRepo.update(repositoryId, { domainConfig: inferred });
        for (const { parsed, root, source } of withAst) {
          parsed.domainConcepts = extractDomainConcepts(parsed, source, root, inferred);
        }
      }

      const parsedFiles = Array.from(parsedByPath.values());

      let tsconfigPaths: Awaited<ReturnType<typeof loadRepoTsconfigPaths>> = null;
      try {
        tsconfigPaths = await loadRepoTsconfigPaths(getContent);
      } catch {
        /* ignore */
      }

      const resolveOpts = tsconfigPaths ? { tsconfig: tsconfigPaths, prefix: '' } : { prefix: '' };
      const resolvePath = (from: string, spec: string) =>
        resolveImportPath(from, spec, pathSet, resolveOpts);
      const resolvedCalls = resolveCrossFileCalls(parsedFiles, pathSet, resolvePath);

      const commitSha = await getLatestCommitSha();
      const chunkingContext = commitSha ? { commitSha } : undefined;

      const indexedPaths: string[] = [];
      const skippedIndex: string[] = [];
      const previouslyIndexed = await this.indexedFileRepo.find({
        where: { repositoryId },
        select: ['path'],
      });

      for (const projectId of projectIds) {
        const graph = client.selectGraph(
          graphNameForProject(isProjectShardingEnabled() ? projectId : undefined),
        );
        const graphClient = { query: (cypher: string) => graph.query(cypher) };
        await ensureFalkorIndexes(graphClient);

        await graph.query(
          buildProjectMergeCypher({
            projectId,
            projectName,
            rootPath,
            branch: repo.defaultBranch ?? null,
            manifestDeps: manifestDeps || null,
          }),
        );
        for (const parsed of parsedFiles) {
          try {
            const resolvedImports: string[] = [];
            for (const imp of parsed.imports) {
              const r = resolvePath(parsed.path, imp.specifier);
              if (r && !resolvedImports.includes(r)) resolvedImports.push(r);
            }
            const callsForFile = resolvedCalls.filter(
              (rc) => rc.callerPath === parsed.path,
            );
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
            if (projectId === projectIds[0]) indexedPaths.push(parsed.path);
          } catch (err) {
            console.error(`Sync: error indexing ${parsed.path}:`, err);
            if (projectId === projectIds[0]) skippedIndex.push(parsed.path);
          }
        }
        for (const pf of prismaFiles) {
          try {
            const statements = await buildCypherForPrismaSchema(pf.path, pf.content, projectId, repoId);
            await runCypherBatch(graphClient, statements);
            if (projectId === projectIds[0]) indexedPaths.push(pf.path);
          } catch (err) {
            console.error(`Sync: error indexing Prisma ${pf.path}:`, err);
            if (projectId === projectIds[0]) skippedIndex.push(pf.path);
          }
        }
        for (const mf of markdownFiles) {
          try {
            const chunks = chunkMarkdown(mf.content);
            const statements = buildCypherForMarkdownFile(mf.path, chunks, projectId, repoId);
            await runCypherBatch(graphClient, statements);
            if (projectId === projectIds[0]) indexedPaths.push(mf.path);
          } catch (err) {
            console.error(`Sync: error indexing Markdown ${mf.path}:`, err);
            if (projectId === projectIds[0]) skippedIndex.push(mf.path);
          }
        }
        const currentSet = new Set(indexedPaths);
        for (const f of previouslyIndexed) {
          if (!currentSet.has(f.path)) {
            await runCypherBatch(graphClient, buildCypherDeleteFile(f.path, projectId, repoId));
          }
        }
      }

      const currentSet = new Set(indexedPaths);
      for (const f of previouslyIndexed) {
        if (!currentSet.has(f.path)) {
          await this.indexedFileRepo.delete({
            repositoryId,
            path: f.path,
          });
        }
      }

      await client.close();

      await this.repoRepo.update(repositoryId, {
        lastSyncAt: new Date(),
        lastCommitSha: commitSha,
        status: 'ready',
      });
      const allSkipped = [...skipped.fetch, ...skipped.parse, ...skippedIndex];
      await this.syncJobRepo.update(job.id, {
        finishedAt: new Date(),
        status: 'completed',
        payload: {
          indexed: indexedPaths.length,
          total: paths.length,
          paths: indexedPaths.slice(0, 100),
          skipped: allSkipped.length,
          skippedPaths: allSkipped.slice(0, 50),
          skippedByReason: {
            fetch: skipped.fetch.length,
            parse: skipped.parse.length,
            index: skippedIndex.length,
          },
          skippedPathsByReason: {
            fetch: skipped.fetch.slice(0, 100),
            parse: skipped.parse.slice(0, 100),
            index: skippedIndex.slice(0, 100),
          },
          ...(commitSha != null && { commitSha }),
        } as object,
      });

      // Upsert IndexedFile with revision (commitSha)
      await this.indexedFileRepo.delete({ repositoryId });
      for (const p of indexedPaths) {
        await this.indexedFileRepo.save(
          this.indexedFileRepo.create({
            repositoryId,
            path: p,
            revision: commitSha ?? undefined,
            indexedAt: new Date(),
          }),
        );
      }

      try {
        const embedRes = await this.embedIndex.runEmbedIndex(repositoryId);
        console.log(`Embed-index post-sync: ${embedRes.indexed} indexed, ${embedRes.errors} errors`);
      } catch (e) {
        console.warn('Embed-index post-sync skipped:', e instanceof Error ? e.message : String(e));
      }

      await this.repos.pruneOldJobs(repositoryId, 5);
      return { jobId: job.id, indexed: indexedPaths.length };
    } catch (err) {
      recordSyncJobFailed('full_sync');
      await this.syncJobRepo.update(job.id, {
        finishedAt: new Date(),
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      await this.repoRepo.update(repositoryId, { status: 'error' });
      await this.repos.pruneOldJobs(repositoryId, 5);
      throw err;
    } finally {
      if (cloneResult) cloneResult.cleanup();
    }
  }

  private async updateJobProgress(
    jobId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const job = await this.syncJobRepo.findOne({ where: { id: jobId } });
    if (job) {
      await this.syncJobRepo.update(jobId, {
        payload: { ...(job.payload ?? {}), ...payload } as object,
      });
    }
  }

  private getRepoProvider(
    provider: string,
  ): RepoProviderAdapter | null {
    if (provider === 'bitbucket') return this.bitbucket;
    if (provider === 'github') return this.github;
    return null;
  }

  private async phaseMapping(
    provider: RepoProviderAdapter,
    owner: string,
    repoSlug: string,
    ref: string,
    credentialsRef?: string | null,
  ): Promise<MappingResult> {
    const paths = await provider.listFiles(owner, repoSlug, ref, credentialsRef);
    const pathSet = new Set(paths);

    const languages: Record<string, number> = {};
    for (const p of paths) {
      const ext = p.slice(p.lastIndexOf('.'));
      if (ext) {
        languages[ext] = (languages[ext] ?? 0) + 1;
      }
    }

    return { paths, pathSet, languages };
  }

  private async phaseDependencyAnalysis(
    provider: RepoProviderAdapter,
    owner: string,
    repoSlug: string,
    ref: string,
    credentialsRef?: string | null,
  ): Promise<string | null> {
    if (!provider?.getFileContent) {
      throw new Error('Provider missing getFileContent (phaseDependencyAnalysis)');
    }
    const manifestPaths = ['package.json', 'requirements.txt', 'go.mod'];
    const getSafe =
      provider.getFileContentSafe ??
      ((o: string, r: string, re: string, p: string, cr?: string | null) =>
        provider.getFileContent(o, r, re, p, cr).catch(() => null));
    for (const manifestPath of manifestPaths) {
      const content = await getSafe(owner, repoSlug, ref, manifestPath, credentialsRef);
      if (content && manifestPath === 'package.json') {
        try {
          const pkg = JSON.parse(content) as Record<string, unknown>;
          return extractManifestDeps(
            pkg as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
          );
        } catch {
          // ignore parse errors
        }
      }
    }
    return null;
  }
}
