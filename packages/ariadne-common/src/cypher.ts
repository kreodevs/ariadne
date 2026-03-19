/**
 * Utilidades para construir strings Cypher seguros (escape de comillas y backslash).
 */

/**
 * Escapa backslash y comilla simple para interpolar strings en Cypher.
 * @param s - String a escapar.
 * @returns String listo para usar dentro de comillas simples en Cypher.
 */
export function escapeCypherString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Devuelve el string escapado y envuelto en comillas simples para Cypher.
 * @param s - String a escapar.
 * @returns String en forma '...' listo para Cypher.
 */
export function cypherSafe(s: string): string {
  return `'${escapeCypherString(s)}'`;
}
