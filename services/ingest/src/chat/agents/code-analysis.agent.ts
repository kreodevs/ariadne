/**
 * Agente de Análisis de Código.
 * Respuestas de tipo ESTRUCTURA: paths, funciones, componentes, Cypher, métricas, diagnóstico técnico.
 * No explica en prosa; entrega datos concretos (tablas, listas, Cypher ejecutado).
 */
import type { AgentContext, AgentResponse } from './types';

export interface CodeAnalysisBackend {
  answerProjectOverview(repositoryId: string, message: string): Promise<string>;
  answerHowImplemented(repositoryId: string, message: string): Promise<{ answer: string; cypher?: string; result?: unknown[] }>;
  answerWhyAntipattern(repositoryId: string, message: string): Promise<string>;
  answerImportUsage(repositoryId: string, message: string): Promise<string>;
  analyzeDiagnostico(repositoryId: string): Promise<{ summary: string; details?: unknown }>;
  analyzeReingenieria(repositoryId: string): Promise<{ summary: string; details?: unknown }>;
  runExplorerReAct(
    repositoryId: string,
    projectId: string,
    message: string,
    historyContent?: string,
  ): Promise<AgentResponse>;
}

export class CodeAnalysisAgent {
  constructor(private readonly backend: CodeAnalysisBackend) {}

  async run(ctx: AgentContext): Promise<AgentResponse> {
    const { repositoryId, projectId, message, historyContent } = ctx;

    // Overview del proyecto
    if (this.isProjectOverview(message)) {
      const answer = await this.backend.answerProjectOverview(repositoryId, message);
      return { answer };
    }

    // Estructura / cómo está implementado
    if (this.isStructureQuery(message)) {
      return this.backend.answerHowImplemented(repositoryId, message);
    }

    // Por qué es spaghetti/riesgo
    if (this.isWhyAntipattern(message)) {
      const answer = await this.backend.answerWhyAntipattern(repositoryId, message);
      return { answer };
    }

    // Import / uso entre archivos
    if (this.isImportUsage(message)) {
      const answer = await this.backend.answerImportUsage(repositoryId, message);
      return { answer };
    }

    // Diagnóstico de deuda
    if (this.isDiagnosis(message)) {
      const diag = await this.backend.analyzeDiagnostico(repositoryId);
      return {
        answer: `${diag.summary}\n\n_Nota: El grafo usa acoplamiento (CALLS), documentación (JSDoc) y complejidad de props como indicadores de deuda técnica._`,
        result: (diag.details as { highCoupling?: unknown[] })?.highCoupling,
      };
    }

    // Reingeniería / arquitectura
    if (this.isArchitect(message)) {
      const reeng = await this.backend.analyzeReingenieria(repositoryId);
      return { answer: reeng.summary, result: reeng.details as unknown[] | undefined };
    }

    // Debug / explicar código → estructura
    if (this.isDebug(message)) {
      return this.backend.answerHowImplemented(repositoryId, message);
    }

    // Fallback: Explorer ReAct (Cypher, tools)
    return this.backend.runExplorerReAct(repositoryId, projectId, message, historyContent);
  }

  private isProjectOverview(message: string): boolean {
    const lower = message.toLowerCase();
    const triggers = [
      'qué hace', 'que hace', 'de qué trata', 'para qué sirve',
      'qué es este', 'resumen del proyecto',
    ];
    return triggers.some((t) => lower.includes(t));
  }

  private isStructureQuery(message: string): boolean {
    const lower = message.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const triggers = [
      'como esta programado', 'como esta implementado', 'como se implementa',
      'como se programo', 'como funciona', 'como hace', 'estructura de', 'estructura del',
      'que componentes', 'que funciones', 'puntos de entrada',
      'como se hace', 'como se hace el', 'como se hace la', 'donde esta el', 'donde se hace',
    ];
    return triggers.some((t) => lower.includes(t));
  }

  private isWhyAntipattern(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      (lower.includes('por qué') || lower.includes('porque')) &&
      (lower.includes('spaghetti') || lower.includes('considerado') || lower.includes('riesgo'))
    );
  }

  private isImportUsage(message: string): boolean {
    const lower = message.toLowerCase();
    const hasImport = lower.includes('importa') || lower.includes('import ');
    const hasTwoPaths = (message.match(/[\w.-]+\/[\w./-]+\.(tsx?|jsx?|mjs|cjs)/gi) ?? []).length >= 2;
    return hasImport && hasTwoPaths;
  }

  private isDiagnosis(message: string): boolean {
    const lower = message.toLowerCase();
    const triggers = [
      'complejidad', 'refactor', 'deuda técnica', 'qué mejorar', 'prioridades',
      'antipatron', 'antipatrones', 'malas prácticas', 'top 10', 'mayor riesgo',
    ];
    return triggers.some((t) => lower.includes(t));
  }

  private isArchitect(message: string): boolean {
    const lower = message.toLowerCase();
    const triggers = [
      'arquitectura del', 'diseño del', 'reestructurar', 'plan de reingeniería',
      'recomendaciones de arquitectura', 'reingeniería',
    ];
    return triggers.some((t) => lower.includes(t));
  }

  private isDebug(message: string): boolean {
    const lower = message.toLowerCase();
    const triggers = ['depurar', 'debug', 'por qué falla', 'explicar este código', 'bug'];
    return triggers.some((t) => lower.includes(t));
  }
}
