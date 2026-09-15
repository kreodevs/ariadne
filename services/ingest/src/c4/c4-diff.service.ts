/**
 * @fileoverview Diff entre snapshots C4 (modelo + Archify compare).
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { diffC4Models, type C4ModelDiff } from 'ariadne-common';
import { C4SnapshotService } from './c4-snapshot.service';
import { C4ArchifyRenderer } from './c4-archify.renderer';

@Injectable()
export class C4DiffService {
  constructor(
    private readonly snapshots: C4SnapshotService,
    private readonly archify: C4ArchifyRenderer,
  ) {}

  async diffSnapshots(
    projectId: string,
    fromId: string,
    toId: string,
  ): Promise<{
    diff: C4ModelDiff;
    archifyCompareHtml: string | null;
    archifyComparePath: string | null;
    archifyCompareError: string | null;
    archifyBin: string | null;
  }> {
    const fromSnap = await this.snapshots.getById(fromId);
    const toSnap = await this.snapshots.getById(toId);
    if (!fromSnap || fromSnap.projectId !== projectId) {
      throw new NotFoundException(`Snapshot origen ${fromId} no encontrado`);
    }
    if (!toSnap || toSnap.projectId !== projectId) {
      throw new NotFoundException(`Snapshot destino ${toId} no encontrado`);
    }
    if (fromSnap.level !== toSnap.level) {
      throw new NotFoundException('Los snapshots deben ser del mismo nivel C4');
    }

    const diff = diffC4Models(fromSnap.modelJson, toSnap.modelJson);

    const baseIr = fromSnap.archifyJson;
    const headIr = toSnap.archifyJson;
    let archifyCompareHtml: string | null = null;
    let archifyComparePath: string | null = null;
    let archifyCompareError: string | null = null;
    let archifyBin: string | null = null;

    if (baseIr && headIr) {
      const cmp = await this.archify.compareArchitecture(
        projectId,
        fromSnap.level,
        baseIr,
        headIr,
        fromId,
        toId,
      );
      archifyComparePath = cmp.htmlPath;
      archifyBin = cmp.archifyBin;
      if (cmp.validated && existsSync(cmp.htmlPath)) {
        archifyCompareHtml = await readFile(cmp.htmlPath, 'utf8');
      } else if (!cmp.validated) {
        archifyCompareError = cmp.stderr ?? null;
      }
    } else {
      archifyCompareError = 'Snapshots sin IR Archify guardado; regenera ambos diagramas.';
    }

    return { diff, archifyCompareHtml, archifyComparePath, archifyCompareError, archifyBin };
  }

  /** True si los dos últimos snapshots de un nivel difieren en contentHash. */
  async topologyChangedSinceLastSync(projectId: string, level: string): Promise<boolean> {
    const list = await this.snapshots.listSnapshots(projectId, level, 2);
    if (list.length < 2) return false;
    return list[0]!.contentHash !== list[1]!.contentHash;
  }
}
