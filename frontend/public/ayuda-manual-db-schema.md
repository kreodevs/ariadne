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

Cuando el Scanner (usando Tree-sitter) procesa un archivo, ejecutará estas consultas en **FalkorSpecs**:

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

En tu servicio de **FalkorSpecs**, la conexión se vería simplificada así:

```tsx
// Ejemplo conceptual de guardado de relación
async function saveDependency(caller, callee) {
  const query = `
    MERGE (f1:Component {name: '${caller}'})
    MERGE (f2:Component {name: '${callee}'})
    MERGE (f1)-[:CALLS]->(f2)
  `;
  await falkorClient.selectGraph("FalkorSpecs").query(query);
}
```

### 5. Tablas PostgreSQL (ingest)

El microservicio de ingesta usa PostgreSQL para: `repositories` (con `credentialsRef`, `lastCommitSha`), **`project_repositories`** (repo_id, project_id: un repo puede estar en varios proyectos), `sync_jobs`, `indexed_files`, `credentials` (tokens/secrets cifrados). Ver [manual/CONFIGURACION_Y_USO.md](manual/CONFIGURACION_Y_USO.md).
