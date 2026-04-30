/**
 * @fileoverview Módulo Sync: BullMQ, SyncService, SyncProcessor. Encola jobs de indexación.
 * SIN forwardRef de módulo: SyncService usa @Inject(forwardRef(() => RepositoriesService))
 * a nivel de provider (NestJS lo resuelve en el grafo global).
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncJob } from '../repositories/entities/sync-job.entity';
import { IndexedFile } from '../repositories/entities/indexed-file.entity';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { ProjectEntity } from '../projects/entities/project.entity';
import { BitbucketModule } from '../bitbucket/bitbucket.module';
import { ProvidersModule } from '../providers/providers.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncProcessor, SYNC_QUEUE } from './sync.processor';
import { SharedBullModule } from '../shared-bull/shared-bull.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RepositoryEntity, SyncJob, IndexedFile, ProjectEntity]),
    BitbucketModule,
    ProvidersModule,
    SharedBullModule,
  ],
  controllers: [SyncController],
  providers: [SyncService, SyncProcessor],
  exports: [SyncService],
})
/** Módulo de sincronización con BullMQ (queue sync). */
export class SyncModule {}
