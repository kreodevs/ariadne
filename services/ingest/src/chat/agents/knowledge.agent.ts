/**
 * Agente de Extracción de Conocimiento.
 * Lee código fuente y extrae el conocimiento para presentarlo en LENGUAJE NATURAL.
 * Respuestas de tipo LÓGICA: tipos, opciones, algoritmos, explicaciones en prosa.
 */
import type { AgentContext, AgentResponse } from './types';

export interface KnowledgeBackend {
  answerTiposOpciones(repositoryId: string, message: string): Promise<string>;
  answerCalculoAlgoritmo(repositoryId: string, message: string): Promise<string>;
  runExplorerWithFileContent(
    repositoryId: string,
    projectId: string,
    message: string,
    historyContent?: string,
  ): Promise<AgentResponse>;
}

export class KnowledgeExtractionAgent {
  constructor(private readonly backend: KnowledgeBackend) {}

  async run(ctx: AgentContext): Promise<AgentResponse> {
    const { repositoryId, projectId, message, historyContent } = ctx;

    // Tipos / opciones / categorías en lenguaje natural
    if (this.isTiposOpciones(message)) {
      const answer = await this.backend.answerTiposOpciones(repositoryId, message);
      return { answer };
    }

    // Cómo se calcula, algoritmo, lógica → extraer en prosa
    if (this.isAlgoritmoOrLogic(message)) {
      const answer = await this.backend.answerCalculoAlgoritmo(repositoryId, message);
      return { answer };
    }

    return this.backend.runExplorerWithFileContent(
      repositoryId,
      projectId,
      message,
      historyContent,
    );
  }

  private isTiposOpciones(message: string): boolean {
    const lower = message.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const triggers = [
      'que tipo de', 'que tipos de', 'que opciones hay', 'que opciones de',
      'que cotizaciones existen', 'que categorias', 'que clases de',
      'tipos de cotizaciones', 'tipos de medios',
      'que variedades', 'que modalidades', 'listar tipos', 'cuales son los tipos',
      'cotizaciones se pueden hacer', 'hacer con el cotizador',
      'por que no aparece', 'no aparece la', 'no aparece el',
      'por que falta', 'falta la cotizacion', 'existe la cotizacion',
    ];
    return triggers.some((t) => lower.includes(t));
  }

  private isAlgoritmoOrLogic(message: string): boolean {
    const lower = message.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const triggers = [
      'resumir los calculos', 'resumir calculos', 'algoritmo de',
      'como se calcula', 'logica de', 'como funciona el',
      'como funciona', 'explicar el calculo',
      'cuales son los calculos', 'calculos especificos', 'que calculos',
      'que formulas', 'que formula', 'para replicar', 'replicar los calculos',
    ];
    return triggers.some((t) => lower.includes(t));
  }
}
