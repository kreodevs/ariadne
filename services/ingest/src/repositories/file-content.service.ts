/**
 * @fileoverview Obtiene el contenido de archivos desde repositorios remotos (Bitbucket/GitHub). Usado por GET /repositories/:id/file y por la tool MCP get_file_content.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { BitbucketService } from '../bitbucket/bitbucket.service';
import { GitHubService } from '../providers/github.service';
import { RepositoriesService } from './repositories.service';

/**
 * Servicio de contenido de archivos: lee archivos y lista ramas desde Bitbucket o GitHub según el proveedor del repo.
 */
@Injectable()
export class FileContentService {
  constructor(
    private readonly repos: RepositoriesService,
    private readonly bitbucket: BitbucketService,
    private readonly github: GitHubService,
  ) {}

  /**
   * Obtiene el contenido de un archivo del repositorio (Bitbucket o GitHub). Lanza NotFoundException si no existe.
   * @param {string} repositoryId - ID del repositorio.
   * @param {string} path - Ruta del archivo (relativa al repo o con prefijo).
   * @param {string} [ref] - Rama o ref (por defecto defaultBranch del repo).
   * @returns {Promise<string>} Contenido del archivo.
   */
  async getFileContent(
    repositoryId: string,
    path: string,
    ref?: string,
  ): Promise<string> {
    const repo = await this.repos.findOne(repositoryId);
    const relPath = this.toRelativePath(path, repo.repoSlug);

    if (repo.provider === 'bitbucket') {
      return this.bitbucket.getFileContent(
        repo.projectKey,
        repo.repoSlug,
        ref ?? repo.defaultBranch,
        relPath,
        repo.credentialsRef,
      );
    }
    if (repo.provider === 'github') {
      return this.github.getFileContent(
        repo.projectKey,
        repo.repoSlug,
        ref ?? repo.defaultBranch,
        relPath,
        repo.credentialsRef,
      );
    }
    throw new NotFoundException(`Provider ${repo.provider} does not support file content`);
  }

  /**
   * Lista las ramas del repositorio. Opcionalmente usa una credencial distinta (credentialsRef).
   * @param {string} repositoryId - ID del repositorio.
   * @param {string | null} [credentialsRef] - UUID de credencial (opcional; si no se pasa usa la del repo).
   * @returns {Promise<string[]>} Lista de nombres de ramas.
   */
  async listBranches(
    repositoryId: string,
    credentialsRef?: string | null,
  ): Promise<string[]> {
    const repo = await this.repos.findOne(repositoryId);
    const credRef = credentialsRef ?? repo.credentialsRef;
    if (repo.provider === 'bitbucket') {
      return this.bitbucket.listBranches(
        repo.projectKey,
        repo.repoSlug,
        credRef,
      );
    }
    if (repo.provider === 'github') {
      return this.github.listBranches(
        repo.projectKey,
        repo.repoSlug,
        credRef,
      );
    }
    throw new NotFoundException(`Provider ${repo.provider} does not support branches`);
  }

  /**
   * Igual que getFileContent pero retorna null en lugar de lanzar si el archivo no existe o hay error.
   * @param {string} repositoryId - ID del repositorio.
   * @param {string} path - Ruta del archivo.
   * @param {string} [ref] - Rama o ref (opcional).
   * @returns {Promise<string | null>} Contenido del archivo o null.
   */
  async getFileContentSafe(
    repositoryId: string,
    path: string,
    ref?: string,
  ): Promise<string | null> {
    try {
      return await this.getFileContent(repositoryId, path, ref);
    } catch {
      return null;
    }
  }

  /**
   * Obtiene el contenido de un archivo buscando en todos los repos del proyecto (multi-root).
   * Prueba cada repo hasta que uno devuelva contenido. Útil para chat por proyecto.
   * @param {string} projectId - ID del proyecto.
   * @param {string} path - Ruta del archivo (relativa al repo).
   * @returns {Promise<string | null>} Contenido del archivo o null si no existe en ningún repo.
   */
  async getFileContentSafeByProject(projectId: string, path: string): Promise<string | null> {
    const repos = await this.repos.findAll(projectId);
    for (const repo of repos) {
      const content = await this.getFileContentSafe(repo.id, path);
      if (content != null) return content;
    }
    return null;
  }

  /** Convierte path del grafo (repo-slug/src/foo.ts) a relPath (src/foo.ts) */
  private toRelativePath(path: string, repoSlug: string): string {
    const norm = path.replace(/\\/g, '/').trim();
    const prefix = repoSlug + '/';
    if (norm.startsWith(prefix)) {
      return norm.slice(prefix.length);
    }
    return norm;
  }
}
