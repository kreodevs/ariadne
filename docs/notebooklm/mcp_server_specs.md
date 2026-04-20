**ID:** SPEC-MCP-001

**Protocolo:** Model Context Protocol (MCP)

**Origen de Datos:** FalkorDB (via Oracle/AriadneSpecs Core) y, para paridad con el explorador web, **API Nest** (`GraphService` en `GET /api/graph/*`) cuando el MCP tiene JWT configurado.

## 1. Arquitectura del Servidor MCP

El servidor MCP actuará como un **Servicio de Contexto**. No solo leerá datos, sino que aplicará la lógica de "Oráculo" para filtrar lo que la IA recibe.

- **Runtime:** Node.js (TypeScript).
- **SDK:** `@modelcontextprotocol/sdk`.
- **Transporte:** **Streamable HTTP** (puerto `8080` o `PORT`, path típico `/mcp`; modo stateless por request). El paquete puede exponer también stdio según script de despliegue; la referencia operativa es HTTP.

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
- **`semantic_search`:** ver [Tool: `semantic_search`](#tool-semantic_search). Con sharding activo exige **`projectId`** explícito (no infiere desde ruta).
- **`find_similar_implementations`:** con sharding activo exige **`projectId`** o **`currentFilePath`** (inferencia vía ingest cuando aplica).
- La **API Nest** (`/api/graph/component`, `/impact`, etc.) acepta query **`projectId`** para caché y shard; el **manual** del grafo con sharding requiere `?projectId=`.

### Tool: `list_known_projects`

- **Descripción:** Lista los proyectos indexados (multi-root). Cada proyecto puede tener varios repos (roots). Ejecutar al inicio para mapear IDs a nombres.
- **Argumentos:** Ninguno.
- **Respuesta:** JSON con `[{ id, name, roots: [{ id, name, branch? }] }]`. `id` es el ID del **proyecto** (Ariadne). Cada `roots[].id` es el ID de un **repo**. Usa cualquiera como `projectId` en el resto de herramientas; el MCP distingue automáticamente según el endpoint que responda.

### API Nest vs Falkor en herramientas de grafo

Varias tools intentan primero el **servicio API Nest** (mismo criterio que el explorador: `GraphService`, fusión multi-shard, aristas `RENDERS` / `USES_HOOK` / `IMPORTS`, `graphHints`, impacto con ramas IMPORTS entre shards, etc.):

- **Variables de entorno (MCP):** `ARIADNE_API_URL` (default `http://localhost:3000`), y **`ARIADNE_API_BEARER`** o **`ARIADNE_API_JWT`** — JWT OTP en `Authorization: Bearer` (el middleware Nest protege casi todo `/api/*`).
- **Si la API no responde o no hay token válido:** el MCP hace **fallback** a consultas Cypher directas contra Falkor. El Markdown de salida indica la fuente; el fallback **no** replica por completo la lógica de `GraphService`.
- **Caché:** respuestas cacheadas con clave `v2` para `get_component_graph` y `get_legacy_impact` tras alinear con la API (TTL corto; ver README del paquete).

### Tool A: `get_component_graph`

- **Descripción:** Árbol de dependencias de un componente (directas e indirectas hasta `depth`).
- **Argumentos:** `componentName: string`, `depth: number (default: 2)`, `projectId?: string`, `currentFilePath?: string` (inferir proyecto).
- **Implementación preferida:** `GET /api/graph/component/:name?depth=&projectId=` → cuerpo JSON con `nodes`, `edges` (p. ej. `depends`, `legacy_impact`), `dependencies`, `graphHints` opcional. Misma semántica que el UI.
- **Fallback Falkor (Cypher genérico):** solo si falla el `fetch` a la API. Patrón aproximado (no equivalente a `GraphService`):

```cypher
MATCH (c:Component {name: $componentName, projectId: $projectId})-[*1..depth]->(dependency)
WHERE (dependency.projectId = $projectId OR dependency.projectId IS NULL)
RETURN c, dependency
```

(Variante sin `projectId` en el nodo cuando el grafo no filtra por proyecto.)

- **Precondición:** el nodo debe existir en Falkor (el handler comprueba existencia/resolución de nombre antes de llamar a la API).
- **Propósito:** Evitar que la IA asuma que un componente es aislado.

---

### Tool B: `get_legacy_impact`

- **Descripción:** Dependientes del nodo (quién lo llama o renderiza; impacto al modificarlo).
- **Argumentos:** `nodeName: string`, `projectId?: string`, `currentFilePath?: string` (inferir proyecto).
- **Implementación preferida:** `GET /api/graph/impact/:nodeId?projectId=` → JSON `{ nodeId, dependents[] }` (`GraphService.getImpact`: `CALLS`/`RENDERS` y fusión IMPORTS multi-shard cuando aplica).
- **Fallback Falkor (Cypher):** un solo shard, patrón más estrecho que Nest:

```cypher
MATCH (n {name: $nodeName})<-[:CALLS|RENDERS*]-(dependent)
RETURN dependent.name AS name, labels(dependent) AS labels
```

(con filtros opcionales por `projectId` en `n` y `dependent` según implementación).

### Tool: `get_c4_model`

- **Descripción:** Modelo C4 agregado (sistemas, contenedores, relaciones `COMMUNICATES_WITH`) para un proyecto indexado.
- **Argumentos:** `projectId: string` (obligatorio con sharding multi-grafo).
- **Implementación:** `GET /api/graph/c4-model?projectId=` — mismas variables **`ARIADNE_API_URL`** + **`ARIADNE_API_BEARER`** / **`ARIADNE_API_JWT`** que el resto de rutas `/api/graph/*`. Sin JWT la llamada falla (no hay fallback Falkor equivalente en esta tool).

### Tool C: `get_contract_specs`

- **Descripción:** Extrae las props y firma del componente detectadas por el Scanner (nodos `:Prop`, relación `HAS_PROP`).
- **Argumentos:** `componentName: string`, `projectId?: string`, `currentFilePath?: string` (inferir proyecto).
- **Consulta Interna (Cypher):**
  ```cypher
  MATCH (c:Component {name: $componentName, projectId: $projectId})-[:HAS_PROP]->(p:Prop) RETURN p.name, p.required
  ```
- **Propósito:** Forzar a la IA a usar los nombres de variables y tipos reales del grafo. La respuesta se formatea en Markdown (lista de props y si son requeridas).
- **Implementación:** El servidor MCP usa transporte **Streamable HTTP** (puerto 8080, path /mcp); las herramientas se registran en `ListToolsRequestSchema` y se ejecutan en `CallToolRequestSchema` conectando a FalkorDB, al **API Nest** (`/api/graph/*` con JWT opcional en el entorno del MCP) y/o al servicio ingest. Cuando se proporciona `projectId` o `currentFilePath`, las consultas Cypher filtran por `n.projectId` para evitar ambigüedad. Herramientas que llaman al ingest: `get_file_content` (repositories/file o projects/file), `ask_codebase` (projects/chat o repositories/chat; con orchestrator, MDD vía ingest interno **`mdd-evidence`**), `get_file_context`, `get_project_standards`, `get_modification_plan` (projects/modification-plan), `get_project_analysis` (`POST /projects/:id/analyze` o `POST /repositories/:id/analyze` según si el id es proyecto Ariadne o `roots[].id`; ver [Tool: `get_project_analysis`](#tool-get_project_analysis)).

### Tool: `get_file_content`

- **Descripción:** Obtiene el contenido de un archivo del repo o proyecto desde el ingest (Bitbucket/GitHub).
- **Argumentos:** `path: string`, `projectId?: string`, `currentFilePath?: string`, `ref?: string` (rama).
- **Implementación ingest:** Intenta `GET /repositories/:id/file`; si 404, `GET /projects/:id/file`. Acepta ID de proyecto o de repo.

### Tool: `semantic_search`

- **Descripción:** Búsqueda por palabra clave (y vectorial contra nodos indexados si hay embed-index y `/embed` disponible) sobre el grafo Falkor.
- **Argumentos:** `query: string` (requerido), `projectId?: string`, `limit?: number`. **No** admite **`scope`** ni **`currentFilePath`**. Para acotar a un repo concreto, pasa el UUID adecuado como `projectId` (p. ej. `roots[].id` de `list_known_projects`).
- **Sin sharding (`FALKOR_SHARD_BY_PROJECT` apagado):** si omites `projectId`, las consultas no filtran por `projectId` en el grafo monolito: el alcance es **global** respecto a todos los nodos mezclados en ese grafo (no elige “el primer root” del workspace).
- **Con sharding activo:** `projectId` **obligatorio**; el handler no infiere proyecto desde la ruta del IDE.
- **Contraste con `ask_codebase`:** acotar por `repoIds` / prefijos / globs va en el parámetro **`scope`** de **`ask_codebase`** (ingest), no en `semantic_search`.

### Tool: `ask_codebase`

- **Descripción:** Pregunta en lenguaje natural sobre el código del proyecto. Flujo **agéntico**: Coordinador (Falkor + lecturas de archivos: Prisma, OpenAPI/Swagger, `package.json`, `.env.example`, tsconfig) y Validador (evidencia anclada a paths reales). En el ingest, el pipeline unificado puede seguir usando **CodeAnalysis / KnowledgeExtraction** según el mensaje cuando no aplica el modo MDD.
- **Argumentos:** `question: string`, `projectId?: string`, `currentFilePath?: string` (para inferir proyecto), **`scope?`** (objeto opcional: `repoIds[]`, `includePathPrefixes[]`, `excludePathGlobs[]` — acota Cypher, búsqueda semántica y lectura de archivos en el ingest), **`twoPhase?`** (boolean; prioriza JSON de retrieval en el sintetizador; en ingest se alinea con `CHAT_TWO_PHASE`), **`responseMode?`:** `"default"` \| **`"evidence_first"`** — con **`evidence_first`** la respuesta es **JSON del Master Design Document (MDD)** en **7 claves**: `summary`, `openapi_spec`, `entities`, `api_contracts`, `business_logic`, `infrastructure`, `risk_report`, `evidence_paths`. Sin orchestrator: lo genera el ingest tras el retrieve (+ inyección de evidencia física si el retriever vino vacío). Con **orchestrator**: tras LangGraph retrieve → `POST /internal/repositories/:repoId/mdd-evidence` (header **`X-Internal-API-Key`**). Con **`default`**, el sintetizador sigue en prosa (y `CHAT_EVIDENCE_FIRST_MAX_CHARS` no aplica salvo modo evidence). Expuesto en el MCP con `enum` en `tools/list`; con **`additionalProperties: false`**, solo se permiten las propiedades del esquema (incluido `responseMode`).
- **Propósito:** Preguntas tipo "qué hace este proyecto", "cómo está implementado el login". Requiere **INGEST_URL** y LLM (**`LLM_*`** o claves legacy).
- **Implementación ingest:** Intenta `POST /projects/:projectId/chat` (chat por proyecto, todos los repos); si 404, `POST /repositories/:projectId/chat` (chat por repo). Body admite `message`, `history`, `scope`, `twoPhase`, `responseMode`. Respuesta puede incluir **`mddDocument`** (objeto) cuando `responseMode` es `evidence_first` y el backend lo serializa.
- **Listas exhaustivas:** Usar **`get_modification_plan`** para archivos a modificar y preguntas de afinación (flujo legacy/MaxPrime).

### Tool: `get_modification_plan` (contrato MaxPrime / flujo legacy)

- **Descripción:** Devuelve un plan de modificación basado **solo** en el codebase indexado: `filesToModify` (path + repoId por archivo) y `questionsToRefine` (solo negocio).
- **Argumentos:** `userDescription: string` (descripción de la modificación), `projectId?: string`, `currentFilePath?: string`, **`scope?`** (mismo objeto que en `ask_codebase`; post-filtra `filesToModify` por repo/prefijo/glob).
- **Respuesta:** `{ filesToModify: Array<{ path: string, repoId: string }>, questionsToRefine: string[] }`. Cada archivo incluye `repoId` (root); si hay varios repoId distintos, el cambio afecta a más de un repo (multi-root).
- **Garantías:** filesToModify solo contiene rutas que existen en el grafo (projectId + repoId). questionsToRefine solo preguntas de negocio/funcionalidad.
- **Implementación:** Llama a `POST /projects/:projectId/modification-plan` en el ingest (body: `userDescription`, `scope?`).

### Tool: `get_project_analysis`

- **Descripción:** Informes estructurados de deuda técnica (`diagnostico`), duplicados (`duplicados`; requiere embed-index), plan integrado (`reingenieria`), alcance de código muerto (`codigo_muerto`) y auditoría heurística de secretos/higiene (`seguridad`). Requiere **INGEST_URL** y **OPENAI_API_KEY** en el servidor de ingest.
- **Argumentos:** `projectId?` (id de **proyecto** Ariadne o **`roots[].id`** de repo), `currentFilePath?` (multi-root: el MCP envía `idePath` al ingest cuando el `projectId` es el del proyecto y hay varios roots), `mode?` ∈ `diagnostico` \| `duplicados` \| `reingenieria` \| `codigo_muerto` \| `seguridad` (default `diagnostico`).
- **Implementación ingest:** Si el UUID corresponde a un **proyecto** en BD → `POST /projects/:projectId/analyze` con `{ mode, idePath?, repositoryId? }`. Si corresponde a un **repositorio** → `POST /repositories/:id/analyze` con `{ mode }`. La resolución de repo en multi-root es responsabilidad del ingest (`AnalyticsService`), no del cliente.

### Herramientas auxiliares (MCP nativas / ingest ligero)

Distintas de `get_project_analysis` (pipeline completo en ingest con LLM):

| Tool                  | Rol                                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`get_sync_status`** | `GET /projects/:id/sync-status` (ingest): última sync y jobs recientes. Caché opcional en MCP (`MCP_REDIS_*`).                                                                               |
| **`get_debt_report`** | Consulta Cypher en Falkor: nodos `Function`/`Component` sin aristas `CALLS` entrantes ni salientes (heurística “aislado”). Límite de filas configurable: `MCP_DEBT_REPORT_ISOLATED_LIMIT`.   |
| **`find_duplicates`** | Cypher: agrupa `File` por `contentHash` con más de un path. Límite de grupos: `MCP_FIND_DUPLICATES_GROUP_LIMIT`. No es el modo `duplicados` de `get_project_analysis` (embed/cross-package). |

### Volúmenes de salida (operadores / The Forge)

- **MCP:** prefijos **`MCP_*`** — ver `services/mcp-ariadne/README.md` y `src/mcp-tool-limits.ts` (defaults altos; bajar si el contexto del LLM se satura).
- **MDD (`evidence_first` / `mdd-evidence`):** prefijos **`MDD_*`** — ver `services/ingest/src/chat/README.md` y `mdd-limits.ts`.

---

## 2.1 Herramientas de Refactorización Segura (SDD)

Para que la IA no rompa código al refactorizar, el MCP implementa operaciones sobre el árbol de llamadas (AST indexado vía Tree-sitter en el Cartographer):

| Tool                           | Propósito                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `get_definitions`              | Localiza el origen exacto (archivo, líneas) de una clase o función.                                     |
| `get_references`               | Encuentra todos los sitios donde se usa un símbolo. Evita romper archivos no abiertos al renombrar.     |
| `get_implementation_details`   | Expone firma, tipos y contratos (props) para que el nuevo código respete la estructura existente.       |
| `trace_reachability`           | Desde puntos de entrada (rutas, index, main), rastrea qué funciones nunca son llamadas (código muerto). |
| `check_export_usage`           | Identifica exports sin importaciones activas.                                                           |
| `get_affected_scopes`          | Si modificas A, devuelve B,C,D afectados + archivos de tests.                                           |
| `check_breaking_changes`       | Compara firma antes/después; alerta si eliminas params usados en N sitios.                              |
| `find_similar_implementations` | Búsqueda semántica antes de escribir código nuevo (ej. "¿ya tenemos validación de email?").             |
| `get_project_standards`        | Recupera Prettier, ESLint, tsconfig para que el código sea indistinguible del existente.                |
| `get_file_context`             | Combina contenido + imports + exports. Paso 2 del flujo: search → get_file_context → validate → apply.  |

**Contexto de proyecto:** Las herramientas basadas en grafo aceptan `projectId` y/o `currentFilePath`. Si no se pasa `projectId`, se infiere desde `currentFilePath` (monolito) o, con **sharding**, vía ingest + barrido de shards cuando `INGEST_URL` está definido. El `projectId` puede ser ID de proyecto (Ariadne) o ID de repo (`roots[].id`); las herramientas que llaman al ingest para file/chat resuelven automáticamente (fallback repo → project o project → repo según el caso).

**Resumen ingest:** `get_file_content` / `get_file_context` / `get_project_standards`: intentan `GET /repositories/:id/file` y si 404 `GET /projects/:id/file`. `ask_codebase`: intenta `POST /projects/:id/chat` y si 404 `POST /repositories/:id/chat` (body opcional: `scope`, `twoPhase`, `responseMode`). Interno orchestrator/MDD: **`POST /internal/repositories/:repoId/mdd-evidence`** (solo servidor, `INTERNAL_API_KEY`). `get_modification_plan`: `POST /projects/:projectId/modification-plan` (body opcional: `scope`). `get_project_analysis`: `POST /projects/:id/analyze` (proyecto; body `mode` + opcional `idePath` / `repositoryId` en multi-root) o `POST /repositories/:id/analyze` (repo = `roots[].id`).

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
      description:
        "Árbol de dependencias del componente (ver especificación §2)",
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
    // 1) GET ARIADNE_API_URL/api/graph/component/... con Authorization: Bearer (JWT)
    // 2) si falla: Cypher contra Falkor en el shard del projectId (ver § Sharding)
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

- **API Nest (`/api/*`):** El middleware OTP del API exige JWT en `Authorization: Bearer` para la mayoría de rutas. El MCP debe configurar **`ARIADNE_API_BEARER`** o **`ARIADNE_API_JWT`** en su entorno si se desea paridad con el explorador en `get_component_graph`, `get_legacy_impact` y `get_c4_model`. Ese token es **independiente** de `MCP_AUTH_TOKEN` (auth opcional del propio endpoint MCP hacia clientes: `X-M2M-Token` / `Authorization`).

- **Llamadas HTTPS desde aplicación:** Para implementar peticiones HTTP/HTTPS al MCP desde una app (fetch, curl, etc.), ver [MCP_HTTPS.md](MCP_HTTPS.md).

- **Aislamiento de Dominio:** El MCP solo debe exponer archivos dentro del `ROOT` del proyecto definido en la configuración.
