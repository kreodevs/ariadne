/**
 * @fileoverview Extracción CSF Storybook desde AST Tree-sitter (.stories.ts/.tsx): `meta.component`, `export default`, `satisfies Meta<typeof X>`, `const meta: Meta<typeof Button>`, y **`StoryObj<typeof meta>`**.
 */
import type Parser from 'tree-sitter';
import type { StorybookImportBinding } from './storybook-documentation';

/** Mínimo para mapear imports → bindings (evita importar `ImportInfo` desde parser). */
export interface ImportInfoLike {
  specifier: string;
  localNames: string[];
}

export function isStorybookStoriesPath(filePath: string): boolean {
  return /\.stories\.(tsx?|jsx?)$/i.test(filePath.replace(/\\/g, '/'));
}

export function importInfosToStorybookBindings(imports: ImportInfoLike[]): StorybookImportBinding[] {
  const out: StorybookImportBinding[] = [];
  const seen = new Set<string>();
  for (const imp of imports) {
    for (const localName of imp.localNames) {
      const key = `${localName}\0${imp.specifier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ localName, specifier: imp.specifier });
    }
  }
  return out;
}

function findNodesByType(node: Parser.SyntaxNode, types: string | string[]): Parser.SyntaxNode[] {
  const set = new Set(Array.isArray(types) ? types : [types]);
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

function getNodeText(src: string, node: Parser.SyntaxNode): string {
  return src.slice(node.startIndex, node.endIndex);
}

function isObjectNode(n: Parser.SyntaxNode): boolean {
  return n.type === 'object' || n.type === 'object_expression';
}

function keyText(source: string, keyNode: Parser.SyntaxNode): string {
  return getNodeText(source, keyNode).replace(/^['"]|['"]$/g, '');
}

/** Desenvuelve satisfies / as hasta el objeto literal. */
function unwrapSatisfiesOrAs(node: Parser.SyntaxNode | null): Parser.SyntaxNode | null {
  let n = node;
  while (n && (n.type === 'satisfies_expression' || n.type === 'as_expression')) {
    const inner = n.namedChild(0);
    if (!inner) break;
    n = inner;
  }
  return n;
}

function extractComponentIdentifierFromObject(obj: Parser.SyntaxNode, source: string): string | null {
  if (!isObjectNode(obj)) return null;
  for (let i = 0; i < obj.childCount; i++) {
    const ch = obj.child(i);
    if (!ch || ch.type !== 'pair') continue;
    const key = ch.childForFieldName('key');
    const val = ch.childForFieldName('value');
    if (!key || !val) continue;
    if (keyText(source, key) !== 'component') continue;
    if (val.type === 'identifier') {
      const name = getNodeText(source, val);
      if (/^[A-Z]/.test(name)) return name;
    }
  }
  return null;
}

/** `Meta<typeof Button>` dentro de type_arguments. */
function extractPascalFromTypeofInTypeArgs(typeArgs: Parser.SyntaxNode, source: string): string[] {
  const found: string[] = [];
  for (const tq of findNodesByType(typeArgs, 'type_query')) {
    const id = tq.namedChild(0);
    if (id?.type === 'identifier') {
      const name = getNodeText(source, id);
      if (/^[A-Z]/.test(name)) found.push(name);
    }
  }
  return found;
}

function extractFromGenericTypeMeta(gt: Parser.SyntaxNode, source: string): string[] {
  if (gt.type !== 'generic_type') return [];
  const name = gt.childForFieldName('name');
  if (!name || getNodeText(source, name) !== 'Meta') return [];
  const targs =
    gt.childForFieldName('type_arguments') ?? findNodesByType(gt, 'type_arguments')[0] ?? null;
  if (!targs) return [];
  return extractPascalFromTypeofInTypeArgs(targs, source);
}

function extractFromSatisfiesSecondArg(sat: Parser.SyntaxNode, source: string): string[] {
  const gt = sat.namedChildren[1];
  if (!gt) return [];
  return extractFromGenericTypeMeta(gt, source);
}

function declaratorBindingName(decl: Parser.SyntaxNode, source: string): string | null {
  const name = decl.childForFieldName('name');
  if (!name || name.type !== 'identifier') return null;
  return getNodeText(source, name);
}

/**
 * Targets desde un `variable_declarator`: anotación `Meta<typeof X>`, satisfies, `component:` en objeto.
 */
function collectTargetsFromVariableDeclarator(decl: Parser.SyntaxNode, source: string, targets: Set<string>): void {
  const typeAn = decl.childForFieldName('type');
  if (typeAn?.type === 'type_annotation') {
    const inner = typeAn.namedChild(0);
    if (inner) {
      for (const n of extractFromGenericTypeMeta(inner, source)) targets.add(n);
    }
  }
  let val = decl.childForFieldName('value');
  if (val?.type === 'satisfies_expression') {
    for (const n of extractFromSatisfiesSecondArg(val, source)) targets.add(n);
    val = val.namedChild(0) ?? null;
  }
  val = unwrapSatisfiesOrAs(val);
  const comp = val ? extractComponentIdentifierFromObject(val, source) : null;
  if (comp) targets.add(comp);
}

/** Identificadores en `StoryObj<typeof foo>` (cualquier `foo`, típicamente `meta`). */
function extractStoryObjTypeofBindingNames(root: Parser.SyntaxNode, source: string): string[] {
  const names = new Set<string>();
  for (const gt of findNodesByType(root, 'generic_type')) {
    const nameNode = gt.childForFieldName('name');
    if (!nameNode || getNodeText(source, nameNode) !== 'StoryObj') continue;
    const targs =
      gt.childForFieldName('type_arguments') ?? findNodesByType(gt, 'type_arguments')[0] ?? null;
    if (!targs) continue;
    for (const tq of findNodesByType(targs, 'type_query')) {
      const id = tq.namedChild(0);
      if (id?.type !== 'identifier') continue;
      const n = getNodeText(source, id);
      if (n === 'import') continue;
      names.add(n);
    }
  }
  return [...names];
}

/**
 * Identificadores candidatos: `meta`, `export default { component }`, y objetos enlazados vía `StoryObj<typeof …>`.
 */
export function extractStorybookCsfMetaTargets(root: Parser.SyntaxNode, source: string): string[] {
  const targets = new Set<string>();

  for (const decl of findNodesByType(root, 'variable_declarator')) {
    if (declaratorBindingName(decl, source) !== 'meta') continue;
    collectTargetsFromVariableDeclarator(decl, source, targets);
  }

  for (const exp of findNodesByType(root, 'export_statement')) {
    for (let i = 0; i < exp.childCount; i++) {
      const ch = exp.child(i);
      if (!ch) continue;
      let obj: Parser.SyntaxNode | null = ch;
      if (obj.type === 'satisfies_expression') {
        for (const n of extractFromSatisfiesSecondArg(obj, source)) targets.add(n);
        obj = obj.namedChild(0) ?? null;
      }
      obj = unwrapSatisfiesOrAs(obj);
      if (!obj || !isObjectNode(obj)) continue;
      const comp = extractComponentIdentifierFromObject(obj, source);
      if (comp) targets.add(comp);
    }
  }

  for (const binding of extractStoryObjTypeofBindingNames(root, source)) {
    for (const decl of findNodesByType(root, 'variable_declarator')) {
      if (declaratorBindingName(decl, source) !== binding) continue;
      collectTargetsFromVariableDeclarator(decl, source, targets);
    }
  }

  return [...targets].sort();
}
