# RepoDetail — Página de detalle de repositorio

Detalle de repo: info, Sync, Resync, **Indexar embeddings** (`POST /repositories/:id/embed-index` vía API), jobs, acciones (Editar, Chat, Índice, Eliminar). Útil tras Fase 4 (StorybookDoc/MarkdownDoc) o cambio de proveedor de embeddings sin re-sync completo.

## IDs: Repository ID vs Project ID

La card muestra ambos IDs por separado:

- **Repository ID**: UUID canónico del repositorio (PostgreSQL). No se regenera — es la identidad del repo.
- **Project ID**: UUID del proyecto asociado. Si el repo está en proyectos, usa ese; si no (standalone), usa el Repository ID.

Si coinciden (caso legacy 1:1), se muestra advertencia visual. La regeneración de Project ID se hace desde la página del proyecto (`/projects/:id`), no desde el detalle del repo.

## Arquitectura

Refactorizado con **compound components** para reducir complejidad (antes: nestingDepth 9, complejidad ciclomática 32).

### Estructura

```
RepoDetail/
├── index.tsx          # Orquestador: usa useRepoDetail, compone compound children
├── useRepoDetail.ts   # Hook: estado, side-effects, handlers; compone useRepoDetailJobs y useRepoDetailSync
├── utils.ts           # formatJobPayload
├── JobAnalysisModal.tsx    # Análisis de job incremental; si hay `projectId` Ariadne, usa `GET /projects/.../jobs/.../analysis`
├── SkippedFilesModal.tsx   # Modal de archivos omitidos (fetch, parse, index) por job
├── IndexedFilesModal.tsx   # Lista `payload.paths` de archivos indexados en el job (sync full; tope configurable en ingest)
├── RepoDetailLoading.tsx
├── RepoDetailError.tsx
├── RepoDetailNotFound.tsx
├── RepoDetailHeader.tsx
├── RepoDetailRepoCard.tsx   # Card principal con info repo y botones
└── RepoDetailJobsCard.tsx   # Tabla de jobs con selección múltiple + botón Analizar
```

### Compound Components

- `RepoDetail.Loading` — Skeleton durante carga inicial
- `RepoDetail.Error` — Alert cuando falla la petición
- `RepoDetail.NotFound` — Alert cuando el repo no existe
- `RepoDetail.Header` — Link "← Repos" → `/repos` (lista de repositorios)
- `RepoDetail.RepoCard` — Card con título, descripción, status, acciones
- `RepoDetail.JobsCard` — Tabla de jobs con checkboxes, borrar seleccionados/todos, **Ver indexados** / **Ver omitidos**, botón "Analizar" (solo jobs incrementales completados)

El orquestador (`RepoDetail`) decide qué componente renderizar según `loading`, `error`, `repo`.

### Análisis de jobs incrementales

En cada job incremental completado hay un botón **Analizar** que abre un modal con:

- **Resumen ejecutivo**: score de riesgo (1–10), archivos tocados, módulos dependientes, hallazgos de seguridad
- **Archivos modificados**: paths del push incremental
- **Impacto (topología)**: módulos que importan los archivos modificados (efecto dominó)
- **Auditoría de seguridad**: patrones detectados (API keys, secrets, tokens, etc.) con gravedad

El backend (`JobAnalysisService`) consulta FalkorDB para dependientes y escanea el contenido con regex para secretos.
