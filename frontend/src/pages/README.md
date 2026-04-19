# Páginas

Vistas principales de la aplicación Ariadne (shell SaaS: sidebar + header con breadcrumbs).

## Dashboard y C4

- **Dashboard.tsx** — KPIs desde API: número de proyectos, repositorios, dominios y **salud de ingesta** (% repos en `ready`). Accesos rápidos a C4, grafo y cola. Ruta: `/dashboard` (landing tras login; **`/` redirige aquí**).
- **C4ViewerPage.tsx** — Visor C4 dedicado: selector de proyecto + **C4Previewer** en layout **split** (diagrama Kroki + panel DSL estilo editor). Misma API que la pestaña Arquitectura del proyecto. Ruta: `/c4`.

## Proyectos (multi-root)

- **DomainsList.tsx** — CRUD de **dominios** (nombre, color, descripción), columna **Proyectos asignados** (recuento + diálogo con enlaces), y diálogo **Visibilidad C4** (`domain_domain_visibility`). Los proyectos también asignan dominio en **ProjectDetail** (General o Arquitectura). Ruta: `/domains`.
- **ProjectList.tsx** — Lista de proyectos en **cards** con barra de salud de ingesta (repos `ready`/total), badge de dominio si aplica, ID MCP. Títulos de página `text-4xl`. Ruta **`/projects`** (no `/`; la raíz redirige al dashboard). Botón **Dominios** → `/domains`.
- **CreateProject.tsx** — Alta de proyecto (nombre y descripción opcionales). Tras crear redirige a `/projects/:id` donde se pueden añadir repos. Ruta: `/projects/new`.
- **ProjectDetail.tsx** — Detalle de proyecto: nombre, descripción (editable), ID (MCP) con copiar y botón **Regenerar ID** (crea nuevo UUID sin perder datos), tabla de repos (columna **Rol (chat)** editable, persiste vía API para inferencia multi-root), acciones por repo.
- **ProjectChat.tsx** — Chat a nivel proyecto: consulta el grafo de **todos** los repos. Con **varios repos**, opción **chat amplio** (`strictChatScope: false`) para evitar `[AMBIGUOUS_SCOPE]` cuando no hay scope ni inferencia por rol. Análisis de código (diagnóstico, duplicados, …) por repo con **selector de root** si hay varios repos, **alcance opcional** en análisis y badges **`reportMeta`**. AGENTS/SKILL a nivel proyecto. Ruta: `/projects/:id/chat`.

## Repositorios (The Forge)

- **RepoList.tsx** — Lista de repositorios con **DataTable** (TanStack: ordenación y filtro global). Título de vista **The Forge**. Acciones **Ver**, **Editar**, **Resync**, **Eliminar** (sin cambiar API).
- **ActiveJobsQueue.tsx** — Cola global: `queued` / `running` más jobs **terminados recientes** (`completed` / `failed`) para auditoría; desplegables **Ver indexados** / **Ver omitidos**; checkboxes + **Borrar seleccionados** / **Borrar** por fila (`DELETE /repositories/:id/jobs/:jobId`). Los jobs `running` no son seleccionables ni borrables desde aquí. `GET /repositories/jobs/active`; `SYNC_QUEUE_RECENT_JOBS` en ingest (default 100). Auto-refresh cada 5s. Ruta: `/jobs`.
- **RepoDetail.tsx** — Detalle de un repo (sync, jobs, análisis).
- **RepoChat.tsx** — Chat por repositorio + panel de análisis (diagnóstico, duplicados, reingeniería, código muerto, **seguridad** heurística, AGENTS, SKILL, Full Audit). **Alcance opcional** y badges de caché / foco vía `reportMeta`. Ruta: `/repos/:id/chat`.
- **RepoIndex.tsx** — Navegador del índice Falkor del repo (`GET graph-summary` con `full=1` y **`repoScoped=1`** para no mezclar nodos de otros roots en proyectos multi-root).
- **CreateRepo.tsx** — Alta de repo; acepta `?projectId=` para asociar al proyecto. Refactor: hook `useCreateRepoDiscovery` y componentes `CreateRepoProviderSelect`, `CreateRepoCredentialSelect` para reducir nesting.
- **EditRepo.tsx** — Edición de repo.

## Otros

- **Login.tsx** — Autenticación OTP: email → código de 6 dígitos.
- **CredentialsList.tsx**, **CreateCredential.tsx**, **EditCredential.tsx** — CRUD de credenciales.
- **Ayuda.tsx** — Manual y ayuda (docs).
- **ErrorPage.tsx** — Página de error genérica.
