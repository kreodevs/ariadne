/**
 * @fileoverview Endpoints para listar workspaces, repos y branches (Bitbucket/GitHub).
 * Usados por el formulario de alta de repositorio para selects en cascada.
 */
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { BitbucketService } from '../bitbucket/bitbucket.service';
import { GitHubService } from './github.service';

/** Rutas /providers para discovery (workspaces, repos, branches). */
@Controller('providers')
export class ProvidersDiscoveryController {
  constructor(
    private readonly bitbucket: BitbucketService,
    private readonly github: GitHubService,
  ) {}

  @Get('bitbucket/workspaces')
  async listBitbucketWorkspaces(@Query('credentialsRef') credentialsRef: string | undefined) {
    if (!credentialsRef?.trim()) {
      throw new BadRequestException('credentialsRef is required for Bitbucket workspaces');
    }
    return this.bitbucket.listWorkspaces(credentialsRef);
  }

  @Get('bitbucket/repositories')
  async listBitbucketRepositories(
    @Query('workspace') workspace: string | undefined,
    @Query('credentialsRef') credentialsRef: string | undefined,
  ) {
    if (!workspace?.trim() || !credentialsRef?.trim()) {
      throw new BadRequestException('workspace and credentialsRef are required');
    }
    return this.bitbucket.listRepositories(workspace, credentialsRef);
  }

  @Get('bitbucket/branches')
  async listBitbucketBranches(
    @Query('workspace') workspace: string | undefined,
    @Query('repoSlug') repoSlug: string | undefined,
    @Query('credentialsRef') credentialsRef: string | undefined,
  ) {
    if (!workspace?.trim() || !repoSlug?.trim()) {
      throw new BadRequestException('workspace and repoSlug are required');
    }
    const branches = await this.bitbucket.listBranches(workspace, repoSlug, credentialsRef ?? null);
    return { branches };
  }

  @Get('github/owners')
  async listGitHubOwners(@Query('credentialsRef') credentialsRef: string | undefined) {
    if (!credentialsRef?.trim()) {
      throw new BadRequestException('credentialsRef is required for GitHub owners');
    }
    return this.github.listOwners(credentialsRef);
  }

  @Get('github/repositories')
  async listGitHubRepositories(
    @Query('owner') owner: string | undefined,
    @Query('credentialsRef') credentialsRef: string | undefined,
  ) {
    if (!owner?.trim() || !credentialsRef?.trim()) {
      throw new BadRequestException('owner and credentialsRef are required');
    }
    return this.github.listRepositories(owner, credentialsRef);
  }

  @Get('github/branches')
  async listGitHubBranches(
    @Query('owner') owner: string | undefined,
    @Query('repo') repo: string | undefined,
    @Query('credentialsRef') credentialsRef: string | undefined,
  ) {
    if (!owner?.trim() || !repo?.trim()) {
      throw new BadRequestException('owner and repo are required');
    }
    const branches = await this.github.listBranches(owner, repo, credentialsRef ?? null);
    return { branches };
  }
}
