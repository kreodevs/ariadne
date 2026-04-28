# Componentes

## Layout

- **Layout** — Shell principal con SidebarModern (Kreo), header y área de contenido. Usa `100dvh`, safe areas (`env(safe-area-inset-*)`), cierra el menú móvil al cambiar de ruta, header con blur. En **Ingeniería**: **Repositorios** (`/repos`), **Cola de Sync** (`/jobs`), **Nuevo Repo** (`/repos/new`), **Credenciales** (`/credentials`, duplicado también en **Plataforma**), **C4 Viewer** (`/c4`).
- **HeaderSearch** — Paleta (Cmd/Ctrl+K): proyectos, repos, **componentes del grafo** (tras `graph-summary` por repo) y atajos; los componentes se filtran al escribir y abren el explorador con `scope` + `name`.
- **layout/SidebarModern** — Navegación lateral colapsable con grupos, iconos y sección de usuario; padding inferior safe-area en drawer.
- **atoms/Avatar** — Avatar con imagen, iniciales o icono por defecto.

## UI (Kreo)

Componentes basados en el registro Kreo con tema corporate/luxury (negro, carbón, dorado):

- **button** — Variantes: default, destructive, outline, secondary, ghost, link. Soporta `asChild` para Link.
- **card** — Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter.
- **input** — Campo de texto.
- **select** — Select Radix con Trigger, Content, Item.
- **badge** — Etiquetas con variantes.
- **label** — Etiquetas para formularios.
- **alert** — Alert, AlertTitle, AlertDescription.
- **skeleton** — Placeholder de carga (pulse).
- **table** — Table, TableHeader, TableBody, TableRow, TableHead, TableCell.
- **dialog** — Modal Radix con composición.

## Otros

- **MarkdownBlock** — Renderiza markdown con ReactMarkdown + remarkGfm (tablas, encabezados). Usado en diagnósticos y reingeniería.
- **StatusBadge** — Badge de estado para jobs/repos (pending, running, completed, error).
- **ProtectedRoute** — Layout de ruta que renderiza `<Outlet />` cuando hay JWT válido (e2e: `VITE_E2E_AUTH_BYPASS=true`).
- **DocViewer** — Visor de documentación markdown.
- **C4Previewer** — Niveles C4 + shadow opcional; obtiene DSL con `getProjectArchitectureC4` y el SVG con `postProjectC4RenderSvg` (proxy ingest→Kroki, sin `fetch` directo a kroki.io desde el navegador).
