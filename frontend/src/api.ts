/**
 * API client para el servicio Ingest (repos, sync, chat, análisis, credenciales).
 * Usa VITE_API_URL + /api. Incluye Bearer token JWT (OTP) en todas las peticiones.
 * En 401 de sesión (JWT) redirige a /login; un 401 del proveedor LLM/upstream
 * (p. ej. API key de OpenRouter inválida) se propaga como error normal, sin cerrar sesión.
 * @module api
 */
import { getToken, removeToken } from './utils/auth';
import { getApiBase } from './lib/api-base';

/** Base URL para llamadas API (por defecto `${VITE_API_URL}/api`). */
export const API_BASE = getApiBase();

const BASE = API_BASE;

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Códigos/errores que identifican un 401 de auth del proveedor LLM/upstream (no de sesión). */
const UPSTREAM_AUTH_CODES = new Set(['ORCHESTRATOR_LLM_AUTH', 'LlmAuthError']);

/**
 * Normaliza el cuerpo de error de la API. Extrae `message`, `code` y `error`, y
 * desanida una capa cuando `message` viene como JSON (upstream → ingest → api).
 */
function parseApiError(text: string): { message: string; code?: string; error?: string } {
  let message = text || '';
  let code: string | undefined;
  let error: string | undefined;
  try {
    const json = JSON.parse(text) as { message?: string | string[]; code?: string; error?: string };
    code = json.code;
    error = json.error;
    if (json.message != null) {
      message = Array.isArray(json.message) ? json.message.join('; ') : String(json.message);
    }
    try {
      const inner = JSON.parse(message) as { message?: string; error?: string };
      if (inner?.message) message = inner.message;
      if (!error && inner?.error) error = inner.error;
    } catch {
      /* message ya es texto plano */
    }
  } catch {
    /* usar text tal cual */
  }
  return { message, code, error };
}

/** true si el 401 proviene de auth del proveedor LLM/upstream (no debe cerrar la sesión web). */
function isUpstreamAuthError(code?: string, error?: string): boolean {
  return (code != null && UPSTREAM_AUTH_CODES.has(code)) || (error != null && UPSTREAM_AUTH_CODES.has(error));
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...getAuthHeaders(), ...options?.headers },
  });

  if (!res.ok) {
    const text = await res.text();
    const { message, code, error } = parseApiError(text);

    // Solo cerrar sesión ante un 401 de sesión (JWT/token). Un 401 del LLM/upstream
    // (p. ej. API key de OpenRouter inválida) se muestra como error normal en la UI.
    if (res.status === 401 && !isUpstreamAuthError(code, error)) {
      removeToken();
      window.location.href = '/login';
      throw new Error('Sesión expirada. Redirigiendo al login.');
    }

    throw new Error(`${res.status}: ${message || res.statusText}`);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T;
  return res.json();
}

/** Reintento ligero ante 429 (TPM) en chat ingest — The Forge / operadores. */
async function postChatWith429Retry<T>(path: string, body: unknown): Promise<T> {
  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await request<T>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.startsWith('429:') || attempt === maxAttempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 3500 * 2 ** attempt));
    }
  }
  throw lastErr;
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
  /** Quita el repo del proyecto sin eliminar el registro del repositorio. */
  detachProjectRepository: (projectId: string, repoId: string) =>
    request<{ projectId: string; repoId: string; deletedNodes: number }>(
      `/projects/${projectId}/repositories/${repoId}`,
      { method: 'DELETE' },
    ),
  regenerateProjectId: (projectId: string) =>
    request<{ newProjectId: string }>(`/projects/${projectId}/regenerate-id`, {
      method: 'POST',
    }),
  deleteProject: (id: string) =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }),

  getC4Model: (projectId: string, level = 'container') =>
    request<{
      model: Record<string, unknown>;
      htmlReady: boolean;
      snapshotId: string;
    }>(`/projects/${projectId}/c4?level=${encodeURIComponent(level)}`),

  generateC4: (
    projectId: string,
    opts?: {
      level?: string;
      levels?: string[];
      useLlm?: boolean;
      containerKey?: string;
      repoId?: string;
    },
  ) =>
    request<
      | {
          model: Record<string, unknown>;
          snapshotId: string;
          htmlReady: boolean;
          archifyHtmlPath: string | null;
          archifyError: string | null;
          archifyBin: string | null;
        }
      | {
          levels: Record<
            string,
            {
              model: Record<string, unknown>;
              htmlReady: boolean;
              archifyError: string | null;
              archifyBin: string | null;
            }
          >;
        }
    >(`/projects/${projectId}/c4/generate`, {
      method: 'POST',
      body: JSON.stringify(
        opts?.levels
          ? {
              levels: opts.levels,
              useLlm: opts.useLlm,
              containerKey: opts.containerKey,
              repoId: opts.repoId,
            }
          : {
              level: opts?.level ?? 'container',
              useLlm: opts?.useLlm,
              containerKey: opts?.containerKey,
              repoId: opts?.repoId,
            },
      ),
    }),

  listC4Snapshots: (projectId: string, level?: string, limit = 20) =>
    request<{
      snapshots: Array<{
        id: string;
        level: string;
        contentHash: string;
        createdAt: string;
        generator: string;
      }>;
    }>(
      `/projects/${projectId}/c4/snapshots?${level ? `level=${encodeURIComponent(level)}&` : ''}limit=${limit}`,
    ),

  listC4SequenceRoutes: (projectId: string) =>
    request<{
      routes: Array<{
        routePath: string;
        screenName: string | null;
        apiSummary: string | null;
        isPublicEntry: boolean;
        hasApiLink: boolean;
      }>;
    }>(`/projects/${projectId}/c4/sequence/routes`),

  generateC4Sequence: (projectId: string, routePath?: string) =>
    request<{
      htmlReady: boolean;
      durationMs: number;
      archifyError: string | null;
      archifyBin: string | null;
      routePath: string;
      title: string;
      synthetic: boolean;
    }>(
      `/projects/${projectId}/c4/sequence/generate`,
      {
        method: 'POST',
        body: JSON.stringify({ routePath }),
      },
    ),

  getC4SequenceHtml: async (projectId: string): Promise<string> => {
    const res = await fetch(`${BASE}/projects/${projectId}/c4/sequence/html`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const text = await res.text();
      const { message } = parseApiError(text);
      throw new Error(`${res.status}: ${message || res.statusText}`);
    }
    return res.text();
  },

  generateC4Workflow: (projectId: string) =>
    request<{
      htmlReady: boolean;
      durationMs: number;
      archifyError: string | null;
      archifyBin: string | null;
      title: string;
    }>(`/projects/${projectId}/c4/workflow/generate`, { method: 'POST', body: '{}' }),

  getC4WorkflowHtml: async (projectId: string): Promise<string> => {
    const res = await fetch(`${BASE}/projects/${projectId}/c4/workflow/html`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const text = await res.text();
      const { message } = parseApiError(text);
      throw new Error(`${res.status}: ${message || res.statusText}`);
    }
    return res.text();
  },

  listC4LifecycleTargets: (projectId: string) =>
    request<{
      targets: Array<{ id: string; label: string; description: string }>;
    }>(`/projects/${projectId}/c4/lifecycle/targets`),

  generateC4Lifecycle: (projectId: string, target?: string, routePath?: string) =>
    request<{
      htmlReady: boolean;
      durationMs: number;
      archifyError: string | null;
      archifyBin: string | null;
      title: string;
      target: string;
    }>(`/projects/${projectId}/c4/lifecycle/generate`, {
      method: 'POST',
      body: JSON.stringify({ target, routePath }),
    }),

  getC4LifecycleHtml: async (projectId: string, target = 'sync-job'): Promise<string> => {
    const res = await fetch(
      `${BASE}/projects/${projectId}/c4/lifecycle/html?target=${encodeURIComponent(target)}`,
      { headers: getAuthHeaders() },
    );
    if (!res.ok) {
      const text = await res.text();
      const { message } = parseApiError(text);
      throw new Error(`${res.status}: ${message || res.statusText}`);
    }
    return res.text();
  },

  exportC4Markdown: (projectId: string) =>
    request<{ files: Array<{ name: string; content: string }>; merged: string }>(
      `/projects/${projectId}/c4/export`,
    ),

  diffC4Snapshots: (projectId: string, fromId: string, toId: string) =>
    request<{
      diff: Record<string, unknown>;
      archifyCompareHtml: string | null;
      archifyComparePath: string | null;
      archifyCompareError: string | null;
      archifyBin: string | null;
    }>(
      `/projects/${projectId}/c4/diff?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`,
    ),

  getC4Html: async (projectId: string, level = 'container'): Promise<string> => {
    const res = await fetch(
      `${BASE}/projects/${projectId}/c4/html?level=${encodeURIComponent(level)}`,
      { headers: getAuthHeaders() },
    );
    if (!res.ok) {
      const text = await res.text();
      const { message } = parseApiError(text);
      throw new Error(`${res.status}: ${message || res.statusText}`);
    }
    return res.text();
  },

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

  getDomainProjects: (domainId: string) =>
    request<Array<{ id: string; name: string | null }>>(
      `/domains/${encodeURIComponent(domainId)}/projects`,
    ),
  listDomainVisibility: (domainId: string) =>
    request<import('./types').DomainVisibilityEdge[]>(
      `/domains/${encodeURIComponent(domainId)}/visibility`,
    ),
  addDomainVisibility: (
    domainId: string,
    dto: { toDomainId: string; description?: string | null },
  ) =>
    request<import('./types').DomainVisibilityEdge>(
      `/domains/${encodeURIComponent(domainId)}/visibility`,
      { method: 'POST', body: JSON.stringify(dto) },
    ),
  removeDomainVisibility: (domainId: string, edgeId: string) =>
    request<void>(
      `/domains/${encodeURIComponent(domainId)}/visibility/${encodeURIComponent(edgeId)}`,
      { method: 'DELETE' },
    ),

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
  inferProjectDomainDependencies: (projectId: string) =>
    request<{
      added: import('./types').ProjectDomainDependency[];
      inferred: Array<{
        dependsOnDomainId: string;
        dependsOnDomainName: string;
        connectionType: string;
        description: string;
      }>;
    }>(`/projects/${encodeURIComponent(projectId)}/domain-dependencies/infer`, {
      method: 'POST',
    }),

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
  /** Jobs queued/running en todos los repos. */
  getActiveSyncJobs: () =>
    request<import('./types').ActiveSyncJob[]>('/repositories/jobs/active'),
  getJobAnalysis: (repoId: string, jobId: string) =>
    request<import('./types').JobAnalysisResult>(`/repositories/${repoId}/jobs/${jobId}/analysis`),
  getJobAnalysisByProject: (projectId: string, jobId: string) =>
    request<import('./types').JobAnalysisResult>(`/projects/${projectId}/jobs/${jobId}/analysis`),
  deleteJob: (repoId: string, jobId: string) =>
    request<void>(`/repositories/${repoId}/jobs/${jobId}`, { method: 'DELETE' }),
  cancelSyncJob: (repoId: string, jobId: string) =>
    request<{ bullRemoved: number }>(`/repositories/${repoId}/jobs/${jobId}/cancel`, {
      method: 'POST',
    }),
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
    /** API default: listado completo; solo enviar full=0 para muestra acotada. */
    if (full === false) q.set('full', '0');
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

  chat: (repoId: string, body: import('./types').IngestChatRequestBody) =>
    postChatWith429Retry<import('./types').IngestChatResponse>(`/repositories/${repoId}/chat`, body),

  chatProject: (projectId: string, body: import('./types').IngestChatRequestBody) =>
    postChatWith429Retry<import('./types').IngestChatResponse>(`/projects/${projectId}/chat`, body),

  listRepoConversations: (repoId: string) =>
    request<import('./types').ChatConversation[]>(`/repositories/${repoId}/conversations`),

  createRepoConversation: (repoId: string, body?: { title?: string | null }) =>
    request<import('./types').ChatConversation>(`/repositories/${repoId}/conversations`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),

  listProjectConversations: (projectId: string) =>
    request<import('./types').ChatConversation[]>(`/projects/${projectId}/conversations`),

  createProjectConversation: (projectId: string, body?: { title?: string | null }) =>
    request<import('./types').ChatConversation>(`/projects/${projectId}/conversations`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),

  getConversationMessages: (conversationId: string) =>
    request<import('./types').ChatConversationMessage[]>(`/conversations/${conversationId}/messages`),

  appendConversationMessage: (
    conversationId: string,
    body: { role: 'user' | 'assistant'; content: string; cypher?: string | null },
  ) =>
    request<import('./types').ChatConversationMessage>(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  renameConversation: (conversationId: string, title: string) =>
    request<import('./types').ChatConversation>(`/conversations/${conversationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  deleteConversation: (conversationId: string) =>
    request<void>(`/conversations/${conversationId}`, { method: 'DELETE' }),

  getConversationForgePromotion: (conversationId: string) =>
    request<import('./types').ForgePromotionState>(`/conversations/${conversationId}/forge-promotion`),

  previewTheForgePack: (
    conversationId: string,
    body: Partial<import('./types').PromoteToTheForgeRequest>,
  ) =>
    request<import('./types').PreviewTheForgePackResult>(
      `/conversations/${conversationId}/preview-theforge-pack`,
      { method: 'POST', body: JSON.stringify(body ?? {}) },
    ),

  getConversationPreviewTheForgePackResult: (conversationId: string) =>
    request<import('./types').PreviewTheForgePackResponse>(
      `/conversations/${conversationId}/preview-theforge-pack/result`,
    ),

  promoteConversationToTheForge: (
    conversationId: string,
    body: import('./types').PromoteToTheForgeRequest,
  ) =>
    request<import('./types').PromoteToTheForgeResult>(
      `/conversations/${conversationId}/promote-to-theforge`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  listIntegrationHandoffSources: (projectId: string) =>
    request<import('./types').ForgeIntegrationHandoffSource[]>(
      `/projects/${projectId}/integration-handoffs/sources`,
    ),

  importIntegrationHandoffs: (projectId: string, sourceForgeProjectId: string) =>
    request<import('./types').ImportIntegrationHandoffsResponse>(
      `/projects/${projectId}/integration-handoffs/import`,
      { method: 'POST', body: JSON.stringify({ sourceForgeProjectId }) },
    ),

  getConversationIntegrationBatch: (conversationId: string) =>
    request<import('./types').ChatIntegrationBatch | null>(
      `/conversations/${conversationId}/integration-batch`,
    ),

  getIntegrationBatch: (batchId: string) =>
    request<import('./types').ChatIntegrationBatch>(`/integration-batches/${batchId}`),

  deleteIntegrationBatch: (batchId: string) =>
    request<void>(`/integration-batches/${batchId}`, { method: 'DELETE' }),

  previewIntegrationBatchTheForgePack: (
    batchId: string,
    body: Partial<import('./types').PromoteToTheForgeRequest>,
  ) =>
    request<import('./types').PreviewIntegrationBatchTheForgeResult>(
      `/integration-batches/${batchId}/preview-theforge-pack`,
      { method: 'POST', body: JSON.stringify(body ?? {}) },
    ),

  getIntegrationBatchPreviewResult: (batchId: string) =>
    request<import('./types').PreviewIntegrationBatchTheForgeResponse>(
      `/integration-batches/${batchId}/preview-theforge-pack/result`,
    ),

  promoteIntegrationBatchToTheForge: (
    batchId: string,
    body: import('./types').PromoteToTheForgeRequest,
  ) =>
    request<import('./types').PromoteToTheForgeResult>(
      `/integration-batches/${batchId}/promote-to-theforge`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  getTheForgeIntegrationStatus: () =>
    request<import('./types').TheForgeIntegrationStatus>('/theforge-integration/status'),

  listTheForgeBrownfieldProjects: () =>
    request<import('./types').ForgeBrownfieldProjectsResponse>(
      '/theforge-integration/brownfield-projects',
    ),

  linkProjectToTheForge: (
    projectId: string,
    body: { forgeProjectId: string; forgeProjectName?: string | null },
  ) =>
    request<import('./types').Project>(`/projects/${encodeURIComponent(projectId)}/theforge-link`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  unlinkProjectFromTheForge: (projectId: string) =>
    request<import('./types').Project>(`/projects/${encodeURIComponent(projectId)}/theforge-link`, {
      method: 'DELETE',
    }),

  previewProjectTheForgeStage: (
    projectId: string,
    body: import('./types').ProjectTheForgeStageRequest,
  ) =>
    request<import('./types').ProjectTheForgeStagePreview>(
      `/projects/${encodeURIComponent(projectId)}/theforge-stage/preview`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  createProjectTheForgeStage: (
    projectId: string,
    body: import('./types').ProjectTheForgeStageRequest,
  ) =>
    request<import('./types').CreateProjectTheForgeStageResponse>(
      `/projects/${encodeURIComponent(projectId)}/theforge-stage`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  getTheForgeIntegrationSettings: () =>
    request<import('./types').TheForgeIntegrationSettings>('/theforge-integration'),

  updateTheForgeIntegrationSettings: (body: import('./types').UpdateTheForgeIntegrationDto) =>
    request<import('./types').TheForgeIntegrationSettings>('/theforge-integration', {
      method: 'PUT',
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
      graphHints?: { suggestResync?: boolean; messageEs?: string };
    }>(`/graph/component/${encodeURIComponent(name)}${qs ? `?${qs}` : ''}`);
  },

  /** Relaciones crudas indexadas en Falkor (IMPORTS, CONTAINS, CALLS, RENDERS, …). */
  getIndexedGraphSnapshot: (opts: { projectId: string; repoId?: string; limit?: number }) => {
    const q = new URLSearchParams();
    q.set('projectId', opts.projectId);
    if (opts.repoId) q.set('repoId', opts.repoId);
    if (opts.limit != null) q.set('limit', String(opts.limit));
    return request<{
      projectId: string;
      repoId?: string;
      limit: number;
      truncated: boolean;
      nodes: Array<{ id: string; kind: string; name?: string; path?: string }>;
      edges: Array<{ source: string; target: string; kind: string }>;
    }>(`/graph/indexed-snapshot?${q.toString()}`);
  },

  /**
   * Cypher de solo lectura contra Falkor vía Nest (misma conexión que el resto del grafo).
   * Requiere FALKOR_DEBUG_CYPHER=1 en el API.
   */
  postFalkorDebugQuery: (body: {
    query: string;
    params?: Record<string, unknown>;
    projectId?: string;
    scopePath?: string;
    graphName?: string;
  }) =>
    request<{ headers: string[]; data: unknown[][]; graphLabel: string }>('/graph/falkor-debug-query', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ─── Users ───
  getUsers: () => request<unknown[]>('/users'),
  getUserProfile: (id: string) => request<Record<string, unknown>>(`/users/${id}`),
  updateUserRole: (id: string, role: string) =>
    request<Record<string, unknown>>(`/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  regenerateMcpToken: (id: string) =>
    request<{ token: string; prefix: string }>(`/users/${id}/regenerate-mcp-token`, {
      method: 'POST',
    }),
  getMcpSecret: (id: string) =>
    request<{ mcpSecret: string; email: string; prefix: string }>(`/users/${id}/mcp-secret`),
  createUser: (email: string, role: string) =>
    request<Record<string, unknown>>('/users', {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),
  deleteUser: (id: string) =>
    request<void>(`/users/${id}`, { method: 'DELETE' }),

  // ─── LLM Settings (admin) ───
  getLlmCatalog: () => request<import('./types').LlmProviderCatalogEntry[]>('/llm-settings/catalog'),
  getLlmSettings: () => request<import('./types').LlmSettingsMasked>('/llm-settings'),
  updateLlmSettings: (dto: import('./types').UpdateLlmSettingsDto) =>
    request<import('./types').LlmSettingsMasked>('/llm-settings', {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),
  testLlmSettings: (dto?: import('./types').UpdateLlmSettingsDto) =>
    request<import('./types').LlmTestConnectionResult>('/llm-settings/test', {
      method: 'POST',
      body: JSON.stringify(dto ?? {}),
    }),

  getSystemSettings: () => request<import('./types').SystemSettingsMasked>('/system-settings'),
  updateSystemSettings: (dto: import('./types').UpdateSystemSettingsDto) =>
    request<import('./types').SystemSettingsMasked>('/system-settings', {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),
};
