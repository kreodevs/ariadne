# Flujo de Ingesta Masiva (GitHub / Bitbucket)

Estrategia recomendada para la carga masiva de repos antes de activar webhooks.

## 1. Estrategia por Capas

### Fase 1 — Mapping (Esqueleto)

Escaneo del repo para generar estructura y lenguajes:

- Listado recursivo de archivos (API o shallow clone)
- Detección de lenguajes por extensión (`.js`, `.ts`, `.tsx`, etc.)
- Árbol de directorios derivado de los paths
- **Alcance por repo (opcional):** si `repositories.index_include_rules` no es `null`, tras el listado el ingest aplica `index-include-rules.ts`: siempre entra `package.json` y los `*.json|js|ts|jsx|tsx` en **raíz**; además cada `path_prefix` / `file` del JSON. `null` = sin recorte adicional (todo lo que pase `sync-path-filter.ts`). Ver sección **1.1** en [MONOREPO_Y_LIMITACIONES_INDEXADO.md](MONOREPO_Y_LIMITACIONES_INDEXADO.md).

### Fase 2 — Análisis de Dependencias

Lectura de manifiestos para que la IA conozca librerías externas:

- `package.json` → `dependencies` + `devDependencies`
- `requirements.txt` (Python)
- `go.mod` (Go)

Se almacenan en el nodo `Project.manifestDeps` del grafo.

### Fase 3 — Chunking Semántico

División por unidades lógicas (AST con Tree-sitter), no por caracteres:

- Funciones, clases y métodos completos
- Metadata por fragmento: `file_path`, `function_name`, `line_range`, `commit_sha`
- Evita cortar funciones por límite de tokens

## 2. Worker de Ingesta (Cola de Mensajes)

No se indexa todo en un solo proceso síncrono. Se usa una cola Redis/BullMQ:

1. **`POST /repositories/:id/sync`** → encola el job
2. **Worker** procesa en background:
   - Shallow clone o API según estrategia
   - Fases 1–3
   - Escritura en FalkorDB (nodos con `projectId` y `repoId`) + PostgreSQL. Multi-root: se escribe para cada proyecto del repo (standalone + `project_repositories`).
3. **Resync:** `POST /repositories/:id/resync` — borra ámbito standalone del repo y reindexa todo (standalone + todos los proyectos). `POST /repositories/:id/resync-for-project` con body `{ projectId }` — borra solo el slice (projectId, repoId) y reindexa solo ese proyecto para ese repo.

### Shallow Clone (opcional)

```bash
git clone --depth 1 [URL_DEL_REPO]
```

- Menor tamaño (sin historial completo)
- Útil cuando hay rate limits o muchas llamadas a la API

### Procesamiento con AST

- Tree-sitter para límites precisos de funciones/clases
- `buildCypherForFile` con `ChunkingContext` (`commitSha`)
- `Function`: `startLine`, `endLine`, `commitSha`

## 3. Credenciales (BD o env)

- **En BD:** Crear credencial en `/credentials/new` (frontend). Cifrada con `CREDENTIALS_ENCRYPTION_KEY`. Asignar al repo vía `credentialsRef`.
- **Env:** `BITBUCKET_TOKEN`, `BITBUCKET_APP_PASSWORD`, `GITHUB_TOKEN`, `BITBUCKET_WEBHOOK_SECRET`. Fallback si no hay `credentialsRef`.

## 4. GitHub vs Bitbucket

| Característica   | GitHub                       | Bitbucket                    |
|------------------|------------------------------|------------------------------|
| Auth             | PAT (BD o `GITHUB_TOKEN`)    | App Password / OAuth (BD o env) |
| API listado      | `/repos/{owner}/{repo}`      | `repositories/{workspace}`   |
| Rate limit       | 5.000 req/h (auth)           | Depende del plan             |

## 5. Puente hacia Webhooks

- Tras la ingesta inicial se guarda `lastCommitSha` en `repositories`.
- En push, si el historial es desconocido, se usa diff entre `lastCommitSha` y el nuevo.
- Los archivos borrados se eliminan del grafo (orphan cleanup).

## 6. Qué Evitar

- **Indexar basura:** `node_modules`, `dist`, `venv`, `.log`, `.env`
- **Tokens huérfanos:** Si un archivo desaparece del repo, eliminarlo de FalkorDB e `indexed_files`
