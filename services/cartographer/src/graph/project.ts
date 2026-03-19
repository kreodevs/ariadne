/**
 * @fileoverview Extracción de metadatos de proyecto para indexación multi-proyecto (Cartographer).
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

/**
 * Metadatos de un proyecto indexado (id, nombre, ruta raíz).
 * @typedef {Object} ProjectInfo
 * @property {string} projectId - Identificador determinista derivado del rootPath.
 * @property {string} projectName - Nombre del proyecto (package.json name o basename del path).
 * @property {string} rootPath - Ruta raíz del proyecto normalizada.
 */
export interface ProjectInfo {
  projectId: string;
  projectName: string;
  rootPath: string;
}

/**
 * Genera un ID tipo UUID determinista a partir del path para que MERGE actualice el mismo proyecto en re-scan.
 * @param {string} rootPath - Ruta raíz del proyecto.
 * @returns {string} UUID-like (32 caracteres con guiones).
 * @internal
 */
function projectIdFromPath(rootPath: string): string {
  const h = createHash("sha256").update(rootPath).digest("hex").slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Obtiene los metadatos del proyecto a partir de la ruta raíz (lee package.json para el nombre si existe).
 * @param {string} rootPath - Ruta raíz del directorio del proyecto.
 * @returns {Promise<ProjectInfo>} projectId, projectName y rootPath normalizado.
 */
export async function getProjectInfo(rootPath: string): Promise<ProjectInfo> {
  const normalized = rootPath.replace(/\/$/, "") || rootPath;
  const projectId = projectIdFromPath(normalized);
  let projectName = basename(normalized) || "unnamed";

  try {
    const pkgPath = join(rootPath, "package.json");
    const content = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content) as { name?: string };
    if (typeof pkg?.name === "string" && pkg.name.trim()) {
      projectName = pkg.name.trim();
    }
  } catch {
    // fallback to basename
  }

  return { projectId, projectName, rootPath: normalized };
}

import { escapeCypherString } from "ariadne-common";

/**
 * Construye la sentencia Cypher MERGE para el nodo Project (idempotente).
 * @param {ProjectInfo} info - Metadatos del proyecto.
 * @returns {string} Sentencia Cypher (MERGE Project SET ...).
 */
export function buildProjectMergeCypher(info: ProjectInfo): string {
  const now = new Date().toISOString();
  const id = `'${escapeCypherString(info.projectId)}'`;
  const name = `'${escapeCypherString(info.projectName)}'`;
  const root = `'${escapeCypherString(info.rootPath)}'`;
  const last = `'${escapeCypherString(now)}'`;
  return `MERGE (p:Project {projectId: ${id}}) SET p.projectName = ${name}, p.rootPath = ${root}, p.lastIndexed = ${last}`;
}
