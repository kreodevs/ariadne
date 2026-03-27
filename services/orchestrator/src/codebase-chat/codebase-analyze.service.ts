/**
 * Análisis /analyze: prep desde ingest (sin LLM allí salvo builders) + síntesis en orchestrator.
 */
import { Injectable } from '@nestjs/common';
import { IngestChatClient } from './ingest-chat.client';
import type { AnalyzeMode, AnalyzeOrchestratorPrepDto, AnalyzeResult } from './ingest-types';
import { OrchestratorLlmService } from './orchestrator-llm.service';

function normalizeDetailsAfterLlm(details: unknown): unknown | undefined {
  if (details === undefined || details === null) return undefined;
  if (typeof details === 'object' && !Array.isArray(details) && Object.keys(details as object).length === 0) {
    return undefined;
  }
  return details;
}

@Injectable()
export class CodebaseAnalyzeService {
  constructor(
    private readonly ingest: IngestChatClient,
    private readonly llm: OrchestratorLlmService,
  ) {}

  private async runLlmBranch(prep: Extract<AnalyzeOrchestratorPrepDto, { kind: 'llm' }>): Promise<AnalyzeResult> {
    const summary = await this.llm.callLlm(
      [
        { role: 'system', content: prep.systemPrompt },
        { role: 'user', content: prep.userPrompt },
      ],
      prep.maxTokens,
    );
    return {
      mode: prep.mode,
      summary,
      details: normalizeDetailsAfterLlm(prep.details),
    };
  }

  async analyzeRepository(repositoryId: string, mode: AnalyzeMode): Promise<AnalyzeResult> {
    const prep = await this.ingest.fetchAnalyzePrepRepository(repositoryId, mode);
    if (prep.kind === 'complete') return prep.result;
    return this.runLlmBranch(prep);
  }

  async analyzeProject(projectId: string, mode: 'agents' | 'skill'): Promise<AnalyzeResult> {
    const prep = await this.ingest.fetchAnalyzePrepProject(projectId, mode);
    if (prep.kind === 'complete') return prep.result;
    return this.runLlmBranch(prep);
  }
}
