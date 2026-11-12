# Hook git `post-commit` de Ariadne

Lo instala **`ariadne link`** (`npx ariadne link` o `node scripts/link.mjs`). No hay que copiarlo a mano.

Tras cada commit envía al ingest (`POST /repositories/local-sync/file`) los archivos añadidos, modificados, renombrados y borrados, con el mismo endpoint y filtro de extensiones que el daemon `live-watcher`. Cubre commits hechos fuera del IDE (agentes en terminal, `git commit` manual) y nunca bloquea el commit si el ingest no responde.

## Idempotencia

Re-ejecutar `ariadne link` es seguro. El bloque va entre los marcadores `# >>> ariadne post-commit >>>` y `# <<< ariadne post-commit <<<`:

| Situación | Resultado |
|---|---|
| No hay hook | Se crea (ejecutable) |
| Ya tiene el bloque, igual | No se escribe nada |
| Ya tiene el bloque, desactualizado | Se reemplaza solo el bloque |
| Hook ajeno de shell (Husky, lint…) | Se añade el bloque al final, sin tocar lo previo |
| Hook ajeno no shell (python, node…) | No se toca; aviso para añadirlo a mano |
| No es repo git | Se omite |

Respeta `core.hooksPath` y worktrees; con Husky v9 escribe en `.husky/post-commit`.

## Configuración

- `INGEST_URL` (o `ARIADNE_INGEST_URL`): si no está, usa `serverUrl` de `.ariadne/config.json`, y si no `http://localhost:3002`.
- `projectId`: se lee de `.ariadne-project` si existe.
- `ARIADNE_HOOK_DISABLE=1`: omite el hook.

## Código

La lógica vive en `services/mcp-ariadne/src/git-hook.ts`. `scripts/link.mjs` es un archivo **generado** (bundle de `src/cli.ts`); tras cambiar la fuente, `pnpm run build:link` y versiona el resultado (CI lo verifica).

## Limitaciones

- No reintenta ni usa el WAL: con el ingest caído ese commit queda sin sincronizar hasta el webhook de push.
- No cubre `git pull` ni `checkout`.
- Si un hook existente termina con `exit` antes del final, el bloque añadido no llega a ejecutarse.
