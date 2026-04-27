/**
 * Placeholder: extracción de dominio con LLM durante la indexación (Opción B).
 *
 * Si el MVP heurístico (domain-extract.ts) da poco valor para un proyecto,
 * se puede activar esta fase post-sync:
 *
 * 1. Por cada Function/Component con path relevante (cotizador, precio, config)
 * 2. Chunk de código + contexto → LLM: "Extrae conceptos de dominio y fórmulas"
 * 3. Respuesta estructurada (JSON) → crear nodos Formula, BusinessRule, DomainConcept
 *
 * Requiere OPENROUTER_API_KEY. Coste: ~1 LLM call por batch de archivos.
 * Para activar: importar y llamar desde sync.service tras runCypherBatch.
 */
export const DOMAIN_EXTRACT_LLM_PLACEHOLDER = true;
