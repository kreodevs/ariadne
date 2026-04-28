import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from '../projects/entities/project.entity';
import { ProjectRepositoryEntity } from '../repositories/entities/project-repository.entity';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { DomainEntity } from '../domains/entities/domain.entity';
import { ProjectDomainDependencyEntity } from '../domains/entities/project-domain-dependency.entity';
import { C4DslGeneratorService } from './c4-dsl-generator.service';
import { KrokiProxyService } from './kroki-proxy.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectEntity,
      ProjectRepositoryEntity,
      RepositoryEntity,
      DomainEntity,
      ProjectDomainDependencyEntity,
    ]),
  ],
  providers: [C4DslGeneratorService, KrokiProxyService],
  exports: [C4DslGeneratorService, KrokiProxyService],
})
export class ArchitectureModule {}
