/**
 * @fileoverview Bitbucket Cloud REST API 2.0: listar archivos, contenido, ramas y diff por commit. Base URL: https://api.bitbucket.org/2.0. Auth: Basic (app password) o Bearer; desde BD (credentialsRef) o env.
 */

import { Injectable } from '@nestjs/common';
import type { BitbucketAuth } from '../credentials/credentials.service';
import { CredentialsService } from '../credentials/credentials.service';
import { shouldSkipWalkDirectory, shouldSyncIndexPath } from '../providers/sync-path-filter';

interface SrcEntry {
  path: string;
  type: 'commit_file' | 'commit_directory';
}

interface SrcPage {
  values: SrcEntry[];
  next?: string;
}

interface DiffstatEntry {
  new?: { path: string };
  old?: { path: string };
}

interface DiffstatPage {
  values?: DiffstatEntry[];
  next?: string;
}

/**
 * Servicio para Bitbucket Cloud REST API: listar archivos, contenido, branches, diff por commit.
 * Usa CredentialsService para resolver credentialsRef o variables de entorno.
 */
@Injectable()
export class BitbucketService {
  private readonly baseUrl: string;

  constructor(private readonly credentials: CredentialsService) {
    this.baseUrl = (process.env.BITBUCKET_BASE_URL ?? 'https://api.bitbucket.org/2.0').replace(
      /\/$/,
      '',
    );
  }

  private authHeadersFromEnv(): Record<string, string> {
    const token =
      process.env.BITBUCKET_TOKEN ?? process.env.BITBUCKET_APP_PASSWORD ?? null;
    const headers: Record<string, string> = {};
    if (token) {
      if (process.env.BITBUCKET_APP_PASSWORD) {
        const user = process.env.BITBUCKET_USER ?? '';
        headers['Authorization'] = 'Basic ' + Buffer.from(`${user}:${token}`).toString('base64');
      } else {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }
    return headers;
  }

  private authHeadersFromCreds(creds: BitbucketAuth): Record<string, string> {
    if (creds.type === 'basic') {
      return {
        Authorization:
          'Basic ' + Buffer.from(`${creds.username ?? ''}:${creds.token}`).toString('base64'),
      };
    }
    return { Authorization: `Bearer ${creds.token}` };
  }

  private async getAuthHeaders(credentialsRef?: string | null): Promise<Record<string, string>> {
    if (credentialsRef) {
      const creds = await this.credentials.resolveForBitbucket(credentialsRef);
      if (creds) return this.authHeadersFromCreds(creds);
    }
    return this.authHeadersFromEnv();
  }

  private async request<T>(
    url: string,
    options: RequestInit & { credentialsRef?: string | null } = {},
  ): Promise<T> {
    const { credentialsRef, ...rest } = options;
    const headers = {
      ...(await this.getAuthHeaders(credentialsRef)),
      ...(rest.headers as Record<string, string>),
    };
    let res: Response;
    try {
      res = await fetch(url, { ...rest, headers });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const c = (err as Error & { cause?: unknown }).cause;
      const causeMsg =
        c instanceof Error
          ? c.message
          : c != null && typeof c === 'object' && 'code' in c
            ? String((c as { code?: unknown }).code ?? c)
            : c != null
              ? String(c)
              : '';
      const suffix = causeMsg ? ` (${causeMsg})` : '';
      throw new Error(
        `Bitbucket fetch failed: ${err.message}${suffix}. Check outbound HTTPS/DNS from this host, proxy, and TLS. URL: ${url.split('?')[0]}`,
      );
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bitbucket API ${res.status}: ${text}`);
    }
    if (res.headers.get('content-type')?.includes('application/json')) {
      return res.json() as Promise<T>;
    }
    return res.text() as unknown as T;
  }

  private async rawGet(
    url: string,
    credentialsRef?: string | null,
  ): Promise<{ contentType: string; body: string }> {
    const headers = await this.getAuthHeaders(credentialsRef);
    let res: Response;
    try {
      res = await fetch(url, { headers });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const c = (err as Error & { cause?: unknown }).cause;
      const causeMsg = c instanceof Error ? c.message : c != null ? String(c) : '';
      throw new Error(
        `Bitbucket fetch failed: ${err.message}${causeMsg ? ` (${causeMsg})` : ''}. URL: ${url.split('?')[0]}`,
      );
    }
    if (!res.ok) throw new Error(`Bitbucket API ${res.status}: ${await res.text()}`);
    return { contentType: res.headers.get('content-type') ?? '', body: await res.text() };
  }

  /** Archivos en la raíz del repo (sin subcarpetas). */
  async listRootFiles(
    workspace: string,
    repoSlug: string,
    ref: string,
    credentialsRef?: string | null,
  ): Promise<string[]> {
    const url = `${this.baseUrl}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/src/${encodeURIComponent(ref)}/`;
    const page: SrcPage = await this.request<SrcPage>(url, { credentialsRef });
    const out: string[] = [];
    for (const v of page.values ?? []) {
      if (v.type === 'commit_file' && !v.path.includes('/')) out.push(v.path);
    }
    return out;
  }

  async listFiles(
    workspace: string,
    repoSlug: string,
    ref: string,
    credentialsRef?: string | null,
  ): Promise<string[]> {
    const files: string[] = [];
    const queue: string[] = [];

    const fetchDir = async (pathPrefix: string): Promise<void> => {
      const pathPart = pathPrefix ? pathPrefix + '/' : '';
      const url = `${this.baseUrl}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/src/${encodeURIComponent(ref)}/${pathPart}`;
      let next: string | undefined = url;
      while (next) {
        const page: SrcPage = await this.request<SrcPage>(next, { credentialsRef });
        for (const v of page.values ?? []) {
          if (v.type === 'commit_directory') {
            const dirName = v.path.split('/').pop();
            if (dirName && !shouldSkipWalkDirectory(dirName)) queue.push(v.path);
          } else if (v.type === 'commit_file' && shouldSyncIndexPath(v.path)) {
            files.push(v.path);
          }
        }
        next = page.next;
      }
    };

    await fetchDir('');
    while (queue.length) {
      const dir = queue.shift()!;
      await fetchDir(dir);
    }
    return files;
  }

  async getChangedPathsInCommit(
    workspace: string,
    repoSlug: string,
    commitHash: string,
    credentialsRef?: string | null,
  ): Promise<string[]> {
    const diffUrl = `${this.baseUrl}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/diff/${commitHash}`;
    const { contentType, body } = await this.rawGet(diffUrl, credentialsRef);
    if (contentType.includes('application/json')) {
      return this.getChangedPathsFromDiffstat(workspace, repoSlug, commitHash, credentialsRef);
    }
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const line of body.split('\n')) {
      const m = line.match(/^diff --git a\/(.+?) b\//);
      if (m) {
        const p = m[1].trim();
        if (p && !seen.has(p)) {
          seen.add(p);
          if (shouldSyncIndexPath(p)) paths.push(p);
        }
      }
    }
    return paths;
  }

  private async getChangedPathsFromDiffstat(
    workspace: string,
    repoSlug: string,
    commitHash: string,
    credentialsRef?: string | null,
  ): Promise<string[]> {
    const paths: string[] = [];
    let next: string | undefined = `${this.baseUrl}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/diffstat/${commitHash}`;
    while (next) {
      const page: DiffstatPage = await this.request<DiffstatPage>(next, { credentialsRef });
      for (const v of page.values ?? []) {
        const p = (v.new ?? v.old)?.path;
        if (p && shouldSyncIndexPath(p)) paths.push(p);
      }
      next = page.next;
    }
    return paths;
  }

  /**
   * Opciones para git clone. Evita rate limits (1 operación vs N requests a la API).
   */
  async getCloneOpts(
    workspace: string,
    repoSlug: string,
    ref: string,
    credentialsRef?: string | null,
  ): Promise<{ cloneUrl: string; token: string | null; ref: string; tokenUsername: string } | null> {
    const baseUrl = 'https://bitbucket.org';
    const cloneUrl = `${baseUrl}/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}.git`;
    let token: string | null = null;
    if (credentialsRef) {
      const creds = await this.credentials.resolveForBitbucket(credentialsRef);
      if (creds) token = creds.token;
    }
    if (!token) {
      token = process.env.BITBUCKET_TOKEN ?? process.env.BITBUCKET_APP_PASSWORD ?? null;
    }
    return { cloneUrl, token, ref, tokenUsername: 'x-bitbucket-api-token-auth' };
  }

  /**
   * Lista workspaces accesibles para el usuario autenticado.
   * Usa GET /2.0/user/workspaces (sustituye a /user/permissions/workspaces, retirado — CHANGE-2770).
   * @see https://developer.atlassian.com/cloud/bitbucket/rest/api-group-workspaces/#api-user-workspaces-get
   */
  async listWorkspaces(credentialsRef?: string | null): Promise<Array<{ slug: string; name?: string }>> {
    const seen = new Set<string>();
    const workspaces: Array<{ slug: string; name?: string }> = [];
    let next: string | undefined = `${this.baseUrl}/user/workspaces?pagelen=100`;
    while (next) {
      const page: { values?: Array<{ workspace?: { slug?: string; name?: string } }>; next?: string } =
        await this.request(next, { credentialsRef });
      for (const v of page.values ?? []) {
        const w = v.workspace;
        if (w?.slug && !seen.has(w.slug)) {
          seen.add(w.slug);
          workspaces.push({ slug: w.slug, name: w.name });
        }
      }
      next = page.next;
    }
    return workspaces.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /** Lista repositorios en un workspace (Bitbucket Cloud API 2.0). */
  async listRepositories(
    workspace: string,
    credentialsRef?: string | null,
  ): Promise<Array<{ slug: string; name?: string }>> {
    const repos: Array<{ slug: string; name?: string }> = [];
    let next: string | undefined = `${this.baseUrl}/repositories/${encodeURIComponent(workspace)}?pagelen=100`;
    while (next) {
      const page: { values?: Array<{ slug?: string; name?: string }>; next?: string } =
        await this.request(next, { credentialsRef });
      for (const v of page.values ?? []) {
        if (v.slug) repos.push({ slug: v.slug, name: v.name });
      }
      next = page.next;
    }
    return repos.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  async listBranches(
    workspace: string,
    repoSlug: string,
    credentialsRef?: string | null,
  ): Promise<string[]> {
    const names: string[] = [];
    let next: string | undefined = `${this.baseUrl}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/refs/branches?pagelen=100`;
    while (next) {
      const page: { values?: Array<{ name?: string }>; next?: string } = await this.request(next, {
        credentialsRef,
      });
      for (const v of page.values ?? []) {
        if (v.name) names.push(v.name);
      }
      next = page.next;
    }
    return names.sort((a, b) => {
      if (a === 'main') return -1;
      if (b === 'main') return 1;
      if (a === 'master') return -1;
      if (b === 'master') return 1;
      return a.localeCompare(b);
    });
  }

  async getLatestCommitSha(
    workspace: string,
    repoSlug: string,
    ref: string,
    credentialsRef?: string | null,
  ): Promise<string | null> {
    const url = `${this.baseUrl}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/commits/${encodeURIComponent(ref)}`;
    const page: { values?: Array<{ hash?: string }> } = await this.request(url, { credentialsRef });
    return page.values?.[0]?.hash ?? null;
  }

  async getFileContent(
    workspace: string,
    repoSlug: string,
    ref: string,
    path: string,
    credentialsRef?: string | null,
  ): Promise<string> {
    const url = `${this.baseUrl}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/src/${encodeURIComponent(ref)}/${path}`;
    return this.request<string>(url, { credentialsRef });
  }

  async getFileContentSafe(
    workspace: string,
    repoSlug: string,
    ref: string,
    path: string,
    credentialsRef?: string | null,
  ): Promise<string | null> {
    try {
      return await this.getFileContent(workspace, repoSlug, ref, path, credentialsRef);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes('404') || msg.includes('Not Found')) return null;
      throw e;
    }
  }
}
