# Instalación del MCP FalkorSpecs para Cursor — Mantenimiento de Ariadne

Documento de instalación y configuración del servidor MCP FalkorSpecs Oracle para dar mantenimiento al proyecto **Ariadne** con **Cursor** u otros IDEs compatibles con MCP.

**Deployment:** Frontend [ariadne.kreoint.mx](https://ariadne.kreoint.mx) | Backend [apiariadne.kreoint.mx](https://apiariadne.kreoint.mx)

---

## 1. Resumen

El MCP FalkorSpecs expone herramientas que permiten a la IA (Cursor, Antigravity, etc.) consultar el grafo de FalkorDB **antes** de modificar código legacy, reduciendo alucinaciones y rupturas. Incluye:

- **list_known_projects** — Al inicio: mapear IDs. Respuesta `[{ id, name, roots: [{ id, name, branch? }] }]` (id = proyecto; roots[].id = repo). Para **`get_modification_plan`** con varios repos, pasa `projectId` = `roots[].id` del repo objetivo; en el resto de herramientas suele bastar proyecto o repo según el endpoint (file/chat).
- **validate_before_edit** — Obligatorio antes de editar: impacto + contrato + endpoints de funciones.
- **get_legacy_impact**, **get_contract_specs** — Impacto y props reales.
- **get_file_content** — Contenido de archivos desde el repo o proyecto indexado.
- **get_modification_plan** — `filesToModify` (path + repoId) y `questionsToRefine`; `POST /projects/:projectId/modification-plan` con UUID de proyecto **o** de repositorio (`roots[].id` recomendado en multi-root).
- **semantic_search**, **get_project_analysis** — Búsqueda y diagnósticos (`get_project_analysis` → `POST /repositories/:id/analyze`: **`roots[].id`** del repo a analizar).

---

## 2. Requisitos

- **Node.js** >= 20
- **Cursor** (o IDE con soporte MCP)
- **Conexión** a FalkorDB y al servicio Ingest (ver sección 3)

---

## 3. Escenarios de conexión

### Escenario A: Desarrollo local (recomendado para mantenimiento del propio Ariadne)

Infraestructura y servicios corriendo en tu máquina. El MCP usa **Streamable HTTP** (puerto 8080).

| Variable       | Valor                |
|----------------|----------------------|
| FALKORDB_HOST  | `localhost`          |
| FALKORDB_PORT  | `6379`               |
| INGEST_URL     | `http://localhost:3002` |
| PORT           | `8080` (default)     |

**Previo:**
```bash
pnpm run dev:infra      # FalkorDB, Postgres, Redis
pnpm run dev:ingest     # Ingest (puerto 3002)
pnpm -C services/mcp-falkorspec build
PORT=8080 node services/mcp-falkorspec/dist/index.js   # MCP en segundo plano
```

---

### Escenario B: Producción por URL (sin túnel)

Si Ariadne está en Dokploy con MCP en Streamable HTTP (puerto 8080):

| Variable       | Valor                              |
|----------------|------------------------------------|
| URL            | `https://ariadne.kreoint.mx/mcp`       |

Cursor se conecta directamente por URL. Si el servidor tiene `MCP_AUTH_TOKEN` definido, incluir `Authorization: Bearer <token>` en la config (ver Paso 4).

### Escenario C: Producción con MCP local + túnel SSH

Conectarse al backend con MCP corriendo localmente (HTTP en 8080) y túnel:

| Variable       | Valor                              |
|----------------|------------------------------------|
| FALKORDB_HOST  | `localhost` (vía túnel)            |
| FALKORDB_PORT  | `6379`                             |
| INGEST_URL     | `https://apiariadne.kreoint.mx`          |

**Previo:** `ssh -L 6379:127.0.0.1:6379 usuario@apiariadne.kreoint.mx` (y exponer FalkorDB en el host).

### Escenario D: Dokploy + túnel SSH (alternativa a B)

Cuando Ariadne está en Docker bajo **Dokploy** y usas MCP local (no la URL), FalkorDB vive dentro de un contenedor. Para que el túnel SSH funcione:

#### 1. Exponer FalkorDB en el host (obligatorio)

En Dokploy, edita la aplicación Ariadne → servicio **falkordb** → añade *Port publishing*:

- **Host port:** 6379
- **Container port:** 6379

O en el compose de Dokploy:

```yaml
falkordb:
  # ...
  ports:
    - "127.0.0.1:6379:6379"
```

`127.0.0.1` limita el puerto al host; solo accesible vía túnel SSH.

#### 2. Crear túnel SSH

```bash
ssh -L 6379:127.0.0.1:6379 usuario@HOST_RELIC
```

- Reemplaza `HOST_RELIC` por la IP o dominio del servidor (ej. `apiariadne.kreoint.mx`).
- Mantén la sesión abierta mientras uses el MCP.
- Opcional: `-f -N` para dejarlo en segundo plano.

#### 3. Dar de alta usuarios para el túnel

Cada usuario debe poder hacer SSH al servidor. En el host (acceso root/admin):

```bash
# Crear usuario
sudo adduser dev-mcp
# O sin shell interactivo: sudo useradd -m -s /usr/bin/bash dev-mcp

# Configurar autenticación por clave (recomendado)
su - dev-mcp
mkdir -p ~/.ssh
chmod 700 ~/.ssh
```

El usuario genera su clave local:

```bash
ssh-keygen -t ed25519 -C "dev-mcp@ariadne"
```

Envía la clave pública. En el servidor:

```bash
# Como dev-mcp o root
echo "ssh-ed25519 AAAAC3... dev-mcp@ariadne" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

O desde el admin:

```bash
sudo -u dev-mcp bash -c 'echo "ssh-ed25519 AAAAC3... tu-clave" >> /home/dev-mcp/.ssh/authorized_keys'
```

**Probar conexión:**

```bash
ssh dev-mcp@HOST_RELIC
# Si entra, el túnel funcionará:
ssh -L 6379:127.0.0.1:6379 dev-mcp@HOST_RELIC
```

#### 4. Configuración MCP con túnel

Con el túnel activo, inicia el MCP localmente (en otra terminal):

```bash
cd ariadne
FALKORDB_HOST=localhost FALKORDB_PORT=6379 INGEST_URL=https://apiariadne.kreoint.mx PORT=8080 node services/mcp-falkorspec/dist/index.js
```

Luego en Cursor usa la URL local:

```json
{
  "mcpServers": {
    "falkorspecs": {
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

---

## 4. Instalación en Cursor

### Paso 1: Clonar el repositorio

```bash
git clone <url-del-repo-ariadne> ariadne
cd ariadne
```

### Paso 2: Instalar dependencias y compilar el MCP

```bash
pnpm install
pnpm -C services/mcp-falkorspec install
pnpm -C services/mcp-falkorspec build
```

### Paso 3: Configurar el MCP en Cursor

1. Abrir **Cursor** y abrir la carpeta `ariadne` como workspace.
2. Ir a **Settings** (Cmd/Ctrl + ,) → **Cursor Settings** → **MCP**.
3. Editar el archivo de configuración MCP (o crearlo si no existe).

En macOS/Linux suele estar en:
```
~/.cursor/mcp.json
```

En Windows:
```
%APPDATA%\Cursor\mcp.json
```

### Paso 4: Añadir el servidor FalkorSpecs

Añadir esta entrada al JSON de MCP:

**Desarrollo local (Escenario A):**

Previo: arrancar el MCP en tu máquina (`PORT=8080 node dist/index.js` con FALKORDB_HOST, INGEST_URL). Luego:

```json
{
  "mcpServers": {
    "falkorspecs": {
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

**Producción por URL (Escenario B, sin túnel):**
```json
{
  "mcpServers": {
    "falkorspecs": {
      "url": "https://ariadne.kreoint.mx/mcp"
    }
  }
}
```

**Producción con auth M2M** (si el servidor define `MCP_AUTH_TOKEN`):
```json
{
  "mcpServers": {
    "falkorspecs": {
      "url": "https://ariadne.kreoint.mx/mcp",
      "headers": {
        "Authorization": "Bearer <tu-token-m2m>"
      }
    }
  }
}
```

**Producción con MCP local + túnel (Escenario C, D):**

Previo: túnel SSH activo + arrancar el MCP con `FALKORDB_HOST=localhost`, `INGEST_URL=https://apiariadne.kreoint.mx`. Luego:

```json
{
  "mcpServers": {
    "falkorspecs": {
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

> **Importante:** En desarrollo local y con túnel, el MCP debe estar corriendo antes de usar Cursor. En producción por URL, no hace falta arrancar nada localmente.

### Paso 5: Reiniciar Cursor

Cerrar y volver a abrir Cursor (o recargar la ventana) para que cargue el MCP.

### Paso 6: Verificar

En el chat de Cursor, al pedir algo como:
- "Lista los proyectos indexados en FalkorSpecs"
- "¿Qué impacto tiene modificar el componente X?"

La IA debería poder invocar las herramientas del MCP. Si aparecen errores de conexión, revisar [Troubleshooting](#8-troubleshooting).

---

## 5. Herramientas disponibles

| Herramienta            | Uso típico                                                                 |
|------------------------|----------------------------------------------------------------------------|
| `list_known_projects`  | Al inicio: mapear IDs. Respuesta `[{ id, name, roots: [{ id, name, branch? }] }]` (id = proyecto; roots[].id = repo) |
| `validate_before_edit` | **OBLIGATORIO** antes de editar componente o función                       |
| `get_legacy_impact`     | Ver qué se rompe si modificas un nodo                                      |
| `get_contract_specs`   | Props reales de un componente                                              |
| `get_component_graph`  | Árbol de dependencias de un componente                                     |
| `get_functions_in_file`| Funciones y componentes en un archivo                                      |
| `get_import_graph`     | Imports y contenido estructural de un archivo                              |
| `get_file_content`     | Contenido de un archivo (repo o proyecto; requiere INGEST_URL)            |
| `ask_codebase`         | Preguntas NL; usa projects/chat o repositories/chat según ID              |
| `get_modification_plan`| Plan quirúrgico; `projectId` = proyecto o `roots[].id` del repo (multi-root) |
| `semantic_search`      | Búsqueda en componentes, funciones y archivos                             |
| `get_project_analysis` | Diagnóstico, duplicados, reingeniería, código muerto (id = repo)           |

---

## 6. Protocolo de uso (AGENTS.md)

Al trabajar en código legacy indexado, seguir el flujo SDD:

1. **Ejecutar `list_known_projects`** al inicio (proyecto = `id`; repos = `roots[].id`). Para **`get_modification_plan`** con multi-root, usa el `roots[].id` del repo donde está el código; para otras herramientas, proyecto o repo según corresponda.
2. **Antes de editar:** Ejecutar `validate_before_edit` con el `nodeName`.
3. Si devuelve **"Nodo no encontrado"**: no proceder; verificar nombre o reindexar.
4. Para **componentes**: usar las props del contrato. Para **funciones**: usar path, descripción y endpoints que devuelve.
5. No inventar props ni firmas; usar solo lo que devuelve el grafo.
6. Código actual: `get_file_content` con el path.

La regla `.cursor/rules/legacy-sdd-validation.mdc` refuerza este protocolo en archivos `*.ts`, `*.tsx`, `*.js`, `*.jsx`.

---

## 7. Variables de entorno del MCP

El MCP usa **Streamable HTTP** en todas las configuraciones (puerto 8080, path /mcp).

| Variable        | Descripción                               | Default        |
|-----------------|-------------------------------------------|----------------|
| PORT            | Puerto del servidor HTTP                   | `8080`         |
| MCP_HTTP_PORT   | Alias de PORT (legacy)                     | = PORT         |
| FALKORDB_HOST   | Host de FalkorDB                           | `localhost`    |
| FALKORDB_PORT   | Puerto de FalkorDB                         | `6379`         |
| INGEST_URL      | URL base del Ingest (get_file_content, etc.) | —           |
| FALKORSPEC_INGEST_URL | Alias de INGEST_URL                    | = INGEST_URL   |
| MCP_AUTH_TOKEN  | Legacy: comparación estática Bearer (si SSO no configurado) | — |
| SSO_API_URL     | Para validar M2M: URL base del API SSO (ej. `https://apisso.grupowib.com.mx/api/v1`). Si vacío, se infiere de SSO_JWKS_URI. | — |
| APPLICATION_ID  | UUID de la app para `X-Application-Id` al validar con SSO | — |

---

## 7.1. SSO (opcional)

Ariadne puede integrarse con el SSO de apisso.grupowib.com.mx mediante flujo de redirección.

**Frontend** (variables en `.env`):

| Variable                  | Descripción                    | Ejemplo                           |
|---------------------------|--------------------------------|-----------------------------------|
| VITE_SSO_APPLICATION_ID    | UUID de la app en el SSO       | `550e8400-e29b-41d4-a716-446655440000` |
| VITE_SSO_BASE_URL          | URL base del API SSO (opcional)| `https://apisso.grupowib.com.mx/api/v1` |
| VITE_SSO_FRONTEND_URL      | URL del frontend SSO (opcional)| `https://sso.grupowib.com.mx`     |

Si no defines `VITE_SSO_APPLICATION_ID`, la app funciona sin autenticación.

**API** (variables en el entorno del servicio):

| Variable            | Descripción                          |
|---------------------|--------------------------------------|
| SSO_APPLICATION_ID   | Mismo UUID que el frontend           |
| SSO_JWKS_URI         | URL del JWKS (default: `https://apisso.grupowib.com.mx/api/v1/auth/jwks`) |

Si no defines `SSO_APPLICATION_ID` y `SSO_JWKS_URI`, la API no exige auth. Las rutas `/api/health` y `/api/openapi.json` quedan siempre públicas.

**Rol requerido (usuarios):** Solo se permite acceso con rol `admin` en la aplicación. El usuario debe tener `admin` en el array `roles` de su asignación a esta app (o ser `isSystemAdmin`).

**MCP con SSO (M2M):** El MCP valida tokens llamando al SSO. Variables en el servidor MCP:

```env
SSO_API_URL=https://apisso.grupowib.com.mx/api/v1
APPLICATION_ID=uuid-de-la-aplicacion
```

El MCP acepta el token en `X-M2M-Token` o `Authorization: Bearer m2m_xxx`, lo reenvía a `GET {SSO_API_URL}/auth/validate` con `X-Application-Id`, y autoriza si el SSO responde `{ valid: true }` (M2M no requiere rol). Cursor debe enviar el token M2M (creado en el panel del SSO) en cada petición. APPLICATION_ID puede ser SSO_APPLICATION_ID si coincide con la API.

---

## 8. Troubleshooting

| Síntoma | Causa probable | Solución |
|---------|-----------------|----------|
| "Connection refused" al usar herramientas | FalkorDB no levantado o inaccesible | Levantar `pnpm run dev:infra` o comprobar túnel SSH |
| "Nodo X no encontrado" | El nodo no existe en el grafo | Reindexar: `POST /repositories/:id/resync` (desde repo) o desde la UI del proyecto "Resync (proyecto)" (`resync-for-project`) |
| get_file_content falla | INGEST_URL no configurada o incorrecta | Definir INGEST_URL en env del MCP |
| Las herramientas no aparecen en Cursor | MCP no cargado | Verificar ruta en args, reiniciar Cursor |
| projectId desconocido | No se ha llamado list_known_projects | Ejecutar list_known_projects al inicio |

---

## 9. Referencias

- [AGENTS.md](../AGENTS.md) — Protocolo para agentes.
- [Manual de uso](manual/README.md) — Puesta en marcha general.
- [Especificación MCP](mcp_server_specs.md) — Detalle de herramientas.
- [Esquema DB](db_schema.md) — Nodos y relaciones del grafo.
