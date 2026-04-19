/**
 * Contrato MDD (7 secciones) para ask_codebase con responseMode evidence_first — consumo por The Forge / LegacyCoordinator.
 */
export interface MddEvidenceDocument {
  summary: string;
  openapi_spec: { found: boolean; path: string | null; trust_level: 'high' | 'medium' | 'low' };
  entities: Array<{ name: string; source: 'prisma' | 'typeorm'; fields: string[] }>;
  api_contracts: Array<{ route: string; methods: string[]; doc_source: 'swagger' | 'ast' }>;
  business_logic: Array<{ service: string; dependencies: string[] }>;
  infrastructure: { orm: string; env_vars: string[] };
  risk_report: { complexity: number; anti_patterns: string[] };
  evidence_paths: string[];
}
