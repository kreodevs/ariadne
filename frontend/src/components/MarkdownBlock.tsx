/**
 * @fileoverview Renderiza markdown con ReactMarkdown + remarkGfm. Usado para diagnósticos y reingeniería.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownBlockProps {
  content: string;
  className?: string;
}

/** Renderiza markdown con soporte GFM (tablas, listas, encabezados). Estilos vía className del padre. */
export function MarkdownBlock({ content, className = '' }: MarkdownBlockProps) {
  const raw = typeof content === 'string' ? content : String(content ?? '');
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="w-full text-sm border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="px-2 py-1 border bg-muted/80 font-medium text-left">{children}</th>
          ),
          td: ({ children }) => <td className="px-2 py-1 border">{children}</td>,
          h1: ({ children }) => <h1 className="text-lg font-bold mt-2 mb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-semibold mt-4 mb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-medium mt-3 mb-1">{children}</h3>,
        }}
      >
        {raw}
      </ReactMarkdown>
    </div>
  );
}
