# Llamadas HTTPS al MCP AriadneSpecs Oracle

Guía para **implementar llamadas HTTP/HTTPS** desde una aplicación al servidor MCP AriadneSpecs. El MCP usa el protocolo **Streamable HTTP** (JSON-RPC 2.0 sobre POST). Esta documentación describe el contrato que debe implementar el cliente.

---

## 1. Endpoint y método

| Propiedad    | Valor                                                       |
| ------------ | ----------------------------------------------------------- |
| Método       | `POST`                                                      |
| URL          | `https://<host>/mcp` (ej. `https://ariadne.kreoint.mx/mcp`) |
| Content-Type | `application/json`                                          |
| Accept       | `application/json`, `text/event-stream`                     |

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

Si el servidor tiene `MCP_AUTH_TOKEN` configurado:

```
Authorization: Bearer <token>
```

Alternativa de auth: `X-M2M-Token: <token>`

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
        "description": "Analiza qué componentes o funciones se verían afectados...",
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

| Herramienta             | Argumentos requeridos | Argumentos opcionales                                         |
| ----------------------- | --------------------- | ------------------------------------------------------------- |
| `list_known_projects`   | —                     | —                                                             |
| `get_legacy_impact`     | `nodeName`            | `projectId`, `currentFilePath`                                |
| `get_contract_specs`    | `componentName`       | `projectId`, `currentFilePath`                                |
| `get_component_graph`   | `componentName`       | `depth`, `projectId`, `currentFilePath`                       |
| `get_file_content`      | `path`                | `projectId`, `currentFilePath`, `ref`                         |
| `semantic_search`       | `query`               | `projectId`, `limit`                                          |
| `validate_before_edit`  | `nodeName`            | `projectId`, `currentFilePath`                                |
| `get_project_analysis`  | `projectId`           | `mode` (diagnostico, duplicados, reingenieria, codigo_muerto, seguridad) |
| `ask_codebase`          | `question`            | `projectId`, `currentFilePath`, `scope`, `twoPhase`           |
| `get_modification_plan` | `userDescription`     | `projectId`, `currentFilePath`, `scope`                       |
| `get_definitions`       | `symbol`              | `projectId`, `currentFilePath`                                |
| `get_references`        | `symbol`              | `projectId`, `currentFilePath`                                |
| `get_functions_in_file` | `path`                | `projectId`, `currentFilePath`                                |
| `get_import_graph`      | `filePath`            | `projectId`, `currentFilePath`                                |

> **projectId:** ID de proyecto o de repo. Obtener con `list_known_projects`; el campo `id` del proyecto o `roots[].id` de cada repo.

---

## 8. Ejemplos de implementación

### fetch (JavaScript/TypeScript)

```typescript
const MCP_URL = "https://ariadne.kreoint.mx/mcp";
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN; // opcional

async function callMcpTool(name: string, args: Record<string, unknown>) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-03-26",
      ...(AUTH_TOKEN && { Authorization: `Bearer ${AUTH_TOKEN}` }),
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

| Código | Significado                                                               |
| ------ | ------------------------------------------------------------------------- |
| 200    | OK — Respuesta JSON-RPC en body                                           |
| 202    | Accepted — Notificación aceptada (sin body)                               |
| 400    | Bad Request — JSON malformado o método inválido                           |
| 401    | Unauthorized — Falta o token incorrecto (si MCP_AUTH_TOKEN está definido) |
| 404    | Not Found — Ruta incorrecta (verificar que sea `/mcp`)                    |
| 500    | Internal Server Error — Error del servidor                                |

---

## 11. Cómo obtener esquema BD, rutas API y variables de entorno

Estos datos **no están siempre en el grafo** (Prisma no se indexa; .env nunca). La app debe usar rutas convencionales o `execute_cypher` + `get_file_content`:

| Dato | Cómo obtener | ORM-agnóstico |
|------|--------------|---------------|
| **Tablas / esquema BD** | `get_file_content` con path fijo; o `execute_cypher` → `get_file_content` | Sí |
| **Rutas API** | `execute_cypher` NestController/Route; luego `get_file_content` en path | Sí |
| **Variables de entorno** | `get_file_content` en `.env.example`, `env.example`, etc. | Sí |

**Flujo esquema BD (sin asumir Prisma/TypeORM):**

1. Probar `get_file_content("prisma/schema.prisma")` — si existe, Prisma.
2. Si falla: `execute_cypher` con `MATCH (m:Model) RETURN m.path` — TypeORM/entities.
3. Monorepo: `apps/api/prisma/schema.prisma`, `libs/db/prisma/schema.prisma`, `libs/*/entities/*.ts`.
4. Con cada path obtenido: `get_file_content(path)`.

**Rutas API:** `execute_cypher` con `MATCH (nc:NestController) RETURN nc.path, nc.name` (o `Route` para frontend).

**Env:** `get_file_content(".env.example")`; alternativas: `env.example`, `.env.sample`, `apps/*/.env.example`.

---

## 12. Referencias

- [Especificación MCP — Herramientas](mcp_server_specs.md) — Lista completa de herramientas y descripción.
- [Transports — Streamable HTTP](https://modelcontextprotocol.io/docs/concepts/transports#streamable-http) — Protocolo oficial.
- [Monorepos y limitaciones](MONOREPO_Y_LIMITACIONES_INDEXADO.md) — Prisma, scope, path aliases.
