# Ayuda — MCP AriadneSpecs

Guía para configurar el MCP AriadneSpecs Oracle en Cursor. Permite a la IA consultar el grafo de FalkorDB **antes** de modificar código legacy, reduciendo alucinaciones y rupturas.

**Entorno:** [ariadne.kreoint.mx](https://ariadne.kreoint.mx)

---

## 1. Configuración (recomendada)

Si Ariadne está desplegado (ariadne.kreoint.mx), Cursor se conecta por URL. **No requiere túnel SSH, ni clonar el repo, ni configurar variables.**

En Cursor: **Settings** → **MCP** → editar `~/.cursor/mcp.json`:

**Sin autenticación** (MCP sin token):

```json
{
  "mcpServers": {
    "ariadnespecs": {
      "url": "https://ariadne.kreoint.mx/mcp"
    }
  }
}
```

**Con token** (cuando MCP_AUTH_TOKEN está definido en el servidor):

```json
{
  "mcpServers": {
    "ariadnespecs": {
      "url": "https://ariadne.kreoint.mx/mcp",
      "headers": {
        "Authorization": "Bearer m2m_xxx"
      }
    }
  }
}
```

Sustituye el valor por el token que el admin te proporcione (MCP_AUTH_TOKEN). Alternativa: `"X-M2M-Token": "<token>"`.

Reiniciar Cursor. Listo.

> En Dokploy, asegura que la ruta `/mcp` apunte al contenedor `mcp-ariadne` (puerto **8080**).

---

## 2. Otras opciones

| Caso | Config |
|------|--------|
| **Desarrollo local** (Ariadne en tu máquina) | Arrancar MCP: `PORT=8080 node services/mcp-ariadne/dist/index.js` con env FALKORDB_HOST, INGEST_URL. Luego `url`: `http://localhost:8080/mcp` |
| **Producción + túnel SSH** | Igual que local, pero `INGEST_URL=https://ariadne.kreoint.mx` y crear túnel: `ssh -L 6379:127.0.0.1:6379 user@servidor` |

---

## 3. Herramientas (lista principal)

| Herramienta | Uso |
|-------------|-----|
| `list_known_projects` | Mapear IDs a nombres (ejecutar al inicio) |
| `get_component_graph` | Árbol de dependencias de un componente |
| `get_legacy_impact` | Ver qué se rompe si modificas un nodo |
| `get_contract_specs` | Props reales de un componente |
| `get_functions_in_file` | Funciones y componentes que contiene un archivo |
| `get_import_graph` | Grafo de imports de un archivo (qué importa/exporta) |
| `get_file_content` | Contenido de un archivo (Bitbucket/GitHub, requiere INGEST_URL) |
| `validate_before_edit` | **Obligatorio** antes de editar: impacto + contrato en un solo llamado |
| `semantic_search` | Búsqueda por palabra clave en componentes, funciones, archivos |
| `get_project_analysis` | Diagnóstico, duplicados, reingeniería, código muerto |
| `ask_codebase` | Preguntas en NL sobre el código. Opcional **`scope`** (`repoIds`, `includePathPrefixes`, `excludePathGlobs`) y **`twoPhase`**; ingest: JSON de retrieval + `CHAT_TWO_PHASE`. |
| `get_definitions` | Origen exacto de clase/función (archivo, líneas) |
| `get_references` | Todos los lugares donde se usa un símbolo |
| `get_implementation_details` | Firma, tipos, props, endpoints de un símbolo |
| `trace_reachability` | Funciones/componentes nunca llamados desde puntos de entrada |
| `check_export_usage` | Exports sin importaciones activas |
| `get_affected_scopes` | Qué nodos y archivos se verían afectados por una modificación |
| `check_breaking_changes` | Alerta si se eliminan params usados en N sitios |
| `find_similar_implementations` | Búsqueda semántica antes de escribir código nuevo |
| `get_project_standards` | Prettier, ESLint, tsconfig para seguir estándares |
| `get_file_context` | Contenido + imports + exports (paso 2: search → get_file_context → validate) |
| `get_modification_plan` | Plan quirúrgico (`filesToModify` + `questionsToRefine`); multi-root: `projectId` = `roots[].id` del repo objetivo. Opcional **`scope`** (filtra la lista de archivos). |

**Ingest (operación):** `CHAT_TELEMETRY_LOG=1` añade en logs `pathGroundingRatio` y citas vs retrieval. `CHAT_TWO_PHASE=0|false|off` desactiva el bloque JSON estructurado en el sintetizador.

---

## 4. Fijar el projectId (evitar errores)

Para que la IA siempre use el proyecto correcto y no inyecte IDs equivocados:

**Crear `.ariadne-project` en la raíz del proyecto fuente** — el repo que Ariadne tiene indexado y que abres en Cursor (ej. `oohbp2`, `ariadne-ai-scout`). *No* en el repo de Ariadne (la UI de ariadne.kreoint.mx).

```
oohbp2/               ← abre este repo en Cursor
├── .ariadne-project    ← aquí, en la raíz
├── src/
├── package.json
└── ...
```

Contenido de `.ariadne-project`:

```json
{
  "projectId": "uuid-del-proyecto"
}
```

**Cómo obtener el `projectId`:** Pide *"Lista los proyectos indexados"* → la IA llama `list_known_projects` y te muestra el mapeo. Copia el `id` del proyecto que corresponda (por nombre o ruta). Para **`get_modification_plan`** con **multi-root**, copia el **`roots[].id` del repositorio objetivo** (p. ej. frontend): el ingest acepta ese UUID en `POST /projects/:id/modification-plan` y ancla el plan a ese repo; si solo pasas el `id` del proyecto Ariadne, el servicio puede usar el primer repo asociado.

**Ventaja:** Una vez creado, la IA lo lee y usa ese `projectId` en todas las herramientas. No depende de inferencia ni se pierde entre conversaciones. Puedes commitearlo para que todo el equipo use el mismo proyecto.

> Si no existe `.ariadne-project`, la IA inferirá el proyecto por `currentFilePath` (archivo abierto), lo cual puede fallar si cambias de contexto.

**Opcional — Skill Cursor (recomendado):** Copia la skill AriadneSpecs a tu usuario para que aplique en cualquier proyecto:
```bash
cp -r .cursor/skills/ariadnespecs-mcp ~/.cursor/skills/
```
La skill encapsula el protocolo completo y se activa cuando usas el MCP. Alternativa: reglas `.mdc` en `.cursor/rules/` del repo.

---

## 5. Protocolo (AGENTS.md)

1. `list_known_projects` al inicio.
2. Si existe `.ariadne-project`, usar su `projectId` en todas las llamadas al MCP.
3. Antes de editar: `validate_before_edit` con el nombre del nodo.
4. Usar las props/contratos que devuelve el grafo. No inventar.

---

## 6. Ejemplos de uso (prompts para Cursor)

Ejemplos de qué pedirle a la IA en el chat para que use las herramientas del MCP:

### Core

| Prompt | Herramienta |
|--------|-------------|
| *Lista los proyectos indexados* | `list_known_projects` |
| *Voy a modificar el componente `Header`, ¿qué impacto tiene?* | `validate_before_edit` + `get_legacy_impact` |
| *Valida antes de editar la función `calculateTotals`* | `validate_before_edit` |
| *Muéstrame el contrato del componente `ButtonGroupSelection`* | `get_contract_specs` |
| *Haz un diagnóstico de `usePauta.tsx`* / *Analiza el componente `Board`* | `get_component_graph` + `get_legacy_impact` + `get_definitions` + `get_references` (usar MCP, no solo Read/Grep) |
| *¿Qué componentes usa `Board` y de qué depende?* | `get_component_graph` |
| *¿Qué funciones y componentes contiene el archivo `src/utils/format.ts`?* | `get_functions_in_file` |
| *¿Qué importa y exporta el archivo `Dashboard.tsx`?* | `get_import_graph` |
| *Muéstrame el contenido del archivo `api/cotizaciones.ts`* | `get_file_content` |
| *Busca en el código algo relacionado con "validación de precios"* | `semantic_search` |
| *Haz un diagnóstico de deuda técnica del proyecto* | `get_project_analysis` (modo diagnostico) |
| *Explícame cómo funciona el proceso de exportación a Excel en este repo* | `ask_codebase` |

### Refactorización segura

| Prompt | Herramienta |
|--------|-------------|
| *¿Dónde está definido el componente `DataTable`?* | `get_definitions` |
| *Encuentra todos los usos de la función `formatCurrency`* | `get_references` |
| *¿Qué firma, props y endpoints tiene la función `createQuote`?* | `get_implementation_details` |

### Código muerto

| Prompt | Herramienta |
|--------|-------------|
| *¿Qué funciones del proyecto nunca se llaman desde rutas o index?* | `trace_reachability` |
| *Identifica exports que no tienen importaciones en el monorepo* | `check_export_usage` |

### Análisis de impacto

| Prompt | Herramienta |
|--------|-------------|
| *Si modifico `UserForm`, ¿qué archivos y funciones se verían afectados?* | `get_affected_scopes` |
| *Voy a eliminar el parámetro `options` de `fetchData`. ¿Rompe algo?* | `check_breaking_changes` |

### Código sin duplicación

| Prompt | Herramienta |
|--------|-------------|
| *¿Existe ya código similar a "validación de email" en el proyecto?* | `find_similar_implementations` |
| *¿Qué config de Prettier y ESLint usa este proyecto?* | `get_project_standards` |

### Workflow

| Prompt | Herramienta |
|--------|-------------|
| *Dame el contexto completo del archivo `QuoteSummary.tsx`: contenido, imports y exports* | `get_file_context` |

---

**Antes de editar:** Pregunta primero *"¿Qué impacto tiene cambiar el componente X?"* o *"Valida antes de editar el componente X"*. La IA usará `validate_before_edit` y te dirá el contrato real.

**Fijar proyecto:** *"Crea .ariadne-project con el projectId del proyecto [nombre]"* — la IA listará proyectos, elegirá el correcto y creará el archivo.

**Si la IA no usa el MCP:** Sé más explícito. Ej.: *"Usa la herramienta get_project_analysis del MCP para hacer un diagnóstico de deuda técnica del proyecto oohbp2"* — fuerza el uso de la herramienta correcta.

---

## 7. Troubleshooting

| Síntoma | Solución |
|---------|----------|
| `Unexpected token '<', "<!doctype "... is not valid JSON` | **Rutas no enrutadas al MCP.** Cursor pide `/mcp` y `/.well-known/oauth-*`; si van al frontend, recibe HTML. En Dokploy: añadir rutas path **`/mcp`** y **`/.well-known`** → servicio `mcp-ariadne` puerto `8080`. Verificar: `curl -s https://ariadne.kreoint.mx/.well-known/oauth-authorization-server` → JSON, no HTML. |
| "Connection refused" | Verificar que ariadne.kreoint.mx/mcp responda; revisar ruta en Dokploy |
| 401 Unauthorized / "Token no proporcionado" | El MCP exige token M2M. Añadir en mcp.json: `"headers": { "Authorization": "Bearer m2m_xxx" }` (el admin te da el token) |
| "Nodo X no encontrado" | Reindexar: resync del repo desde la UI |
| Herramientas no aparecen | Reiniciar Cursor tras cambiar mcp.json |
| `projectId` desconocido | Ejecutar `list_known_projects` al inicio (o pedir *"Lista los proyectos indexados"*) |
| "Server already initialized" (en logs de Cursor) | **Resuelto:** el MCP usa modo stateless desde v1.0 (un Server+Transport por request). Si persiste, actualiza el MCP a la última versión y reinicia Cursor. |

---

[Skill AriadneSpecs](/ayuda/skills) · [Manual de uso](/ayuda/manual)
