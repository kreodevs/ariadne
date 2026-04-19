/**
 * @fileoverview Flujo SDD (LangGraph): impacto, verificación de contratos, shadow, ciclo de revisión ante errores Falkor/Cypher, tests sugeridos.
 */
import { Injectable } from '@nestjs/common';
import { START, END, StateGraph, Annotation } from '@langchain/langgraph';
import { hasOrchestratorLlmConfigured } from '../llm/orchestrator-llm-config';
import { orchestratorChatSimple } from '../llm/orchestrator-llm.facade';

/** Propuesta de prop (nombre y si es requerida). */
export interface PropSpec {
  name: string;
  required: boolean;
}

export interface ShadowCompareResult {
  match: boolean;
  mainProps: PropSpec[];
  shadowProps: PropSpec[];
  missingInShadow: string[];
  extraInShadow: string[];
}

/** Reducer "último valor gana" para tipos simples */
const lastValue = <T>(x: T, y: T) => (y !== undefined && y !== null ? y : x);
const revAttemptReducer = (prev: number, next: number | undefined) =>
  next !== undefined && next !== null ? next : prev ?? 0;

/** Estado del flujo de validación de refactor (SDD — constitution §4). */
const RefactorStateAnnotation = Annotation.Root({
  nodeId: Annotation<string>(),
  impactDependents: Annotation<Array<{ name: string; labels: string[] }>>({
    value: (_x, y) => y ?? [],
    default: () => [],
  }),
  approved: Annotation<boolean>({ value: lastValue, default: () => false }),
  error: Annotation<string>({ value: lastValue, default: () => '' }),
  contractProps: Annotation<PropSpec[]>({
    value: (_x, y) => y ?? [],
    default: () => [],
  }),
  proposedProps: Annotation<PropSpec[]>({
    value: (_x, y) => y ?? [],
    default: () => [],
  }),
  contractsMatch: Annotation<boolean>({ value: lastValue, default: () => true }),
  missingInSpec: Annotation<string[]>({
    value: (_x, y) => y ?? [],
    default: () => [],
  }),
  extraInSpec: Annotation<string[]>({
    value: (_x, y) => y ?? [],
    default: () => [],
  }),
  verificationSummary: Annotation<string>({ value: lastValue, default: () => '' }),
  filePath: Annotation<string>({ value: lastValue, default: () => '' }),
  currentCode: Annotation<string>({ value: lastValue, default: () => '' }),
  proposedCode: Annotation<string>({ value: lastValue, default: () => '' }),
  shadowCompareResult: Annotation<ShadowCompareResult | null>({
    value: (_x, y) => y ?? null,
    default: () => null,
  }),
  /** Indexación shadow OK; si false, `falkorIngestError` tiene detalle (Cypher/API). */
  shadowIndexOk: Annotation<boolean>({ value: lastValue, default: () => true }),
  /** Namespace FalkorDB devuelto por POST /graph/shadow (compare debe usar la misma sesión). */
  shadowSessionId: Annotation<string>({ value: lastValue, default: () => '' }),
  falkorIngestError: Annotation<string>({ value: lastValue, default: () => '' }),
  revisionAttempt: Annotation<number>({
    value: revAttemptReducer,
    default: () => 0,
  }),
  maxRevisions: Annotation<number>({ value: lastValue, default: () => 3 }),
  generatedTests: Annotation<string>({ value: lastValue, default: () => '' }),
});

export interface RefactorState {
  nodeId: string;
  impactDependents: Array<{ name: string; labels: string[] }>;
  approved: boolean;
  error: string;
  contractProps: PropSpec[];
  proposedProps: PropSpec[];
  contractsMatch: boolean;
  missingInSpec: string[];
  extraInSpec: string[];
  verificationSummary: string;
  filePath: string;
  currentCode: string;
  proposedCode: string;
  shadowCompareResult: ShadowCompareResult | null;
  shadowIndexOk: boolean;
  shadowSessionId: string;
  falkorIngestError: string;
  revisionAttempt: number;
  maxRevisions: number;
  generatedTests: string;
}

const apiBase = () =>
  process.env.ARIADNESPEC_API_URL ??
  process.env.FALKORSPEC_API_URL ??
  'http://api:3000/api';

/** Quita cercos ``` del modelo. */
function stripCodeFence(s: string): string {
  let t = s.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '');
  }
  return t.trim();
}

async function validateImpact(state: RefactorState): Promise<Partial<RefactorState>> {
  try {
    const res = await fetch(`${apiBase()}/graph/impact/${encodeURIComponent(state.nodeId)}`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = (await res.json()) as { dependents?: Array<{ name: string; labels: string[] }> };
    const impactDependents = data.dependents ?? [];
    const approved = impactDependents.length === 0;
    return { impactDependents, approved };
  } catch (err) {
    return { error: String(err), approved: false };
  }
}

async function fetchContracts(state: RefactorState): Promise<Partial<RefactorState>> {
  if (state.error) return {};
  try {
    const res = await fetch(`${apiBase()}/graph/contract/${encodeURIComponent(state.nodeId)}`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = (await res.json()) as { props?: PropSpec[] };
    return { contractProps: data.props ?? [] };
  } catch (err) {
    return { error: String(err), approved: false };
  }
}

/** Verificador explícito de contrato (props grafo vs spec propuesta). */
function contractVerifier(state: RefactorState): Partial<RefactorState> {
  const graphProps = new Map(state.contractProps.map((p) => [p.name, p.required]));
  const specProps = new Map(state.proposedProps.map((p) => [p.name, p.required]));
  const missingInSpec: string[] = [];
  const extraInSpec: string[] = [];
  for (const name of graphProps.keys()) {
    if (!specProps.has(name)) missingInSpec.push(name);
  }
  for (const name of specProps.keys()) {
    if (!graphProps.has(name)) extraInSpec.push(name);
  }
  const contractsMatch = missingInSpec.length === 0 && extraInSpec.length === 0;
  const approved = state.approved && contractsMatch;
  const verificationSummary = contractsMatch
    ? 'Contrato: spec alineada con grafo Falkor (props y nombres).'
    : `Contrato: faltan en spec [${missingInSpec.join(', ')}]; extra en spec [${extraInSpec.join(', ')}].`;
  return {
    missingInSpec,
    extraInSpec,
    contractsMatch,
    approved,
    verificationSummary,
  };
}

function weaver(state: RefactorState): Partial<RefactorState> {
  if (state.error) return {};
  const proposedCode =
    state.proposedCode !== ''
      ? state.proposedCode
      : state.currentCode !== ''
        ? state.currentCode
        : '';
  return { proposedCode };
}

/** Indexa shadow; captura cuerpo de error (Cypher/ingest) para el ciclo de revisión. */
async function shadowIndex(state: RefactorState): Promise<Partial<RefactorState>> {
  if (state.error) {
    return { shadowIndexOk: false };
  }
  if (!state.filePath || !state.proposedCode) {
    return { shadowIndexOk: true, falkorIngestError: '' };
  }
  try {
    const res = await fetch(`${apiBase()}/graph/shadow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{ path: state.filePath, content: state.proposedCode }],
        ...(state.shadowSessionId?.trim()
          ? { shadowSessionId: state.shadowSessionId.trim() }
          : {}),
      }),
    });
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const embedded =
        typeof data === 'object' && data !== null
          ? JSON.stringify(data)
          : `HTTP ${res.status}`;
      return {
        shadowIndexOk: false,
        falkorIngestError: embedded,
        error: `Shadow/Falkor indexación fallida (${res.status}): ${embedded}`,
        approved: false,
      };
    }
    const sid =
      typeof data === 'object' &&
      data !== null &&
      'shadowSessionId' in data &&
      typeof (data as { shadowSessionId: unknown }).shadowSessionId === 'string'
        ? (data as { shadowSessionId: string }).shadowSessionId
        : state.shadowSessionId;
    return {
      shadowIndexOk: true,
      falkorIngestError: '',
      error: '',
      shadowSessionId: sid?.trim() ?? '',
    };
  } catch (err) {
    const msg = String(err);
    return {
      shadowIndexOk: false,
      falkorIngestError: msg,
      error: msg,
      approved: false,
    };
  }
}

async function reviseCodeWithLlm(state: RefactorState): Promise<Partial<RefactorState>> {
  const feedback = state.falkorIngestError || state.error;
  if (!feedback || !state.proposedCode) {
    return { error: 'Sin texto de error o código para revisar', approved: false };
  }
  try {
    const system =
      'Eres un editor de código. Corriges el archivo para que pueda indexarse en un grafo (TypeScript/TSX). ' +
      'Devuelve únicamente el código completo del archivo, sin markdown ni explicación.';
    const user = [
      `Error del indexador (Falkor/Cypher o API; usa este contexto para corregir):\n${feedback.slice(0, 12000)}`,
      `\n\nArchivo: ${state.filePath}`,
      '\n\nCódigo actual:\n',
      state.proposedCode.slice(0, 48000),
    ].join('');
    const raw = await orchestratorChatSimple(system, user);
    const code = stripCodeFence(raw);
    if (!code) {
      return { error: 'LLM no configurado o respuesta vacía del modelo (LLM_PROVIDER / LLM_API_KEY)', approved: false };
    }
    return {
      proposedCode: code,
      revisionAttempt: (state.revisionAttempt ?? 0) + 1,
      falkorIngestError: '',
      error: '',
    };
  } catch (err) {
    return { error: `revise_code_llm: ${String(err)}`, approved: false };
  }
}

function routeAfterShadow(state: RefactorState): typeof END | 'compare_graphs' | 'revise_code_llm' {
  if (state.shadowIndexOk !== false) return 'compare_graphs';
  const max = state.maxRevisions ?? 3;
  const n = state.revisionAttempt ?? 0;
  const canRevise =
    (state.falkorIngestError?.length ?? 0) > 0 &&
    n < max &&
    hasOrchestratorLlmConfigured();
  if (canRevise) return 'revise_code_llm';
  return END;
}

async function compareGraphs(state: RefactorState): Promise<Partial<RefactorState>> {
  if (state.error) return {};
  try {
    const sid = state.shadowSessionId?.trim();
    const q = sid ? `?shadowSessionId=${encodeURIComponent(sid)}` : '';
    const res = await fetch(
      `${apiBase()}/graph/compare/${encodeURIComponent(state.nodeId)}${q}`,
    );
    if (!res.ok) throw new Error(`Compare ${res.status}`);
    const data = (await res.json()) as ShadowCompareResult & { componentName?: string };
    const shadowCompareResult: ShadowCompareResult = {
      match: data.match,
      mainProps: data.mainProps ?? [],
      shadowProps: data.shadowProps ?? [],
      missingInShadow: data.missingInShadow ?? [],
      extraInShadow: data.extraInShadow ?? [],
    };
    const approved = state.approved && shadowCompareResult.match;
    return { shadowCompareResult, approved };
  } catch (err) {
    return { error: String(err), approved: false };
  }
}

/** Generador de tests (plantilla + LLM opcional). */
async function generateTests(state: RefactorState): Promise<Partial<RefactorState>> {
  if (state.error || !state.approved) return {};
  const props = state.contractProps.length ? state.contractProps : state.shadowCompareResult?.mainProps ?? [];
  if (!hasOrchestratorLlmConfigured()) {
    const lines = [
      `// Tests sugeridos para ${state.nodeId} (generar con ORCHESTRATOR + LLM_API_KEY para código completo)`,
      `// Props del contrato: ${JSON.stringify(props)}`,
      `import { describe, it, expect } from 'vitest';`,
      `// TODO: render/mount ${state.nodeId} y validar props requeridas`,
    ];
    return { generatedTests: lines.join('\n') };
  }
  try {
    const system =
      'Generas un único archivo de test Vitest/React Testing Library o similar. Solo código, sin markdown.';
    const user = `Componente (o nodo): ${state.nodeId}\nProps: ${JSON.stringify(props)}\nPath: ${state.filePath}`;
    const raw = await orchestratorChatSimple(system, user);
    return { generatedTests: stripCodeFence(raw) || raw };
  } catch {
    return { generatedTests: `// Error al generar tests con LLM para ${state.nodeId}` };
  }
}

@Injectable()
export class WorkflowService {
  private graph: { invoke: (s: RefactorState) => Promise<RefactorState> } | null = null;
  private fullGraph: { invoke: (s: RefactorState) => Promise<RefactorState> } | null = null;

  private emptyState(partial: Partial<RefactorState>): RefactorState {
    return {
      nodeId: partial.nodeId ?? '',
      impactDependents: partial.impactDependents ?? [],
      approved: partial.approved ?? false,
      error: partial.error ?? '',
      contractProps: partial.contractProps ?? [],
      proposedProps: partial.proposedProps ?? [],
      contractsMatch: partial.contractsMatch ?? true,
      missingInSpec: partial.missingInSpec ?? [],
      extraInSpec: partial.extraInSpec ?? [],
      verificationSummary: partial.verificationSummary ?? '',
      filePath: partial.filePath ?? '',
      currentCode: partial.currentCode ?? '',
      proposedCode: partial.proposedCode ?? '',
      shadowCompareResult: partial.shadowCompareResult ?? null,
      shadowIndexOk: partial.shadowIndexOk ?? true,
      shadowSessionId: partial.shadowSessionId ?? '',
      falkorIngestError: partial.falkorIngestError ?? '',
      revisionAttempt: partial.revisionAttempt ?? 0,
      maxRevisions: partial.maxRevisions ?? 3,
      generatedTests: partial.generatedTests ?? '',
    };
  }

  private buildGraph(): { invoke: (s: RefactorState) => Promise<RefactorState> } {
    const workflow = new StateGraph(RefactorStateAnnotation)
      .addNode('validate_impact', (s) => validateImpact(s))
      .addNode('fetch_contracts', (s) => fetchContracts(s))
      .addNode('contract_verifier', (s) => contractVerifier(s))
      .addEdge(START, 'validate_impact')
      .addEdge('validate_impact', 'fetch_contracts')
      .addEdge('fetch_contracts', 'contract_verifier')
      .addEdge('contract_verifier', END);
    return workflow.compile();
  }

  private buildFullGraph(): { invoke: (s: RefactorState) => Promise<RefactorState> } {
    const workflow = new StateGraph(RefactorStateAnnotation)
      .addNode('validate_impact', (s) => validateImpact(s))
      .addNode('fetch_contracts', (s) => fetchContracts(s))
      .addNode('contract_verifier', (s) => contractVerifier(s))
      .addNode('weaver', (s) => weaver(s))
      .addNode('shadow_index', (s) => shadowIndex(s))
      .addNode('revise_code_llm', (s) => reviseCodeWithLlm(s))
      .addNode('compare_graphs', (s) => compareGraphs(s))
      .addNode('generate_tests', (s) => generateTests(s))
      .addEdge(START, 'validate_impact')
      .addEdge('validate_impact', 'fetch_contracts')
      .addEdge('fetch_contracts', 'contract_verifier')
      .addEdge('contract_verifier', 'weaver')
      .addEdge('weaver', 'shadow_index')
      .addConditionalEdges('shadow_index', routeAfterShadow, {
        compare_graphs: 'compare_graphs',
        revise_code_llm: 'revise_code_llm',
        [END]: END,
      })
      .addEdge('revise_code_llm', 'shadow_index')
      .addEdge('compare_graphs', 'generate_tests')
      .addEdge('generate_tests', END);
    return workflow.compile();
  }

  /**
   * Impacto + contratos + verificación explícita de spec.
   */
  async runRefactorFlow(nodeId: string, proposedProps?: PropSpec[]): Promise<RefactorState> {
    if (!this.graph) this.graph = this.buildGraph();
    const initial = this.emptyState({
      nodeId,
      proposedProps: proposedProps ?? [],
    });
    const result = await this.graph.invoke(initial);
    return result as RefactorState;
  }

  /**
   * Pipeline completo: verificación de contrato, shadow, bucle LLM ante error Falkor/Cypher, compare y tests.
   */
  async runRefactorFlowFull(params: {
    nodeId: string;
    filePath?: string;
    currentCode?: string;
    proposedProps?: PropSpec[];
    proposedCode?: string;
    maxRevisions?: number;
  }): Promise<RefactorState> {
    if (!this.fullGraph) this.fullGraph = this.buildFullGraph();
    const initial = this.emptyState({
      nodeId: params.nodeId,
      proposedProps: params.proposedProps ?? [],
      filePath: params.filePath ?? '',
      currentCode: params.currentCode ?? '',
      proposedCode: params.proposedCode ?? '',
      maxRevisions: params.maxRevisions ?? 3,
    });
    const result = await this.fullGraph.invoke(initial);
    return result as RefactorState;
  }
}
