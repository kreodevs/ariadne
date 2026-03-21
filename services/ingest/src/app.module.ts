/**
 * @fileoverview Módulo raíz del Ingest: TypeORM, Bitbucket, Chat, Credentials, Embedding, Repos, Shadow, Sync, Webhooks.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RepositoryEntity } from './repositories/entities/repository.entity';
import { SyncJob } from './repositories/entities/sync-job.entity';
import { IndexedFile } from './repositories/entities/indexed-file.entity';
import { CredentialEntity } from './credentials/entities/credential.entity';
import { ProjectEntity } from './projects/entities/project.entity';
import { ProjectRepositoryEntity } from './repositories/entities/project-repository.entity';
import { BitbucketModule } from './bitbucket/bitbucket.module';
import { ChatModule } from './chat/chat.module';
import { CredentialsModule } from './credentials/credentials.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { ProvidersModule } from './providers/providers.module';
import { ProjectsModule } from './projects/projects.module';
import { RepositoriesModule } from './repositories/repositories.module';
import { ShadowModule } from './shadow/shadow.module';
import { SyncModule } from './sync/sync.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    EmbeddingModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.PGHOST ?? 'localhost',
      port: parseInt(process.env.PGPORT ?? '5432', 10),
      username: process.env.PGUSER ?? 'falkorspecs',
      password: process.env.PGPASSWORD ?? 'falkorspecs',
      database: process.env.PGDATABASE ?? 'falkorspecs',
      entities: [ProjectEntity, ProjectRepositoryEntity, RepositoryEntity, SyncJob, IndexedFile, CredentialEntity],
      synchronize: process.env.NODE_ENV !== 'production',
      logging: process.env.NODE_ENV === 'development',
    }),
    BitbucketModule,
    ChatModule,
    CredentialsModule,
    ProjectsModule,
    ProvidersModule,
    RepositoriesModule,
    ShadowModule,
    SyncModule,
    WebhooksModule,
  ],
})
/** Módulo principal del microservicio Ingest. */
export class AppModule { }
