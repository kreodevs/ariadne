/**
 * @fileoverview CRUD dominios y dependencias proyecto → dominio.
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DomainEntity } from './entities/domain.entity';
import { ProjectDomainDependencyEntity } from './entities/project-domain-dependency.entity';
import { DomainDomainVisibilityEntity } from './entities/domain-domain-visibility.entity';
import { ProjectEntity } from '../projects/entities/project.entity';

export interface DomainDto {
  id: string;
  name: string;
  description: string | null;
  color: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  /** Proyectos con `domain_id` = este dominio. */
  assignedProjectCount?: number;
}

export interface ProjectDomainDependencyDto {
  id: string;
  projectId: string;
  dependsOnDomainId: string;
  dependsOnDomainName?: string;
  connectionType: string;
  description: string | null;
  createdAt: string;
}

export interface DomainVisibilityEdgeDto {
  id: string;
  fromDomainId: string;
  toDomainId: string;
  toDomainName?: string;
  description: string | null;
  createdAt: string;
}

@Injectable()
export class DomainsService {
  constructor(
    @InjectRepository(DomainEntity)
    private readonly domainRepo: Repository<DomainEntity>,
    @InjectRepository(ProjectDomainDependencyEntity)
    private readonly depRepo: Repository<ProjectDomainDependencyEntity>,
    @InjectRepository(DomainDomainVisibilityEntity)
    private readonly domainVisRepo: Repository<DomainDomainVisibilityEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
  ) {}

  private toDto(d: DomainEntity): DomainDto {
    return {
      id: d.id,
      name: d.name,
      description: d.description ?? null,
      color: d.color,
      metadata: d.metadata ?? null,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    };
  }

  async findAll(): Promise<DomainDto[]> {
    const rows = await this.domainRepo.find({ order: { name: 'ASC' } });
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const raw = await this.projectRepo
      .createQueryBuilder('p')
      .select('p.domain_id', 'domainId')
      .addSelect('COUNT(*)', 'cnt')
      .where('p.domain_id IN (:...ids)', { ids })
      .groupBy('p.domain_id')
      .getRawMany();
    const countByDomain = new Map<string, number>(
      raw.map((x: { domainId: string; cnt: string }) => [x.domainId, parseInt(String(x.cnt), 10)]),
    );
    return rows.map((r) => ({
      ...this.toDto(r),
      assignedProjectCount: countByDomain.get(r.id) ?? 0,
    }));
  }

  async findOne(id: string): Promise<DomainDto> {
    const d = await this.domainRepo.findOne({ where: { id } });
    if (!d) throw new NotFoundException(`Domain ${id} not found`);
    return this.toDto(d);
  }

  async create(body: {
    name: string;
    description?: string | null;
    color?: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<DomainDto> {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('name required');
    const entity = this.domainRepo.create({
      name,
      description: body.description?.trim() ?? null,
      color: (body.color?.trim() || '#6366f1').slice(0, 16),
      metadata: body.metadata ?? null,
    });
    const saved = await this.domainRepo.save(entity);
    return this.toDto(saved);
  }

  async update(
    id: string,
    body: Partial<{ name: string; description: string | null; color: string; metadata: Record<string, unknown> | null }>,
  ): Promise<DomainDto> {
    const row = await this.domainRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Domain ${id} not found`);
    if (body.name !== undefined) row.name = body.name.trim() || '';
    if (body.description !== undefined) row.description = body.description?.trim() ?? null;
    if (body.color !== undefined) row.color = body.color.slice(0, 16);
    if (body.metadata !== undefined) row.metadata = body.metadata;
    await this.domainRepo.save(row);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.domainRepo.delete(id);
  }

  async listProjectsForDomain(domainId: string): Promise<Array<{ id: string; name: string | null }>> {
    await this.findOne(domainId);
    const projects = await this.projectRepo.find({
      where: { domainId },
      select: ['id', 'name'],
      order: { updatedAt: 'DESC' },
    });
    return projects.map((p) => ({ id: p.id, name: p.name ?? null }));
  }

  async listOutgoingVisibility(fromDomainId: string): Promise<DomainVisibilityEdgeDto[]> {
    await this.findOne(fromDomainId);
    const rows = await this.domainVisRepo.find({
      where: { fromDomainId },
      order: { createdAt: 'ASC' },
    });
    const toIds = [...new Set(rows.map((r) => r.toDomainId))];
    const domains =
      toIds.length > 0
        ? await this.domainRepo.find({ where: { id: In(toIds) }, select: ['id', 'name'] })
        : [];
    const nameById = new Map(domains.map((d) => [d.id, d.name] as const));
    return rows.map((r) => ({
      id: r.id,
      fromDomainId: r.fromDomainId,
      toDomainId: r.toDomainId,
      toDomainName: nameById.get(r.toDomainId),
      description: r.description ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async addDomainVisibility(
    fromDomainId: string,
    body: { toDomainId: string; description?: string | null },
  ): Promise<DomainVisibilityEdgeDto> {
    if (fromDomainId === body.toDomainId) {
      throw new BadRequestException('fromDomainId and toDomainId must differ');
    }
    await this.findOne(fromDomainId);
    await this.findOne(body.toDomainId);
    const entity = this.domainVisRepo.create({
      fromDomainId,
      toDomainId: body.toDomainId,
      description: body.description?.trim() ?? null,
    });
    try {
      const saved = await this.domainVisRepo.save(entity);
      const to = await this.domainRepo.findOne({ where: { id: saved.toDomainId }, select: ['name'] });
      return {
        id: saved.id,
        fromDomainId: saved.fromDomainId,
        toDomainId: saved.toDomainId,
        toDomainName: to?.name,
        description: saved.description ?? null,
        createdAt: saved.createdAt.toISOString(),
      };
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err?.code === '23505') {
        throw new BadRequestException('Visibility edge already exists for this pair');
      }
      throw e;
    }
  }

  async removeDomainVisibility(fromDomainId: string, edgeId: string): Promise<void> {
    await this.findOne(fromDomainId);
    const r = await this.domainVisRepo.findOne({ where: { id: edgeId, fromDomainId } });
    if (!r) throw new NotFoundException('Visibility edge not found');
    await this.domainVisRepo.delete(edgeId);
  }

  async listProjectDependencies(projectId: string): Promise<ProjectDomainDependencyDto[]> {
    await this.ensureProject(projectId);
    const rows = await this.depRepo.find({
      where: { projectId },
      order: { createdAt: 'ASC' },
    });
    const domainIds = [...new Set(rows.map((r) => r.dependsOnDomainId))];
    const domains =
      domainIds.length > 0
        ? await this.domainRepo.find({ where: { id: In(domainIds) }, select: ['id', 'name'] })
        : [];
    const nameById = new Map(domains.map((d) => [d.id, d.name] as const));
    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      dependsOnDomainId: r.dependsOnDomainId,
      dependsOnDomainName: nameById.get(r.dependsOnDomainId),
      connectionType: r.connectionType,
      description: r.description ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async addProjectDependency(
    projectId: string,
    body: { dependsOnDomainId: string; connectionType?: string; description?: string | null },
  ): Promise<ProjectDomainDependencyDto> {
    await this.ensureProject(projectId);
    await this.findOne(body.dependsOnDomainId);
    const entity = this.depRepo.create({
      projectId,
      dependsOnDomainId: body.dependsOnDomainId,
      connectionType: (body.connectionType?.trim() || 'REST').slice(0, 32),
      description: body.description?.trim() ?? null,
    });
    try {
      const saved = await this.depRepo.save(entity);
      const d = await this.domainRepo.findOne({
        where: { id: saved.dependsOnDomainId },
        select: ['name'],
      });
      return {
        id: saved.id,
        projectId: saved.projectId,
        dependsOnDomainId: saved.dependsOnDomainId,
        dependsOnDomainName: d?.name,
        connectionType: saved.connectionType,
        description: saved.description ?? null,
        createdAt: saved.createdAt.toISOString(),
      };
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err?.code === '23505') {
        throw new BadRequestException('Dependency already exists for this project and domain');
      }
      throw e;
    }
  }

  async removeProjectDependency(projectId: string, depId: string): Promise<void> {
    await this.ensureProject(projectId);
    const r = await this.depRepo.findOne({ where: { id: depId, projectId } });
    if (!r) throw new NotFoundException('Dependency not found');
    await this.depRepo.delete(depId);
  }

  private async ensureProject(projectId: string): Promise<void> {
    const p = await this.projectRepo.findOne({ where: { id: projectId }, select: ['id'] });
    if (!p) throw new NotFoundException(`Project ${projectId} not found`);
  }
}
