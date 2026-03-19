/**
 * @fileoverview Módulo RedisState: estado de sesión para workflows.
 */
import { Global, Module } from '@nestjs/common';
import { RedisStateService } from './redis-state.service';

@Global()
@Module({
  providers: [RedisStateService],
  exports: [RedisStateService],
})
/** Módulo global de estado en Redis. */
export class RedisStateModule {}
