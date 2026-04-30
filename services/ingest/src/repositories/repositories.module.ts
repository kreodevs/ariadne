/**
 * @fileoverview Módulo de repositorios: CRUD, jobs, file content, graph summary.
 * BullModule.forRoot + registerQueue aquí mismo para eliminar dependencias externas.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { RepositoryEntity } from './entities/repository.entity';
import { ProjectRepositoryEntity } from './entities/project-repository.entity';
import { SyncJob } from './entities/sync-job.entity';
import { IndexedFile } from './entities/indexed-file.entity';
import { ProjectEntity } from '../projects/entities/project.entity';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';
import { FileContentService } from './file-content.service';
import { JobAnalysisService } from './job-analysis.service';
import { EmbeddingModule } from '../embedding/embedding.module';
import { EmbedIndexService } from '../embedding/embed-index.service';
import { SYNC_QUEUE } from '../sync/sync.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([RepositoryEntity, ProjectRepositoryEntity, SyncJob, IndexedFile, ProjectEntity]),
    EmbeddingModule,
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_URL ? new URL(process.env.REDIS_URL).hostname : 'localhost',
        port: parseInt(process.env.REDIS_URL ? new URL(process.env.REDIS_URL).port : '6380', 10),
        password: process.env.REDIS_URL ? new URL(process.env.REDIS_URL).password || undefined : undefined,
      },
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
  controllers: [RepositoriesController],
  providers: [RepositoriesService, FileContentService, JobAnalysisService, EmbedIndexService],
  exports: [RepositoriesService, FileContentService, EmbedIndexService, JobAnalysisService],
})
export class RepositoriesModule {}
