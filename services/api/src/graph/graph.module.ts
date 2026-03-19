/**
 * @fileoverview Módulo Graph: impact, component, contract, manual, compare, shadow.
 */
import { Module } from '@nestjs/common';
import { GraphController } from './graph.controller';
import { GraphService } from './graph.service';
import { FalkorService } from '../falkor.service';
import { CacheService } from '../cache.service';

@Module({
  controllers: [GraphController],
  providers: [GraphService, FalkorService, CacheService],
  exports: [GraphService],
})
/** Módulo del grafo FalkorDB (impact, componente, contrato, manual, compare). */
export class GraphModule {}
