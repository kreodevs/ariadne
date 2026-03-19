/**
 * @fileoverview Módulo de credenciales: CRUD tokens/secrets cifrados para Bitbucket/GitHub.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CredentialEntity } from './entities/credential.entity';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';

@Module({
  imports: [TypeOrmModule.forFeature([CredentialEntity])],
  controllers: [CredentialsController],
  providers: [CredentialsService],
  exports: [CredentialsService],
})
/** Módulo de credenciales cifradas en BD. */
export class CredentialsModule {}
