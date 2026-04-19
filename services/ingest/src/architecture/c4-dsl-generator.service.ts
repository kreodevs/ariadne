/**
 * @fileoverview Genera DSL PlantUML C4 (L1 contexto, L2 contenedores, L3 componentes) + diff visual SDD vs shadow.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { FalkorDB } from 'falkordb';
import {
  getFalkorConfig,
  graphNameForProject,
  isProjectShardingEnabled,
  effectiveShardMode,
  listGraphNamesForProjectRouting,
  shadowGraphNameForSession,
  type FalkorShardMode,
} from '../pipeline/falkor';
import { ProjectEntity } from '../projects/entities/project.entity';
import { ProjectRepositoryEntity } from '../repositories/entities/project-repository.entity';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { DomainEntity } from '../domains/entities/domain.entity';
import { ProjectDomainDependencyEntity } from '../domains/entities/project-domain-dependency.entity';

const C4_INCLUDE_CTX =
  'https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Context.puml';
const C4_INCLUDE_CONT =
  'https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml';
const C4_INCLUDE_COMP =
  'https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Component.puml';

export interface C4GenerateOptions {
  level: 1 | 2 | 3;
  sessionId?: string | null;
}

export interface C4GenerateResult {
  level: number;
  dsl: string;
  projectId: string;
  shadowMode: boolean;
}

@Injectable()
export class C4DslGeneratorService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(ProjectRepositoryEntity)
    private readonly projectRepoRepo: Repository<ProjectRepositoryEntity>,
    @InjectRepository(RepositoryEntity)
    private readonly repoRepo: Repository<RepositoryEntity>,
    @InjectRepository(DomainEntity)
    private readonly domainRepo: Repository<DomainEntity>,
    @InjectRepository(ProjectDomainDependencyEntity)
    private readonly depRepo: Repository<ProjectDomainDependencyEntity>,
  ) {}

  async generate(projectId: string, opts: C4GenerateOptions): Promise<C4GenerateResult> {
    const level = ([1, 2, 3] as const).includes(opts.level as 1 | 2 | 3) ? (opts.level as 1 | 2 | 3) : 1;
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const sessionId = opts.sessionId?.trim() || null;
    let dsl: string;
    if (level === 1) dsl = await this.level1Context(projectId, project);
    else if (level === 2) dsl = await this.level2Containers(projectId, project);
    else dsl = await this.level3Components(projectId, project);

    if (sessionId) {
      const diffBlock = await this.shadowDiffBlock(projectId, sessionId, level);
      dsl += `\n${diffBlock}`;
    }

    return {
      level,
      dsl,
      projectId,
      shadowMode: Boolean(sessionId),
    };
  }

  private async level1Context(projectId: string, project: ProjectEntity): Promise<string> {
    const domains = await this.domainRepo.find({ order: { name: 'ASC' } });
    const deps = await this.depRepo.find({ where: { projectId } });
    const domainById = new Map(domains.map((d) => [d.id, d] as const));

    const lines: string[] = [
      '@startuml',
      '!include ' + C4_INCLUDE_CTX,
      'title C4 Context — Dominios y dependencias',
      'LAYOUT_WITH_LEGEND()',
    ];

    for (const d of domains) {
      const alias = this.sanitizeAlias(`dom_${d.id.replace(/-/g, '')}`);
      lines.push(
        `System(${alias}, "${this.escape(d.name)}", "${this.escape(d.description ?? 'Dominio')}")`,
      );
      lines.push(`UpdateElementStyle(${alias}, $bgColor="${d.color}")`);
    }

    if (!project.domainId) {
      lines.push(
        `System(orphan_proj, "${this.escape(project.name ?? projectId)}", "Proyecto sin dominio asignado")`,
      );
    }

    for (const dep of deps) {
      const from = project.domainId ? domainById.get(project.domainId) : null;
      const to = domainById.get(dep.dependsOnDomainId);
      if (!to) continue;
      const a = from
        ? this.sanitizeAlias(`dom_${from.id.replace(/-/g, '')}`)
        : 'orphan_proj';
      const b = this.sanitizeAlias(`dom_${to.id.replace(/-/g, '')}`);
      lines.push(
        `Rel(${a}, ${b}, "${this.escape(dep.connectionType)}", "${this.escape(dep.description ?? '')}")`,
      );
    }

    lines.push('@enduml');
    return lines.join('\n');
  }

  private async level2Containers(projectId: string, project: ProjectEntity): Promise<string> {
    const prs = await this.projectRepoRepo.find({ where: { projectId }, select: ['repoId'] });
    const repoIds = prs.map((p) => p.repoId);
    const repos =
      repoIds.length > 0
        ? await this.repoRepo.find({
            where: { id: In(repoIds) },
            select: ['id', 'projectKey', 'repoSlug'],
          })
        : [];

    const lines: string[] = [
      '@startuml',
      '!include ' + C4_INCLUDE_CONT,
      `title C4 Containers — ${this.escape(project.name ?? projectId)}`,
      'LAYOUT_WITH_LEGEND()',
    ];

    const manifestByRepo = await this.fetchManifestHints(projectId, repoIds);

    for (const r of repos) {
      const alias = this.sanitizeAlias(`repo_${r.id.slice(0, 8)}`);
      const label = `${r.projectKey}/${r.repoSlug}`;
      const tech = manifestByRepo.get(r.id) ?? 'TypeScript/JavaScript';
      lines.push(`Container(${alias}, "${this.escape(label)}", "${this.escape(tech)}")`);
    }

    if (repos.length === 0) {
      lines.push(`Container(default, "Sin repositorios", "—")`);
    }

    lines.push('@enduml');
    return lines.join('\n');
  }

  private async fetchManifestHints(projectId: string, repoIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (repoIds.length === 0) return out;
    const client = await FalkorDB.connect({
      socket: { host: getFalkorConfig().host, port: getFalkorConfig().port },
    });
    try {
      const g = client.selectGraph(
        isProjectShardingEnabled() ? graphNameForProject(projectId) : graphNameForProject(undefined),
      );
      const res = (await g.query(
        `MATCH (p:Project {projectId: $projectId}) RETURN p.manifestDeps AS m LIMIT 1`,
        { params: { projectId } },
      )) as { data?: unknown[][] };
      const row = res.data?.[0];
      const raw = Array.isArray(row) ? row[0] : null;
      if (typeof raw === 'string' && raw.trim()) {
        try {
          const parsed = JSON.parse(raw) as string[] | { depKeys?: string[] };
          const keys = Array.isArray(parsed) ? parsed : parsed.depKeys;
          if (Array.isArray(keys) && keys.length) {
            const hint = keys.slice(0, 8).join(', ');
            for (const id of repoIds) out.set(id, hint);
          }
        } catch {
          /* ignore */
        }
      }
    } finally {
      await client.close();
    }
    return out;
  }

  private async level3Components(projectId: string, project: ProjectEntity): Promise<string> {
    const client = await FalkorDB.connect({
      socket: { host: getFalkorConfig().host, port: getFalkorConfig().port },
    });
    const comps: { name: string; desc: string }[] = [];
    const routes: { path: string; componentName: string }[] = [];
    try {
      const names = listGraphNamesForProjectRouting(
        projectId,
        effectiveShardMode(project.falkorShardMode) === 'domain' ? 'domain' : 'project',
        Array.isArray(project.falkorDomainSegments) ? project.falkorDomainSegments! : [],
      );
      for (const nm of names) {
        const g = client.selectGraph(nm);
        const cRes = (await g.query(
          `MATCH (c:Component {projectId: $projectId}) RETURN c.name AS name, c.description AS description LIMIT 80`,
          { params: { projectId } },
        )) as { data?: unknown[][] };
        for (const row of cRes.data ?? []) {
          const arr = Array.isArray(row) ? row : [row];
          const name = String(arr[0] ?? '');
          const description = arr[1] != null ? String(arr[1]) : '';
          if (name) comps.push({ name, desc: description });
        }
        const rRes = (await g.query(
          `MATCH (rt:Route {projectId: $projectId}) RETURN rt.path AS path, rt.componentName AS componentName LIMIT 80`,
          { params: { projectId } },
        )) as { data?: unknown[][] };
        for (const row of rRes.data ?? []) {
          const arr = Array.isArray(row) ? row : [row];
          const path = String(arr[0] ?? '');
          const componentName = String(arr[1] ?? '');
          if (path) routes.push({ path, componentName });
        }
      }
    } finally {
      await client.close();
    }

    const lines: string[] = [
      '@startuml',
      '!include ' + C4_INCLUDE_COMP,
      `title C4 Components — ${this.escape(project.name ?? projectId)}`,
      'LAYOUT_WITH_LEGEND()',
    ];

    const seen = new Set<string>();
    for (const c of comps) {
      const alias = this.sanitizeAlias(`c_${c.name}`);
      if (seen.has(alias)) continue;
      seen.add(alias);
      lines.push(
        `Component(${alias}, "${this.escape(c.name)}", "${this.escape(c.desc || 'Component')}")`,
      );
    }
    for (const r of routes) {
      const alias = this.sanitizeAlias(`rt_${r.path.replace(/[^a-zA-Z0-9]/g, '_')}`);
      if (seen.has(alias)) continue;
      seen.add(alias);
      lines.push(
        `Component(${alias}, "${this.escape(r.path)}", "Route → ${this.escape(r.componentName)}")`,
      );
    }

    if (lines.length <= 5) {
      lines.push(`Component(empty, "Sin componentes en grafo", "Ejecuta sync")`);
    }

    lines.push('@enduml');
    return lines.join('\n');
  }

  private async shadowDiffBlock(projectId: string, sessionId: string, level: number): Promise<string> {
    const main = await this.collectComponentNames(projectId, false, null);
    const shadow = await this.collectComponentNames(projectId, true, sessionId);
    const added = [...shadow].filter((x) => !main.has(x));
    const removed = [...main].filter((x) => !shadow.has(x));

    const lines: string[] = [
      '',
      '@startuml',
      '!include ' + C4_INCLUDE_COMP,
      'title Visual SDD — diff Component (shadow vs main)',
      'AddElementTag("new", $bgColor="#90EE90", $fontColor="#000000")',
      'AddElementTag("gone", $bgColor="#FFB6C1", $fontColor="#000000")',
    ];
    for (const n of added.slice(0, 40)) {
      const a = this.sanitizeAlias(`add_${n}`);
      lines.push(`Component(${a}, "${this.escape(n)}", "nuevo en shadow") $new`);
    }
    for (const n of removed.slice(0, 40)) {
      const a = this.sanitizeAlias(`rm_${n}`);
      lines.push(`Component(${a}, "${this.escape(n)}", "eliminado en shadow") $gone`);
    }
    if (added.length === 0 && removed.length === 0) {
      lines.push(`note as N1\nSin diff de componentes en nivel ${level}\nend note`);
    }
    lines.push('@enduml');
    return lines.join('\n');
  }

  private async collectComponentNames(
    projectId: string,
    useShadow: boolean,
    sessionId: string | null,
  ): Promise<Set<string>> {
    const out = new Set<string>();
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) return out;
    const shardMode: FalkorShardMode = effectiveShardMode(project.falkorShardMode);
    const segments = Array.isArray(project.falkorDomainSegments) ? project.falkorDomainSegments! : [];
    const names = listGraphNamesForProjectRouting(
      projectId,
      shardMode === 'domain' ? 'domain' : 'project',
      segments,
    );

    const client = await FalkorDB.connect({
      socket: { host: getFalkorConfig().host, port: getFalkorConfig().port },
    });
    try {
      if (useShadow && sessionId) {
        const g = client.selectGraph(shadowGraphNameForSession(sessionId));
        const q = `MATCH (c:Component {projectId: $projectId}) RETURN c.name AS name`;
        const res = (await g.query(q, { params: { projectId } })) as { data?: unknown[][] };
        for (const row of res.data ?? []) {
          const arr = Array.isArray(row) ? row : [row];
          const name = String(arr[0] ?? '');
          if (name) out.add(name);
        }
        return out;
      }
      for (const nm of names) {
        const g = client.selectGraph(nm);
        const q = `MATCH (c:Component {projectId: $projectId}) RETURN c.name AS name`;
        const res = (await g.query(q, { params: { projectId } })) as { data?: unknown[][] };
        for (const row of res.data ?? []) {
          const arr = Array.isArray(row) ? row : [row];
          const name = String(arr[0] ?? '');
          if (name) out.add(name);
        }
      }
    } finally {
      await client.close();
    }
    return out;
  }

  private sanitizeAlias(s: string): string {
    return s.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^([0-9])/, '_$1') || 'n';
  }

  private escape(s: string): string {
    return s.replace(/"/g, '\\"').replace(/\n/g, ' ');
  }
}
