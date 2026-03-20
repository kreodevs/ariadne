/**
 * @fileoverview Módulo raíz del API: GraphModule, AuthModule, AppController.
 */
import { Module } from '@nestjs/common';
import { GraphModule } from './graph/graph.module';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';

@Module({
  imports: [GraphModule, AuthModule],
  controllers: [AppController],
})
/** Módulo principal del API FalkorSpecs. */
export class AppModule {}
