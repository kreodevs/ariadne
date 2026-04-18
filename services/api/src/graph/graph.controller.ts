/**
 * @fileoverview Controller del grafo: impact, component, contract, manual, compare, shadow.
 */
import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { GraphService } from './graph.service';

/** Endpoints del grafo FalkorDB para el MCP AriadneSpecs. */
@Controller('graph')
export class GraphController {
  constructor(private readonly graph: GraphService) {}

  /** GET /graph/impact/:nodeId — Dependientes del nodo (componente/función) en el grafo. */
  @Get('impact/:nodeId')
  async impact(
    @Param('nodeId') nodeId: string,
    @Query('projectId') projectId?: string,
    @Query('scopePath') scopePath?: string,
  ) {
    if (!nodeId) {
      throw new HttpException('nodeId required', HttpStatus.BAD_REQUEST);
    }
    try {
      return this.graph.getImpact(nodeId, projectId || undefined, scopePath || undefined);
    } catch (err) {
      throw new HttpException(String(err), HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** GET /graph/component/:name?depth= — Árbol de dependencias del componente hasta depth. */
  @Get('component/:name')
  async component(
    @Param('name') name: string,
    @Query('depth') depthStr?: string,
    @Query('projectId') projectId?: string,
    @Query('scopePath') scopePath?: string,
  ) {
    if (!name) {
      throw new HttpException('name required', HttpStatus.BAD_REQUEST);
    }
    const depth = Math.min(
      10,
      Math.max(1, parseInt(depthStr ?? '2', 10) || 2),
    );
    try {
      return this.graph.getComponent(name, depth, projectId || undefined, scopePath || undefined);
    } catch (err) {
      throw new HttpException(String(err), HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** GET /graph/contract/:componentName — Props del contrato del componente. */
  @Get('contract/:componentName')
  async contract(
    @Param('componentName') componentName: string,
    @Query('projectId') projectId?: string,
    @Query('scopePath') scopePath?: string,
  ) {
    if (!componentName) {
      throw new HttpException('componentName required', HttpStatus.BAD_REQUEST);
    }
    try {
      return this.graph.getContract(componentName, projectId || undefined, scopePath || undefined);
    } catch (err) {
      throw new HttpException(String(err), HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** GET /graph/c4-model?projectId= — Modelo C4 (sistemas, contenedores, COMMUNICATES_WITH). projectId obligatorio con sharding. */
  @Get('c4-model')
  async c4Model(@Query('projectId') projectId: string) {
    if (!projectId?.trim()) {
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.graph.getC4Model(projectId.trim());
    } catch (err) {
      throw new HttpException(String(err), HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** GET /graph/manual?projectId= — Manual del proyecto en Markdown (opcional projectId). */
  @Get('manual')
  async manual(@Query('projectId') projectId?: string) {
    try {
      const markdown = await this.graph.getManual(projectId ?? undefined);
      return { markdown };
    } catch (err) {
      throw new HttpException(String(err), HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** GET /graph/compare/:componentName — Compara props del grafo principal vs shadow (SDD). */
  @Get('compare/:componentName')
  async compare(
    @Param('componentName') componentName: string,
    @Query('projectId') projectId?: string,
    @Query('shadowSessionId') shadowSessionId?: string,
    @Query('scopePath') scopePath?: string,
  ) {
    if (!componentName) {
      throw new HttpException('componentName required', HttpStatus.BAD_REQUEST);
    }
    try {
      return this.graph.compare(
        componentName,
        projectId || undefined,
        shadowSessionId || undefined,
        scopePath || undefined,
      );
    } catch (err) {
      throw new HttpException(String(err), HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** POST /graph/shadow — Proxy al Ingest para indexar shadow (body.files: path + content). */
  @Post('shadow')
  async shadow(
    @Body()
    body: {
      files?: { path: string; content: string }[];
      shadowSessionId?: string;
    },
  ) {
    if (!body?.files || !Array.isArray(body.files)) {
      throw new HttpException('body.files array required', HttpStatus.BAD_REQUEST);
    }
    try {
      return this.graph.shadowProxy(body.files, body.shadowSessionId);
    } catch (err: unknown) {
      const e = err as { status?: number; data?: unknown };
      throw new HttpException(
        e.data ?? String(err),
        e.status ? (e.status as HttpStatus) : HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
