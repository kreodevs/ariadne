/**
 * @fileoverview Visor de markdown para secciones de Ayuda. Renderiza sin descargar.
 * Soporta sub-documentos del manual con enlaces internos y botón Volver.
 */
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';

const DOCS: Record<string, string> = {
  mcp: '/ayuda-mcp.md',
  skills: '/ayuda-skills.md',
  manual: '/ayuda-manual.md',
  'manual-configuracion': '/ayuda-manual-configuracion.md',
  'manual-indice': '/ayuda-manual-indice.md',
  'manual-architecture': '/ayuda-manual-architecture.md',
  'manual-bitbucket': '/ayuda-manual-bitbucket.md',
  'manual-db-schema': '/ayuda-manual-db-schema.md',
  'manual-indexing': '/ayuda-manual-indexing.md',
  'manual-ingestion': '/ayuda-manual-ingestion.md',
  'manual-chat': '/ayuda-manual-chat.md',
  'manual-mcp-instalacion': '/ayuda-manual-mcp-instalacion.md',
  'manual-parse-refactor': '/ayuda-manual-parse-refactor.md',
};

/** Mapeo href en markdown → slug del manual */
const MANUAL_HREF_SLUGS: Record<string, string> = {
  'CONFIGURACION_Y_USO.md': 'configuracion',
  'configuracion_y_uso.md': 'configuracion',
  '../README.md': 'indice',
  'README.md': 'indice',
  'docs/README.md': 'indice',
  '../architecture.md': 'architecture',
  'architecture.md': 'architecture',
  '../bitbucket_webhook.md': 'bitbucket',
  'bitbucket_webhook.md': 'bitbucket',
  '../db_schema.md': 'db-schema',
  'db_schema.md': 'db-schema',
  '../indexing_engine.md': 'indexing',
  'indexing_engine.md': 'indexing',
  '../ingestion_flow.md': 'ingestion',
  'ingestion_flow.md': 'ingestion',
  '../CHAT_Y_ANALISIS.md': 'chat',
  'CHAT_Y_ANALISIS.md': 'chat',
  '../INSTALACION_MCP_CURSOR.md': 'mcp-instalacion',
  'INSTALACION_MCP_CURSOR.md': 'mcp-instalacion',
};

/** Resuelve un href de markdown del manual (ej. README.md, ../db_schema.md) al path de ruta /ayuda/manual/:slug. */
function resolveManualHref(href: string): string | null {
  const [path, hash] = href.split('#');
  const clean = path.trim();
  const slug = MANUAL_HREF_SLUGS[clean] ?? MANUAL_HREF_SLUGS[clean.replace(/^\.\.\//, '')];
  return slug ? `/ayuda/manual/${slug}${hash ? `#${hash}` : ''}` : null;
}

const articleClass =
  'markdown-body space-y-4 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-6 [&_h3]:text-lg [&_h3]:font-medium [&_h3]:mt-4 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:overflow-x-auto [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-sm [&_blockquote]:border-l-4 [&_blockquote]:border-muted-foreground [&_blockquote]:pl-4 [&_blockquote]:italic [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_table]:border [&_table]:border-collapse [&_th]:border [&_th]:bg-muted [&_th]:px-4 [&_th]:py-2 [&_th]:text-left [&_td]:border [&_td]:px-4 [&_td]:py-2 [&_hr]:my-6';

/** Enlaces internos /ayuda/* usan client-side routing; manual sub-docs se resuelven. */
function CustomLink(props: {
  href?: string;
  children?: React.ReactNode;
  inManualContext?: boolean;
}) {
  const { href, children, inManualContext } = props;
  const cls = 'text-primary underline underline-offset-4';
  if (!href) return <span className={cls}>{children}</span>;
  const manualRoute = inManualContext ? resolveManualHref(href) : null;
  const to = manualRoute ?? (href.startsWith('/ayuda') || (href.startsWith('/') && !href.startsWith('//')) ? href : null);
  if (to) {
    return <Link to={to} className={cls}>{children}</Link>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {children}
    </a>
  );
}

export type DocViewerDoc = 'mcp' | 'skills' | 'manual';
export type ManualSlug =
  | 'configuracion'
  | 'indice'
  | 'architecture'
  | 'bitbucket'
  | 'db-schema'
  | 'indexing'
  | 'ingestion'
  | 'chat'
  | 'mcp-instalacion'
  | 'parse-refactor';

/**
 * Visor de documento markdown (ayuda). Carga el .md por path (DOCS) y lo renderiza con ReactMarkdown.
 * En contexto manual, los enlaces internos se resuelven con resolveManualHref para client-side routing.
 */
export function DocViewer({
  doc,
  manualSlug,
}: {
  doc: DocViewerDoc;
  manualSlug?: ManualSlug | null;
}) {
  const [md, setMd] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const docKey = manualSlug ? `manual-${manualSlug}` : doc;
  const path = DOCS[docKey] ?? DOCS[doc];

  useEffect(() => {
    if (!path) return;
    fetch(path)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setMd)
      .catch((e) => setError(e.message));
  }, [path]);

  const inManualContext = doc === 'manual';

  if (error) {
    return <p className="text-destructive">No se pudo cargar: {error}</p>;
  }
  if (!md) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <article className={articleClass}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
            <CustomLink href={href} inManualContext={inManualContext}>
              {children}
            </CustomLink>
          ),
        }}
      >
        {md}
      </ReactMarkdown>
    </article>
  );
}
