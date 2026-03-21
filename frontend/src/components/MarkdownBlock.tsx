/**
 * @fileoverview Renderiza markdown a HTML con marked + DOMPurify. Usado para diagnósticos y reingeniería.
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

interface MarkdownBlockProps {
  content: string;
  className?: string;
}

/** Renderiza markdown como HTML sanitizado. Tablas, listas y encabezados se estilizan vía className. */
export function MarkdownBlock({ content, className = '' }: MarkdownBlockProps) {
  const raw = typeof content === 'string' ? content : String(content ?? '');
  const html = DOMPurify.sanitize(marked.parse(raw, { async: false }) as string, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'p', 'br', 'ul', 'ol', 'li', 'strong', 'em', 'code', 'pre',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote', 'a', 'hr',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
  });

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
