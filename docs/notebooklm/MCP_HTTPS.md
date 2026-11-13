# Llamadas HTTPS al MCP AriadneSpecs Oracle

Guía para **implementar llamadas HTTP/HTTPS** desde una aplicación al servidor MCP AriadneSpecs. El MCP usa el protocolo **Streamable HTTP** (JSON-RPC 2.0 sobre POST). Esta documentación describe el contrato que debe implementar el cliente.

**Importante (dos redes distintas):**

1. **Tu app → MCP** (`POST https://<host>/mcp`): en producción suele exigirse **`Authorization: Bearer`** (o `X-M2M-Token`) con el **Secret MCP** del usuario (`ari_…` desde Perfil) o un **JWT de sesión** válido; el proceso valida contra Ingest. En desarrollo, `MCP_HTTP_ALLOW_UNAUTHENTICATED=1` puede permitir peticiones sin Bearer (solo local).
2. **MCP → API Nest** (`ARIADNE_API_URL`, típ. `https://<host-api>` con prefijo `/api`): el proceso MCP **reenvía el mismo Bearer** de la petición (1) en `fetch` interno a `GET /api/graph/*`. **No** se usan `ARIADNE_API_BEARER` ni `ARIADNE_API_JWT` en el entorno para esto. Sin Bearer válido, herramientas como `get_component_graph` / `get_legacy_impact` pueden usar **fallback Falkor** (resultado puede no coincidir con el explorador). Ver [mcp_server_specs.md](mcp_server_specs.md) § API Nest vs Falkor.

---

## 1. Endpoint y método

| Propiedad | Valor |
| ------------ | ----------------------------------------------------------- |
| Método | `POST` |
| URL | `https://<host>/mcp` (ej. `https://ariadne.kreoint.mx/mcp`) |
| Content-Type | `application/json` |
| Accept | `application/json`, `text/event-stream` |

---

## 2. Formato de mensajes (JSON-RPC 2.0)

Todas las peticiones son mensajes JSON-RPC 2.0 en el body del POST:

```json
{
 "jsonrpc": "2.0",
 "id": 1,
 "method": "<método>",
 "params": { ... }
}
```

- `jsonrpc`: siempre `"2.0"`
- `id`: número o string único por petición (para correlacionar respuestas)
- `method`: nombre del método MCP
- `params`: parámetros según el método

---

## 3. Headers obligatorios

```
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2025-03-26
```

### 3.1 Auth del endpoint MCP (cliente → servidor)

En **producción** (sin `MCP_HTTP_ALLOW_UNAUTHENTICATED`), cada `POST …/mcp` debe llevar **`Authorization: Bearer`** con el **Secret MCP** (`ari_…`) del usuario desde Perfil, o el **JWT** de sesión web (alternativa equivalente: `X-M2M-Token`). El proceso valida ese valor vía ingest. En **desarrollo local**, algunos compose habilitan `MCP_HTTP_ALLOW_UNAUTHENTICATED` y permiten omitir el Bearer sobre `/mcp` (no expongas así en Internet).

### 3.2 API Nest (reenvío automático desde el proceso MCP)

El proceso MCP debe tener **`ARIADNE_API_URL`** (base URL Nest). Para `GET /api/graph/*` **no uses** variables **`ARIADNE_API_BEARER`** ni **`ARIADNE_API_JWT`**: el mismo Bearer del §3.1 se reenvía en `fetch`. El cliente HTTPS que documenta este archivo **solo** debe enviar esa cabecera en el POST a `/mcp`.

---

## 4. Flujo de inicialización (opcional)

Algunos clientes envían `initialize` antes de usar herramientas. El servidor AriadneSpecs es **stateless**: cada petición es independiente. Si tu aplicación solo llama `tools/list` y `tools/call`, puedes omitir la inicialización.

**Si quieres inicializar:**

### 4.1 Initialize (request)

```json
{
 "jsonrpc": "2.0",
 "id": 1,
 "method": "initialize",
 "params": {
 "protocolVersion": "2025-03-26",
 "capabilities": {},
 "clientInfo": {
 "name": "mi-aplicacion",
 "version": "1.0.0"
 }
 }
}
```

### 4.2 Respuesta del servidor

La respuesta incluirá `result` con `serverInfo`, `capabilities`, etc. El servidor puede devolver el header `Mcp-Session-Id`; si lo hace, inclúyelo en peticiones posteriores.

---

## 5. Listar herramientas (`tools/list`)

Obtener la lista de herramientas disponibles y sus esquemas.

### Request

```json
{
 "jsonrpc": "2.0",
 "id": 2,
 "method": "tools/list",
 "params": {}
}
```

### Response (ejemplo)

```json
{
 "jsonrpc": "2.0",
 "id": 2,
 "result": {
 "tools": [
 {
 "name": "list_known_projects",
 "description": "Lista los proyectos indexados...",
 "inputSchema": {
 "type": "object",
 "properties": {},
 "additionalProperties": false
 }
 },
 {
 "name": "get_legacy_impact",
 "description": "Dependientes del nodo; preferencia API Nest GET /api/graph/impact; fallback Falkor...",
 "inputSchema": {
 "type": "object",
 "properties": {
 "nodeName": { "type": "string", "description": "..." },
 "projectId": { "type": "string", "description": "..." },
 "currentFilePath": { "type": "string", "description": "..." }
 },
 "required": ["nodeName"],
 "additionalProperties": false
 }
 }
 ]
 }
}
```

---

## 6. Invocar herramienta (`tools/call`)

Ejecutar una herramienta con nombre y argumentos.

### Request

```json
{
 "jsonrpc": "2.0",
 "id": 3,
 "method": "tools/call",
 "params": {
 "name": "<nombre_herramienta>",
 "arguments": {
 "<param1>": "<valor1>",
 "<param2>": "<valor2>"
 }
 }
}
```

### Response (ejemplo)

```json
{
 "jsonrpc": "2.0",
 "id": 3,
 "result": {
 "content": [
 {
 "type": "text",
 "text": "Contenido en texto plano o Markdown devuelto por la herramienta."
 }
 ],
 "isError": false
 }
}
```

Si hay error en la ejecución de la herramienta:

```json
{
 "jsonrpc": "2.0",
 "id": 3,
 "result": {
 "content": [
 {
 "type": "text",
 "text": "[NOT_FOUND_IN_GRAPH] Nodo X no encontrado."
 }
 ],
 "isError": true
 }
}
```

---

## 7. Herramientas principales y argumentos

Los nombres de argumentos deben coincidir con el esquema devuelto por `tools/list` (ver [mcp_server_specs.md](mcp_server_specs.md) para descripción funcional).

**Grafo vía API Nest:** `get_component_graph` y `get_legacy_impact` intentan primero el API Nest (`GraphService`) si el proceso MCP tiene JWT hacia `ARIADNE_API_URL`; el Markdown indica fuente o fallback. No es configurable por cabecera desde el cliente HTTP del §1.

| Herramienta | Argumentos requeridos | Argumentos opcionales |
| ------------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `list_known_projects` | — | — |
| `get_legacy_impact` | `nodeName` | `projectId`, `currentFilePath` |
| `get_contract_specs` | `componentName` | `projectId`, `currentFilePath` |
| `get_component_graph` | `componentName` | `depth`, `projectId`, `currentFilePath` |
| `get_file_content` | `path` + (`projectId` **o** `currentFilePath`) | `ref` |
| `semantic_search` | `query`; con sharding también **`projectId`** | `limit`; **`projectId`** opcional sin sharding (acota al UUID proyecto o `roots[].id`). **No** admite `scope` ni `currentFilePath`. |
| `validate_before_edit` | `nodeName` | `projectId`, `currentFilePath` |
| `get_project_analysis` | — | `projectId`, `currentFilePath` (multi-root → `idePath` en ingest), `mode` (`diagnostico`, `duplicados`, `reingenieria`, `codigo_muerto`, `seguridad`) |
| `ask_codebase` | `question` | `projectId`, `currentFilePath`, `scope`, `twoPhase`, **`responseMode`** (`default` \| **`evidence_first`**) — ver [mcp_server_specs.md](mcp_server_specs.md). **`evidence_first`:** respuesta **JSON MDD** (7 secciones); orchestrator usa ingest `mdd-evidence` |
| `get_modification_plan` | `userDescription` | `projectId`, `currentFilePath`, `scope` |
| `get_definitions` | `symbolName` | `projectId`, `currentFilePath` |
| `get_references` | `symbolName` | `projectId`, `currentFilePath` |
| `get_implementation_details` | `symbolName` | `projectId`, `currentFilePath` |
| `get_functions_in_file` | `path` + (`projectId` **o** `currentFilePath`) | — |
| `get_import_graph` | `filePath` + (`projectId` **o** `currentFilePath`) | — |
| `trace_reachability` | `projectId` **o** `currentFilePath` | — (el `inputSchema` marca solo `projectId`; el runtime acepta inferencia por ruta) |
| `check_export_usage` | `projectId` **o** `currentFilePath` | `filePath` opcional |
| `get_affected_scopes` | `nodeName` | `projectId`, `currentFilePath`, `includeTestFiles` |
| `check_breaking_changes` | `nodeName` | `projectId`, `currentFilePath`, `removedParams` |
| `find_similar_implementations` | `query` | `projectId`, `currentFilePath`, `limit` — con sharding activo, ver §7.1 |
| `get_project_standards` | `projectId` **o** `currentFilePath` | — (idem discrepancia schema vs runtime) |
| `get_file_context` | `filePath` + (`projectId` **o** `currentFilePath`) | `ref` |
| `analyze_local_changes` | — | `projectId` o `currentFilePath`; `workspaceRoot` o `stagedDiff` |
| `get_sync_status` | — | `projectId`, `currentFilePath` — estado sync vía **ingest** `GET /projects/:id/sync-status` |
| `get_debt_report` | `projectId` | `currentFilePath` — heurística **Falkor** (nodos aislados); no sustituye `get_project_analysis` |
| `find_duplicates` | `projectId` | `currentFilePath` — duplicados por `contentHash` en grafo (nativo MCP) |

> **projectId:** ID de proyecto Ariadne o ID de repo (`roots[].id`). Ver [mcp_server_specs.md §2](mcp_server_specs.md) (proyecto vs repo).
>
> **Esquema estricto:** `tools/list` devuelve `inputSchema` con **`additionalProperties: false`** en las herramientas. Los argumentos extra que no aparezcan en ese esquema pueden hacer fallar clientes que validen el payload antes de `tools/call`. Parámetros soportados por el ingest pero **no** listados en `tools/list` sí requerirían coordinación; `responseMode` **sí** está declarado para `ask_codebase` en `services/mcp-ariadne`.

### 7.1 Sharding Falkor (`FALKOR_SHARD_BY_PROJECT`)

Si el servidor MCP corre con **partición por proyecto** en FalkorDB (un grafo lógico por `projectId`):

- **Recomendado:** pasar siempre **`projectId`** (o **`currentFilePath`** para inferencia) en herramientas que leen el grafo.
- Sin **`INGEST_URL`**, la inferencia solo desde ruta puede fallar si el grafo monolito por defecto está vacío.
- **`semantic_search`:** sin `projectId` en grafo **monolito** (sharding apagado), las consultas **no** filtran por proyecto: se mezclan nodos de todos los UUID presentes en el grafo (no es “el primer root” ni inferencia desde el IDE). Con sharding activo exige **`projectId`** explícito (no admite `currentFilePath` en el esquema ni en el handler). Para acotar por repos/prefijos vía `scope`, usar **`ask_codebase`**, no `semantic_search`.
- Con sharding activo no hay búsqueda multi-shard genérica: **`find_similar_implementations`** exige **`projectId`** o **`currentFilePath`** (inferencia con ingest/shards).
- **Origen de la configuración:** el MCP toma el sharding (`shardByProject`, `shardByDomain`, …) de **Ajustes del sistema** (UI) consultando `GET {INGEST_URL}/internal/system-settings` (caché de 15 s), igual que ingest y API; `FALKOR_SHARD_BY_PROJECT` en su entorno solo se usa como respaldo si el ingest no responde. Así no hace falta duplicar la variable en el servicio `mcp-ariadne`.
- Detalle técnico: el MCP abre el grafo con `graphNameForProject(projectId)`; si hace falta inferir el proyecto desde path con sharding, puede barrer candidatos obtenidos del ingest (`/projects`, `/repositories`).

La API REST Nest (`GET /api/graph/*`) acepta query **`projectId`** (y en algunos endpoints **`scopePath`**) para caché y selección de shard; el middleware exige **`Authorization: Bearer`** salvo rutas públicas (`/api/health`, OpenAPI, OTP). El MCP **reenvía** el Bearer que el cliente envió a `/mcp`.

---

## 8. Ejemplos de implementación

### fetch (JavaScript/TypeScript)

```typescript
const MCP_URL = "https://ariadne.kreoint.mx/mcp";
/** Mismo Bearer que en Cursor: Secret MCP (`ari_…`) o JWT tras login web. El MCP lo reenvía al Nest. */
const AUTHORIZATION_BEARER =
 process.env.USER_MCP_OR_SESSION_BEARER ?? "<paste-from-profile-or-session>";

async function callMcpTool(name: string, args: Record<string, unknown>) {
 const res = await fetch(MCP_URL, {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 Accept: "application/json, text/event-stream",
 "MCP-Protocol-Version": "2025-03-26",
 ...(AUTHORIZATION_BEARER && AUTHORIZATION_BEARER !== "<paste-from-profile-or-session>"
 ? { Authorization: `Bearer ${AUTHORIZATION_BEARER}` }
 : {}),
 },
 body: JSON.stringify({
 jsonrpc: "2.0",
 id: Date.now(),
 method: "tools/call",
 params: { name, arguments: args },
 }),
 });

 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 return res.json();
}

// Ejemplo: listar proyectos
const projects = await callMcpTool("list_known_projects", {});

// Ejemplo: impacto legacy
const impact = await callMcpTool("get_legacy_impact", {
 nodeName: "Header",
 projectId: "uuid-del-proyecto",
});
```

### curl

```bash
# Listar proyectos
curl -X POST https://ariadne.kreoint.mx/mcp \
 -H "Content-Type: application/json" \
 -H "Accept: application/json, text/event-stream" \
 -H "MCP-Protocol-Version: 2025-03-26" \
 -H "Authorization: Bearer <token>" \
 -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# Invocar get_legacy_impact
curl -X POST https://ariadne.kreoint.mx/mcp \
 -H "Content-Type: application/json" \
 -H "Accept: application/json, text/event-stream" \
 -H "MCP-Protocol-Version: 2025-03-26" \
 -H "Authorization: Bearer <token>" \
 -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_legacy_impact","arguments":{"nodeName":"Header","projectId":"uuid-proyecto"}}}'
```

---

## 9. Manejo de respuestas

- **Content-Type: application/json** — Respuesta con un único objeto JSON-RPC.
- **Content-Type: text/event-stream** — El servidor puede usar SSE en algunos casos; cada evento lleva un mensaje JSON-RPC. Tu cliente debe soportar ambos si el servidor los usa.

Para un cliente simple que solo hace POST y espera JSON, la mayoría de respuestas serán `application/json` con el resultado en `result.content[0].text`.

### Extraer texto de la respuesta

```typescript
function extractToolResult(response: {
 result?: { content?: Array<{ type: string; text: string }> };
}) {
 const content = response.result?.content ?? [];
 const text = content.find((c) => c.type === "text")?.text ?? "";
 return text;
}
```

---

## 10. Códigos HTTP

| Código | Significado |
| ------ | ------------------------------------------------------------------------- |
| 200 | OK — Respuesta JSON-RPC en body |
| 202 | Accepted — Notificación aceptada (sin body) |
| 400 | Bad Request — JSON malformado o método inválido |
| 401 | Unauthorized — Falta Bearer o token inválido en **`/mcp`** (validación ingest) salvo desarrollo con `MCP_HTTP_ALLOW_UNAUTHENTICATED`. Fallos contra el API Nest en tools suelen llegar como **200** con Markdown/aviso u otro contenido en `result`. |
| 404 | Not Found — Ruta incorrecta (verificar que sea `/mcp`) |
| 500 | Internal Server Error — Error del servidor |

---

## 11. Cómo obtener esquema BD, rutas API y variables de entorno

Estos datos **no están siempre en el grafo** (Prisma no se indexa; .env nunca). Desde un cliente **solo MCP HTTP**, usa `get_file_content`, búsqueda/acceso vía herramientas listadas en §7, o la API REST del despliegue; el nombre `execute_cypher` corresponde al retriever **interno** del chat del ingest, no a una tool de `tools/list`:

| Dato | Cómo obtener | ORM-agnóstico |
|------|--------------|---------------|
| **Tablas / esquema BD** | `get_file_content` con path fijo; o `semantic_search` / herramientas de grafo del MCP → paths → `get_file_content` (el tool `execute_cypher` es interno del **chat** del ingest, no del servidor MCP HTTP) | Sí |
| **Rutas API** | `semantic_search` o consultas vía herramientas del MCP; luego `get_file_content` en path (o API REST del despliegue si está expuesta) | Sí |
| **Variables de entorno** | `get_file_content` en `.env.example`, `env.example`, etc. | Sí |

**Flujo esquema BD (sin asumir Prisma/TypeORM):**

1. Probar `get_file_content("prisma/schema.prisma")` — si existe, Prisma.
2. Si falla: obtener paths de nodos `Model` vía `ask_codebase` (pregunta explícita por entidades / paths) o endpoint de grafo del backend si está publicado — no hay herramienta `execute_cypher` en el MCP.
3. Monorepo: `apps/api/prisma/schema.prisma`, `libs/db/prisma/schema.prisma`, `libs/*/entities/*.ts`.
4. Con cada path obtenido: `get_file_content(path)`.

**Rutas API:** `semantic_search` con términos del controlador, o `ask_codebase`, o consulta Cypher fuera del MCP (API interna / ingest).

**Env:** `get_file_content(".env.example")`; alternativas: `env.example`, `.env.sample`, `apps/*/.env.example`.

---

## 12. Volúmenes de salida (límites configurables)

El servidor MCP y el MDD del ingest usan **variables de entorno** con defaults altos para no truncar agresivamente listas y snippets. Clientes (UI, IDE, otros hosts MCP) pueden bajarlas si saturan contexto o Falkor. Ver:

- `services/mcp-ariadne/README.md` — prefijos **`MCP_*`** (`semantic_search`, `get_file_context`, `trace_reachability`, etc.).
- `services/ingest/src/chat/README.md` — prefijos **`MDD_*`** (JSON `evidence_first` / `mdd-evidence`).

## 13. Referencias

- [Especificación MCP — Herramientas](mcp_server_specs.md) — Lista completa, API Nest vs Falkor.
- [Transports — Streamable HTTP](https://modelcontextprotocol.io/docs/concepts/transports#streamable-http) — Protocolo oficial.
- [Monorepos y limitaciones](MONOREPO_Y_LIMITACIONES_INDEXADO.md) — Prisma, scope, path aliases.
