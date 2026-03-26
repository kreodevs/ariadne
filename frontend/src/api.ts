/**
 * API client para el servicio Ingest (repos, sync, chat, análisis, credenciales).
 * Usa VITE_API_URL + /api. Incluye Bearer token JWT (OTP) en todas las peticiones.
 * En 401 redirige a /login.
 * @module api
 */
import { getToken, removeToken } from './utils/auth';

/** Base URL para llamadas API (incluye /api). */
export const API_BASE =
  ((import.meta.env.VITE_API_URL as string) || 'http://localhost:3000').replace(/\/$/, '') + '/api';

const BASE = API_BASE;

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...getAuthHeaders(), ...options?.headers },
  });

  if (res.status === 401) {
    removeToken();
    window.location.href = '/login';
    throw new Error('Sesión expirada. Redirigiendo al login.');
  }

  if (!res.ok) {
    const text = await res.text();
    let msg = text || res.statusText;
    try {
      const json = JSON.parse(text) as { message?: string | string[] };
      if (json?.message) msg = Array.isArray(json.message) ? json.message.join('; ') : json.message;
    } catch {
      /* use text as-is */
    }
    throw new Error(`${res.status}: ${msg}`);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T;
  return res.json();
}

/** Objeto con métodos para todas las rutas del Ingest. */
export const api = {
  getProjects: () => request<import('./types').Project[]>('/projects'),
  getProject: (id: string) => request<import('./types').Project>(`/projects/${id}`),
  createProject: (dto: { name?: string | null; description?: string | null }) =>
    request<{ id: string; name: string | null; description: string | null; createdAt: string; updatedAt: string }>('/projects', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  updateProject: (id: string, dto: { name?: string | null; description?: string | null }) =>
    request<{ id: string; name: string | null; description: string | null; createdAt: string; updatedAt: string }>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),
  regenerateProjectId: (projectId: string) =>
    request<{ newProjectId: string }>(`/projects/${projectId}/regenerate-id`, {
      method: 'POST',
    }),
  deleteProject: (id: string) =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }),

  getRepositories: (projectId?: string) =>
    request<import('./types').Repository[]>(
      projectId ? `/repositories?projectId=${encodeURIComponent(projectId)}` : '/repositories',
    ),
  getRepository: (id: string) => request<import('./types').Repository>(`/repositories/${id}`),
  getBranches: (repoId: string, credentialsRef?: string | null) => {
    const q = credentialsRef ? `?credentialsRef=${encodeURIComponent(credentialsRef)}` : '';
    return request<{ branches: string[] }>(`/repositories/${repoId}/branches${q}`);
  },
  getJobs: (repoId: string) => request<import('./types').SyncJob[]>(`/repositories/${repoId}/jobs`),
  getJobAnalysis: (repoId: string, jobId: string) =>
    request<import('./types').JobAnalysisResult>(`/repositories/${repoId}/jobs/${jobId}/analysis`),
  deleteJob: (repoId: string, jobId: string) =>
    request<void>(`/repositories/${repoId}/jobs/${jobId}`, { method: 'DELETE' }),
  deleteAllJobs: (repoId: string) =>
    request<{ deleted: number }>(`/repositories/${repoId}/jobs`, { method: 'DELETE' }),
  createRepository: (dto: import('./types').CreateRepositoryDto) =>
    request<import('./types').Repository>('/repositories', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  updateRepository: (id: string, dto: import('./types').UpdateRepositoryDto) =>
    request<import('./types').Repository>(`/repositories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),
  deleteRepository: (id: string) =>
    request<void>(`/repositories/${id}`, { method: 'DELETE' }),
  triggerSync: (repoId: string) =>
    request<{ jobId: string; queued: boolean }>(`/repositories/${repoId}/sync`, {
      method: 'POST',
    }),
  triggerResync: (repoId: string) =>
    request<{ jobId: string; queued: boolean; deletedNodes?: number }>(`/repositories/${repoId}/resync`, {
      method: 'POST',
    }),

  resyncForProject: (repoId: string, projectId: string) =>
    request<{ jobId: string; queued: boolean }>(`/repositories/${repoId}/resync-for-project`, {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),

  analyze: (
    repoId: string,
    mode: 'diagnostico' | 'duplicados' | 'reingenieria' | 'codigo_muerto' | 'seguridad' | 'agents' | 'skill',
  ) =>
    request<{ mode: string; summary: string; details?: unknown }>(`/repositories/${repoId}/analyze`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),

  analyzeProject: (projectId: string, mode: 'agents' | 'skill') =>
    request<{ mode: string; summary: string; details?: unknown }>(`/projects/${projectId}/analyze`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),

  getFullAudit: (repoId: string) =>
    request<import('./types').FullAuditResult>(`/repositories/${repoId}/full-audit`, {
      method: 'POST',
    }),

  getGraphSummary: (repoId: string, full?: boolean) =>
    request<{ counts: Record<string, number>; samples: Record<string, unknown[]> }>(
      full ? `/repositories/${repoId}/graph-summary?full=1` : `/repositories/${repoId}/graph-summary`,
    ),

  getFileContent: (repoId: string, path: string, ref?: string) => {
    const q = new URLSearchParams({ path });
    if (ref) q.set('ref', ref);
    return request<{ content: string }>(`/repositories/${repoId}/file?${q}`);
  },

  chat: (repoId: string, body: { message: string; history?: Array<{ role: 'user' | 'assistant'; content: string; cypher?: string; result?: unknown[] }> }) =>
    request<{ answer: string; cypher?: string; result?: unknown[] }>(`/repositories/${repoId}/chat`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  chatProject: (projectId: string, body: { message: string; history?: Array<{ role: 'user' | 'assistant'; content: string; cypher?: string; result?: unknown[] }> }) =>
    request<{ answer: string; cypher?: string; result?: unknown[] }>(`/projects/${projectId}/chat`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listBitbucketWorkspaces: (credentialsRef: string) =>
    request<Array<{ slug: string; name?: string }>>(
      `/providers/bitbucket/workspaces?credentialsRef=${encodeURIComponent(credentialsRef)}`,
    ),
  listBitbucketRepositories: (workspace: string, credentialsRef: string) =>
    request<Array<{ slug: string; name?: string }>>(
      `/providers/bitbucket/repositories?workspace=${encodeURIComponent(workspace)}&credentialsRef=${encodeURIComponent(credentialsRef)}`,
    ),
  listBitbucketBranches: (workspace: string, repoSlug: string, credentialsRef?: string | null) =>
    request<{ branches: string[] }>(
      `/providers/bitbucket/branches?workspace=${encodeURIComponent(workspace)}&repoSlug=${encodeURIComponent(repoSlug)}${credentialsRef ? `&credentialsRef=${encodeURIComponent(credentialsRef)}` : ''}`,
    ),
  listGitHubOwners: (credentialsRef: string) =>
    request<Array<{ login: string }>>(
      `/providers/github/owners?credentialsRef=${encodeURIComponent(credentialsRef)}`,
    ),
  listGitHubRepositories: (owner: string, credentialsRef: string) =>
    request<Array<{ name: string; default_branch?: string }>>(
      `/providers/github/repositories?owner=${encodeURIComponent(owner)}&credentialsRef=${encodeURIComponent(credentialsRef)}`,
    ),
  listGitHubBranches: (owner: string, repo: string, credentialsRef?: string | null) =>
    request<{ branches: string[] }>(
      `/providers/github/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}${credentialsRef ? `&credentialsRef=${encodeURIComponent(credentialsRef)}` : ''}`,
    ),

  getCredentials: (provider?: string) =>
    request<import('./types').Credential[]>(
      provider ? `/credentials?provider=${encodeURIComponent(provider)}` : '/credentials',
    ),
  getCredential: (id: string) =>
    request<import('./types').Credential>(`/credentials/${id}`),
  createCredential: (dto: import('./types').CreateCredentialDto) =>
    request<import('./types').Credential>('/credentials', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  updateCredential: (id: string, dto: import('./types').UpdateCredentialDto) =>
    request<import('./types').Credential>(`/credentials/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),
  deleteCredential: (id: string) =>
    request<void>(`/credentials/${id}`, { method: 'DELETE' }),

  /** Grafo de dependencias + aristas de impacto legacy (API Nest /graph/component/:name). */
  getComponentGraph: (name: string, opts?: { depth?: number; projectId?: string }) => {
    const q = new URLSearchParams();
    if (opts?.depth != null) q.set('depth', String(opts.depth));
    if (opts?.projectId) q.set('projectId', opts.projectId);
    const qs = q.toString();
    return request<{
      componentName: string;
      depth: number;
      projectId?: string;
      dependencies: Array<{ name?: string; path?: string }>;
      nodes: Array<{ id: string; kind: string; name?: string; path?: string }>;
      edges: Array<{ source: string; target: string; kind: string }>;
    }>(`/graph/component/${encodeURIComponent(name)}${qs ? `?${qs}` : ''}`);
  },
};
