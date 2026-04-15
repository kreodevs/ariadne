# Páginas

Vistas principales de la aplicación Ariadne.

## Proyectos (multi-root)

- **ProjectList.tsx** — Lista de proyectos; cada proyecto puede tener varios repos. Muestra el ID del proyecto (MCP) en cada card, clic para copiar. Botón "Nuevo proyecto" → alta de proyecto.
- **CreateProject.tsx** — Alta de proyecto (nombre y descripción opcionales). Tras crear redirige a `/projects/:id` donde se pueden añadir repos. Ruta: `/projects/new`.
- **ProjectDetail.tsx** — Detalle de proyecto: nombre, descripción (editable), ID (MCP) con copiar y botón **Regenerar ID** (crea nuevo UUID sin perder datos), tabla de repos (columna **Rol (chat)** editable, persiste vía API para inferencia multi-root), acciones por repo.
- **ProjectChat.tsx** — Chat a nivel proyecto: consulta el grafo de **todos** los repos. Con **varios repos**, opción **chat amplio** (`strictChatScope: false`) para evitar `[AMBIGUOUS_SCOPE]` cuando no hay scope ni inferencia por rol. Análisis de código (diagnóstico, duplicados, …) por repo con **selector de root** si hay varios repos, **alcance opcional** en análisis y badges **`reportMeta`**. AGENTS/SKILL a nivel proyecto. Ruta: `/projects/:id/chat`.

## Repositorios

- **RepoList.tsx** — Lista de todos los repositorios; acciones **Ver**, **Editar**, **Resync** (reindexación completa sin entrar al detalle), **Eliminar**.
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
