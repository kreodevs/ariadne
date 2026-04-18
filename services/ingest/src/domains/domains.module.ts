import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DomainEntity } from './entities/domain.entity';
import { ProjectDomainDependencyEntity } from './entities/project-domain-dependency.entity';
import { DomainDomainVisibilityEntity } from './entities/domain-domain-visibility.entity';
import { ProjectEntity } from '../projects/entities/project.entity';
import { DomainsController } from './domains.controller';
import { DomainsService } from './domains.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DomainEntity,
      ProjectDomainDependencyEntity,
      DomainDomainVisibilityEntity,
      ProjectEntity,
    ]),
  ],
  controllers: [DomainsController],
  providers: [DomainsService],
  exports: [DomainsService, TypeOrmModule],
})
export class DomainsModule {}
