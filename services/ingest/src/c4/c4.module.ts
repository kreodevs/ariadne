/**
 * @fileoverview Módulo C4 (container + Archify).
 */
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { C4SnapshotEntity } from './entities/c4-snapshot.entity';
import { IndexedFile } from '../repositories/entities/indexed-file.entity';
import { RepositoriesModule } from '../repositories/repositories.module';
import { ProjectsModule } from '../projects/projects.module';
import { C4Controller } from './c4.controller';
import { C4Service } from './c4.service';
import { C4SnapshotService } from './c4-snapshot.service';
import { C4ArchifyRenderer } from './c4-archify.renderer';
import { C4IngestService } from './c4-ingest.service';
import { C4ContextExtractor } from './c4-context.extractor';
import { C4ContextEnricher } from './c4-context.enricher';
import { C4ComponentExtractor } from './c4-component.extractor';
import { C4FalkorGraph } from './c4-falkor.graph';
import { C4DiffService } from './c4-diff.service';
import { C4SequenceExtractor } from './c4-sequence.extractor';
import { C4WorkflowExtractor } from './c4-workflow.extractor';
import { C4LifecycleExtractor } from './c4-lifecycle.extractor';
import { C4MarkdownExportService } from './c4-markdown-export.service';
import { C4ChatBridgeService } from './c4-chat-bridge.service';
import { DomainsModule } from '../domains/domains.module';
import { ProjectEntity } from '../projects/entities/project.entity';
import { DomainEntity } from '../domains/entities/domain.entity';
import { ProjectDomainDependencyEntity } from '../domains/entities/project-domain-dependency.entity';
import { DomainDomainVisibilityEntity } from '../domains/entities/domain-domain-visibility.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      C4SnapshotEntity,
      IndexedFile,
      ProjectEntity,
      DomainEntity,
      ProjectDomainDependencyEntity,
      DomainDomainVisibilityEntity,
    ]),
    forwardRef(() => RepositoriesModule),
    forwardRef(() => ProjectsModule),
    DomainsModule,
  ],
  controllers: [C4Controller],
  providers: [
    C4Service,
    C4SnapshotService,
    C4ArchifyRenderer,
    C4IngestService,
    C4ContextExtractor,
    C4ContextEnricher,
    C4ComponentExtractor,
    C4FalkorGraph,
    C4DiffService,
    C4SequenceExtractor,
    C4WorkflowExtractor,
    C4LifecycleExtractor,
    C4MarkdownExportService,
    C4ChatBridgeService,
  ],
  exports: [C4Service, C4IngestService, C4DiffService, C4ChatBridgeService],
})
export class C4Module {}
