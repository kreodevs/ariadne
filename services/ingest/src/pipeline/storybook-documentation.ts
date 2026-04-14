/**
 * @fileoverview Documentación indexable: Storybook (MDX/MD acotado) y markdown general del repo (`parseProjectMarkdown`, `isStorybookDocumentationPath`).
 * No usa Tree-sitter en MDX. Imports y `meta`/`of`/`component` se resuelven a paths en producer.
 */

/** Límite alineado con embed-index / OpenAI chunking. */
export const STORYBOOK_MAX_EMBED_CHARS = 14_000;

/**
 * Markdown de conocimiento del repo (README, docs/, etc.). Excluye `node_modules`.
 * Los `.md` de Storybook siguen entrando aquí en el filtro de sync; el parser los trata vía `isStorybookDocumentationPath` primero.
 */
export function isProjectMarkdownPath(path: string): boolean {
  const n = path.replace(/\\/g, '/');
  if (!n.toLowerCase().endsWith('.md')) return false;
  return !/\/node_modules\//i.test(n);
}

/** Rutas típicas de docs Storybook (subconjunto de `.md` / `.mdx`). */
export function isStorybookDocumentationPath(path: string): boolean {
  const n = path.replace(/\\/g, '/');
  const lower = n.toLowerCase();
  const inStorybookDir = /(?:^|\/)\.storybook\//.test(lower) || lower.startsWith('.storybook/');
  if (lower.endsWith('.mdx')) {
    if (lower.endsWith('.stories.mdx')) return true;
    if (/\/stories\//.test(lower)) return true;
    if (inStorybookDir) return true;
    return false;
  }
  if (lower.endsWith('.md')) {
    if (/\/stories\//.test(lower) || inStorybookDir) return true;
    return false;
  }
  return false;
}

export interface StorybookImportBinding {
  localName: string;
  specifier: string;
}

export interface StorybookDocumentationExtract {
  /** Texto para embedding (markdown/MDX limpio, truncado). */
  bodyForEmbedding: string;
  /** Primer título # o nombre de archivo. */
  titleHint: string;
  /** Nombres candidatos a Component en el grafo (imports + tags JSX + meta/of). */
  linkedComponentNames: string[];
  /** Bindings `import … from 'spec'` (sin `import type`). */
  importBindings: StorybookImportBinding[];
  /** Identificadores en `component: X`, `component={X}`, `of={X}` (CSF / MDX). */
  storyMetaTargets: string[];
}

function stripYamlFrontmatter(source: string): string {
  const t = source.trimStart();
  if (!t.startsWith('---\n') && !t.startsWith('---\r\n')) return source;
  const rest = t.slice(4);
  const end = rest.search(/\n---\s*(\n|\r\n)/);
  if (end < 0) return source;
  return rest.slice(rest.indexOf('\n', end) + 1).trimStart();
}

function extractTitle(source: string): string {
  const m = source.match(/^\s*#\s+(.+)$/m);
  if (m) return m[1]!.trim().slice(0, 200);
  return '';
}

/**
 * Extrae bindings de import (default, named, mixto). Omite `import type` y `import * as`.
 */
export function extractStorybookImportBindings(source: string): StorybookImportBinding[] {
  const bindings: StorybookImportBinding[] = [];
  const blockRe = /import\s+(?!type\s)([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(source)) !== null) {
    const clause = m[1]!.trim();
    const specifier = m[2]!;
    if (/^\*\s+as\s/.test(clause)) continue;

    if (clause.includes('{')) {
      const defaultMatch = clause.match(/^([A-Za-z_$][\w$]*)\s*,/);
      if (defaultMatch) {
        bindings.push({ localName: defaultMatch[1]!, specifier });
      }
      const brace = clause.match(/\{([^}]+)\}/);
      if (brace) {
        for (const part of brace[1]!.split(',')) {
          const raw = part.trim();
          if (!raw || /^type\s+/i.test(raw)) continue;
          const asParts = raw.split(/\s+as\s+/i);
          const localName = (asParts.length > 1 ? asParts[1]! : asParts[0]!).trim();
          if (localName) bindings.push({ localName, specifier });
        }
      }
    } else {
      bindings.push({ localName: clause, specifier });
    }
  }
  return bindings;
}

/**
 * Referencias típicas a componente/story en MDX o bloques CSF embebidos.
 */
export function extractStoryMetaTargets(source: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\bcomponent\s*:\s*([A-Z][A-Za-z0-9_]*)/g,
    /\bcomponent\s*=\s*\{\s*([A-Z][A-Za-z0-9_]*)\s*\}/g,
    /\bof\s*=\s*\{\s*([A-Z][A-Za-z0-9_]*)\s*\}/g,
  ];
  for (const re of patterns) {
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(source)) !== null) {
      found.add(mm[1]!);
    }
  }
  return [...found].sort();
}

/** Tags JSX que parecen componentes React (<Button ...>, <Meta ...>). */
function jsxComponentTags(source: string): string[] {
  const names = new Set<string>();
  const re = /<([A-Z][A-Za-z0-9]*)(?=\s|\/|>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    names.add(m[1]!);
  }
  return [...names];
}

function parseDocumentationExtract(
  path: string,
  source: string,
  headerPrefix: string,
): StorybookDocumentationExtract | null {
  const raw = source.replace(/\r\n/g, '\n');
  if (!raw.trim()) return null;
  const withoutFm = stripYamlFrontmatter(raw);
  const titleHint =
    extractTitle(withoutFm) ||
    path
      .split('/')
      .pop()!
      .replace(/\.(mdx|md)$/i, '')
      .slice(0, 200);

  const importBindings = extractStorybookImportBindings(withoutFm);
  const storyMetaTargets = extractStoryMetaTargets(withoutFm);

  const linked = new Set<string>();
  for (const b of importBindings) {
    if (/^[A-Z]/.test(b.localName)) linked.add(b.localName);
  }
  for (const t of jsxComponentTags(withoutFm)) {
    linked.add(t);
  }
  for (const t of storyMetaTargets) {
    linked.add(t);
  }

  let body = withoutFm.replace(/\n{3,}/g, '\n\n').trim();
  if (body.length > STORYBOOK_MAX_EMBED_CHARS) body = body.slice(0, STORYBOOK_MAX_EMBED_CHARS);

  const header = `${headerPrefix}: ${path}\nTitle: ${titleHint}\n\n`;
  const bodyForEmbedding = (header + body).slice(0, STORYBOOK_MAX_EMBED_CHARS);

  return {
    bodyForEmbedding,
    titleHint,
    linkedComponentNames: [...linked].sort(),
    importBindings,
    storyMetaTargets,
  };
}

/**
 * Extrae cuerpo para embedding, imports, meta/of y nombres enlazables a :Component.
 */
export function parseStorybookDocumentation(path: string, source: string): StorybookDocumentationExtract | null {
  return parseDocumentationExtract(path, source, 'Storybook documentation');
}

/** Markdown general del repo (README, ADRs, docs) para RAG; misma forma que Storybook para resolución de imports en producer. */
export function parseProjectMarkdown(path: string, source: string): StorybookDocumentationExtract | null {
  return parseDocumentationExtract(path, source, 'Project documentation');
}
