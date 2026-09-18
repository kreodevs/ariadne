/**
 * @fileoverview REST C4 — context, container, component + snapshots/diff (Entregas 1–3).
 */
import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { C4Level } from 'ariadne-common';
import { C4Service } from './c4.service';
import { C4DiffService } from './c4-diff.service';

const LEVELS: C4Level[] = ['context', 'container', 'component'];

function parseLevel(raw?: string): C4Level {
  const lv = (raw ?? 'container').toLowerCase() as C4Level;
  if (!LEVELS.includes(lv)) {
    throw new NotFoundException(`Nivel C4 "${lv}" no soportado (context | container | component)`);
  }
  return lv;
}

@Controller('projects/:projectId/c4')
export class C4Controller {
  constructor(
    private readonly c4: C4Service,
    private readonly c4Diff: C4DiffService,
  ) {}

  @Get()
  async getModel(
    @Param('projectId') projectId: string,
    @Query('level') level?: string,
  ) {
    const lv = parseLevel(level);
    const meta = await this.c4.getModelMeta(projectId, lv);
    if (!meta) {
      throw new NotFoundException('Sin snapshot C4. Ejecuta POST .../c4/generate');
    }
    return {
      model: meta.model,
      htmlReady: meta.htmlReady,
      snapshotId: meta.snapshotId,
    };
  }

  @Get('snapshots')
  async listSnapshots(
    @Param('projectId') projectId: string,
    @Query('level') level?: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? Math.min(parseInt(limit, 10) || 20, 50) : 20;
    const snapshots = await this.c4.listSnapshots(projectId, level?.toLowerCase(), n);
    return { snapshots };
  }

  @Get('diff')
  async diff(
    @Param('projectId') projectId: string,
    @Query('from') fromId: string,
    @Query('to') toId: string,
  ) {
    if (!fromId || !toId) {
      throw new NotFoundException('Query params from y to (snapshot ids) son obligatorios');
    }
    return this.c4Diff.diffSnapshots(projectId, fromId, toId);
  }

  @Post('generate')
  async generate(
    @Param('projectId') projectId: string,
    @Body()
    body: {
      level?: string;
      levels?: string[];
      useLlm?: boolean;
      containerKey?: string;
      repoId?: string;
    },
  ) {
    const results = await this.c4.generate(projectId, {
      level: body?.level,
      levels: body?.levels,
      useLlm: body?.useLlm,
      containerKey: body?.containerKey,
      repoId: body?.repoId,
    });
    const keys = Object.keys(results);
    if (keys.length === 1) {
      return results[keys[0]!]!;
    }
    return { levels: results };
  }

  @Get('sequence/routes')
  async listSequenceRoutes(@Param('projectId') projectId: string) {
    return this.c4.listSequenceRoutes(projectId);
  }

  @Post('sequence/generate')
  async generateSequence(
    @Param('projectId') projectId: string,
    @Body() body: { routePath?: string },
  ) {
    return this.c4.generateSequence(projectId, body?.routePath);
  }

  @Post('workflow/generate')
  async generateWorkflow(@Param('projectId') projectId: string) {
    return this.c4.generateWorkflow(projectId);
  }

  @Get('workflow/html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getWorkflowHtml(@Param('projectId') projectId: string, @Res() res?: Response) {
    const doc = await this.c4.readWorkflowHtml(projectId);
    if (!doc) {
      throw new NotFoundException('Sin workflow C4. Ejecuta POST .../c4/workflow/generate');
    }
    if (res) {
      res.send(doc.html);
      return;
    }
    return doc.html;
  }

  @Get('lifecycle/targets')
  listLifecycleTargets() {
    return this.c4.listLifecycleTargets();
  }

  @Post('lifecycle/generate')
  async generateLifecycle(
    @Param('projectId') projectId: string,
    @Body() body: { target?: string; routePath?: string },
  ) {
    return this.c4.generateLifecycle(projectId, body?.target ?? 'sync-job', body?.routePath);
  }

  @Get('lifecycle/html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getLifecycleHtml(
    @Param('projectId') projectId: string,
    @Query('target') target?: string,
    @Res() res?: Response,
  ) {
    const doc = await this.c4.readLifecycleHtml(projectId, target ?? 'sync-job');
    if (!doc) {
      throw new NotFoundException('Sin lifecycle C4. Ejecuta POST .../c4/lifecycle/generate');
    }
    if (res) {
      res.send(doc.html);
      return;
    }
    return doc.html;
  }

  @Get('sequence/html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getSequenceHtml(
    @Param('projectId') projectId: string,
    @Res() res?: Response,
  ) {
    const doc = await this.c4.readSequenceHtml(projectId);
    if (!doc) {
      throw new NotFoundException('Sin secuencia C4. Ejecuta POST .../c4/sequence/generate');
    }
    if (res) {
      res.send(doc.html);
      return;
    }
    return doc.html;
  }

  @Get('export')
  async exportMarkdown(@Param('projectId') projectId: string) {
    return this.c4.exportMarkdown(projectId);
  }

  @Get('html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getHtml(
    @Param('projectId') projectId: string,
    @Query('level') level?: string,
    @Res() res?: Response,
  ) {
    const lv = parseLevel(level);
    const doc = await this.c4.readHtml(projectId, lv);
    if (!doc) {
      throw new NotFoundException(
        'HTML C4 no disponible. Genera el diagrama y revisa Archify en Ajustes → Sistema.',
      );
    }
    if (res) {
      res.send(doc.html);
      return;
    }
    return doc.html;
  }
}
