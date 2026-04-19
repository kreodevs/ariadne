# Kimi / Moonshot (ingest)

Utilidades compartidas para **Kimi Open Platform** (API HTTP compatible con OpenAI: `base_url` + `/v1/chat/completions`, `/v1/embeddings`).

- `moonshot-env.ts` — `moonshotBaseUrl()`, `moonshotApiKey()` (delega en `LLM_API_KEY` / Moonshot), `llmChatTemperature()` (`LLM_TEMPERATURE` / `KIMI_TEMPERATURE` legacy).

Usado por `chat/kimi-chat.adapter.ts` y `embedding/providers/kimi.provider.ts`.

Documentación: https://platform.kimi.ai/docs/api/overview
