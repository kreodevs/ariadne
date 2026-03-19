/**
 * Agente Coordinador/Supervisor.
 * Clasifica la pregunta con LLM y delega al agente especialista.
 * Reemplaza el parser de strings por decisión semántica.
 * @see Architecting Agentic Systems — Supervisor pattern
 */
import type { AgentRoute } from './types';
import { CodeAnalysisAgent } from './code-analysis.agent';
import { KnowledgeExtractionAgent } from './knowledge.agent';
import type { CodeAnalysisBackend } from './code-analysis.agent';
import type { KnowledgeBackend } from './knowledge.agent';

export interface CoordinatorDeps {
  callLlm: (messages: Array<{ role: 'user' | 'system'; content: string }>, maxTokens?: number) => Promise<string>;
  codeBackend: CodeAnalysisBackend;
  knowledgeBackend: KnowledgeBackend;
}

const ROUTE_PROMPT = `<instrucciones>
Eres un router que clasifica preguntas de usuarios sobre un codebase. Tu única tarea es elegir UNA categoría.
</instrucciones>

<categorias>

| Categoría | Cuándo usar | Tipo de respuesta esperada |
|-----------|-------------|----------------------------|
| **code_analysis** | El usuario quiere ESTRUCTURA o DATOS concretos: paths, archivos, componentes, funciones, dependencias, métricas, "en qué componentes/módulos se usa X", "dónde está X", "qué archivos importan Y" | Listas, tablas, nombres concretos de archivos/funciones |
| **knowledge_extraction** | El usuario quiere EXPLICACIÓN en prosa: impacto de un cambio, consecuencias, flujos, procesos, por qué se hace algo, cómo funciona el proceso de X, qué pasa si cambio Y, tipos/categorías del dominio, fórmulas o algoritmos | Respuesta narrativa legible, explicación causal, NO listas de archivos |
| **explorer** | Búsqueda abierta, exploración libre, no encaja en las anteriores | Varía |
</categorias>

<regla_desempate>
- **"en qué componentes usan X"** / **"dónde se usa X"** (ubicación concreta) → code_analysis
- **"cómo impacta si cambio X"** / **"qué pasa si modifico"** (consecuencias) → knowledge_extraction
- **"cómo se hace el/la X"** (implementación de feature) → code_analysis
- **"cómo se calcula X"** (fórmulas, cálculos) → knowledge_extraction
- **"cómo es el proceso de"** / **"cómo funciona el flujo"** → knowledge_extraction
</regla_desempate>

<restricciones>
- NO expliques tu decisión. NO inventes categorías.
- Responde ÚNICAMENTE con una palabra.
- Si la petición NO es sobre el codebase, responde: explorer
</restricciones>

<ejemplos>
qué tipos de cotizaciones existen → knowledge_extraction
cuáles son los cálculos específicos para replicarlos → knowledge_extraction
cómo impacta al código si cambio esta variable → knowledge_extraction
cómo es el proceso de consulta de cotizaciones → knowledge_extraction
qué pasa si modifico el valor X → knowledge_extraction
por qué se usa este componente aquí → knowledge_extraction
cómo se hace el login → code_analysis
cómo está implementado el auth → code_analysis
en qué componentes o módulos usamos la variable X → code_analysis
qué componentes usan useState → code_analysis
archivos que importan X → code_analysis
qué hace este proyecto → explorer
xyz inexistente sin contexto → explorer
</ejemplos>

<pregunta>
`;

export class CoordinatorAgent {
  private readonly codeAgent: CodeAnalysisAgent;
  private readonly knowledgeAgent: KnowledgeExtractionAgent;

  constructor(private readonly deps: CoordinatorDeps) {
    this.codeAgent = new CodeAnalysisAgent(deps.codeBackend);
    this.knowledgeAgent = new KnowledgeExtractionAgent(deps.knowledgeBackend);
  }

  /** Clasifica con LLM y delega al agente correspondiente. */
  async route(ctx: {
    repositoryId: string;
    projectId: string;
    message: string;
    historyContent?: string;
  }): Promise<{ answer: string; cypher?: string; result?: unknown[] }> {
    // Override determinístico
    const route =
      this.forceCodeAnalysisFor(ctx.message) ??
      this.forceKnowledgeFor(ctx.message) ??
      (await this.classifyRoute(ctx.message));
    const agentCtx = {
      repositoryId: ctx.repositoryId,
      projectId: ctx.projectId,
      message: ctx.message,
      historyContent: ctx.historyContent,
    };

    if (route === 'knowledge_extraction') {
      return this.knowledgeAgent.run(agentCtx);
    }

    return this.codeAgent.run(agentCtx);
  }

  /** Override: preguntas de conocimiento (explicación, impacto, proceso) → knowledge. */
  private forceKnowledgeFor(message: string): AgentRoute | null {
    const lower = message.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const triggers = [
      // Tipos/opciones/cotizaciones
      'por que no aparece', 'no aparece la', 'no aparece el',
      'por que falta', 'falta la cotizacion', 'existe la cotizacion',
      'que tipo de cotizaciones', 'que tipos de cotizaciones',
      'que tipos de cotizacion', 'tipos de cotizacion', 'tipo de cotizaciones',
      'cotizaciones se pueden hacer', 'cotizaciones se puede hacer',
      'hacer con el cotizador', 'tipos de cotizador',
      // Impacto, consecuencias, proceso, flujo, explicación causal
      'como impacta', 'como impactaria', 'que impacta', 'que impacto',
      'que pasa si', 'que pasaria si', 'que sucede si',
      'consecuencia de cambiar', 'consecuencias de modificar',
      'como es el proceso', 'como es la proceso',
      'como funciona el proceso', 'como funciona la proceso',
      'explicar el proceso', 'explicar el flujo', 'explicar la flujo',
      'como es el flujo', 'flujo de consulta', 'proceso de consulta',
      'por que se usa', 'por que se utiliza', 'por que usamos',
    ];
    return triggers.some((t) => lower.includes(t)) ? 'knowledge_extraction' : null;
  }

  /** Override: preguntas de estructura (dónde, en qué, listas) → code_analysis. */
  private forceCodeAnalysisFor(message: string): AgentRoute | null {
    const lower = message.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const triggers = [
      'como se hace el ', 'como se hace la ', 'como se hace los ', 'como se hace las ',
      'como esta programado', 'como esta implementado', 'como se implementa',
      'como se programo ',
      'donde esta el ', 'donde se hace', 'donde esta la ', 'donde esta ',
      'en que componente', 'en que componentes', 'en que modulos', 'en que modulo',
      'que componente usa', 'que componentes usan', 'que modulos usan',
      'archivos que importan', 'archivos que usan',
    ];
    return triggers.some((t) => lower.includes(t)) ? 'code_analysis' : null;
  }

  private async classifyRoute(message: string): Promise<AgentRoute> {
    try {
      const response = await this.deps.callLlm(
        [{ role: 'user', content: ROUTE_PROMPT + message + '\n</pregunta>' }],
        32,
      );
      const raw = (response ?? '').trim().toLowerCase();
      if (raw.includes('knowledge_extraction') || raw.includes('knowledge')) return 'knowledge_extraction';
      if (raw.includes('explorer')) return 'explorer';
      return 'code_analysis';
    } catch {
      return 'explorer';
    }
  }
}
