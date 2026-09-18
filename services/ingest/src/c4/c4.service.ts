/**
 * @fileoverview Generación C4: context (dominios) + container (infra) → Archify → snapshot.
 */
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  c4ModelToArchifyArchitecture,
  domainContextSpecToC4Model,
  infrastructureSpecToC4Model,
  mergeC4ContainerModels,
  type C4Level,
  type C4Model,
} from 'ariadne-common';
import { RepositoriesService } from '../repositories/repositories.service';
import { FileContentService } from '../repositories/file-content.service';
import { IndexedFile } from '../repositories/entities/indexed-file.entity';
import { ProjectsService } from '../projects/projects.service';
import { C4ArchifyRenderer } from './c4-archify.renderer';
import { C4SnapshotService } from './c4-snapshot.service';
import { scanC4Infrastructure } from './c4-infrastructure';
import { getC4Settings } from './c4-settings.util';
import { C4ContextExtractor } from './c4-context.extractor';
import { C4ContextEnricher } from './c4-context.enricher';
import { C4ComponentExtractor } from './c4-component.extractor';
import { C4SequenceExtractor } from './c4-sequence.extractor';
import { C4WorkflowExtractor } from './c4-workflow.extractor';
import { C4LifecycleExtractor } from './c4-lifecycle.extractor';
import { C4MarkdownExportService } from './c4-markdown-export.service';
import { resolveExistingC4HtmlPath } from './c4-html.util';

const SUPPORTED_LEVELS: C4Level[] = ['context', 'container', 'component'];

export type C4GenerateLevelResult = {
  model: C4Model;
  snapshotId: string;
  htmlReady: boolean;
  archifyHtmlPath: string | null;
  /** Detalle de Archify cuando htmlReady=false (CLI ausente, validate o deliver). */
  archifyError: string | null;
  archifyBin: string | null;
  durationMs?: number;
  showcaseValidated?: boolean;
};

@Injectable()
export class C4Service {
  private readonly logger = new Logger(C4Service.name);

  constructor(
    private readonly repos: RepositoriesService,
    private readonly fileContent: FileContentService,
    private readonly projects: ProjectsService,
    private readonly snapshots: C4SnapshotService,
    private readonly archify: C4ArchifyRenderer,
    private readonly contextExtractor: C4ContextExtractor,
    private readonly contextEnricher: C4ContextEnricher,
    private readonly componentExtractor: C4ComponentExtractor,
    private readonly sequenceExtractor: C4SequenceExtractor,
    private readonly workflowExtractor: C4WorkflowExtractor,
    private readonly lifecycleExtractor: C4LifecycleExtractor,
    private readonly markdownExport: C4MarkdownExportService,
    @InjectRepository(IndexedFile)
    private readonly indexedFiles: Repository<IndexedFile>,
  ) {}

  private parseLevels(level?: string, levels?: string[]): C4Level[] {
    const raw = levels?.length
      ? levels
      : level
        ? [level]
        : ['container'];
    const parsed = raw.map((l) => l.toLowerCase() as C4Level);
    for (const lv of parsed) {
      if (!SUPPORTED_LEVELS.includes(lv)) {
        throw new BadRequestException(`Nivel C4 "${lv}" no soportado (context | container | component)`);
      }
    }
    return [...new Set(parsed)];
  }

  async buildContainerModelFromRepo(
    projectId: string,
    repositoryId: string,
  ): Promise<C4Model> {
    const repo = await this.repos.findOne(repositoryId);
    const rows = await this.indexedFiles.find({
      where: { repositoryId },
      select: ['path'],
    });
    const pathSet = new Set(rows.map((r) => r.path));
    if (pathSet.size === 0) {
      const listed = await this.fileContent.listFiles(repositoryId);
      for (const p of listed) pathSet.add(p);
    }

    const getContent = async (relPath: string) => {
      try {
        return await this.fileContent.getFileContent(repositoryId, relPath);
      } catch {
        return null;
      }
    };

    const systemName = `${repo.projectKey}/${repo.repoSlug}`;
    const { spec, composePath } = await scanC4Infrastructure(pathSet, getContent, systemName);
    return infrastructureSpecToC4Model(spec, projectId, {
      repoId: repositoryId,
      composePath: composePath ?? undefined,
    });
  }

  async buildContextModel(projectId: string, useLlm = false): Promise<C4Model> {
    const spec = await this.contextExtractor.buildSpec(projectId);
    let model = domainContextSpecToC4Model(spec);
    if (useLlm) {
      model = await this.contextEnricher.enrich(model, spec);
    }
    return model;
  }

  private async renderLevel(
    projectId: string,
    level: C4Level,
    model: C4Model,
    projectName: string,
  ): Promise<C4GenerateLevelResult> {
    const t0 = Date.now();
    const title =
      level === 'context'
        ? `C4 Context — ${projectName}`
        : level === 'component'
          ? `C4 Component — ${model.systemName ?? projectName}`
          : `C4 Container — ${projectName}`;
    const archifyIr = c4ModelToArchifyArchitecture(model, title);
    const render = await this.archify.renderArchitecture(projectId, level, archifyIr);

    const snapshot = await this.snapshots.saveSnapshot({
      projectId,
      level,
      model,
      archifyJson: archifyIr,
      archifyHtmlPath: render.validated ? render.htmlPath : null,
    });

    const durationMs = Date.now() - t0;
    if (render.validated) {
      this.logger.log(`C4 ${level} showcase OK (${durationMs}ms) project=${projectId}`);
    } else {
      this.logger.warn(`C4 ${level} sin HTML Archify (${durationMs}ms) project=${projectId}`);
    }

    return {
      model,
      snapshotId: snapshot.id,
      htmlReady: render.validated,
      archifyHtmlPath: render.validated ? render.htmlPath : null,
      archifyError: render.validated ? null : render.stderr ?? null,
      archifyBin: render.archifyBin,
      durationMs,
      showcaseValidated: render.validated,
    };
  }

  async listSequenceRoutes(projectId: string) {
    await this.projects.findOne(projectId);
    const routes = await this.sequenceExtractor.listRoutes(projectId);
    return { routes };
  }

  async generateSequence(
    projectId: string,
    routePath?: string,
  ): Promise<{
    archifyIr: unknown;
    htmlReady: boolean;
    archifyHtmlPath: string | null;
    archifyError: string | null;
    archifyBin: string | null;
    durationMs: number;
    routePath: string;
    title: string;
    synthetic: boolean;
  }> {
    const t0 = Date.now();
    await this.projects.findOne(projectId);
    const { archifyIr, spec, routePath: resolvedRoute } =
      await this.sequenceExtractor.buildRepresentativeFlow(projectId, routePath);
    const render = await this.archify.renderSequence(projectId, archifyIr);
    const durationMs = Date.now() - t0;
    const synthetic = spec.evidence.some((e) => e.reason?.includes('sintético'));
    return {
      archifyIr,
      htmlReady: render.validated,
      archifyHtmlPath: render.validated ? render.htmlPath : null,
      archifyError: render.validated ? null : render.stderr ?? null,
      archifyBin: render.archifyBin,
      durationMs,
      routePath: resolvedRoute,
      title: spec.title,
      synthetic,
    };
  }

  async readSequenceHtml(projectId: string): Promise<{ html: string; path: string } | null> {
    const p = join(this.archify.storageRoot(), projectId, 'sequence.html');
    if (!existsSync(p)) return null;
    const html = await readFile(p, 'utf8');
    return { html, path: p };
  }

  async listWorkflowTargets(projectId: string) {
    await this.projects.findOne(projectId);
    const targets = await this.workflowExtractor.listTargets(projectId);
    return { targets };
  }

  async generateWorkflow(projectId: string, targetId = 'sync-pipeline') {
    const t0 = Date.now();
    await this.projects.findOne(projectId);
    const { archifyIr, spec, targetId: resolvedTarget } =
      await this.workflowExtractor.buildWorkflow(projectId, targetId);
    const render = await this.archify.renderWorkflow(projectId, archifyIr, resolvedTarget);
    return {
      archifyIr,
      htmlReady: render.validated,
      archifyHtmlPath: render.validated ? render.htmlPath : null,
      archifyError: render.validated ? null : render.stderr ?? null,
      archifyBin: render.archifyBin,
      durationMs: Date.now() - t0,
      title: spec.title,
      targetId: resolvedTarget,
    };
  }

  async readWorkflowHtml(
    projectId: string,
    targetId = 'sync-pipeline',
  ): Promise<{ html: string; path: string } | null> {
    const safeTarget = targetId.replace(/[^a-z0-9:_-]/gi, '_');
    const p = join(this.archify.storageRoot(), projectId, `workflow-${safeTarget}.html`);
    if (!existsSync(p)) {
      if (targetId === 'sync-pipeline') {
        const legacy = join(this.archify.storageRoot(), projectId, 'workflow.html');
        if (existsSync(legacy)) {
          const html = await readFile(legacy, 'utf8');
          return { html, path: legacy };
        }
      }
      return null;
    }
    const html = await readFile(p, 'utf8');
    return { html, path: p };
  }

  listLifecycleTargets() {
    return { targets: this.lifecycleExtractor.listTargets() };
  }

  async generateLifecycle(projectId: string, target = 'sync-job', routePath?: string) {
    const t0 = Date.now();
    await this.projects.findOne(projectId);
    const { archifyIr, spec, target: resolvedTarget } = await this.lifecycleExtractor.buildLifecycle(
      projectId,
      target,
      routePath,
    );
    const render = await this.archify.renderLifecycle(projectId, archifyIr, resolvedTarget);
    return {
      archifyIr,
      htmlReady: render.validated,
      archifyHtmlPath: render.validated ? render.htmlPath : null,
      archifyError: render.validated ? null : render.stderr ?? null,
      archifyBin: render.archifyBin,
      durationMs: Date.now() - t0,
      title: spec.title,
      target: resolvedTarget,
    };
  }

  async readLifecycleHtml(
    projectId: string,
    target = 'sync-job',
  ): Promise<{ html: string; path: string } | null> {
    const safeTarget = target.replace(/[^a-z0-9_-]/gi, '_');
    const p = join(this.archify.storageRoot(), projectId, `lifecycle-${safeTarget}.html`);
    if (!existsSync(p)) return null;
    const html = await readFile(p, 'utf8');
    return { html, path: p };
  }

  async exportMarkdown(projectId: string) {
    return this.markdownExport.buildBundle(projectId);
  }

  getParityPackC4Fields(projectId: string): Promise<{
    c4ContainerHtmlUrl: string;
    c4ContextHtmlUrl: string;
    c4ModelJson: C4Model | null;
  }> {
    return Promise.all([
      this.getModel(projectId, 'container'),
      this.getModel(projectId, 'context'),
    ]).then(([container, _context]) => ({
      c4ContainerHtmlUrl: `/projects/${projectId}/c4/html?level=container`,
      c4ContextHtmlUrl: `/projects/${projectId}/c4/html?level=context`,
      c4ModelJson: container,
    }));
  }

  async generateContainer(projectId: string): Promise<C4GenerateLevelResult> {
    await this.projects.findOne(projectId);
    const linked = await this.repos.findAll(projectId);
    if (linked.length === 0) {
      throw new NotFoundException('Proyecto sin repositorios asociados');
    }

    const perRepo: C4Model[] = [];
    for (const repo of linked) {
      try {
        perRepo.push(await this.buildContainerModelFromRepo(projectId, repo.id));
      } catch (err) {
        this.logger.warn(
          `C4 skip repo ${repo.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (perRepo.length === 0) {
      throw new NotFoundException('No se pudo construir modelo C4 desde los repos');
    }

    const model =
      perRepo.length === 1 ? perRepo[0]! : mergeC4ContainerModels(perRepo, projectId);

    const project = await this.projects.findOne(projectId);
    const projectName = project.name?.trim() || projectId;
    return this.renderLevel(projectId, 'container', model, projectName);
  }

  async generateContext(projectId: string, useLlm = false): Promise<C4GenerateLevelResult> {
    const project = await this.projects.findOne(projectId);
    const projectName = project.name?.trim() || projectId;
    const model = await this.buildContextModel(projectId, useLlm);
    return this.renderLevel(projectId, 'context', model, projectName);
  }

  async generateComponent(
    projectId: string,
    opts?: { containerKey?: string; repoId?: string },
  ): Promise<C4GenerateLevelResult> {
    await this.projects.findOne(projectId);
    const model = await this.componentExtractor.buildComponentModel(projectId, opts);
    const project = await this.projects.findOne(projectId);
    const projectName = project.name?.trim() || projectId;
    return this.renderLevel(projectId, 'component', model, projectName);
  }

  async generate(
    projectId: string,
    opts?: {
      level?: string;
      levels?: string[];
      useLlm?: boolean;
      containerKey?: string;
      repoId?: string;
    },
  ): Promise<Record<string, C4GenerateLevelResult>> {
    const parsedLevels = this.parseLevels(opts?.level, opts?.levels);
    const useLlm = Boolean(opts?.useLlm);
    const out: Record<string, C4GenerateLevelResult> = {};

    for (const lv of parsedLevels) {
      if (lv === 'context') {
        out.context = await this.generateContext(projectId, useLlm);
      } else if (lv === 'container') {
        out.container = await this.generateContainer(projectId);
      } else if (lv === 'component') {
        out.component = await this.generateComponent(projectId, {
          containerKey: opts?.containerKey,
          repoId: opts?.repoId,
        });
      }
    }
    return out;
  }

  async listSnapshots(projectId: string, level?: string, limit = 20) {
    const rows = await this.snapshots.listSnapshots(projectId, level, limit);
    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      level: r.level,
      contentHash: r.contentHash,
      generator: r.generator,
      createdAt: r.createdAt.toISOString(),
      archifyHtmlPath: r.archifyHtmlPath,
    }));
  }

  async getModel(projectId: string, level: C4Level): Promise<C4Model | null> {
    const snap = await this.snapshots.getLatest(projectId, level);
    return snap?.modelJson ?? null;
  }

  async getModelMeta(
    projectId: string,
    level: C4Level,
  ): Promise<{ model: C4Model; htmlReady: boolean; snapshotId: string } | null> {
    const snap = await this.snapshots.getLatest(projectId, level);
    if (!snap?.modelJson) return null;
    const htmlReady = Boolean(
      resolveExistingC4HtmlPath(
        this.archify.storageRoot(),
        projectId,
        level,
        snap.archifyHtmlPath,
      ),
    );
    return { model: snap.modelJson, htmlReady, snapshotId: snap.id };
  }

  async getContainerModel(projectId: string): Promise<C4Model | null> {
    return this.getModel(projectId, 'container');
  }

  async getContextModel(projectId: string): Promise<C4Model | null> {
    return this.getModel(projectId, 'context');
  }

  async readHtml(projectId: string, level: C4Level): Promise<{ html: string; path: string } | null> {
    const snap = await this.snapshots.getLatest(projectId, level);
    if (!snap) return null;

    const storageRoot = this.archify.storageRoot();
    const existing = resolveExistingC4HtmlPath(
      storageRoot,
      projectId,
      level,
      snap.archifyHtmlPath,
    );
    if (existing) {
      const html = await readFile(existing, 'utf8');
      if (snap.archifyHtmlPath !== existing) {
        await this.snapshots.updateHtmlPath(snap.id, existing);
      }
      return { html, path: existing };
    }

    if (snap.archifyJson && Object.keys(snap.archifyJson).length > 0) {
      try {
        const render = await this.archify.renderArchitecture(
          projectId,
          level,
          snap.archifyJson,
        );
        if (render.validated && existsSync(render.htmlPath)) {
          await this.snapshots.updateHtmlPath(snap.id, render.htmlPath);
          const html = await readFile(render.htmlPath, 'utf8');
          return { html, path: render.htmlPath };
        }
      } catch (err) {
        this.logger.warn(
          `C4 lazy HTML render (${level}) project=${projectId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return null;
  }

  async readContainerHtml(projectId: string): Promise<{ html: string; path: string } | null> {
    return this.readHtml(projectId, 'container');
  }

  async readContextHtml(projectId: string): Promise<{ html: string; path: string } | null> {
    return this.readHtml(projectId, 'context');
  }

  async persistAfterFullSync(
    _repositoryId: string,
    projectId: string,
  ): Promise<void> {
    const c4 = getC4Settings();
    if (!c4.enabled || !c4.autoOnFullSync) return;
    try {
      await this.generate(projectId, { levels: ['context', 'container'] });
    } catch (err) {
      this.logger.warn(
        `C4 post-sync: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
