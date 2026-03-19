/**
 * @fileoverview Metadatos de proyecto y generación de Cypher para el nodo :Project (ingest).
 */
import { escapeCypherString } from 'ariadne-common';

/** Metadatos del proyecto (id, nombre, rootPath, rama, manifestDeps). */
export interface ProjectInfo {
  projectId: string;
  projectName: string;
  rootPath: string;
  /** Rama de Git sincronizada (ej. main, develop). */
  branch?: string | null;
  /** Dependency manifest (package.json deps) para contexto IA. */
  manifestDeps?: string | null;
}

/**
 * Genera la sentencia Cypher MERGE para el nodo Project (projectId, projectName, rootPath, lastIndexed, branch, manifestDeps).
 * @param {ProjectInfo} info - Metadatos del proyecto.
 * @returns {string} Sentencia Cypher.
 */
export function buildProjectMergeCypher(info: ProjectInfo): string {
  const now = new Date().toISOString();
  const id = `'${escapeCypherString(info.projectId)}'`;
  const name = `'${escapeCypherString(info.projectName)}'`;
  const root = `'${escapeCypherString(info.rootPath)}'`;
  const last = `'${escapeCypherString(now)}'`;
  const branch =
    info.branch != null && info.branch !== ''
      ? `, p.branch = '${escapeCypherString(info.branch)}'`
      : '';
  const deps =
    info.manifestDeps != null
      ? `, p.manifestDeps = '${escapeCypherString(info.manifestDeps)}'`
      : '';
  return `MERGE (p:Project {projectId: ${id}}) SET p.projectName = ${name}, p.rootPath = ${root}, p.lastIndexed = ${last}${branch}${deps}`;
}
