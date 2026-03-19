/**
 * @fileoverview Flujo de validación SDD (LangGraph): impacto, contratos, shadow compare. Expone runRefactorFlow y runRefactorFlowFull.
 */
import { Injectable } from '@nestjs/common';
import { START, END, StateGraph, Annotation } from '@langchain/langgraph';

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
  filePath: Annotation<string>({ value: lastValue, default: () => '' }),
  currentCode: Annotation<string>({ value: lastValue, default: () => '' }),
  proposedCode: Annotation<string>({ value: lastValue, default: () => '' }),
  shadowCompareResult: Annotation<ShadowCompareResult | null>({
    value: (_x, y) => y ?? null,
    default: () => null,
  }),
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
  filePath: string;
  currentCode: string;
  proposedCode: string;
  shadowCompareResult: ShadowCompareResult | null;
}

const apiBase = () => process.env.FALKORSPEC_API_URL ?? 'http://api:3000';

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
    const res = await fetch(
      `${apiBase()}/graph/contract/${encodeURIComponent(state.nodeId)}`
    );
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = (await res.json()) as { props?: PropSpec[] };
    return { contractProps: data.props ?? [] };
  } catch (err) {
    return { error: String(err), approved: false };
  }
}

function compareContracts(state: RefactorState): Partial<RefactorState> {
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
  return {
    missingInSpec,
    extraInSpec,
    contractsMatch,
    approved,
  };
}

/** Weaver (stub): si hay currentCode y no proposedCode, propuesta = currentCode; si ya viene proposedCode, se mantiene. */
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

/** Indexa código propuesto en grafo shadow vía API. */
async function shadowIndex(state: RefactorState): Promise<Partial<RefactorState>> {
  if (state.error || !state.filePath || !state.proposedCode) return {};
  try {
    const res = await fetch(`${apiBase()}/graph/shadow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{ path: state.filePath, content: state.proposedCode }],
      }),
    });
    if (!res.ok) throw new Error(`Shadow index ${res.status}`);
    return {};
  } catch (err) {
    return { error: String(err), approved: false };
  }
}

/** Compara grafo principal vs shadow para el componente. */
async function compareGraphs(state: RefactorState): Promise<Partial<RefactorState>> {
  if (state.error) return {};
  try {
    const res = await fetch(
      `${apiBase()}/graph/compare/${encodeURIComponent(state.nodeId)}`
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

@Injectable()
export class WorkflowService {
  private graph: { invoke: (s: RefactorState) => Promise<RefactorState> } | null = null;
  private fullGraph: { invoke: (s: RefactorState) => Promise<RefactorState> } | null = null;

  private buildGraph(): { invoke: (s: RefactorState) => Promise<RefactorState> } {
    const workflow = new StateGraph(RefactorStateAnnotation)
      .addNode('validate_impact', (state) => validateImpact(state))
      .addNode('fetch_contracts', (state) => fetchContracts(state))
      .addNode('compare_contracts', (state) => compareContracts(state))
      .addEdge(START, 'validate_impact')
      .addEdge('validate_impact', 'fetch_contracts')
      .addEdge('fetch_contracts', 'compare_contracts')
      .addEdge('compare_contracts', END);
    return workflow.compile();
  }

  private buildFullGraph(): { invoke: (s: RefactorState) => Promise<RefactorState> } {
    const workflow = new StateGraph(RefactorStateAnnotation)
      .addNode('validate_impact', (state) => validateImpact(state))
      .addNode('fetch_contracts', (state) => fetchContracts(state))
      .addNode('compare_contracts', (state) => compareContracts(state))
      .addNode('weaver', (state) => weaver(state))
      .addNode('shadow_index', (state) => shadowIndex(state))
      .addNode('compare_graphs', (state) => compareGraphs(state))
      .addEdge(START, 'validate_impact')
      .addEdge('validate_impact', 'fetch_contracts')
      .addEdge('fetch_contracts', 'compare_contracts')
      .addEdge('compare_contracts', 'weaver')
      .addEdge('weaver', 'shadow_index')
      .addEdge('shadow_index', 'compare_graphs')
      .addEdge('compare_graphs', END);
    return workflow.compile();
  }

  /**
   * Ejecuta el flujo de validación (impacto + contratos). Opcionalmente valida proposedProps contra el contrato del grafo.
   * @param {string} nodeId - Nombre del nodo (componente/función).
   * @param {PropSpec[]} [proposedProps] - Props propuestas para comparar con el contrato.
   * @returns {Promise<RefactorState>} Estado con impactDependents, contractProps, contractsMatch, etc.
   */
  async runRefactorFlow(
    nodeId: string,
    proposedProps?: PropSpec[]
  ): Promise<RefactorState> {
    if (!this.graph) this.graph = this.buildGraph();
    const initial: RefactorState = {
      nodeId,
      impactDependents: [],
      approved: false,
      error: '',
      contractProps: [],
      proposedProps: proposedProps ?? [],
      contractsMatch: true,
      missingInSpec: [],
      extraInSpec: [],
      filePath: '',
      currentCode: '',
      proposedCode: '',
      shadowCompareResult: null,
    };
    const result = await this.graph.invoke(initial);
    return result as RefactorState;
  }

  /**
   * Pipeline completo: impacto, contratos, indexación shadow y compare de grafos. Para refactor con código propuesto.
   * @param {{ nodeId: string; filePath?: string; currentCode?: string; proposedProps?: PropSpec[]; proposedCode?: string }} params - nodeId obligatorio; resto opcional para shadow/compare.
   * @returns {Promise<RefactorState>} Estado final con shadowCompareResult si se envió proposedCode.
   */
  async runRefactorFlowFull(params: {
    nodeId: string;
    filePath?: string;
    currentCode?: string;
    proposedProps?: PropSpec[];
    proposedCode?: string;
  }): Promise<RefactorState> {
    if (!this.fullGraph) this.fullGraph = this.buildFullGraph();
    const initial: RefactorState = {
      nodeId: params.nodeId,
      impactDependents: [],
      approved: false,
      error: '',
      contractProps: [],
      proposedProps: params.proposedProps ?? [],
      contractsMatch: true,
      missingInSpec: [],
      extraInSpec: [],
      filePath: params.filePath ?? '',
      currentCode: params.currentCode ?? '',
      proposedCode: params.proposedCode ?? '',
      shadowCompareResult: null,
    };
    const result = await this.fullGraph.invoke(initial);
    return result as RefactorState;
  }
}
