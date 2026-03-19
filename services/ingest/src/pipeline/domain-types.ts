/**
 * Tipos para el grafo de dominio (DomainConcept).
 */

/** Patrones por proyecto (componentPatterns: "Cotizador*", "*Template"; constNames: "OPTIONS", "TIPOS"). */
export interface DomainConfig {
  componentPatterns?: string[];
  constNames?: string[];
}

export interface DomainConceptInfo {
  name: string;
  category: 'tipo' | 'opcion' | 'context';
  description?: string;
  options?: string[];
  sourcePath: string;
  sourceRef: string;
}
