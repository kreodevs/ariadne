/**
 * @fileoverview Extracción heurística de conceptos de dominio para el grafo (DomainConcept: tipos, opciones, componentes por patrón).
 */

import type Parser from 'tree-sitter';
import type { ParsedFile, ComponentInfo } from './parser';
import type { DomainConceptInfo, DomainConfig } from './domain-types';

export type { DomainConceptInfo, DomainConfig } from './domain-types';

const DEFAULT_COMPONENT_PATTERNS =
  'Cotizador*,*Template,*Modal,BrandRider,Renta,Bonus,Medio,Plaza,Extra,Produccion,Comision';
const DEFAULT_CONST_NAMES = 'OPTIONS,TIPOS,TYPES,MODES,TIPO,MODO,CONFIG,CONSTANTS,OPCIONES';

/**
 * Construye patrones RegExp para nombres de componentes desde config o env (DOMAIN_COMPONENT_PATTERNS).
 * Soporta sufijos/prefijos con * (ej. "Cotizador*", "*Template").
 */
function patternsFromConfig(config?: DomainConfig | null): RegExp[] {
  const raw =
    config?.componentPatterns?.length
      ? config.componentPatterns.join(',')
      : process.env.DOMAIN_COMPONENT_PATTERNS ?? DEFAULT_COMPONENT_PATTERNS;
  return raw.split(',').map((s) => {
    const t = s.trim();
    if (!t) return /^$/;
    if (t.endsWith('*')) return new RegExp(`^${t.slice(0, -1)}`, 'i');
    if (t.startsWith('*')) return new RegExp(`${t.slice(1)}$`, 'i');
    return new RegExp(t, 'i');
  });
}

function constNamesFromConfig(config?: DomainConfig | null): string[] {
  if (config?.constNames?.length) return config.constNames.map((s) => s.toUpperCase());
  const raw = process.env.DOMAIN_CONST_NAMES ?? DEFAULT_CONST_NAMES;
  return raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

function matchesComponentPattern(name: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(name));
}

/**
 * Recorre el AST y devuelve todos los nodos cuyo tipo coincide con `types` (string o array).
 */
function findNodesByType(
  node: Parser.SyntaxNode,
  types: string | string[],
): Parser.SyntaxNode[] {
  const set = Array.isArray(types) ? new Set(types) : new Set([types]);
  const out: Parser.SyntaxNode[] = [];
  function walk(n: Parser.SyntaxNode) {
    if (set.has(n.type)) out.push(n);
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  }
  walk(node);
  return out;
}

/**
 * Extrae el texto fuente correspondiente a un nodo del AST (entre startIndex y endIndex).
 */
function getNodeText(src: string, node: Parser.SyntaxNode): string {
  return src.slice(node.startIndex, node.endIndex);
}

/** Extrae conceptos de componentes por patrón de nombre. */
function fromComponents(
  path: string,
  components: ComponentInfo[],
  patterns: RegExp[],
): DomainConceptInfo[] {
  const out: DomainConceptInfo[] = [];
  for (const c of components) {
    if (!matchesComponentPattern(c.name, patterns)) continue;
    out.push({
      name: c.name,
      category: 'tipo',
      description: c.description,
      sourcePath: path,
      sourceRef: c.name,
    });
  }
  return out;
}

/**
 * Extrae opciones de enums TypeScript (enum_declaration) como DomainConceptInfo con category 'opcion'.
 */
function fromEnums(
  root: Parser.SyntaxNode,
  source: string,
  path: string,
): DomainConceptInfo[] {
  const out: DomainConceptInfo[] = [];
  const enumNodes = findNodesByType(root, 'enum_declaration');
  for (const node of enumNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const enumName = getNodeText(source, nameNode);
    const members: string[] = [];
    const body = node.childForFieldName('body');
    if (body) {
      const membersNode = findNodesByType(body, [
        'enum_member',
        'property_identifier',
        'identifier',
      ]);
      for (const m of membersNode) {
        if (m.type === 'enum_member') {
          const id = m.childForFieldName('name') ?? m.firstNamedChild;
          if (id) members.push(getNodeText(source, id).replace(/^['"]|['"]$/g, ''));
        } else if (m.type === 'property_identifier' || m.type === 'identifier') {
          const text = getNodeText(source, m);
          if (text && text !== enumName && !members.includes(text)) members.push(text);
        }
      }
    }
    if (enumName) {
      out.push({
        name: enumName,
        category: 'opcion',
        options: members.length ? members : undefined,
        sourcePath: path,
        sourceRef: enumName,
      });
    }
  }
  return out;
}

/** Extrae contextos React (parsed.contexts: createContext) como DomainConcept category 'context'. */
function fromContexts(path: string, contexts: Array<{ name: string }>): DomainConceptInfo[] {
  return contexts.map((c) => ({
    name: c.name,
    category: 'context' as const,
    sourcePath: path,
    sourceRef: c.name,
  }));
}

/** Extrae opciones de objetos constantes (const OPTIONS = { A: 1, B: 2 } o const TIPOS = ['a','b']). */
function fromConstObjects(
  root: Parser.SyntaxNode,
  source: string,
  path: string,
  candidates: string[],
): DomainConceptInfo[] {
  const out: DomainConceptInfo[] = [];
  const declarators = findNodesByType(root, 'variable_declarator');
  for (const decl of declarators) {
    const nameNode = decl.childForFieldName('name') ?? decl.child(0);
    const valueNode = decl.childForFieldName('value') ?? decl.childForFieldName('initializer');
    if (!nameNode || !valueNode) continue;
    const varName = getNodeText(source, nameNode);
    const isRelevant =
      candidates.some((c) => varName.toUpperCase().includes(c)) ||
      /^[A-Z][A-Z_0-9]*$/.test(varName);
    if (!isRelevant) continue;
    const options: string[] = [];
    if (valueNode.type === 'object') {
      for (let i = 0; i < valueNode.childCount; i++) {
        const pair = valueNode.child(i);
        if (!pair || pair.type !== 'pair') continue;
        const key = pair.childForFieldName('key') ?? pair.child(0);
        if (key) options.push(getNodeText(source, key).replace(/^['"]|['"]$/g, ''));
      }
    } else if (valueNode.type === 'array') {
      for (let i = 0; i < valueNode.childCount; i++) {
        const el = valueNode.child(i);
        if (!el) continue;
        const text = getNodeText(source, el).replace(/^['"`]|['"`]$/g, '');
        if (text && /^[\w]+$/.test(text)) options.push(text);
      }
    }
    if (options.length > 0 && options.length <= 30) {
      out.push({
        name: varName,
        category: 'opcion',
        options,
        sourcePath: path,
        sourceRef: varName,
      });
    }
  }
  return out;
}

/**
 * Extrae conceptos de dominio de un archivo parseado.
 * @param {ParsedFile} parsed - Resultado del parser.
 * @param {string} source - Código fuente (para AST: enums, const).
 * @param {Parser.SyntaxNode} [root] - Nodo raíz del AST (opcional).
 * @param {DomainConfig | null} [config] - Config por proyecto; si null, usa env/defaults.
 * @returns {DomainConceptInfo[]} Lista de conceptos de dominio (name, category, options, sourcePath).
 */
export function extractDomainConcepts(
  parsed: ParsedFile,
  source: string,
  root?: Parser.SyntaxNode,
  config?: DomainConfig | null,
): DomainConceptInfo[] {
  const seen = new Set<string>();
  const result: DomainConceptInfo[] = [];
  const patterns = patternsFromConfig(config);
  const candidates = constNamesFromConfig(config);

  for (const dc of fromComponents(parsed.path, parsed.components, patterns)) {
    const key = `${parsed.path}::${dc.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(dc);
    }
  }

  for (const dc of fromContexts(parsed.path, parsed.contexts ?? [])) {
    const key = `${parsed.path}::${dc.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(dc);
    }
  }

  if (root) {
    for (const dc of fromEnums(root, source, parsed.path)) {
      const key = `${parsed.path}::${dc.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(dc);
      }
    }
    for (const dc of fromConstObjects(root, source, parsed.path, candidates)) {
      const key = `${parsed.path}::${dc.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(dc);
      }
    }
  }

  return result;
}

/** Recorre AST para extraer nombres de const y enum (para inferencia, sin filtro). */
function collectConstAndEnumNames(
  root: Parser.SyntaxNode,
  source: string,
): { constNames: string[]; enumNames: string[] } {
  const constNames: string[] = [];
  const enumNames: string[] = [];
  for (const decl of findNodesByType(root, 'variable_declarator')) {
    const nameNode = decl.childForFieldName('name') ?? decl.child(0);
    if (nameNode) {
      const n = getNodeText(source, nameNode);
      if (/^[A-Z][A-Z_0-9]*$/.test(n) || /TIPOS|OPTIONS|TYPES|MODO|CONFIG/i.test(n)) {
        constNames.push(n.toUpperCase());
      }
    }
  }
  for (const enumNode of findNodesByType(root, 'enum_declaration')) {
    const nameNode = enumNode.childForFieldName('name');
    if (nameNode) enumNames.push(getNodeText(source, nameNode));
  }
  return { constNames, enumNames };
}

/** Inferencia de patrones de componentes: prefijos y sufijos comunes (≥2 componentes). */
function inferComponentPatterns(componentNames: string[]): string[] {
  const prefixes = new Map<string, number>();
  const suffixes = new Map<string, number>();
  for (const name of componentNames) {
    const parts = name.replace(/([A-Z])/g, ' $1').trim().split(/\s+/);
    if (parts.length >= 1) {
      const p = parts[0];
      prefixes.set(p, (prefixes.get(p) ?? 0) + 1);
      const s = parts[parts.length - 1];
      suffixes.set(s, (suffixes.get(s) ?? 0) + 1);
    }
  }
  const out: string[] = [];
  for (const [p, n] of prefixes) if (n >= 2) out.push(`${p}*`);
  for (const [s, n] of suffixes) if (n >= 2 && !out.includes(`*${s}`)) out.push(`*${s}`);
  return out.slice(0, 15);
}

/**
 * Infiere DomainConfig (componentPatterns, constNames) a partir de archivos parseados en la primera ingesta.
 * @param {Array<{ parsed: ParsedFile; root: Parser.SyntaxNode; source: string }>} items - Archivos con parsed, root y source.
 * @returns {DomainConfig} componentPatterns y constNames inferidos.
 */
export function inferDomainConfig(
  items: Array<{ parsed: ParsedFile; root: Parser.SyntaxNode; source: string }>,
): DomainConfig {
  const allComponentNames: string[] = [];
  const constNameSet = new Set<string>(DEFAULT_CONST_NAMES.split(',').map((s) => s.trim().toUpperCase()));
  for (const { parsed, root, source } of items) {
    for (const c of parsed.components) allComponentNames.push(c.name);
    const { constNames } = collectConstAndEnumNames(root, source);
    for (const n of constNames) constNameSet.add(n);
  }
  const componentPatterns = inferComponentPatterns(allComponentNames);
  const constNames = Array.from(constNameSet);
  return {
    componentPatterns: componentPatterns.length > 0 ? componentPatterns : undefined,
    constNames: constNames.length > 0 ? constNames : undefined,
  };
}
