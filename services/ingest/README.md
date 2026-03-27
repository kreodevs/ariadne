# Ingest (microservicio de ingesta)

Microservicio NestJS que reemplaza la ingesta basada en directorio local (chokidar) por **repositorio remoto (Bitbucket/GitHub) + full sync + webhook**.

## Flujo de Ingesta

1. **Fase Mapping:** Escaneo del repo (árbol, lenguajes); incluye `.prisma` cuando aplica.
2. **Fase Deps:** Lectura de `package.json` para `manifestDeps` en Project.
3. **Fase Chunking:** Parse Tree-sitter con metadata `line_range` y `commit_sha`; **Prisma** vía `@prisma/internals` (getDMMF) → nodos `:Model`, `:Enum`, relaciones `RELATES_TO` / `USES_ENUM`; **tsconfig** con TypeScript API (`extends` merge) para aliases en `IMPORTS`. Incluye **domain-extract** (DomainConcept).
4. **Cola Redis/BullMQ:** Sync se encola; worker procesa en background.
5. **Orphan cleanup:** Archivos borrados se eliminan del grafo.

## Stack

- NestJS, TypeORM, PostgreSQL
- Entidades: `repositories`, `sync_jobs`, `indexed_files`
- **Multi-proyecto:** Cada repositorio se indexa como un nodo `:Project` en FalkorDB (`projectId` = `repo.id`). Todos los nodos (File, Component, etc.) incluyen `projectId`. Relación `(Project)-[:CONTAINS]->(File)`.

## Endpoints

- `POST /repositories` — Registrar repositorio (provider, projectKey, repoSlug, defaultBranch, credentialsRef opcional)
- `GET /repositories` — Listar repositorios
- `GET /repositories/:id` — Detalle de un repositorio
- `GET /repositories/:id/file?path=&ref=` — Contenido de un archivo (Bitbucket/GitHub). `path` relativo o del grafo (repo-slug/src/foo.ts)
- `POST /repositories/:id/embed-index` — Embeddings en Function, Component y **Document** (chunks `.md`) para RAG; EMBEDDING_PROVIDER + API key, FalkorDB 4.0+
- `GET /repositories/:id/jobs` — Listar sync_jobs del repositorio
- `GET /embed?text=` — Vector de embedding para RAG (requiere EMBEDDING_PROVIDER + OPENAI_API_KEY o GOOGLE_API_KEY)
- `POST /repositories/:id/sync` — Encola job de full sync; retorna `{ jobId, queued: true }`
- `POST /repositories/:id/resync` — Borra el grafo e índice del proyecto y encola sync completo. Retorna `{ jobId, queued, deletedNodes? }`
- `POST /repositories/:id/chat` — Chat NL→Cypher. Body: `{ message, history? }`. Requiere `OPENAI_API_KEY`. Ver [src/chat/README.md](src/chat/README.md).
- `POST /repositories/:id/analyze` — Análisis estructurado. Body: `{ mode: 'diagnostico'|'duplicados'|'reingenieria'|'codigo_muerto'|'seguridad'|... }`. Diagnóstico: top riesgo, antipatrones; Duplicados: embeddings; Reingeniería: plan priorizado; Código muerto: detalle de uso por archivo; **seguridad:** escaneo heurístico de secretos + informe LLM (complementa Full Audit).
- `GET /repositories/:id/graph-summary` — Conteos y muestras de nodos indexados.

Tras cada sync (normal o resync), se ejecuta automáticamente `embed-index` si hay EMBEDDING_PROVIDER configurado; si no, se ignora sin fallar.
- `POST /shadow` — Indexar archivos en **FalkorSpecsShadow** (parse + tsconfig + Prisma + producer). Body: `{ files: [{ path, content }] }`. La API proxifica aquí (`INGEST_URL`).
- `POST /webhooks/bitbucket` — Webhook para push/PR (ver módulo Webhook)

## Variables de entorno

- `PORT` — Puerto HTTP (default 3002)
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` — PostgreSQL
- `FALKORDB_HOST`, `FALKORDB_PORT` — FalkorDB (sync escribe en grafo `FalkorSpecs`, shadow en `FalkorSpecsShadow`)
- `FALKORDB_BATCH_SIZE` — Tamaño de batch para Cypher (default 500)
- `DOMAIN_COMPONENT_PATTERNS`, `DOMAIN_CONST_NAMES` — Fallback global si el proyecto no tiene `domain_config` (por defecto se infiere en primera ingesta)
- `REDIS_URL` — Redis para cola BullMQ (default `redis://localhost:6380`)
- `CREDENTIALS_ENCRYPTION_KEY` — Clave para cifrar credenciales en BD (32 bytes base64). Requerida si se usan credenciales en BD.
- `BITBUCKET_TOKEN` / `BITBUCKET_APP_PASSWORD` — Bitbucket (fallback si no hay credentialsRef). Permisos requeridos: Account: Read, Workspace membership: Read, Repositories: Read (ver [docs/manual/CONFIGURACION_Y_USO.md](../../docs/manual/CONFIGURACION_Y_USO.md))
- `GITHUB_TOKEN` — GitHub (fallback)
- `EMBEDDING_PROVIDER` — openai o google
- `OPENAI_API_KEY` — Chat, diagnósticos y (si provider=openai) embeddings. **Obligatorio** para chat/analyze.
- `CHAT_MODEL` — Modelo OpenAI para chat (default `gpt-4o-mini`). Diagnóstico/reingeniería truncan datos automáticamente para evitar context_length_exceeded (128k tokens).
- `CHAT_TELEMETRY_LOG` — `1` o `true`: log JSON por request del pipeline unificado (tamaños, citas de paths, `pathGroundingRatio` vs retrieval).
- `METRICS_ENABLED` — `0` o `false`: desactiva Prometheus (`GET /metrics` responde 503). Por defecto las métricas están activas (Fase 0 — ver [docs/OBSERVABILIDAD_FASE0.md](../../docs/OBSERVABILIDAD_FASE0.md)).
- `CHAT_TWO_PHASE` — `0` / `false` / `off`: desactiva el bloque JSON de retrieval antes del contexto bruto en el sintetizador (default: activo).
- `CHAT_EVIDENCE_FIRST_MAX_CHARS` — tope de caracteres del contexto bruto hacia el sintetizador cuando el body del chat incluye `responseMode: 'evidence_first'` (default `18000`, mínimo efectivo `4000`, máximo `100000`).
- `MODIFICATION_PLAN_MAX_FILES` — Tope de entradas en `get_modification_plan` (default 150, máx. 2000).
- `GOOGLE_API_KEY` / `GEMINI_API_KEY` — Si provider=google
- `NODE_ENV` — Si no es `production`, TypeORM usa `synchronize: true`
- `INDEX_TESTS` — `true` o `1`: incluir archivos `*.test.*` y `*.spec.*` en el indexado (default: excluidos)
- `TRUNCATE_PARSE_MAX_BYTES` — Límite de bytes para truncar archivos grandes antes de parsear (default 25000). Tree-sitter falla con muchos nodos hermanos; aumentar con cuidado.

**Embeddings:** Si cambias de proveedor (OpenAI ↔ Google), reejecuta `POST /repositories/:id/embed-index`; las dimensiones son distintas (1536 vs 768) y FalkorDB no admite mezclar.

## Desarrollo

```bash
cd services/ingest
npm install
npm run build
# Con postgres levantado (docker-compose up postgres -d):
PORT=3002 npm run start
```

## Webhook Bitbucket

Configuración del webhook en Bitbucket: ver [docs/bitbucket_webhook.md](../../docs/bitbucket_webhook.md) en la raíz del proyecto.

## Migraciones

En producción se usa `synchronize: false`. Ejecutar migraciones una vez antes de arrancar la app:

```bash
npm run migration:run
```

Esto compila y ejecuta `typeorm migration:run -d dist/data-source.js`. Asegura que las variables de PostgreSQL (`PGHOST`, `PGPORT`, etc.) estén definidas.
