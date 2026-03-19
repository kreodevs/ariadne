/**
 * @fileoverview Módulo Bitbucket: expone BitbucketService para listar archivos, contenido y branches.
 */
import { Global, Module } from '@nestjs/common';
import { CredentialsModule } from '../credentials/credentials.module';
import { BitbucketService } from './bitbucket.service';

@Global()
@Module({
  imports: [CredentialsModule],
  providers: [BitbucketService],
  exports: [BitbucketService],
})
/** Módulo global Bitbucket Cloud API 2.0. */
export class BitbucketModule {}
