export type RetrieverToolName = 'execute_cypher' | 'semantic_search' | 'get_graph_summary' | 'get_file_content';

export type AnalyzeMode =
  | 'diagnostico'
  | 'duplicados'
  | 'reingenieria'
  | 'codigo_muerto'
  | 'seguridad'
  | 'agents'
  | 'skill';

export interface AnalyzeResult {
  mode: AnalyzeMode;
  summary: string;
  details?: unknown;
}

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

export interface ModificationPlanResult {
  filesToModify: Array<{ path: string; repoId: string }>;
  questionsToRefine: string[];
}
