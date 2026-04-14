# QA Fase 6 — Analytics multi-root (punto 1)

## Cómo ejecutar

1. Infra: `colima start` (o Docker Desktop), luego desde la raíz del repo:
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres falkordb redis ingest
   ```
2. Esperar salud de Postgres/Falkor; ingest en `http://127.0.0.1:3002`.
3. Tener al menos un **proyecto multi-root** (2+ repos) en BD para cubrir el caso [A]; si solo hay mono-repos, [A] y [C] salen SKIP.
4. Ejecutar:
   ```bash
   export INGEST_URL=http://127.0.0.1:3002
   ./scripts/qa-fase6-analytics.sh
   ```

## Casos que cubre el script

| Caso | Qué valida |
|------|------------|
| [A] | `POST /projects/:id/analyze` con `{mode:diagnostico}` **sin** `idePath` en proyecto **multi-root** → **HTTP 400** (mensaje multi-root). |
| [B] | Proyecto **un solo repo**: mismo POST **no** debe400 por “multi-root”. |
| [C] | Multi-root **con** `idePath` que contiene `repoSlug` → no 400 por resolución (puede 200 o 5xx por Falkor/LLM). |
| [D] | `POST /repositories/:repoId/analyze` como referencia para flujo MCP con `roots[].id`. |
| [E] | `GET /projects/:id/resolve-repo-for-path?path=...` |

## MCP (manual en Cursor)

- `get_project_analysis` con `projectId` = **id de proyecto** (no `roots[].id`) y `currentFilePath` apuntando a un archivo bajo un root concreto.
- Repetir con `projectId` = **`roots[].id`** y sin path.

## Resultado en este entorno (agente)

| Ítem | Estado |
|------|--------|
| Script `scripts/qa-fase6-analytics.sh` | Creado y ejecutable |
| Ejecución contra ingest real | **No aplicable**: Docker/Colima no disponible en la sesión (`connect: no such file or directory`) |
| Pendiente | Correr el script en tu máquina con stack levantado y anotar aquí OK/FAIL por caso |

Cuando lo ejecutes localmente, puedes pegar debajo la salida del script:

```
(pegar salida)
```
