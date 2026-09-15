/**
 * @fileoverview Rutas canónicas y resolución de HTML Archify persistido.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { C4Level } from 'ariadne-common';

export function canonicalC4HtmlPath(
  storageRoot: string,
  projectId: string,
  level: C4Level,
): string {
  return join(storageRoot, projectId, `${level}.architecture.html`);
}

/** Primera ruta existente entre snapshot y ubicación canónica. */
export function resolveExistingC4HtmlPath(
  storageRoot: string,
  projectId: string,
  level: C4Level,
  snapshotPath?: string | null,
): string | null {
  const candidates = [snapshotPath, canonicalC4HtmlPath(storageRoot, projectId, level)].filter(
    Boolean,
  ) as string[];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}
