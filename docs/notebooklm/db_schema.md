### 0. Nomenclatura: dominio en Falkor vs dominio en PostgreSQL

- **`:DomainConcept`** (FalkorDB): conceptos de dominio del **código** (tipos, enums, contextos React). Ver sección 1 más abajo.
- **Tabla `domains`** (PostgreSQL): **dominio de arquitectura / gobierno C4** (nombre, color, metadata). No es el mismo concepto que `:DomainConcept`.
- **`project_domain_dependencies`**: whitelist de un **proyecto Ariadne** hacia otros **dominios** (integración REST/gRPC/Event entre ecosistemas). Alimenta `GET /projects/:id/graph-routing` → `cypherShardContexts` para consultar varios grafos Falkor con el `projectId` correcto en cada nodo.

---

### 1. Definición de Nodos (Entidades)

Cada nodo representa un artefacto real en tu código legacy:

- **`:Project`**: Nodo raíz por proyecto indexado (un nodo por proyecto; multi-root: un proyecto puede tener N repos).
  - `projectId`: Identificador único (UUID del proyecto en Postgres).
  - `projectName`: Nombre extraído de `package.json` o carpeta.
  - `rootPath`: Ruta raíz (prefijo repo).
  - `branch`: Rama de Git sincronizada (ej. `main`, `develop`). Opcional (indexaciones antiguas pueden no tenerla).
  - `lastIndexed`: Timestamp de la última indexación.
  - `manifestDeps`: JSON con dependencias de `package.json` (opcional).
  - Relación: `(Project)-[:CONTAINS]->(File)`, `(Project)-[:HAS_ROUTE]->(Route)`.
- **`:File`**: El contenedor físico.
  - `path`: Ruta relativa al repo (ej. `src/components/Header.jsx`). Unicidad: `(projectId, repoId, path)`.
  - `projectId`: ID del proyecto al que pertenece.
  - `repoId`: ID del repositorio (root) del que viene el archivo (multi-root).
  - `lastScan`: Timestamp de la última indexación.
  - `commitSha`: SHA del último commit indexado (webhook bridge).
- **`:Route`**: Ruta React Router (`<Route path="..." element={<X />} />`).
  - `path`: Ruta (ej. `/`, `/login`).
  - `componentName`: Componente que renderiza.
  - `projectId`: ID del proyecto.
- **`:Component`**: La unidad de UI.
  - `name`: Nombre del componente (ej. `LegacyTable`).
  - `projectId`: ID del proyecto (evita colisiones entre proyectos).
  - `type`: `'Class'` o `'Functional'`.
  - `isLegacy`: Booleano (basado en si usa `React.Component` o ciclos de vida antiguos).
  - `description`: JSDoc extraído (opcional).
  - `embedding`: Vector para RAG (FalkorDB 4.0+; opcional).
- **`:Hook`**: Hooks estándar (`useState`, `useEffect`, etc.) o **custom hooks definidos en el archivo** (`const useX = ...` o `function useX(...)`). Los custom definidos en archivo tienen relación `(File)-[:CONTAINS]->(Hook)`.
- **`:Context`**: Contexto React (`createContext(...)`). Relación `(File)-[:CONTAINS]->(Context)`.
  - `name`: Nombre del contexto (variable o identificador).
  - `projectId`, `repoId`, `path`: Identidad.
- **`:Prop`**: La interfaz del componente.
  - `name`: Nombre de la propiedad.
  - `required`: Booleano detectado por PropTypes o tipos.
- **`:Function`**: Función nombrada (declaración o const/let con arrow).
  - `path`: Ruta del archivo (identidad junto con `name`).
  - `name`: Nombre de la función. Usado por `get_legacy_impact` para trazar quién llama a quién.
  - `projectId`: ID del proyecto (evita colisiones entre proyectos).
  - `startLine`, `endLine`: Rango de líneas (chunking semántico). Opcional.
  - `loc`: Líneas de código (`endLine - startLine + 1`). Opcional.
  - `complexity`: Complejidad ciclomática McCabe (1 + decisiones: if/for/while/switch/ternary/catch). Opcional.
  - `nestingDepth`: Profundidad máxima de bloques (statement_block). >4 indica código spaguetti. Opcional.
  - `commitSha`: SHA del commit. Opcional.
  - `description`: JSDoc extraído (opcional).
  - `endpointCalls`: JSON array de `{method, line}` (fetch, axios.get, api.post, etc.). Opcional.
  - `embedding`: Vector para RAG (FalkorDB 4.0+; opcional).
- **`:Model`**: Modelo de datos (clase sin JSX: path en `/models/`, nombre `*Model`, o clase sin React).
  - `path`: Ruta del archivo. `name`: Nombre de la clase.
  - `projectId`: ID del proyecto.
  - Relación: `(File)-[:CONTAINS]->(Model)`.

**Nodos NestJS** (opcional; para proyectos backend Nest). Labels: `:NestModule`, `:NestController`, `:NestService`:

- **`:NestModule`**: Módulo NestJS (`@Module()`).
  - `path`: Ruta del archivo. `name`: Nombre de la clase.
- **`:NestController`**: Controlador NestJS (`@Controller()`).
  - `path`, `name`. Opcional: `route` (ruta HTTP del decorador).
- **`:NestService`**: Servicio NestJS (`@Injectable()`).
  - `path`, `name`.

Relaciones: `(File)-[:CONTAINS]->(NestModule|NestController|NestService)`, `(NestModule)-[:DECLARES]->(NestController|NestService)` cuando el módulo declara ese controlador/servicio en su decorador (mismo archivo).

**Nodos Strapi v4** (opcional). Labels: `:StrapiContentType`, `:StrapiController`, `:StrapiService`:

- **`:StrapiContentType`**: Schema de content-type (`src/api/**/content-types/**/schema.json` o `.ts`).
  - `path`: Ruta del archivo. `name`: Nombre del content-type (carpeta bajo content-types).
- **`:StrapiController`**: Controlador de API (`src/api/**/controllers/*.ts|.js`).
  - `path`, `name` (nombre del archivo). Opcional: `apiName` (carpeta bajo api/).
- **`:StrapiService`**: Servicio de API (`src/api/**/services/*.ts|.js`).
  - `path`, `name`. Opcional: `apiName`.

Relaciones: `(File)-[:CONTAINS]->(StrapiContentType|StrapiController|StrapiService)`.

**Nodos de dominio (grafo de conocimiento)**. Labels: `:DomainConcept`:

- **`:DomainConcept`**: Concepto extraído heurísticamente (tipos, opciones, contextos).
  - `name`: Nombre del concepto.
  - `projectId`: ID del proyecto.
  - `category`: `'tipo'` (componentes por patrón), `'opcion'` (enums, constantes) o **`'context'`** (contextos React).
  - `sourcePath`: Archivo donde se definió.
  - `sourceRef`: Referencia (nombre del componente/enum/const).
  - `description`: JSDoc si existe (componentes).
  - `options`: JSON array de opciones (enums, constantes).
  - Relación: `(DomainConcept)-[:DEFINED_IN]->(File)`.

### 2. Consultas Cypher para la Ingesta (Scanner)

Cuando el Scanner (usando Tree-sitter) procesa un archivo, ejecutará estas consultas en **AriadneSpecs**:

### A. Crear Relación de Importación

Para mapear el grafo de dependencias de archivos:

```tsx
MATCH (a:File {path: 'src/App.js'}), (b:File {path: 'src/utils/api.js'})
CREATE (a)-[:IMPORTS]->(b)
```

### B. File CONTAINS Function y CALLS

- `(File)-[:CONTAINS]->(Function)` para cada función nombrada del archivo.
- `(Function {path, name})-[:CALLS]->(Function {path, name})` para llamadas entre funciones: mismo archivo (parser) y **cross-file** (resolución por imports: si el callee es un nombre importado y el archivo importado exporta esa función/componente, se crea la relación CALLS entre los dos nodos Function).

### C. Mapear Uso de Hooks en Componentes

Fundamental para identificar lógica que debe ser migrada:

```tsx
MATCH (c:Component {name: 'OrderHistory'}), (h:Hook {name: 'useEffect'})
CREATE (c)-[:USES_HOOK {line: 45}]->(h)
```

### D. Jerarquía de Renderizado (Component Tree)

Para saber qué componentes se rompen si cambias uno:

```tsx
MATCH (p:Component {name: 'Dashboard'}), (child:Component {name: 'StatCard'})
CREATE (p)-[:RENDERS]->(child)
```

### 3. Consultas de Verificación (Anti-Alucinación)

Estas son las consultas que el sistema hará antes de que la IA empiece a trabajar:

**Trace de Impacto:** "¿Qué componentes o funciones dependen de este nodo (lo llaman o lo renderizan)?"

El MCP `get_legacy_impact` y la API `GET /graph/impact/:nodeId` usan:

```cypher
MATCH (n {name: $nodeName})<-[:CALLS|RENDERS*]-(dependent) RETURN dependent.name, labels(dependent)
```

Así se obtienen tanto dependientes por **CALLS** (quién llama a esta función) como por **RENDERS** (quién renderiza este componente). Los nodos `:Function` tienen `path` y `name`; la consulta filtra por `name`.

**Extracción de Contexto (get_contract_specs — implementada):** "Dame la firma de props de este componente legacy"

```cypher
MATCH (c:Component {name: $componentName})-[:HAS_PROP]->(p:Prop) RETURN p.name, p.required
```

Usada por la API `GET /graph/contract/:componentName` y por la herramienta MCP `get_contract_specs`.

### 4. Implementación en el Backend (FalkorDB + Node.js)

En tu servicio de **AriadneSpecs**, la conexión se vería simplificada así:

```tsx
// Ejemplo conceptual de guardado de relación
async function saveDependency(caller, callee) {
  const query = `
    MERGE (f1:Component {name: '${caller}'})
    MERGE (f2:Component {name: '${callee}'})
    MERGE (f1)-[:CALLS]->(f2)
  `;
  await falkorClient.selectGraph("AriadneSpecs").query(query);
}
```

### 5. Tablas PostgreSQL (ingest)

El microservicio **ingest** persiste metadatos en PostgreSQL (TypeORM, migraciones en `services/ingest/src/migrations/`). Resumen de tablas relevantes; tipos alineados con las entidades TypeORM.

#### 5.1 `repositories`

Repositorio remoto Bitbucket/GitHub.

| Columna | Tipo | Notas |
|---------|------|--------|
| `id` | uuid PK | |
| `provider` | varchar(64) | `bitbucket`, `github`, … |
| `project_key` | varchar(256) | Workspace / owner |
| `repo_slug` | varchar(256) | |
| `default_branch` | varchar(256) | default `main` |
| `credentials_ref` | varchar(512) nullable | FK lógica a `credentials.id` |
| `last_commit_sha` | varchar(64) nullable | Webhook bridge |
| `last_sync_at` | timestamptz nullable | |
| `index_include_rules` | jsonb nullable | Alcance de indexado por repo (`null` = completo; `{ entries }` = restringido — ver `index-include-rules.ts` y MONOREPO doc) |
| … | | Ver entidad `RepositoryEntity` |

#### 5.2 `projects`

Proyecto Ariadne multi-root (agrupa N repos). `projectId` en nodos Falkor indexados bajo ese proyecto = **`projects.id`**.

| Columna | Tipo | Notas |
|---------|------|--------|
| `id` | uuid PK | |
| `name` | varchar(512) nullable | |
| `description` | text nullable | |
| `falkor_shard_mode` | varchar(16) | `project` \| `domain` (partición Falkor) |
| `falkor_domain_segments` | jsonb nullable | Segmentos conocidos (último sync) |
| `domain_id` | uuid nullable FK | → `domains.id`, **ON DELETE SET NULL** |
| `created_at`, `updated_at` | timestamptz | |

#### 5.3 `domains` (gobierno C4)

| Columna | Tipo | Notas |
|---------|------|--------|
| `id` | uuid PK | |
| `name` | varchar(256) NOT NULL | |
| `description` | text nullable | |
| `color` | varchar(16) NOT NULL default `#6366f1` | Hex UI / PlantUML |
| `metadata` | jsonb nullable | |
| `created_at`, `updated_at` | timestamptz | |

#### 5.4 `project_domain_dependencies`

Dependencia declarada: **proyecto** → **dominio** (otro ecosistema con el que se integra). `connection_type`: p. ej. `REST`, `gRPC`, `Event`, `GraphQL`.

| Columna | Tipo | Notas |
|---------|------|--------|
| `id` | uuid PK | |
| `project_id` | uuid FK | → `projects.id` **ON DELETE CASCADE** |
| `depends_on_domain_id` | uuid FK | → `domains.id` **ON DELETE CASCADE** |
| `connection_type` | varchar(32) NOT NULL default `REST` | |
| `description` | text nullable | |
| `created_at` | timestamptz | |
| **UNIQUE** | | `(project_id, depends_on_domain_id)` |

Índices: `project_id`, `depends_on_domain_id`.

#### 5.5 `project_repositories`

Asocia repos a proyectos; rol opcional para chat multi-root.

| Columna | Tipo | Notas |
|---------|------|--------|
| `repo_id` | uuid PK (compuesta) | → `repositories.id` |
| `project_id` | uuid PK (compuesta) | → `projects.id` |
| `role` | varchar(128) nullable | p. ej. `frontend` / `backend` |

#### 5.6 Otras tablas (referencia)

- **`sync_jobs`**, **`indexed_files`**, **`credentials`** (tokens cifrados), **`embedding_space`**, etc. — ver entidades en `services/ingest/src/`.

#### 5.7 Relación con FalkorDB (enrutamiento)

- **`GET /projects/:id/graph-routing`** devuelve `cypherShardContexts`: lista de `{ graphName, cypherProjectId }`. Los grafos de proyectos cuyo `domain_id` está en la whitelist (`depends_on_domain_id`) se añaden para consultas Cypher/RAG; cada par debe usarse con `WHERE n.projectId = $projectId` usando el **`cypherProjectId`** correspondiente a ese grafo.
- Listado de nombres de grafo sin duplicar: `extendedGraphShardNames` (solo shards “extra” de otros proyectos).

Ver [manual/CONFIGURACION_Y_USO.md](../manual/CONFIGURACION_Y_USO.md) y [manual/README.md](../manual/README.md).
