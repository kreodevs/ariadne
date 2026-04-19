/**
 * Modification-plan: archivos desde ingest (Cypher + RAG); preguntas de afinación vía LLM aquí.
 */
import { Injectable } from '@nestjs/common';
import { IngestChatClient } from './ingest-chat.client';
import type { ModificationPlanResult } from './ingest-types';
import type { ChatScope } from './chat-scope.util';
import { hasOrchestratorLlmConfigured } from '../llm/orchestrator-llm-config';
import { OrchestratorLlmService } from './orchestrator-llm.service';

@Injectable()
export class CodebaseModificationPlanService {
  constructor(
    private readonly ingest: IngestChatClient,
    private readonly llm: OrchestratorLlmService,
  ) {}

  private async buildQuestionsToRefine(
    userDescription: string,
    filesToModify: ModificationPlanResult['filesToModify'],
  ): Promise<string[]> {
    if (!hasOrchestratorLlmConfigured()) return [];

    const systemPrompt = `Eres un analista que genera preguntas para afinar un cambio en el software.
Regla: SOLO preguntas de negocio o funcionalidad: valores por defecto, reglas de validación, criterios de negocio, umbrales, opciones permitidas.
PROHIBIDO: preguntas como "¿hay otros componentes a considerar?", "¿qué más archivos?", "¿otras dependencias?". La lista de archivos ya es exhaustiva; no preguntes por exhaustividad.
Formato: devuelve una lista numerada, una pregunta por línea. Si no hay preguntas relevantes, devuelve "Ninguna.".
Máximo 5 preguntas. En español.`;
    const userPrompt = `Descripción del cambio que el usuario quiere hacer:\n\n"${userDescription.slice(0, 800)}"\n\nArchivos que se van a modificar (ya determinados): ${filesToModify.slice(0, 20).map((f) => f.path).join(', ')}${filesToModify.length > 20 ? '...' : ''}\n\nGenera solo preguntas de negocio/funcionalidad para afinar el cambio (valores por defecto, reglas, criterios).`;
    const raw = await this.llm.callLlm(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      512,
    );
    const lines = raw
      .split(/\n+/)
      .map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim())
      .filter((l) => l.length > 10 && !/^ninguna\.?$/i.test(l));
    return lines.slice(0, 5);
  }

  async planRepository(
    repositoryId: string,
    userDescription: string,
    scope?: ChatScope,
  ): Promise<ModificationPlanResult> {
    const trimmed = userDescription?.trim() ?? '';
    if (!trimmed) return { filesToModify: [], questionsToRefine: [] };
    const filesToModify = await this.ingest.fetchModificationPlanFilesRepository(repositoryId, trimmed, scope);
    const questionsToRefine = await this.buildQuestionsToRefine(trimmed, filesToModify);
    return { filesToModify, questionsToRefine };
  }

  async planProject(projectId: string, userDescription: string, scope?: ChatScope): Promise<ModificationPlanResult> {
    const trimmed = userDescription?.trim() ?? '';
    if (!trimmed) return { filesToModify: [], questionsToRefine: [] };
    const filesToModify = await this.ingest.fetchModificationPlanFilesProject(projectId, trimmed, scope);
    const questionsToRefine = await this.buildQuestionsToRefine(trimmed, filesToModify);
    return { filesToModify, questionsToRefine };
  }
}
