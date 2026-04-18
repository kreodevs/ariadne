# Frontend — Ingest Admin

Proyecto en la raíz del repo (`frontend/`), independiente de `services/`. UI para el servicio de ingest: listado de repositorios, detalle + sync manual, jobs por repo y alta de repositorio.

## Estructura y documentación

- Componentes, páginas y utilidades documentados con **JSDoc**.
- `src/api.ts` — cliente API para Ingest.
- `src/types.ts` — tipos e interfaces.
- `src/components/` — **Layout** (sidenav colapsable, **AppShellHeader**: breadcrumbs + búsqueda + selector de workspace), `SidebarModern`, **DataTable** (TanStack Table), StatusBadge, UI Shadcn (Button, Card, Input, Select, Badge, Alert, Skeleton, Table, Dialog).
- `src/pages/` — **Dashboard** (`/dashboard`), listado de **proyectos** (`/`), **C4ViewerPage** (`/c4`), **ProjectDetail** (General + **Arquitectura** con `C4Previewer`), **DomainsList**, **RepoList** (The Forge, tabla filtrable), RepoDetail, RepoChat, RepoIndex, CreateRepo, EditRepo, CredentialsList, CreateCredential, EditCredential, **Ayuda**.
- **Tests:** `pnpm run test:unit` (Vitest), `pnpm run test:e2e` (Playwright; instalar Chromium con `pnpm exec playwright install chromium`). Ver `docs/notebooklm/TESTING.md` y `e2e/smoke.spec.ts`.

## Stack

- React 19 + TypeScript + Vite
- React Router
- Tailwind CSS
- Tema **Slate + acento azul** (`src/styles/vars.css`), tipografía Inter; Shadcn-style components; TanStack Table en listados densos.

## Configuración

- **API base:** variable de entorno `VITE_API_URL` (por defecto `http://localhost:3000`). El frontend se conecta a la API que hace proxy al ingest.
- **Auth OTP:** Autenticación con código de un solo uso. El usuario introduce email, recibe un código de 6 dígitos y lo valida. En desarrollo, `OTP_DEV_MODE=true` en la API devuelve el código en la respuesta para pruebas sin envío real.

## Scripts

- `npm run dev` — servidor de desarrollo (puerto 5173 por defecto).
- `npm run build` — build de producción en `dist/`.
- `npm run preview` — sirve `dist/` localmente.

## Rutas

- `/login` — Login con OTP: email → código de 6 dígitos.
- `/` — Redirige a `/dashboard`.
- `/dashboard` — Resumen KPI (proyectos, repos, dominios, salud de ingesta) desde `GET /projects`, `GET /repositories`, `GET /domains`.
- `/projects` — Listado de proyectos (`GET /projects`).
- `/c4` — Visor C4 dedicado: selector de proyecto + `C4Previewer` en layout split (diagrama + DSL).
- `/domains` — CRUD de **dominios** de arquitectura (`GET/POST /domains` vía API → ingest).
- `/projects/:id` — Detalle del proyecto: pestaña **General** (repos, roles, sync) y **Arquitectura** (asignación a dominio, dependencias cruzadas, diagrama C4 con Kroki y modo shadow opcional).
- `/repos/new` — Formulario de alta (`POST /repositories`). Provider → Credencial → Workspace/Owner → Proyecto (select) → Repo slug (editable) → Branch (select) → Webhook secret (Bitbucket, opcional). Carga workspaces, repos y branches desde la API con credencial.
- `/repos/:id` — Detalle del repo, Editar, Chat, Sync, **Resync** (`POST /repositories/:id/resync`), tabla de jobs.
- `/repos/:id/chat` — Layout split: **izquierda** botones Diagnóstico/Duplicados/Reingeniería y resultados (`POST /repositories/:id/analyze`); **derecha** chat NL→Cypher (`POST /repositories/:id/chat`). Requiere `OPENAI_API_KEY`. Spinner durante carga; errores visibles; markdown en respuestas.
- `/repos/:id/index` — Índice completo: **izquierda** File, Component, Function, Hook, **Dominio** (conceptos de dominio), etc.; **derecha** código del archivo al hacer click. Usa `GET /repositories/:id/graph-summary?full=1` y `GET /repositories/:id/file?path=`.
- `/repos/:id/edit` — Editar repo: credencial, branch por defecto y webhook secret (Bitbucket). Misma estructura que alta con Provider/Workspace/Repo en solo lectura (`PATCH /repositories/:id`).
- Lista `/repos`: **Resync** por fila (`POST /repositories/:id/resync`), sin abrir el detalle.
- Eliminar repo: botón en lista y detalle (`DELETE /repositories/:id`), con confirmación.
- `/credentials` — Lista de credenciales (tokens, app passwords, webhook secrets) cifradas en BD.
- `/credentials/new` — Alta de credencial.
- `/credentials/:id/edit` — Editar credencial: nombre, valor (token/password) y usuario para app_password (`PATCH /credentials/:id`).
- `/error` — Página de error genérica.
- `/ayuda` — Ayuda in-app: **MCP** (`docs/notebooklm/MCP_AYUDA.md` → `public/ayuda-mcp.md` vía `scripts/copy-docs.sh`), **Skills**, **Manual** (`docs/manual/README.md`).

## Docker

El `Dockerfile` construye el bundle y lo sirve con nginx. La URL de la API se inyecta en build time con `VITE_API_URL` (por defecto `http://localhost:3002`). En producción, usa la URL pública del ingest (p. ej. `https://ingest.tudominio.com`).

Desde la raíz del repo: el servicio `frontend` en `docker-compose` expone el puerto **5173** (o el que definas).
