import { describe, expect, it } from 'vitest';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import {
  enrichParsedFilesWithRouterRoutes,
  extractPendingRouteDefs,
  resolvePendingRoutesToRouteInfo,
} from './router-routes-extract';

const ts = TypeScript as unknown as { typescript: unknown; tsx: unknown };
const parser = new Parser();
parser.setLanguage(ts.tsx as Parser.Language);

function parseTsx(source: string) {
  return parser.parse(source).rootNode;
}

describe('router-routes-extract', () => {
  it('extrae createRoute TanStack con path relativo y padre', () => {
    const source = `
export const attendeeLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invitado/$eventSlug',
  component: AttendeeLayout,
});

export const profileRoute = createRoute({
  getParentRoute: () => attendeeLayoutRoute,
  path: 'perfil',
  component: ProfilePage,
});
`;
    const defs = extractPendingRouteDefs(parseTsx(source), 'apps/attendee-app/src/routes/invitado-layout.tsx', source);
    expect(defs.some((d) => d.exportName === 'profileRoute' && d.path === 'perfil')).toBe(true);
    const routes = resolvePendingRoutesToRouteInfo(defs);
    expect(routes.some((r) => r.path === '/invitado/$eventSlug/perfil' && r.componentName === 'ProfilePage')).toBe(
      true,
    );
  });

  it('extrae createBrowserRouter con objetos path/element', () => {
    const source = `
const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/dashboard', element: <Dashboard /> },
]);
`;
    const defs = extractPendingRouteDefs(parseTsx(source), 'src/router.tsx', source);
    expect(defs.filter((d) => d.source === 'browser-router').map((d) => d.path)).toEqual([
      '/login',
      '/dashboard',
    ]);
  });

  it('extrae rutas landing desde comparaciones pathname', () => {
    const source = `
export default function App() {
  const kind = legalKindFromPath(window.location.pathname);
}

function legalKindFromPath(pathname: string) {
  const p = pathname.replace(/\\/+$/, '') || '/';
  if (p === '/privacidad' || p === '/landing/privacidad') return 'privacy';
  if (p === '/terminos') return 'terms';
  return null;
}
`;
    const defs = extractPendingRouteDefs(parseTsx(source), 'apps/landing/src/App.tsx', source);
    expect(defs.map((d) => d.path).sort()).toEqual(['/landing/privacidad', '/privacidad', '/terminos']);
  });

  it('enrichParsedFilesWithRouterRoutes fusiona en parsed.routes', () => {
    const profileSource = `
export const profileRoute = createRoute({
  getParentRoute: () => attendeeLayoutRoute,
  path: 'perfil',
  component: ProfilePage,
});
`;
    const layoutSource = `
export const attendeeLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invitado/$eventSlug',
  component: AttendeeLayout,
});
`;
    const parsed = {
      path: 'apps/attendee-app/src/routes/pages/profile-page.tsx',
      routes: [] as Array<{ path: string; componentName: string }>,
      pendingRouteDefs: extractPendingRouteDefs(
        parseTsx(profileSource),
        'apps/attendee-app/src/routes/pages/profile-page.tsx',
        profileSource,
      ),
    };
    const parent = {
      path: 'apps/attendee-app/src/routes/invitado-layout.tsx',
      routes: [] as Array<{ path: string; componentName: string }>,
      pendingRouteDefs: extractPendingRouteDefs(
        parseTsx(layoutSource),
        'apps/attendee-app/src/routes/invitado-layout.tsx',
        layoutSource,
      ),
    };
    enrichParsedFilesWithRouterRoutes([parsed, parent]);
    expect(parsed.routes.some((r) => r.path === '/invitado/$eventSlug/perfil')).toBe(true);
  });
});
