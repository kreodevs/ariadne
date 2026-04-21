/**
 * Chat con el repositorio: NL → Cypher → FalkorDB.
 * Pipeline unificado: Retriever (Cypher + archivos + RAG) → Synthesizer (respuesta siempre humana).
 */

import { HttpException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FalkorDB } from 'falkordb';
import { IndexedFile } from '../repositories/entities/indexed-file.entity';
import { cypherSafe } from 'ariadne-common';
import { getFalkorConfig, graphNameForProject, isProjectShardingEnabled } from '../pipeline/falkor';
import { RepositoriesService } from '../repositories/repositories.service';
import { FileContentService } from '../repositories/file-content.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { EmbeddingSpaceService } from '../embedding/embedding-space.service';
import { hasIngestLlmConfigured } from './chat-llm-config';
import {
  SCHEMA,
  EXAMPLES,
  GENERIC_FUNCTION_NAMES,
  MAX_RISK_ITEMS,
  MAX_HIGH_COUPLING,
  MAX_NO_DESC,
  MAX_COMPONENT_PROPS,
  MAX_DUPLICATES,
  MAX_ANTIPATTERN_ITEMS,
  MAX_SUMMARY_CHARS,
  FULL_AUDIT_SECRET_PATTERNS,
  EXPLORER_TOOLS_ALL,
  truncateAntipatterns,
  getMaxAnalyzeCallEdges,
  wantsFullComponentListing,
  wantsFullGenericIndexedInventory,
} from './chat.constants';
import {
  computeRiskScore,
  groupDuplicates,
  formatDuplicatesSummary,
} from './chat-analysis.utils';
import { ChatCypherService } from './chat-cypher.service';
import { ChatLlmService } from './chat-llm.service';
import { ChatAntipatternsService } from './chat-antipatterns.service';
import { ChatHandlersService } from './chat-handlers.service';
import {
  ChatRetrieverToolsService,
  type RetrieverToolName,
  type RetrieverToolRequest,
} from './chat-retriever-tools.service';
import { ProjectsService } from '../projects/projects.service';
import {
  type ChatScope,
  filterCypherRowsByScope,
  hasExplicitChatScopeNarrowing,
  matchesChatScope,
} from './chat-scope.util';
import {
  resolveRepositoryIdForModificationPlan,
  type ModificationPlanDiagnostic,
  type ModificationPlanRepoInput,
} from './modification-plan-resolve.util';
import { modificationPlanPathExcludedByDefaults } from './modification-plan-path-exclusions.util';
import { modificationPlanScopeCypher } from './modification-plan-scope-cypher.util';
import {
  extractModificationPlanCypherTerms,
  expandModificationPlanTermPairs,
} from './modification-plan-terms.util';
import {
  extractLikelyRepoRelativePaths,
  prioritizeModificationPlanFiles,
} from './modification-plan-path-hints.util';
import { observeChatPipelineComplete, recordChatPipelineError } from '../metrics/ingest-metrics';
import {
  analyzeCacheDisabledFromEnv,
  analyzeCacheFullFingerprintMaxRows,
  analyzeCacheMaxEntries,
  analyzeCacheRedisTtlSec,
  analyzeCacheTtlMs,
  buildAnalyzeCacheKey,
  buildDiagnosticoExtrinsicLayerCacheKey,
  buildPartitionedIndexFingerprint,
  extrinsicLayerCacheDisabledFromEnv,
  extrinsicLayerCacheMaxEntries,
  extrinsicLayerCacheRedisTtlSec,
  extrinsicLayerCacheTtlMs,
  extrinsicLayerRedisDisabledFromEnv,
  hashDegradedIndexState,
  stableScopeKeyForCache,
  type DiagnosticoExtrinsicLayerPayload,
  type IndexRowForFingerprint,
} from './analyze-cache.util';
import {
  aggregateCallEdgesForScope,
  buildAnalyzeReportMeta,
  isAnalyzeScopeActive,
  pathFromPairLabel,
  pathInAnalyzeFocus,
  validateAnalyzeScope,
  type AnalyzeReportMeta,
  type CallEdgeRow,
  type FanInStats,
} from './analyze-focus.util';
import { AnalyzeDistributedCacheService } from './analyze-distributed-cache.service';
import {
  attachExtrinsicMetricsToRiskRows,
  buildDiagnosticoAntipatternsScoped,
  fetchDiagnosticoIntrinsicBase,
} from './diagnostico-intrinsic-layer';
import { appendDiagnosticoPathValidationFooter } from './diagnostico-validate.util';
import { stripOuterMarkdownFence } from './markdown-fence.util';
import {
  extractPathCandidatesForRepoResolve,
  filterCollectedResultsByTargetRepo,
  filterGatheredContextByTargetRepo,
  repoIdsInCollectedResults,
} from './chat-preflight-scope.util';
import {
  inferChatRepoScopeFromMessage,
  isChatRoleScopeInferenceEnabled,
  type ProjectRepoRoleCandidate,
} from './resolve-chat-scope-from-message.util';
import { buildMddEvidenceDocument } from './mdd-document.builder';
import { getMddPhysicalEvidenceLimits } from './mdd-limits';
import type { MddEvidenceDocument } from './mdd-document.types';

/** Mensaje del historial de chat (usuario o asistente). */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  cypher?: string;
  result?: unknown[];
}

/** Re-export para controladores y MCP. */
export type { ChatScope } from './chat-scope.util';
export type { MddEvidenceDocument } from './mdd-document.types';

/** Origen del alcance según cliente (telemetría, `CHAT_TELEMETRY_LOG`). */
export type ChatClientMetaScopeSource =
  | 'explicit'
  | 'mcp_default_repo'
  | 'mcp_path_prefix'
  | 'mcp_path_heuristic'
  | 'mcp_graph_repo_id'
  | 'mcp_wide'
  | 'ingest_role_message';

export interface ChatClientMeta {
  scopeSource?: ChatClientMetaScopeSource;
  scopeInferred?: boolean;
  scopePotentiallyAmbiguous?: boolean;
}

/** Payload para enviar un mensaje al chat. */
export interface ChatRequest {
  message: string;
  history?: ChatMessage[];
  /** Filtro multi-root: repoIds, prefijos de path, globs de exclusión. */
  scope?: ChatScope;
  /**
   * Si true: fase 2 del sintetizador usa primero un JSON de retrieval (§3 plan grounding).
   * Default: true si `process.env.CHAT_TWO_PHASE` es 1/true; si no definido, true en producción recomendado.
   */
  twoPhase?: boolean;
  /**
   * `evidence_first`: fuerza two-phase, amplía el recorte de contexto hacia el sintetizador y aplica prompt SDD
   * (## Evidencia obligatoria primero, listados anclados, poca prosa). Pensado para ask_codebase / The Forge legacy.
   * `raw_evidence`: sin sintetizador ni MDD — devuelve JSON con `gatheredContext` + `collectedResults` completos para que el cliente (p. ej. The Forge) sintetice; `get_file_content` usa recorte alto (`CHAT_RAW_EVIDENCE_FILE_MAX_CHARS`).
   */
  responseMode?: 'default' | 'evidence_first' | 'raw_evidence';
  /** Solo con `responseMode: 'raw_evidence'`: retrieval fijo (graph_summary → semantic_search → muestra de paths) sin ReAct LLM. */
  deterministicRetriever?: boolean;
  /** Reenviado al orchestrator cuando ORCHESTRATOR_URL está activo (Redis codebase:chat:*). */
  threadId?: string;
  /** Telemetría de alcance; no altera el pipeline. */
  clientMeta?: ChatClientMeta;
  /**
   * Proyecto multi-repo: si es `true` u omite, exige `scope` explícito o inferencia por roles (`CHAT_INFER_SCOPE_FROM_ROLES`).
   * `false` = chat amplio sobre todos los repos (riesgo de mezcla en el contexto).
   */
  strictChatScope?: boolean;
}

/** Respuesta del chat con texto, opcional cypher ejecutado y resultados. */
export interface ChatResponse {
  answer: string;
  cypher?: string;
  result?: unknown[];
  /** Presente en `responseMode: evidence_first` — JSON MDD de 7 secciones (LegacyCoordinator / Forge). */
  mddDocument?: MddEvidenceDocument;
}

/** Modo de preguntas de afinación en `get_modification_plan` (default: negocio). */
export type ModificationPlanQuestionsMode = 'business' | 'technical' | 'both';

/**
 * Plan de modificación para flujo legacy (ej. MaxPrime).
 * filesToModify: rutas que existen en el grafo con repoId (multi-root).
 */
export interface ModificationPlanResult {
  filesToModify: Array<{ path: string; repoId: string }>;
  questionsToRefine: string[];
  warnings?: string[];
  diagnostic?: ModificationPlanDiagnostic;
}

export type { ModificationPlanDiagnostic } from './modification-plan-resolve.util';

/** Modos de análisis estructurado (diagnóstico, duplicados, reingeniería, código muerto, seguridad, AGENTS.md, SKILL.md). */
export type AnalyzeMode =
  | 'diagnostico'
  | 'duplicados'
  | 'reingenieria'
  | 'codigo_muerto'
  | 'seguridad'
  | 'agents'
  | 'skill';

/** Resultado de un análisis (summary markdown + detalles opcionales). */
export interface AnalyzeResult {
  mode: AnalyzeMode;
  summary: string;
  details?: unknown;
  reportMeta?: AnalyzeReportMeta;
}

/** Opciones de `analyze`: alcance y flags por modo. */
export type AnalyzeRequestOptions = {
  scope?: ChatScope;
  /** Modo `duplicados`: pares con un solo extremo en el foco. */
  crossPackageDuplicates?: boolean;
};

export type { AnalyzeReportMeta } from './analyze-focus.util';

/** Payload hacia orchestrator tras /internal/.../analyze-prep (sin LLM en ingest). */
export type AnalyzeOrchestratorPrepDto =
  | { kind: 'complete'; result: AnalyzeResult }
  | {
      kind: 'llm';
      mode: AnalyzeMode;
      systemPrompt: string;
      userPrompt: string;
      maxTokens: number;
      details: unknown;
    };

/** Hallazgo crítico para Full Audit. */
export interface CriticalFinding {
  hallazgo: string;
  impacto: string;
  esfuerzo: string;
  prioridad: 'critica' | 'alta' | 'media' | 'baja';
  categoria?: string;
  path?: string;
  line?: number;
  name?: string;
}

/** Default: dos fases activas salvo `CHAT_TWO_PHASE=0|false|off`. */
function defaultTwoPhaseFromEnv(): boolean {
  const v = process.env.CHAT_TWO_PHASE?.trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off') return false;
  return true;
}

/** JSON de §3: anclar la redacción a paths/repoIds del retrieval. */
function buildRetrievalSummaryJson(collectedResults: unknown[], gatheredContext: string): string {
  const paths = new Set<string>();
  const repoIds = new Set<string>();
  for (const r of collectedResults) {
    if (r && typeof r === 'object') {
      const o = r as Record<string, unknown>;
      const p = o.path ?? o.fnPath ?? o.file;
      if (typeof p === 'string' && p.length) paths.add(p);
      const rid = o.repoId ?? o.repo_id;
      if (typeof rid === 'string' && rid.length) repoIds.add(rid);
    }
  }
  const ctxPaths = gatheredContext.match(/\b[\w.-]+\/[\w./-]+\.(tsx?|jsx?|mjs|cjs)\b/g) ?? [];
  for (const p of ctxPaths) paths.add(p);
  return JSON.stringify(
    {
      phase: 'retrieval_summary',
      topPaths: [...paths].slice(0, 120),
      repoIds: [...repoIds],
      structuredRowCount: collectedResults.length,
      instruction:
        'Prioriza citar rutas de topPaths; no inventes paths ni repos que no aparezcan aquí o en el contexto bruto.',
    },
    null,
    2,
  );
}

/** Métricas §7: fracción de paths en la respuesta que aparecen en retrieval (muestreo). */
function sampleHallucinationPathMetrics(
  answer: string,
  gatheredContext: string,
  collectedResults: unknown[],
): { pathCitationsUnique: number; pathGroundingHits: number; pathGroundingRatio: number } {
  const pathLike = /\b[\w.-]+\/[\w./-]+\.(tsx?|jsx?|mjs|cjs)\b/g;
  const matches = answer.match(pathLike) ?? [];
  const unique = [...new Set(matches)];
  const retrievalBlob = `${gatheredContext}\n${JSON.stringify(collectedResults).slice(0, 80_000)}`;
  let hits = 0;
  for (const m of unique) {
    if (retrievalBlob.includes(m)) hits++;
  }
  const ratio = unique.length ? hits / unique.length : 1;
  return {
    pathCitationsUnique: unique.length,
    pathGroundingHits: hits,
    pathGroundingRatio: Math.round(ratio * 1000) / 1000,
  };
}

/** Resultado de Full Repo Audit (auditoría de estado cero). */
export interface FullAuditResult {
  executiveSummary: string;
  healthScore: number; // 0-100
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

/**
 * Servicio de chat NL→Cypher y análisis de deuda técnica.
 * Usa OpenAI para generar Cypher y diagnósticos; FalkorDB para ejecutar queries.
 * @see docs/notebooklm/CHAT_Y_ANALISIS.md
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  private readonly analyzeResultCache = new Map<string, { storedAt: number; result: AnalyzeResult }>();
  private readonly diagnosticoExtrinsicLayerCache = new Map<
    string,
    { storedAt: number; payload: DiagnosticoExtrinsicLayerPayload }
  >();

  constructor(
    private readonly repos: RepositoriesService,
    private readonly fileContent: FileContentService,
    private readonly embedding: EmbeddingService,
    private readonly embeddingSpaces: EmbeddingSpaceService,
    private readonly cypher: ChatCypherService,
    private readonly llm: ChatLlmService,
    private readonly antipatterns: ChatAntipatternsService,
    private readonly handlers: ChatHandlersService,
    private readonly projects: ProjectsService,
    private readonly retrieverTools: ChatRetrieverToolsService,
    @InjectRepository(IndexedFile)
    private readonly indexedFileRepo: Repository<IndexedFile>,
    private readonly analyzeDistributedCache: AnalyzeDistributedCacheService,
  ) {}

  private async getIndexFingerprintForAnalyzeCache(
    repositoryId: string,
    lastCommitSha: string | null,
    scope: ChatScope | undefined,
  ): Promise<{ fingerprint: string; mode: 'full' | 'degraded'; scopePartitioned: boolean }> {
    const count = await this.indexedFileRepo.count({ where: { repositoryId } });
    if (count === 0) {
      return {
        fingerprint: hashDegradedIndexState({
          rowCount: 0,
          lastCommitSha,
          maxIndexedAt: null,
          minIndexedAt: null,
        }),
        mode: 'degraded',
        scopePartitioned: false,
      };
    }
    if (count > analyzeCacheFullFingerprintMaxRows()) {
      const raw = await this.indexedFileRepo
        .createQueryBuilder('f')
        .select('MAX(f.indexedAt)', 'max')
        .addSelect('MIN(f.indexedAt)', 'min')
        .where('f.repositoryId = :repositoryId', { repositoryId })
        .getRawOne<{ max: Date | null; min: Date | null }>();
      return {
        fingerprint: hashDegradedIndexState({
          rowCount: count,
          lastCommitSha,
          maxIndexedAt: raw?.max ?? null,
          minIndexedAt: raw?.min ?? null,
        }),
        mode: 'degraded',
        scopePartitioned: false,
      };
    }
    const rows = (await this.indexedFileRepo.find({
      where: { repositoryId },
      select: ['path', 'revision', 'indexedAt', 'contentHash'],
      order: { path: 'ASC' },
    })) as IndexRowForFingerprint[];
    const part = buildPartitionedIndexFingerprint(rows, scope, repositoryId);
    return {
      fingerprint: part.fingerprint,
      mode: 'full',
      scopePartitioned: part.scopePartitioned,
    };
  }

  private getAnalyzeCache(key: string): AnalyzeResult | undefined {
    const e = this.analyzeResultCache.get(key);
    if (!e) return undefined;
    if (Date.now() - e.storedAt > analyzeCacheTtlMs()) {
      this.analyzeResultCache.delete(key);
      return undefined;
    }
    return e.result;
  }

  private setAnalyzeCache(key: string, result: AnalyzeResult): void {
    const max = analyzeCacheMaxEntries();
    while (this.analyzeResultCache.size >= max) {
      const first = this.analyzeResultCache.keys().next().value as string | undefined;
      if (!first) break;
      this.analyzeResultCache.delete(first);
    }
    this.analyzeResultCache.set(key, { storedAt: Date.now(), result });
  }

  private getDiagnosticoExtrinsicLayerCache(key: string): DiagnosticoExtrinsicLayerPayload | undefined {
    const e = this.diagnosticoExtrinsicLayerCache.get(key);
    if (!e) return undefined;
    if (Date.now() - e.storedAt > extrinsicLayerCacheTtlMs()) {
      this.diagnosticoExtrinsicLayerCache.delete(key);
      return undefined;
    }
    return e.payload;
  }

  private setDiagnosticoExtrinsicLayerCache(key: string, payload: DiagnosticoExtrinsicLayerPayload): void {
    const max = extrinsicLayerCacheMaxEntries();
    while (this.diagnosticoExtrinsicLayerCache.size >= max) {
      const first = this.diagnosticoExtrinsicLayerCache.keys().next().value as string | undefined;
      if (!first) break;
      this.diagnosticoExtrinsicLayerCache.delete(first);
    }
    this.diagnosticoExtrinsicLayerCache.set(key, { storedAt: Date.now(), payload });
  }

  private mergeAnalyzeReportMeta(
    result: AnalyzeResult,
    extras: Partial<
      Pick<AnalyzeReportMeta, 'fromCache' | 'cacheFingerprintMode' | 'cacheScopePartitioned'>
    >,
  ): AnalyzeResult {
    const base: AnalyzeReportMeta = result.reportMeta ?? {
      scopeApplied: false,
      focusPrefixes: [],
      filesAnalyzedInFocus: 0,
      filesTotalInFocus: 0,
    };
    return {
      ...result,
      reportMeta: { ...base, ...extras },
    };
  }

  /** Bundle datos + prompts LLM para diagnóstico (sin llamar al modelo). */
  private async runDiagnosticoDataAndPrompts(
    repositoryId: string,
    scope?: ChatScope,
  ): Promise<{
    systemPrompt: string;
    userPrompt: string;
    detailsPayload: Record<string, unknown>;
    reportMeta: AnalyzeReportMeta;
    scopeActive: boolean;
    extrinsicCallsLayerCacheHit: boolean;
    extrinsicCallsLayerRedisHit: boolean;
  }> {
    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);
    const scopeActive = isAnalyzeScopeActive(scope);

    const intrinsic = await fetchDiagnosticoIntrinsicBase({
      projectId,
      repositoryId,
      scope,
      cypher: this.cypher,
      detectAntipatterns: (rid) => this.antipatterns.detectAntipatterns(rid),
    });
    const {
      allIndexedFilePaths,
      graphSummary,
      riskRankedCore,
      highCouplingScoped,
      noDescriptionScoped,
      componentPropsScoped,
      antipatternsRaw,
    } = intrinsic;

    let fanInByCalleeKey = new Map<string, FanInStats>();
    let outCallsOutsideFocusByCallerKey = new Map<string, number>();
    let callEdgesTruncated = false;
    let extrinsicCallsLayerCacheHit = false;
    let extrinsicCallsLayerRedisHit = false;
    if (scopeActive) {
      const edgeLimit = getMaxAnalyzeCallEdges();
      const lastSha = repo.lastCommitSha ?? null;
      const { fingerprint: indexFp } = await this.getIndexFingerprintForAnalyzeCache(
        repositoryId,
        lastSha,
        scope,
      );
      const layerKey = buildDiagnosticoExtrinsicLayerCacheKey({
        repositoryId,
        scopeKey: stableScopeKeyForCache(scope),
        indexFingerprint: indexFp,
        edgeLimit,
      });

      const applyLayerPayload = (p: DiagnosticoExtrinsicLayerPayload, fromRedis: boolean) => {
        fanInByCalleeKey = new Map(p.fanInEntries);
        outCallsOutsideFocusByCallerKey = new Map(p.outCallsOutsideEntries);
        callEdgesTruncated = p.callEdgesTruncated;
        extrinsicCallsLayerCacheHit = true;
        if (fromRedis) extrinsicCallsLayerRedisHit = true;
      };

      if (!extrinsicLayerCacheDisabledFromEnv()) {
        const memHit = this.getDiagnosticoExtrinsicLayerCache(layerKey);
        if (memHit) {
          applyLayerPayload(memHit, false);
        } else if (
          !extrinsicLayerRedisDisabledFromEnv() &&
          this.analyzeDistributedCache.isEnabled()
        ) {
          const rawRedis = await this.analyzeDistributedCache.getJson(layerKey);
          if (rawRedis) {
            try {
              const parsed = JSON.parse(rawRedis) as DiagnosticoExtrinsicLayerPayload;
              if (parsed && Array.isArray(parsed.fanInEntries) && Array.isArray(parsed.outCallsOutsideEntries)) {
                applyLayerPayload(parsed, true);
                this.setDiagnosticoExtrinsicLayerCache(layerKey, parsed);
              }
            } catch {
              /* ignore */
            }
          }
        }
      }

      if (!extrinsicCallsLayerCacheHit) {
        const rawCallEdges = (await this.cypher.executeCypher(
          projectId,
          `MATCH (a:Function)-[:CALLS]->(b:Function) WHERE a.projectId = $projectId AND b.projectId = $projectId
           AND a.repoId = $repoId AND b.repoId = $repoId
           RETURN a.path as fromPath, a.name as fromName, b.path as toPath, b.name as toName
           LIMIT ${edgeLimit}`,
          { repoId: repositoryId },
        )) as CallEdgeRow[];
        callEdgesTruncated = rawCallEdges.length >= edgeLimit;
        const agg = aggregateCallEdgesForScope(rawCallEdges, scope, repo.id);
        fanInByCalleeKey = agg.fanInByCalleeKey;
        outCallsOutsideFocusByCallerKey = agg.outCallsOutsideFocusByCallerKey;

        if (!extrinsicLayerCacheDisabledFromEnv()) {
          const payload: DiagnosticoExtrinsicLayerPayload = {
            fanInEntries: [...fanInByCalleeKey.entries()],
            outCallsOutsideEntries: [...outCallsOutsideFocusByCallerKey.entries()],
            callEdgesTruncated,
          };
          this.setDiagnosticoExtrinsicLayerCache(layerKey, payload);
          if (!extrinsicLayerRedisDisabledFromEnv() && this.analyzeDistributedCache.isEnabled()) {
            await this.analyzeDistributedCache.setJson(
              layerKey,
              JSON.stringify(payload),
              extrinsicLayerCacheRedisTtlSec(),
            );
          }
        }
      }
    }

    let riskRanked = attachExtrinsicMetricsToRiskRows(
      riskRankedCore,
      scopeActive,
      fanInByCalleeKey,
      outCallsOutsideFocusByCallerKey,
    );

    const antipatterns = await buildDiagnosticoAntipatternsScoped({
      projectId,
      repositoryId: repo.id,
      scope,
      scopeActive,
      antipatternsRaw,
      fanInByCalleeKey,
      executeCypher: this.cypher.executeCypher.bind(this.cypher),
    });

    const riskTrunc = riskRanked.slice(0, MAX_RISK_ITEMS);
    const couplingTrunc = highCouplingScoped.slice(0, MAX_HIGH_COUPLING);
    const noDescTrunc = noDescriptionScoped.slice(0, MAX_NO_DESC);
    const propsTrunc = componentPropsScoped.slice(0, MAX_COMPONENT_PROPS);

    const scopeDisclaimer = scopeActive
      ? `
- **Alcance (foco):** el fan-in/inCalls incluye llamadas desde **todo** el grafo indexado del repo; columnas inCallsInsideFocus / inCallsOutsideFocus y sampleCallersOutsideFocus explican riesgo global vs local. Un outCallsOutsideFocus > 0 indica dependencias salientes hacia rutas fuera del prefijo.
- **Código / imports:** un símbolo puede ser “seguro” en el foco y aun así consumido desde otras apps o paquetes; no interpretes el foco como aislamiento de runtime.
`
      : '';

    const context = `
Estadísticas del proyecto ${repo.projectKey}/${repo.repoSlug}:
- Nodos indexados: ${JSON.stringify(graphSummary.counts)}
${scopeDisclaimer}
- **Riesgo** (ordenado por riskScore descendente, top ${MAX_RISK_ITEMS}): ${JSON.stringify(riskTrunc)}${riskRanked.length > MAX_RISK_ITEMS ? `\n  (+ ${riskRanked.length - MAX_RISK_ITEMS} más en details)` : ''}
- Funciones con alto acoplamiento (más de 5 llamadas salientes): ${JSON.stringify(couplingTrunc)}
- Funciones sin JSDoc/descripción: ${JSON.stringify(noDescTrunc)}${noDescriptionScoped.length > MAX_NO_DESC ? ` (+ ${noDescriptionScoped.length - MAX_NO_DESC} más)` : ''}
- Componentes con muchas props (>5): ${JSON.stringify(propsTrunc)}
- **Anti-patrones y malas prácticas:** ${JSON.stringify(truncateAntipatterns(antipatterns))}
${callEdgesTruncated ? `\n\u26a0\ufe0f Aristas CALLS truncadas a ${getMaxAnalyzeCallEdges()}; fan-in/fan-out parciales.` : ''}

Métricas estándar: acoplamiento (CALLS), complejidad ciclomática (McCabe), LOC, documentación, anidamiento.
`;

    const systemPrompt = `<rol>Arquitecto senior que analiza DEUDA TÉCNICA. \u00danica fuente de verdad: datos JSON.</rol>

<cot>Pensemos paso a paso: 1) Revisar métricas y conteos. 2) Priorizar por riskScore y antipatrones. 3) Generar acciones concretas.</cot>

<glosario_para_desarrolladores>
Antes de cada **tabla o lista sustancial** de una categoría, escribe un párrafo corto (2-5 líneas) para que el lector entienda la métrica y qué vigilar. Puedes condensar estas definiciones (no inventes otras):

- **Riesgo (riskScore):** Puntuación del índice: \`outCalls×3 + complejidad_ciclomática×2 + penalización si no hay JSDoc + penalización por LOC\`. Valores altos = más coste y riesgo al cambiar la función (más dependencias salientes, ramas, líneas o falta de documentación).
- **Alto acoplamiento (outCalls en la lista del grafo):** Cuántas **otras funciones** llama esta función (aristas CALLS salientes). Aquí se listan las que superan el umbral del análisis (más de 5 llamadas salientes): orquestadores frágiles ante cambios en dependencias.
- **Funciones sin JSDoc:** Sin \`description\` en el nodo Function; dificulta mantenimiento y onboarding y empeora el término de riesgo.
- **Componentes con muchas props (>5):** Muchas props en el modelo del grafo sugiere superficie de API ancha y acoplamiento en la UI.
- **Spaghetti (nestingDepth):** Profundidad de anidamiento en el AST; umbral de detección **>4**. Por encima, flujo difícil de seguir y testear.
- **God function:** \`outCalls > 8\` — llama a demasiadas funciones; concentra lógica.
- **High fan-in:** \`inCalls > 5\` — muchas funciones llaman a esta; cambios impactan muchos call sites.
- **Imports circulares / componentes sobrecargados:** Si aparecen en datos, explica brevemente el riesgo (dependencias cíclicas o demasiados hijos renderizados).
</glosario_para_desarrolladores>

<instrucciones>
- Deriva TODO de los datos. Cada ítem debe referenciar path/name concreto.
- Métricas estándar: acoplamiento (CALLS), complejidad, LOC, documentación, anidamiento.
- PROHIBIDO inventar problemas genéricos sin soporte. PROHIBIDO incluir antipatrones con arrays vacíos.
- Si una sección tiene datos, **no** saltes el párrafo pedagógico del glosario antes de tabla o lista.
</instrucciones>

<formato_salida>Markdown con bullet points y tablas. NO envuelvas la respuesta completa en un bloque de código (triple comilla + markdown); escribe el markdown directo desde el primer encabezado.</formato_salida>`;

    const prefill =
      riskRanked.length > 0
        ? `Riesgos (${riskRanked.length}): ${riskRanked.slice(0, 5).map((r) => `${r.path}/${r.name}(${r.riskScore})`).join(', ')}${riskRanked.length > 5 ? `… y ${riskRanked.length - 5} más. ` : '. '}`
        : '';
    const prefillDesc =
      noDescriptionScoped.length > 0 ? `Funciones sin JSDoc: ${noDescriptionScoped.length} ítems. ` : '';
    const prefillAntip =
      antipatterns.spaghetti.length + antipatterns.godFunctions.length > 0
        ? `Quick wins potenciales: antipatrones Spaghetti/GodFunctions detectados. `
        : '';

    const userPrompt = `${context}

<prefill>${prefill}${prefillDesc}${prefillAntip}</prefill>

Genera un diagnóstico estructurado en markdown con:
1. **Resumen ejecutivo** — 2-4 líneas basadas SOLO en los conteos y métricas mostradas (opcional: una línea sobre qué resume este informe respecto al grafo indexado).
2. **Riesgo (ordenado por riskScore)** — **Primero** el párrafo pedagógico sobre qué es riskScore y cómo interpretarlo. **Después** tabla con TODOS los ítems: Path | Name | Risk Score | (opcional: columnas útiles del JSON: outCalls, complexity, loc si aportan).
3. **Alto acoplamiento** — solo si hay datos en "Funciones con alto acoplamiento": párrafo pedagógico (outCalls salientes, umbral >5) y tabla o lista con path, name, outCalls.
4. **Funciones sin JSDoc** — solo si hay datos: párrafo pedagógico y lista/tabla con path y name (todos los ítems mostrados en JSON).
5. **Componentes con muchas props** — solo si hay datos: párrafo pedagógico y lista con componente y propCount.
6. **Anti-patrones detectados** — párrafo introductorio general; luego SOLO subsecciones con datos no vacíos. Antes de cada subsección (Spaghetti, God Functions, High Fan In, etc.), una línea o dos del glosario. OBLIGATORIO la MÉTRICA en cada ítem:
   - **Spaghetti:** \`path/name (nestingDepth: N)\` — umbral de listado: nestingDepth > 4 en el grafo.
   - **God Functions:** \`path/name (outCalls: N)\` — umbral > 8.
   - **High Fan In:** \`path/name (inCalls: N)\` — umbral > 5.
   - Imports circulares / componentes sobrecargados: solo si vienen en datos.
7. **Riesgos y prioridades** — síntesis breve basada solo en métricas; sin consejos genéricos. Párrafo introductorio opcional de 1-2 líneas sobre cómo leer las prioridades frente a las tablas anteriores.

Sé conciso en los párrafos pedagógicos. Usa bullet points y tablas. Incluye TODOS los ítems de los datos en las tablas y listas. Omite secciones 3–5 si el JSON correspondiente está vacío.`;

    const detailsPayload = {
      riskRanked,
      highCoupling: highCouplingScoped,
      noDescription: noDescriptionScoped,
      componentProps: componentPropsScoped,
      antipatterns,
      scopeActive,
      callEdgesTruncated,
    };

    const reportMeta = buildAnalyzeReportMeta({
      scope,
      repositoryId: repo.id,
      allIndexedFilePaths,
      truncatedFiles: callEdgesTruncated,
    });
    if (scopeActive && extrinsicCallsLayerCacheHit) {
      reportMeta.extrinsicCallsLayerCacheHit = true;
    }
    if (scopeActive && extrinsicCallsLayerRedisHit) {
      reportMeta.extrinsicCallsLayerRedisHit = true;
    }
    if (callEdgesTruncated) {
      const edgeNote = `Aristas CALLS limitadas a ${getMaxAnalyzeCallEdges()}; fan-in/fan-out pueden ser parciales.`;
      reportMeta.graphCoverageNote = reportMeta.graphCoverageNote
        ? `${reportMeta.graphCoverageNote} ${edgeNote}`
        : edgeNote;
    }

    return {
      systemPrompt,
      userPrompt,
      detailsPayload,
      reportMeta,
      scopeActive,
      extrinsicCallsLayerCacheHit,
      extrinsicCallsLayerRedisHit,
    };
  }

  /** Proyecto a usar para un repo: primer proyecto asociado o repo.id (standalone). */
  private async resolveProjectIdForRepo(repoId: string): Promise<string> {
    const ids = await this.repos.getProjectIdsForRepo(repoId);
    return ids[0] ?? repoId;
  }

  private async resolveModificationPlanRepositoryId(
    projectIdOrRepoId: string,
    scope?: ChatScope,
    currentFilePath?: string | null,
  ): Promise<
    | { ok: true; repositoryId: string }
    | { ok: false; diagnostic: ModificationPlanDiagnostic }
  > {
    const reposAsProject = await this.repos.findAll(projectIdOrRepoId);
    if (reposAsProject.length > 0) {
      const roleById = new Map<string, string | null>();
      try {
        const pw = await this.projects.findOne(projectIdOrRepoId);
        for (const r of pw.repositories) {
          roleById.set(r.id, r.role ?? null);
        }
      } catch {
        /* no es fila en projects o proyecto inexistente */
      }
      const reposForResolve: ModificationPlanRepoInput[] = reposAsProject.map((r) => ({
        id: r.id,
        projectKey: r.projectKey,
        repoSlug: r.repoSlug,
        role: roleById.get(r.id) ?? null,
      }));
      return resolveRepositoryIdForModificationPlan(projectIdOrRepoId, reposForResolve, {
        scope,
        currentFilePath: currentFilePath ?? null,
        resolveWorkspacePath: (pid, path) => this.projects.resolveRepositoryForWorkspacePath(pid, path),
      });
    }
    const asRepo = await this.repos.findOptionalById(projectIdOrRepoId);
    if (asRepo) {
      return { ok: true, repositoryId: asRepo.id };
    }
    return {
      ok: false,
      diagnostic: {
        code: 'NOT_FOUND',
        message: 'No existe un proyecto ni un repositorio con este UUID.',
      },
    };
  }

  /** Resumen de lo indexado en FalkorDB. full=true (default) devuelve todos los ítems (sin LIMIT); full=false: muestras estratificadas. repoScoped acota nodos al repo indicado (mismo projectId Falkor). */
  async getGraphSummary(repositoryId: string, full = true, repoScoped = false): Promise<{
    counts: Record<string, number>;
    samples: Record<string, unknown[]>;
  }> {
    return this.cypher.getGraphSummary(repositoryId, full, repoScoped);
  }

  /**
   * Plan de modificación por proyecto Ariadne o por repo concreto (multi-root).
   * Proyecto multi-root: ancla por `scope.repoIds` (un uuid), `currentFilePath` resoluble, o `MODIFICATION_PLAN_LEGACY_FIRST_REPO=true`.
   */
  async getModificationPlanByProject(
    projectIdOrRepoId: string,
    userDescription: string,
    scope?: ChatScope,
    currentFilePath?: string | null,
    questionsMode?: ModificationPlanQuestionsMode,
  ): Promise<ModificationPlanResult> {
    const orch = process.env.ORCHESTRATOR_URL?.trim();
    if (orch && userDescription.trim()) {
      try {
        const url = `${orch.replace(/\/$/, '')}/codebase/modification-plan/project/${encodeURIComponent(projectIdOrRepoId)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userDescription,
            scope,
            ...(currentFilePath ? { currentFilePath } : {}),
            ...(questionsMode ? { questionsMode } : {}),
          }),
        });
        if (!res.ok) throw new Error(`orchestrator ${res.status}: ${await res.text()}`);
        return (await res.json()) as ModificationPlanResult;
      } catch {
        /* fallback local */
      }
    }

    const resolved = await this.resolveModificationPlanRepositoryId(
      projectIdOrRepoId,
      scope,
      currentFilePath,
    );
    if (!resolved.ok) {
      return { filesToModify: [], questionsToRefine: [], diagnostic: resolved.diagnostic };
    }
    return this.getModificationPlan(resolved.repositoryId, userDescription, scope, questionsMode);
  }

  /**
   * Solo archivos a tocar (grafo), sin LLM. Para orchestrator / internal.
   */
  async getModificationPlanFilesOnly(
    repositoryId: string,
    userDescription: string,
    scope?: ChatScope,
  ): Promise<Array<{ path: string; repoId: string }>> {
    return this.collectModificationPlanFiles(repositoryId, userDescription, scope);
  }

  async getModificationPlanFilesOnlyByProject(
    projectIdOrRepoId: string,
    userDescription: string,
    scope?: ChatScope,
    currentFilePath?: string | null,
  ): Promise<Array<{ path: string; repoId: string }>> {
    const resolved = await this.resolveModificationPlanRepositoryId(
      projectIdOrRepoId,
      scope,
      currentFilePath,
    );
    if (!resolved.ok) return [];
    return this.collectModificationPlanFiles(resolved.repositoryId, userDescription, scope);
  }

  /** Candidatos (path, repoId) desde Cypher + semántica; respeta MODIFICATION_PLAN_MAX_FILES y scope. */
  private async collectModificationPlanFiles(
    repositoryId: string,
    userDescription: string,
    scope?: ChatScope,
  ): Promise<Array<{ path: string; repoId: string }>> {
    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);
    const sc = modificationPlanScopeCypher(scope);
    const scopeParams = sc.params;

    const indexedRows = (await this.cypher.executeCypher(
      projectId,
      `MATCH (f:File) WHERE f.projectId = $projectId${sc.fileClause} RETURN f.path as path, coalesce(f.repoId, f.projectId) as repoId`,
      { ...scopeParams },
    )) as Array<{ path: string; repoId: string }>;

    const candidatePathRepoSet = new Set<string>();
    const addIfScoped = (path: string, repoId: string) => {
      if (modificationPlanPathExcludedByDefaults(path)) return;
      if (!scope || matchesChatScope(path, repoId, scope)) {
        candidatePathRepoSet.add(`${path}\t${repoId}`);
      }
    };

    const cypherTerms = extractModificationPlanCypherTerms(userDescription);
    const termPairs = expandModificationPlanTermPairs(cypherTerms);

    for (const term of termPairs) {
      const filesByPath = (await this.cypher.executeCypher(
        projectId,
        `MATCH (f:File) WHERE f.projectId = $projectId${sc.fileClause} AND (f.path CONTAINS $term) RETURN f.path as path, coalesce(f.repoId, f.projectId) as repoId`,
        { ...scopeParams, term },
      )) as Array<{ path: string; repoId: string }>;
      filesByPath.forEach((r) => addIfScoped(r.path, r.repoId));

      const filesByComponent = (await this.cypher.executeCypher(
        projectId,
        `MATCH (f:File)-[:CONTAINS]->(c:Component) WHERE f.projectId = $projectId AND c.projectId = $projectId${sc.fileClause} AND (c.name CONTAINS $term) RETURN f.path as path, coalesce(f.repoId, f.projectId) as repoId`,
        { ...scopeParams, term },
      )) as Array<{ path: string; repoId: string }>;
      filesByComponent.forEach((r) => addIfScoped(r.path, r.repoId));

      const filesByFunction = (await this.cypher.executeCypher(
        projectId,
        `MATCH (fn:Function) WHERE fn.projectId = $projectId${sc.fnClause} AND (fn.path CONTAINS $term OR fn.name CONTAINS $term) RETURN fn.path as path, coalesce(fn.repoId, fn.projectId) as repoId`,
        { ...scopeParams, term },
      )) as Array<{ path: string; repoId: string }>;
      filesByFunction.forEach((r) => addIfScoped(r.path, r.repoId));
    }

    const semantic = await this.handlers.semanticSearchFallback(
      projectId,
      userDescription,
      25,
      repositoryId,
      undefined,
    );
    for (const row of semantic.result as Array<{ path?: string; name?: string; tipo?: string; repoId?: string }>) {
      const p = row.path;
      if (
        p &&
        (p.includes('/') ||
          p.endsWith('.ts') ||
          p.endsWith('.tsx') ||
          p.endsWith('.js') ||
          p.endsWith('.jsx') ||
          p.endsWith('.mdx') ||
          p.endsWith('.md'))
      ) {
        if (row.repoId) {
          addIfScoped(p, String(row.repoId));
        } else {
          indexedRows.filter((r) => r.path === p).forEach((r) => addIfScoped(r.path, r.repoId));
        }
      }
      if (row.tipo === 'Component' && row.name) {
        const fileRows = (await this.cypher.executeCypher(
          projectId,
          `MATCH (f:File)-[:CONTAINS]->(c:Component {name: $name, projectId: $projectId}) WHERE f.projectId = $projectId${sc.fileClause} RETURN f.path as path, coalesce(f.repoId, f.projectId) as repoId LIMIT 5`,
          { ...scopeParams, name: row.name, projectId },
        )) as Array<{ path: string; repoId: string }>;
        fileRows.forEach((r) => addIfScoped(r.path, r.repoId));
      }
    }

    const sortedFull = indexedRows
      .filter((r) => candidatePathRepoSet.has(`${r.path}\t${r.repoId}`))
      .map((r) => ({ path: r.path, repoId: r.repoId }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.repoId.localeCompare(b.repoId));
    const restrictRepos = scope?.repoIds?.length ? new Set(scope.repoIds) : new Set([repositoryId]);
    let filesToModify = sortedFull.filter((f) => restrictRepos.has(f.repoId));
    if (scope) {
      filesToModify = filesToModify.filter((f) => matchesChatScope(f.path, f.repoId, scope));
    }
    return filesToModify;
  }

  private async buildModificationPlanQuestionsToRefine(
    userDescription: string,
    filesToModify: Array<{ path: string; repoId: string }>,
    questionsMode: ModificationPlanQuestionsMode,
  ): Promise<string[]> {
    if (!hasIngestLlmConfigured()) return [];
    const mode = questionsMode;
    const businessSystem = `Eres un analista que genera preguntas para afinar un cambio en el software.
Regla: SOLO preguntas de negocio o funcionalidad: valores por defecto, reglas de validación, criterios de negocio, umbrales, opciones permitidas.
PROHIBIDO: preguntas como "¿hay otros componentes a considerar?", "¿qué más archivos?", "¿otras dependencias?". La lista de archivos ya es exhaustiva; no preguntes por exhaustividad.
Formato: devuelve una lista numerada, una pregunta por línea. Si no hay preguntas relevantes, devuelve "Ninguna.".
Máximo 5 preguntas. En español.`;
    const technicalSystem = `Eres un analista que genera preguntas **técnicas** para afinar un refactor o migración (dependencias, convenciones de código, orden de cambios, pruebas, compatibilidad).
Regla: SOLO preguntas técnicas: versiones de librerías, orden de migración, estrategia de reemplazo, impacto en build/bundler/linter, tokens CSS, convenciones del monorepo, tests o snapshots a actualizar.
PROHIBIDO: preguntas de reglas de negocio del dominio ni "¿qué más archivos buscar?".
Formato: lista numerada, una pregunta por línea. Si no aplica, devuelve "Ninguna.".
Máximo 5. En español.`;
    const bothSystem = `Eres un analista que genera preguntas para afinar un cambio.
Genera como máximo 3 preguntas de **negocio/funcionalidad** (valores por defecto, reglas de validación, umbrales) y hasta 3 de **implementación técnica** (dependencias, convenciones, orden de migración, tests).
Formato: lista numerada. Si un bloque no aplica, escribe una línea con "Negocio: Ninguna." o "Técnico: Ninguna.".
Máximo 6 líneas útiles. En español.`;
    const systemPrompt =
      mode === 'technical' ? technicalSystem : mode === 'both' ? bothSystem : businessSystem;
    const userTail =
      mode === 'technical'
        ? 'Genera solo preguntas técnicas de implementación para afinar el cambio.'
        : mode === 'both'
          ? 'Genera el mix negocio + técnico indicado en el sistema.'
          : 'Genera solo preguntas de negocio/funcionalidad para afinar el cambio (valores por defecto, reglas, criterios).';
    const userPrompt = `Descripción del cambio que el usuario quiere hacer:\n\n"${userDescription.slice(0, 800)}"\n\nArchivos que se van a modificar (ya determinados): ${filesToModify.slice(0, 20).map((f) => f.path).join(', ')}${filesToModify.length > 20 ? '...' : ''}\n\n${userTail}`;
    const raw = await this.llm.callLlm(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      512,
    );
    const minLine = mode === 'both' ? 6 : 10;
    const lines = raw
      .split(/\n+/)
      .map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim())
      .filter(
        (l) =>
          l.length > minLine &&
          !/^ninguna\.?$/i.test(l) &&
          !/^negocio:\s*ninguna\.?$/i.test(l) &&
          !/^t[eé]cnico:\s*ninguna\.?$/i.test(l),
      );
    return lines.slice(0, mode === 'both' ? 6 : 5);
  }

  async getModificationPlan(
    repositoryId: string,
    userDescription: string,
    scope?: ChatScope,
    questionsMode?: ModificationPlanQuestionsMode,
  ): Promise<ModificationPlanResult> {
    const orch = process.env.ORCHESTRATOR_URL?.trim();
    if (orch && userDescription.trim()) {
      try {
        const url = `${orch.replace(/\/$/, '')}/codebase/modification-plan/repository/${encodeURIComponent(repositoryId)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userDescription,
            scope,
            ...(questionsMode ? { questionsMode } : {}),
          }),
        });
        if (!res.ok) throw new Error(`orchestrator ${res.status}: ${await res.text()}`);
        return (await res.json()) as ModificationPlanResult;
      } catch {
        /* fallback local */
      }
    }

    if (!userDescription.trim()) {
      return { filesToModify: [], questionsToRefine: [] };
    }
    const qm: ModificationPlanQuestionsMode =
      questionsMode === 'technical' || questionsMode === 'both' ? questionsMode : 'business';
    const maxPlanFiles = (() => {
      const raw = process.env.MODIFICATION_PLAN_MAX_FILES?.trim();
      const n = raw ? parseInt(raw, 10) : 150;
      if (!Number.isFinite(n) || n < 1) return 150;
      return Math.min(n, 2000);
    })();

    const filesFull = await this.collectModificationPlanFiles(repositoryId, userDescription, scope);
    const totalBeforeCap = filesFull.length;
    let filesToModify = filesFull.slice(0, maxPlanFiles);
    const pathHints = extractLikelyRepoRelativePaths(userDescription);
    filesToModify = prioritizeModificationPlanFiles(filesToModify, pathHints);

    const warnings: string[] = [];
    if (totalBeforeCap > maxPlanFiles) {
      warnings.push(
        `Lista truncada: ${totalBeforeCap} archivos candidatos coincidían con la descripción y el alcance; se devolvieron ${maxPlanFiles} (MODIFICATION_PLAN_MAX_FILES). Acota scope.includePathPrefixes o userDescription para menos ruido.`,
      );
    }

    let diagnostic: ModificationPlanDiagnostic | undefined;
    if (filesToModify.length === 0) {
      diagnostic = {
        code: 'NO_MATCHING_FILES',
        message:
          'Ningún archivo indexado coincide con la descripción y el alcance. Revisa términos, scope.repoIds / includePathPrefixes, embed-index o pasa una descripción más concreta (p. ej. path relativo al repo).',
      };
    }

    let questionsToRefine: string[] = [];
    if (filesToModify.length > 0) {
      questionsToRefine = await this.buildModificationPlanQuestionsToRefine(
        userDescription,
        filesToModify,
        qm,
      );
    }

    return {
      filesToModify,
      questionsToRefine,
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(diagnostic ? { diagnostic } : {}),
    };
  }

  /** Diagnóstico de deuda técnica (scope opcional; validación de paths vía `DIAGNOSTICO_VALIDATE_PATHS`). */
  async analyzeDiagnostico(repositoryId: string, scope?: ChatScope): Promise<AnalyzeResult> {
    const bundle = await this.runDiagnosticoDataAndPrompts(repositoryId, scope);
    const answer = await this.llm.callLlm(
      [{ role: 'system', content: bundle.systemPrompt }, { role: 'user', content: bundle.userPrompt }],
      8192,
    );
    let summary = stripOuterMarkdownFence(answer);
    if (process.env.DIAGNOSTICO_VALIDATE_PATHS?.trim() !== '0') {
      summary = appendDiagnosticoPathValidationFooter(summary, bundle.detailsPayload);
    }
    return {
      mode: 'diagnostico',
      summary,
      details: bundle.detailsPayload,
      reportMeta: bundle.reportMeta,
    };
  }

  /** Detecta anti-patrones, malas prácticas y código spaguetti. */
  async detectAntipatterns(repositoryId: string): Promise<{
    spaghetti: Array<{ path: string; name: string; nestingDepth: number; complexity: number; loc: number }>;
    godFunctions: Array<{ path: string; name: string; outCalls: number }>;
    highFanIn: Array<{ path: string; name: string; inCalls: number }>;
    circularImports: Array<[string, string]>;
    overloadedComponents: Array<{ name: string; renderCount: number }>;
  }> {
    return this.antipatterns.detectAntipatterns(repositoryId);
  }

  /** Detecta código potencialmente duplicado: embeddings (umbral 0.78) + fallback nombres idénticos en archivos distintos. Sin límite de funciones a analizar. */
  async analyzeDuplicados(
    repositoryId: string,
    threshold = 0.78,
    limit = 0,
    scope?: ChatScope,
    crossPackageDuplicates = false,
  ): Promise<AnalyzeResult> {
    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);
    const inF = (p: string) => pathInAnalyzeFocus(p, scope, repo.id);
    const scopeActive = isAnalyzeScopeActive(scope);

    const allFilesRows = (await this.cypher.executeCypher(
      projectId,
      `MATCH (f:File) WHERE f.projectId = $projectId AND f.repoId = $repoId RETURN f.path as path ORDER BY f.path`,
      { repoId: repositoryId },
    )) as Array<{ path: string }>;
    const allIndexedFilePaths = allFilesRows.map((r) => r.path);

    const structuralRows = (await this.cypher.executeCypher(
      projectId,
      `MATCH (a:Function) WHERE a.projectId = $projectId AND a.repoId = $repoId
       WITH a.name as name, collect(DISTINCT a.path) as paths
       WHERE size(paths) > 1
       UNWIND paths as p1 UNWIND paths as p2
       WITH name, p1, p2 WHERE p1 < p2
       RETURN p1 as pathA, name, p2 as pathB`,
      { repoId: repositoryId },
    )) as Array<{ pathA: string; name: string; pathB: string }>;
    const structuralPairs = structuralRows.filter((r) => !GENERIC_FUNCTION_NAMES.has(r.name.toLowerCase()));
    const structuralForScope = scopeActive
      ? structuralPairs.filter((r) => inF(r.pathA) && inF(r.pathB))
      : structuralPairs;
    const sameNamePairs = structuralForScope.map((r) => ({
      a: `${r.pathA}::${r.name}`,
      b: `${r.pathB}::${r.name}`,
      score: 1,
    }));

    let semanticPairs: Array<{ a: string; b: string; score: number }> = [];
    const readBinding = await this.embeddingSpaces.getReadBindingForRepository(repositoryId);
    const embedForRead = readBinding.provider;
    const vProp = readBinding.graphProperty;
    if (embedForRead?.isAvailable()) {
      const config = getFalkorConfig();
      const client = await FalkorDB.connect({ socket: { host: config.host, port: config.port } });
      const graph = client.selectGraph(
        graphNameForProject(isProjectShardingEnabled() ? projectId : undefined),
      );

      const limitClause = limit > 0 ? ` LIMIT ${limit}` : '';
      const funcsRes = (await graph.query(
        `MATCH (n:Function) WHERE n.projectId = $projectId AND n.repoId = $repoId AND n.${vProp} IS NOT NULL RETURN n.path AS path, n.name AS name, n.description AS description, n.startLine AS startLine, n.endLine AS endLine${limitClause}`,
        { params: { projectId, repoId: repositoryId } },
      )) as { data?: unknown[] };
      const rawRows = funcsRes?.data ?? [];
      let funcs = rawRows.map((row): { path: string; name: string; description?: string | null; startLine?: number; endLine?: number } => {
        const arr = Array.isArray(row) ? row : [row];
        const r = typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {};
        return {
          path: String(r.path ?? arr[0] ?? ''),
          name: String(r.name ?? arr[1] ?? ''),
          description: r.description != null ? String(r.description) : arr[2] != null ? String(arr[2]) : null,
          startLine: typeof r.startLine === 'number' ? r.startLine : typeof arr[3] === 'number' ? arr[3] : undefined,
          endLine: typeof r.endLine === 'number' ? r.endLine : typeof arr[4] === 'number' ? arr[4] : undefined,
        };
      });
      if (scopeActive) {
        funcs = funcs.filter((f) => inF(f.path));
      }
      await client.close();

      const seen = new Set<string>();
      for (const f of funcs) {
        try {
          let text = [f.name, f.path, f.description].filter(Boolean).join(' ');
          if (typeof f.startLine === 'number' && typeof f.endLine === 'number' && f.endLine >= f.startLine) {
            const content = await this.fileContent.getFileContentSafe(repositoryId, f.path);
            if (content) {
              const lines = content.split(/\r?\n/);
              const slice = lines.slice(Math.max(0, f.startLine - 1), f.endLine).join('\n').trim();
              if (slice.length > 30) text = slice.slice(0, 4000);
            }
          }
          const vec = await embedForRead.embed(text);
          const vecStr = `[${vec.join(',')}]`;
          const res = await this.cypher.executeCypherRaw(
            `CALL db.idx.vector.queryNodes('Function', '${vProp}', 25, vecf32(${vecStr})) YIELD node, score
             RETURN node.path AS path, node.name AS name, node.projectId AS projectId, node.repoId AS repoId, score`,
            projectId,
          );
          for (const row of (
            res as Array<{ path: string; name: string; projectId: string; repoId?: string | null; score: number }>
          ).filter(
            (r) =>
              r.projectId === projectId &&
              (r.repoId == null || r.repoId === repositoryId) &&
              r.score >= threshold &&
              r.score < 0.999,
          )) {
            const bothGeneric = GENERIC_FUNCTION_NAMES.has(f.name.toLowerCase()) && GENERIC_FUNCTION_NAMES.has(row.name.toLowerCase());
            if (bothGeneric) continue;
            const key = [f.path, f.name, row.path, row.name].sort().join('|');
            if (!seen.has(key) && (row.path !== f.path || row.name !== f.name)) {
              seen.add(key);
              semanticPairs.push({ a: `${f.path}::${f.name}`, b: `${row.path}::${row.name}`, score: row.score });
            }
          }
        } catch {
          /* skip */
        }
      }
    }

    const seenKey = new Set<string>();
    const pairs: Array<{ a: string; b: string; score: number }> = [];
    for (const p of [...sameNamePairs, ...semanticPairs]) {
      const key = [p.a, p.b].sort().join('|');
      if (!seenKey.has(key)) {
        seenKey.add(key);
        pairs.push(p);
      }
    }

    if (scopeActive && crossPackageDuplicates) {
      for (const r of structuralPairs) {
        const fa = inF(r.pathA);
        const fb = inF(r.pathB);
        if ((fa && fb) || (!fa && !fb)) continue;
        const p = { a: `${r.pathA}::${r.name}`, b: `${r.pathB}::${r.name}`, score: 1 };
        const key = [p.a, p.b].sort().join('|');
        if (!seenKey.has(key)) {
          seenKey.add(key);
          pairs.push(p);
        }
      }
    }

    if (pairs.length === 0 && !embedForRead?.isAvailable()) {
      return {
        mode: 'duplicados',
        summary:
          '## Código duplicado\n\n\u26a0\ufe0f **Embeddings no configurados.** Ejecuta `POST /repositories/:id/embed-index` tras un sync para indexar el cuerpo de las funciones y detectar duplicados semánticos.',
        reportMeta: buildAnalyzeReportMeta({ scope, repositoryId: repo.id, allIndexedFilePaths }),
      };
    }

    let pairsPrimary = pairs;
    let pairsCrossBoundary: Array<{ a: string; b: string; score: number }> = [];
    if (scopeActive) {
      pairsPrimary = pairs.filter(
        (p) => inF(pathFromPairLabel(p.a)) && inF(pathFromPairLabel(p.b)),
      );
      if (crossPackageDuplicates) {
        pairsCrossBoundary = pairs.filter((p) => {
          const fa = inF(pathFromPairLabel(p.a));
          const fb = inF(pathFromPairLabel(p.b));
          return fa !== fb;
        });
      }
    }

    const { byName, byCluster } = groupDuplicates(pairsPrimary);

    let summary = formatDuplicatesSummary(pairsPrimary.length, byName, byCluster);
    if (scopeActive && pairsPrimary.length === 0 && pairs.length > 0) {
      summary =
        '## Código duplicado (foco)\n\n_No hay pares con **ambos** extremos dentro del prefijo de análisis._\n\n' +
        `Total de pares en el repositorio (sin filtrar por foco): **${pairs.length}**.`;
    }
    if (pairsCrossBoundary.length > 0) {
      summary += `\n\n### Duplicados que cruzan la frontera del scope\n\n`;
      summary += `_Fuera del foco actual — consolidar puede afectar otros paquetes._\n\n`;
      summary += pairsCrossBoundary
        .slice(0, 40)
        .map((p) => `- \`${p.a}\` ↔ \`${p.b}\` (${(p.score * 100).toFixed(0)}%)`)
        .join('\n');
      if (pairsCrossBoundary.length > 40) {
        summary += `\n\n_… y ${pairsCrossBoundary.length - 40} pares más._`;
      }
    }

    return {
      mode: 'duplicados',
      summary,
      details: {
        pairs: pairsPrimary,
        pairsAll: pairs,
        pairsCrossBoundary: crossPackageDuplicates ? pairsCrossBoundary : undefined,
        byName,
        byCluster,
        scopeActive,
      },
      reportMeta: buildAnalyzeReportMeta({ scope, repositoryId: repo.id, allIndexedFilePaths }),
    };
  }

  /** Payload LLM reingeniería sin ejecutar el síntesis de diagnóstico (orchestrator). */
  private async buildReingenieriaLlmPayload(
    repositoryId: string,
    options?: AnalyzeRequestOptions,
  ): Promise<{
    systemPrompt: string;
    userPrompt: string;
    details: { diagnostico: Record<string, unknown>; duplicadosDetails: unknown };
  }> {
    const scope = options?.scope;
    const crossPkg = options?.crossPackageDuplicates === true;
    const [diagBundle, duplicados] = await Promise.all([
      this.runDiagnosticoDataAndPrompts(repositoryId, scope),
      this.analyzeDuplicados(repositoryId, 0.78, 0, scope, crossPkg),
    ]);

    const hayDuplicados =
      Array.isArray((duplicados.details as { pairs?: unknown[] })?.pairs) &&
      ((duplicados.details as { pairs: unknown[] }).pairs?.length ?? 0) > 0;

    const rawDetails = diagBundle.detailsPayload as {
      riskRanked?: unknown[];
      highCoupling?: unknown[];
      noDescription?: unknown[];
      componentProps?: unknown[];
      antipatterns?: unknown;
    };

    const riskRe = (rawDetails?.riskRanked ?? []).slice(0, MAX_RISK_ITEMS);
    const couplingRe = (rawDetails?.highCoupling ?? []).slice(0, MAX_HIGH_COUPLING);
    const noDescRe = (rawDetails?.noDescription ?? []).slice(0, MAX_NO_DESC);
    const propsRe = (rawDetails?.componentProps ?? []).slice(0, MAX_COMPONENT_PROPS);
    const pairsRe = ((duplicados.details as { pairs?: unknown[] })?.pairs ?? []).slice(0, MAX_DUPLICATES);
    const riskRankedForMech = (rawDetails?.riskRanked ?? []) as Array<{ path?: string; name?: string; riskScore?: number }>;
    const diagMech =
      riskRankedForMech.length > 0
        ? riskRankedForMech
            .slice(0, 5)
            .map((r) => `${r.path}/${r.name}(${r.riskScore})`)
            .join('; ')
        : 'sin ítems de riesgo en muestra';

    const context = `
**Datos crudos del análisis (usa SOLO estos para tus recomendaciones; muestras top por categoría):**

Riesgo (ordenado por riskScore): ${JSON.stringify(riskRe)}
Alto acoplamiento: ${JSON.stringify(couplingRe)}
Sin JSDoc: ${JSON.stringify(noDescRe)}
Componentes con muchas props: ${JSON.stringify(propsRe)}
Anti-patrones: ${JSON.stringify(truncateAntipatterns((rawDetails?.antipatterns ?? {}) as { spaghetti?: unknown[]; godFunctions?: unknown[]; highFanIn?: unknown[]; circularImports?: unknown[]; overloadedComponents?: unknown[] }))}
Duplicados: ${JSON.stringify(pairsRe)}

Resumen mecánico (top riesgos, sin síntesis LLM previa): ${diagMech}
${!hayDuplicados ? '\n⚠️ No hay duplicados detectados. PROHIBIDO recomendar "eliminar duplicados" o "consolidar código repetido".' : ''}
`;

    const systemPrompt = `<rol>Arquitecto que genera planes de REINGENIERÍA basados en datos concretos.</rol>

<cot>Pensemos paso a paso: 1) Priorizar por riskScore y antipatrones. 2) Mapear acciones concretas (path/name). 3) Quick wins primero.</cot>

<restricciones>
- Cada acción DEBE referenciar path/name/component de los datos.
- PROHIBIDO consejos genéricos sin soporte. Sin duplicados → PROHIBIDO recomendar eliminar duplicados.
</restricciones>

<formato>Markdown estructurado con los ítems mostrados.</formato>`;

    const riskRanked = (rawDetails?.riskRanked ?? []) as Array<{ path?: string; name?: string; riskScore?: number }>;
    const noDesc = (rawDetails?.noDescription ?? []) as Array<{ path?: string; name?: string }>;
    const prefillRe =
      riskRanked.length > 0
        ? `Riesgos (${riskRanked.length} ítems total). `
        : '';
    const prefillReDesc =
      noDesc.length > 0 ? `Funciones sin JSDoc: ${noDesc.length} ítems. ` : '';
    const prefillReQuick = hayDuplicados ? 'Quick win: consolidar duplicados detectados. ' : '';

    const userPrompt = `${context}

<prefill>${prefillRe}${prefillReDesc}${prefillReQuick}</prefill>

Genera un PLAN DE REINGENIERÍA en markdown basándote ÚNICAMENTE en los datos crudos JSON anteriores.

IMPORTANTE: El plan debe estar ALINEADO con el diagnóstico. Misma estructura y mismos ítems para que un agente pueda ejecutar cada acción.

Estructura OBLIGATORIA (reflejar el diagnóstico):
1. **Objetivos** — prioridades extraídas de los datos (riesgo, documentación, antipatrones, duplicados).
2. **Acciones** — agrupadas por categoría, una acción por ítem de los datos:
   - **Riesgo (ordenado por riskScore):** Para cada ítem en Riesgo, una acción "Documentar la función X en path" o "Refactorizar X en path" con Path/Name y Risk Score.
   - **Alto acoplamiento:** Una acción por ítem en Alto acoplamiento (path/name, Out Calls).
   - **Funciones sin JSDoc:** Una acción por ítem en Sin JSDoc: "Agregar JSDoc a X en path" con Path/Name.
   - **Antipatrones:** Una acción por ítem en Spaghetti/God Functions/etc.: "Refactorizar X en path (Nesting Depth: N)" o "(Out Calls: N)".
3. **Quick wins** — lista explícita: funciones sin JSDoc (path/name) y consolidar duplicados solo si Duplicados no está vacío.
4. Incluir TODOS los path/name de los datos en las acciones. Sin inventar ítems. Sin omitir categorías que tengan datos.`;

    return {
      systemPrompt,
      userPrompt,
      details: { diagnostico: diagBundle.detailsPayload, duplicadosDetails: duplicados.details },
    };
  }

  /** Recomendaciones de reingeniería basadas 100% en datos del grafo. Sin límites. */
  async analyzeReingenieria(repositoryId: string, options?: AnalyzeRequestOptions): Promise<AnalyzeResult> {
    const scope = options?.scope;
    const crossPackageDuplicates = options?.crossPackageDuplicates === true;
    const [diagnostico, duplicados] = await Promise.all([
      this.analyzeDiagnostico(repositoryId, scope),
      this.analyzeDuplicados(repositoryId, 0.78, 0, scope, crossPackageDuplicates),
    ]);

    const hayDuplicados =
      Array.isArray((duplicados.details as { pairs?: unknown[] })?.pairs) &&
      ((duplicados.details as { pairs: unknown[] }).pairs?.length ?? 0) > 0;

    const rawDetails = diagnostico.details as {
      riskRanked?: unknown[];
      highCoupling?: unknown[];
      noDescription?: unknown[];
      componentProps?: unknown[];
      antipatterns?: unknown;
    };

    const riskRe = (rawDetails?.riskRanked ?? []).slice(0, MAX_RISK_ITEMS);
    const couplingRe = (rawDetails?.highCoupling ?? []).slice(0, MAX_HIGH_COUPLING);
    const noDescRe = (rawDetails?.noDescription ?? []).slice(0, MAX_NO_DESC);
    const propsRe = (rawDetails?.componentProps ?? []).slice(0, MAX_COMPONENT_PROPS);
    const pairsRe = ((duplicados.details as { pairs?: unknown[] })?.pairs ?? []).slice(0, MAX_DUPLICATES);
    const diagSummary =
      diagnostico.summary.slice(0, MAX_SUMMARY_CHARS) +
      (diagnostico.summary.length > MAX_SUMMARY_CHARS ? '\n...[resumido]' : '');

    const context = `
**Datos crudos del análisis (usa SOLO estos para tus recomendaciones; muestras top por categoría):**

Riesgo (ordenado por riskScore): ${JSON.stringify(riskRe)}
Alto acoplamiento: ${JSON.stringify(couplingRe)}
Sin JSDoc: ${JSON.stringify(noDescRe)}
Componentes con muchas props: ${JSON.stringify(propsRe)}
Anti-patrones: ${JSON.stringify(truncateAntipatterns((rawDetails?.antipatterns ?? {}) as { spaghetti?: unknown[]; godFunctions?: unknown[]; highFanIn?: unknown[]; circularImports?: unknown[]; overloadedComponents?: unknown[] }))}
Duplicados: ${JSON.stringify(pairsRe)}

Resumen diagnóstico (referencia): ${diagSummary}
${!hayDuplicados ? '\n\u26a0\ufe0f No hay duplicados detectados. PROHIBIDO recomendar "eliminar duplicados" o "consolidar código repetido".' : ''}
`;

    const systemPrompt = `<rol>Arquitecto que genera planes de REINGENIERÍA basados en datos concretos.</rol>

<cot>Pensemos paso a paso: 1) Priorizar por riskScore y antipatrones. 2) Mapear acciones concretas (path/name). 3) Quick wins primero.</cot>

<restricciones>
- Cada acción DEBE referenciar path/name/component de los datos.
- PROHIBIDO consejos genéricos sin soporte. Sin duplicados → PROHIBIDO recomendar eliminar duplicados.
</restricciones>

<formato>Markdown estructurado con los ítems mostrados. NO envuelvas el documento entero en triple comilla; salida directa en markdown.</formato>`;

    const riskRanked = (rawDetails?.riskRanked ?? []) as Array<{ path?: string; name?: string; riskScore?: number }>;
    const noDesc = (rawDetails?.noDescription ?? []) as Array<{ path?: string; name?: string }>;
    const prefillRe = riskRanked.length > 0 ? `Riesgos (${riskRanked.length} ítems total). ` : '';
    const prefillReDesc = noDesc.length > 0 ? `Funciones sin JSDoc: ${noDesc.length} ítems. ` : '';
    const prefillReQuick = hayDuplicados ? 'Quick win: consolidar duplicados detectados. ' : '';

    const userPrompt = `${context}

<prefill>${prefillRe}${prefillReDesc}${prefillReQuick}</prefill>

Genera un PLAN DE REINGENIERÍA en markdown basándote \u00daNICAMENTE en los datos crudos JSON anteriores.

IMPORTANTE: El plan debe estar ALINEADO con el diagnóstico. Misma estructura y mismos ítems para que un agente pueda ejecutar cada acción.

Estructura OBLIGATORIA (reflejar el diagnóstico):
1. **Objetivos** — prioridades extraídas de los datos (riesgo, documentación, antipatrones, duplicados).
2. **Acciones** — agrupadas por categoría, una acción por ítem de los datos:
   - **Riesgo (ordenado por riskScore):** Para cada ítem en Riesgo, una acción "Documentar la función X en path" o "Refactorizar X en path" con Path/Name y Risk Score.
   - **Alto acoplamiento:** Una acción por ítem en Alto acoplamiento (path/name, Out Calls).
   - **Funciones sin JSDoc:** Una acción por ítem en Sin JSDoc: "Agregar JSDoc a X en path" con Path/Name.
   - **Antipatrones:** Una acción por ítem en Spaghetti/God Functions/etc.: "Refactorizar X en path (Nesting Depth: N)" o "(Out Calls: N)".
3. **Quick wins** — lista explícita: funciones sin JSDoc (path/name) y consolidar duplicados solo si Duplicados no está vacío.
4. Incluir TODOS los path/name de los datos en las acciones. Sin inventar ítems. Sin omitir categorías que tengan datos.`;

    const answer = await this.llm.callLlm(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      8192,
    );
    return {
      mode: 'reingenieria',
      summary: stripOuterMarkdownFence(answer),
      details: { diagnostico: diagnostico.details, duplicados: duplicados.details },
      reportMeta: diagnostico.reportMeta ?? duplicados.reportMeta,
    };
  }

  /** Métricas + prompts LLM seguridad (orchestrator prep). */
  private async buildSeguridadLlmPayload(repositoryId: string): Promise<{
    systemPrompt: string;
    userPrompt: string;
    details: { leakedSecrets: unknown[] };
  }> {
    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);
    const leakedSecrets = await this.runSecurityScan(repositoryId, projectId, repo.repoSlug, { maxFiles: 160 });
    const context = `
Repositorio ${repo.projectKey}/${repo.repoSlug} — hallazgos automáticos (regex sobre hasta 160 archivos .ts/.tsx/.js/.json/.env del índice):

**leakedSecrets** (path relativo al repo, severidad, fragmento coincidente truncado, línea): ${JSON.stringify(leakedSecrets)}
`;
    const systemPrompt = `<rol>Especialista AppSec. Evidencia única: JSON del escaneo.</rol>

<instrucciones>
- NO inventes CVEs ni vulnerabilidades sin filas en leakedSecrets.
- Si leakedSecrets está vacío: indica que no hubo coincidencias con los patrones en ESTA corrida y recalca el alcance (muestra de archivos indexados, heurística).
- Con hallazgos: prioriza severidad; tabla Path | Línea | Severidad | Qué remediar.
- Remediación: variables de entorno, secret manager, rotación, pre-commit/CI, nunca commit de secretos.
</instrucciones>

<formato_salida>Markdown: 1) Resumen ejecutivo 2) Hallazgos (tabla o lista) 3) Plan de remediación 4) Alcance y límites del análisis</formato_salida>`;
    return {
      systemPrompt,
      userPrompt: `${context}\n\nGenera la auditoría en markdown.`,
      details: { leakedSecrets },
    };
  }

  /**
   * Auditoría de seguridad: escaneo heurístico (secretos / higiene en fuentes indexadas) + síntesis LLM.
   * Complementa Full Audit; no sustituye SAST ni pentest.
   */
  async analyzeSeguridad(repositoryId: string): Promise<AnalyzeResult> {
    const p = await this.buildSeguridadLlmPayload(repositoryId);
    const answer = await this.llm.callLlm(
      [{ role: 'system', content: p.systemPrompt }, { role: 'user', content: p.userPrompt }],
      8192,
    );
    return { mode: 'seguridad', summary: answer, details: p.details };
  }

  /** Globs extra para código muerto (`CODIGO_MUERTO_EXTRA_EXCLUDE_GLOBS`, coma o salto de línea). */
  private mergeCodigoMuertoExcludeGlobs(scope?: ChatScope): ChatScope | undefined {
    const extra = process.env.CODIGO_MUERTO_EXTRA_EXCLUDE_GLOBS?.trim();
    if (!extra) return scope;
    const parts = extra
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return scope;
    return {
      ...scope,
      excludePathGlobs: [...(scope?.excludePathGlobs ?? []), ...parts],
    };
  }

  /**
   * Análisis de código muerto: propósito, referencias y conclusión por archivo.
   * Formato detallado: ruta, quién lo importa/renderiza/llama, detalle funcional, conclusión.
   */
  async analyzeCodigoMuerto(repositoryId: string, scope?: ChatScope): Promise<AnalyzeResult> {
    scope = this.mergeCodigoMuertoExcludeGlobs(scope);
    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);
    const MAX_FILES = 120;

    const rid = repositoryId;
    const files = (await this.cypher.executeCypher(
      projectId,
      `MATCH (f:File) WHERE f.projectId = $projectId AND f.repoId = $repoId RETURN f.path as path ORDER BY f.path`,
      { repoId: rid },
    )) as Array<{ path: string }>;
    const allIndexedFilePaths = files.map((r) => r.path);
    const isPm2Config = (path: string) =>
      /^ecosystem[.-].*\.config\.(js|mjs|cjs)$/i.test(path.split('/').pop() ?? path);
    const filePathsAll = files
      .map((r) => r.path)
      .filter((p) => !isPm2Config(p))
      .slice(0, MAX_FILES);
    const scopeActive = isAnalyzeScopeActive(scope);
    let filePaths = filePathsAll;
    if (scopeActive) {
      filePaths = filePathsAll.filter((p) => pathInAnalyzeFocus(p, scope, rid));
    }

    const imports = (await this.cypher.executeCypher(
      projectId,
      `MATCH (a:File)-[:IMPORTS]->(b:File) WHERE a.projectId = $projectId AND b.projectId = $projectId
       AND a.repoId = $repoId AND b.repoId = $repoId RETURN a.path as fromPath, b.path as toPath`,
      { repoId: rid },
    )) as Array<{ fromPath: string; toPath: string }>;

    const contains = (await this.cypher.executeCypher(
      projectId,
      `MATCH (f:File)-[:CONTAINS]->(n) WHERE f.projectId = $projectId AND f.repoId = $repoId AND n.repoId = $repoId
       RETURN f.path as filePath, labels(n)[0] as label, n.name as name`,
      { repoId: rid },
    )) as Array<{ filePath: string; label: string; name: string }>;

    const renders = (await this.cypher.executeCypher(
      projectId,
      `MATCH (fp:File)-[:CONTAINS]->(parent:Component)-[:RENDERS]->(child:Component)
       MATCH (fc:File)-[:CONTAINS]->(child)
       WHERE parent.projectId = $projectId AND child.projectId = $projectId
       AND fp.repoId = $repoId AND fc.repoId = $repoId AND parent.repoId = $repoId AND child.repoId = $repoId
       RETURN fc.path as targetFile, child.name as childName, fp.path as referrerPath, parent.name as referrerComponent`,
      { repoId: rid },
    )) as Array<{ targetFile: string; childName: string; referrerPath: string; referrerComponent: string }>;

    const calls = (await this.cypher.executeCypher(
      projectId,
      `MATCH (caller:Function)-[:CALLS]->(callee:Function) WHERE callee.projectId = $projectId AND caller.projectId = $projectId
       AND caller.repoId = $repoId AND callee.repoId = $repoId
       RETURN callee.path as targetPath, callee.name as calleeName, caller.path as callerPath, caller.name as callerName`,
      { repoId: rid },
    )) as Array<{ targetPath: string; calleeName: string; callerPath: string; callerName: string }>;

    const routes = (await this.cypher.executeCypher(
      projectId,
      `MATCH (r:Route) WHERE r.projectId = $projectId AND r.repoId = $repoId RETURN r.componentName as name`,
      { repoId: rid },
    )) as Array<{ name: string }>;
    const routeComponents = new Set((routes ?? []).map((r) => r.name));

    const hookDefFiles = (await this.cypher.executeCypher(
      projectId,
      `MATCH (comp:Component)-[:USES_HOOK]->(h:Hook)
       WHERE h.projectId = $projectId AND h.repoId = $repoId AND comp.repoId = $repoId
       MATCH (f:File)-[:CONTAINS]->(fn:Function) WHERE fn.name = h.name AND fn.projectId = $projectId AND f.repoId = $repoId AND fn.repoId = $repoId
       RETURN f.path as targetPath, h.name as hookName`,
      { repoId: rid },
    )) as Array<{ targetPath: string; hookName: string }>;
    const hookDefFileSet = new Set(hookDefFiles.map((r) => r.targetPath));

    /** Canonicaliza path para comparar imports: barras unificadas, sin extensión (ts/tsx/js/jsx). Evita falsos positivos cuando el grafo guarda la arista con otra variante del path. */
    const normalizePathForImport = (p: string): string =>
      p.replace(/\\/g, '/').trim().replace(/\.(tsx?|jsx?|mjs|cjs)$/i, '');

    const importersByFile = new Map<string, string[]>();
    for (const { fromPath, toPath } of imports) {
      const key = normalizePathForImport(toPath);
      if (!importersByFile.has(key)) importersByFile.set(key, []);
      importersByFile.get(key)!.push(fromPath);
    }

    const containsByFile = new Map<string, Array<{ label: string; name: string }>>();
    for (const { filePath, label, name } of contains) {
      if (!containsByFile.has(filePath)) containsByFile.set(filePath, []);
      containsByFile.get(filePath)!.push({ label, name });
    }

    const componentRefsByFile = new Map<string, Array<{ referrer: string; component: string }>>();
    for (const { targetFile, childName, referrerPath, referrerComponent } of renders) {
      if (!componentRefsByFile.has(targetFile)) componentRefsByFile.set(targetFile, []);
      componentRefsByFile.get(targetFile)!.push({ referrer: `${referrerPath} (renderiza ${referrerComponent})`, component: childName });
    }

    const functionRefsByFile = new Map<string, Array<{ referrer: string; fn: string }>>();
    for (const { targetPath, calleeName, callerPath, callerName } of calls) {
      if (!functionRefsByFile.has(targetPath)) functionRefsByFile.set(targetPath, []);
      functionRefsByFile.get(targetPath)!.push({ referrer: `${callerPath} (${callerName})`, fn: calleeName });
    }

    const entryPatterns =
      /^(src\/)?(index|main|App|bootstrap|_app|_document)\.(tsx?|jsx?)$|\.(index|main|bootstrap)\.(tsx?|jsx?)$/;
    const isEntryFile = (path: string) => entryPatterns.test(path.replace(/^[^/]+\//, ''));
    const isTestOrStory = (p: string) =>
      /\.(test|spec|stories)\.(tsx?|jsx?)$/.test(p) || /(__tests__|__specs__|\/stories\/)/.test(p);

    const deadFiles: Array<{ path: string; shortName: string; components: string[]; functions: string[]; models: string[] }> = [];

    for (const path of filePaths) {
      if (isTestOrStory(path)) continue;

      const shortName = path.split('/').pop() ?? path;
      const importers =
        importersByFile.get(path) ??
        importersByFile.get(normalizePathForImport(path)) ??
        [];
      const refs = componentRefsByFile.get(path) ?? [];
      const fnRefs = functionRefsByFile.get(path) ?? [];
      const content = containsByFile.get(path) ?? [];
      const components = content.filter((c) => c.label === 'Component').map((c) => c.name);
      const functions = content.filter((c) => c.label === 'Function').map((c) => c.name);
      const models = content.filter((c) => c.label === 'Model').map((c) => c.name);
      const inRoute = components.some((c) => routeComponents.has(c));
      const hasImporters = importers.length > 0;
      const hasComponentRefs = refs.length > 0 || inRoute;
      const hasFunctionRefs = fnRefs.length > 0;
      const hasHookRefs = hookDefFileSet.has(path);
      const isEntry = isEntryFile(path);
      const used = hasImporters || hasComponentRefs || hasFunctionRefs || hasHookRefs || isEntry;

      if (used) continue;

      deadFiles.push({ path, shortName, components, functions, models });
    }

    const verified = await this.verifyDeadCandidates(repositoryId, deadFiles, filePathsAll);

    const lines: string[] = [
      '# ANÁLISIS DE CÓDIGO MUERTO',
      '',
      'Clasificación automática tras verificación de imports en contenido de archivos (hasta 150 archivos).',
      '**No añadir categoría "Revisar"** — la verificación ya se ejecutó.',
      '',
    ];

    const eliminarSeguro = verified.filter((v) => v.category === 'eliminar');
    const falsosPositivos = verified.filter((v) => v.category === 'falso_positivo');
    const eliminarConSeguridad = verified.filter((v) => v.category === 'eliminar_con_seguridad');

    if (eliminarConSeguridad.length > 0) {
      lines.push('## Eliminar con seguridad');
      lines.push('');
      for (const v of eliminarConSeguridad) {
        lines.push(`- \`${v.path}\` — ${v.reason}`);
      }
      lines.push('');
    }

    if (eliminarSeguro.length > 0) {
      lines.push('## Eliminar (verificado sin referencias)');
      lines.push('');
      for (const v of eliminarSeguro) {
        lines.push(`- \`${v.path}\` — ${v.exportsSummary}`);
        if (v.searchedIn) lines.push(`  Verificado en ${v.searchedIn} archivos.`);
      }
      lines.push('');
    }

    if (falsosPositivos.length > 0) {
      lines.push('## No eliminar (referencia encontrada)');
      lines.push('');
      for (const v of falsosPositivos) {
        lines.push(`- \`${v.path}\` — Referencia en: ${v.foundIn!.join(', ')}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('## Resumen');
    lines.push('');
    lines.push('| Estado | Cantidad |');
    lines.push('|--------|----------|');
    lines.push(`| Eliminar con seguridad | ${eliminarConSeguridad.length} |`);
    lines.push(`| Eliminar (verificado) | ${eliminarSeguro.length} |`);
    lines.push(`| No eliminar (falso positivo) | ${falsosPositivos.length} |`);
    lines.push('');

    if (verified.length === 0) {
      lines.push('_No se detectaron archivos candidatos a código muerto._');
    }

    if (files.length > MAX_FILES) {
      lines.push(`_Se analizaron ${MAX_FILES} de ${files.length} archivos._`);
    }

    return {
      mode: 'codigo_muerto',
      summary: lines.join('\n'),
      details: {
        fileCount: filePaths.length,
        deadCount: verified.length,
        eliminar: eliminarSeguro.length,
        eliminarConSeguridad: eliminarConSeguridad.length,
        falsosPositivos: falsosPositivos.length,
        verified,
      },
      reportMeta: buildAnalyzeReportMeta({
        scope,
        repositoryId: rid,
        allIndexedFilePaths,
        truncatedFiles: files.length > MAX_FILES,
        analyzedFileCount: filePaths.length,
      }),
    };
  }

  /** Verifica candidatos a código muerto buscando imports en el contenido de otros archivos. */
  private async verifyDeadCandidates(
    repositoryId: string,
    deadFiles: Array<{ path: string; shortName: string; components: string[]; functions: string[]; models: string[] }>,
    allFilePaths: string[],
  ): Promise<
    Array<{
      path: string;
      shortName: string;
      category: 'eliminar' | 'eliminar_con_seguridad' | 'falso_positivo';
      reason?: string;
      exportsSummary: string;
      foundIn?: string[];
      searchedIn?: number;
    }>
  > {
    const deadSet = new Set(deadFiles.map((d) => d.path));
    const withExt = (p: string) => /\.(tsx?|jsx?|mjs|cjs)$/.test(p);
    const srcFirst = (a: string, b: string) => {
      const aSrc = a.includes('/src/') ? 0 : 1;
      const bSrc = b.includes('/src/') ? 0 : 1;
      return aSrc - bSrc || a.localeCompare(b);
    };
    const filesToSearch = allFilePaths
      .filter((p) => !deadSet.has(p) && withExt(p))
      .sort(srcFirst)
      .slice(0, 150);

    const contents = await Promise.all(
      filesToSearch.map(async (p) => {
        const c = await this.fileContent.getFileContentSafe(repositoryId, p);
        return { path: p, content: c ?? '' };
      }),
    );
    const contentByPath = new Map(contents.map((x) => [x.path, x.content]));

    const result: Array<{
      path: string;
      shortName: string;
      category: 'eliminar' | 'eliminar_con_seguridad' | 'falso_positivo';
      reason?: string;
      exportsSummary: string;
      foundIn?: string[];
      searchedIn?: number;
    }> = [];

    for (const d of deadFiles) {
      const baseName = d.shortName.replace(/\.(tsx?|jsx?|js)$/, '');
      const pathSeg = d.path.replace(/\\/g, '/').replace(/\.(tsx?|jsx?|js)$/i, '');
      const pathTail = pathSeg.split('/').slice(-2).join('/');
      const searchTerms = [
        baseName,
        pathTail,
        pathSeg.length < 80 ? pathSeg : pathTail,
        ...d.components,
        ...d.functions.slice(0, 5),
        ...d.models,
      ].filter((s, i, a) => s && a.indexOf(s) === i && s.length > 2);

      const foundIn: string[] = [];

      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const buildImportRe = (term: string) =>
        new RegExp(
          `(?:import(?:\\s+type)?\\s+(?:[^;]*\\{|\\*)|export\\s+(?:type\\s+)?(?:\\{[^}]*\\}|\\*)\\s+from|\\bfrom\\b|require)\\s*[\\(\\[]?\\s*['"\`][^'"\`]*${esc(term)}[^'"\`]*['"\`]`,
          'i',
        );

      for (const { path, content } of contents) {
        if (!content) continue;
        const shortPath = path.split('/').pop() ?? path;
        let matched = false;
        for (const term of searchTerms) {
          if (term.length < 3) continue;
          if (buildImportRe(term).test(content)) {
            foundIn.push(shortPath);
            matched = true;
            break;
          }
        }
        if (!matched && buildImportRe(baseName).test(content)) {
          foundIn.push(shortPath);
        }
      }

      const exportsSummary =
        [d.components, d.functions, d.models]
          .flat()
          .slice(0, 5)
          .join(', ') || 'sin exports indexados';

      if (foundIn.length > 0) {
        result.push({
          path: d.path,
          shortName: d.shortName,
          category: 'falso_positivo',
          exportsSummary,
          foundIn,
        });
        continue;
      }

      if (/copy\b|\.copy\./i.test(d.path) || /\bchistmaslights\b/i.test(d.path)) {
        result.push({
          path: d.path,
          shortName: d.shortName,
          category: 'eliminar_con_seguridad',
          reason:
            d.path.includes('copy') || d.path.includes(' copy')
              ? 'copia duplicada sin referencias'
              : /chistmaslights|ecosystem/.test(d.path)
                ? 'script/config no referenciado'
                : 'alta confianza',
          exportsSummary,
          searchedIn: contentByPath.size,
        });
        continue;
      }

      result.push({
        path: d.path,
        shortName: d.shortName,
        category: 'eliminar',
        exportsSummary,
        searchedIn: contentByPath.size,
      });
    }

    return result;
  }

  private async buildAgentsLlmPayload(
    projectId: string,
    displayName: string,
  ): Promise<{ systemPrompt: string; userPrompt: string }> {
    const summary = await this.cypher.getGraphSummaryForProject(projectId);
    const context = `Proyecto/repo: ${displayName}\nConteos del grafo: ${JSON.stringify(summary.counts)}\nMuestras (paths, componentes, funciones): ${JSON.stringify(summary.samples).slice(0, 4000)}`;
    const systemPrompt = `Eres experto en protocolos para agentes AI (Cursor, Claude, MCP). Genera un archivo AGENTS.md en formato Markdown para este proyecto.

**HERRAMIENTAS MCP REALES (solo estas existen; NO inventes create_component, create_route, etc.):**
- list_known_projects — Lista proyectos y roots.
- get_component_graph, get_legacy_impact, get_definitions, get_references — Diagnóstico de archivo/componente/hook.
- get_project_analysis — Diagnóstico por repo (mode: diagnostico, duplicados, reingenieria, codigo_muerto, seguridad).
- ask_codebase — Preguntas NL sobre el codebase.
- get_modification_plan — Archivos a modificar + preguntas de afinación.
- semantic_search, find_similar_implementations — Búsqueda por término.
- validate_before_edit — Antes de editar componente/función.
- get_file_content, get_file_context — Contenido y contexto de archivo.
- get_project_standards — Estándares del proyecto.
- check_breaking_changes — Verificar cambios rompedores.
- analyze_local_changes — Revisión pre-commit de cambios en stage.

Estructura obligatoria:
1. **Protocolo de sesión** — list_known_projects al inicio; verificar projectId; .ariadne-project si existe.
2. **Preferencia projectId** — Fijar proyecto; excepciones: get_project_analysis usa roots[].id.
3. **Herramientas por intención** — Tabla con TODAS las herramientas de la lista anterior. Intención | Herramienta MCP | Flujo. Usa intenciones reales (diagnóstico, refactor, preguntas NL, plan de modificación, etc.) y mapea a las herramientas reales. Incluye ejemplos de paths/componentes del proyecto en la columna Flujo.
4. **Flujo SDD** — validate_before_edit, get_legacy_impact, no inventar props.
5. **Flujo de refactorización** — semantic_search, get_definitions, get_references, validate_before_edit.

OBLIGATORIO: la tabla debe tener al menos 10 filas cubriendo las herramientas listadas. Deriva paths y nombres del contexto. Salida SOLO markdown.`;
    return { systemPrompt, userPrompt: context };
  }

  private async buildSkillLlmPayload(
    projectId: string,
    displayName: string,
  ): Promise<{ systemPrompt: string; userPrompt: string }> {
    const summary = await this.cypher.getGraphSummaryForProject(projectId);
    const context = `Proyecto/repo: ${displayName}\nConteos: ${JSON.stringify(summary.counts)}\nMuestras: ${JSON.stringify(summary.samples).slice(0, 4000)}`;
    const safeName = displayName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'project';
    const systemPrompt = `Eres experto en SKILL.md para agentes AI (Cursor, Claude). Genera un SKILL que enseñe a usar el MCP AriadneSpecs Oracle sobre este proyecto.

**HERRAMIENTAS MCP (el skill debe referenciar estas):** list_known_projects, get_component_graph, get_legacy_impact, get_definitions, get_references, get_project_analysis (modes: diagnostico, duplicados, reingenieria, codigo_muerto, seguridad), ask_codebase, get_modification_plan, semantic_search, find_similar_implementations, validate_before_edit, get_file_content, get_file_context, get_project_standards, check_breaking_changes, analyze_local_changes.

Estructura obligatoria:
1. **YAML frontmatter** entre ---:
   - name: ${safeName}-ariadne-specs
   - description: "Usa MCP AriadneSpecs para [propósito del proyecto]. Frases trigger: 'diagnóstico de X', 'analizar componente Y', 'impacto de Z', 'refactor de W'." (sin XML, máx 1024 chars)

2. **# Título** — Nombre del skill

3. **## Instructions** — Pasos que OBLIGATORIAMENTE incluyan llamadas a herramientas MCP. Ejemplo: "1. list_known_projects para obtener projectId. 2. Para diagnóstico de componente X: get_component_graph(X), get_legacy_impact(X), get_definitions/get_references. 3. Antes de editar: validate_before_edit. 4. Preguntas NL: ask_codebase." Incluye componentes/rutas reales del contexto en los ejemplos.

4. **## Examples** — 2-4 escenarios donde el USUARIO pide algo y el AGENTE USA HERRAMIENTAS MCP (no llamar funciones del código). Formato:
   - User says: "diagnóstico de [componente del proyecto]"
   - Actions: list_known_projects → get_component_graph([nombre]) → get_legacy_impact([nombre]) → get_definitions
   - Result: [qué obtiene el agente]

5. **## Troubleshooting** — NOT_FOUND_IN_GRAPH (reindexar o verificar nombre), MCP no responde (INGEST_URL, servicios), projectId incorrecto (usar roots[].id para get_project_analysis).

PROHIBIDO: instrucciones genéricas tipo "revisa los controladores", "asegúrate de que estén configurados". El skill debe enseñar a USAR las herramientas MCP. Salida SOLO markdown.`;
    return { systemPrompt, userPrompt: context };
  }

  /**
   * Genera AGENTS.md: protocolo para agentes AI (Cursor/Claude) basado en la estructura del proyecto.
   * Usa el conocimiento del MCP Handbook: protocolo de sesión, herramientas por intención, flujos SDD y refactorización.
   */
  async analyzeAgents(projectId: string, displayName: string): Promise<AnalyzeResult> {
    const p = await this.buildAgentsLlmPayload(projectId, displayName);
    const answer = await this.llm.callLlm(
      [{ role: 'system', content: p.systemPrompt }, { role: 'user', content: p.userPrompt }],
      8192,
    );
    return { mode: 'agents', summary: answer };
  }

  /**
   * Genera SKILL.md: skill para Cursor/Claude adaptada al proyecto.
   * Usa el conocimiento del MCP Handbook: YAML frontmatter (name, description), Instructions, Examples, Troubleshooting.
   */
  async analyzeSkill(projectId: string, displayName: string): Promise<AnalyzeResult> {
    const p = await this.buildSkillLlmPayload(projectId, displayName);
    const answer = await this.llm.callLlm(
      [{ role: 'system', content: p.systemPrompt }, { role: 'user', content: p.userPrompt }],
      8192,
    );
    return { mode: 'skill', summary: answer };
  }

  /**
   * Prep para orchestrator: resultados completos sin LLM o prompts + detalles para síntesis en orchestrator.
   */
  async prepareAnalyzeOrchestrator(
    repositoryId: string,
    mode: AnalyzeMode,
    options?: AnalyzeRequestOptions,
  ): Promise<AnalyzeOrchestratorPrepDto> {
    if (mode === 'codigo_muerto') {
      return { kind: 'complete', result: await this.analyzeCodigoMuerto(repositoryId, options?.scope) };
    }
    if (mode === 'duplicados') {
      return {
        kind: 'complete',
        result: await this.analyzeDuplicados(
          repositoryId,
          0.78,
          0,
          options?.scope,
          options?.crossPackageDuplicates === true,
        ),
      };
    }
    if (mode === 'diagnostico') {
      const p = await this.runDiagnosticoDataAndPrompts(repositoryId, options?.scope);
      return {
        kind: 'llm',
        mode: 'diagnostico',
        systemPrompt: p.systemPrompt,
        userPrompt: p.userPrompt,
        maxTokens: 8192,
        details: p.detailsPayload,
      };
    }
    if (mode === 'reingenieria') {
      const p = await this.buildReingenieriaLlmPayload(repositoryId, options);
      return {
        kind: 'llm',
        mode: 'reingenieria',
        systemPrompt: p.systemPrompt,
        userPrompt: p.userPrompt,
        maxTokens: 8192,
        details: p.details,
      };
    }
    if (mode === 'seguridad') {
      const p = await this.buildSeguridadLlmPayload(repositoryId);
      return {
        kind: 'llm',
        mode: 'seguridad',
        systemPrompt: p.systemPrompt,
        userPrompt: p.userPrompt,
        maxTokens: 8192,
        details: p.details,
      };
    }
    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);
    const displayName = `${repo.projectKey}/${repo.repoSlug}`;
    if (mode === 'agents') {
      const p = await this.buildAgentsLlmPayload(projectId, displayName);
      return {
        kind: 'llm',
        mode: 'agents',
        systemPrompt: p.systemPrompt,
        userPrompt: p.userPrompt,
        maxTokens: 8192,
        details: {},
      };
    }
    if (mode === 'skill') {
      const p = await this.buildSkillLlmPayload(projectId, displayName);
      return {
        kind: 'llm',
        mode: 'skill',
        systemPrompt: p.systemPrompt,
        userPrompt: p.userPrompt,
        maxTokens: 8192,
        details: {},
      };
    }
    const _u: never = mode;
    throw new Error(`Modo de análisis no soportado en prep: ${String(_u)}`);
  }

  /** Prep AGENTS/SKILL cuando el ID es proyecto multi-root o repo (misma resolución que analyzeByProject). */
  async prepareAnalyzeByProjectOrchestrator(
    projectId: string,
    mode: 'agents' | 'skill',
  ): Promise<AnalyzeOrchestratorPrepDto> {
    const maybeRepo = await this.repos.findOptionalById(projectId);
    if (maybeRepo) {
      const displayName = `${maybeRepo.projectKey}/${maybeRepo.repoSlug}`;
      const p =
        mode === 'agents'
          ? await this.buildAgentsLlmPayload(projectId, displayName)
          : await this.buildSkillLlmPayload(projectId, displayName);
      return {
        kind: 'llm',
        mode,
        systemPrompt: p.systemPrompt,
        userPrompt: p.userPrompt,
        maxTokens: 8192,
        details: {},
      };
    }
    const project = await this.projects.findOne(projectId);
    const displayName =
      project.name ||
      project.repositories.map((r) => `${r.projectKey}/${r.repoSlug}`).join(', ') ||
      projectId.slice(0, 8);
    const p =
      mode === 'agents'
        ? await this.buildAgentsLlmPayload(projectId, displayName)
        : await this.buildSkillLlmPayload(projectId, displayName);
    return {
      kind: 'llm',
      mode,
      systemPrompt: p.systemPrompt,
      userPrompt: p.userPrompt,
      maxTokens: 8192,
      details: {},
    };
  }

  private async analyzeLocally(
    repositoryId: string,
    mode: AnalyzeMode,
    options?: AnalyzeRequestOptions,
  ): Promise<AnalyzeResult> {
    if (mode === 'diagnostico') return this.analyzeDiagnostico(repositoryId, options?.scope);
    if (mode === 'duplicados')
      return this.analyzeDuplicados(
        repositoryId,
        0.78,
        0,
        options?.scope,
        options?.crossPackageDuplicates === true,
      );
    if (mode === 'codigo_muerto') return this.analyzeCodigoMuerto(repositoryId, options?.scope);
    if (mode === 'reingenieria') return this.analyzeReingenieria(repositoryId, options);
    if (mode === 'seguridad') return this.analyzeSeguridad(repositoryId);
    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);
    const displayName = `${repo.projectKey}/${repo.repoSlug}`;
    if (mode === 'agents') return this.analyzeAgents(projectId, displayName);
    if (mode === 'skill') return this.analyzeSkill(projectId, displayName);
    return this.analyzeReingenieria(repositoryId, options);
  }

  /**
   * Ejecuta el análisis según el modo indicado.
   * @param repositoryId - UUID del repositorio
   * @param mode - diagnóstico | duplicados | reingeniería | código muerto | agents | skill
   */
  async analyze(
    repositoryId: string,
    mode: AnalyzeMode,
    options?: AnalyzeRequestOptions,
  ): Promise<AnalyzeResult> {
    validateAnalyzeScope(options?.scope, repositoryId);

    const orch = process.env.ORCHESTRATOR_URL?.trim();
    if (orch) {
      try {
        const url = `${orch.replace(/\/$/, '')}/codebase/analyze/repository/${encodeURIComponent(repositoryId)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            ...(options?.scope ? { scope: options.scope } : {}),
            ...(options?.crossPackageDuplicates ? { crossPackageDuplicates: true } : {}),
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        return (await res.json()) as AnalyzeResult;
      } catch {
        /* fallback local */
      }
    }

    const cacheable =
      mode === 'diagnostico' ||
      mode === 'duplicados' ||
      mode === 'codigo_muerto' ||
      mode === 'reingenieria';

    if (!cacheable) {
      return this.analyzeLocally(repositoryId, mode, options);
    }

    const repoMeta = await this.repos.findOne(repositoryId);
    const lastSha = repoMeta.lastCommitSha ?? null;
    const crossPkg = options?.crossPackageDuplicates === true;
    const scopeKey = stableScopeKeyForCache(options?.scope);
    const { fingerprint: indexFp, mode: fpMode, scopePartitioned } = await this.getIndexFingerprintForAnalyzeCache(
      repositoryId,
      lastSha,
      options?.scope,
    );
    const cacheKey = buildAnalyzeCacheKey({
      repositoryId,
      mode,
      scopeKey,
      crossPackageDuplicates: crossPkg,
      lastCommitSha: lastSha,
      indexFingerprint: indexFp,
    });

    if (!analyzeCacheDisabledFromEnv()) {
      const memHit = this.getAnalyzeCache(cacheKey);
      if (memHit) {
        return this.mergeAnalyzeReportMeta(memHit, {
          fromCache: true,
          cacheFingerprintMode: fpMode,
          cacheScopePartitioned: scopePartitioned,
        });
      }
      if (this.analyzeDistributedCache.isEnabled()) {
        const raw = await this.analyzeDistributedCache.getJson(cacheKey);
        if (raw) {
          try {
            const redisHit = JSON.parse(raw) as AnalyzeResult;
            this.setAnalyzeCache(cacheKey, redisHit);
            return this.mergeAnalyzeReportMeta(redisHit, {
              fromCache: true,
              cacheFingerprintMode: fpMode,
              cacheScopePartitioned: scopePartitioned,
            });
          } catch {
            /* ignore */
          }
        }
      }
    }

    let result: AnalyzeResult;
    if (mode === 'diagnostico') {
      result = await this.analyzeDiagnostico(repositoryId, options?.scope);
    } else if (mode === 'duplicados') {
      result = await this.analyzeDuplicados(
        repositoryId,
        0.78,
        0,
        options?.scope,
        crossPkg,
      );
    } else if (mode === 'codigo_muerto') {
      result = await this.analyzeCodigoMuerto(repositoryId, options?.scope);
    } else {
      result = await this.analyzeReingenieria(repositoryId, options);
    }

    result = this.mergeAnalyzeReportMeta(result, {
      cacheFingerprintMode: fpMode,
      cacheScopePartitioned: scopePartitioned,
    });
    if (!analyzeCacheDisabledFromEnv()) {
      this.setAnalyzeCache(cacheKey, result);
      if (this.analyzeDistributedCache.isEnabled()) {
        await this.analyzeDistributedCache.setJson(cacheKey, JSON.stringify(result), analyzeCacheRedisTtlSec());
      }
    }
    return result;
  }

  /**
   * Análisis por proyecto (multi-root) o repo standalone. Acepta projectId o repoId (roots[].id de list_known_projects).
   */
  async analyzeByProject(projectId: string, mode: 'agents' | 'skill'): Promise<AnalyzeResult> {
    const orch = process.env.ORCHESTRATOR_URL?.trim();
    if (orch) {
      try {
        const url = `${orch.replace(/\/$/, '')}/codebase/analyze/project/${encodeURIComponent(projectId)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        });
        if (!res.ok) throw new Error(await res.text());
        return (await res.json()) as AnalyzeResult;
      } catch {
        /* fallback local */
      }
    }

    const maybeRepo = await this.repos.findOptionalById(projectId);
    if (maybeRepo) {
      const displayName = `${maybeRepo.projectKey}/${maybeRepo.repoSlug}`;
      if (mode === 'agents') return this.analyzeAgents(projectId, displayName);
      return this.analyzeSkill(projectId, displayName);
    }
    const project = await this.projects.findOne(projectId);
    const displayName =
      project.name ||
      project.repositories
        .map((r) => `${r.projectKey}/${r.repoSlug}`)
        .join(', ') ||
      projectId.slice(0, 8);
    if (mode === 'agents') return this.analyzeAgents(projectId, displayName);
    return this.analyzeSkill(projectId, displayName);
  }

  /**
   * Full Repo Audit: arquitectura, seguridad, salud del código, resumen ejecutivo.
   * Combina detectAntipatterns, código muerto, duplicados, escaneo de secretos y complejidad.
   */
  async runFullAudit(repositoryId: string): Promise<FullAuditResult> {
    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);
    const repoSlug = repo.repoSlug;

    const [antipatterns, codigoMuertoRes, duplicadosRes, godObjects, topComplexity, leakedSecrets] =
      await Promise.all([
        this.antipatterns.detectAntipatterns(repositoryId),
        this.analyzeCodigoMuerto(repositoryId),
        this.analyzeDuplicados(repositoryId, 0.78, 0),
        this.getGodObjects(projectId, repositoryId),
        this.getTopComplexityFunctions(projectId, repositoryId, 10),
        this.runSecurityScan(repositoryId, projectId, repoSlug),
      ]);

    const codigoDetails = codigoMuertoRes.details as {
      verified?: Array<{ path: string; category: string; exportsSummary?: string }>;
    } | undefined;
    const dupDetails = duplicadosRes.details as {
      pairs?: Array<{ a: string; b: string; score?: number }>;
    } | undefined;

    const verified = codigoDetails?.verified ?? [];
    const deadCodeItems = verified
      .filter((v) => v.category !== 'falso_positivo')
      .map((v) => ({ path: v.path, category: v.category, exportsSummary: v.exportsSummary }));

    const pairs = dupDetails?.pairs ?? [];

    const criticalFindings = this.buildCriticalFindings(
      antipatterns,
      deadCodeItems,
      pairs,
      godObjects,
      leakedSecrets,
    );

    const topRisks = this.buildTopRisks(antipatterns, leakedSecrets, deadCodeItems.length);
    const healthScore = this.computeHealthScore(
      antipatterns,
      leakedSecrets,
      deadCodeItems,
      pairs,
      godObjects,
    );
    const techDebtHours = this.estimateTechDebt(
      antipatterns,
      deadCodeItems,
      pairs,
      godObjects,
      leakedSecrets,
    );

    const actionPlan = await this.generateActionPlan(
      antipatterns,
      deadCodeItems,
      pairs,
      leakedSecrets,
      topRisks,
    );

    const executiveSummary = this.buildExecutiveSummary(
      healthScore,
      topRisks,
      techDebtHours,
      leakedSecrets.length,
      deadCodeItems.length,
      pairs.length,
    );

    return {
      executiveSummary,
      healthScore,
      topRisks,
      techDebtEstimateHours: techDebtHours,
      criticalFindings,
      actionPlan,
      arquitectura: {
        godObjects,
        circularImports: antipatterns.circularImports,
        highComplexityFunctions: topComplexity,
      },
      seguridad: { leakedSecrets },
      saludCodigo: { codigoMuerto: deadCodeItems, duplicados: pairs.slice(0, 30) },
    };
  }

  private async getGodObjects(
    projectId: string,
    repositoryId: string,
  ): Promise<Array<{ path: string; lineCount?: number; dependencyCount?: number; reason: string }>> {
    const fileLoc = (await this.cypher.executeCypher(
      projectId,
      `MATCH (f:File)-[:CONTAINS]->(fn:Function) WHERE f.projectId = $projectId AND f.repoId = $repoId AND fn.projectId = $projectId AND fn.repoId = $repoId AND fn.loc IS NOT NULL
       WITH f.path as path, sum(fn.loc) as totalLoc
       WHERE totalLoc > 500
       RETURN path, totalLoc ORDER BY totalLoc DESC`,
      { repoId: repositoryId },
    )) as Array<{ path: string; totalLoc: number }>;

    const inCounts = (await this.cypher.executeCypher(
      projectId,
      `MATCH (a:File)-[:IMPORTS]->(b:File) WHERE a.projectId = $projectId AND b.projectId = $projectId
       AND a.repoId = $repoId AND b.repoId = $repoId
       WITH b.path as path, count(a) as inCnt
       RETURN path, inCnt`,
      { repoId: repositoryId },
    )) as Array<{ path: string; inCnt: number }>;

    const outCounts = (await this.cypher.executeCypher(
      projectId,
      `MATCH (a:File)-[:IMPORTS]->(b:File) WHERE a.projectId = $projectId AND b.projectId = $projectId
       AND a.repoId = $repoId AND b.repoId = $repoId
       WITH a.path as path, count(b) as outCnt
       RETURN path, outCnt`,
      { repoId: repositoryId },
    )) as Array<{ path: string; outCnt: number }>;

    const depByPath = new Map<string, number>();
    for (const r of inCounts) depByPath.set(r.path, (depByPath.get(r.path) ?? 0) + r.inCnt);
    for (const r of outCounts) depByPath.set(r.path, (depByPath.get(r.path) ?? 0) + r.outCnt);
    const importCounts = Array.from(depByPath.entries())
      .filter(([, d]) => d > 15)
      .map(([path, depCount]) => ({ path, depCount }))
      .sort((a, b) => b.depCount - a.depCount);

    const byPath = new Map<string, { lineCount?: number; dependencyCount?: number; reason: string }>();
    for (const r of fileLoc) {
      byPath.set(r.path, {
        lineCount: r.totalLoc,
        reason: `Suma de LOC de funciones: ${r.totalLoc} (>500)`,
      });
    }
    for (const r of importCounts) {
      const existing = byPath.get(r.path);
      if (existing) {
        existing.dependencyCount = r.depCount;
        existing.reason += `; Importaciones: ${r.depCount}`;
      } else {
        byPath.set(r.path, { dependencyCount: r.depCount, reason: `Dependencias: ${r.depCount} (>15)` });
      }
    }

    return Array.from(byPath.entries()).map(([path, v]) => ({ path, ...v }));
  }

  private async getTopComplexityFunctions(
    projectId: string,
    repositoryId: string,
    limit: number,
  ): Promise<Array<{ path: string; name: string; complexity: number }>> {
    const rows = (await this.cypher.executeCypher(
      projectId,
      `MATCH (fn:Function) WHERE fn.projectId = $projectId AND fn.repoId = $repoId AND fn.complexity IS NOT NULL AND fn.complexity > 0
       RETURN fn.path as path, fn.name as name, fn.complexity as complexity
       ORDER BY fn.complexity DESC LIMIT ${limit}`,
      { repoId: repositoryId },
    )) as Array<{ path: string; name: string; complexity: number }>;
    return rows;
  }

  private async runSecurityScan(
    repositoryId: string,
    projectId: string,
    _repoSlug: string,
    opts?: { maxFiles?: number },
  ): Promise<Array<{ path: string; severity: string; pattern: string; line?: number }>> {
    const maxFiles = opts?.maxFiles ?? 80;
    const files = (await this.cypher.executeCypher(
      projectId,
      `MATCH (f:File) WHERE f.projectId = $projectId AND f.repoId = $repoId RETURN f.path as path ORDER BY f.path`,
      { repoId: repositoryId },
    )) as Array<{ path: string }>;

    const toScan = files
      .map((r) => r.path)
      .filter((p) => /\.(tsx?|jsx?|js|json|env)$/.test(p.replace(/^[^/]+\//, '')))
      .slice(0, maxFiles);

    const findings: Array<{ path: string; severity: string; pattern: string; line?: number }> = [];
    for (const p of toScan) {
      const content = await this.fileContent.getFileContentSafe(repositoryId, p);
      if (!content) continue;

      const lines = content.split('\n');
      for (const { pattern, severity } of FULL_AUDIT_SECRET_PATTERNS) {
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(pattern);
          if (m && !lines[i].trim().startsWith('//') && !lines[i].trim().startsWith('*')) {
            findings.push({
              path: p.replace(/^[^/]+\//, ''),
              severity,
              pattern: m[0].slice(0, 50) + (m[0].length > 50 ? '…' : ''),
              line: i + 1,
            });
          }
        }
      }
    }
    return findings;
  }

  private buildCriticalFindings(
    antipatterns: Awaited<ReturnType<ChatService['detectAntipatterns']>>,
    deadCode: Array<{ path: string; category: string }>,
    duplicados: Array<{ a: string; b: string }>,
    godObjects: Array<{ path: string; reason: string }>,
    leakedSecrets: Array<{ path: string; severity: string; pattern?: string; line?: number }>,
  ): CriticalFinding[] {
    const findings: CriticalFinding[] = [];

    for (const s of antipatterns.spaghetti.slice(0, 5)) {
      findings.push({
        hallazgo: `Código spaguetti (nesting ${s.nestingDepth})`,
        impacto: 'Difícil de testear y mantener',
        esfuerzo: '1-2h refactor',
        prioridad: 'alta',
        categoria: 'arquitectura',
        path: s.path.replace(/^[^/]+\//, ''),
        name: s.name,
      });
    }
    for (const g of antipatterns.godFunctions.slice(0, 5)) {
      findings.push({
        hallazgo: `God function (${g.outCalls} llamadas salientes)`,
        impacto: 'Alto acoplamiento',
        esfuerzo: '2-4h extraer lógica',
        prioridad: 'alta',
        categoria: 'arquitectura',
        path: g.path.replace(/^[^/]+\//, ''),
        name: g.name,
      });
    }
    for (const [a, b] of antipatterns.circularImports.slice(0, 3)) {
      const pathA = a.replace(/^[^/]+\//, '');
      const pathB = b.replace(/^[^/]+\//, '');
      findings.push({
        hallazgo: `Import circular entre archivos`,
        impacto: 'Riesgo de inicialización incorrecta',
        esfuerzo: '1-2h desacoplar',
        prioridad: 'media',
        categoria: 'arquitectura',
        path: `${pathA} ↔ ${pathB}`,
      });
    }
    for (const s of leakedSecrets.slice(0, 5)) {
      findings.push({
        hallazgo: `Posible secreto expuesto${s.pattern ? `: ${s.pattern}` : ''}`,
        impacto: 'Riesgo de seguridad crítico',
        esfuerzo: '30min migrar a env',
        prioridad: s.severity === 'critica' ? 'critica' : 'alta',
        categoria: 'seguridad',
        path: s.path,
        line: s.line,
      });
    }
    for (const d of deadCode.slice(0, 5)) {
      findings.push({
        hallazgo: `Código muerto sin referencias`,
        impacto: 'Ruido en la codebase',
        esfuerzo: '15-30min eliminar',
        prioridad: 'baja',
        categoria: 'salud',
        path: d.path.replace(/^[^/]+\//, ''),
      });
    }
    for (const o of godObjects.slice(0, 3)) {
      findings.push({
        hallazgo: `God object: ${o.reason}`,
        impacto: 'Archivo monolítico difícil de mantener',
        esfuerzo: '4-8h dividir',
        prioridad: 'media',
        categoria: 'arquitectura',
        path: o.path.replace(/^[^/]+\//, ''),
      });
    }
    for (const p of duplicados.slice(0, 3)) {
      findings.push({
        hallazgo: `Código duplicado semántico`,
        impacto: 'Mantenimiento duplicado',
        esfuerzo: '1-2h consolidar',
        prioridad: 'media',
        categoria: 'salud',
        path: `${p.a} ↔ ${p.b}`,
      });
    }

    return findings
      .sort((x, y) => {
        const order = { critica: 0, alta: 1, media: 2, baja: 3 };
        return (order[x.prioridad] ?? 4) - (order[y.prioridad] ?? 4);
      })
      .slice(0, 25);
  }

  private buildTopRisks(
    antipatterns: Awaited<ReturnType<ChatService['detectAntipatterns']>>,
    leakedSecrets: Array<{ path: string }>,
    deadCodeCount: number,
  ): string[] {
    const risks: string[] = [];
    if (leakedSecrets.length > 0) risks.push(`${leakedSecrets.length} posibles secretos expuestos en código`);
    if (antipatterns.circularImports.length > 0)
      risks.push(`${antipatterns.circularImports.length} import(s) circular(es) detectado(s)`);
    if (antipatterns.spaghetti.length > 0)
      risks.push(`${antipatterns.spaghetti.length} función(es) con anidamiento excesivo (spaguetti)`);
    if (antipatterns.godFunctions.length > 0)
      risks.push(`${antipatterns.godFunctions.length} god function(s) con alto acoplamiento`);
    if (deadCodeCount > 0) risks.push(`${deadCodeCount} archivo(s) candidatos a código muerto`);
    return risks.slice(0, 5);
  }

  private computeHealthScore(
    antipatterns: Awaited<ReturnType<ChatService['detectAntipatterns']>>,
    leakedSecrets: unknown[],
    deadCode: unknown[],
    duplicados: unknown[],
    godObjects: unknown[],
  ): number {
    let score = 100;
    if (leakedSecrets.length > 0) score -= Math.min(25, leakedSecrets.length * 5);
    if (antipatterns.circularImports.length > 0) score -= 10;
    if (antipatterns.spaghetti.length > 5) score -= 15;
    else if (antipatterns.spaghetti.length > 0) score -= 5;
    if (antipatterns.godFunctions.length > 5) score -= 10;
    else if (antipatterns.godFunctions.length > 0) score -= 3;
    if (deadCode.length > 20) score -= 10;
    else if (deadCode.length > 5) score -= 5;
    if (duplicados.length > 10) score -= 5;
    if (godObjects.length > 0) score -= 5;
    return Math.max(0, Math.min(100, score));
  }

  private estimateTechDebt(
    antipatterns: Awaited<ReturnType<ChatService['detectAntipatterns']>>,
    deadCode: Array<{ path: string }>,
    duplicados: unknown[],
    godObjects: Array<{ path: string }>,
    leakedSecrets: unknown[],
  ): number {
    let hours = 0;
    hours += antipatterns.spaghetti.length * 1.5;
    hours += antipatterns.godFunctions.length * 3;
    hours += antipatterns.circularImports.length * 1.5;
    hours += deadCode.length * 0.25;
    hours += Math.min(duplicados.length * 1, 20);
    hours += godObjects.length * 5;
    hours += Math.min(leakedSecrets.length * 0.5, 5);
    return Math.round(hours);
  }

  private buildExecutiveSummary(
    healthScore: number,
    topRisks: string[],
    techDebtHours: number,
    secretCount: number,
    deadCount: number,
    dupCount: number,
  ): string {
    const parts: string[] = [];
    parts.push(`Score de salud: ${healthScore}/100.`);
    if (topRisks.length > 0) parts.push(`Riesgos críticos: ${topRisks.join('; ')}.`);
    parts.push(`Deuda técnica estimada: ~${techDebtHours}h para llevar el proyecto a estado óptimo.`);
    if (secretCount > 0) parts.push(`⚠️ ${secretCount} hallazgo(s) de seguridad (revisar urgente).`);
    if (deadCount > 0) parts.push(`${deadCount} archivo(s) candidatos a código muerto.`);
    if (dupCount > 0) parts.push(`${dupCount} par(es) de código duplicado detectado(s).`);
    return parts.join(' ');
  }

  private async generateActionPlan(
    antipatterns: Awaited<ReturnType<ChatService['detectAntipatterns']>>,
    deadCode: Array<{ path: string }>,
    duplicados: Array<{ a: string; b: string }>,
    leakedSecrets: Array<{ path: string }>,
    topRisks: string[],
  ): Promise<string[]> {
    const plan: string[] = [];
    if (leakedSecrets.length > 0) {
      plan.push('Semana 1: Revisar y migrar secretos a variables de entorno (CRÍTICO).');
    }
    if (antipatterns.circularImports.length > 0) {
      plan.push('Semana 1: Resolver imports circulares priorizando módulos core.');
    }
    if (antipatterns.spaghetti.length > 0 || antipatterns.godFunctions.length > 0) {
      plan.push('Semana 1-2: Refactorizar top 3 funciones spaguetti y god functions.');
    }
    if (duplicados.length > 0) {
      plan.push('Semana 2: Consolidar duplicados semánticos más impactantes.');
    }
    if (deadCode.length > 0) {
      plan.push('Semana 2: Eliminar código muerto verificado (categoría "eliminar").');
    }
    if (plan.length === 0) plan.push('Proyecto en buen estado. Mantener prácticas actuales.');
    return plan.slice(0, 8);
  }

  /** Responde si A importa B y si lo usa (IMPORTS + CALLS o lectura de código para tipos). */
  async answerImportUsage(repositoryId: string, message: string): Promise<string> {
    return this.handlers.answerImportUsage(repositoryId, message);
  }

  /** Responde por qué un archivo/componente es considerado spaghetti u otro antipatrón. */
  async answerWhyAntipattern(repositoryId: string, message: string): Promise<string> {
    return this.handlers.answerWhyAntipattern(repositoryId, message);
  }

  /** Busca archivos y componentes relevantes, lee código y extrae tipos/opciones en lenguaje natural. */
  private async answerTiposOpciones(repositoryId: string, message: string): Promise<string> {
    return this.handlers.answerTiposOpciones(repositoryId, message);
  }

  /** Busca código de cálculos, lee archivos y extrae la lógica en prosa (días, horas, mes, precios). */
  private async answerCalculoAlgoritmo(repositoryId: string, message: string): Promise<string> {
    return this.handlers.answerCalculoAlgoritmo(repositoryId, message);
  }

  /**
   * Describe cómo está implementado un componente/módulo/feature.
   * Respuesta mixta: resumen humano (LLM) + datos del grafo + cypher ejecutado.
   */
  private async answerHowImplemented(
    repositoryId: string,
    message: string,
  ): Promise<{ answer: string; cypher?: string; result?: unknown[] }> {
    return this.handlers.answerHowImplemented(repositoryId, message);
  }

  /** Knowledge agent: Explorer con tools enfocado en get_file_content (tipos/opciones/algoritmos). */
  async runExplorerWithFileContent(
    repositoryId: string,
    projectId: string,
    message: string,
    historyContent?: string,
  ): Promise<{ answer: string; cypher?: string; result?: unknown[] }> {
    return this.handlers.runExplorerReAct(repositoryId, projectId, message, historyContent, 'knowledge');
  }

  /**
   * ReAct: bucle Thought → Action (tool) → Observation. Máx 3 ciclos.
   * Task-Level Scoping: tools según explorerContext (code_analysis | knowledge).
   * @see Architecting Agentic Systems, Arquitectura de Prompts
   */
  async runExplorerReAct(
    repositoryId: string,
    projectId: string,
    message: string,
    historyContent?: string,
    explorerContext: 'code_analysis' | 'knowledge' = 'code_analysis',
  ): Promise<{ answer: string; cypher?: string; result?: unknown[] }> {
    return this.handlers.runExplorerReAct(repositoryId, projectId, message, historyContent, explorerContext);
  }

  /** Responde preguntas sobre qué hace el proyecto usando grafo + README + LLM. */
  async answerProjectOverview(repositoryId: string, message: string): Promise<string> {
    return this.handlers.answerProjectOverview(repositoryId, message);
  }

  private graphInventorySectionMax(): number {
    const raw =
      process.env.CHAT_GRAPH_INVENTORY_FULL_MAX?.trim() ||
      process.env.CHAT_COMPONENT_FULL_MAX?.trim() ||
      '100000';
    return Math.min(Math.max(parseInt(raw, 10) || 100000, 1), 250_000);
  }

  /**
   * Volcado de Component sin sintetizador (`CHAT_COMPONENT_FULL_MAX`).
   */
  private async buildFullComponentListingResponse(projectId: string, scope?: ChatScope): Promise<ChatResponse> {
    const maxRows = Math.min(
      Math.max(parseInt(process.env.CHAT_COMPONENT_FULL_MAX ?? '100000', 10) || 100000, 1),
      250_000,
    );
    const sc = modificationPlanScopeCypher(scope);
    const cypher = `MATCH (f:File)-[:CONTAINS]->(c:Component) WHERE f.projectId = $projectId AND c.projectId = $projectId${sc.fileClause} RETURN c.name as name, coalesce(c.repoId, f.repoId, f.projectId) as repoId, f.path as path, coalesce(c.type, '') as type, c.isLegacy as isLegacy ORDER BY name, path LIMIT ${maxRows}`;
    const rawRows = (await this.cypher.executeCypher(projectId, cypher, sc.params)) as Record<
      string,
      unknown
    >[];
    const rows = filterCypherRowsByScope(rawRows, scope);
    if (rows.length === 0) {
      const emptyMsg =
        rawRows.length === 0
          ? 'No hay nodos `Component` enlazados a archivos en el índice para este alcance. Haz sync/resync o comprueba el `projectId`.'
          : `0 filas tras aplicar el alcance (scope): ${rawRows.length} filas en crudo omitidas por repoIds/prefijos/exclusiones.`;
      return { answer: emptyMsg, cypher, result: [] };
    }
    const table = this.cypher.formatComponentsMarkdownTable(rows);
    const capped = rawRows.length >= maxRows;
    const answer = `## Componentes indexados (${rows.length}${capped ? `, consulta limitada a ${maxRows} filas (CHAT_COMPONENT_FULL_MAX)` : ''})\n\n${table}\n\n_Datos: grafo FalkorDB. Una fila por relación \`(File)-[:CONTAINS]->(Component)\`._`;
    return { answer, cypher, result: rows };
  }

  /**
   * Inventario multi-etiqueta (Component, Hook, Function, DomainConcept) sin sintetizador.
   */
  private async buildFullIndexedInventoryResponse(projectId: string, scope?: ChatScope): Promise<ChatResponse> {
    const maxRows = this.graphInventorySectionMax();
    const sc = modificationPlanScopeCypher(scope);
    const params = sc.params;

    const cypherComp = `MATCH (f:File)-[:CONTAINS]->(c:Component) WHERE f.projectId = $projectId AND c.projectId = $projectId${sc.fileClause} RETURN c.name as name, coalesce(c.repoId, f.repoId, f.projectId) as repoId, f.path as path, coalesce(c.type, '') as type, c.isLegacy as isLegacy ORDER BY name, path LIMIT ${maxRows}`;
    const cypherHook = `MATCH (f:File)-[:CONTAINS]->(h:Hook) WHERE f.projectId = $projectId AND h.projectId = $projectId${sc.fileClause} RETURN h.name as name, coalesce(h.repoId, f.repoId, f.projectId) as repoId, f.path as path ORDER BY name, path LIMIT ${maxRows}`;
    const cypherFn = `MATCH (f:File)-[:CONTAINS]->(fn:Function) WHERE f.projectId = $projectId AND fn.projectId = $projectId${sc.fileClause} RETURN fn.name as name, coalesce(fn.repoId, f.repoId, f.projectId) as repoId, f.path as path, fn.complexity as complexity, fn.loc as loc ORDER BY path, name LIMIT ${maxRows}`;

    let dcExtra = '';
    if (Array.isArray(params.scopeRepoIds) && (params.scopeRepoIds as unknown[]).length > 0) {
      dcExtra = ' AND coalesce(dc.repoId, dc.projectId) IN $scopeRepoIds';
    }
    const cypherDc = `MATCH (dc:DomainConcept) WHERE dc.projectId = $projectId${dcExtra} RETURN dc.name as name, coalesce(dc.repoId, dc.projectId) as repoId, dc.sourcePath as path, coalesce(dc.category, '') as category ORDER BY category, name, path LIMIT ${maxRows}`;

    const [rawComp, rawHook, rawFn, rawDc] = await Promise.all([
      this.cypher.executeCypher(projectId, cypherComp, params),
      this.cypher.executeCypher(projectId, cypherHook, params),
      this.cypher.executeCypher(projectId, cypherFn, params),
      this.cypher.executeCypher(projectId, cypherDc, params),
    ]);

    const comp = filterCypherRowsByScope(rawComp as Record<string, unknown>[], scope);
    const hooks = filterCypherRowsByScope(rawHook as Record<string, unknown>[], scope);
    const fns = filterCypherRowsByScope(rawFn as Record<string, unknown>[], scope);
    const dcs = filterCypherRowsByScope(rawDc as Record<string, unknown>[], scope);

    const sections: string[] = [
      '# Inventario del índice (grafo)',
      '',
      '_Volcado por etiquetas indexadas. Rutas HTTP u otros nodos no incluidos aquí salvo que existan en el grafo con estas etiquetas._',
      `_Cada sección limitada a ${maxRows} filas (\`CHAT_GRAPH_INVENTORY_FULL_MAX\` o \`CHAT_COMPONENT_FULL_MAX\`)._`,
      '',
      `## Componentes (${comp.length})`,
      '',
      this.cypher.formatComponentsMarkdownTable(comp),
      '',
      `## Hooks (${hooks.length})`,
      '',
      this.cypher.formatNameRepoPathMarkdownTable(hooks, 'Hook'),
      '',
      `## Funciones (${fns.length})`,
      '',
      this.cypher.formatFunctionsMarkdownTable(fns),
      '',
      `## Conceptos de dominio (${dcs.length})`,
      '',
      this.cypher.formatDomainConceptsMarkdownTable(dcs),
      '',
    ];

    const answer = sections.join('\n');
    const cypherJoined = [cypherComp, '// ---', cypherHook, '// ---', cypherFn, '// ---', cypherDc].join('\n');
    const result = [
      ...comp.map((r) => ({ ...r, _section: 'Component' })),
      ...hooks.map((r) => ({ ...r, _section: 'Hook' })),
      ...fns.map((r) => ({ ...r, _section: 'Function' })),
      ...dcs.map((r) => ({ ...r, _section: 'DomainConcept' })),
    ];
    return { answer, cypher: cypherJoined, result };
  }

  /**
   * Si el retrieval mezcla `repoId` en chat por proyecto y el mensaje incluye una ruta que resuelve a un único repo,
   * recorta filas y bloques de contexto antes del sintetizador. Desactivar: `CHAT_PREFLIGHT_PATH_REPO=0|false|off`.
   */
  private async tryPreflightNarrowByMessagePath(
    projectId: string,
    userFullText: string,
    collectedResults: unknown[],
    gatheredContext: string,
    projectScope: boolean | undefined,
    scope: ChatScope | undefined,
  ): Promise<{ results: unknown[]; gatheredContext: string } | null> {
    const off = process.env.CHAT_PREFLIGHT_PATH_REPO?.trim().toLowerCase();
    if (off === '0' || off === 'false' || off === 'off') {
      return null;
    }
    if (!projectScope) return null;
    if (scope?.repoIds?.length) return null;

    const mixed = repoIdsInCollectedResults(collectedResults);
    if (mixed.size <= 1) return null;

    const candidates = extractPathCandidatesForRepoResolve(userFullText);
    if (candidates.length === 0) return null;

    const resolved = new Set<string>();
    for (const c of candidates) {
      const r = await this.projects.resolveRepositoryForWorkspacePath(projectId, c);
      if (r.kind === 'unique') {
        resolved.add(r.repositoryId);
      }
    }
    if (resolved.size !== 1) return null;
    const targetRepoId = [...resolved][0]!;

    const mixedLower = new Set([...mixed].map((x) => x.toLowerCase()));
    if (!mixedLower.has(targetRepoId.toLowerCase())) return null;

    const repos = await this.repos.findAll(projectId);
    const projectRepoIdSet = new Set(repos.map((r) => r.id));
    const results = filterCollectedResultsByTargetRepo(collectedResults, targetRepoId);
    const gc = filterGatheredContextByTargetRepo(gatheredContext, targetRepoId, projectRepoIdSet);
    return { results, gatheredContext: gc };
  }

  /**
   * Propaga HTTP del orchestrator (p. ej. 429 Kimi TPM) para que MCP/The Forge no lo confundan con timeout genérico.
   */
  private throwOrchestratorFailure(res: Response, bodyText: string): never {
    const status = res.status;
    const msg = bodyText?.trim() || res.statusText || 'upstream error';
    if (status === 429) {
      throw new HttpException(
        { code: 'ORCHESTRATOR_RATE_LIMIT', message: msg, upstream: 'orchestrator' },
        429,
      );
    }
    if (status === 503) {
      throw new HttpException(
        { code: 'ORCHESTRATOR_UPSTREAM_UNAVAILABLE', message: msg, upstream: 'orchestrator' },
        503,
      );
    }
    const mapped = status >= 400 && status < 600 ? status : 502;
    throw new HttpException({ code: 'ORCHESTRATOR_ERROR', message: msg, upstream: 'orchestrator' }, mapped);
  }

  /**
   * Pipeline unificado: Retriever (Cypher + archivos + RAG) → Synthesizer (respuesta siempre humana).
   * Todas las preguntas pasan por extracción de código con Falkor/Cypher/RAG y luego síntesis en prosa.
   * @param {string} repositoryId - ID del repositorio (proyecto indexado).
   * @param {ChatRequest} req - Mensaje y opcional historial de chat.
   * @returns {Promise<ChatResponse>} answer (texto), y opcionalmente cypher y result.
   */
  async chat(repositoryId: string, req: ChatRequest): Promise<ChatResponse> {
    const orch = process.env.ORCHESTRATOR_URL?.trim();
    if (orch) {
      try {
        const url = `${orch.replace(/\/$/, '')}/codebase/chat/repository/${encodeURIComponent(repositoryId)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        });
        if (!res.ok) {
          const t = await res.text();
          this.throwOrchestratorFailure(res, t);
        }
        return (await res.json()) as ChatResponse;
      } catch (err) {
        recordChatPipelineError();
        if (err instanceof HttpException) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        return { answer: `Error: ${msg}` };
      }
    }

    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);
    const historyContent = (req.history ?? [])
      .slice(-8)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    try {
      return await this.runUnifiedPipeline(
        repositoryId,
        projectId,
        req.message,
        historyContent,
        {
          scope: req.scope,
          twoPhase: req.twoPhase,
          responseMode: req.responseMode,
          deterministicRetriever: req.deterministicRetriever,
        },
      );
    } catch (err) {
      recordChatPipelineError();
      const msg = err instanceof Error ? err.message : String(err);
      return { answer: `Error: ${msg}` };
    }
  }

  /**
   * Chat a nivel proyecto: consulta el grafo de todo el proyecto y puede leer archivos de cualquier repo.
   * Usa el primer repo del proyecto para get_graph_summary; get_file_content busca en todos los repos.
   * @param {string} projectId - ID del proyecto (multi-root).
   * @param {ChatRequest} req - Mensaje y opcional historial.
   * @returns {Promise<ChatResponse>} answer, cypher y result.
   */
  async chatByProject(projectId: string, req: ChatRequest): Promise<ChatResponse> {
    const orch = process.env.ORCHESTRATOR_URL?.trim();
    if (orch) {
      try {
        const url = `${orch.replace(/\/$/, '')}/codebase/chat/project/${encodeURIComponent(projectId)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        });
        if (!res.ok) {
          const t = await res.text();
          this.throwOrchestratorFailure(res, t);
        }
        return (await res.json()) as ChatResponse;
      } catch (err) {
        recordChatPipelineError();
        if (err instanceof HttpException) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        return { answer: `Error: ${msg}` };
      }
    }

    const repos = await this.repos.findAll(projectId);
    if (repos.length === 0) {
      const maybeRepo = await this.repos.findOptionalById(projectId);
      if (maybeRepo) {
        return this.chat(projectId, req);
      }
      return { answer: 'Este proyecto no tiene repositorios indexados. Añade al menos un repo y haz sync.' };
    }

    const strictChat = req.strictChatScope !== false;
    let effectiveScope = req.scope;
    let scopeAnchorRepoId = repos[0]!.id;
    let roleInferenceClientMeta: ChatClientMeta | undefined;

    if (repos.length > 1 && strictChat && !hasExplicitChatScopeNarrowing(req.scope)) {
      let inferred: ProjectRepoRoleCandidate[] | null = null;
      if (isChatRoleScopeInferenceEnabled()) {
        const proj = await this.projects.findOne(projectId);
        inferred = proj.repositories.map((row) => ({
          repoId: row.id,
          role: row.role ?? null,
          label: `${row.projectKey}/${row.repoSlug}`.replace(/^\/|\/$/g, '') || row.id,
        }));
        const resolved = inferChatRepoScopeFromMessage(req.message, inferred);
        if (resolved.kind === 'unique') {
          effectiveScope = { ...(req.scope ?? {}), repoIds: [resolved.repoId] };
          scopeAnchorRepoId = resolved.repoId;
          roleInferenceClientMeta = {
            ...req.clientMeta,
            scopeSource: 'ingest_role_message',
            scopeInferred: true,
          };
        } else if (resolved.kind === 'ambiguous') {
          const lines = repos.map((r) => `- \`${r.projectKey}/${r.repoSlug}\` → \`repoId\`: \`${r.id}\``);
          const hint =
            resolved.reason === 'multi_bucket'
              ? 'El mensaje mezcla varios ámbitos (p. ej. frontend y backend); acota con `scope.repoIds` o divide la pregunta.'
              : resolved.reason === 'multi_repo_same_bucket'
                ? 'Varios repositorios comparten el mismo tipo de rol para lo que pediste; elige un `repoId` explícito en `scope`.'
                : 'Varias coincidencias por texto del rol en el mensaje; usa `scope.repoIds` con un solo uuid.';
          return {
            answer: [
              '[AMBIGUOUS_SCOPE]',
              '',
              hint,
              '',
              'El proyecto tiene varios repositorios y no se indicó un alcance explícito (`scope.repoIds`, prefijos o globs).',
              'Envía `scope: { repoIds: ["<uuid>"] }` o, para chat amplio, `strictChatScope: false`.',
              '',
              '**Candidatos:**',
              ...lines,
            ].join('\n'),
          };
        }
      }

      if (!hasExplicitChatScopeNarrowing(effectiveScope)) {
        const lines = repos.map((r) => `- \`${r.projectKey}/${r.repoSlug}\` → \`repoId\`: \`${r.id}\``);
        const roleHint =
          isChatRoleScopeInferenceEnabled() && inferred?.some((c) => (c.role ?? '').trim().length > 0)
            ? 'Si la pregunta cita solo un ámbito (p. ej. «frontend», «backend», «librería»), revisa que el **rol** de cada repo en el proyecto coincida con esas palabras; si no hay match, define roles en el proyecto o pasa `scope.repoIds`. '
            : 'Define **roles** por repositorio en el proyecto o pasa `scope.repoIds`. ';
        return {
          answer: [
            '[AMBIGUOUS_SCOPE]',
            '',
            'El proyecto tiene varios repositorios y no se indicó un alcance explícito (`scope.repoIds`, prefijos o globs).',
            roleHint,
            'Envía `scope: { repoIds: ["<uuid>"] }` o, para chat amplio, `strictChatScope: false`.',
            '',
            '**Candidatos:**',
            ...lines,
          ].join('\n'),
        };
      }
    }

    if (repos.length > 1 && hasExplicitChatScopeNarrowing(effectiveScope) && effectiveScope?.repoIds?.length === 1) {
      scopeAnchorRepoId = effectiveScope.repoIds[0]!;
    }

    const firstRepoId = scopeAnchorRepoId;
    const projectRepoRolesContext = await this.projects.getRepositoryRolesContext(projectId);
    const historyContent = (req.history ?? [])
      .slice(-8)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    try {
      return await this.runUnifiedPipeline(
        firstRepoId,
        projectId,
        req.message,
        historyContent,
        {
          projectScope: true,
          scope: effectiveScope,
          twoPhase: req.twoPhase,
          responseMode: req.responseMode,
          deterministicRetriever: req.deterministicRetriever,
          projectRepoRolesContext,
          clientMeta: roleInferenceClientMeta ?? req.clientMeta,
        },
      );
    } catch (err) {
      recordChatPipelineError();
      const msg = err instanceof Error ? err.message : String(err);
      return { answer: `Error: ${msg}` };
    }
  }

  /**
   * Cuando el retriever no devolvió texto pero existen archivos en el grafo o manifiestos en remoto,
   * inyecta muestra de paths + lectura de package.json / prisma / env / tsconfig / openapi.
   */
  /**
   * Expuesto vía POST /internal/repositories/:id/mdd-evidence (orchestrator) para JSON MDD sin duplicar lógica.
   */
  async buildMddEvidenceForRepository(
    repositoryId: string,
    projectId: string,
    message: string,
    gatheredContext: string,
    collectedResults: unknown[],
    projectScope: boolean,
  ): Promise<MddEvidenceDocument> {
    let gc = gatheredContext;
    let cr = collectedResults;
    if (!gc.trim()) {
      const fb = await this.injectPhysicalEvidenceFallback(repositoryId, projectId, projectScope);
      if (fb.gathered.trim()) {
        gc = fb.gathered;
        cr = [...cr, ...fb.results];
      }
    }
    return buildMddEvidenceDocument({
      projectId,
      message,
      gatheredContext: gc,
      collectedResults: cr,
      executeCypher: (pid, q, p) => this.cypher.executeCypher(pid, q, p),
      getFileSnippet: async (relPath) =>
        projectScope
          ? this.fileContent.getFileContentSafeByProject(projectId, relPath)
          : this.fileContent.getFileContentSafe(repositoryId, relPath),
    });
  }

  private async injectPhysicalEvidenceFallback(
    repositoryId: string,
    projectId: string,
    projectScope: boolean,
  ): Promise<{ gathered: string; results: unknown[] }> {
    const results: unknown[] = [];
    const chunks: string[] = [];
    const fbLim = getMddPhysicalEvidenceLimits();
    let fileCount = 0;
    try {
      const cnt = (await this.cypher.executeCypher(
        projectId,
        `MATCH (f:File {projectId: $projectId}) RETURN count(f) AS c`,
        {},
      )) as Array<{ c?: number }>;
      fileCount = Number(cnt[0]?.c ?? 0);
    } catch {
      fileCount = 0;
    }
    if (fileCount > 0) {
      try {
        const paths = (await this.cypher.executeCypher(
          projectId,
          `MATCH (f:File {projectId: $projectId}) RETURN f.path AS path LIMIT ${fbLim.graphFilePaths}`,
          {},
        )) as Array<{ path?: string }>;
        for (const p of paths) {
          if (p.path) results.push({ path: p.path, source: 'graph_file_sample' });
        }
        chunks.push(
          `[Índice Falkor: ${fileCount} nodos File; muestra de paths]\n${paths.map((x) => x.path).filter(Boolean).join('\n')}`,
        );
      } catch {
        /* ignore */
      }
    }
    const candidates = [
      'package.json',
      'prisma/schema.prisma',
      'schema.prisma',
      '.env.example',
      'tsconfig.json',
      'swagger.json',
      'openapi.yaml',
    ];
    for (const rel of candidates) {
      const content = projectScope
        ? await this.fileContent.getFileContentSafeByProject(projectId, rel)
        : await this.fileContent.getFileContentSafe(repositoryId, rel);
      if (content && content.length > 0) {
        chunks.push(`--- ${rel} ---\n${content.slice(0, fbLim.fileSnippetChars)}`);
        results.push({ path: rel, source: 'mandatory_file_read' });
      }
    }
    return { gathered: chunks.join('\n\n'), results };
  }

  /**
   * Retrieval fijo (sin ReAct LLM) para `responseMode: raw_evidence` + `deterministicRetriever`.
   * Orden: get_graph_summary → semantic_search (una vez por repo si `projectScope`, embeddings + filtro `repoId` por `CHAT_DETERMINISTIC_SEMANTIC_REPO_MAX`) → paths `File` persistencia (…; límite `CHAT_DETERMINISTIC_FILE_SAMPLE_LIMIT`).
   */
  private async runDeterministicRetrieverForRawEvidence(
    repositoryId: string,
    projectId: string,
    message: string,
    scope: ChatScope | undefined,
    projectScope: boolean | undefined,
  ): Promise<{ collectedToolOutputs: string[]; collectedResults: unknown[]; lastCypher: string }> {
    const evidenceVerbosity = 'full' as const;
    const ps = Boolean(projectScope);
    const collectedToolOutputs: string[] = [];
    const collectedResults: unknown[] = [];
    let lastCypher = '';

    const pushTool = async (label: string, req: RetrieverToolRequest) => {
      const r = await this.retrieverTools.executeTool(repositoryId, projectId, req);
      if (r.lastCypher) lastCypher = r.lastCypher;
      collectedResults.push(...r.collectedRows);
      collectedToolOutputs.push(`[deterministic:${label}]\n${r.toolResult}`);
    };

    await pushTool('get_graph_summary', {
      projectScope: ps,
      scope,
      tool: 'get_graph_summary',
      arguments: {},
      evidenceVerbosity,
    });
    const q = message.trim().slice(0, 4000);
    if (ps) {
      const maxFanRaw = parseInt(process.env.CHAT_DETERMINISTIC_SEMANTIC_REPO_MAX ?? '24', 10);
      const maxFan = Math.min(50, Math.max(1, Number.isFinite(maxFanRaw) ? maxFanRaw : 24));
      const projectRepos = await this.repos.findAll(projectId);
      let repoIds = projectRepos.map((r) => r.id);
      if (scope?.repoIds?.length) {
        const allow = new Set(scope.repoIds);
        repoIds = repoIds.filter((id) => allow.has(id));
      }
      if (repoIds.length === 0) repoIds = [repositoryId];
      repoIds = repoIds.slice(0, maxFan);
      for (const rid of repoIds) {
        await pushTool(`semantic_search:${rid}`, {
          projectScope: false,
          scope,
          tool: 'semantic_search',
          arguments: { query: q },
          fallbackMessage: q,
          evidenceVerbosity,
          embeddingRepositoryId: rid,
          semanticRestrictRepoId: rid,
        });
      }
    } else {
      await pushTool('semantic_search', {
        projectScope: false,
        scope,
        tool: 'semantic_search',
        arguments: { query: q },
        fallbackMessage: q,
        evidenceVerbosity,
      });
    }
    const limRaw = parseInt(process.env.CHAT_DETERMINISTIC_FILE_SAMPLE_LIMIT ?? '400', 10);
    const fileLimit = Math.min(2000, Math.max(20, Number.isFinite(limRaw) ? limRaw : 400));
    /** Alineado con `schema-relational-rag-doc.ts` (path virtual del MarkdownDoc de esquema). */
    const schemaRagVirtualPath = 'ariadne-internal/relational-schema-rag-index.md';
    const p = 'toLower(f.path)';
    const dbRelatedWhere = `(
  ${p} ENDS WITH '.prisma'
  OR ${p} ENDS WITH '.entity.ts' OR ${p} ENDS WITH '.entity.tsx'
  OR ${p} CONTAINS '/entities/'
  OR ${p} ENDS WITH 'datasource.ts'
  OR ${p} CONTAINS '/migrations/' OR ${p} CONTAINS '/migration/'
  OR f.path = ${cypherSafe(schemaRagVirtualPath)}
)`;
    const matchFile = ps
      ? `MATCH (f:File {projectId: $projectId}) WHERE ${dbRelatedWhere}`
      : `MATCH (f:File {projectId: $projectId, repoId: ${cypherSafe(repositoryId)}}) WHERE ${dbRelatedWhere}`;
    const cypher = `${matchFile} RETURN DISTINCT f.path AS path ORDER BY f.path LIMIT ${fileLimit}`;
    await pushTool('file_path_sample', {
      projectScope: ps,
      scope,
      tool: 'execute_cypher',
      arguments: { cypher },
      fallbackMessage: message,
      evidenceVerbosity,
    });

    return { collectedToolOutputs, collectedResults, lastCypher };
  }

  /**
   * Expuesto vía POST /internal/repositories/:id/raw-evidence-deterministic (orchestrator con raw_evidence + deterministicRetriever).
   */
  async gatherDeterministicRawEvidence(
    repositoryId: string,
    body: { message: string; scope?: ChatScope; projectScope?: boolean },
  ): Promise<{ gatheredContext: string; collectedResults: unknown[]; lastCypher: string }> {
    const projectId = await this.resolveProjectIdForRepo(repositoryId);
    const { collectedToolOutputs, collectedResults, lastCypher } =
      await this.runDeterministicRetrieverForRawEvidence(
        repositoryId,
        projectId,
        body.message ?? '',
        body.scope,
        body.projectScope,
      );
    return {
      gatheredContext: collectedToolOutputs.join('\n\n---\n\n'),
      collectedResults,
      lastCypher,
    };
  }

  /** Si el modelo volcó Cypher en markdown en vez de tool_calls, extrae una consulta ejecutable. */
  private extractCypherFenceFromAssistant(content?: string | null): string | null {
    if (!content?.trim()) return null;
    const fenced = content.match(/```(?:cypher)?\s*([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();
    const singleLine = content.match(/^MATCH\s[\s\S]+$/m);
    if (singleLine) return singleLine[0].trim();
    return null;
  }

  /**
   * Fase 1 (Retriever): ReAct con tools — recopila datos vía Cypher, get_file_content, semantic_search.
   * Fase 2 (Synthesizer): LLM recibe contexto y produce respuesta SIEMPRE en forma humana (prosa, explicación).
   * @param options.projectScope - Si true, get_file_content busca en todos los repos del proyecto (chat por proyecto).
   * @param options.scope - Filtro repoIds / prefijos / globs (§2).
   * @param options.twoPhase - Si true, inyecta JSON de retrieval antes del contexto bruto (§3); default env `CHAT_TWO_PHASE`.
   * @param options.responseMode - `evidence_first`: MDD vía buildMddEvidenceDocument. `raw_evidence`: JSON con contexto de herramientas sin sintetizador ni MDD.
   * @param options.deterministicRetriever - Con `raw_evidence`: retrieval fijo sin ReAct LLM.
   */
  private async runUnifiedPipeline(
    repositoryId: string,
    projectId: string,
    message: string,
    historyContent?: string,
    options?: {
      projectScope?: boolean;
      scope?: ChatScope;
      twoPhase?: boolean;
      responseMode?: 'default' | 'evidence_first' | 'raw_evidence';
      deterministicRetriever?: boolean;
      projectRepoRolesContext?: string;
      clientMeta?: ChatClientMeta;
    },
  ): Promise<ChatResponse> {
    const pipelineStarted = process.hrtime.bigint();
    const projectScopeForMetrics = Boolean(options?.projectScope);
    const scope = options?.scope;
    if (wantsFullComponentListing(message)) {
      return this.buildFullComponentListingResponse(projectId, scope);
    }
    if (wantsFullGenericIndexedInventory(message)) {
      return this.buildFullIndexedInventoryResponse(projectId, scope);
    }
    const rawEvidence = options?.responseMode === 'raw_evidence';
    const evidenceFirst = !rawEvidence && options?.responseMode === 'evidence_first';
    const useTwoPhase = rawEvidence || evidenceFirst ? true : (options?.twoPhase ?? defaultTwoPhaseFromEnv());
    const evidenceVerbosity = rawEvidence ? ('full' as const) : ('default' as const);
    const deterministicRaw = rawEvidence && Boolean(options?.deterministicRetriever);

    let lastCypher = '';
    const collectedToolOutputs: string[] = [];
    const collectedResults: unknown[] = [];

    if (deterministicRaw) {
      const d = await this.runDeterministicRetrieverForRawEvidence(
        repositoryId,
        projectId,
        message,
        scope,
        options?.projectScope,
      );
      lastCypher = d.lastCypher;
      collectedToolOutputs.push(...d.collectedToolOutputs);
      collectedResults.push(...d.collectedResults);
    } else {
      const maxRetrieverTurns = rawEvidence
        ? Math.min(20, Math.max(4, parseInt(process.env.CHAT_RAW_EVIDENCE_RETRIEVER_MAX_TURNS ?? '10', 10) || 10))
        : 4;
      const tools = EXPLORER_TOOLS_ALL;
      const retrieverSystem = `<instrucciones>
Actúa como **Coordinador** y **Validador** (ask_codebase agéntico).

**Coordinador:** Si la pregunta implica datos, API, esquema o contratos, combina grafo Falkor con archivos físicos: schema.prisma, entidades TypeORM (:Model source=typeorm), swagger/openapi (File openApiTruth / :OpenApiOperation), package.json, .env.example, tsconfig.

**Validador:** Contrasta resultados Cypher con contenidos leídos; evidencia solo con paths reales.

**Recolector:** Usa herramientas para reunir datos relevantes.

Plan: 1) execute_cypher o get_graph_summary. 2) get_file_content en paths relevantes. 3) semantic_search si aplica.

**Modelos:** Prisma (m.source=prisma), TypeORM (m.source=typeorm). **API:** OpenApiOperation (swagger) con prioridad sobre inferencia AST (NestController). **Env:** .env.example.

**Monorepos:** Explora apps/* y packages/*.

**Grounding:** No inventes rutas. Si 0 filas, repórtalo.

**Herramientas:** No pegues Cypher en el chat ni en markdown; usa siempre **execute_cypher** (o get_graph_summary / get_file_content / semantic_search según aplique).

NO escribas la respuesta final al usuario. Máx ${maxRetrieverTurns} turnos.
</instrucciones>

<schema_cypher>
${SCHEMA}${EXAMPLES}
</schema_cypher>`;

      const userContent = historyContent
        ? `${historyContent}\n\n<user>${message}</user>`
        : `<user>${message}</user>`;

      const messages: Array<
        | { role: 'user' | 'system'; content: string }
        | { role: 'assistant'; content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }
        | { role: 'tool'; tool_call_id: string; content: string }
      > = [
          { role: 'system', content: retrieverSystem },
          { role: 'user', content: userContent },
        ];

      for (let turn = 0; turn < maxRetrieverTurns; turn++) {
        const resp = await this.llm.callLlmWithTools(messages, tools);

        if (!resp.tool_calls?.length) {
          const fenced = this.extractCypherFenceFromAssistant(resp.content);
          if (fenced) {
            try {
              const r = await this.retrieverTools.executeTool(repositoryId, projectId, {
                projectScope: options?.projectScope,
                scope,
                tool: 'execute_cypher',
                arguments: { cypher: fenced },
                fallbackMessage: message,
                evidenceVerbosity,
              });
              if (r.lastCypher) lastCypher = r.lastCypher;
              collectedResults.push(...r.collectedRows);
              collectedToolOutputs.push(
                `[fallback: Cypher detectado en texto del modelo]\n${r.toolResult}`,
              );
            } catch (err) {
              collectedToolOutputs.push(
                `[fallback Cypher] Error: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
          break;
        }

        for (const tc of resp.tool_calls) {
          const fn = tc.function;
          let toolResult: string;
          try {
            const args = JSON.parse(fn.arguments) as Record<string, unknown>;
            const r = await this.retrieverTools.executeTool(repositoryId, projectId, {
              projectScope: options?.projectScope,
              scope,
              tool: fn.name as RetrieverToolName,
              arguments: args,
              fallbackMessage: message,
              evidenceVerbosity,
            });
            if (r.lastCypher) lastCypher = r.lastCypher;
            collectedResults.push(...r.collectedRows);
            toolResult = r.toolResult;
          } catch (err) {
            toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }
          collectedToolOutputs.push(toolResult);
          messages.push(
            { role: 'assistant', content: null, tool_calls: [tc] },
            { role: 'tool', tool_call_id: tc.id, content: toolResult },
          );
        }
      }
    }

    const gatheredContext = collectedToolOutputs.join('\n\n---\n\n');
    let effectiveResults = collectedResults;
    let effectiveGathered = gatheredContext;
    let preflightPathRepoApplied = false;
    if (!rawEvidence) {
      const narrowed = await this.tryPreflightNarrowByMessagePath(
        projectId,
        `${historyContent ?? ''}\n${message}`,
        collectedResults,
        gatheredContext,
        options?.projectScope,
        scope,
      );
      if (narrowed) {
        effectiveResults = narrowed.results;
        effectiveGathered = narrowed.gatheredContext;
        preflightPathRepoApplied = true;
      }
    }

    if (!effectiveGathered.trim()) {
      const fb = await this.injectPhysicalEvidenceFallback(
        repositoryId,
        projectId,
        Boolean(options?.projectScope),
      );
      if (fb.gathered.trim()) {
        effectiveGathered = fb.gathered;
        effectiveResults = [...effectiveResults, ...fb.results];
      }
    }

    if (rawEvidence) {
      const jsonAnswer = JSON.stringify(
        {
          mode: 'raw_evidence',
          deterministicRetriever: Boolean(options?.deterministicRetriever),
          gatheredContext: effectiveGathered,
          collectedResults: effectiveResults,
          cypher: lastCypher || undefined,
        },
        null,
        2,
      );
      const durationSec = Number(process.hrtime.bigint() - pipelineStarted) / 1e9;
      observeChatPipelineComplete({
        durationSeconds: durationSec,
        projectScope: projectScopeForMetrics,
        useTwoPhase,
        gatheredContext: effectiveGathered,
        answer: jsonAnswer,
        collectedResults: effectiveResults,
      });
      return {
        answer: jsonAnswer,
        cypher: lastCypher || undefined,
        result: effectiveResults.length > 0 ? effectiveResults : undefined,
      };
    }

    if (evidenceFirst) {
      const mdd = await buildMddEvidenceDocument({
        projectId,
        message,
        gatheredContext: effectiveGathered,
        collectedResults: effectiveResults,
        executeCypher: (pid, q, p) => this.cypher.executeCypher(pid, q, p),
        getFileSnippet: async (relPath) =>
          options?.projectScope
            ? this.fileContent.getFileContentSafeByProject(projectId, relPath)
            : this.fileContent.getFileContentSafe(repositoryId, relPath),
      });
      const jsonAnswer = JSON.stringify(mdd, null, 2);
      const durationSec = Number(process.hrtime.bigint() - pipelineStarted) / 1e9;
      observeChatPipelineComplete({
        durationSeconds: durationSec,
        projectScope: projectScopeForMetrics,
        useTwoPhase,
        gatheredContext: effectiveGathered,
        answer: jsonAnswer,
        collectedResults: effectiveResults,
      });
      return {
        answer: jsonAnswer,
        cypher: lastCypher || undefined,
        result: effectiveResults.length > 0 ? effectiveResults : undefined,
        mddDocument: mdd,
      };
    }

    const retrievalJson =
      effectiveResults.length > 0 || effectiveGathered.trim().length > 0
        ? buildRetrievalSummaryJson(effectiveResults, effectiveGathered)
        : '';
    const evidenceFirstMaxChars = (() => {
      const n = parseInt(process.env.CHAT_EVIDENCE_FIRST_MAX_CHARS ?? '18000', 10);
      return Number.isFinite(n) && n >= 4000 ? Math.min(n, 100_000) : 18000;
    })();
    const twoPhaseContextCap = evidenceFirst ? evidenceFirstMaxChars : 12_000;
    const rawContextForSynth =
      useTwoPhase && effectiveGathered.trim()
        ? effectiveGathered.slice(0, twoPhaseContextCap)
        : effectiveGathered;
    const evidenceFirstBlock = evidenceFirst
      ? `## Modo evidence_first (SDD / documentación)
- **Primera sección obligatoria:** \`## Evidencia\` — tabla o viñetas: \`path\` | hecho o símbolo **literal** del contexto siguiente.
- **Segunda sección:** \`## Resumen\` — máximo 6 viñetas; solo repite hechos ya en Evidencia.
- Prioriza **listas** sobre prosa larga. **PROHIBIDO** añadir archivos, stacks o APIs que no aparezcan en el contexto.
- Si un tema no está en el contexto: **(no consta en el índice)** — no inventes.

`
      : '';
    const rolesCtx = options?.projectRepoRolesContext?.trim();
    const rolesBlock = rolesCtx
      ? `

## Repositorios y roles (multi-root)
${rolesCtx}

Si la pregunta es sobre un **ámbito concreto** (backend vs frontend vs librería), prioriza el repositorio cuyo **rol** encaje; usa \`repoId\` en evidencia cuando aparezca en el contexto.
`
      : '';
    const synthesizerSystem = `${evidenceFirstBlock}## Rol
Eres un experto que explica código a colegas. Recibes **solo** datos crudos del contexto (Cypher, archivos, búsquedas) — son la única fuente de verdad para rutas y símbolos.${rolesBlock}

## Instrucciones
- Responde SIEMPRE en prosa clara, como lo haría un desarrollador senior.
- Explica procesos, flujos, impacto: "cómo es el proceso de X", "qué pasa si cambio Y", "qué componentes usan Z".
- Síntetiza: abstrae el flujo; no repitas listas crudas sin sentido (excepto cuando pidan listado explícito).
- Si preguntan por un proceso (ej. consulta a Falkor): describe el flujo paso a paso en lenguaje natural.
- **Sección "## Evidencia" (obligatoria si citas archivos, rutas, imports o porcentajes):** Lista en formato tabla o viñetas **solo** hechos presentes en el contexto: \`path\` | símbolo o detalle detectado | \`repoId\` (si aparece en los datos). Si el contexto no menciona repoId, omite esa columna. **PROHIBIDO** inventar filas de evidencia.
- **Inventario (flujos):** Tras explicar el flujo, puedes incluir "Este proceso involucra…" solo con archivos/funciones **mencionados en el contexto**. Si un path dice "No se pudo leer", indica que no está disponible en el repo indexado.
- **Reporte detallado / listado completo:** Si piden "reporte detallado", "listado de todos", "código no utilizado" → INCLUYE el listado completo **de los datos recibidos**, no ejemplos inventados.

## Restricciones (grounding)
- Si el contexto indica **0 filas**, **sin datos en índice**, o diagnóstico de embeddings vacío: dilo explícitamente (**"sin datos en índice para este alcance"** o la razón dada). **PROHIBIDO** rellenar con suposiciones, rutas genéricas o "puede que…".
- PROHIBIDO listas de paths o porcentajes que no aparezcan en el contexto.
- **Listas "archivos a modificar":** solo rutas literales del contexto. Si no hay ninguna: **sin datos en índice para este alcance**.
- En español. 200-500 palabras para procesos salvo listados explícitos.`;

    const structuredBlock =
      useTwoPhase && retrievalJson
        ? `## Resumen estructurado del retrieval (prioridad — fase 1)
${retrievalJson}

`
        : '';
    const synthesizerUser = `Pregunta del usuario: "${message}"

${structuredBlock}Contexto reunido (datos del grafo y código — referencia${useTwoPhase ? '; prioriza el JSON de arriba para citas' : ''}):

${rawContextForSynth || '**sin datos en índice para este alcance** (no hay salidas de herramientas con filas ni archivos leídos). Indícalo sin inventar rutas; sugiere sync/resync o ampliar la búsqueda.'}

---
Sintetiza una respuesta clara. Si no hay datos útiles, di explícitamente **sin datos en índice para este alcance**.`;

    let answer: string;
    if (effectiveGathered.trim()) {
      answer = await this.llm.callLlm(
        [
          { role: 'system', content: synthesizerSystem },
          { role: 'user', content: synthesizerUser },
        ],
        evidenceFirst ? 3072 : 2048,
      );
    } else {
      answer =
        '**sin datos en índice para este alcance** — no se obtuvo contexto desde las herramientas (Cypher/archivos/RAG). Verifica sync/resync del repositorio o reformula la pregunta.';
    }

    const telemetryEnabled = process.env.CHAT_TELEMETRY_LOG === '1' || process.env.CHAT_TELEMETRY_LOG === 'true';
    if (telemetryEnabled) {
      const pathLike = /\b[\w.-]+\/[\w./-]+\.(tsx?|jsx?|mjs|cjs)\b/g;
      const pathsInAnswer = answer.match(pathLike) ?? [];
      const uniquePaths = new Set(pathsInAnswer);
      const grounding = sampleHallucinationPathMetrics(answer, effectiveGathered, effectiveResults);
      this.logger.log(
        JSON.stringify({
          event: 'chat_unified_pipeline',
          repositoryId,
          projectId,
          chat_scope_effective: {
            repositoryId,
            projectId,
            repoIdsFromScope: scope?.repoIds ?? [],
            repoIdsEffective:
              scope?.repoIds?.length && scope.repoIds.length > 0
                ? scope.repoIds
                : options?.projectScope
                  ? []
                  : [repositoryId],
            clientScopeSource: options?.clientMeta?.scopeSource ?? null,
            inferred: options?.clientMeta?.scopeInferred ?? false,
            ambiguous: options?.clientMeta?.scopePotentiallyAmbiguous ?? false,
            preflightPathRepoApplied,
            projectScope: options?.projectScope ?? false,
            scopeFilterActive: Boolean(
              scope?.repoIds?.length || scope?.includePathPrefixes?.length || scope?.excludePathGlobs?.length,
            ),
          },
          projectScope: options?.projectScope ?? false,
          scopeActive: Boolean(
            scope?.repoIds?.length || scope?.includePathPrefixes?.length || scope?.excludePathGlobs?.length,
          ),
          twoPhase: useTwoPhase,
          responseMode: rawEvidence ? 'raw_evidence' : evidenceFirst ? 'evidence_first' : 'default',
          messageChars: message.length,
          contextChars: effectiveGathered.length,
          toolOutputChunks: collectedToolOutputs.length,
          collectedRowGroups: effectiveResults.length,
          answerChars: answer.length,
          answerPathCitations: uniquePaths.size,
          pathGroundingHits: grounding.pathGroundingHits,
          pathGroundingRatio: grounding.pathGroundingRatio,
          pathCitationsUnique: grounding.pathCitationsUnique,
        }),
      );
    }

    const durationSec = Number(process.hrtime.bigint() - pipelineStarted) / 1e9;
    observeChatPipelineComplete({
      durationSeconds: durationSec,
      projectScope: projectScopeForMetrics,
      useTwoPhase,
      gatheredContext: effectiveGathered,
      answer,
      collectedResults: effectiveResults,
    });

    return {
      answer: answer.trim(),
      cypher: lastCypher || undefined,
      result: effectiveResults.length > 0 ? effectiveResults : undefined,
    };
  }
}
