# Plan: Ariadne Multiusuario + RBAC + MCP Token

## Arquitectura actual

- **api** (NestJS, puerto 3000): auth OTP (JWT), grafo Falkor, proxy a ingest
- **ingest** (NestJS, puerto 3002): PostgreSQL (TypeORM), CRUD de todo lo demás
- **mcp-ariadne** (Hono/Node): herramientas MCP, auth con `MCP_AUTH_TOKEN` estático
- **frontend** (React+Vite): login OTP, no hay concepto de roles

## Cambios

### 1. DB – Nueva tabla `users` (en ingest)

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | uuid PK | |
| email | varchar(512) UNIQUE | |
| name | varchar(256) nullable | |
| role | varchar(32) default 'developer' | 'admin' \| 'developer' |
| mcp_token_hash | varchar(512) nullable | bcrypt hash del token MCP |
| mcp_token_plain | varchar(64) nullable | token en texto plano (mostrar 1 vez al crear) |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### 2. Ingest – Nuevos endpoints

**Internos (protegidos con INTERNAL_API_KEY):**
- `POST /internal/users/resolve` → find-or-create por email, devuelve `{ id, email, role, name }`

**Públicos (protegidos, admin-only):**
- `GET /users` → listar usuarios
- `GET /users/:id` → detalle usuario
- `PATCH /users/:id/role` → cambiar rol (admin only)
- `POST /users/:id/regenerate-mcp-token` → regenerar token MCP

**Públicos (autenticado):**
- `GET /users/me` → perfil propio
- `POST /users/me/regenerate-mcp-token` → regenerar mi propio token

### 3. API – Auth con roles

**AuthService** modifica:
- `verifyOtp()`: después de JWT válido, llama a `POST /internal/users/resolve` en ingest
- JWT payload ahora incluye: `{ sub: email, email, userId, role }`

**OtpMiddleware** modifica:
- Adjunta `req.user = { sub, email, userId, role }` desde JWT
- Nueva función: `requireRole('admin')` middleware para rutas sensibles

**Proxy a ingest** – bloqueo por rol:
- Developer NO puede: POST/PATCH/DELETE a `/credentials/*`
- Developer NO puede: POST a `/projects` (create)
- Developer NO puede: DELETE a `/projects/*`
- Developer NO puede: POST a `/repositories` (create)
- Developer NO puede: DELETE a `/repositories/*`
- Developer SÍ puede: GET a todo, POST sync/resync, POST chat, POST analyze, etc.

### 4. SSO (condicional)

Si `SSO_URL` está definida:
- `POST /auth/sso/login` recibe token SSO, valida contra `SSO_URL`
- El SSO devuelve: `{ email, name, role }`
- Se crea/actualiza usuario local
- Se emite JWT local como si fuera OTP
- La pantalla de gestión de usuarios se desactiva (todo se maneja vía SSO)

### 5. MCP – Token por usuario

- `mcp-ariadne` valida tokens contra `POST /internal/users/validate-mcp-token` en ingest
- El token MCP se usa como Bearer token o X-M2M-Token
- Se elimina `MCP_AUTH_TOKEN` estático (o se mantiene como fallback)
- El usuario ve su token MCP en `/profile` y puede regenerarlo

### 6. Frontend – Nuevas páginas

- **`/users`** — tabla de usuarios (admin only): email, nombre, rol, acciones
- **`/profile`** — perfil propio: email, rol, token MCP (con copiar y regenerar)
- **Sidebar**: los developers no ven "Credenciales", "Nuevo Repo", "Nuevo Proyecto"
- **Login**: si hay SSO_URL, muestra botón "Iniciar sesión con SSO"
- **ProtectedRoute**: ahora verifica también el rol (admin pages requieren admin)

## Orden de implementación

1. Migración BD + UserEntity + UsersModule (ingest)
2. Endpoints internos: resolve, validate-mcp-token (ingest)
3. AuthService + JWT con role (api)
4. RBAC middleware en proxy (api)
5. Endpoints públicos de usuarios (ingest)
6. Frontend: /users, /profile, sidebar condicional
7. MCP: validación por usuario
8. SSO integration
