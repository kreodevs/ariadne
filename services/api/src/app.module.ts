/**
 * @fileoverview Módulo raíz del API: GraphModule, AppController.
 */
import { Module } from '@nestjs/common';
import { GraphModule } from './graph/graph.module';
import { AppController } from './app.controller';

@Module({
  imports: [GraphModule],
  controllers: [AppController],
})
/** Módulo principal del API FalkorSpecs. */
export class AppModule {}
