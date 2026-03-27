**ID:** SPEC-MCP-001

**Protocolo:** Model Context Protocol (MCP)

**Origen de Datos:** FalkorDB (via Oracle/AriadneSpecs Core)

## 1. Arquitectura del Servidor MCP

El servidor MCP actuará como un **Servicio de Contexto**. No solo leerá datos, sino que aplicará la lógica de "Oráculo" para filtrar lo que la IA recibe.

- **Runtime:** Node.js (TypeScript).
- **SDK:** `@modelcontextprotocol/sdk`.
- **Transporte:** Stdio (para uso local en Cursor/IDE) o HTTP (para uso corporativo remoto).

---

## 2. Definición de Herramientas (Tools)

Estas son las funciones que la IA podrá "invocar" para entender tu código legacy sin alucinar.

### Proyecto vs repo (contexto para `projectId`)

- **Proyecto (Ariadne):** entidad multi-repo con su propio UUID. En `list_known_projects` es el campo `id` de cada elemento. Las herramientas que hablan con el ingest pueden recibir este ID (p. ej. chat por proyecto, file por proyecto).
- **Repo (root):** un repositorio indexado; tiene su propio UUID. En `list_known_projects` cada `roots[].id` es un repo id. Un repo puede estar en varios proyectos (muchos a muchos) o ser standalone (sin proyecto).
- **Uso de `projectId` en herramientas:** puede ser **ID de proyecto** o **ID de repo**. El MCP resuelve automáticamente: para contenido de archivo intenta `GET /repositories/:id/file` y si 404 `GET /projects/:id/file`; para chat intenta `POST /projects/:id/chat` y si 404 `POST /repositories/:id/chat`. Así funciona tanto con el `id` del proyecto como con un `roots[].id`.
- **Grafo Falkor (indexación):** los nodos llevan la propiedad `projectId` del índice usado en sync (proyecto o repo standalone). Para consultas MCP/API debe usarse el mismo UUID que en `.ariadne-project` o el que devuelve `list_known_projects`.

### Sharding Falkor (`FALKOR_SHARD_BY_PROJECT`)

Cuando el ingest/API despliegan **un grafo Redis/Falkor por `projectId`** (`AriadneSpecs:<uuid>` en lugar de un solo `AriadneSpecs`):

- El **MCP** selecciona el grafo con `graphNameForProject(projectId)` tras resolver/inferir el proyecto.
- **Inferencia sin `projectId`:** si está configurado `INGEST_URL`, el MCP puede obtener candidatos con `GET /projects` y `GET /repositories` y probar el shard hasta acotar el archivo; si no hay ingest, conviene **`.ariadne-project`** o **`projectId` explícito**.
- **`semantic_search`:** con sharding activo exige **`projectId`** explícito (no infiere desde ruta).
- **`find_similar_implementations`:** con sharding activo exige **`projectId`** o **`currentFilePath`** (inferencia vía ingest cuando aplica).
- La **API Nest** (`/api/graph/component`, `/impact`, etc.) acepta query **`projectId`** para caché y shard; el **manual** del grafo con sharding requiere `?projectId=`.

### Tool: `list_known_projects`

- **Descripción:** Lista los proyectos indexados (multi-root). Cada proyecto puede tener varios repos (roots). Ejecutar al inicio para mapear IDs a nombres.
- **Argumentos:** Ninguno.
- **Respuesta:** JSON con `[{ id, name, roots: [{ id, name, branch? }] }]`. `id` es el ID del **proyecto** (Ariadne). Cada `roots[].id` es el ID de un **repo**. Usa cualquiera como `projectId` en el resto de herramientas; el MCP distingue automáticamente según el endpoint que responda.

### Tool A: `get_component_graph`

- **Descripción:** Recupera el árbol de dependencias directo e indirecto de un componente.
- **Argumentos:** `componentName: string`, `depth: number (default: 2)`, `projectId?: string` (opcional), `currentFilePath?: string` (opcional, para inferir proyecto).
- **Consulta Interna (Cypher):** acorde a implementación, el `MATCH` del componente puede incluir `projectId` en el patrón y filtrar dependencias por proyecto; profundidad es literal en el path (`[*1..depth]`).

```cypher
MATCH (c:Component {name: $componentName, projectId: $projectId})-[*1..depth]->(dependency)
WHERE (dependency.projectId = $projectId OR dependency.projectId IS NULL)
RETURN c, dependency
```

(Variante sin `projectId` en el nodo cuando el grafo no filtra por proyecto.)

• **Propósito:** Evitar que la IA asuma que un componente es aislado.

---

### Tool B: `get_legacy_impact`

- **Descripción:** Analiza qué se rompería si se modifica una función o componente.
- **Argumentos:** `nodeName: string`, `projectId?: string` (opcional), `currentFilePath?: string` (opcional, para inferir proyecto).
- **Consulta Interna (Cypher):**
  ```tsx
  MATCH (n {name: $nodeName})<-[:CALLS|RENDERS*]-(dependent)
  RETURN dependent.name, labels(dependent)
  ```

### Tool C: `get_contract_specs`

- **Descripción:** Extrae las props y firma del componente detectadas por el Scanner (nodos `:Prop`, relación `HAS_PROP`).
- **Argumentos:** `componentName: string`, `projectId?: string`, `currentFilePath?: string` (inferir proyecto).
- **Consulta Interna (Cypher):**
  ```cypher
  MATCH (c:Component {name: $componentName, projectId: $projectId})-[:HAS_PROP]->(p:Prop) RETURN p.name, p.required
  ```
- **Propósito:** Forzar a la IA a usar los nombres de variables y tipos reales del grafo. La respuesta se formatea en Markdown (lista de props y si son requeridas).
- **Implementación:** El servidor MCP usa transporte **Streamable HTTP** (puerto 8080, path /mcp); las herramientas se registran en `ListToolsRequestSchema` y se ejecutan en `CallToolRequestSchema` conectando a FalkorDB y/o al servicio ingest. Cuando se proporciona `projectId` o `currentFilePath`, las consultas Cypher filtran por `n.projectId` para evitar ambigüedad. Herramientas que llaman al ingest: `get_file_content` (repositories/file o projects/file), `ask_codebase` (projects/chat o repositories/chat), `get_file_context`, `get_project_standards`, `get_modification_plan` (projects/modification-plan), `get_project_analysis` (repositories/analyze; aquí el ID debe ser de repo).

### Tool: `get_file_content`

- **Descripción:** Obtiene el contenido de un archivo del repo o proyecto desde el ingest (Bitbucket/GitHub).
- **Argumentos:** `path: string`, `projectId?: string`, `currentFilePath?: string`, `ref?: string` (rama).
- **Implementación ingest:** Intenta `GET /repositories/:id/file`; si 404, `GET /projects/:id/file`. Acepta ID de proyecto o de repo.

### Tool: `ask_codebase`

- **Descripción:** Pregunta en lenguaje natural sobre el código del proyecto. Delega al chat del ingest (Coordinator → CodeAnalysis o KnowledgeExtraction).
- **Argumentos:** `question: string`, `projectId?: string`, `currentFilePath?: string` (para inferir proyecto), **`scope?`** (objeto opcional: `repoIds[]`, `includePathPrefixes[]`, `excludePathGlobs[]` — acota Cypher, búsqueda semántica y lectura de archivos en el ingest), **`twoPhase?`** (boolean; prioriza JSON de retrieval en el sintetizador; en ingest se alinea con `CHAT_TWO_PHASE`).
- **Propósito:** Preguntas tipo "qué hace este proyecto", "cómo está implementado el login". Requiere INGEST_URL y OPENAI_API_KEY.
- **Implementación ingest:** Intenta `POST /projects/:projectId/chat` (chat por proyecto, todos los repos); si 404, `POST /repositories/:projectId/chat` (chat por repo). Body admite `message`, `history`, `scope`, `twoPhase`.
- **Listas exhaustivas:** Usar **`get_modification_plan`** para archivos a modificar y preguntas de afinación (flujo legacy/MaxPrime).

### Tool: `get_modification_plan` (contrato MaxPrime / flujo legacy)

- **Descripción:** Devuelve un plan de modificación basado **solo** en el codebase indexado: `filesToModify` (path + repoId por archivo) y `questionsToRefine` (solo negocio).
- **Argumentos:** `userDescription: string` (descripción de la modificación), `projectId?: string`, `currentFilePath?: string`, **`scope?`** (mismo objeto que en `ask_codebase`; post-filtra `filesToModify` por repo/prefijo/glob).
- **Respuesta:** `{ filesToModify: Array<{ path: string, repoId: string }>, questionsToRefine: string[] }`. Cada archivo incluye `repoId` (root); si hay varios repoId distintos, el cambio afecta a más de un repo (multi-root).
- **Garantías:** filesToModify solo contiene rutas que existen en el grafo (projectId + repoId). questionsToRefine solo preguntas de negocio/funcionalidad.
- **Implementación:** Llama a `POST /projects/:projectId/modification-plan` en el ingest (body: `userDescription`, `scope?`).

---

## 2.1 Herramientas de Refactorización Segura (SDD)

Para que la IA no rompa código al refactorizar, el MCP implementa operaciones sobre el árbol de llamadas (AST indexado vía Tree-sitter en el Cartographer):

| Tool | Propósito |
|------|-----------|
| `get_definitions` | Localiza el origen exacto (archivo, líneas) de una clase o función. |
| `get_references` | Encuentra todos los sitios donde se usa un símbolo. Evita romper archivos no abiertos al renombrar. |
| `get_implementation_details` | Expone firma, tipos y contratos (props) para que el nuevo código respete la estructura existente. |
| `trace_reachability` | Desde puntos de entrada (rutas, index, main), rastrea qué funciones nunca son llamadas (código muerto). |
| `check_export_usage` | Identifica exports sin importaciones activas. |
| `get_affected_scopes` | Si modificas A, devuelve B,C,D afectados + archivos de tests. |
| `check_breaking_changes` | Compara firma antes/después; alerta si eliminas params usados en N sitios. |
| `find_similar_implementations` | Búsqueda semántica antes de escribir código nuevo (ej. "¿ya tenemos validación de email?"). |
| `get_project_standards` | Recupera Prettier, ESLint, tsconfig para que el código sea indistinguible del existente. |
| `get_file_context` | Combina contenido + imports + exports. Paso 2 del flujo: search → get_file_context → validate → apply. |

**Contexto de proyecto:** Las herramientas basadas en grafo aceptan `projectId` y/o `currentFilePath`. Si no se pasa `projectId`, se infiere desde `currentFilePath` (monolito) o, con **sharding**, vía ingest + barrido de shards cuando `INGEST_URL` está definido. El `projectId` puede ser ID de proyecto (Ariadne) o ID de repo (`roots[].id`); las herramientas que llaman al ingest para file/chat resuelven automáticamente (fallback repo → project o project → repo según el caso).

**Resumen ingest:** `get_file_content` / `get_file_context` / `get_project_standards`: intentan `GET /repositories/:id/file` y si 404 `GET /projects/:id/file`. `ask_codebase`: intenta `POST /projects/:id/chat` y si 404 `POST /repositories/:id/chat` (body opcional: `scope`, `twoPhase`). `get_modification_plan`: `POST /projects/:projectId/modification-plan` (body opcional: `scope`). `get_project_analysis`: `POST /repositories/:id/analyze` (id = repo; para análisis por proyecto usar el id de un repo del proyecto, p. ej. `roots[0].id`).

### Tool: `analyze_local_changes` (Pre-flight check)

- **Descripción:** Revisión quirúrgica preventiva antes del commit. Lee el diff en stage (`git diff --cached`), identifica funciones/componentes **editados**, **eliminados** o **agregados**, y proyecta en el grafo FalkorDB el radio de explosión (quién depende de esos símbolos). Devuelve un **Resumen de Impacto** estructurado en Markdown.
- **Argumentos:** `projectId` o `currentFilePath` (para inferir proyecto); `workspaceRoot` (ruta del repo donde ejecutar `git diff --cached`) **o** `stagedDiff` (salida cruda del comando, para MCP remoto sin acceso al filesystem).
- **Flujo:**
  - **Paso A:** Obtener diff en stage: `git diff --name-only --cached` y `git diff --cached` desde `workspaceRoot`, o usar `stagedDiff` si se proporciona.
  - **Paso B:** Parsear el unified diff y extraer símbolos (funciones, clases, componentes JSX) de líneas `-` y `+`. Clasificar en: eliminados (solo en `-`), agregados (solo en `+`), editados (aparecen en ambos).
  - **Paso C:** Para cada símbolo, consulta Cypher de radio de explosión: `MATCH (n {name: $nodeName})<-[:CALLS|RENDERS*]-(dep) WHERE ... RETURN count(dep) AS cnt`.
- **Salida:** Tabla Markdown: **Tipo de Cambio** | **Elemento** | **Impacto en el Sistema** | **Riesgo** (ALTO/MEDIO/BAJO). Ejemplo: eliminación con dependientes → ALTO; modificación con muchos dependientes → MEDIO; nuevo sin dependencias → BAJO. Si hay riesgo ALTO, se añade recomendación: revisar antes de push para no romper el build.

---

## 3. Implementación del Servidor (Blueprint ilustrativo)

El servidor real es **`services/mcp-ariadne`** (Streamable HTTP, herramientas `get_component_graph`, `get_legacy_impact`, etc.). El siguiente snippet es **solo patrón SDK**; no sustituye el código ni el nombre de herramientas reales.

```tsx
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "AriadneSpecs-Oracle", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_component_graph",
      description: "Árbol de dependencias del componente (ver especificación §2)",
      inputSchema: {
        type: "object",
        properties: {
          componentName: { type: "string" },
          depth: { type: "number" },
          projectId: { type: "string" },
        },
        required: ["componentName"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "get_component_graph") {
    // Conectar a FalkorDB en el grafo del projectId (ver § Sharding)
    return { content: [{ type: "text", text: "..." }] };
  }
});
```

---

## 4. Flujo de Validación (The Handshake)

1. **Cursor/IA** detecta que estás en un archivo legacy.
2. La IA llama a `get_legacy_impact` a través del MCP.
3. **AriadneSpecs** responde: _"Este componente es usado por el Dashboard y recibe un prop 'user' que es obligatorio"_.
4. La IA genera el código **restringida** por esa información, eliminando la posibilidad de inventar props o romper el Dashboard.

## 5. Configuración de Seguridad

- **Solo Lectura:** El usuario de FalkorDB vinculado al MCP solo debe tener permisos de `READ`.

- **Llamadas HTTPS desde aplicación:** Para implementar peticiones HTTP/HTTPS al MCP desde una app (fetch, curl, etc.), ver [MCP_HTTPS.md](MCP_HTTPS.md).
- **Aislamiento de Dominio:** El MCP solo debe exponer archivos dentro del `ROOT` del proyecto definido en la configuración.
