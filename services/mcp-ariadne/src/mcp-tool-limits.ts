/**
 * Límites de salida de herramientas MCP — defaults altos (información completa).
 * Reducir vía env si las respuestas saturan el contexto del LLM o el tiempo de Falkor.
 */
function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export const mcpLimits = {
  get semanticSearchDefault(): number {
    return intEnv('MCP_SEMANTIC_SEARCH_DEFAULT', 200, 1, 50_000);
  },
  get semanticSearchMax(): number {
    return intEnv('MCP_SEMANTIC_SEARCH_MAX', 5000, 1, 100_000);
  },
  get semanticVectorKMax(): number {
    return intEnv('MCP_SEMANTIC_VECTOR_K_MAX', 500, 20, 10_000);
  },
  get semanticKeywordSubqueryLimit(): number {
    return intEnv('MCP_SEMANTIC_KEYWORD_SUBQUERY_LIMIT', 2000, 50, 50_000);
  },
  get fileContextMaxChars(): number {
    return intEnv('MCP_FILE_CONTEXT_MAX_CHARS', 500_000, 1000, 5_000_000);
  },
  get standardsFileSnippetChars(): number {
    return intEnv('MCP_STANDARDS_FILE_SNIPPET_CHARS', 200_000, 500, 5_000_000);
  },
  get affectedNodesMax(): number {
    return intEnv('MCP_AFFECTED_NODES_MAX', 2000, 1, 50_000);
  },
  get affectedFilesMax(): number {
    return intEnv('MCP_AFFECTED_FILES_MAX', 2000, 1, 50_000);
  },
  get unusedExportsMax(): number {
    return intEnv('MCP_UNUSED_EXPORTS_MAX', 2000, 1, 50_000);
  },
  get implementationDescChars(): number {
    return intEnv('MCP_IMPLEMENTATION_DESC_CHARS', 8000, 50, 100_000);
  },
  get implementationInlineDescChars(): number {
    return intEnv('MCP_IMPLEMENTATION_INLINE_DESC_CHARS', 4000, 50, 50_000);
  },
  get implementationFunctionsLimit(): number {
    return intEnv('MCP_IMPLEMENTATION_FUNCTIONS_LIMIT', 50, 1, 500);
  },
  get definitionsPerKindLimit(): number {
    return intEnv('MCP_DEFINITIONS_PER_KIND_LIMIT', 50, 1, 500);
  },
  get traceUnreachableComponentsMax(): number {
    return intEnv('MCP_TRACE_UNREACHABLE_COMPONENTS_MAX', 2000, 1, 50_000);
  },
  get traceUnreachableFuncsMax(): number {
    return intEnv('MCP_TRACE_UNREACHABLE_FUNCS_MAX', 2000, 1, 50_000);
  },
  get traceUncalledFuncsQueryLimit(): number {
    return intEnv('MCP_TRACE_UNCALLED_FUNCS_QUERY_LIMIT', 2000, 10, 50_000);
  },
  get findSimilarDefault(): number {
    return intEnv('MCP_FIND_SIMILAR_DEFAULT', 50, 1, 5000);
  },
  get findSimilarMax(): number {
    return intEnv('MCP_FIND_SIMILAR_MAX', 5000, 1, 50_000);
  },
  get findSimilarVectorKMax(): number {
    return intEnv('MCP_FIND_SIMILAR_VECTOR_K_MAX', 500, 20, 10_000);
  },
  get findSimilarKeywordLimit(): number {
    return intEnv('MCP_FIND_SIMILAR_KEYWORD_LIMIT', 2000, 50, 50_000);
  },
  get debtReportIsolatedLimit(): number {
    return intEnv('MCP_DEBT_REPORT_ISOLATED_LIMIT', 2000, 10, 50_000);
  },
  get findDuplicatesGroupLimit(): number {
    return intEnv('MCP_FIND_DUPLICATES_GROUP_LIMIT', 500, 1, 10_000);
  },
  get syncStatusRecentJobsMax(): number {
    return intEnv('MCP_SYNC_STATUS_RECENT_JOBS_MAX', 50, 1, 500);
  },
};
