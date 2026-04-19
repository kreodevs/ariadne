# Uso del MCP de Ariadne desde código (HTTP/JSON-RPC)

Guía para aplicaciones que invocan el MCP FalkorSpecs **desde código** (backend, scripts, integraciones), no desde un IDE como Cursor. Transporte HTTP, autenticación y formato de las peticiones.

**Referencia de uso real:** MaxPrime (y otras aplicaciones) llama al MCP así para listar proyectos, obtener planes de modificación y preguntar sobre el codebase.

---

## 1. Transporte y autenticación

- **No se usa MCP por stdio.** Las aplicaciones llaman al MCP por **HTTP**.
- **URL:** Un único endpoint (ej. `https://ariadne.kreoint.mx/mcp`). Configurable en la aplicación (ej. variable `ARIADNE_MCP_URL`). Si está vacía, la aplicación puede considerar Ariadne no configurado y no enviar peticiones.
- **Método:** `POST`.
- **Auth:** Header `Authorization: Bearer <token>`. El token (M2M o el que exija el servidor) se configura en la aplicación (ej. `RELIC_M2M_TOKEN`). Si falta, no se envía header y el servidor puede rechazar (401).
- **Headers:** `Content-Type: application/json`. Opcional: `Accept: application/json, text/event-stream` si el MCP puede devolver SSE.

Cada petición es **JSON-RPC 2.0** con `method: "tools/call"` y `params: { name: "<tool_name>", arguments: { ... } }`.

---

## 2. Formato de la petición (JSON-RPC)

Todas las llamadas tienen esta forma:

```json
{
  "jsonrpc": "2.0",
  "id": "<id-unico-por-llamada>",
  "method": "tools/call",
  "params": {
    "name": "<nombre_de_la_herramienta_mcp>",
    "arguments": {
      "<arg1>": "<valor1>",
      "<arg2>": "<valor2>"
    }
  }
}
```

Se envía con `POST` a la URL del MCP; el body es el JSON anterior.

---

## 3. Herramientas típicas desde código

### 3.1 `list_known_projects`

- **Uso:** Al cargar una UI para elegir con qué proyecto Ariadne vincular (ej. crear/editar un proyecto legacy). Lista proyectos indexados con sus IDs y roots.
- **Argumentos:** `{}` (ninguno).

**Petición de ejemplo:**

```json
{
  "jsonrpc": "2.0",
  "id": "list-projects-1",
  "method": "tools/call",
  "params": {
    "name": "list_known_projects",
    "arguments": {}
  }
}
```

**Respuesta esperada:** En `result.content[]` un elemento con `type: "text"` y `text` conteniendo un **array JSON**. Formato multi-root (SPEC-MCP-001): `[{ id, name, roots: [{ id, name?, branch? }] }]`. También se acepta formato legacy `{ id, name, rootPath?, branch? }` y normalizarlo en cliente. Si el MCP devuelve el array dentro de un bloque markdown ` ```json ... ``` `, extraer y parsear. Soportar tanto JSON directo como SSE con líneas `data: {...}`.

---

### 3.2 `get_modification_plan`

- **Uso:** Flujo de cambio legacy: descripción del cambio + `projectId`. El ingest acepta UUID de **proyecto Ariadne** o **`roots[].id` del repositorio**; en multi-root conviene el del repo donde está el código.
- **Argumentos:**
  - `userDescription` (string): descripción en lenguaje natural del cambio.
  - `projectId` (string): id de proyecto Ariadne **o** id de repo (`roots[].id`).

**Petición de ejemplo:**

```json
{
  "jsonrpc": "2.0",
  "id": "get-modification-plan-1",
  "method": "tools/call",
  "params": {
    "name": "get_modification_plan",
    "arguments": {
      "userDescription": "Añadir descuento máximo a nivel campaña en CampDetail...",
      "projectId": "uuid-proyecto-ariadne-o-roots-id-repo"
    }
  }
}
```

**Respuesta esperada:** En `result.content[].text` un JSON (directo o dentro de ` ```json ... ``` `) con:

- **`filesToModify`:** array de objetos `{ path: string, repoId: string }` (multi-repo). Cada archivo incluye su `repoId` (root). Formato legacy: `string[]` de paths; el cliente puede convertirlo a `{ path, repoId: "" }`.
- **`questionsToRefine`:** array de strings (preguntas de negocio/funcionalidad únicamente).

Si la herramienta no existe o falla, la aplicación puede hacer **fallback** con `ask_codebase` pidiendo el mismo JSON; en ese caso los paths pueden guardarse con `repoId: projectId`.

---

### 3.2.1 `get_project_analysis` (análisis estructurado)

- **Ingest:** Si el UUID es **repositorio** → `POST /repositories/:id/analyze` con `{ mode }`. Si es **proyecto** Ariadne → `POST /projects/:id/analyze` con `{ mode, idePath?, repositoryId? }` (multi-root: hace falta `idePath` o `repositoryId` cuando hay varios roots).
- **Argumentos MCP:** `projectId?` (proyecto o **`roots[].id`**), `currentFilePath?` (multi-root: se envía como `idePath`), `mode`: `diagnostico` | `duplicados` | `reingenieria` | `codigo_muerto` | `seguridad`.

---

### 3.3 `ask_codebase`

- **Uso:** Preguntas en lenguaje natural sobre el codebase indexado (flujo legacy: listar qué existe, contexto para MDD/Workshop). Con **`responseMode: evidence_first`** la respuesta es **JSON MDD** (7 claves: `summary`, `openapi_spec`, `entities`, `api_contracts`, `business_logic`, `infrastructure`, `risk_report`, `evidence_paths`) para **LegacyCoordinator** / The Forge; el backend puede devolver también `mddDocument` en la API HTTP del ingest/orchestrator.
- **Argumentos:**
  - `question` (string): pregunta en lenguaje natural.
  - `projectId` (string): id del proyecto en Ariadne (o id de repo; el MCP resuelve).
  - Opcional: `scope`, `twoPhase`, **`responseMode`** (`default` \| `evidence_first`).

**Petición de ejemplo:**

```json
{
  "jsonrpc": "2.0",
  "id": "ask-codebase-1",
  "method": "tools/call",
  "params": {
    "name": "ask_codebase",
    "arguments": {
      "question": "For this change: \"...\". List what ALREADY EXISTS in the codebase: data models/entities...",
      "projectId": "uuid-proyecto-ariadne-o-roots-id-repo",
      "responseMode": "evidence_first"
    }
  }
}
```

**Respuesta esperada:** En `result.content[].text`: con **`evidence_first`**, **JSON MDD** parseable; con **`default`**, prosa. Parsear `text` como JSON si empieza por `{`.

---

### 3.4 Otras herramientas útiles desde código

| Herramienta | Argumentos | Uso típico |
|-------------|------------|------------|
| **get_file_content** | `path`, `projectId`, `ref?` | Contenido de archivos a modificar para inyectar contexto en prompts (ej. al generar MDD). |
| **get_legacy_impact** | `nodeName`, `projectId` | Impacto al modificar un componente/función; añadir al contexto Ariadne. |
| **get_contract_specs** | `componentName`, `projectId?` | Props reales de un componente (refactor seguro). |
| **get_component_graph** | `componentName`, `projectId`, `depth?` (default 2) | Árbol de dependencias de un componente. |
| **get_project_analysis** | `projectId?`, `currentFilePath?`, `mode` | Informes por modo (incl. `seguridad`); `projectId` puede ser proyecto o `roots[].id`; multi-root → `currentFilePath` o repo explícito. |

Todas usan el mismo transporte JSON-RPC y el mismo parseo de `result.content[].text`.

---

## 4. Cómo parsear la respuesta del MCP

- Si el body de la respuesta HTTP empieza por `{`, tratarlo como JSON directo y parsearlo.
- Si no, buscar líneas que empiecen por `data:` y cuyo contenido empiece por `{`; parsear ese JSON (soporte SSE).
- Del objeto parseado:
  - **`result.content`:** array de objetos con `type` y `text`. Buscar el elemento con `type === "text"` y usar su `text`.
  - Si hay **`error`**, no usar `result`; registrar el error y devolver null/array vacío/string vacío según el caso.
- Si el `text` contiene un bloque markdown ` ```json ... ``` `, extraer el contenido del bloque y parsearlo como JSON. Si el `text` ya es JSON (empieza por `[` o `{`), parsearlo directamente.

---

## 5. Resumen de contrato para aplicaciones

| Qué expone Ariadne | Detalle |
|------------------|---------|
| **Endpoint** | Un único URL (ej. `https://ariadne.kreoint.mx/mcp`) que acepta POST con JSON-RPC 2.0, `method: "tools/call"`. |
| **Auth** | Bearer token en header; la aplicación lo envía desde su configuración (ej. `RELIC_M2M_TOKEN`). |
| **Herramientas usadas desde código** | `list_known_projects` (multi-root: `roots[]`), `get_modification_plan` (path + repoId), `ask_codebase`, `get_file_content`, `get_legacy_impact`; opcionales `get_contract_specs`, `get_component_graph`. |
| **Contrato de `get_modification_plan`** | SPEC-MCP-001: `filesToModify`: array de `{ path, repoId }`; `questionsToRefine`: solo preguntas de negocio. Se acepta también `filesToModify: string[]` legacy. |
| **Estado** | El MCP no mantiene estado por cliente; cada petición es independiente (idempotente desde el punto de vista de la aplicación). |
| **Respuesta** | JSON-RPC `result.content[]` con al menos un item `type: "text"` y `text` con el payload (array de proyectos, JSON con filesToModify/questionsToRefine, o texto libre). |

---

## 6. Referencias

- [mcp_server_specs.md](/mcp_server_specs.md) — Especificación completa del MCP (proyecto vs repo, herramientas, ingest).
- [ayuda-mcp.md](ayuda-mcp.md) — Uso del MCP desde el IDE (Cursor) y configuración.
