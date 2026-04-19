import { Module } from '@nestjs/common';
import { LegacyCoordinatorService } from './legacy-coordinator.service';
import { SemaphoreService } from './semaphore-legacy.service';

@Module({
  providers: [SemaphoreService, LegacyCoordinatorService],
  exports: [LegacyCoordinatorService, SemaphoreService],
})
export class LegacyModule {}
