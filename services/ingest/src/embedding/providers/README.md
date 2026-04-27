# Proveedores de embedding

Solo **OpenRouter** (`/v1/embeddings`, API compatible OpenAI). Configuración: `OPENROUTER_API_KEY`, `OPENROUTER_EMBEDDING_MODEL` (default `openai/text-embedding-3-small`), `OPENAI_EMBEDDING_DIM` (default 1536). Ver `../llm/llm-config.ts` y `openrouter.provider.ts`.

`EMBEDDING_PROVIDER=openrouter` (o `openai` como alias) en el entorno.
