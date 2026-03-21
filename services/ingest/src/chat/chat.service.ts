/**
 * Chat con el repositorio: NL → Cypher → FalkorDB.
 * Pipeline unificado: Retriever (Cypher + archivos + RAG) → Synthesizer (respuesta siempre humana).
 */

import { Injectable, Logger } from '@nestjs/common';
import { FalkorDB } from 'falkordb';
import { getFalkorConfig, GRAPH_NAME } from '../pipeline/falkor';
import { RepositoriesService } from '../repositories/repositories.service';
import { FileContentService } from '../repositories/file-content.service';
import { EmbeddingService } from '../embedding/embedding.service';
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
import { ProjectsService } from '../projects/projects.service';
import {
  type ChatScope,
  filterCypherRowsByScope,
  matchesChatScope,
} from './chat-scope.util';

/** Mensaje del historial de chat (usuario o asistente). */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  cypher?: string;
  result?: unknown[];
}

/** Re-export para controladores y MCP. */
export type { ChatScope } from './chat-scope.util';

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
}

/** Respuesta del chat con texto, opcional cypher ejecutado y resultados. */
export interface ChatResponse {
  answer: string;
  cypher?: string;
  result?: unknown[];
}

/**
 * Plan de modificación para flujo legacy (ej. MaxPrime).
 * filesToModify: rutas que existen en el grafo con repoId (multi-root).
 * questionsToRefine: solo preguntas de negocio/funcionalidad.
 */
export interface ModificationPlanResult {
  filesToModify: Array<{ path: string; repoId: string }>;
  questionsToRefine: string[];
}

/** Modos de análisis estructurado (diagnóstico, duplicados, reingeniería, código muerto, AGENTS.md, SKILL.md). */
export type AnalyzeMode = 'diagnostico' | 'duplicados' | 'reingenieria' | 'codigo_muerto' | 'agents' | 'skill';

/** Resultado de un análisis (summary markdown + detalles opcionales). */
export interface AnalyzeResult {
  mode: AnalyzeMode;
  summary: string;
  details?: unknown;
}

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
 * @see docs/CHAT_Y_ANALISIS.md
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly repos: RepositoriesService,
    private readonly fileContent: FileContentService,
    private readonly embedding: EmbeddingService,
    private readonly cypher: ChatCypherService,
    private readonly llm: ChatLlmService,
    private readonly antipatterns: ChatAntipatternsService,
    private readonly handlers: ChatHandlersService,
    private readonly projects: ProjectsService,
  ) {}

  /** Proyecto a usar para un repo: primer proyecto asociado o repo.id (standalone). */
  private async resolveProjectIdForRepo(repoId: string): Promise<string> {
    const ids = await this.repos.getProjectIdsForRepo(repoId);
    return ids[0] ?? repoId;
  }

  /** Resumen de lo indexado en FalkorDB. full=true devuelve todos los ítems (sin LIMIT); si no, muestras de 12. */
  async getGraphSummary(repositoryId: string, full = false): Promise<{
    counts: Record<string, number>;
    samples: Record<string, unknown[]>;
  }> {
    return this.cypher.getGraphSummary(repositoryId, full);
  }

  /**
   * Plan de modificación por proyecto Ariadne o por repo concreto (multi-root).
   * - Si `projectIdOrRepoId` es un **UUID de repositorio** (`roots[].id`), se usa ese repo (recomendado p. ej. para acotar al frontend).
   * - Si es un **UUID de proyecto**, se usa el primer repo asociado (orden `createdAt` DESC) — puede no ser el deseado si hay varios roots.
   * @param {string} projectIdOrRepoId - ID de proyecto Ariadne o ID de repositorio (root).
   * @param {string} userDescription - Descripción de la modificación.
   * @returns {Promise<ModificationPlanResult>}
   */
  async getModificationPlanByProject(
    projectIdOrRepoId: string,
    userDescription: string,
    scope?: ChatScope,
  ): Promise<ModificationPlanResult> {
    const directRepo = await this.repos.findOptionalById(projectIdOrRepoId);
    if (directRepo) {
      return this.getModificationPlan(directRepo.id, userDescription, scope);
    }
    const repos = await this.repos.findAll(projectIdOrRepoId);
    const repo = repos[0];
    if (!repo) {
      return { filesToModify: [], questionsToRefine: [] };
    }
    return this.getModificationPlan(repo.id, userDescription, scope);
  }

  /**
   * Plan de modificación basado solo en el codebase indexado (contrato MaxPrime/legacy).
   * - filesToModify: únicamente rutas que existen en el grafo (File nodes). Sin inventar paths.
   * - questionsToRefine: solo preguntas de negocio/funcionalidad (valores por defecto, reglas, criterios).
   * @param {string} repositoryId - ID del repositorio indexado.
   * @param {string} userDescription - Descripción en lenguaje natural de la modificación.
   * @returns {Promise<ModificationPlanResult>}
   */
  async getModificationPlan(
    repositoryId: string,
    userDescription: string,
    scope?: ChatScope,
  ): Promise<ModificationPlanResult> {
    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);

    // 1) Fuente de verdad: todos los (path, repoId) indexados en el proyecto (repoId para multi-root)
    const indexedRows = (await this.cypher.executeCypher(
      projectId,
      `MATCH (f:File) WHERE f.projectId = $projectId RETURN f.path as path, coalesce(f.repoId, f.projectId) as repoId`,
    )) as Array<{ path: string; repoId: string }>;
    const indexedPathRepoSet = new Set(indexedRows.map((r) => `${r.path}\t${r.repoId}`));

    const candidatePathRepoSet = new Set<string>();

    // 2) Términos para búsqueda (palabras significativas, sin stopwords)
    const stopwords = new Set([
      'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'en', 'y', 'o', 'pero', 'si', 'no',
      'que', 'para', 'por', 'con', 'al', 'lo', 'como', 'más', 'menos', 'este', 'esta', 'eso', 'que', 'se', 'los',
      'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are', 'be', 'this', 'that',
    ]);
    const words = userDescription
      .replace(/[^\w\sáéíóúñ]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !stopwords.has(w.toLowerCase()));
    const terms = Array.from(new Set([...words, userDescription.trim().slice(0, 80)]))
      .filter((t) => t.length >= 2)
      .slice(0, 12);
    const termPairs = terms.flatMap((t) => {
      const cap = t.charAt(0).toUpperCase() + t.slice(1);
      return [t, cap].filter((x, i, a) => a.indexOf(x) === i);
    });

    // 3) Cypher: archivos por path, por componente, por función (con repoId)
    for (const term of termPairs) {
      const filesByPath = (await this.cypher.executeCypher(
        projectId,
        `MATCH (f:File) WHERE f.projectId = $projectId AND (f.path CONTAINS $term) RETURN f.path as path, coalesce(f.repoId, f.projectId) as repoId`,
        { term },
      )) as Array<{ path: string; repoId: string }>;
      filesByPath.forEach((r) => candidatePathRepoSet.add(`${r.path}\t${r.repoId}`));

      const filesByComponent = (await this.cypher.executeCypher(
        projectId,
        `MATCH (f:File)-[:CONTAINS]->(c:Component) WHERE f.projectId = $projectId AND c.projectId = $projectId AND (c.name CONTAINS $term) RETURN f.path as path, coalesce(f.repoId, f.projectId) as repoId`,
        { term },
      )) as Array<{ path: string; repoId: string }>;
      filesByComponent.forEach((r) => candidatePathRepoSet.add(`${r.path}\t${r.repoId}`));

      const filesByFunction = (await this.cypher.executeCypher(
        projectId,
        `MATCH (fn:Function) WHERE fn.projectId = $projectId AND (fn.path CONTAINS $term OR fn.name CONTAINS $term) RETURN fn.path as path, coalesce(fn.repoId, fn.projectId) as repoId`,
        { term },
      )) as Array<{ path: string; repoId: string }>;
      filesByFunction.forEach((r) => candidatePathRepoSet.add(`${r.path}\t${r.repoId}`));
    }

    // 4) Búsqueda semántica: añadir (path, repoId) que estén en el grafo
    const semantic = await this.handlers.semanticSearchFallback(projectId, userDescription, 25);
    for (const row of semantic.result as Array<{ path?: string; name?: string; tipo?: string; repoId?: string }>) {
      const p = row.path;
      if (p && (p.includes('/') || p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.js') || p.endsWith('.jsx'))) {
        if (row.repoId) {
          candidatePathRepoSet.add(`${p}\t${row.repoId}`);
        } else {
          indexedRows.filter((r) => r.path === p).forEach((r) => candidatePathRepoSet.add(`${r.path}\t${r.repoId}`));
        }
      }
      if (row.tipo === 'Component' && row.name) {
        const fileRows = (await this.cypher.executeCypher(
          projectId,
          `MATCH (f:File)-[:CONTAINS]->(c:Component {name: $name, projectId: $projectId}) RETURN f.path as path, coalesce(f.repoId, f.projectId) as repoId LIMIT 5`,
          { name: row.name, projectId },
        )) as Array<{ path: string; repoId: string }>;
        fileRows.forEach((r) => candidatePathRepoSet.add(`${r.path}\t${r.repoId}`));
      }
    }

    // 5) Filtrar: solo (path, repoId) que existen en el índice; ordenar por path luego repoId; cap (plan_mcp_grounding_y_retrieval §5)
    const maxPlanFiles = (() => {
      const raw = process.env.MODIFICATION_PLAN_MAX_FILES?.trim();
      const n = raw ? parseInt(raw, 10) : 150;
      if (!Number.isFinite(n) || n < 1) return 150;
      return Math.min(n, 2000);
    })();
    let filesToModify = indexedRows
      .filter((r) => candidatePathRepoSet.has(`${r.path}\t${r.repoId}`))
      .map((r) => ({ path: r.path, repoId: r.repoId }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.repoId.localeCompare(b.repoId))
      .slice(0, maxPlanFiles);
    if (scope) {
      filesToModify = filesToModify.filter((f) => matchesChatScope(f.path, f.repoId, scope));
    }

    // 6) Preguntas de afinación: solo negocio/funcionalidad (no exhaustividad)
    let questionsToRefine: string[] = [];
    if (process.env.OPENAI_API_KEY?.trim()) {
      const systemPrompt = `Eres un analista que genera preguntas para afinar un cambio en el software.
Regla: SOLO preguntas de negocio o funcionalidad: valores por defecto, reglas de validación, criterios de negocio, umbrales, opciones permitidas.
PROHIBIDO: preguntas como "¿hay otros componentes a considerar?", "¿qué más archivos?", "¿otras dependencias?". La lista de archivos ya es exhaustiva; no preguntes por exhaustividad.
Formato: devuelve una lista numerada, una pregunta por línea. Si no hay preguntas relevantes, devuelve "Ninguna.".
Máximo 5 preguntas. En español.`;
      const userPrompt = `Descripción del cambio que el usuario quiere hacer:\n\n"${userDescription.slice(0, 800)}"\n\nArchivos que se van a modificar (ya determinados): ${filesToModify.slice(0, 20).map((f) => f.path).join(', ')}${filesToModify.length > 20 ? '...' : ''}\n\nGenera solo preguntas de negocio/funcionalidad para afinar el cambio (valores por defecto, reglas, criterios).`;
      const raw = await this.llm.callLlm(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        512,
      );
      const lines = raw
        .split(/\n+/)
        .map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim())
        .filter((l) => l.length > 10 && !/^ninguna\.?$/i.test(l));
      questionsToRefine = lines.slice(0, 5);
    }

    return { filesToModify, questionsToRefine };
  }

  /** Diagnóstico de deuda técnica. Usa CoT/ToT (NotebookLM: Arquitectura Prompts). */
  async analyzeDiagnostico(repositoryId: string): Promise<AnalyzeResult> {
    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);
    const summary = await this.cypher.getGraphSummary(repositoryId);

    const riskCandidates = await this.cypher.executeCypher(
      projectId,
      `MATCH (a:Function) WHERE a.projectId = $projectId
       OPTIONAL MATCH (a)-[:CALLS]->(b:Function)
       WITH a, count(b) as outCalls
       RETURN a.path as path, a.name as name, outCalls, a.complexity as complexity, a.loc as loc, a.description as description`,
    ) as Array<{ path: string; name: string; outCalls: number; complexity?: number; loc?: number; description?: string | null }>;
    const riskRanked = riskCandidates
      .map((r) => ({
        ...r,
        noDesc: !r.description || String(r.description).trim() === '',
        riskScore: computeRiskScore({
          outCalls: r.outCalls,
          complexity: r.complexity,
          loc: r.loc,
          noDesc: !r.description || String(r.description).trim() === '',
        }),
      }))
      .sort((a, b) => b.riskScore - a.riskScore)
      .map(({ path, name, outCalls, complexity, loc, noDesc, riskScore }) => ({
        path,
        name,
        outCalls,
        complexity: complexity ?? '—',
        loc: loc ?? '—',
        noDesc: noDesc ? 'Sí' : 'No',
        riskScore,
      }));

    const highCoupling = await this.cypher.executeCypher(
      projectId,
      `MATCH (a:Function)-[:CALLS]->(b:Function) WHERE a.projectId = $projectId AND b.projectId = $projectId
       WITH a, count(b) as outCalls
       WHERE outCalls > 5
       RETURN a.path as path, a.name as name, outCalls ORDER BY outCalls DESC`,
    );
    const noDescription = await this.cypher.executeCypher(
      projectId,
      `MATCH (n:Function) WHERE n.projectId = $projectId AND (n.description IS NULL OR n.description = '')
       RETURN n.path as path, n.name as name`,
    );
    const componentProps = await this.cypher.executeCypher(
      projectId,
      `MATCH (c:Component)-[:HAS_PROP]->(p:Prop) WHERE c.projectId = $projectId
       WITH c, count(p) as propCount WHERE propCount > 5
       RETURN c.name as component, propCount ORDER BY propCount DESC`,
    );

    const antipatterns = await this.antipatterns.detectAntipatterns(repositoryId);

    const riskTrunc = riskRanked.slice(0, MAX_RISK_ITEMS);
    const couplingTrunc = (highCoupling as unknown[]).slice(0, MAX_HIGH_COUPLING);
    const noDescTrunc = (noDescription as unknown[]).slice(0, MAX_NO_DESC);
    const propsTrunc = (componentProps as unknown[]).slice(0, MAX_COMPONENT_PROPS);

    const context = `
Estadísticas del proyecto ${repo.projectKey}/${repo.repoSlug}:
- Nodos indexados: ${JSON.stringify(summary.counts)}
- **Riesgo** (ordenado por riskScore descendente, top ${MAX_RISK_ITEMS}): ${JSON.stringify(riskTrunc)}${riskRanked.length > MAX_RISK_ITEMS ? `\n  (+ ${riskRanked.length - MAX_RISK_ITEMS} más en details)` : ''}
- Funciones con alto acoplamiento (más de 5 llamadas salientes): ${JSON.stringify(couplingTrunc)}
- Funciones sin JSDoc/descripción: ${JSON.stringify(noDescTrunc)}${(noDescription as unknown[]).length > MAX_NO_DESC ? ` (+ ${(noDescription as unknown[]).length - MAX_NO_DESC} más)` : ''}
- Componentes con muchas props (>5): ${JSON.stringify(propsTrunc)}
- **Anti-patrones y malas prácticas:** ${JSON.stringify(truncateAntipatterns(antipatterns))}

Métricas estándar: acoplamiento (CALLS), complejidad ciclomática (McCabe), LOC, documentación, anidamiento.
`;

    const systemPrompt = `<rol>Arquitecto senior que analiza DEUDA TÉCNICA. Única fuente de verdad: datos JSON.</rol>

<cot>Pensemos paso a paso: 1) Revisar métricas y conteos. 2) Priorizar por riskScore y antipatrones. 3) Generar acciones concretas.</cot>

<instrucciones>
- Deriva TODO de los datos. Cada ítem debe referenciar path/name concreto.
- Métricas estándar: acoplamiento (CALLS), complejidad, LOC, documentación, anidamiento.
- PROHIBIDO inventar problemas genéricos sin soporte. PROHIBIDO incluir antipatrones con arrays vacíos.
</instrucciones>

<formato_salida>Markdown con bullet points y tablas.</formato_salida>`;

    const prefill =
      riskRanked.length > 0
        ? `Riesgos (${riskRanked.length}): ${riskRanked.slice(0, 5).map((r) => `${r.path}/${r.name}(${r.riskScore})`).join(', ')}${riskRanked.length > 5 ? `… y ${riskRanked.length - 5} más. ` : '. '}`
        : '';
    const prefillDesc =
      (noDescription as unknown[]).length > 0
        ? `Funciones sin JSDoc: ${(noDescription as unknown[]).length} ítems. `
        : '';
    const prefillAntip =
      antipatterns.spaghetti.length + antipatterns.godFunctions.length > 0
        ? `Quick wins potenciales: antipatrones Spaghetti/GodFunctions detectados. `
        : '';

    const prompt = `${context}

<prefill>${prefill}${prefillDesc}${prefillAntip}</prefill>

Genera un diagnóstico estructurado en markdown con:
1. **Resumen ejecutivo** — 2-3 líneas basadas SOLO en los conteos y métricas mostradas.
2. **Riesgo (ordenado por riskScore)** — tabla markdown con los ítems mostrados: Path | Name | Risk Score.
3. **Anti-patrones detectados** — enumera SOLO los que aparecen. OBLIGATORIO incluir la MÉTRICA que justifica cada uno:
   - **Spaghetti:** listar cada ítem como \`path/name (nestingDepth: N)\` — el umbral es 4, valores >4 indican anidamiento excesivo.
   - **God Functions:** \`path/name (outCalls: N)\` — umbral 8.
   - **High Fan In:** \`path/name (inCalls: N)\` — umbral 5.
   - Si algún array está vacío, no lo incluyas.
4. **Riesgos** — solo los que se infieran de las métricas. Sin consejos genéricos.
5. **Prioridades** — ordena por riskScore y antipatrones; cada ítem debe referenciar path/name concreto de los datos. Sin recomendaciones sin soporte en datos.

Sé conciso. Usa bullet points y tablas. Incluye TODOS los ítems de los datos en las tablas y listas.`;
    const answer = await this.llm.callLlm(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
      8192,
    );
    return {
      mode: 'diagnostico',
      summary: answer,
      details: { riskRanked, highCoupling, noDescription, componentProps, antipatterns },
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
  async analyzeDuplicados(repositoryId: string, threshold = 0.78, limit = 0): Promise<AnalyzeResult> {
    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);

    const structuralRows = (await this.cypher.executeCypher(
      projectId,
      `MATCH (a:Function) WHERE a.projectId = $projectId
       WITH a.name as name, collect(DISTINCT a.path) as paths
       WHERE size(paths) > 1
       UNWIND paths as p1 UNWIND paths as p2
       WITH name, p1, p2 WHERE p1 < p2
       RETURN p1 as pathA, name, p2 as pathB`,
    )) as Array<{ pathA: string; name: string; pathB: string }>;
    const structuralPairs = structuralRows.filter((r) => !GENERIC_FUNCTION_NAMES.has(r.name.toLowerCase()));
    const sameNamePairs = structuralPairs.map((r) => ({
      a: `${r.pathA}::${r.name}`,
      b: `${r.pathB}::${r.name}`,
      score: 1,
    }));

    let semanticPairs: Array<{ a: string; b: string; score: number }> = [];
    if (this.embedding.isAvailable()) {
      const config = getFalkorConfig();
      const client = await FalkorDB.connect({ socket: { host: config.host, port: config.port } });
      const graph = client.selectGraph(GRAPH_NAME);

      const limitClause = limit > 0 ? ` LIMIT ${limit}` : '';
      const funcsRes = (await graph.query(
        `MATCH (n:Function) WHERE n.projectId = $projectId AND n.embedding IS NOT NULL RETURN n.path AS path, n.name AS name, n.description AS description, n.startLine AS startLine, n.endLine AS endLine${limitClause}`,
        { params: { projectId } },
      )) as { data?: unknown[] };
      const rawRows = funcsRes?.data ?? [];
      const funcs = rawRows.map((row): { path: string; name: string; description?: string | null; startLine?: number; endLine?: number } => {
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
          const vec = await this.embedding.embed(text);
          const vecStr = `[${vec.join(',')}]`;
          const res = await this.cypher.executeCypherRaw(
            `CALL db.idx.vector.queryNodes('Function', 'embedding', 25, vecf32(${vecStr})) YIELD node, score
             RETURN node.path AS path, node.name AS name, node.projectId AS projectId, score`,
          );
          for (const row of (res as Array<{ path: string; name: string; projectId: string; score: number }>).filter(
            (r) => r.projectId === projectId && r.score >= threshold && r.score < 0.999,
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

    if (pairs.length === 0 && !this.embedding.isAvailable()) {
      return {
        mode: 'duplicados',
        summary: '## Código duplicado\n\n⚠️ **Embeddings no configurados.** Ejecuta `POST /repositories/:id/embed-index` tras un sync para indexar el cuerpo de las funciones y detectar duplicados semánticos.',
      };
    }

    const { byName, byCluster } = groupDuplicates(pairs);

    const summary = formatDuplicatesSummary(pairs.length, byName, byCluster);
    return { mode: 'duplicados', summary, details: { pairs, byName, byCluster } };
  }

  /** Recomendaciones de reingeniería basadas 100% en datos del grafo. Sin límites. */
  async analyzeReingenieria(repositoryId: string): Promise<AnalyzeResult> {
    const [diagnostico, duplicados] = await Promise.all([
      this.analyzeDiagnostico(repositoryId),
      this.analyzeDuplicados(repositoryId, 0.78, 0),
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
    const diagSummary = diagnostico.summary.slice(0, MAX_SUMMARY_CHARS) + (diagnostico.summary.length > MAX_SUMMARY_CHARS ? '\n...[resumido]' : '');

    const context = `
**Datos crudos del análisis (usa SOLO estos para tus recomendaciones; muestras top por categoría):**

Riesgo (ordenado por riskScore): ${JSON.stringify(riskRe)}
Alto acoplamiento: ${JSON.stringify(couplingRe)}
Sin JSDoc: ${JSON.stringify(noDescRe)}
Componentes con muchas props: ${JSON.stringify(propsRe)}
Anti-patrones: ${JSON.stringify(truncateAntipatterns((rawDetails?.antipatterns ?? {}) as { spaghetti?: unknown[]; godFunctions?: unknown[]; highFanIn?: unknown[]; circularImports?: unknown[]; overloadedComponents?: unknown[] }))}
Duplicados: ${JSON.stringify(pairsRe)}

Resumen diagnóstico (referencia): ${diagSummary}
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

    const prompt = `${context}

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
    const answer = await this.llm.callLlm(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
      8192,
    );
    return { mode: 'reingenieria', summary: answer, details: { diagnostico: diagnostico.details, duplicados: duplicados.details } };
  }

  /**
   * Análisis de código muerto: propósito, referencias y conclusión por archivo.
   * Formato detallado: ruta, quién lo importa/renderiza/llama, detalle funcional, conclusión.
   */
  async analyzeCodigoMuerto(repositoryId: string): Promise<AnalyzeResult> {
    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);
    const MAX_FILES = 120;

    const files = (await this.cypher.executeCypher(
      projectId,
      `MATCH (f:File) WHERE f.projectId = $projectId RETURN f.path as path ORDER BY f.path`,
    )) as Array<{ path: string }>;
    const isPm2Config = (path: string) =>
      /^ecosystem[.-].*\.config\.(js|mjs|cjs)$/i.test(path.split('/').pop() ?? path);
    const filePaths = files
      .map((r) => r.path)
      .filter((p) => !isPm2Config(p))
      .slice(0, MAX_FILES);

    const imports = (await this.cypher.executeCypher(
      projectId,
      `MATCH (a:File)-[:IMPORTS]->(b:File) WHERE a.projectId = $projectId AND b.projectId = $projectId RETURN a.path as fromPath, b.path as toPath`,
    )) as Array<{ fromPath: string; toPath: string }>;

    const contains = (await this.cypher.executeCypher(
      projectId,
      `MATCH (f:File)-[:CONTAINS]->(n) WHERE f.projectId = $projectId RETURN f.path as filePath, labels(n)[0] as label, n.name as name`,
    )) as Array<{ filePath: string; label: string; name: string }>;

    const renders = (await this.cypher.executeCypher(
      projectId,
      `MATCH (fp:File)-[:CONTAINS]->(parent:Component)-[:RENDERS]->(child:Component)
       MATCH (fc:File)-[:CONTAINS]->(child)
       WHERE parent.projectId = $projectId AND child.projectId = $projectId
       RETURN fc.path as targetFile, child.name as childName, fp.path as referrerPath, parent.name as referrerComponent`,
    )) as Array<{ targetFile: string; childName: string; referrerPath: string; referrerComponent: string }>;

    const calls = (await this.cypher.executeCypher(
      projectId,
      `MATCH (caller:Function)-[:CALLS]->(callee:Function) WHERE callee.projectId = $projectId AND caller.projectId = $projectId
       RETURN callee.path as targetPath, callee.name as calleeName, caller.path as callerPath, caller.name as callerName`,
    )) as Array<{ targetPath: string; calleeName: string; callerPath: string; callerName: string }>;

    const routes = (await this.cypher.executeCypher(
      projectId,
      `MATCH (r:Route) WHERE r.projectId = $projectId RETURN r.componentName as name`,
    )) as Array<{ name: string }>;
    const routeComponents = new Set((routes ?? []).map((r) => r.name));

    const hookDefFiles = (await this.cypher.executeCypher(
      projectId,
      `MATCH (comp:Component)-[:USES_HOOK]->(h:Hook)
       WHERE h.projectId = $projectId
       MATCH (f:File)-[:CONTAINS]->(fn:Function) WHERE fn.name = h.name AND fn.projectId = $projectId
       RETURN f.path as targetPath, h.name as hookName`,
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

    const verified = await this.verifyDeadCandidates(repositoryId, deadFiles, filePaths);

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

  /**
   * Genera AGENTS.md: protocolo para agentes AI (Cursor/Claude) basado en la estructura del proyecto.
   * Usa el conocimiento del MCP Handbook: protocolo de sesión, herramientas por intención, flujos SDD y refactorización.
   */
  async analyzeAgents(projectId: string, displayName: string): Promise<AnalyzeResult> {
    const summary = await this.cypher.getGraphSummaryForProject(projectId);
    const context = `Proyecto/repo: ${displayName}\nConteos del grafo: ${JSON.stringify(summary.counts)}\nMuestras (paths, componentes, funciones): ${JSON.stringify(summary.samples).slice(0, 4000)}`;

    const systemPrompt = `Eres experto en protocolos para agentes AI (Cursor, Claude, MCP). Genera un archivo AGENTS.md en formato Markdown para este proyecto.

**HERRAMIENTAS MCP REALES (solo estas existen; NO inventes create_component, create_route, etc.):**
- list_known_projects — Lista proyectos y roots.
- get_component_graph, get_legacy_impact, get_definitions, get_references — Diagnóstico de archivo/componente/hook.
- get_project_analysis — Diagnóstico por repo (mode: diagnostico, duplicados, reingenieria, codigo_muerto).
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

    const answer = await this.llm.callLlm(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: context }],
      8192,
    );
    return { mode: 'agents', summary: answer };
  }

  /**
   * Genera SKILL.md: skill para Cursor/Claude adaptada al proyecto.
   * Usa el conocimiento del MCP Handbook: YAML frontmatter (name, description), Instructions, Examples, Troubleshooting.
   */
  async analyzeSkill(projectId: string, displayName: string): Promise<AnalyzeResult> {
    const summary = await this.cypher.getGraphSummaryForProject(projectId);
    const context = `Proyecto/repo: ${displayName}\nConteos: ${JSON.stringify(summary.counts)}\nMuestras: ${JSON.stringify(summary.samples).slice(0, 4000)}`;

    const safeName = displayName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'project';
    const systemPrompt = `Eres experto en SKILL.md para agentes AI (Cursor, Claude). Genera un SKILL que enseñe a usar el MCP AriadneSpecs Oracle sobre este proyecto.

**HERRAMIENTAS MCP (el skill debe referenciar estas):** list_known_projects, get_component_graph, get_legacy_impact, get_definitions, get_references, get_project_analysis (modes: diagnostico, duplicados, reingenieria, codigo_muerto), ask_codebase, get_modification_plan, semantic_search, find_similar_implementations, validate_before_edit, get_file_content, get_file_context, get_project_standards, check_breaking_changes, analyze_local_changes.

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

    const answer = await this.llm.callLlm(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: context }],
      8192,
    );
    return { mode: 'skill', summary: answer };
  }

  /**
   * Ejecuta el análisis según el modo indicado.
   * @param repositoryId - UUID del repositorio
   * @param mode - diagnóstico | duplicados | reingeniería | código muerto | agents | skill
   */
  async analyze(repositoryId: string, mode: AnalyzeMode): Promise<AnalyzeResult> {
    if (mode === 'diagnostico') return this.analyzeDiagnostico(repositoryId);
    if (mode === 'duplicados') return this.analyzeDuplicados(repositoryId);
    if (mode === 'codigo_muerto') return this.analyzeCodigoMuerto(repositoryId);
    if (mode === 'reingenieria') return this.analyzeReingenieria(repositoryId);
    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);
    const displayName = `${repo.projectKey}/${repo.repoSlug}`;
    if (mode === 'agents') return this.analyzeAgents(projectId, displayName);
    if (mode === 'skill') return this.analyzeSkill(projectId, displayName);
    return this.analyzeReingenieria(repositoryId);
  }

  /**
   * Análisis por proyecto (multi-root). Usa projectId para consultar el grafo.
   */
  async analyzeByProject(projectId: string, mode: 'agents' | 'skill'): Promise<AnalyzeResult> {
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
        this.getGodObjects(projectId),
        this.getTopComplexityFunctions(projectId, 10),
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

  private async getGodObjects(projectId: string): Promise<
    Array<{ path: string; lineCount?: number; dependencyCount?: number; reason: string }>
  > {
    const fileLoc = (await this.cypher.executeCypher(
      projectId,
      `MATCH (f:File)-[:CONTAINS]->(fn:Function) WHERE f.projectId = $projectId AND fn.projectId = $projectId AND fn.loc IS NOT NULL
       WITH f.path as path, sum(fn.loc) as totalLoc
       WHERE totalLoc > 500
       RETURN path, totalLoc ORDER BY totalLoc DESC`,
    )) as Array<{ path: string; totalLoc: number }>;

    const inCounts = (await this.cypher.executeCypher(
      projectId,
      `MATCH (a:File)-[:IMPORTS]->(b:File) WHERE a.projectId = $projectId AND b.projectId = $projectId
       WITH b.path as path, count(a) as inCnt
       RETURN path, inCnt`,
    )) as Array<{ path: string; inCnt: number }>;

    const outCounts = (await this.cypher.executeCypher(
      projectId,
      `MATCH (a:File)-[:IMPORTS]->(b:File) WHERE a.projectId = $projectId AND b.projectId = $projectId
       WITH a.path as path, count(b) as outCnt
       RETURN path, outCnt`,
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
    limit: number,
  ): Promise<Array<{ path: string; name: string; complexity: number }>> {
    const rows = (await this.cypher.executeCypher(
      projectId,
      `MATCH (fn:Function) WHERE fn.projectId = $projectId AND fn.complexity IS NOT NULL AND fn.complexity > 0
       RETURN fn.path as path, fn.name as name, fn.complexity as complexity
       ORDER BY fn.complexity DESC LIMIT ${limit}`,
    )) as Array<{ path: string; name: string; complexity: number }>;
    return rows;
  }

  private async runSecurityScan(
    repositoryId: string,
    projectId: string,
    repoSlug: string,
  ): Promise<Array<{ path: string; severity: string; pattern: string; line?: number }>> {
    const files = (await this.cypher.executeCypher(
      projectId,
      `MATCH (f:File) WHERE f.projectId = $projectId RETURN f.path as path ORDER BY f.path`,
    )) as Array<{ path: string }>;

    const toScan = files
      .map((r) => r.path)
      .filter((p) => /\.(tsx?|jsx?|js|json|env)$/.test(p.replace(/^[^/]+\//, '')))
      .slice(0, 80);

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

  /**
   * Pipeline unificado: Retriever (Cypher + archivos + RAG) → Synthesizer (respuesta siempre humana).
   * Todas las preguntas pasan por extracción de código con Falkor/Cypher/RAG y luego síntesis en prosa.
   * @param {string} repositoryId - ID del repositorio (proyecto indexado).
   * @param {ChatRequest} req - Mensaje y opcional historial de chat.
   * @returns {Promise<ChatResponse>} answer (texto), y opcionalmente cypher y result.
   */
  async chat(repositoryId: string, req: ChatRequest): Promise<ChatResponse> {
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
        { scope: req.scope, twoPhase: req.twoPhase },
      );
    } catch (err) {
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
    const repos = await this.repos.findAll(projectId);
    if (repos.length === 0) {
      return { answer: 'Este proyecto no tiene repositorios indexados. Añade al menos un repo y haz sync.' };
    }
    const firstRepoId = repos[0].id;
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
        { projectScope: true, scope: req.scope, twoPhase: req.twoPhase },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { answer: `Error: ${msg}` };
    }
  }

  /**
   * Fase 1 (Retriever): ReAct con tools — recopila datos vía Cypher, get_file_content, semantic_search.
   * Fase 2 (Synthesizer): LLM recibe contexto y produce respuesta SIEMPRE en forma humana (prosa, explicación).
   * @param options.projectScope - Si true, get_file_content busca en todos los repos del proyecto (chat por proyecto).
   * @param options.scope - Filtro repoIds / prefijos / globs (§2).
   * @param options.twoPhase - Si true, inyecta JSON de retrieval antes del contexto bruto (§3); default env `CHAT_TWO_PHASE`.
   */
  private async runUnifiedPipeline(
    repositoryId: string,
    projectId: string,
    message: string,
    historyContent?: string,
    options?: { projectScope?: boolean; scope?: ChatScope; twoPhase?: boolean },
  ): Promise<ChatResponse> {
    const scope = options?.scope;
    const useTwoPhase = options?.twoPhase ?? defaultTwoPhaseFromEnv();
    const tools = EXPLORER_TOOLS_ALL;
    const retrieverSystem = `<instrucciones>
Eres un RECOLECTOR de datos. Tu única tarea: usar las herramientas para reunir información **proveniente del grafo o archivos leídos**, relevante para la pregunta.

Plan: 1) execute_cypher o get_graph_summary para ubicar archivos/funciones/componentes. 2) get_file_content en paths relevantes para leer el código. 3) semantic_search si aplica.

**Monorepos (apps/, packages/):** Si get_graph_summary muestra paths como apps/admin, apps/api, apps/worker o packages/*, el repo es un monorepo. Explora TODAS las apps, no solo la primera. Para "qué hace el proyecto" o descripciones generales: incluye frontend (Component, Route) Y backend (NestController, NestService, NestModule, Function en apps/api, apps/worker). Consulta execute_cypher buscando NestController, NestService si hay conteos de esos nodos.

**Grounding:** No inventes rutas ni porcentajes. Si una herramienta devuelve 0 filas, repórtalo tal cual (el sintetizador dirá que no hay datos en índice).

NO escribas la respuesta final al usuario. Otro agente sintetizará. Solo GATHER datos. Máx 4 turnos.
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

    let lastCypher = '';
    const collectedToolOutputs: string[] = [];
    const collectedResults: unknown[] = [];
    const MAX_TURNS = 4;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const resp = await this.llm.callLlmWithTools(messages, tools);

      if (!resp.tool_calls?.length) {
        break;
      }

      for (const tc of resp.tool_calls) {
        const fn = tc.function;
        let toolResult: string;
        try {
          if (fn.name === 'execute_cypher') {
            const args = JSON.parse(fn.arguments) as { cypher: string };
            const cypher = args.cypher?.trim();
            if (!cypher) {
              toolResult = 'Error: cypher vacío';
            } else {
              lastCypher = cypher;
              const rawRows = await this.cypher.executeCypher(projectId, cypher);
              const rows = filterCypherRowsByScope(rawRows as Record<string, unknown>[], scope) as typeof rawRows;
              if (rawRows.length > 0 && rows.length === 0) {
                toolResult = `0 filas tras aplicar el alcance (scope): ${rawRows.length} filas en crudo omitidas por repoIds/prefijos/exclusiones. Ajusta el scope o la consulta.`;
              } else if (rows.length === 0) {
                toolResult =
                  '0 filas devueltas por Cypher. **sin datos en índice para este alcance** — no inventes rutas; prueba términos más amplios, otro MATCH o semantic_search.';
              } else {
                collectedResults.push(...rows);
                toolResult = `Resultados (${rows.length} filas):\n${this.cypher.formatResultsHuman(rows as Record<string, unknown>[], rows.length)}`;
              }
            }
          } else if (fn.name === 'semantic_search') {
            const args = JSON.parse(fn.arguments) as { query: string };
            const q = args.query?.trim() || message;
            const semantic = await this.handlers.semanticSearchFallback(projectId, q);
            let semRows = semantic.result as Array<Record<string, unknown>>;
            if (scope) {
              semRows = semRows.filter((row) =>
                matchesChatScope(row.path as string, row.repoId as string, scope),
              );
            }
            if (semRows.length > 0) {
              collectedResults.push(...semRows);
              toolResult = `Búsqueda semántica (${semRows.length}):\n${this.cypher.formatResultsHuman(semRows, semRows.length)}`;
            } else if (semantic.result.length > 0 && semRows.length === 0) {
              toolResult =
                'Búsqueda semántica: todos los candidatos quedaron fuera del alcance (scope). Ajusta repoIds/prefijos/exclusiones o amplía la consulta.';
            } else {
              const diag = await this.handlers.getSemanticSearchDiagnostics(projectId);
              toolResult = `Búsqueda semántica: 0 resultados.\n${diag}\nPrueba execute_cypher si el índice vectorial no aplica.`;
            }
          } else if (fn.name === 'get_graph_summary') {
            const summary = await this.cypher.getGraphSummary(repositoryId);
            toolResult = `Conteos: ${JSON.stringify(summary.counts)}. Muestras: ${JSON.stringify(summary.samples, null, 2).slice(0, 3500)}...`;
          } else if (fn.name === 'get_file_content') {
            const args = JSON.parse(fn.arguments) as { path: string };
            const p = args.path?.trim();
            if (!p) {
              toolResult = 'Error: path vacío';
            } else if (!matchesChatScope(p, options?.projectScope ? undefined : repositoryId, scope)) {
              toolResult = `Path \`${p}\` fuera del alcance (scope): repoIds / prefijos / exclusiones.`;
            } else {
              let content: string | null = null;
              if (options?.projectScope) {
                const repos = await this.repos.findAll(projectId);
                const ordered =
                  scope?.repoIds && scope.repoIds.length > 0
                    ? repos.filter((r) => scope.repoIds!.includes(r.id))
                    : repos;
                const list = ordered.length > 0 ? ordered : repos;
                for (const repo of list) {
                  if (!matchesChatScope(p, repo.id, scope)) continue;
                  content = await this.fileContent.getFileContentSafe(repo.id, p);
                  if (content != null) break;
                }
              } else {
                content = await this.fileContent.getFileContentSafe(repositoryId, p);
              }
              if (!content) {
                toolResult = `No se pudo leer \`${p}\` (o no coincide con el alcance del scope).`;
              } else {
                const MAX_CHARS = 14000;
                const truncated = content.length > MAX_CHARS;
                const snippet = truncated ? content.slice(0, MAX_CHARS) + '\n\n...[truncado]' : content;
                toolResult = `Archivo \`${p}\`:\n\`\`\`\n${snippet}\n\`\`\``;
              }
            }
          } else {
            toolResult = `Herramienta desconocida: ${fn.name}`;
          }
          collectedToolOutputs.push(toolResult);
        } catch (err) {
          toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }

        messages.push(
          { role: 'assistant', content: null, tool_calls: [tc] },
          { role: 'tool', tool_call_id: tc.id, content: toolResult },
        );
      }
    }

    const gatheredContext = collectedToolOutputs.join('\n\n---\n\n');
    const retrievalJson =
      collectedResults.length > 0 || gatheredContext.trim().length > 0
        ? buildRetrievalSummaryJson(collectedResults, gatheredContext)
        : '';
    const rawContextForSynth =
      useTwoPhase && gatheredContext.trim() ? gatheredContext.slice(0, 12_000) : gatheredContext;
    const synthesizerSystem = `## Rol
Eres un experto que explica código a colegas. Recibes **solo** datos crudos del contexto (Cypher, archivos, búsquedas) — son la única fuente de verdad para rutas y símbolos.

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
    if (gatheredContext.trim()) {
      answer = await this.llm.callLlm(
        [
          { role: 'system', content: synthesizerSystem },
          { role: 'user', content: synthesizerUser },
        ],
        2048,
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
      const grounding = sampleHallucinationPathMetrics(answer, gatheredContext, collectedResults);
      this.logger.log(
        JSON.stringify({
          event: 'chat_unified_pipeline',
          repositoryId,
          projectId,
          projectScope: options?.projectScope ?? false,
          scopeActive: Boolean(
            scope?.repoIds?.length || scope?.includePathPrefixes?.length || scope?.excludePathGlobs?.length,
          ),
          twoPhase: useTwoPhase,
          messageChars: message.length,
          contextChars: gatheredContext.length,
          toolOutputChunks: collectedToolOutputs.length,
          collectedRowGroups: collectedResults.length,
          answerChars: answer.length,
          answerPathCitations: uniquePaths.size,
          pathGroundingHits: grounding.pathGroundingHits,
          pathGroundingRatio: grounding.pathGroundingRatio,
          pathCitationsUnique: grounding.pathCitationsUnique,
        }),
      );
    }

    return {
      answer: answer.trim(),
      cypher: lastCypher || undefined,
      result: collectedResults.length > 0 ? collectedResults : undefined,
    };
  }
}
