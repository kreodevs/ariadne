# Credentials — Credenciales cifradas en BD

Las credenciales (tokens Bitbucket/GitHub, app passwords, webhook secrets) se guardan cifradas en PostgreSQL con AES-256-GCM.

## Requisito

`CREDENTIALS_ENCRYPTION_KEY`: clave de 32 bytes (base64 o hex). Generar con:

```bash
openssl rand -base64 32
```

## API

- `GET /credentials?provider=bitbucket` — Lista credenciales (sin valor)
- `GET /credentials/:id` — Detalle (sin valor)
- `POST /credentials` — Crear: `{ provider, kind, value, name?, extra? }`
- `DELETE /credentials/:id` — Eliminar

## Tipos (kind)

- `token` — OAuth/PAT. Bitbucket API tokens requieren `extra.email` (Atlassian account email) para Basic auth
- `app_password` — Bitbucket App Password (`extra.username` requerido). Permisos: Account: Read, Workspace membership: Read, Repositories: Read (ver docs/manual/CONFIGURACION_Y_USO.md)
- `webhook_secret` — Secret para webhook Bitbucket (HMAC-SHA256)

## Uso en repos

Al crear un repo con `credentialsRef` (UUID de la credencial), el sync y el webhook usan esa credencial en lugar de las variables de entorno.
