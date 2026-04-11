import fs from "node:fs";
import path from "node:path";

export interface AriadneProjectConfig {
  projectId: string;
  defaultRepoId?: string;
  pathPrefixes?: Record<string, string>;
}

/**
 * Busca y carga el archivo .ariadne-project progresando hacia arriba desde el directorio actual
 * o el directorio del proceso.
 */
export function loadAriadneProjectConfig(currentDir?: string): AriadneProjectConfig | null {
  let startDir = currentDir || process.cwd();
  
  while (startDir !== path.parse(startDir).root) {
    const configPath = path.join(startDir, ".ariadne-project");
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, "utf-8");
        return JSON.parse(content) as AriadneProjectConfig;
      } catch (e) {
        console.error("Error al leer .ariadne-project:", e);
        return null;
      }
    }
    startDir = path.dirname(startDir);
  }
  return null;
}

/**
 * Resuelve un path relativo del grafo a un path absoluto usando la configuración.
 */
export function resolveAbsolutePath(
  relativePath: string,
  repoId?: string | null,
  config?: AriadneProjectConfig | null
): string {
  if (!config || !config.pathPrefixes || !repoId) return relativePath;
  
  const prefix = config.pathPrefixes[repoId];
  if (!prefix) return relativePath;
  
  return path.join(prefix, relativePath);
}
