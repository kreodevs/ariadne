# Embedding Service (RAG)

Proveedores agnósticos de embeddings para FalkorDB vector search.

## Configuración

| Variable | Descripción |
|----------|-------------|
| `EMBEDDING_PROVIDER` | `openai` (default), `google`, `kimi`/`moonshot` u `ollama` |
| `OPENAI_API_KEY` | Requerida si provider=openai |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Requerida si provider=google |
| `MOONSHOT_API_KEY` o `KIMI_API_KEY` | Requerida si provider=kimi |
| `MOONSHOT_BASE_URL` | Opcional (default `https://api.moonshot.ai/v1`) |
| `KIMI_EMBEDDING_MODEL` | **Obligatorio** con kimi “solo env”: nombre del modelo en la API `/v1/embeddings` |
| `KIMI_EMBEDDING_DIMENSION` | **Obligatorio** con kimi “solo env”: dimensión del vector (debe coincidir con la respuesta real) |
| `OLLAMA_HOST` | Base URL del servidor Ollama (default `http://127.0.0.1:11434`) |
| `OLLAMA_EMBED_MODEL` | Modelo de embeddings si `EMBEDDING_PROVIDER=ollama` sin fila en Postgres (ej. `nomic-embed-text`) |
| `OLLAMA_EMBED_DIMENSION` | Dimensión esperada con ollama “solo env” (default `768`) |

## Uso

```bash
# OpenAI (default)
EMBEDDING_PROVIDER=openai OPENAI_API_KEY=sk-xxx

# Google
EMBEDDING_PROVIDER=google GOOGLE_API_KEY=xxx

# Kimi (Moonshot) — POST /v1/embeddings compatible OpenAI; modelo y dimensión explícitos
EMBEDDING_PROVIDER=kimi MOONSHOT_API_KEY=xxx KIMI_EMBEDDING_MODEL=<modelo> KIMI_EMBEDDING_DIMENSION=1024
```

## Proveedores

- **OpenAI**: `text-embedding-3-small` — 1536 dimensiones (parametrizable vía `embedding_spaces`)
- **Google**: `gemini-embedding-001` — 768 dimensiones
- **Ollama**: API `/api/embeddings`; modelo y dimensión acordes al servidor (p. ej. Nomic)
- **Kimi**: misma forma de petición que OpenAI embeddings; la documentación pública de Kimi no lista un modelo de embedding fijo — configura `KIMI_EMBEDDING_MODEL` y `KIMI_EMBEDDING_DIMENSION` según lo que exponga tu cuenta (o usa `embedding_spaces` en Postgres).

## Postgres: `embedding_spaces` y migración sin downtime

- Tabla **`embedding_spaces`**: versiona `provider`, `model_id`, `dimension` y **`graph_property`** (nombre de la propiedad vectorial en nodos Falkor: `Function`, `Component`, `Document`).
- En **`repositories`**: `read_embedding_space_id` (búsqueda + `GET /embed?repositoryId=`) y `write_embedding_space_id` (destino de `embed-index`). Si ambos son null, el comportamiento es el histórico: propiedad `embedding` y `EMBEDDING_PROVIDER`.
- **Flujo migración** (ej. OpenAI → Ollama): crea un espacio nuevo (`POST /embedding-spaces`), asigna solo `write_embedding_space_id` al repo, ejecuta `embed-index` (llena la nueva propiedad e índice en paralelo al legado), cuando termina asigna `read_embedding_space_id` al mismo espacio (o quita `write` si ya no hace falta). La lectura sigue usando el espacio anterior hasta el flip.
- API: `GET/POST /embedding-spaces`, y `PATCH /repositories/:id` con `readEmbeddingSpaceId` / `writeEmbeddingSpaceId`.

## FalkorDB

`embed-index` usa `vecf32($vec)` y `CREATE VECTOR INDEX`. Si el servidor responde `Unknown function 'vecf32'`, la versión de FalkorDB no incluye tipos vectoriales: actualiza según [docs Falkor](https://docs.falkordb.com/cypher/indexing/vector-index.html). Al arrancar embed-index se hace una **sonda** `RETURN vecf32(...)`; si falla, se omite todo el lote (un warning) en lugar de un error por cada nodo.

Para **no ejecutar** embed automático tras cada sync full (p. ej. hasta actualizar Falkor): `SYNC_SKIP_EMBED_INDEX=1` o `INGEST_SKIP_EMBED_INDEX=1`. Sigue pudiendo llamar `POST /repositories/:id/embed-index` a mano.

## Importante: cambio de proveedor sin catálogo

Sin filas en `embedding_spaces`, cada cambio de `EMBEDDING_PROVIDER` sigue implicando reindexar sobre la propiedad `embedding` y un solo índice por label. Con espacios distintos (`graph_property` distintos), FalkorDB puede mantener **varios** índices vectoriales simultáneamente durante la migración.

## Extender

Implementar `EmbeddingProvider` en `providers/` y registrar en `providers/index.ts`.
