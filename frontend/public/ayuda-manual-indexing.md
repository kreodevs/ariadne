**Proyecto:** Ariadne (Comercial) / AriadneSpecs (Interno)
**Estado:** Definición Técnica
**Stack:** Node.js, TypeScript, Tree-sitter, FalkorDB

## 1. Propósito

El **Cartographer** es el servicio de análisis estático encargado de mapear la topología de sistemas legacy (React/JS) hacia un grafo de conocimientos en **FalkorDB**. Su función es eliminar la incertidumbre para los agentes de IA al proporcionar un mapa exacto de dependencias, props y jerarquías.

## 2. Requisitos Funcionales

- **Análisis de Archivos:** Debe recorrer directorios de forma recursiva buscando archivos `.js`, `.jsx`, `.ts` y `.tsx`.
- **Extracción de AST:** Utilizar **Tree-sitter** con las gramáticas de JavaScript y TSX para entender la estructura del código sin ejecutarlo.
- **Mapeo de Dependencias:** Identificar sentencias `import` y `export` para conectar archivos entre sí.
- **Detección de Componentes:** Identificar componentes funcionales y de clase, extrayendo sus nombres y marcas de "legacy" (ej. si heredan de `React.Component`).
- **Sincronización de Grafo:** Traducir los hallazgos en consultas **Cypher** y ejecutarlas en FalkorDB mediante el driver oficial.

## 3. Esquema de Datos (FalkorDB)

El Cartographer debe poblar los siguientes nodos y relaciones:

### Nodos

- **`:Project`** (raíz por proyecto): `projectId`, `projectName`, `rootPath`, `lastIndexed`. Multi-root: tabla `project_repositories`; sync escribe nodos para cada proyecto del repo (standalone + proyectos que lo contienen). Relación `(Project)-[:CONTAINS]->(File)`.
- `(:File {path, projectId, repoId, ...})` — unicidad por (projectId, repoId, path).
- `(:Component {name, projectId, ...})`
- `(:Hook {name, ...})` — estándar o **custom definidos en archivo** (`const useX = ...` / `function useX(...)`); `(File)-[:CONTAINS]->(Hook)` para los definidos en el archivo.
- `(:Context {name, projectId, repoId, path})` — `createContext(...)`; `(File)-[:CONTAINS]->(Context)`.
- `(:Prop {name: string, componentName: string, projectId: string, required: boolean})`
- `(:Function {path, name, projectId, startLine?, endLine?, loc?, complexity?, nestingDepth?, description?})` — funciones nombradas; `loc` = líneas de código; `complexity` = McCabe; `nestingDepth` = profundidad de bloques.
- **NestJS (opcional):** `(:NestModule {path, name})`, `(:NestController {path, name, route?})`, `(:NestService {path, name})` — detectados por decoradores `@Module()`, `@Controller()`, `@Injectable()`.
- **Strapi v4 (opcional):** `(:StrapiContentType {path, name})`, `(:StrapiController {path, name, apiName?})`, `(:StrapiService {path, name, apiName?})` — detectados por patrón de path `src/api/**/content-types/**/schema.*`, `**/controllers/*`, `**/services/*`.

### Relaciones

- `(Project)-[:CONTAINS]->(File)` — jerarquía multi-proyecto
- `(File)-[:CONTAINS]->(Component)`, `(File)-[:CONTAINS]->(Hook)` (custom), `(File)-[:CONTAINS]->(Context)`
- `(File)-[:CONTAINS]->(Function)`
- `(File)-[:IMPORTS]->(File)`
- `(Component)-[:USES_HOOK]->(Hook)`
- `(Component)-[:RENDERS]->(Component)`
- `(Component)-[:HAS_PROP]->(Prop)`
- `(Function)-[:CALLS]->(Function)` — llamadas entre funciones del mismo archivo (caller → callee).
- NestJS: `(File)-[:CONTAINS]->(NestModule|NestController|NestService)`, `(NestModule)-[:DECLARES]->(NestController|NestService)` (según arrays del decorador `@Module({ controllers, providers })` en el mismo archivo).
- Strapi: `(File)-[:CONTAINS]->(StrapiContentType|StrapiController|StrapiService)`.

## 4. Lógica del Proceso (Pipeline)

El **pipeline** (parser + producer) se mantiene igual; la entrada es siempre una lista de `{ path, content }`.

### Fuente de archivos

- **Full sync:** Cola Redis/BullMQ. Worker ejecuta:
  1. **Fase Mapping:** `listFiles` (API Bitbucket/GitHub o shallow clone).
  2. **Fase Deps:** Lectura de `package.json` → `manifestDeps` en nodo Project.
  3. **Fase Chunking:** Parse Tree-sitter → `line_range` en Function, `commitSha` en File/Function.
- **Incremental:** Webhook Bitbucket. Diff por commit; archivos eliminados → `buildCypherDeleteFile` (orphan cleanup).
- **Legacy:** Cartographer con chokidar está en desuso.

Pasos del pipeline (independientes del origen):

1. **Creación/actualización de Project:** Al iniciar el escaneo, crear o actualizar nodo `:Project` con `projectId` (determinístico desde rootPath), `projectName` (de package.json o nombre de carpeta), `rootPath` y `lastIndexed`.
2. **Obtención de archivos:** Full sync: listar y leer contenido (API Bitbucket o filesystem/clone). Incremental: solo archivos cambiados (payload webhook o diff).
3. **Parser (Tree-sitter):** Por cada archivo, crear AST; encontrar imports, componentes (funcionales y clase), hooks usados, JSX (RENDERS), props por componente; **funciones nombradas** (function_declaration y const/let con arrow) con **loc**, **complexity** (McCabe: 1+if/for/while/switch/ternary/catch), **nestingDepth** (profundidad de statement_block); **llamadas entre ellas** (call_expression donde el callee es una función definida en el mismo archivo).
4. **Producer:** Resolver imports contra el pathSet (prefijado por repo en multi-repo); generar Cypher (MERGE) con `projectId` en todos los nodos: Project, File, Component, Hook, Prop, **Function**, (Project)-[:CONTAINS]->(File), IMPORTS, CONTAINS, USES_HOOK, RENDERS, HAS_PROP, **CALLS**; ejecutar batch contra FalkorDB.
5. **Persistencia:** FalkorDB (grafo); en el microservicio de ingesta, además PostgreSQL (sync_jobs, indexed_files).

## 5. Invariantes y Restricciones (Anti-Alucinación)

- **Solo Lectura de Código:** El Cartographer nunca debe modificar los archivos fuente.
- **Resolución Local:** Solo debe indexar archivos dentro del `src` del proyecto.
- **Indexar sin basura:** Ignorar `node_modules`, `dist`, `build`, `coverage`, `venv`, `.venv`, `__pycache__`, archivos `.log` y `.env`.
- **Tokens huérfanos:** Si un archivo se borra en el repo, se elimina del grafo (FalkorDB) y de `indexed_files`.
- **Metadata por chunk:** Cada `Function` lleva `startLine`, `endLine`, `commitSha`; cada `File` lleva `commitSha`.
- **Credenciales:** Si el repo tiene `credentialsRef`, se resuelven desde la tabla `credentials` (cifradas). Si no, desde variables de entorno.
- **Idempotencia:** El uso de la cláusula `MERGE` en Cypher es obligatorio para evitar duplicación de nodos en el grafo.

## 6. Ejemplo de Salida Cypher Esperada

Si el Cartographer encuentra un archivo `UserCard.jsx` que importa un hook de estado, la salida hacia FalkorDB debe ser:

```tsx
MERGE (f:File {path: 'src/components/UserCard.jsx'})
MERGE (c:Component {name: 'UserCard', type: 'Functional', isLegacy: false})
MERGE (h:Hook {name: 'useState'})
MERGE (f)-[:CONTAINS]->(c)
MERGE (c)-[:USES_HOOK]->(h)
```
