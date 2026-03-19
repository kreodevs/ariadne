/**
 * @fileoverview Módulo global de providers: GitHubService, GitCloneProvider, ProvidersDiscoveryController.
 */
import { Global, Module } from '@nestjs/common';
import { CredentialsModule } from '../credentials/credentials.module';
import { GitHubService } from './github.service';
import { ProvidersDiscoveryController } from './providers-discovery.controller';

@Global()
@Module({
  imports: [CredentialsModule],
  controllers: [ProvidersDiscoveryController],
  providers: [GitHubService],
  exports: [GitHubService],
})
/** Módulo global de proveedores de repositorios (GitHub, git clone). */
export class ProvidersModule {}
