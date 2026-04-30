/**
 * @fileoverview Módulo de repositorios: CRUD, jobs, file content, graph summary.
 * Sin dependencia circular: usa SharedBullModule directamente (no SyncModule).
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { SharedBullModule } from '../shared-bull/shared-bull.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RepositoryEntity, ProjectRepositoryEntity, SyncJob, IndexedFile, ProjectEntity]),
    EmbeddingModule,
    SharedBullModule,
  ],
  controllers: [RepositoriesController],
  providers: [RepositoriesService, FileContentService, JobAnalysisService, EmbedIndexService],
  exports: [RepositoriesService, FileContentService, EmbedIndexService, JobAnalysisService],
})
export class RepositoriesModule {}
