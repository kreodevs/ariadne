# Embedding Service (RAG)

Proveedores agnósticos de embeddings para FalkorDB vector search.

## Configuración

| Variable | Descripción |
|----------|-------------|
| `EMBEDDING_PROVIDER` | `openai` (default) o `google` |
| `OPENAI_API_KEY` | Requerida si provider=openai |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Requerida si provider=google |

## Uso

```bash
# OpenAI (default)
EMBEDDING_PROVIDER=openai OPENAI_API_KEY=sk-xxx

# Google
EMBEDDING_PROVIDER=google GOOGLE_API_KEY=xxx
```

## Proveedores

- **OpenAI**: `text-embedding-3-small` — 1536 dimensiones
- **Google**: `gemini-embedding-001` — 768 dimensiones

## FalkorDB

`embed-index` usa `vecf32($vec)` y `CREATE VECTOR INDEX`. Si el servidor responde `Unknown function 'vecf32'`, la versión de FalkorDB no incluye tipos vectoriales: actualiza según [docs Falkor](https://docs.falkordb.com/cypher/indexing/vector-index.html).

Para **no ejecutar** embed automático tras cada sync full (p. ej. hasta actualizar Falkor): `SYNC_SKIP_EMBED_INDEX=1` o `INGEST_SKIP_EMBED_INDEX=1`. Sigue pudiendo llamar `POST /repositories/:id/embed-index` a mano.

## Importante: cambio de proveedor

Cada proveedor usa una dimensión distinta. Si cambias de proveedor (ej. OpenAI → Google), debes ejecutar de nuevo `POST /repositories/:id/embed-index` para reindexar con la nueva dimensión. Los índices vectoriales de FalkorDB no son compatibles entre dimensiones; si no reindexas, la búsqueda semántica fallará o devolverá resultados incorrectos.

## Extender

Implementar `EmbeddingProvider` en `providers/` y registrar en `providers/index.ts`.
