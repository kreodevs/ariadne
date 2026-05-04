/**
 * @fileoverview Módulo raíz **AppModule** del servicio Ingest: Postgres (TypeORM), dominios, repos,
 * credenciales, sync BullMQ, webhooks Bitbucket/GitHub, chat NL→Cypher, análisis, métricas y shadow SDD.
 *
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RepositoryEntity } from './repositories/entities/repository.entity';
import { SyncJob } from './repositories/entities/sync-job.entity';
import { IndexedFile } from './repositories/entities/indexed-file.entity';
import { CredentialEntity } from './credentials/entities/credential.entity';
import { ProjectEntity } from './projects/entities/project.entity';
import { ProjectRepositoryEntity } from './repositories/entities/project-repository.entity';
import { DomainEntity } from './domains/entities/domain.entity';
import { ProjectDomainDependencyEntity } from './domains/entities/project-domain-dependency.entity';
import { DomainDomainVisibilityEntity } from './domains/entities/domain-domain-visibility.entity';
import { EmbeddingSpaceEntity } from './embedding/entities/embedding-space.entity';
import { UserEntity } from './users/entities/user.entity';
import { BitbucketModule } from './bitbucket/bitbucket.module';
import { ChatModule } from './chat/chat.module';
import { CredentialsModule } from './credentials/credentials.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { ProvidersModule } from './providers/providers.module';
import { ProjectsModule } from './projects/projects.module';
import { RepositoriesModule } from './repositories/repositories.module';
import { ShadowModule } from './shadow/shadow.module';
import { SyncModule } from './sync/sync.module';
import { UsersModule } from './users/users.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { MetricsModule } from './metrics/metrics.module';
import { SharedBullModule } from './shared-bull/shared-bull.module';

@Module({
  imports: [
    MetricsModule,
    EmbeddingModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.PGHOST ?? 'localhost',
      port: parseInt(process.env.PGPORT ?? '5432', 10),
      username: process.env.PGUSER ?? 'falkorspecs',
      password: process.env.PGPASSWORD ?? 'falkorspecs',
      database: process.env.PGDATABASE ?? 'falkorspecs',
      entities: [
        ProjectEntity,
        ProjectRepositoryEntity,
        RepositoryEntity,
        EmbeddingSpaceEntity,
        SyncJob,
        IndexedFile,
        CredentialEntity,
        DomainEntity,
        ProjectDomainDependencyEntity,
        DomainDomainVisibilityEntity,
        UserEntity,
      ],
      synchronize: true,
      logging: process.env.NODE_ENV === 'development',
    }),
    BitbucketModule,
    ChatModule,
    CredentialsModule,
    ProjectsModule,
    ProvidersModule,
    RepositoriesModule,
    SharedBullModule,
    ShadowModule,
    SyncModule,
    UsersModule,
    WebhooksModule,
  ],
})
/** Módulo principal del microservicio Ingest. */
export class AppModule { }
