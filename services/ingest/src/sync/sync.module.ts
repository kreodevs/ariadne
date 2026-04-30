/**
 * @fileoverview Módulo Sync: SyncService, SyncProcessor (BullMQ queue via SyncQueueModule compartido).
 */
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncJob } from '../repositories/entities/sync-job.entity';
import { IndexedFile } from '../repositories/entities/indexed-file.entity';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { ProjectEntity } from '../projects/entities/project.entity';
import { RepositoriesModule } from '../repositories/repositories.module';
import { BitbucketModule } from '../bitbucket/bitbucket.module';
import { ProvidersModule } from '../providers/providers.module';
import { SyncQueueModule } from './sync-queue.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncProcessor, SYNC_QUEUE } from './sync.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([RepositoryEntity, SyncJob, IndexedFile, ProjectEntity]),
    forwardRef(() => RepositoriesModule),
    BitbucketModule,
    ProvidersModule,
    SyncQueueModule,
  ],
  controllers: [SyncController],
  providers: [SyncService, SyncProcessor],
  exports: [SyncService, SyncQueueModule],
})
/** Módulo de sincronización con BullMQ (queue sync). */
export class SyncModule {}
