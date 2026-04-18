/**
 * @fileoverview CRUD de proyectos (multi-root). Un proyecto agrupa N repositorios.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { FalkorDB } from 'falkordb';
import { ProjectEntity } from './entities/project.entity';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { ProjectRepositoryEntity } from '../repositories/entities/project-repository.entity';
import { ProjectDomainDependencyEntity } from '../domains/entities/project-domain-dependency.entity';
import { DomainDomainVisibilityEntity } from '../domains/entities/domain-domain-visibility.entity';
import { DomainEntity } from '../domains/entities/domain.entity';
import {
  getFalkorConfig,
  graphNameForProject,
  isProjectShardingEnabled,
  effectiveShardMode,
  getGraphNodeSoftLimit,
  listGraphNamesForProjectRouting,
  type FalkorShardMode,
} from '../pipeline/falkor';
import {
  resolveRepoIdForAbsolutePath,
  resolveRepositoryIdForWorkspacePath,
  type RepoPathMatchInput,
  type WorkspacePathRepoResolution,
} from './path-repo-resolution.util';

/** Par (grafo Falkor, projectId en nodos) para Cypher multi-shard y whitelist de dominios. */
export interface CypherShardContext {
  graphName: string;
  cypherProjectId: string;
}

export interface ProjectWithRepos {
  id: string;
  name: string | null;
  description: string | null;
  domainId: string | null;
  domainName: string | null;
  domainColor: string | null;
  createdAt: string;
  updatedAt: string;
  repositories: Array<{
    id: string;
    provider: string;
    projectKey: string;
    repoSlug: string;
    defaultBranch: string;
    status: string;
    lastSyncAt: string | null;
    role?: string | null;
  }>;
}

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(ProjectRepositoryEntity)
    private readonly projectRepoRepo: Repository<ProjectRepositoryEntity>,
    @InjectRepository(RepositoryEntity)
    private readonly repoRepo: Repository<RepositoryEntity>,
    @InjectRepository(ProjectDomainDependencyEntity)
    private readonly projectDomainDepRepo: Repository<ProjectDomainDependencyEntity>,
    @InjectRepository(DomainDomainVisibilityEntity)
    private readonly domainDomainVisRepo: Repository<DomainDomainVisibilityEntity>,
    @InjectRepository(DomainEntity)
    private readonly domainRepo: Repository<DomainEntity>,
  ) {}

  async findAll(): Promise<ProjectWithRepos[]> {
    const projects = await this.projectRepo.find({
      order: { updatedAt: 'DESC' },
    });
    const projectIds = projects.map((p) => p.id);
    const prs =
      projectIds.length > 0
        ? await this.projectRepoRepo.find({
            where: { projectId: In(projectIds) },
            select: ['projectId', 'repoId', 'role'],
          })
        : [];
    const repoIdsByProject = new Map<string, string[]>();
    const roleByProjectRepo = new Map<string, string | null>();
    for (const pr of prs) {
      if (!repoIdsByProject.has(pr.projectId)) repoIdsByProject.set(pr.projectId, []);
      repoIdsByProject.get(pr.projectId)!.push(pr.repoId);
      roleByProjectRepo.set(`${pr.projectId}:${pr.repoId}`, pr.role ?? null);
    }
    const allRepoIds = [...new Set(prs.map((pr) => pr.repoId))];
    const repos =
      allRepoIds.length > 0
        ? await this.repoRepo.find({
            where: { id: In(allRepoIds) },
            select: ['id', 'provider', 'projectKey', 'repoSlug', 'defaultBranch', 'status', 'lastSyncAt'],
          })
        : [];
    const repoMap = new Map(repos.map((r) => [r.id, r]));
    const domIds = [...new Set(projects.map((p) => p.domainId).filter(Boolean))] as string[];
    const domRows =
      domIds.length > 0
        ? await this.domainRepo.find({ where: { id: In(domIds) }, select: ['id', 'name', 'color'] })
        : [];
    const domMeta = new Map(domRows.map((d) => [d.id, { name: d.name, color: d.color }] as const));
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      domainId: p.domainId ?? null,
      domainName: p.domainId ? domMeta.get(p.domainId)?.name ?? null : null,
      domainColor: p.domainId ? domMeta.get(p.domainId)?.color ?? null : null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      repositories: (repoIdsByProject.get(p.id) ?? [])
        .map((rid) => repoMap.get(rid))
        .filter(Boolean)
        .map((r) => ({
          id: r!.id,
          provider: r!.provider,
          projectKey: r!.projectKey,
          repoSlug: r!.repoSlug,
          defaultBranch: r!.defaultBranch,
          status: r!.status,
          lastSyncAt: r!.lastSyncAt?.toISOString() ?? null,
          role: roleByProjectRepo.get(`${p.id}:${r!.id}`) ?? null,
        })),
    }));
  }

  /**
   * Resuelve qué repositorio del proyecto encaja con una ruta del IDE (heurística multi-root).
   */
  async resolveRepoForPath(
    projectId: string,
    filePath: string,
  ): Promise<{ projectId: string; repoId: string | null; score: number; match?: string }> {
    await this.findOne(projectId);
    const prs = await this.projectRepoRepo.find({
      where: { projectId },
      select: ['repoId'],
    });
    const repoIds = prs.map((pr) => pr.repoId);
    const repositories =
      repoIds.length > 0
        ? await this.repoRepo.find({
            where: { id: In(repoIds) },
            select: ['id', 'projectKey', 'repoSlug'],
          })
        : [];
    const resolution = resolveRepoIdForAbsolutePath(filePath, repositories);
    return {
      projectId,
      repoId: resolution.repoId,
      score: resolution.score,
      match: resolution.match,
    };
  }

  /**
   * Actualiza la etiqueta `role` en `project_repositories` (inferencia de alcance en chat multi-root).
   */
  async setRepositoryRole(
    projectId: string,
    repoId: string,
    role?: string | null,
  ): Promise<{ projectId: string; repoId: string; role: string | null }> {
    await this.findOne(projectId);
    const pr = await this.projectRepoRepo.findOne({ where: { projectId, repoId } });
    if (!pr) {
      throw new NotFoundException(`Repositorio ${repoId} no asociado al proyecto ${projectId}`);
    }
    if (role !== undefined) {
      pr.role = role?.trim() ? role.trim() : null;
      await this.projectRepoRepo.save(pr);
    }
    return { projectId, repoId, role: pr.role };
  }

  /**
   * Resolución multi-root con resultado único, ninguno o ambiguo (empates en heurística de path).
   */
  async resolveRepositoryForWorkspacePath(
    projectId: string,
    workspaceAbsolutePath: string,
  ): Promise<WorkspacePathRepoResolution> {
    const { repositories } = await this.findOne(projectId);
    if (repositories.length === 0) {
      return { kind: 'none' };
    }
    const inputs: RepoPathMatchInput[] = repositories.map((r) => ({
      repositoryId: r.id,
      projectKey: r.projectKey,
      repoSlug: r.repoSlug,
    }));
    return resolveRepositoryIdForWorkspacePath(workspaceAbsolutePath, inputs);
  }

  /**
   * Bloque markdown de roles por repo para el prompt del chat multi-root.
   */
  async getRepositoryRolesContext(projectId: string): Promise<string> {
    const prs = await this.projectRepoRepo.find({
      where: { projectId },
      select: ['repoId', 'role'],
    });
    if (prs.length === 0) return '';
    const repoIds = prs.map((p) => p.repoId);
    const repos = await this.repoRepo.find({
      where: { id: In(repoIds) },
      select: ['id', 'projectKey', 'repoSlug'],
    });
    const label = new Map(repos.map((r) => [r.id, `${r.projectKey}/${r.repoSlug}`] as const));
    const lines = prs.map((pr) => {
      const slug = label.get(pr.repoId) ?? pr.repoId;
      const roleLabel = pr.role?.trim() ? pr.role.trim() : 'sin rol definido';
      return `- \`${slug}\` — \`repoId\`=\`${pr.repoId}\` — **rol:** ${roleLabel}`;
    });
    return [
      'Cuando el usuario pregunte por el backend, frontend, API, librería de componentes, etc., usa **solo** el repositorio cuyo **rol** encaje con la pregunta. Filtra rutas y resultados Cypher por `repoId` según corresponda.',
      '',
      ...lines,
    ].join('\n');
  }

  /** Metadatos de enrutamiento Falkor (MCP/API): modo mono vs dominio y segmentos conocidos. */
  async getGraphRouting(id: string): Promise<{
    projectId: string;
    shardMode: FalkorShardMode;
    domainSegments: string[];
    graphNodeSoftLimit: number;
    /** Grafos Falkor adicionales (proyectos en dominios de la whitelist). */
    extendedGraphShardNames: string[];
    /** Cada consulta Cypher debe usar `cypherProjectId` al abrir `graphName` (whitelist). */
    cypherShardContexts: CypherShardContext[];
  }> {
    const project = await this.projectRepo.findOne({ where: { id } });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    const shardMode = effectiveShardMode(project.falkorShardMode);
    const domainSegments = Array.isArray(project.falkorDomainSegments) ? project.falkorDomainSegments : [];
    const cypherShardContexts = await this.getCypherShardContexts(id);
    const extendedGraphShardNames = [
      ...new Set(
        cypherShardContexts
          .filter((c) => c.cypherProjectId !== id)
          .map((c) => c.graphName),
      ),
    ];
    return {
      projectId: id,
      shardMode,
      domainSegments,
      graphNodeSoftLimit: getGraphNodeSoftLimit(),
      extendedGraphShardNames,
      cypherShardContexts,
    };
  }

  /**
   * Grafos a consultar y el `projectId` que llevan los nodos en cada uno (propio + whitelist de dominios).
   */
  async getCypherShardContexts(
    projectId: string,
    opts?: { includeSiblingProjects?: boolean },
  ): Promise<CypherShardContext[]> {
    const includeSiblings = opts?.includeSiblingProjects !== false;
    const out: CypherShardContext[] = [];
    const seen = new Set<string>();
    const add = (graphName: string, cypherProjectId: string) => {
      const k = `${graphName}\0${cypherProjectId}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ graphName, cypherProjectId });
    };

    for (const g of await this.graphShardNamesForProjectId(projectId)) {
      add(g, projectId);
    }

    if (!includeSiblings) return out;

    const deps = await this.projectDomainDepRepo.find({
      where: { projectId },
      select: ['dependsOnDomainId'],
    });
    const projectRow = await this.projectRepo.findOne({
      where: { id: projectId },
      select: ['domainId'],
    });
    const domainIds = new Set(deps.map((d) => d.dependsOnDomainId));
    if (projectRow?.domainId) {
      const vis = await this.domainDomainVisRepo.find({
        where: { fromDomainId: projectRow.domainId },
        select: ['toDomainId'],
      });
      for (const v of vis) domainIds.add(v.toDomainId);
    }
    const domainIdsArr = [...domainIds];
    if (domainIdsArr.length === 0) return out;

    const siblings = await this.projectRepo.find({
      where: { domainId: In(domainIdsArr) },
      select: ['id'],
    });
    for (const s of siblings) {
      if (s.id === projectId) continue;
      for (const g of await this.graphShardNamesForProjectId(s.id)) {
        add(g, s.id);
      }
    }
    return out;
  }

  /**
   * Nombres de grafo únicos (propio + dominios whitelist).
   */
  async getExtendedGraphShardNames(projectId: string): Promise<string[]> {
    const ctx = await this.getCypherShardContexts(projectId);
    return [...new Set(ctx.map((c) => c.graphName))];
  }

  private async graphShardNamesForProjectId(pid: string): Promise<string[]> {
    const project = await this.projectRepo.findOne({ where: { id: pid } });
    if (!project) return [];
    const shardMode = effectiveShardMode(project.falkorShardMode);
    const segments = Array.isArray(project.falkorDomainSegments) ? project.falkorDomainSegments : [];
    return listGraphNamesForProjectRouting(
      pid,
      shardMode === 'domain' ? 'domain' : 'project',
      segments,
    );
  }

  async findOne(id: string): Promise<ProjectWithRepos> {
    const project = await this.projectRepo.findOne({ where: { id } });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    let domainName: string | null = null;
    let domainColor: string | null = null;
    if (project.domainId) {
      const d = await this.domainRepo.findOne({
        where: { id: project.domainId },
        select: ['name', 'color'],
      });
      domainName = d?.name ?? null;
      domainColor = d?.color ?? null;
    }
    const prs = await this.projectRepoRepo.find({
      where: { projectId: id },
      select: ['repoId', 'role'],
    });
    const repoIds = prs.map((pr) => pr.repoId);
    const roleByRepo = new Map(prs.map((pr) => [pr.repoId, pr.role ?? null] as const));
    const repositories =
      repoIds.length > 0
        ? await this.repoRepo.find({
            where: { id: In(repoIds) },
            select: ['id', 'provider', 'projectKey', 'repoSlug', 'defaultBranch', 'status', 'lastSyncAt'],
          })
        : [];
    return {
      id: project.id,
      name: project.name,
      description: project.description ?? null,
      domainId: project.domainId ?? null,
      domainName,
      domainColor,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      repositories: repositories.map((r) => ({
        id: r.id,
        provider: r.provider,
        projectKey: r.projectKey,
        repoSlug: r.repoSlug,
        defaultBranch: r.defaultBranch,
        status: r.status,
        lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
        role: roleByRepo.get(r.id) ?? null,
      })),
    };
  }

  async create(dto: { name?: string | null; description?: string | null }): Promise<ProjectEntity> {
    const entity = this.projectRepo.create({
      name: dto.name?.trim() || null,
      description: dto.description !== undefined ? (dto.description?.trim() || null) : null,
    });
    return this.projectRepo.save(entity);
  }

  async update(
    id: string,
    dto: { name?: string | null; description?: string | null; domainId?: string | null },
  ): Promise<ProjectEntity> {
    await this.findOne(id);
    const updates: { name?: string | null; description?: string | null; domainId?: string | null } = {};
    if (dto.name !== undefined) updates.name = dto.name?.trim() || null;
    if (dto.description !== undefined) updates.description = dto.description?.trim() || null;
    if (dto.domainId !== undefined) {
      if (dto.domainId === null || dto.domainId === '') {
        updates.domainId = null;
      } else {
        const d = await this.domainRepo.findOne({ where: { id: dto.domainId }, select: ['id'] });
        if (!d) throw new NotFoundException(`Domain ${dto.domainId} not found`);
        updates.domainId = dto.domainId;
      }
    }
    if (Object.keys(updates).length > 0) {
      await this.projectRepo.update(id, updates);
    }
    return this.projectRepo.findOneOrFail({ where: { id } });
  }

  /** Elimina un proyecto. Se desasocian los repos (se borran filas de project_repositories); los repos no se eliminan. */
  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.projectRepoRepo.delete({ projectId: id });
    await this.projectRepo.delete(id);
  }

  /**
   * Regenera el ID del proyecto: nuevo UUID, migra asociaciones y FalkorDB.
   * No pierde información; los repos y el grafo se conservan.
   */
  async regenerateId(projectId: string): Promise<{ newProjectId: string }> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const newProjectId = randomUUID();
    const prs = await this.projectRepoRepo.find({
      where: { projectId },
      select: ['repoId'],
    });
    const domainDeps = await this.projectDomainDepRepo.find({
      where: { projectId },
    });

    await this.projectRepo.insert({
      id: newProjectId,
      name: project.name,
      description: project.description ?? null,
      falkorShardMode: project.falkorShardMode,
      falkorDomainSegments: project.falkorDomainSegments,
      domainId: project.domainId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    for (const pr of prs) {
      await this.projectRepoRepo.save(
        this.projectRepoRepo.create({ repoId: pr.repoId, projectId: newProjectId }),
      );
    }
    for (const dd of domainDeps) {
      await this.projectDomainDepRepo.save(
        this.projectDomainDepRepo.create({
          projectId: newProjectId,
          dependsOnDomainId: dd.dependsOnDomainId,
          connectionType: dd.connectionType,
          description: dd.description,
        }),
      );
    }
    await this.projectRepoRepo.delete({ projectId });
    await this.projectDomainDepRepo.delete({ projectId });
    await this.projectRepo.delete(projectId);

    const config = getFalkorConfig();
    const client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
    try {
      const shardMode = effectiveShardMode(project.falkorShardMode);
      const segments = Array.isArray(project.falkorDomainSegments) ? project.falkorDomainSegments : [];
      const graphNames = listGraphNamesForProjectRouting(
        projectId,
        shardMode === 'domain' ? 'domain' : 'project',
        segments,
      );
      for (const gName of graphNames) {
        const graph = client.selectGraph(gName);
        try {
          await graph.query(`MATCH (n) WHERE n.projectId = $oldId SET n.projectId = $newId`, {
            params: { oldId: projectId, newId: newProjectId },
          });
          await graph.query(`MATCH (p:Project) WHERE p.projectId = $oldId SET p.projectId = $newId`, {
            params: { oldId: projectId, newId: newProjectId },
          });
        } catch {
          /* grafo ausente */
        }
      }
    } finally {
      await client.close();
    }

    return { newProjectId };
  }
}
