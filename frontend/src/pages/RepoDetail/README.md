# RepoDetail — Página de detalle de repositorio

Detalle de repo: info, Sync, Resync, jobs, acciones (Editar, Chat, Índice, Eliminar).

## Arquitectura

Refactorizado con **compound components** para reducir complejidad (antes: nestingDepth 9, complejidad ciclomática 32).

### Estructura

```
RepoDetail/
├── index.tsx          # Orquestador: usa useRepoDetail, compone compound children
├── useRepoDetail.ts   # Hook: estado, side-effects, handlers; compone useRepoDetailJobs y useRepoDetailSync
├── utils.ts           # formatJobPayload
├── JobAnalysisModal.tsx    # Modal de análisis (impacto, seguridad, resumen) para jobs incrementales
├── SkippedFilesModal.tsx   # Modal de archivos omitidos (fetch, parse, index) por job
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
- `RepoDetail.Header` — Link "← Repos"
- `RepoDetail.RepoCard` — Card con título, descripción, status, acciones
- `RepoDetail.JobsCard` — Tabla de jobs con checkboxes, borrar seleccionados/todos, botón "Analizar" (solo jobs incrementales completados)

El orquestador (`RepoDetail`) decide qué componente renderizar según `loading`, `error`, `repo`.

### Análisis de jobs incrementales

En cada job incremental completado hay un botón **Analizar** que abre un modal con:

- **Resumen ejecutivo**: score de riesgo (1–10), archivos tocados, módulos dependientes, hallazgos de seguridad
- **Archivos modificados**: paths del push incremental
- **Impacto (topología)**: módulos que importan los archivos modificados (efecto dominó)
- **Auditoría de seguridad**: patrones detectados (API keys, secrets, tokens, etc.) con gravedad

El backend (`JobAnalysisService`) consulta FalkorDB para dependientes y escanea el contenido con regex para secretos.
