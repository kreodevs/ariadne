/**
 * File watcher and scan orchestrator. Recursively finds .js/.jsx/.ts/.tsx, ignores node_modules and .test.*
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readdir } from "node:fs/promises";

export const EXT = [".js", ".jsx", ".ts", ".tsx"];
export const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage"]);
export const IGNORE_FILE_PATTERN = /\.(test|spec)\.(js|jsx|ts|tsx)$/;

export function toRelativePath(absolutePath: string, scanPath: string): string {
  return absolutePath.startsWith(scanPath)
    ? absolutePath.slice(scanPath.length).replace(/^\//, "")
    : absolutePath;
}

export function matchesScanFilter(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  return EXT.includes(ext) && !IGNORE_FILE_PATTERN.test(filePath);
}

/**
 * Recorre recursivamente rootPath y devuelve rutas absolutas de archivos .js/.jsx/.ts/.tsx.
 * Ignora node_modules, .git, dist, build, coverage y archivos .test.* / .spec.*
 */
export async function discoverFiles(rootPath: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: { name: string; isDirectory: () => boolean }[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name)) await walk(full);
      } else {
        const ext = extname(full);
        if (EXT.includes(ext) && !IGNORE_FILE_PATTERN.test(e.name)) {
          out.push(full);
        }
      }
    }
  }
  await walk(rootPath);
  return out;
}

function extname(path: string): string {
  const i = path.lastIndexOf(".");
  return i < 0 ? "" : path.slice(i);
}
