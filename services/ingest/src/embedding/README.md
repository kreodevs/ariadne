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
| `KIMI_EMBEDDING_MODEL` / `MOONSHOT_EMBEDDING_MODEL` | Default **`moonshot-v1`** (modelo habitual para embeddings en la API Moonshot). |
| `KIMI_EMBEDDING_DIMENSION` / `MOONSHOT_EMBEDDING_DIMENSION` | Default **1024**; debe coincidir con la longitud real del vector devuelto por la API. |

### Kimi/Moonshot: 403 `permission_denied` en `/v1/embeddings`

Si el log muestra `The API you are accessing is not open` / `permission_denied_error`, la **API de embeddings** no está disponible para tu API key (el endpoint de **chat** puede seguir funcionando). Opciones: habilitar embeddings en la consola de Moonshot/Kimi según tu plan, usar otra clave con ese producto activo, o cambiar a **`EMBEDDING_PROVIDER=openai`** (u `google` / `ollama`) solo para vectores RAG.
| `OLLAMA_HOST` | Base URL del servidor Ollama (default `http://127.0.0.1:11434`) |
| `OLLAMA_EMBED_MODEL` | Modelo de embeddings si `EMBEDDING_PROVIDER=ollama` sin fila en Postgres (ej. `nomic-embed-text`) |
| `OLLAMA_EMBED_DIMENSION` | Dimensión esperada con ollama “solo env” (default `768`) |

## Uso

```bash
# OpenAI (default)
EMBEDDING_PROVIDER=openai OPENAI_API_KEY=sk-xxx

# Google
EMBEDDING_PROVIDER=google GOOGLE_API_KEY=xxx

# Kimi (Moonshot) — POST /v1/embeddings; por defecto modelo moonshot-v1 y dim 1024
EMBEDDING_PROVIDER=kimi MOONSHOT_API_KEY=xxx
# opcional si no quieres los defaults:
# KIMI_EMBEDDING_MODEL=moonshot-v1
# KIMI_EMBEDDING_DIMENSION=1024
```

## Proveedores

- **OpenAI**: `text-embedding-3-small` — 1536 dimensiones (parametrizable vía `embedding_spaces`)
- **Google**: `gemini-embedding-001` — 768 dimensiones
- **Ollama**: API `/api/embeddings`; modelo y dimensión acordes al servidor (p. ej. Nomic)
- **Kimi**: misma forma que OpenAI embeddings; por defecto se usa **`moonshot-v1`** y dimensión **1024**. Si la API devuelve otro tamaño de vector, ajusta `KIMI_EMBEDDING_DIMENSION` (o la fila en `embedding_spaces`).

## Postgres: `embedding_spaces` y migración sin downtime

- Tabla **`embedding_spaces`**: versiona `provider`, `model_id`, `dimension` y **`graph_property`** (nombre de la propiedad vectorial en nodos Falkor: `Function`, `Component`, `Document`, `StorybookDoc`, `MarkdownDoc`, **`Model`**, **`Enum`** — ver `FALKOR_EMBEDDABLE_NODE_LABELS` en `ariadne-common`).
- En **`repositories`**: `read_embedding_space_id` (búsqueda + `GET /embed?repositoryId=`) y `write_embedding_space_id` (destino de `embed-index`). Si ambos son null, el comportamiento es el histórico: propiedad `embedding` y `EMBEDDING_PROVIDER`.
- **Flujo migración** (ej. OpenAI → Ollama): crea un espacio nuevo (`POST /embedding-spaces`), asigna solo `write_embedding_space_id` al repo, ejecuta `embed-index` (llena la nueva propiedad e índice en paralelo al legado), cuando termina asigna `read_embedding_space_id` al mismo espacio (o quita `write` si ya no hace falta). La lectura sigue usando el espacio anterior hasta el flip.
- API: `GET/POST /embedding-spaces`, y `PATCH /repositories/:id` con `readEmbeddingSpaceId` / `writeEmbeddingSpaceId`.

## FalkorDB

`embed-index` usa `vecf32($vec)` y `CREATE VECTOR INDEX`. Si el servidor responde `Unknown function 'vecf32'`, la versión de FalkorDB no incluye tipos vectoriales: actualiza según [docs Falkor](https://docs.falkordb.com/cypher/indexing/vector-index.html). En este repo, **`docker-compose.yml`** fija `falkordb/falkordb:v4.16.5` (o equivalente reciente de la serie 4.16.x); imágenes tipo **v4.0.1** pueden no exponer el mismo soporte vector en despliegues viejos. Al arrancar embed-index se hace una **sonda** `RETURN vecf32(...)`; si falla, se omite todo el lote (un warning) en lugar de un error por cada nodo.

Para **no ejecutar** embed automático tras cada sync full (p. ej. hasta actualizar Falkor): `SYNC_SKIP_EMBED_INDEX=1` o `INGEST_SKIP_EMBED_INDEX=1`. Sigue pudiendo llamar `POST /repositories/:id/embed-index` a mano.

## Importante: cambio de proveedor sin catálogo

Sin filas en `embedding_spaces`, cada cambio de `EMBEDDING_PROVIDER` sigue implicando reindexar sobre la propiedad `embedding` y un solo índice por label. Con espacios distintos (`graph_property` distintos), FalkorDB puede mantener **varios** índices vectoriales simultáneamente durante la migración.

## Extender

Implementar `EmbeddingProvider` en `providers/` y registrar en `providers/index.ts`.
