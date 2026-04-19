/**
 * Contrato MDD (7 secciones) para ask_codebase con responseMode evidence_first — consumo por The Forge / LegacyCoordinator.
 */
export interface MddEvidenceDocument {
  summary: string;
  openapi_spec: {
    found: boolean;
    path: string | null;
    trust_level: 'high' | 'medium' | 'low';
    /** true si manifestDeps agregado del proyecto incluye @nestjs/swagger / swagger-ui / openapi */
    swagger_dependencies?: boolean;
    /** Rutas de File en Falkor cuyo path sugiere configuración Swagger/OpenAPI (sin ser spec indexada). */
    swagger_related_paths?: string[];
    /** Markdown u otros docs del alcance que parecen inventario/manual de API (evidencia textual). */
    supplementary_doc_paths?: string[];
    /** Aclaración para consumidores (p. ej. spec generada en build y no commiteada). */
    notes?: string;
  };
  entities: Array<{ name: string; source: 'prisma' | 'typeorm'; fields: string[] }>;
  api_contracts: Array<{ route: string; methods: string[]; doc_source: 'swagger' | 'ast' }>;
  business_logic: Array<{ service: string; dependencies: string[] }>;
  infrastructure: { orm: string; env_vars: string[] };
  risk_report: { complexity: number; anti_patterns: string[] };
  evidence_paths: string[];
}
