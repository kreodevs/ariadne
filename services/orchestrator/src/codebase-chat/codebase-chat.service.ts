/**
 * ask_codebase / chat NL: LangGraph (retrieve → synthesize) + llamadas al ingest solo para datos (Cypher, archivos, RAG).
 */
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { START, END, StateGraph, Annotation } from '@langchain/langgraph';
import { EXAMPLES, EXPLORER_TOOLS_ALL, SCHEMA } from './chat.constants';
import type { ChatScope } from './chat-scope.util';
import { IngestChatClient } from './ingest-chat.client';
import { OrchestratorLlmService } from './orchestrator-llm.service';
import type { OpenAiStyleMessage } from '../llm/orchestrator-llm.facade';
import { isMoonshotRateLimitError } from '../llm/moonshot-rate-limit.error';
import { RedisStateService } from '../redis-state/redis-state.service';
import type { RetrieverToolName } from './ingest-types';

const lastValue = <T>(x: T, y: T) => (y !== undefined && y !== null ? y : x);

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  cypher?: string;
  result?: unknown[];
}

export interface ChatRequest {
  message: string;
  history?: ChatMessage[];
  scope?: ChatScope;
  twoPhase?: boolean;
  responseMode?: 'default' | 'evidence_first' | 'raw_evidence';
  /** Solo con `responseMode: raw_evidence`: retrieval fijo en ingest sin LLM ReAct (orchestrator delega vía internal). */
  deterministicRetriever?: boolean;
  /** Opcional: observabilidad / reanudación en Redis (codebase:chat:{threadId}). */
  threadId?: string;
}

export interface ChatResponse {
  answer: string;
  cypher?: string;
  result?: unknown[];
  /** JSON MDD (evidence_first) — LegacyCoordinator. */
  mddDocument?: Record<string, unknown>;
}

function defaultTwoPhaseFromEnv(): boolean {
  const v = process.env.CHAT_TWO_PHASE?.trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off') return false;
  return true;
}

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

const CodebaseChatStateAnnotation = Annotation.Root({
  repositoryId: Annotation<string>(),
  projectId: Annotation<string>(),
  message: Annotation<string>(),
  historyContent: Annotation<string | undefined>({ value: lastValue, default: () => undefined }),
  projectScope: Annotation<boolean>({ value: lastValue, default: () => false }),
  scope: Annotation<ChatScope | undefined>({ value: lastValue, default: () => undefined }),
  useTwoPhase: Annotation<boolean>({ value: lastValue, default: () => true }),
  evidenceFirst: Annotation<boolean>({ value: lastValue, default: () => false }),
  rawEvidence: Annotation<boolean>({ value: lastValue, default: () => false }),
  deterministicRetriever: Annotation<boolean>({ value: lastValue, default: () => false }),
  threadId: Annotation<string | undefined>({ value: lastValue, default: () => undefined }),
  lastCypher: Annotation<string | undefined>({ value: lastValue, default: () => undefined }),
  collectedResults: Annotation<unknown[]>({
    value: (_a, b) => (Array.isArray(b) ? b : []),
    default: () => [],
  }),
  gatheredContext: Annotation<string>({ value: lastValue, default: () => '' }),
  answer: Annotation<string | undefined>({ value: lastValue, default: () => undefined }),
  resultOut: Annotation<unknown[] | undefined>({ value: lastValue, default: () => undefined }),
});

export type CodebaseChatState = typeof CodebaseChatStateAnnotation.State;

@Injectable()
export class CodebaseChatService {
  private readonly logger = new Logger(CodebaseChatService.name);
  private graph: { invoke: (s: CodebaseChatState) => Promise<CodebaseChatState> } | null = null;

  constructor(
    private readonly llm: OrchestratorLlmService,
    private readonly ingest: IngestChatClient,
    private readonly redis: RedisStateService,
  ) {}

  async chatRepository(repositoryId: string, req: ChatRequest): Promise<ChatResponse> {
    const historyContent = (req.history ?? [])
      .slice(-8)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');
    const rawEvidence = req.responseMode === 'raw_evidence';
    const evidenceFirst = !rawEvidence && req.responseMode === 'evidence_first';
    const useTwoPhase = rawEvidence || evidenceFirst ? true : (req.twoPhase ?? defaultTwoPhaseFromEnv());
    const initial: CodebaseChatState = {
      repositoryId,
      projectId: repositoryId,
      message: req.message,
      historyContent,
      projectScope: false,
      scope: req.scope,
      useTwoPhase,
      evidenceFirst,
      rawEvidence,
      deterministicRetriever: Boolean(req.deterministicRetriever) && rawEvidence,
      threadId: req.threadId,
      lastCypher: undefined,
      collectedResults: [],
      gatheredContext: '',
      answer: undefined,
      resultOut: undefined,
    };
    const out = await this.invokeCodebaseGraph(initial);
    const answer = (out.answer ?? '').trim();
    let mddDocument: Record<string, unknown> | undefined;
    if (evidenceFirst && answer.startsWith('{')) {
      try {
        mddDocument = JSON.parse(answer) as Record<string, unknown>;
      } catch {
        mddDocument = undefined;
      }
    }
    return {
      answer,
      cypher: out.lastCypher || undefined,
      result: out.resultOut && out.resultOut.length > 0 ? out.resultOut : undefined,
      mddDocument,
    };
  }

  async chatProject(projectId: string, req: ChatRequest): Promise<ChatResponse> {
    let repos = await this.ingest.listRepositories(projectId);
    if (repos.length === 0) {
      const maybe = await this.ingest.getRepository(projectId);
      if (maybe) {
        return this.chatRepository(projectId, req);
      }
      return { answer: 'Este proyecto no tiene repositorios indexados. Añade al menos un repo y haz sync.' };
    }
    const firstRepoId = repos[0].id;
    const historyContent = (req.history ?? [])
      .slice(-8)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');
    const rawEvidence = req.responseMode === 'raw_evidence';
    const evidenceFirst = !rawEvidence && req.responseMode === 'evidence_first';
    const useTwoPhase = rawEvidence || evidenceFirst ? true : (req.twoPhase ?? defaultTwoPhaseFromEnv());
    const initial: CodebaseChatState = {
      repositoryId: firstRepoId,
      projectId,
      message: req.message,
      historyContent,
      projectScope: true,
      scope: req.scope,
      useTwoPhase,
      evidenceFirst,
      rawEvidence,
      deterministicRetriever: Boolean(req.deterministicRetriever) && rawEvidence,
      threadId: req.threadId,
      lastCypher: undefined,
      collectedResults: [],
      gatheredContext: '',
      answer: undefined,
      resultOut: undefined,
    };
    const out = await this.invokeCodebaseGraph(initial);
    const answer = (out.answer ?? '').trim();
    let mddDocument: Record<string, unknown> | undefined;
    if (evidenceFirst && answer.startsWith('{')) {
      try {
        mddDocument = JSON.parse(answer) as Record<string, unknown>;
      } catch {
        mddDocument = undefined;
      }
    }
    return {
      answer,
      cypher: out.lastCypher || undefined,
      result: out.resultOut && out.resultOut.length > 0 ? out.resultOut : undefined,
      mddDocument,
    };
  }

  private async invokeCodebaseGraph(initial: CodebaseChatState): Promise<CodebaseChatState> {
    try {
      return await this.getGraph().invoke(initial);
    } catch (err) {
      if (isMoonshotRateLimitError(err)) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: 'MoonshotRateLimit',
            message: err.message,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw err;
    }
  }

  private getGraph(): { invoke: (s: CodebaseChatState) => Promise<CodebaseChatState> } {
    if (!this.graph) this.graph = this.buildGraph();
    return this.graph;
  }

  private buildGraph(): { invoke: (s: CodebaseChatState) => Promise<CodebaseChatState> } {
    const svc = this;
    const workflow = new StateGraph(CodebaseChatStateAnnotation)
      .addNode('retrieve', (s) => svc.nodeRetrieve(s))
      .addNode('synthesize', (s) => svc.nodeSynthesize(s))
      .addEdge(START, 'retrieve')
      .addEdge('retrieve', 'synthesize')
      .addEdge('synthesize', END);
    return workflow.compile();
  }

  private async nodeRetrieve(state: CodebaseChatState): Promise<Partial<CodebaseChatState>> {
    const rawEv = state.rawEvidence ?? false;
    const repositoryId = state.repositoryId;
    const scope = state.scope;
    const projectScope = state.projectScope;

    if (rawEv && (state.deterministicRetriever ?? false)) {
      const r = await this.ingest.gatherDeterministicRawEvidence(repositoryId, {
        message: state.message,
        scope,
        projectScope,
      });
      const gatheredContext = r.gatheredContext;
      const collectedResults = r.collectedResults;
      if (state.threadId?.trim()) {
        await this.redis.setChatThread(state.threadId.trim(), {
          phase: 'post_retrieve',
          repositoryId: state.repositoryId,
          projectId: state.projectId,
          gatheredContextChars: gatheredContext.length,
          collectedRows: collectedResults.length,
          at: new Date().toISOString(),
        });
      }
      return {
        lastCypher: r.lastCypher || undefined,
        collectedResults,
        gatheredContext,
      };
    }

    const tools = EXPLORER_TOOLS_ALL;
    const maxTurns = rawEv
      ? Math.min(20, Math.max(4, parseInt(process.env.CHAT_RAW_EVIDENCE_RETRIEVER_MAX_TURNS ?? '10', 10) || 10))
      : 4;
    const retrieverSystem = `<instrucciones>
Actúa como **Coordinador** y luego como **Validador** (ask_codebase agéntico).

**Coordinador:** Si la pregunta implica datos, API, esquema o contratos, NO te limites al grafo: usa execute_cypher Y get_file_content sobre schema.prisma, entidades TypeORM (:Model source=typeorm), swagger/openapi (File openApiTruth), package.json, .env.example, tsconfig.

**Validador:** Contrasta resultados del grafo con contenidos de archivo; solo considera evidencia anclada a path real devuelto por herramientas.

**Recolector:** Tu única salida en esta fase es reunir datos del grafo o archivos leídos.

Plan: 1) execute_cypher o get_graph_summary. 2) get_file_content en paths relevantes. 3) semantic_search si aplica.

**Tablas / esquema BD / modelos:** Prisma → MATCH (m:Model) WHERE m.source = 'prisma'; TypeORM → m.source = 'typeorm'. **API:** OpenApiOperation (swagger) con prioridad sobre NestController. **Env:** .env.example (fileRole env_example).

**Monorepos:** Explora todas las apps (apps/*, packages/*).

**Grounding:** No inventes rutas. Si una herramienta devuelve 0 filas, repórtalo tal cual.

NO escribas la respuesta final al usuario. Máx ${maxTurns} turnos.
</instrucciones>

<schema_cypher>
${SCHEMA}${EXAMPLES}
</schema_cypher>`;

    const message = state.message;
    const historyContent = state.historyContent;
    const userContent = historyContent
      ? `${historyContent}\n\n<user>${message}</user>`
      : `<user>${message}</user>`;

    const messages: OpenAiStyleMessage[] = [
      { role: 'system', content: retrieverSystem },
      { role: 'user', content: userContent },
    ];

    let lastCypher = '';
    const collectedToolOutputs: string[] = [];
    const collectedResults: unknown[] = [];

    for (let turn = 0; turn < maxTurns; turn++) {
      const resp = await this.llm.callLlmWithTools(messages, tools);

      if (!resp.tool_calls?.length) {
        break;
      }

      messages.push({
        role: 'assistant',
        content: resp.content ?? null,
        ...('reasoning_content' in resp ? { reasoning_content: resp.reasoning_content ?? null } : {}),
        tool_calls: resp.tool_calls,
      });

      for (const tc of resp.tool_calls) {
        const fn = tc.function;
        let toolResult: string;
        try {
          const args = JSON.parse(fn.arguments) as Record<string, unknown>;
          const r = await this.ingest.executeRetrieverTool(repositoryId, {
            projectScope,
            scope,
            tool: fn.name as RetrieverToolName,
            arguments: args,
            fallbackMessage: message,
            evidenceVerbosity: rawEv ? 'full' : undefined,
          });
          if (r.lastCypher) lastCypher = r.lastCypher;
          collectedResults.push(...r.collectedRows);
          toolResult = r.toolResult;
        } catch (err) {
          toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
        collectedToolOutputs.push(toolResult);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult });
      }
    }

    const gatheredContext = collectedToolOutputs.join('\n\n---\n\n');

    if (state.threadId?.trim()) {
      await this.redis.setChatThread(state.threadId.trim(), {
        phase: 'post_retrieve',
        repositoryId: state.repositoryId,
        projectId: state.projectId,
        gatheredContextChars: gatheredContext.length,
        collectedRows: collectedResults.length,
        at: new Date().toISOString(),
      });
    }

    return {
      lastCypher: lastCypher || undefined,
      collectedResults,
      gatheredContext,
    };
  }

  private async nodeSynthesize(state: CodebaseChatState): Promise<Partial<CodebaseChatState>> {
    const message = state.message;
    const evidenceFirst = state.evidenceFirst;
    const rawEvidence = state.rawEvidence ?? false;
    const useTwoPhase = state.useTwoPhase;
    const gatheredContext = state.gatheredContext ?? '';
    const collectedResults = state.collectedResults ?? [];

    if (rawEvidence) {
      const jsonAnswer = JSON.stringify(
        {
          mode: 'raw_evidence',
          deterministicRetriever: state.deterministicRetriever ?? false,
          gatheredContext,
          collectedResults,
          cypher: state.lastCypher,
        },
        null,
        2,
      );
      return {
        answer: jsonAnswer,
        resultOut: collectedResults.length > 0 ? collectedResults : undefined,
      };
    }

    if (evidenceFirst) {
      try {
        const mdd = await this.ingest.fetchMddEvidence(state.repositoryId, {
          message,
          gatheredContext,
          collectedResults,
          projectScope: state.projectScope,
          projectId: state.projectId,
        });
        const jsonAnswer = JSON.stringify(mdd, null, 2);
        return {
          answer: jsonAnswer,
          resultOut: collectedResults.length > 0 ? collectedResults : undefined,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          answer: JSON.stringify(
            {
              error: 'mdd_evidence_failed',
              message: msg,
              summary: 'Fallo al construir MDD en ingest; verifica INTERNAL_API_KEY e INGEST_URL.',
            },
            null,
            2,
          ),
        };
      }
    }

    const retrievalJson =
      collectedResults.length > 0 || gatheredContext.trim().length > 0
        ? buildRetrievalSummaryJson(collectedResults, gatheredContext)
        : '';
    const evidenceFirstMaxChars = (() => {
      const n = parseInt(process.env.CHAT_EVIDENCE_FIRST_MAX_CHARS ?? '18000', 10);
      return Number.isFinite(n) && n >= 4000 ? Math.min(n, 100_000) : 18000;
    })();
    const twoPhaseContextCap = evidenceFirst ? evidenceFirstMaxChars : 12_000;
    const rawContextForSynth =
      useTwoPhase && gatheredContext.trim() ? gatheredContext.slice(0, twoPhaseContextCap) : gatheredContext;
    const evidenceFirstBlock = evidenceFirst
      ? `## Modo evidence_first (SDD / documentación)
- **Primera sección obligatoria:** \`## Evidencia\` — tabla o viñetas: \`path\` | hecho o símbolo **literal** del contexto siguiente.
- **Segunda sección:** \`## Resumen\` — máximo 6 viñetas; solo repite hechos ya en Evidencia.
- Prioriza **listas** sobre prosa larga. **PROHIBIDO** añadir archivos, stacks o APIs que no aparezcan en el contexto.
- Si un tema no está en el contexto: **(no consta en el índice)** — no inventes.

`
      : '';
    const synthesizerSystem = `${evidenceFirstBlock}## Rol
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
        evidenceFirst ? 3072 : 2048,
      );
    } else {
      answer =
        '**sin datos en índice para este alcance** — no se obtuvo contexto desde las herramientas (Cypher/archivos/RAG). Verifica sync/resync del repositorio o reformula la pregunta.';
    }

    const telemetryEnabled = process.env.CHAT_TELEMETRY_LOG === '1' || process.env.CHAT_TELEMETRY_LOG === 'true';
    if (telemetryEnabled) {
      this.logger.log(
        JSON.stringify({
          event: 'codebase_chat_synthesize',
          repositoryId: state.repositoryId,
          projectId: state.projectId,
          answerChars: answer.length,
        }),
      );
    }

    return {
      answer: answer.trim(),
      resultOut: collectedResults.length > 0 ? collectedResults : undefined,
    };
  }
}
