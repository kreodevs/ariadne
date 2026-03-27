/**
 * Métricas Prometheus (Fase 0 observabilidad): chat, ingest, sync, parser.
 * GET /metrics en {@link MetricsController}.
 */
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

const disabled = process.env.METRICS_ENABLED === '0' || process.env.METRICS_ENABLED === 'false';

const register = new Registry();

if (!disabled) {
  collectDefaultMetrics({ register, prefix: 'ariadne_nodejs_' });
}

/** Duración pipeline unificado chat (retriever + sintetizador). */
export const chatPipelineDurationSeconds = disabled
  ? null
  : new Histogram({
      name: 'ariadne_chat_pipeline_duration_seconds',
      help: 'Duración del pipeline unificado de chat (repo o proyecto), en segundos.',
      labelNames: ['scope', 'two_phase'] as const,
      buckets: [0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300],
      registers: [register],
    });

/** Sin contexto de retrieval antes del sintetizador (contexto vacío). */
export const chatEmptyContextTotal = disabled
  ? null
  : new Counter({
      name: 'ariadne_chat_empty_retrieval_total',
      help: 'Chat donde no hubo contexto reunido (sin datos de herramientas) antes del sintetizador.',
      labelNames: ['scope', 'two_phase'] as const,
      registers: [register],
    });

/**
 * Respuesta citó paths que no están en el blob de retrieval (posible alucinación de rutas).
 * Solo cuenta si hubo al menos una cita de path y ratio &lt; umbral.
 */
export const chatLowPathGroundingTotal = disabled
  ? null
  : new Counter({
      name: 'ariadne_chat_low_path_grounding_total',
      help: 'Chat con citas de path en la respuesta pero fracción baja presente en retrieval (umbral 0.5).',
      labelNames: ['scope'] as const,
      registers: [register],
    });

export const chatPipelineErrorsTotal = disabled
  ? null
  : new Counter({
      name: 'ariadne_chat_pipeline_errors_total',
      help: 'Errores no manejados en chat (excepción antes de respuesta OK).',
      registers: [register],
    });

export const syncJobsFailedTotal = disabled
  ? null
  : new Counter({
      name: 'ariadne_ingest_sync_jobs_failed_total',
      help: 'Jobs de sync marcados failed (full sync o webhook).',
      labelNames: ['source'] as const,
      registers: [register],
    });

export const parseTruncatedTotal = disabled
  ? null
  : new Counter({
      name: 'ariadne_ingest_parse_truncated_total',
      help: 'Archivos parseados tras truncar (TRUNCATE_PARSE_MAX_BYTES / fallback).',
      registers: [register],
    });

export const parseFailedTotal = disabled
  ? null
  : new Counter({
      name: 'ariadne_ingest_parse_failed_total',
      help: 'Archivos donde parseSource devolvió null (fallo total tras fallbacks).',
      registers: [register],
    });

const GROUNDING_LOW_THRESHOLD = 0.5;

export function observeChatPipelineComplete(params: {
  durationSeconds: number;
  projectScope: boolean;
  useTwoPhase: boolean;
  gatheredContext: string;
  answer: string;
  collectedResults: unknown[];
}): void {
  if (disabled) return;
  const scope = params.projectScope ? 'project' : 'repo';
  const tp = params.useTwoPhase ? 'true' : 'false';
  chatPipelineDurationSeconds!.labels(scope, tp).observe(params.durationSeconds);

  const empty = !params.gatheredContext.trim();
  if (empty) {
    chatEmptyContextTotal!.labels(scope, tp).inc();
  }

  const pathLike = /\b[\w.-]+\/[\w./-]+\.(tsx?|jsx?|mjs|cjs)\b/g;
  const matches = params.answer.match(pathLike) ?? [];
  const unique = [...new Set(matches)];
  const retrievalBlob = `${params.gatheredContext}\n${JSON.stringify(params.collectedResults).slice(0, 80_000)}`;
  let hits = 0;
  for (const m of unique) {
    if (retrievalBlob.includes(m)) hits++;
  }
  const ratio = unique.length ? hits / unique.length : 1;
  if (unique.length > 0 && ratio < GROUNDING_LOW_THRESHOLD) {
    chatLowPathGroundingTotal!.labels(scope).inc();
  }
}

export function recordChatPipelineError(): void {
  if (!disabled) chatPipelineErrorsTotal!.inc();
}

export function recordSyncJobFailed(source: 'full_sync' | 'webhook'): void {
  if (!disabled) syncJobsFailedTotal!.labels(source).inc();
}

export function recordParseTruncated(): void {
  if (!disabled) parseTruncatedTotal!.inc();
}

export function recordParseFailed(): void {
  if (!disabled) parseFailedTotal!.inc();
}

export async function getMetricsText(): Promise<string> {
  return register.metrics();
}

export function isMetricsDisabled(): boolean {
  return disabled;
}
