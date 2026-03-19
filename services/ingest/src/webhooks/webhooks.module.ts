/**
 * @fileoverview Módulo Webhooks: Bitbucket push → trigger sync.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CredentialsModule } from '../credentials/credentials.module';
import { RepositoriesModule } from '../repositories/repositories.module';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { SyncJob } from '../repositories/entities/sync-job.entity';
import { IndexedFile } from '../repositories/entities/indexed-file.entity';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [
    CredentialsModule,
    RepositoriesModule,
    TypeOrmModule.forFeature([RepositoryEntity, SyncJob, IndexedFile]),
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
/** Módulo de webhooks (Bitbucket push → encola sync). */
export class WebhooksModule {}
