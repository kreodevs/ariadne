/**
 * @fileoverview Tipos e interfaces del frontend Ariadne (Repository, SyncJob, JobAnalysisResult, etc.).
 */

/** Estados del repositorio en el frontend. */
export type RepositoryStatus = 'pending' | 'syncing' | 'ready' | 'error';

/** Entidad repositorio (Bitbucket/GitHub). */
export interface Repository {
  id: string;
  provider: string;
  projectKey: string;
  repoSlug: string;
  defaultBranch: string;
  credentialsRef: string | null;
  lastSyncAt: string | null;
  lastCommitSha?: string | null;
  status: RepositoryStatus;
  projectId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Proyecto multi-root: agrupa N repositorios. */
export interface Project {
  id: string;
  name: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  repositories: Array<{
    id: string;
    provider: string;
    projectKey: string;
    repoSlug: string;
    defaultBranch: string;
    status: string;
    lastSyncAt: string | null;
  }>;
}

/** Tipo de job (full sync o incremental). */
export type SyncJobType = 'full' | 'incremental';
/** Estado del job. */
export type SyncJobStatus = 'queued' | 'running' | 'completed' | 'failed';

/** Resultado de análisis de job incremental (impacto, seguridad). */
export interface JobAnalysisResult {
  jobId: string;
  repositoryId: string;
  type: string;
  paths: string[];
  summary: {
    riskScore: number;
    totalPaths: number;
    securityFindings: number;
    dependentModules: number;
  };
  impacto: {
    dependents: Array<{ path: string; dependents: string[] }>;
  };
  seguridad: {
    findings: Array<{
      path: string;
      severity: 'critica' | 'alta' | 'media';
      pattern: string;
      line?: number;
    }>;
  };
  resumenEjecutivo: string;
}

/** Job de sincronización. */
export interface SyncJob {
  id: string;
  repositoryId: string;
  type: SyncJobType;
  startedAt: string;
  finishedAt: string | null;
  status: SyncJobStatus;
  payload?: Record<string, unknown> | null;
  errorMessage: string | null;
}

/** DTO para crear repositorio (provider, projectKey, repoSlug; opcional projectId para multi-root). */
export interface CreateRepositoryDto {
  provider: 'bitbucket' | 'github';
  projectKey: string;
  repoSlug: string;
  defaultBranch?: string;
  credentialsRef?: string | null;
  webhookSecret?: string | null;
  /** ID del proyecto al que pertenece (multi-root). Si no se envía, se crea proyecto 1:1. */
  projectId?: string | null;
}

/** DTO para actualizar repositorio (defaultBranch, credentialsRef, webhookSecret, projectId). */
export interface UpdateRepositoryDto {
  defaultBranch?: string;
  credentialsRef?: string | null;
  webhookSecret?: string | null;
  projectId?: string | null;
}

/** Entidad credencial (token, app_password, webhook_secret). */
export interface Credential {
  id: string;
  provider: string;
  kind: string;
  name: string | null;
  extra?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/** DTO para crear credencial. */
export interface CreateCredentialDto {
  provider: 'bitbucket' | 'github';
  kind: 'token' | 'app_password' | 'webhook_secret';
  value: string;
  name?: string | null;
  extra?: Record<string, unknown> | null;
}

/** DTO para actualizar credencial (name, value, extra). */
export interface UpdateCredentialDto {
  value?: string;
  name?: string | null;
  extra?: Record<string, unknown> | null;
}

/** Hallazgo crítico de Full Audit. */
export interface CriticalFinding {
  hallazgo: string;
  impacto: string;
  esfuerzo: string;
  prioridad: 'critica' | 'alta' | 'media' | 'baja';
  categoria?: string;
  /** Path del archivo para localizar la corrección (ej. src/foo.ts) */
  path?: string;
  /** Línea en el archivo cuando aplica (ej. secreto expuesto) */
  line?: number;
  /** Nombre de función/clase cuando aplica */
  name?: string;
}

/** Resultado de Full Repo Audit. */
export interface FullAuditResult {
  executiveSummary: string;
  healthScore: number;
  topRisks: string[];
  techDebtEstimateHours: number;
  criticalFindings: CriticalFinding[];
  actionPlan: string[];
  arquitectura: {
    godObjects: Array<{ path: string; lineCount?: number; dependencyCount?: number; reason: string }>;
    circularImports: Array<[string, string]>;
    highComplexityFunctions: Array<{ path: string; name: string; complexity: number }>;
  };
  seguridad: {
    leakedSecrets: Array<{ path: string; severity: string; pattern: string; line?: number }>;
  };
  saludCodigo: {
    codigoMuerto: Array<{ path: string; category: string; exportsSummary?: string }>;
    duplicados: Array<{ a: string; b: string; score?: number }>;
  };
}
