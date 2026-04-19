# Kimi / Moonshot (ingest)

Utilidades compartidas para **Kimi Open Platform** (API HTTP compatible con OpenAI: `base_url` + `/v1/chat/completions`, `/v1/embeddings`).

- `moonshot-env.ts` — `moonshotBaseUrl()` (env `MOONSHOT_BASE_URL`, default `https://api.moonshot.ai/v1`), `moonshotApiKey()` (`MOONSHOT_API_KEY` o `KIMI_API_KEY`).

Usado por `chat/kimi-chat.adapter.ts` y `embedding/providers/kimi.provider.ts`.

Documentación: https://platform.kimi.ai/docs/api/overview
