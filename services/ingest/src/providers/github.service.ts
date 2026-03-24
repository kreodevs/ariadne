/**
 * @fileoverview GitHub REST API: listar archivos, contenido, commits y ramas. Auth: Personal Access Token desde BD (credentialsRef) o env.
 */

import { Injectable } from '@nestjs/common';
import { CredentialsService } from '../credentials/credentials.service';

const EXT = ['.js', '.jsx', '.ts', '.tsx'];
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'venv',
  '.venv',
  '__pycache__',
]);
const IGNORE_FILE = /\.(test|spec)\.(js|jsx|ts|tsx)$|\.log$|\/\.env$|^\.env$/;
const IGNORE_FILE_WITH_TESTS = /\.log$|\/\.env$|^\.env$/;

function shouldIndexTests(): boolean {
  const v = process.env.INDEX_TESTS;
  return v === 'true' || v === '1';
}

function matchesFilter(path: string): boolean {
  const base = path.split('/').pop() ?? '';
  if (IGNORE_DIRS.has(base)) return false;
  const ext = path.slice(path.lastIndexOf('.'));
  const ignoreRe = shouldIndexTests() ? IGNORE_FILE_WITH_TESTS : IGNORE_FILE;
  return EXT.includes(ext) && !ignoreRe.test(path);
}

interface GhContent {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url?: string | null;
}

interface GhCommit {
  sha: string;
  files?: Array<{ filename?: string; status?: string }>;
}

/**
 * Servicio para GitHub REST API: listar owners, repos, ramas, archivos y contenido; opciones para clone.
 */
@Injectable()
export class GitHubService {
  private readonly baseUrl = 'https://api.github.com';

  constructor(private readonly credentials: CredentialsService) {}

  private async getHeaders(credentialsRef?: string | null): Promise<Record<string, string>> {
    const token = credentialsRef
      ? await this.credentials.resolveForGitHub(credentialsRef)
      : null;
    const t = token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
    const h: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
    };
    if (t) h['Authorization'] = `Bearer ${t}`;
    return h;
  }

  private async request<T>(url: string, credentialsRef?: string | null): Promise<T> {
    const headers = await this.getHeaders(credentialsRef);
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  /**
   * Opciones para git clone (URL, token, ref). Evita rate limits usando 1 clone en lugar de N requests a la API.
   * @param {string} owner - Owner del repo (usuario u org).
   * @param {string} repo - Nombre del repositorio.
   * @param {string} ref - Rama o ref a clonar.
   * @param {string | null} [credentialsRef] - UUID de credencial (opcional).
   * @returns {Promise<{ cloneUrl: string; token: string | null; ref: string; tokenUsername: string } | null>}
   */
  async getCloneOpts(
    owner: string,
    repo: string,
    ref: string,
    credentialsRef?: string | null,
  ): Promise<{ cloneUrl: string; token: string | null; ref: string; tokenUsername: string } | null> {
    const cloneUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}.git`;
    let token: string | null = null;
    if (credentialsRef) {
      token = await this.credentials.resolveForGitHub(credentialsRef);
    }
    if (!token) token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
    return { cloneUrl, token, ref, tokenUsername: 'x-access-token' };
  }

  /**
   * Lista owners disponibles (usuario actual + organizaciones) para el token dado.
   * @param {string | null} [credentialsRef] - UUID de credencial (opcional).
   * @returns {Promise<Array<{ login: string }>>}
   */
  async listOwners(credentialsRef?: string | null): Promise<Array<{ login: string }>> {
    const owners: Array<{ login: string }> = [];
    const user = await this.request<{ login?: string }>(`${this.baseUrl}/user`, credentialsRef);
    if (user?.login) owners.push({ login: user.login });
    let page = 1;
    for (;;) {
      const orgs = await this.request<Array<{ login?: string }>>(
        `${this.baseUrl}/user/orgs?per_page=100&page=${page}`,
        credentialsRef,
      );
      if (!Array.isArray(orgs) || orgs.length === 0) break;
      for (const o of orgs) if (o.login) owners.push({ login: o.login });
      if (orgs.length < 100) break;
      page++;
    }
    return owners.sort((a, b) => a.login.localeCompare(b.login));
  }

  /** Lista repositorios de un owner (usuario u org). */
  async listRepositories(
    owner: string,
    credentialsRef?: string | null,
  ): Promise<Array<{ name: string; default_branch?: string }>> {
    const repos: Array<{ name: string; default_branch?: string }> = [];
    const user = await this.request<{ login?: string }>(`${this.baseUrl}/user`, credentialsRef);
    const isOrg = user?.login !== owner; // si owner es el usuario actual, no es org
    const base = isOrg
      ? `${this.baseUrl}/orgs/${encodeURIComponent(owner)}/repos`
      : `${this.baseUrl}/users/${encodeURIComponent(owner)}/repos`;
    let page = 1;
    for (;;) {
      const arr = await this.request<Array<{ name?: string; default_branch?: string }>>(
        `${base}?per_page=100&sort=full_name&page=${page}`,
        credentialsRef,
      );
      if (!Array.isArray(arr) || arr.length === 0) break;
      for (const r of arr) {
        if (r.name) repos.push({ name: r.name, default_branch: r.default_branch });
      }
      if (arr.length < 100) break;
      page++;
    }
    return repos.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listBranches(
    owner: string,
    repo: string,
    credentialsRef?: string | null,
  ): Promise<string[]> {
    const names: string[] = [];
    let page = 1;
    for (;;) {
      const arr = await this.request<Array<{ name?: string }>>(
        `${this.baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100&page=${page}`,
        credentialsRef,
      );
      if (!Array.isArray(arr) || arr.length === 0) break;
      for (const b of arr) {
        if (b.name) names.push(b.name);
      }
      if (arr.length < 100) break;
      page++;
    }
    return names.sort((a, b) => {
      if (a === 'main') return -1;
      if (b === 'main') return 1;
      if (a === 'master') return -1;
      if (b === 'master') return 1;
      return a.localeCompare(b);
    });
  }

  /**
   * List files recursively (uses Git Trees API).
   */
  async listFiles(
    owner: string,
    repo: string,
    ref: string,
    credentialsRef?: string | null,
  ): Promise<string[]> {
    const tree = await this.request<{ tree: Array<{ path?: string; type?: string }> }>(
      `${this.baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
      credentialsRef,
    );
    const paths: string[] = [];
    for (const item of tree.tree ?? []) {
      if (item.type === 'blob' && item.path && matchesFilter(item.path)) {
        paths.push(item.path);
      }
    }
    return paths;
  }

  /**
   * Obtiene el contenido de un archivo. Usa Accept: .raw para archivos hasta 100MB
   * (la API JSON con base64 falla o trunca en archivos >1MB).
   */
  async getFileContent(
    owner: string,
    repo: string,
    ref: string,
    path: string,
    credentialsRef?: string | null,
  ): Promise<string> {
    const url = `${this.baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
    const headers = {
      ...(await this.getHeaders(credentialsRef)),
      Accept: 'application/vnd.github.v3.raw',
    };
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    }
    return res.text();
  }

  async getFileContentSafe(
    owner: string,
    repo: string,
    ref: string,
    path: string,
    credentialsRef?: string | null,
  ): Promise<string | null> {
    try {
      return await this.getFileContent(owner, repo, ref, path, credentialsRef);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes('404') || msg.includes('Not Found')) return null;
      throw e;
    }
  }

  async getLatestCommitSha(
    owner: string,
    repo: string,
    ref: string,
    credentialsRef?: string | null,
  ): Promise<string | null> {
    const commit = await this.request<{ sha?: string }>(
      `${this.baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}`,
      credentialsRef,
    );
    return commit.sha ?? null;
  }

  /**
   * Get changed paths in a commit (for webhook incremental).
   */
  async getChangedPathsInCommit(
    owner: string,
    repo: string,
    commitSha: string,
  ): Promise<string[]> {
    const commit = await this.request<GhCommit>(
      `${this.baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(commitSha)}`,
    );
    const paths: string[] = [];
    for (const f of commit.files ?? []) {
      if (f.filename && matchesFilter(f.filename)) {
        paths.push(f.filename);
      }
    }
    return paths;
  }
}
