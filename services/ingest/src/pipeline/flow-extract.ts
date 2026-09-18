/**
 * @fileoverview Extracción de flujos multi-paso (fase 3): wizards, jobs, LangGraph, cron.
 */
import Parser from 'tree-sitter';
import type { IndexedFlowPayload } from 'ariadne-common';

export interface ParsedFlowDef {
  flowId: string;
  kind: 'wizard' | 'job' | 'langgraph' | 'cron';
  label: string;
  description?: string;
  sourcePath: string;
  payload: IndexedFlowPayload;
}

function getNodeText(source: string, node: Parser.SyntaxNode): string {
  return source.slice(node.startIndex, node.endIndex);
}

function unquote(raw: string): string {
  const t = raw.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1);
  }
  return t;
}

function walk(root: Parser.SyntaxNode, visit: (n: Parser.SyntaxNode) => void): void {
  visit(root);
  for (let i = 0; i < root.childCount; i++) {
    const c = root.child(i);
    if (c) walk(c, visit);
  }
}

function classNameFromNode(node: Parser.SyntaxNode, source: string): string | undefined {
  const id = node.childForFieldName('name');
  if (!id || id.type !== 'identifier') return undefined;
  const name = getNodeText(source, id);
  return /^[A-Z]/.test(name) ? name : undefined;
}

function extractStepLabelsFromArray(source: string, arrayText: string): string[] {
  const labels: string[] = [];
  const titleRe = /(?:title|label|name)\s*:\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = titleRe.exec(arrayText)) !== null) {
    labels.push(m[1]!);
  }
  return labels.slice(0, 6);
}

function buildLinearPayload(
  kind: ParsedFlowDef['kind'],
  title: string,
  stepLabels: string[],
  subtitle?: string,
): IndexedFlowPayload {
  const ids = stepLabels.map((_, i) => `step${i}`);
  const mainPath = ids.length > 0 ? ids : ['start'];
  const nodes =
    stepLabels.length > 0
      ? stepLabels.map((label, i) => ({
          id: ids[i]!,
          lane: 'main',
          col: Math.min(5, i),
          type: i === 0 ? 'external' : i === stepLabels.length - 1 ? 'cloud' : 'backend',
          label,
        }))
      : [{ id: 'start', lane: 'main', col: 0, type: 'external', label: title }];

  return {
    kind,
    title,
    subtitle,
    lanes: [{ id: 'main', label: 'Pasos' }],
    mainPath,
    nodes,
    edges: ids.slice(0, -1).map((from, i) => ({
      id: `e${i}`,
      from,
      to: ids[i + 1]!,
      variant: 'emphasis',
    })),
  };
}

function extractWizardFlows(root: Parser.SyntaxNode, source: string, filePath: string): ParsedFlowDef[] {
  const out: ParsedFlowDef[] = [];
  const seen = new Set<string>();

  walk(root, (node) => {
    if (node.type !== 'lexical_declaration' && node.type !== 'variable_declaration') return;
    const text = getNodeText(source, node);
    if (!/\bsteps\s*[:=]\s*\[/.test(text) && !/Stepper|Wizard/i.test(text)) return;
    const nameMatch = text.match(/(?:const|let)\s+([A-Z][\w$]*)/);
    const compName = nameMatch?.[1] ?? filePath.split('/').pop()?.replace(/\.\w+$/, '') ?? 'Wizard';
    const stepsMatch = text.match(/steps\s*[:=]\s*(\[[\s\S]*?\])/);
    const labels = stepsMatch ? extractStepLabelsFromArray(source, stepsMatch[1]!) : ['Paso 1', 'Paso 2'];
    const flowId = `wizard:${compName}`;
    if (seen.has(flowId)) return;
    seen.add(flowId);
    out.push({
      flowId,
      kind: 'wizard',
      label: compName,
      description: 'Wizard / stepper en frontend',
      sourcePath: filePath,
      payload: buildLinearPayload('wizard', `Wizard — ${compName}`, labels, filePath),
    });
  });

  return out;
}

function extractJobFlowsFromRegex(source: string, filePath: string): ParsedFlowDef[] {
  if (!/@Processor|@Process/.test(source)) return [];
  const processorMatch = source.match(/@Processor\s*\(\s*['"]([^'"]+)['"]/);
  const processMatches = [...source.matchAll(/@Process\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
  const classMatch = source.match(/class\s+([A-Z][\w$]*)/);
  if (!processorMatch && processMatches.length === 0) return [];
  const queue = processorMatch?.[1] ?? 'queue';
  const className = classMatch?.[1] ?? 'Processor';
  const steps = processMatches.length > 0 ? processMatches : ['process'];
  return [
    {
      flowId: `job:${queue}:${className}`,
      kind: 'job',
      label: `${queue} · ${className}`,
      description: 'Cola Bull/BullMQ',
      sourcePath: filePath,
      payload: buildLinearPayload('job', `Job — ${queue}`, steps, className),
    },
  ];
}

function extractJobFlows(root: Parser.SyntaxNode, source: string, filePath: string): ParsedFlowDef[] {
  const out: ParsedFlowDef[] = [];
  if (!/@Processor|@Process|BullModule|InjectQueue/.test(source)) return out;

  walk(root, (node) => {
    if (node.type !== 'class_declaration') return;
    const className = classNameFromNode(node, source);
    if (!className) return;
    const classText = getNodeText(source, node);
    const processorMatch = classText.match(/@Processor\s*\(\s*['"]([^'"]+)['"]/);
    const processMatches = [...classText.matchAll(/@Process\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    if (!processorMatch && processMatches.length === 0) return;

    const queue = processorMatch?.[1] ?? 'queue';
    const steps = processMatches.length > 0 ? processMatches : ['process'];
    const flowId = `job:${queue}:${className}`;
    out.push({
      flowId,
      kind: 'job',
      label: `${queue} · ${className}`,
      description: 'Cola Bull/BullMQ',
      sourcePath: filePath,
      payload: buildLinearPayload('job', `Job — ${queue}`, steps, className),
    });
  });

  return out.length > 0 ? out : extractJobFlowsFromRegex(source, filePath);
}

function extractLangGraphFlows(root: Parser.SyntaxNode, source: string, filePath: string): ParsedFlowDef[] {
  const out: ParsedFlowDef[] = [];
  if (!/StateGraph|langgraph|addNode|addEdge/.test(source)) return out;

  const nodeNames = [...source.matchAll(/\.addNode\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
  const edges = [...source.matchAll(/\.addEdge\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g)];
  if (nodeNames.length < 2) return out;

  const toId = (name: string) => name.replace(/[^\w-]/g, '_');
  const ids = nodeNames.slice(0, 6).map(toId);
  const payload: IndexedFlowPayload = {
    kind: 'langgraph',
    title: `LangGraph — ${filePath.split('/').pop() ?? 'workflow'}`,
    subtitle: 'Nodos addNode detectados',
    lanes: [{ id: 'main', label: 'Grafo' }],
    mainPath: ids,
    nodes: nodeNames.slice(0, 6).map((label, i) => ({
      id: ids[i]!,
      lane: 'main',
      col: Math.min(5, i),
      type: i === 0 ? 'external' : 'backend',
      label,
    })),
    edges: edges
      .slice(0, 8)
      .map(([ , from, to], i) => ({
        id: `lg${i}`,
        from: toId(from),
        to: toId(to),
        variant: 'default' as const,
      }))
      .filter((e) => ids.includes(e.from) && ids.includes(e.to)),
  };

  out.push({
    flowId: `langgraph:${filePath}`,
    kind: 'langgraph',
    label: `LangGraph (${nodeNames.length} nodos)`,
    description: filePath,
    sourcePath: filePath,
    payload,
  });
  return out;
}

function extractCronFlows(source: string, filePath: string): ParsedFlowDef[] {
  if (!/@Cron\s*\(/.test(source)) return [];
  const crons = [...source.matchAll(/@Cron\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
  if (crons.length === 0) return [];
  const classMatch = source.match(/class\s+([A-Z][\w$]*)/);
  const className = classMatch?.[1] ?? 'CronJob';
  return [
    {
      flowId: `cron:${className}`,
      kind: 'cron',
      label: `Cron — ${className}`,
      description: crons.join(', '),
      sourcePath: filePath,
      payload: buildLinearPayload('cron', `Cron — ${className}`, crons, filePath),
    },
  ];
}

/** Extrae flujos multi-paso de un archivo TS/TSX parseado. */
export function extractFlowsFromSource(
  root: Parser.SyntaxNode,
  source: string,
  filePath: string,
): ParsedFlowDef[] {
  const merged = [
    ...extractWizardFlows(root, source, filePath),
    ...extractJobFlows(root, source, filePath),
    ...extractLangGraphFlows(root, source, filePath),
    ...extractCronFlows(source, filePath),
  ];
  const seen = new Set<string>();
  return merged.filter((f) => {
    if (seen.has(f.flowId)) return false;
    seen.add(f.flowId);
    return true;
  });
}
