/**
 * Límites del JSON MDD (The Forge / ask_codebase evidence_first).
 * Defaults altos para volcado casi completo; acota con env si Falkor o memoria lo requieren.
 */
function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export type MddBuilderLimits = {
  openApiOperations: number;
  nestControllers: number;
  models: number;
  nestServices: number;
  evidencePaths: number;
  summaryMessageChars: number;
  openApiFileCandidates: number;
  swaggerRelatedFiles: number;
};

/** Cypher MDD — usar solo enteros sanitizados en plantillas. */
export function getMddBuilderLimits(): MddBuilderLimits {
  return {
    openApiOperations: intEnv('MDD_MAX_OPENAPI_OPERATIONS', 100_000, 1, 1_000_000),
    nestControllers: intEnv('MDD_MAX_NEST_CONTROLLERS', 10_000, 1, 100_000),
    models: intEnv('MDD_MAX_MODELS', 50_000, 1, 500_000),
    nestServices: intEnv('MDD_MAX_NEST_SERVICES', 20_000, 1, 200_000),
    evidencePaths: intEnv('MDD_MAX_EVIDENCE_PATHS', 50_000, 1, 500_000),
    summaryMessageChars: intEnv('MDD_SUMMARY_MESSAGE_CHARS', 16_000, 500, 200_000),
    openApiFileCandidates: intEnv('MDD_MAX_OPENAPI_FILE_CANDIDATES', 25, 1, 200),
    swaggerRelatedFiles: intEnv('MDD_MAX_SWAGGER_RELATED_PATHS', 40, 1, 500),
  };
}

export function getMddPhysicalEvidenceLimits(): { graphFilePaths: number; fileSnippetChars: number } {
  return {
    graphFilePaths: intEnv('MDD_FALLBACK_GRAPH_FILE_PATHS', 2000, 1, 100_000),
    fileSnippetChars: intEnv('MDD_FALLBACK_FILE_SNIPPET_CHARS', 100_000, 1000, 2_000_000),
  };
}
