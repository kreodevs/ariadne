# Protocolo para Agentes (AriadneSpecs Oracle)

## Protocolo de sesión

Al iniciar una sesión de desarrollo con el MCP AriadneSpecs Oracle:

1. **OBLIGATORIO: Ejecutar `list_known_projects`** al inicio. Respuesta: `[{ id, name, roots: [{ id, name, branch? }] }]` — `id` = proyecto Ariadne; `roots[].id` = cada repo indexado. Para **`get_modification_plan`** con varios repos en el mismo proyecto, pasa como `projectId` el **`roots[].id` del repositorio donde está el código** (p. ej. frontend), no solo el `id` del proyecto, para no depender del orden interno de repos.
2. **OBLIGATORIO: Verificar que el `projectId` existe** antes de proponer modificaciones en componentes o funciones. Si una herramienta devuelve `[NOT_FOUND_IN_GRAPH]`, no proceder: solicitar reindexación (sync/resync) o verificar el nombre del nodo.
3. Usar el resultado para saber qué `projectId` corresponde a cada proyecto cuando consultes el grafo.

## Dominios y contexto multi-grafo

Si el proyecto tiene **dependencias a dominios** (`ProjectDomainDependency` en ingest), el sistema consulta también los grafos Falkor de otros proyectos en esos dominios. Las herramientas y el chat usan **`cypherShardContexts`** (`graphName` + `cypherProjectId` por shard): en Cypher, el parámetro `$projectId` debe coincidir con el `projectId` almacenado en los nodos de ese grafo (no asumir solo el UUID del proyecto “actual”).

## Preferencia projectId

**Fijar proyecto (recomendado):** Si existe `.ariadne-project` en la raíz del workspace, leer su `projectId` y usarlo en **todas** las llamadas al MCP. Evita errores por inferencia o pérdida de contexto.

```json
// .ariadne-project (raíz del repo que se mantiene)
{ "projectId": "uuid-del-proyecto" }
```

Cuando no hay `.ariadne-project`:

- Pasa **`projectId`** a las herramientas para evitar ambigüedad. Suele valer proyecto Ariadne o **`roots[].id`**; file/chat resuelven con fallback. **`get_project_analysis`:** el MCP llama a `POST /repositories/:id/analyze` si el UUID es **repo** (`roots[].id`) o a `POST /projects/:id/analyze` si es **proyecto** (body con `mode` y, en multi-root, `idePath` / `repositoryId` cuando el ingest lo requiere). **`get_modification_plan`** en multi-root: preferir **`roots[].id`**.
- Si no pasas `projectId`, usa **`currentFilePath`** (ruta del archivo que el IDE está editando); el sistema intentará inferir el proyecto.
- **Prioriza pasar `projectId`** explícito. Nunca inventes ni asumas IDs.

## Herramientas por intención

| Intención del usuario | Herramienta MCP | Flujo |
|----------------------|-----------------|-------|
| **Diagnóstico de archivo/componente/hook específico** ("diagnóstico de usePauta.tsx", "analiza Board") | **`get_component_graph`**, **`get_legacy_impact`**, **`get_definitions`**, **`get_references`** | `list_known_projects` → projectId → `get_component_graph(componentName/hookName)` + `get_legacy_impact(nodeName)` + `get_definitions` / `get_references` para estructura, impacto y usos. **No solo Read/Grep.** |
| Diagnóstico por repo/proyecto: deuda técnica, duplicados, reingeniería, código muerto, auditoría heurística de seguridad (`seguridad`) | **`get_project_analysis`** | `list_known_projects` → `projectId` = **`roots[].id`** del repo **o** id del proyecto Ariadne; con varios roots, **`currentFilePath`** (o `repositoryId` explícito en ingest) para resolver el repo → `get_project_analysis(projectId?, mode, currentFilePath?)` |
| Preguntas abiertas en lenguaje natural ("¿cómo funciona X?", "explica el flujo de Y") | **`ask_codebase`** | Ingest u orchestrator (Coordinator: grafo Falkor + archivos: Prisma, OpenAPI, package.json, `.env.example`, tsconfig). Opcional **`scope`**, **`twoPhase`**, **`responseMode`**. Con **`evidence_first`** la respuesta es **JSON MDD de 7 secciones** (`summary`, `openapi_spec`, `entities`, `api_contracts`, `business_logic`, `infrastructure`, `risk_report`, `evidence_paths`) para LegacyCoordinator/The Forge; con orchestrator se construye vía `POST /internal/repositories/:id/mdd-evidence`. Requiere **INGEST_URL** y **LLM** (`LLM_*`); con orchestrator también **INTERNAL_API_KEY**. |
| **Lista de archivos a modificar + preguntas de afinación (flujo legacy/MaxPrime)** | **`get_modification_plan`** | `list_known_projects` → `projectId` = `roots[].id` en multi-root. Body opcional **`scope`**. `POST /projects/:id/modification-plan` (proyecto o repo). |
| Búsqueda por término, exploración | `semantic_search`, `find_similar_implementations` | Consulta directa al grafo. |
| Antes de editar componente/función | `validate_before_edit` | Ver sección Flujo SDD. |

**Proyecto por nombre:** `list_known_projects` → localizar por `name`. Para **`get_project_analysis`**, preferir **`roots[].id`** del repo a analizar; si pasas el **`id` del proyecto** y hay varios repos, aporta **`currentFilePath`** para que el MCP envíe `idePath` al ingest. Para **`get_modification_plan`** (multi-root), **`roots[].id`** del repo donde está el código.

## Flujo de diagnóstico de archivo/componente/hook

**OBLIGATORIO** cuando el usuario pide un diagnóstico o análisis de un archivo/componente/hook específico (ej. "diagnóstico de usePauta.tsx", "analiza Board", "revisa Header"):

1. **`list_known_projects`** para obtener `projectId` (o leer `.ariadne-project`).
2. **`get_component_graph`** con el nombre del componente/hook para ver dependencias y estructura.
3. **`get_legacy_impact`** con el nombre del nodo para ver qué se rompe si se modifica.
4. **`get_definitions`** y **`get_references`** para ubicar definición y todos los usos.

**No usar solo Read/Grep.** El grafo indexado aporta información estructural que no se obtiene leyendo el archivo.

---

## Flujo SDD (Spec-Driven Development)

**OBLIGATORIO** antes de modificar un componente o función en código legacy:

1. **Ejecutar `validate_before_edit`** con el `nodeName` (o `get_legacy_impact` + `get_contract_specs` por separado).
2. Si el nodo **no existe**: no proceder; verificar el nombre o reindexar. Las herramientas devuelven `[NOT_FOUND_IN_GRAPH]` cuando el nodo/archivo no está en el grafo — indicador estructurado para no alucinar. Solicitar sync/resync del proyecto.
3. Para **componentes**: usar las props del contrato (sección 2). Para **funciones**: revisar la sección 3 (path, descripción, endpoints) — no inventar firmas ni params.
4. Consultar `get_legacy_impact` para saber qué se rompería si modificas el nodo.
5. **No inventes props ni asumas nombres:** usa los que devuelve el grafo.
6. Para ver el código actual: `get_file_content`.

## Flujo de refactorización (árbol de llamadas)

| Paso | Operación MCP | Resultado |
|------|---------------|-----------|
| 1. Intención | `semantic_search` / `find_similar_implementations` | Entiende dónde debe trabajar. |
| 2. Contexto | `get_file_context` / `get_definitions` + `get_references` | Lee el archivo, dependencias y usos. |
| 3. Validación | `validate_before_edit` + `check_breaking_changes` | Verifica impacto antes del cambio. |
| 4. Ejecución | (Cursor aplica la edición) | Cambio quirúrgico solo en líneas necesarias. |
| 5. Imports | Ver sección "Imports al crear archivos" | Rutas correctas; build sin errores. |

**Antes de renombrar:** `get_references` evita romper archivos no abiertos. **Antes de crear código nuevo:** `find_similar_implementations` + `get_project_standards` evitan duplicación y desvío de estándares.

## Imports al crear archivos nuevos (extracciones, hooks, módulos)

**OBLIGATORIO** al extraer código a un archivo nuevo (hook, utilidad, componente):

1. **No asumir estructura de carpetas.** Ejemplo: `contexts` puede estar en `src/contexts` o en `src/components/contexts`. La ruta relativa cambia según la ubicación real.
2. **Derivar rutas desde el archivo que refactorizas.** Usa las rutas de import del archivo original como referencia. Si el original importa `../../contexts/usePauta`, el módulo está a 2 niveles arriba del original. Desde el nuevo archivo, calcula la ruta equivalente (p. ej. desde `Views/hooks/` → `../../../contexts` si contexts está en `components/contexts`).
3. **Verificar la ubicación real** de cada módulo importado: `get_definitions` (path del nodo) o listar el repo para confirmar la ruta. No inventar rutas.
4. **Incluir en el plan de refactorización:**
   - Paso: "Tras crear el archivo nuevo, comprobar que las rutas de import sean correctas desde su ubicación."
   - Paso: "Ejecutar `npm run build` o `npm run dev` y corregir errores de resolución de imports hasta que todo compile."
5. Al escribir imports en el archivo nuevo, la ruta relativa debe resolverse **desde la carpeta del archivo nuevo**, no desde el archivo de origen.
