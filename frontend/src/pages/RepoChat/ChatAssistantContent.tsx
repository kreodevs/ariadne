/**
 * Renderiza respuestas del asistente: MDD JSON (evidence_first), JSON raw_evidence o Markdown.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '@/components/ui/badge';

function tryParseJsonObject(s: string): Record<string, unknown> | null {
  const t = s.trim();
  if (!t.startsWith('{')) return null;
  try {
    const o = JSON.parse(t) as unknown;
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isMddShape(o: Record<string, unknown>): boolean {
  return typeof o.summary === 'string' && Array.isArray(o.evidence_paths);
}

export function ChatAssistantContent({ content }: { content: string }) {
  const parsed = tryParseJsonObject(content);
  if (parsed) {
    if (parsed.mode === 'raw_evidence') {
      return (
        <div className="space-y-2">
          <Badge variant="secondary" className="text-xs">
            Evidencia bruta (retrieve determinista)
          </Badge>
          <pre className="max-h-[min(70vh,560px)] overflow-auto rounded-md border bg-muted/80 p-3 text-xs font-mono leading-snug">
            {JSON.stringify(parsed, null, 2)}
          </pre>
        </div>
      );
    }
    if (isMddShape(parsed)) {
      return (
        <div className="space-y-2">
          <Badge variant="default" className="text-xs">
            MDD (evidence_first)
          </Badge>
          <p className="text-sm text-muted-foreground leading-snug">
            JSON de 7 secciones desde Ariadne (una petición). Copiar/pegar o consumir con LegacyCoordinator.
          </p>
          <pre className="max-h-[min(70vh,560px)] overflow-auto rounded-md border bg-muted/80 p-3 text-xs font-mono leading-snug">
            {JSON.stringify(parsed, null, 2)}
          </pre>
        </div>
      );
    }
  }

  return (
    <div className="[&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_p]:my-1 [&_strong]:font-semibold [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_pre]:overflow-x-auto [&_table]:w-full [&_th]:border [&_td]:border [&_td]:px-2 [&_td]:py-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (children ? <p className="mb-1 last:mb-0">{children}</p> : null),
          ul: ({ children }) => <ul className="list-disc pl-4 my-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 my-1">{children}</ol>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="px-2 py-1 border bg-muted/80 font-medium text-left">{children}</th>
          ),
          td: ({ children }) => <td className="px-2 py-1 border">{children}</td>,
          code: ({ className, children, ...props }) => {
            const isBlock = className?.includes('language-');
            return isBlock ? (
              <pre className="my-2 rounded bg-muted p-2 text-xs font-mono overflow-x-auto">
                <code {...props}>{children}</code>
              </pre>
            ) : (
              <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono" {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
