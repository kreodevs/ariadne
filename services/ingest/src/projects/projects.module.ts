/**
 * @fileoverview Módulo de proyectos (multi-root): CRUD, listado con repos, file por proyecto.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from './entities/project.entity';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { ProjectRepositoryEntity } from '../repositories/entities/project-repository.entity';
import { ProjectDomainDependencyEntity } from '../domains/entities/project-domain-dependency.entity';
import { DomainEntity } from '../domains/entities/domain.entity';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { RepositoriesModule } from '../repositories/repositories.module';
import { ArchitectureModule } from '../architecture/architecture.module';
import { DomainsModule } from '../domains/domains.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectEntity,
      ProjectRepositoryEntity,
      RepositoryEntity,
      ProjectDomainDependencyEntity,
      DomainEntity,
    ]),
    RepositoriesModule,
    ArchitectureModule,
    DomainsModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
