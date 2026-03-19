/**
 * @fileoverview Módulo Shadow: grafo FalkorSpecsShadow para compare SDD.
 */
import { Module } from '@nestjs/common';
import { ShadowController } from './shadow.controller';
import { ShadowService } from './shadow.service';

@Module({
  controllers: [ShadowController],
  providers: [ShadowService],
})
/** Módulo del grafo shadow para comparar props/contratos. */
export class ShadowModule {}
