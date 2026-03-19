/**
 * @fileoverview Módulo Sync: BullMQ, SyncService, SyncProcessor. Encola jobs de indexación.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { SyncJob } from '../repositories/entities/sync-job.entity';
import { IndexedFile } from '../repositories/entities/indexed-file.entity';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { RepositoriesModule } from '../repositories/repositories.module';
import { BitbucketModule } from '../bitbucket/bitbucket.module';
import { ProvidersModule } from '../providers/providers.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncProcessor, SYNC_QUEUE } from './sync.processor';

/** Obtiene host/port/password de Redis desde REDIS_URL. */
function getRedisConnection() {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6380';
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: parseInt(u.port || '6379', 10),
      password: u.password || undefined,
    };
  } catch {
    return { host: 'localhost', port: 6380 };
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([RepositoryEntity, SyncJob, IndexedFile]),
    RepositoriesModule,
    BitbucketModule,
    ProvidersModule,
    BullModule.forRoot({
      connection: getRedisConnection(),
    }),
    BullModule.registerQueue({
      name: SYNC_QUEUE,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
      },
    }),
  ],
  controllers: [SyncController],
  providers: [SyncService, SyncProcessor],
})
/** Módulo de sincronización con BullMQ (queue sync). */
export class SyncModule {}
