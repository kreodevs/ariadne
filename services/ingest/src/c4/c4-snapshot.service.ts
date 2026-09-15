/**
 * @fileoverview Persistencia de snapshots C4Model.
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ArchifyArchitectureIr, C4Model } from 'ariadne-common';
import { C4SnapshotEntity } from './entities/c4-snapshot.entity';

@Injectable()
export class C4SnapshotService {
  constructor(
    @InjectRepository(C4SnapshotEntity)
    private readonly snapshots: Repository<C4SnapshotEntity>,
  ) {}

  async saveSnapshot(input: {
    projectId: string;
    repoId?: string | null;
    level: string;
    model: C4Model;
    archifyJson?: ArchifyArchitectureIr | null;
    archifyHtmlPath?: string | null;
  }): Promise<C4SnapshotEntity> {
    const row = this.snapshots.create({
      projectId: input.projectId,
      repoId: input.repoId ?? null,
      level: input.level,
      modelJson: input.model,
      archifyJson: input.archifyJson ?? null,
      archifyHtmlPath: input.archifyHtmlPath ?? null,
      contentHash: input.model.contentHash,
      generator: input.model.generator,
    });
    return this.snapshots.save(row);
  }

  async getLatest(projectId: string, level: string): Promise<C4SnapshotEntity | null> {
    return this.snapshots.findOne({
      where: { projectId, level },
      order: { createdAt: 'DESC' },
    });
  }

  async getById(id: string): Promise<C4SnapshotEntity | null> {
    return this.snapshots.findOne({ where: { id } });
  }

  async updateHtmlPath(id: string, archifyHtmlPath: string): Promise<void> {
    await this.snapshots.update({ id }, { archifyHtmlPath });
  }

  async listSnapshots(
    projectId: string,
    level?: string,
    limit = 20,
  ): Promise<C4SnapshotEntity[]> {
    const where: { projectId: string; level?: string } = { projectId };
    if (level) where.level = level;
    return this.snapshots.find({
      where,
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 50),
    });
  }
}
