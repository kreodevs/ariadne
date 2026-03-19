/**
 * @fileoverview Página de Ayuda: MCP, Skills y Manual de uso. Renderiza markdown sin descargar.
 * Sub-documentos del manual muestran botón "Volver al Manual".
 */
import { useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DocViewer, type DocViewerDoc, type ManualSlug } from '@/components/DocViewer';
import { ArrowLeft } from 'lucide-react';

const sections = [
  { to: '/ayuda/mcp', label: 'MCP', title: 'Ayuda — MCP FalkorSpecs' },
  { to: '/ayuda/skills', label: 'Skills', title: 'Skill FalkorSpecs MCP' },
  { to: '/ayuda/manual', label: 'Manual de uso', title: 'Manual de uso' },
] as const;

const MANUAL_SLUGS: ManualSlug[] = [
  'configuracion',
  'indice',
  'architecture',
  'bitbucket',
  'db-schema',
  'indexing',
  'ingestion',
  'chat',
  'mcp-instalacion',
  'parse-refactor',
];

/** Determina doc (mcp | skills | manual) y manualSlug a partir del pathname (/ayuda/mcp, /ayuda/manual/:slug, etc.). */
function getDocFromPath(pathname: string): { doc: DocViewerDoc; manualSlug?: ManualSlug | null } {
  if (pathname.includes('/manual/')) {
    const slug = pathname.split('/manual/')[1]?.split('/')[0] ?? '';
    return {
      doc: 'manual',
      manualSlug: MANUAL_SLUGS.includes(slug as ManualSlug) ? (slug as ManualSlug) : null,
    };
  }
  if (pathname.endsWith('/manual')) return { doc: 'manual' };
  if (pathname.endsWith('/skills')) return { doc: 'skills' };
  return { doc: 'mcp' };
}

/** Título de la sección de ayuda según doc y manualSlug (para manual/indice, manual/chat, etc.). */
function getSectionTitle(doc: DocViewerDoc, manualSlug?: ManualSlug | null): string {
  if (doc !== 'manual' || !manualSlug) {
    return sections.find((s) => s.to === `/ayuda/${doc}`)?.title ?? 'Ayuda';
  }
  const titles: Record<ManualSlug, string> = {
    configuracion: 'Configuración y Uso',
    indice: 'Índice de Documentación',
    architecture: 'Arquitectura',
    bitbucket: 'Webhook Bitbucket',
    'db-schema': 'Esquema del Grafo',
    indexing: 'Motor de Indexación',
    ingestion: 'Flujo de Ingesta',
    chat: 'Chat y Análisis',
    'mcp-instalacion': 'Instalación MCP en Cursor',
    'parse-refactor': 'Parse progresivo: archivos grandes',
  };
  return titles[manualSlug] ?? 'Manual';
}

/** Página de Ayuda: navegación MCP / Skills / Manual y subdocumentos del manual con DocViewer. */
export function Ayuda() {
  const location = useLocation();
  const navigate = useNavigate();
  const { doc, manualSlug } = getDocFromPath(location.pathname);
  const title = getSectionTitle(doc, manualSlug);

  useEffect(() => {
    if (location.pathname === '/ayuda' || location.pathname === '/ayuda/') {
      navigate('/ayuda/mcp', { replace: true });
    }
  }, [location.pathname, navigate]);

  return (
    <div className="flex gap-8">
      <aside className="w-48 shrink-0">
        <nav className="sticky top-20 space-y-1">
          {sections.map(({ to, label }) => (
            <Button
              key={to}
              variant={location.pathname.startsWith(to) ? 'secondary' : 'ghost'}
              size="sm"
              className="w-full justify-start"
              asChild
            >
              <Link to={to}>{label}</Link>
            </Button>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <Card>
          <CardHeader className="flex flex-row items-center gap-4">
            {manualSlug && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/ayuda/manual" className="flex items-center gap-1">
                  <ArrowLeft className="h-4 w-4" />
                  Volver al Manual
                </Link>
              </Button>
            )}
            <CardTitle className="flex-1">{title}</CardTitle>
          </CardHeader>
          <CardContent>
            <DocViewer doc={doc} manualSlug={manualSlug} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
