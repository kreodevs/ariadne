# Protocolo para Agentes (AriadneSpecs Oracle)

## Protocolo de sesión

Al iniciar una sesión de desarrollo con el MCP AriadneSpecs Oracle:

1. **OBLIGATORIO: Ejecutar `list_known_projects`** al inicio. Respuesta: `[{ id, name, roots: [{ id, name, branch? }] }]`. `id` = proyecto Ariadne; `roots[].id` = repo. Para **`get_modification_plan`** con varios repos, usa como `projectId` el **`roots[].id` del repo donde vive el código** (p. ej. frontend); el endpoint de ingest acepta también UUID de proyecto, pero entonces el plan puede anclarse al primer repo del proyecto.
2. **OBLIGATORIO: Verificar que el `projectId` existe** antes de proponer modificaciones en componentes o funciones. Si una herramienta devuelve `[NOT_FOUND_IN_GRAPH]`, no proceder: solicitar reindexación (sync/resync) o verificar el nombre del nodo.
3. Usar el resultado para saber qué `projectId` (proyecto o repo) corresponde a cada contexto cuando consultes el grafo.

## Preferencia projectId

**Fijar proyecto (recomendado):** Si existe `.ariadne-project` en la raíz del workspace, leer su `projectId` y usarlo en **todas** las llamadas al MCP. Evita errores por inferencia o pérdida de contexto.

```json
// .ariadne-project (raíz del repo que se mantiene)
{ "projectId": "uuid-del-proyecto" }
```

Cuando no hay `.ariadne-project`:

- Pasa **`projectId`** a las herramientas para evitar ambigüedad (ej. un componente `Header` en Legacy y otro en Moderno). Suele valer **ID de proyecto** (Ariadne) o **ID de repo** (`roots[].id`); el MCP/ingest resuelve con fallback en **file** y **chat**. **`get_project_analysis`:** el MCP usa `POST /repositories/:id/analyze` (**`roots[].id`**) o `POST /projects/:id/analyze` (id proyecto + `idePath`/`repositoryId` en multi-root cuando aplica). `get_modification_plan`: preferir `roots[].id` en multi-root (ver fila de la tabla).
- Si no pasas `projectId`, usa **`currentFilePath`** (ruta del archivo que el IDE está editando); el sistema intentará inferir el proyecto.
- **Prioriza pasar `projectId`** explícito. Nunca inventes ni asumas IDs.

## Herramientas por intención

| Intención del usuario | Herramienta MCP | Flujo |
|----------------------|-----------------|-------|
| Diagnóstico de archivo/componente/hook específico | **`get_component_graph`**, **`get_legacy_impact`**, **`get_definitions`**, **`get_references`** | `list_known_projects` → projectId → get_component_graph + get_legacy_impact + get_definitions/get_references. |
| Diagnóstico de deuda técnica, duplicados, reingeniería, código muerto, auditoría heurística de seguridad (`seguridad`) | **`get_project_analysis`** | `list_known_projects` → **`roots[].id`** del repo **o** id del proyecto; con varios roots, **`currentFilePath`** → `get_project_analysis(projectId?, mode, currentFilePath?)`. |
| Plan de modificación (archivos a tocar + preguntas de afinación) | **`get_modification_plan`** | `POST /projects/:projectId/modification-plan` con `projectId` = `roots[].id` en multi-root. Body: `userDescription`, opcional **`scope`** (`repoIds`, `includePathPrefixes`, `excludePathGlobs`). |
| Preguntas abiertas en lenguaje natural ("¿cómo funciona X?", "explica el flujo de Y") | **`ask_codebase`** | Chat del ingest. Opcional **`scope`**, **`twoPhase`** y **`responseMode`** (`evidence_first` para síntesis “evidencia primero”). Requiere INGEST_URL y OPENAI_API_KEY. |
| Búsqueda por término, exploración | `semantic_search`, `find_similar_implementations` | Consulta directa al grafo. |
| Antes de editar componente/función | `validate_before_edit` | Ver sección Flujo SDD. |
| **Antes del commit (revisión preventiva)** | **`analyze_local_changes`** | Revisa cambios en stage contra el grafo; tabla de impacto (Eliminación/Modificación/Nuevo, riesgo ALTO/MEDIO/BAJO). Pasar `workspaceRoot` o `stagedDiff`. |

**Proyecto por nombre:** Ejecuta `list_known_projects` y localiza el elemento por `name`. Para **`get_project_analysis`**, preferir **`roots[].id`**; si usas el **`id` del proyecto** y hay varios repos, pasa **`currentFilePath`**. Para **`get_modification_plan`** en multi-root, **`roots[].id`** del repo donde está el código.

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

**Antes de renombrar:** `get_references` evita romper archivos no abiertos. **Antes de crear código nuevo:** `find_similar_implementations` + `get_project_standards` evitan duplicación y desvío de estándares.
