import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import { describe, expect, it } from 'vitest';
import { extractFlowsFromSource } from './flow-extract';

const tsx = TypeScript.tsx;

function parseTsx(source: string): Parser.SyntaxNode {
  const parser = new Parser();
  parser.setLanguage(tsx);
  return parser.parse(source).rootNode;
}

describe('flow-extract', () => {
  it('detecta wizard con steps', () => {
    const source = `
      const steps = [{ title: 'Datos' }, { title: 'Confirmar' }];
      export function EventWizard() { return <Stepper steps={steps} />; }
    `;
    const flows = extractFlowsFromSource(parseTsx(source), source, 'src/EventWizard.tsx');
    expect(flows.some((f) => f.kind === 'wizard')).toBe(true);
    expect(flows.find((f) => f.kind === 'wizard')?.payload.mainPath.length).toBeGreaterThan(1);
  });

  it('detecta Bull processor', () => {
    const source = `
      @Processor('sync')
      export class SyncProcessor {
        @Process('full')
        async handle() {}
      }
    `;
    const flows = extractFlowsFromSource(parseTsx(source), source, 'src/sync.processor.ts');
    expect(flows.some((f) => f.kind === 'job' && f.flowId.includes('sync'))).toBe(true);
  });

  it('detecta LangGraph addNode', () => {
    const source = `
      const g = new StateGraph();
      g.addNode('retrieve', retrieve);
      g.addNode('synthesize', synthesize);
      g.addEdge('retrieve', 'synthesize');
    `;
    const flows = extractFlowsFromSource(parseTsx(source), source, 'src/workflow.ts');
    expect(flows.some((f) => f.kind === 'langgraph')).toBe(true);
  });
});
