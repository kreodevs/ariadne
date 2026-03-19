# Frontend — Ingest Admin

Proyecto en la raíz del repo (`frontend/`), independiente de `services/`. UI para el servicio de ingest: listado de repositorios, detalle + sync manual, jobs por repo y alta de repositorio.

## Estructura y documentación

- Componentes, páginas y utilidades documentados con **JSDoc**.
- `src/api.ts` — cliente API para Ingest.
- `src/types.ts` — tipos e interfaces.
- `src/components/` — Layout, StatusBadge, shadcn/ui.
- `src/pages/` — RepoList, RepoDetail (compound components), RepoChat, RepoIndex, CreateRepo, EditRepo, CredentialsList, CreateCredential, EditCredential, **Ayuda**.

## Stack

- React 19 + TypeScript + Vite
- React Router
- Tailwind CSS
- Shadcn/ui (Card, Button, Table, Input, Select, Badge, Alert, Skeleton)

## Configuración

- **API base:** variable de entorno `VITE_API_URL` (por defecto `http://localhost:3002`). Copia `.env.example` a `.env` y ajusta si el ingest corre en otra URL/puerto.
- **SSO (opcional):** Si defines `VITE_SSO_APPLICATION_ID`, la app usa autenticación SSO (redirección a apisso.grupowib.com.mx). Ver `.env.example` para `VITE_SSO_BASE_URL`, `VITE_SSO_APPLICATION_ID`, `VITE_SSO_FRONTEND_URL`.

## Scripts

- `npm run dev` — servidor de desarrollo (puerto 5173 por defecto).
- `npm run build` — build de producción en `dist/`.
- `npm run preview` — sirve `dist/` localmente.

## Rutas

- `/` — Listado de repos (`GET /repositories`).
- `/repos/new` — Formulario de alta (`POST /repositories`). Provider → Credencial → Workspace/Owner → Proyecto (select) → Repo slug (editable) → Branch (select) → Webhook secret (Bitbucket, opcional). Carga workspaces, repos y branches desde la API con credencial.
- `/repos/:id` — Detalle del repo, Editar, Chat, Sync, **Resync** (`POST /repositories/:id/resync`), tabla de jobs.
- `/repos/:id/chat` — Layout split: **izquierda** botones Diagnóstico/Duplicados/Reingeniería y resultados (`POST /repositories/:id/analyze`); **derecha** chat NL→Cypher (`POST /repositories/:id/chat`). Requiere `OPENAI_API_KEY`. Spinner durante carga; errores visibles; markdown en respuestas.
- `/repos/:id/index` — Índice completo: **izquierda** File, Component, Function, Hook, **Dominio** (conceptos de dominio), etc.; **derecha** código del archivo al hacer click. Usa `GET /repositories/:id/graph-summary?full=1` y `GET /repositories/:id/file?path=`.
- `/repos/:id/edit` — Editar repo: credencial, branch por defecto y webhook secret (Bitbucket). Misma estructura que alta con Provider/Workspace/Repo en solo lectura (`PATCH /repositories/:id`).
- Eliminar repo: botón en lista y detalle (`DELETE /repositories/:id`), con confirmación.
- `/credentials` — Lista de credenciales (tokens, app passwords, webhook secrets) cifradas en BD.
- `/credentials/new` — Alta de credencial.
- `/credentials/:id/edit` — Editar credencial: nombre, valor (token/password) y usuario para app_password (`PATCH /credentials/:id`).
- `/callback` — Callback SSO: recibe `?token=...` desde el SSO, guarda el token y redirige a `/`.
- `/error` — Página de error (ej. fallo de autenticación SSO).
- `/ayuda` — Ayuda con 3 subsecciones (navegación in-app, sin descargar): **MCP** (`docs/MCP_AYUDA.md`), **Skills** (Skill FalkorSpecs), **Manual de uso** (`docs/manual/README.md`).

## Docker

El `Dockerfile` construye el bundle y lo sirve con nginx. La URL de la API se inyecta en build time con `VITE_API_URL` (por defecto `http://localhost:3002`). En producción, usa la URL pública del ingest (p. ej. `https://ingest.tudominio.com`).

Desde la raíz del repo: el servicio `frontend` en `docker-compose` expone el puerto **5173** (o el que definas).
