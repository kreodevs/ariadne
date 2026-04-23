# Configuración del webhook de Bitbucket

Para que el microservicio de ingesta reciba actualizaciones incrementales al hacer push, configura un webhook en Bitbucket Cloud apuntando al servicio de ingesta.

**Permisos del App Password / Token:** La credencial usada para sync debe tener: **Account: Read**, **Workspace membership: Read**, **Repositories: Read**. Ver tabla de permisos en [CONFIGURACION_Y_USO.md](../manual/CONFIGURACION_Y_USO.md).

## Pasos

1. En Bitbucket: **Repository** → **Repository settings** → **Webhooks** (o **Workspace settings** → **Webhooks** para varios repos).
2. **Add webhook**:
   - **Title:** p. ej. "Ariadne Ingest"
   - **URL:** `https://<host>/webhooks/bitbucket`  
     En Docker, si el ingest está expuesto: `https://tu-dominio.com/webhooks/bitbucket` o, en pruebas, una URL pública (ngrok, etc.).
3. **Triggers:** marcar **Repository push**.
4. **Secret (recomendado):** En Bitbucket define un **secret**. El ingest lo obtiene por repositorio:
   - **Por repositorio:** Campo "Webhook secret" en el formulario de alta y edición del repo (frontend). Prioridad sobre el resto.
   - **Credencial en BD:** Crear credencial tipo `webhook_secret` en `/credentials/new` (fallback global).
   - **Variable de entorno:** `BITBUCKET_WEBHOOK_SECRET` (fallback).
   Valida el header `X-Hub-Signature` (HMAC-SHA256). Si hay secret y la firma no coincide, responde 401.

## Archivos cambiados por commit (ingesta incremental)

El ingest obtiene la lista de archivos modificados en un commit con `GET .../repositories/{workspace}/{repo_slug}/diff/{commit}`. Bitbucket Cloud devuelve el diff en **texto plano** (formato `diff --git a/path b/path`). Si en el futuro la API devolviera JSON, el servicio usa como fallback `GET .../diffstat/{commit}`, que devuelve una lista paginada de `{ new: { path }, old: { path } }` por archivo.

## Evento esperado

- **Event key:** `repo:push`
- El payload incluye `repository.full_name` (workspace/repo_slug) y `push.changes` con commits.
- El ingest busca un repositorio registrado con `provider=bitbucket`, `projectKey=workspace` y `repoSlug=repo_slug`; si existe, ejecuta la ingesta incremental solo para los archivos cambiados en esos commits.
- Si el repo tiene **`index_include_rules`** definido en PostgreSQL, los paths del diff se filtran con la misma lógica que el full sync (`index-include-rules.ts`), además de rutas ya presentes en `indexed_files` cuando aplica.

## Registro del repositorio

Antes de que el webhook tenga efecto, el repositorio debe estar registrado en el ingest:

```bash
curl -X POST http://localhost:3002/repositories \
  -H "Content-Type: application/json" \
  -d '{"provider":"bitbucket","projectKey":"TU_WORKSPACE","repoSlug":"nombre-repo","defaultBranch":"main","credentialsRef":"<uuid-opcional>"}'
```

Luego ejecuta un full sync una vez (o deja que el webhook solo haga incrementales si ya indexaste por otro medio):

```bash
curl -X POST http://localhost:3002/repositories/<id>/sync
```
