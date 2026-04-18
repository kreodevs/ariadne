# Repositories (ingest)

CRUD de repositorios, branches, contenido de archivos, embed-index y jobs de sincronización.

## Endpoints relevantes

- `GET /repositories/jobs/active` — Lista jobs con estado `queued` o `running` en **todos** los repos, con datos mínimos del repositorio (para la vista “Cola de sync” en el frontend).
