/**
 * @fileoverview Módulo raíz **AppModule** del API: grafo Falkor (`GraphModule`), autenticación OTP (`AuthModule`)
 * y controladores raíz (`AppController`).
 *
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
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
