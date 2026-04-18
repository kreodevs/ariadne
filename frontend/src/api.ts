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
  updateProject: (
    id: string,
    dto: { name?: string | null; description?: string | null; domainId?: string | null },
  ) =>
    request<{ id: string; name: string | null; description: string | null; createdAt: string; updatedAt: string }>(
      `/projects/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(dto),
      },
    ),
  setProjectRepositoryRole: (projectId: string, repoId: string, role: string | null) =>
    request<{ projectId: string; repoId: string; role: string | null }>(
      `/projects/${projectId}/repositories/${repoId}`,
      { method: 'PATCH', body: JSON.stringify({ role: role === '' ? null : role }) },
    ),
  regenerateProjectId: (projectId: string) =>
    request<{ newProjectId: string }>(`/projects/${projectId}/regenerate-id`, {
      method: 'POST',
    }),
  deleteProject: (id: string) =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }),

  getDomains: () => request<import('./types').Domain[]>('/domains'),
  createDomain: (dto: {
    name: string;
    description?: string | null;
    color?: string;
    metadata?: Record<string, unknown> | null;
  }) =>
    request<import('./types').Domain>('/domains', { method: 'POST', body: JSON.stringify(dto) }),
  updateDomain: (
    id: string,
    dto: Partial<{
      name: string;
      description: string | null;
      color: string;
      metadata: Record<string, unknown> | null;
    }>,
  ) =>
    request<import('./types').Domain>(`/domains/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deleteDomain: (id: string) => request<void>(`/domains/${id}`, { method: 'DELETE' }),

  getProjectArchitectureC4: (projectId: string, opts?: { level?: number; sessionId?: string | null }) => {
    const q = new URLSearchParams();
    if (opts?.level != null) q.set('level', String(opts.level));
    if (opts?.sessionId?.trim()) q.set('sessionId', opts.sessionId.trim());
    const qs = q.toString();
    return request<import('./types').ArchitectureC4Response>(
      `/projects/${encodeURIComponent(projectId)}/architecture/c4${qs ? `?${qs}` : ''}`,
    );
  },

  listProjectDomainDependencies: (projectId: string) =>
    request<import('./types').ProjectDomainDependency[]>(
      `/projects/${encodeURIComponent(projectId)}/domain-dependencies`,
    ),
  addProjectDomainDependency: (
    projectId: string,
    dto: { dependsOnDomainId: string; connectionType?: string; description?: string | null },
  ) =>
    request<import('./types').ProjectDomainDependency>(
      `/projects/${encodeURIComponent(projectId)}/domain-dependencies`,
      { method: 'POST', body: JSON.stringify(dto) },
    ),
  removeProjectDomainDependency: (projectId: string, depId: string) =>
    request<void>(
      `/projects/${encodeURIComponent(projectId)}/domain-dependencies/${encodeURIComponent(depId)}`,
      { method: 'DELETE' },
    ),

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
  getJobAnalysisByProject: (projectId: string, jobId: string) =>
    request<import('./types').JobAnalysisResult>(`/projects/${projectId}/jobs/${jobId}/analysis`),
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

  /** Vectores Falkor (Function, Component, Document, StorybookDoc, MarkdownDoc). Requiere EMBEDDING_* en ingest. */
  runEmbedIndex: (repoId: string) =>
    request<{ indexed: number; errors: number }>(`/repositories/${repoId}/embed-index`, {
      method: 'POST',
    }),

  analyze: (
    repoId: string,
    mode: import('./types').AnalyzeCodeMode,
    opts?: { scope?: import('./types').ChatScope; crossPackageDuplicates?: boolean },
  ) => {
    const body: Record<string, unknown> = { mode };
    if (opts?.scope && Object.keys(opts.scope).length > 0) body.scope = opts.scope;
    if (opts?.crossPackageDuplicates) body.crossPackageDuplicates = true;
    return request<import('./types').AnalyzeApiResult>(`/repositories/${repoId}/analyze`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  analyzeProject: (
    projectId: string,
    payload:
      | { mode: 'agents' | 'skill' }
      | {
          mode: 'diagnostico' | 'duplicados' | 'reingenieria' | 'codigo_muerto' | 'seguridad';
          repositoryId?: string;
          idePath?: string;
          scope?: import('./types').ChatScope;
          crossPackageDuplicates?: boolean;
        },
  ) =>
    request<import('./types').AnalyzeApiResult>(`/projects/${projectId}/analyze`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getFullAudit: (repoId: string) =>
    request<import('./types').FullAuditResult>(`/repositories/${repoId}/full-audit`, {
      method: 'POST',
    }),

  getGraphSummary: (repoId: string, full?: boolean, repoScoped?: boolean) => {
    const q = new URLSearchParams();
    if (full) q.set('full', '1');
    if (repoScoped) q.set('repoScoped', '1');
    const qs = q.toString();
    return request<{ counts: Record<string, number>; samples: Record<string, unknown[]> }>(
      `/repositories/${repoId}/graph-summary${qs ? `?${qs}` : ''}`,
    );
  },

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

  chatProject: (
    projectId: string,
    body: {
      message: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string; cypher?: string; result?: unknown[] }>;
      scope?: import('./types').ChatScope;
      twoPhase?: boolean;
      strictChatScope?: boolean;
    },
  ) =>
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

  /** Vista C4: sistemas, contenedores y COMMUNICATES_WITH (roll-up desde imports/calls). */
  getC4Model: (projectId: string) =>
    request<import('./types').C4ModelResponse>(
      `/graph/c4-model?projectId=${encodeURIComponent(projectId)}`,
    ),
};
