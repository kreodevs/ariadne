# Páginas

Vistas principales de la aplicación Ariadne.

## Proyectos (multi-root)

- **ProjectList.tsx** — Lista de proyectos; cada proyecto puede tener varios repos. Muestra el ID del proyecto (MCP) en cada card, clic para copiar. Botón "Nuevo proyecto" → alta de proyecto.
- **CreateProject.tsx** — Alta de proyecto (nombre y descripción opcionales). Tras crear redirige a `/projects/:id` donde se pueden añadir repos. Ruta: `/projects/new`.
- **ProjectDetail.tsx** — Detalle de proyecto: nombre, descripción (editable), ID (MCP) con copiar, tabla de repos (rama, estado, último sync), acciones por repo. Refactor: AssociateRepoDialog y ProjectDetailDescriptionCard extraídos; saveDescription/saveName usan `finally` para clearing de estado.
- **ProjectChat.tsx** — Chat a nivel proyecto: consulta el grafo de **todos** los repos del proyecto. Botones AGENTS y SKILL generan contenido markdown según el conocimiento del proyecto. Ruta: `/projects/:id/chat`.

## Repositorios

- **RepoList.tsx** — Lista de todos los repositorios.
- **RepoDetail.tsx** — Detalle de un repo (sync, jobs, análisis).
- **RepoChat.tsx** — Chat por repositorio (grafo de un solo repo) + panel de análisis (diagnóstico, duplicados, reingeniería, código muerto, AGENTS, SKILL, Full Audit). Ruta: `/repos/:id/chat`.
- **RepoIndex.tsx** — Navegador del índice/grafo del repo.
- **CreateRepo.tsx** — Alta de repo; acepta `?projectId=` para asociar al proyecto. Refactor: hook `useCreateRepoDiscovery` y componentes `CreateRepoProviderSelect`, `CreateRepoCredentialSelect` para reducir nesting.
- **EditRepo.tsx** — Edición de repo.

## Otros

- **Login.tsx** — Autenticación OTP: email → código de 6 dígitos.
- **CredentialsList.tsx**, **CreateCredential.tsx**, **EditCredential.tsx** — CRUD de credenciales.
- **Ayuda.tsx** — Manual y ayuda (docs).
- **ErrorPage.tsx** — Página de error genérica.
