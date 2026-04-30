import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
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
import {
  getFalkorConfig,
  graphNameForProject,
  isProjectShardingEnabled,
  domainSegmentFromRepoPath,
  effectiveShardMode,
  getGraphNodeSoftLimit,
  isAutoDomainOverflowEnabled,
  listGraphNamesForProjectRouting,
} from '../pipeline/falkor';
import { ProjectEntity } from '../projects/entities/project.entity';
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
import { buildCypherForOpenApiSpec } from '../pipeline/openapi-spec-ingest';
import {
  SCHEMA_RELATIONAL_RAG_SOURCE_PATH,
  SCHEMA_RELATIONAL_RAG_TITLE,
  buildCypherForSchemaRelationalRagDoc,
  buildSchemaRelationalRagDocumentationText,
} from '../pipeline/schema-relational-rag-doc';
import { loadRepoTsconfigPaths } from '../pipeline/tsconfig-resolve';
import { buildProjectMergeCypher } from '../pipeline/project';
import type { ParsedFile } from '../pipeline/parser';
import { recordSyncJobFailed } from '../metrics/ingest-metrics';
import { scanC4Infrastructure } from '../pipeline/c4-infrastructure';
import { buildC4IngestCypher } from '../pipeline/c4-cypher';
import {
  augmentClonePathsForIndexRules,
  filterPathsByRepoIndexRules,
  normalizeIndexPath,
  isMandatoryDefaultRootIndexPath,
} from '../providers/index-include-rules';

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
  pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  },
): string {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts =
    pkg.scripts && typeof pkg.scripts === 'object' ? (pkg.scripts as Record<string, string>) : {};
  return JSON.stringify({
    depKeys: Object.keys(deps || {}),
    scripts,
  });
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(forwardRef(() => RepositoriesService))
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
    @InjectRepository(ProjectEntity)
    private readonly projectEntityRepo: Repository<ProjectEntity>,
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

  private async purgeMonolithicProjectGraph(
    client: Awaited<ReturnType<typeof FalkorDB.connect>>,
    projectId: string,
  ): Promise<void> {
    if (!isProjectShardingEnabled()) return;
    const g = client.selectGraph(graphNameForProject(projectId));
    try {
      await g.query(`MATCH (n) WHERE n.projectId = $projectId DETACH DELETE n`, {
        params: { projectId },
      });
    } catch {
      /* grafo inexistente */
    }
  }

  private async countNodesMonolithicGraph(
    client: Awaited<ReturnType<typeof FalkorDB.connect>>,
    projectId: string,
  ): Promise<number> {
    const g = client.selectGraph(graphNameForProject(isProjectShardingEnabled() ? projectId : undefined));
    const countRes = (await g.query(`MATCH (n) WHERE n.projectId = $projectId RETURN count(n) AS c`, {
      params: { projectId },
    })) as { data?: [{ c: number }] };
    return countRes.data?.[0]?.c ?? 0;
  }

  /**
   * Antes de `POST /resync`: borra solo el slice Falkor de **este** repo (`projectId` + `repoId`)
   * en cada proyecto vinculado (o `repoId`×2 en modo standalone), más `indexed_files` del repo.
   * No vacía el grafo de otros roots del mismo proyecto Ariadne.
   */
  async clearRepositoryForResync(repositoryId: string): Promise<{ deletedNodes: number }> {
    await this.repos.findOne(repositoryId);
    const { deletedNodes } = await this.clearGraphDataForRepository(repositoryId);
    await this.indexedFileRepo.delete({ repositoryId });
    return { deletedNodes };
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
      const proj = await this.projectEntityRepo.findOne({ where: { id: projectId } });
      const shardMode = effectiveShardMode(proj?.falkorShardMode ?? 'project');
      const segments = Array.isArray(proj?.falkorDomainSegments) ? proj!.falkorDomainSegments! : [];
      const graphNames = listGraphNamesForProjectRouting(
        projectId,
        shardMode === 'domain' ? 'domain' : 'project',
        segments,
      );
      let countBefore = 0;
      for (const gName of graphNames) {
        const graph = client.selectGraph(gName);
        try {
          const countRes = (await graph.query(
            `MATCH (n) WHERE n.projectId = $projectId AND n.repoId = $repoId RETURN count(n) AS c`,
            { params: { projectId, repoId } },
          )) as { data?: [{ c: number }] };
          countBefore += countRes.data?.[0]?.c ?? 0;
          await graph.query(
            `MATCH (n) WHERE n.projectId = $projectId AND n.repoId = $repoId DETACH DELETE n`,
            { params: { projectId, repoId } },
          );
        } catch {
          /* grafo ausente */
        }
      }
      return { deletedNodes: countBefore };
    } finally {
      await client.close();
    }
  }

  /**
   * Antes de borrar un repositorio en Postgres: elimina nodos Falkor con este `repoId`
   * para cada `projectId` bajo el que estuvo indexado (multi-root), o (repoId, repoId) si es standalone.
   */
  async clearGraphDataForRepository(repositoryId: string): Promise<{ deletedNodes: number }> {
    const projectIds = await this.repos.getProjectIdsForRepo(repositoryId);
    let deletedNodes = 0;
    if (projectIds.length === 0) {
      const r = await this.clearProjectRepo(repositoryId, repositoryId);
      deletedNodes += r.deletedNodes;
    } else {
      for (const projectId of projectIds) {
        const r = await this.clearProjectRepo(projectId, repositoryId);
        deletedNodes += r.deletedNodes;
      }
    }
    return { deletedNodes };
  }

  /**
   * Ejecuta full sync: mapping → deps → chunking (parse + producer) → FalkorDB → embed-index (mismo job; ver payload.embedIndex).
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
      const existing = await this.syncJobRepo.findOne({
        where: { id: existingSyncJobId, repositoryId },
      });
      if (!existing) {
        this.logger.warn(
          `SyncJob row missing for id=${existingSyncJobId} repo=${repositoryId} — likely DB deleted while Bull still had the job; draining without error.`,
        );
        return { jobId: existingSyncJobId, indexed: 0 };
      }
      job = existing;
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

      if (repo.indexIncludeRules != null) {
        if (cloneResult) {
          paths = augmentClonePathsForIndexRules(cloneResult.workDir, paths, repo.indexIncludeRules);
        } else {
          paths = await this.mergeIndexIncludeRulesApiPaths(repo, owner, repoSlug, ref, paths);
        }
        pathSet = new Set(paths);
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
          if (/swagger\.json$/i.test(relPath) || /openapi\.(yaml|yml|json)$/i.test(relPath)) {
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
        const projRow = await this.projectEntityRepo.findOne({ where: { id: projectId } });
        const shardMode = effectiveShardMode(projRow?.falkorShardMode ?? 'project');

        if (shardMode === 'domain' && isProjectShardingEnabled()) {
          await this.purgeMonolithicProjectGraph(client, projectId);
        }

        const domainSegmentsSeen = new Set<string>();
        const ensuredGraphs = new Set<string>();
        const projectMerged = new Set<string>();
        const pidArgForProject = isProjectShardingEnabled() ? projectId : undefined;

        const prepareGraph = async (relPath: string) => {
          const gname =
            shardMode === 'domain'
              ? graphNameForProject(pidArgForProject, {
                  shardMode: 'domain',
                  domainSegment: domainSegmentFromRepoPath(relPath),
                })
              : graphNameForProject(pidArgForProject);
          const graph = client.selectGraph(gname);
          const graphClient = { query: (cypher: string) => graph.query(cypher) };
          if (!ensuredGraphs.has(gname)) {
            ensuredGraphs.add(gname);
            await ensureFalkorIndexes(graphClient);
          }
          if (shardMode === 'domain') {
            domainSegmentsSeen.add(domainSegmentFromRepoPath(relPath));
          }
          if (!projectMerged.has(gname)) {
            projectMerged.add(gname);
            await graph.query(
              buildProjectMergeCypher({
                projectId,
                projectName,
                rootPath,
                branch: repo.defaultBranch ?? null,
                manifestDeps: manifestDeps || null,
              }),
            );
          }
          return graphClient;
        };

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
              resolveOpts,
            );
            const graphClient = await prepareGraph(parsed.path);
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
            const graphClient = await prepareGraph(pf.path);
            await runCypherBatch(graphClient, statements);
            if (projectId === projectIds[0]) indexedPaths.push(pf.path);
          } catch (err) {
            console.error(`Sync: error indexing Prisma ${pf.path}:`, err);
            if (projectId === projectIds[0]) skippedIndex.push(pf.path);
          }
        }
        const openApiPaths = paths.filter(
          (p) => /swagger\.json$/i.test(p) || /openapi\.(yaml|yml|json)$/i.test(p),
        );
        for (const oaPath of openApiPaths) {
          try {
            const content = await getContent(oaPath);
            if (!content) continue;
            const statements = buildCypherForOpenApiSpec(oaPath, content, projectId, repoId);
            if (statements.length === 0) continue;
            const graphClient = await prepareGraph(oaPath);
            await runCypherBatch(graphClient, statements);
            if (projectId === projectIds[0]) indexedPaths.push(oaPath);
          } catch (err) {
            console.error(`Sync: error indexing OpenAPI ${oaPath}:`, err);
            if (projectId === projectIds[0]) skippedIndex.push(oaPath);
          }
        }

        try {
          const openApiSpecs: { path: string; content: string }[] = [];
          for (const oaPath of openApiPaths) {
            const oc = await getContent(oaPath);
            if (oc) openApiSpecs.push({ path: oaPath, content: oc });
          }
          const schemaRagText = await buildSchemaRelationalRagDocumentationText({
            prismaFiles,
            parsedFiles,
            openApiSpecs,
          });
          const schemaRagCy = buildCypherForSchemaRelationalRagDoc(
            projectId,
            repoId,
            SCHEMA_RELATIONAL_RAG_SOURCE_PATH,
            SCHEMA_RELATIONAL_RAG_TITLE,
            schemaRagText,
          );
          const schemaRagGraph = await prepareGraph(SCHEMA_RELATIONAL_RAG_SOURCE_PATH);
          await runCypherBatch(schemaRagGraph, schemaRagCy);
        } catch (schemaRagErr) {
          console.warn(
            '[sync] schema relational RAG MarkdownDoc:',
            schemaRagErr instanceof Error ? schemaRagErr.message : String(schemaRagErr),
          );
        }

        const currentSet = new Set(indexedPaths);
        for (const f of previouslyIndexed) {
          if (!currentSet.has(f.path)) {
            const graphClient = await prepareGraph(f.path);
            await runCypherBatch(graphClient, buildCypherDeleteFile(f.path, projectId, repoId));
          }
        }

        try {
          const c4Spec = await scanC4Infrastructure(pathSet, getContent, projectName);
          const batch = buildC4IngestCypher(c4Spec, projectId, repoId);
          const graphNamesForC4 =
            ensuredGraphs.size > 0
              ? [...ensuredGraphs]
              : [
                  shardMode === 'domain'
                    ? graphNameForProject(pidArgForProject, {
                        shardMode: 'domain',
                        domainSegment: '_root',
                      })
                    : graphNameForProject(pidArgForProject),
                ];
          for (const gname of graphNamesForC4) {
            const graph = client.selectGraph(gname);
            const gc = { query: (q: string) => graph.query(q) };
            await runCypherBatch(gc, batch.cleanup);
            await runCypherBatch(gc, batch.merge);
            await runCypherBatch(gc, batch.linkFiles);
            await graph.query(batch.rollupImports);
            await graph.query(batch.rollupCalls);
          }
        } catch (c4Err) {
          console.warn('[sync] C4 ingest:', c4Err instanceof Error ? c4Err.message : String(c4Err));
        }

        if (projRow) {
          await this.projectEntityRepo.update(projectId, {
            falkorDomainSegments: shardMode === 'domain' ? [...domainSegmentsSeen] : [],
          });
        }

        if (
          projRow &&
          isAutoDomainOverflowEnabled() &&
          isProjectShardingEnabled() &&
          effectiveShardMode(projRow.falkorShardMode) === 'project'
        ) {
          const n = await this.countNodesMonolithicGraph(client, projectId);
          if (n >= getGraphNodeSoftLimit()) {
            await this.projectEntityRepo.update(projectId, { falkorShardMode: 'domain' });
            console.warn(
              `[sync] Proyecto ${projectId}: ${n} nodos ≥ límite ${getGraphNodeSoftLimit()}. ` +
                `falkor_shard_mode=domain. Ejecuta resync completo para repartir en subgrafos por carpeta raíz.`,
            );
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
      const maxIndexedPathsInPayload = (() => {
        const raw = process.env.SYNC_JOB_PAYLOAD_INDEXED_PATHS_MAX?.trim();
        const n = raw ? parseInt(raw, 10) : 10_000;
        if (!Number.isFinite(n) || n < 0) return 10_000;
        return Math.min(n, 100_000);
      })();

      // Upsert IndexedFile with revision (commitSha) — antes del embed y del cierre del job.
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

      /** Vectores Falkor: mismo paso que sync/resync (no hace falta botón aparte salvo reparación). */
      let embedIndexPayload: Record<string, unknown> = { embedIndex: { ran: false } };
      const skipEmbed =
        process.env.SYNC_SKIP_EMBED_INDEX === 'true' ||
        process.env.SYNC_SKIP_EMBED_INDEX === '1' ||
        process.env.INGEST_SKIP_EMBED_INDEX === 'true' ||
        process.env.INGEST_SKIP_EMBED_INDEX === '1';
      if (skipEmbed) {
        console.log('[sync] Embed-index post-sync skipped (SYNC_SKIP_EMBED_INDEX / INGEST_SKIP_EMBED_INDEX)');
        embedIndexPayload = {
          embedIndex: {
            ran: false,
            skipped: true,
            reason: 'SYNC_SKIP_EMBED_INDEX or INGEST_SKIP_EMBED_INDEX',
          },
        };
      } else {
        try {
          const embedRes = await this.embedIndex.runEmbedIndex(repositoryId);
          console.log(`Embed-index post-sync: ${embedRes.indexed} indexed, ${embedRes.errors} errors`);
          embedIndexPayload = {
            embedIndex: {
              ran: true,
              skipped: false,
              indexed: embedRes.indexed,
              errors: embedRes.errors,
            },
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn('Embed-index post-sync failed:', msg);
          embedIndexPayload = {
            embedIndex: {
              ran: true,
              skipped: false,
              failed: true,
              message: msg,
            },
          };
        }
      }

      const latestBeforeComplete = await this.syncJobRepo.findOne({
        where: { id: job.id },
      });
      if (!latestBeforeComplete || latestBeforeComplete.status !== 'running') {
        this.logger.warn(
          `Sync ${job.id} skip completion write (row missing or status=${latestBeforeComplete?.status ?? 'n/a'}); likely cancelled from UI.`,
        );
        await this.repos.pruneOldJobs(repositoryId, 5);
        return { jobId: job.id, indexed: indexedPaths.length };
      }

      await this.syncJobRepo.update(job.id, {
        finishedAt: new Date(),
        status: 'completed',
        payload: {
          indexed: indexedPaths.length,
          total: paths.length,
          paths: indexedPaths.slice(0, maxIndexedPathsInPayload),
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
          ...embedIndexPayload,
        } as object,
      });

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

  private async mergeIndexIncludeRulesApiPaths(
    repo: RepositoryEntity,
    owner: string,
    repoSlug: string,
    ref: string,
    paths: string[],
  ): Promise<string[]> {
    const rules = repo.indexIncludeRules;
    if (!rules) return paths;
    const set = new Set(paths.map((p) => normalizeIndexPath(p)));
    let rootNames: string[] = [];
    try {
      if (repo.provider === 'github') {
        rootNames = await this.github.listRootFiles(owner, repoSlug, ref, repo.credentialsRef);
      } else if (repo.provider === 'bitbucket') {
        rootNames = await this.bitbucket.listRootFiles(owner, repoSlug, ref, repo.credentialsRef);
      }
    } catch (e) {
      console.warn('Sync: listRootFiles failed', e);
    }
    for (const name of rootNames) {
      if (isMandatoryDefaultRootIndexPath(name)) set.add(name);
    }
    for (const e of rules.entries) {
      if (e.kind === 'file') set.add(normalizeIndexPath(e.path));
    }
    return filterPathsByRepoIndexRules([...set], rules);
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
