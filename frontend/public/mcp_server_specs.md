**ID:** SPEC-MCP-001

**Protocolo:** Model Context Protocol (MCP)

**Origen de Datos:** FalkorDB (via Oracle/FalkorSpecs Core)

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
- **Uso de `projectId` en herramientas:** suele ser **ID de proyecto** o **ID de repo**. Para file/chat el MCP resuelve con fallback (`repositories` → `projects`). **`get_modification_plan`** es distinto: el ingest acepta en `POST /projects/:id/modification-plan` tanto el UUID del **proyecto** como el **`roots[].id` del repositorio**; en multi-root conviene pasar el del repo objetivo para no depender del primer root.

### Tool: `list_known_projects`

- **Descripción:** Lista los proyectos indexados (multi-root). Cada proyecto puede tener varios repos (roots). Ejecutar al inicio para mapear IDs a nombres.
- **Argumentos:** Ninguno.
- **Respuesta:** JSON con `[{ id, name, roots: [{ id, name, branch? }] }]`. `id` es el ID del **proyecto** (Ariadne). Cada `roots[].id` es el ID de un **repo**. Para **`get_modification_plan`** con varios roots, usa el `roots[].id` adecuado; para otras herramientas, proyecto o repo según el endpoint (file/chat con resolución automática).

### Tool A: `get_component_graph`

- **Descripción:** Recupera el árbol de dependencias directo e indirecto de un componente.
- **Argumentos:** `componentName: string`, `depth: number (default: 2)`, `projectId?: string` (opcional), `currentFilePath?: string` (opcional, para inferir proyecto).
- **Consulta Interna (Cypher):**

```tsx
MATCH (c:Component {name: $componentName})-[*1..$depth]->(dependency)
RETURN c, dependency
```

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
- **Argumentos:** `componentName: string`.
- **Consulta Interna (Cypher):**
  ```cypher
  MATCH (c:Component {name: $componentName})-[:HAS_PROP]->(p:Prop) RETURN p.name, p.required
  ```
- **Propósito:** Forzar a la IA a usar los nombres de variables y tipos reales del grafo. La respuesta se formatea en Markdown (lista de props y si son requeridas).
- **Implementación:** El servidor MCP usa transporte **Streamable HTTP** (puerto 8080, path /mcp); las herramientas se registran en `ListToolsRequestSchema` y se ejecutan en `CallToolRequestSchema` conectando a FalkorDB y/o al servicio ingest. Cuando se proporciona `projectId` o `currentFilePath`, las consultas Cypher filtran por `n.projectId` para evitar ambigüedad. Herramientas que llaman al ingest: `get_file_content` (repositories/file o projects/file), `ask_codebase` (projects/chat o repositories/chat), `get_file_context`, `get_project_standards`, `get_modification_plan` (projects/modification-plan), `get_project_analysis` (repositories/analyze; aquí el ID debe ser de repo).

### Tool: `get_file_content`

- **Descripción:** Obtiene el contenido de un archivo del repo o proyecto desde el ingest (Bitbucket/GitHub).
- **Argumentos:** `path: string`, `projectId?: string`, `currentFilePath?: string`, `ref?: string` (rama).
- **Implementación ingest:** Intenta `GET /repositories/:id/file`; si 404, `GET /projects/:id/file`. Acepta ID de proyecto o de repo.

### Tool: `ask_codebase`

- **Descripción:** Pregunta en lenguaje natural sobre el código del proyecto. Delega al chat del ingest (Coordinator → CodeAnalysis o KnowledgeExtraction).
- **Argumentos:** `question: string`, `projectId?: string`, `currentFilePath?: string` (para inferir proyecto), **`scope?`** (`repoIds[]`, `includePathPrefixes[]`, `excludePathGlobs[]`), **`twoPhase?`** (boolean; sintetizador prioriza JSON de retrieval; ingest: `CHAT_TWO_PHASE`).
- **Propósito:** Preguntas tipo "qué hace este proyecto", "cómo está implementado el login". Requiere INGEST_URL y OPENAI_API_KEY.
- **Implementación ingest:** Intenta `POST /projects/:projectId/chat` (chat por proyecto, todos los repos); si 404, `POST /repositories/:projectId/chat` (chat por repo). Body: `message`, `history?`, `scope?`, `twoPhase?`.
- **Listas exhaustivas:** Usar **`get_modification_plan`** para archivos a modificar y preguntas de afinación (flujo legacy/MaxPrime).

### Tool: `get_modification_plan` (contrato MaxPrime / flujo legacy)

- **Descripción:** Devuelve un plan de modificación basado **solo** en el codebase indexado: `filesToModify` (path + repoId por archivo) y `questionsToRefine` (solo negocio).
- **Argumentos:** `userDescription: string` (descripción de la modificación), `projectId?: string`, `currentFilePath?: string`, **`scope?`** (mismo objeto; filtra la lista final de archivos).
- **Multi-root (consumidor):** El parámetro `projectId` debe ser el **`roots[].id` del repositorio** donde está el código a migrar (p. ej. frontend), no el `id` global del proyecto Ariadne, si quieres un ancla explícito. El ingest acepta UUID de **repositorio** o de **proyecto** en la misma ruta; si pasas solo el proyecto, el servicio usa el primer repo asociado (orden interno).
- **Respuesta:** `{ filesToModify: Array<{ path: string, repoId: string }>, questionsToRefine: string[] }`. Cada archivo incluye `repoId` (root); si hay varios repoId distintos, el cambio afecta a más de un repo (multi-root).
- **Garantías:** filesToModify solo contiene rutas que existen en el grafo (projectId + repoId). questionsToRefine solo preguntas de negocio/funcionalidad.
- **Implementación:** Llama a `POST /projects/:projectId/modification-plan` en el ingest (`userDescription`, `scope?`).

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

**Contexto de proyecto:** Casi todas aceptan `projectId` y `currentFilePath` (si falta, inferencia por ruta). Para **file/chat**, proyecto o `roots[].id` con fallback en ingest. **`get_project_analysis`** es excepción: solo **`roots[].id`** (repo), porque el endpoint es `POST /repositories/:id/analyze`.

**Resumen ingest:** `get_file_content` / `get_file_context` / `get_project_standards`: intentan `GET /repositories/:id/file` y si 404 `GET /projects/:id/file`. `ask_codebase`: intenta `POST /projects/:id/chat` y si 404 `POST /repositories/:id/chat` (`scope`, `twoPhase` opcionales). `get_modification_plan`: `POST /projects/:projectId/modification-plan` (`scope` opcional). `get_project_analysis`: `POST /repositories/:id/analyze` (id = repo).

### Tool: `analyze_local_changes` (Pre-flight check)

- **Descripción:** Revisión quirúrgica preventiva antes del commit. Lee el diff en stage (`git diff --cached`), identifica funciones/componentes **editados**, **eliminados** o **agregados**, y proyecta en el grafo FalkorDB el radio de explosión (quién depende de esos símbolos). Devuelve un **Resumen de Impacto** estructurado en Markdown.
- **Argumentos:** `projectId` o `currentFilePath` (para inferir proyecto); `workspaceRoot` (ruta del repo donde ejecutar `git diff --cached`) **o** `stagedDiff` (salida cruda del comando, para MCP remoto sin acceso al filesystem).
- **Flujo:**
  - **Paso A:** Obtener diff en stage: `git diff --name-only --cached` y `git diff --cached` desde `workspaceRoot`, o usar `stagedDiff` si se proporciona.
  - **Paso B:** Parsear el unified diff y extraer símbolos (funciones, clases, componentes JSX) de líneas `-` y `+`. Clasificar en: eliminados (solo en `-`), agregados (solo en `+`), editados (aparecen en ambos).
  - **Paso C:** Para cada símbolo, consulta Cypher de radio de explosión: `MATCH (n {name: $nodeName})<-[:CALLS|RENDERS*]-(dep) WHERE ... RETURN count(dep) AS cnt`.
- **Salida:** Tabla Markdown: **Tipo de Cambio** | **Elemento** | **Impacto en el Sistema** | **Riesgo** (ALTO/MEDIO/BAJO). Ejemplo: eliminación con dependientes → ALTO; modificación con muchos dependientes → MEDIO; nuevo sin dependencias → BAJO. Si hay riesgo ALTO, se añade recomendación: revisar antes de push para no romper el build.

---

## 3. Implementación del Servidor (Blueprint)

Debes registrar los recursos para que la IA sepa "qué puede preguntar". Aquí tienes el esquema de implementación:

```tsx
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "FalkorSpecs-Oracle",
    version: "1.0.0",
  },
  {
    capabilities: { tools: {} },
  },
);

// Registro de la herramienta principal
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_component_architecture",
      description: "Recupera la arquitectura y dependencias de FalkorSpecs",
      inputSchema: {
        type: "object",
        properties: {
          component: { type: "string" },
        },
      },
    },
  ],
}));

// Manejador de llamadas de la IA
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "get_component_architecture") {
    // Aquí conectas con tu base de datos FalkorDB
    const context = await queryFalkorDB(request.params.arguments.component);
    return {
      content: [{ type: "text", text: JSON.stringify(context) }],
    };
  }
});
```

---

## 4. Flujo de Validación (The Handshake)

1. **Cursor/IA** detecta que estás en un archivo legacy.
2. La IA llama a `get_legacy_impact` a través del MCP.
3. **FalkorSpecs** responde: _"Este componente es usado por el Dashboard y recibe un prop 'user' que es obligatorio"_.
4. La IA genera el código **restringida** por esa información, eliminando la posibilidad de inventar props o romper el Dashboard.

## 5. Configuración de Seguridad

- **Solo Lectura:** El usuario de FalkorDB vinculado al MCP solo debe tener permisos de `READ`.
- **Aislamiento de Dominio:** El MCP solo debe exponer archivos dentro del `ROOT` del proyecto definido en la configuración.
