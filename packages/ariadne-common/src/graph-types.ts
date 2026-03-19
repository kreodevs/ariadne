/**
 * Tipos mínimos para utilidades de grafo (buildExportsMap, resolveCrossFileCalls).
 * Compatibles con ParsedFile de ingest y cartographer.
 */

/** Llamada resuelta entre archivos: caller -> callee. */
export interface ResolvedCallInfo {
  callerPath: string;
  callerName: string;
  calleePath: string;
  calleeName: string;
}

/** Import: specifier, si es default, nombres locales. */
export interface ImportInfoMinimal {
  specifier: string;
  isDefault: boolean;
  localNames: string[];
}

/** Llamada no resuelta (solo nombre local del callee). */
export interface UnresolvedCallMinimal {
  caller: string;
  calleeLocalName: string;
}

/**
 * Contrato mínimo de un archivo parseado para buildExportsMap y resolveCrossFileCalls.
 */
export interface ParsedFileMinimal {
  path: string;
  imports: ImportInfoMinimal[];
  functions?: Array<{ name: string }>;
  components?: Array<{ name: string }>;
  unresolvedCalls?: UnresolvedCallMinimal[];
}
