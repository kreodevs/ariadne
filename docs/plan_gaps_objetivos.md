# Análisis de Brechas — Objetivos del Sistema

**Estado actual: sin brechas pendientes.**

Objetivos declarados:
1. Indexar varios proyectos
2. MCP puede acceder al conocimiento de cada proyecto
3. IA no se equivoque ni alucine al hacer cambios en legacy
4. Dev pueda hacer preguntas sobre el proyecto para entender el código
5. Generar manuales de usuario con ese conocimiento

---

## 1. Indexar varios proyectos

**Estado: ✅ Cubierto**

- Cada repo registrado se indexa como un `:Project` en FalkorDB (`projectId` = UUID del repo).
- Frontend permite registrar múltiples repos (Bitbucket/GitHub).
- Sync por repo con cola Redis.
- MCP tiene `list_known_projects` para listar proyectos indexados.

---

## 2. MCP accede al conocimiento de cada proyecto

**Estado: ✅ Corregido (2025-02)**

| Herramienta | Soporta projectId | Estado |
|-------------|-------------------|--------|
| `list_known_projects` | N/A | OK |
| `get_component_graph` | Sí (o `currentFilePath`) | OK |
| `get_legacy_impact` | Sí (o `currentFilePath`) | OK |
| `get_contract_specs` | Sí (o `currentFilePath`) | Corregido |
| `get_functions_in_file` | Sí (o `currentFilePath`) | Corregido |
| `get_import_graph` | Sí (o `currentFilePath`) | Corregido |

**Inferencia de projectId:** Mejorada en 4 pasos: (1) match exacto `rootPath`, (2) path como segmento de filesystem (`/repo-slug/`), (3) match por `File.path` como sufijo del path del IDE, (4) fallback match exacto de `File.path`. `get_functions_in_file` y `get_import_graph` aceptan path del grafo o del IDE (ruta absoluta); se resuelve automáticamente.

---

## 3. IA no alucine al hacer cambios legacy

**Estado: ✅ Cubierto (2025-02)**

**Implementado:**
- `get_legacy_impact` — qué se rompe si modificas un nodo.
- `get_contract_specs` — props reales del componente.
- `get_file_content` — contenido del archivo desde el repo (Bitbucket/GitHub).
- `validate_before_edit` — herramienta que devuelve impacto + contrato en un llamado.
- `POST /graph/shadow` + `GET /graph/compare` — validar código propuesto antes de aplicar.
- AGENTS.md: flujo SDD (consultar impacto y contratos antes de editar).
- **Regla Cursor** `.cursor/rules/legacy-sdd-validation.mdc` — obliga a ejecutar `validate_before_edit` antes de modificar componentes/funciones en archivos TS/TSX/JS/JSX.


---

## 4. Dev hace preguntas sobre el proyecto

**Estado: ✅ Cubierto (2025-02)**

- **Chat NL→Cypher:** `POST /repositories/:id/chat` — preguntas en lenguaje natural → Cypher → FalkorDB. Intent detection: project overview (qué hace el software), diagnóstico (complejidad, antipatrones). Retry si la query devuelve 0 resultados. Frontend: `/repos/:id/chat` con layout split (diagnósticos izquierda, chat derecha).
- **Análisis estructurado:** `POST /repositories/:id/analyze` — mode=diagnostico (top riesgo, antipatrones), duplicados (embeddings), reingeniería (plan priorizado).
- **MCP:** `semantic_search` — Búsqueda por palabra clave (siempre) + **búsqueda vectorial** (si hay embeddings):
  - `GET /embed?text=` en ingest — devuelve vector (requiere EMBEDDING_PROVIDER + OPENAI_API_KEY o GOOGLE_API_KEY).
  - `POST /repositories/:id/embed-index` — indexa embeddings en nodos Function y Component (FalkorDB 4.0+).
  - Si embedding está configurado, `semantic_search` usa `db.idx.vector.queryNodes` en FalkorDB; si no, fallback a keyword.
- **`get_file_content`** — contenido de archivos del repo.

---

## 5. Generar manuales de usuario

**Estado: ✅ Cubierto (2025-02)**

**Lo implementado:**
- JSDoc extraído en Component y Function (`description`).
- **Rutas React Router** — parser extrae `<Route path="..." element={<X />} />` → nodos `:Route` con path y componentName.
- `GET /graph/manual?projectId=` — markdown con proyectos, **flujo de rutas** (path → componente), componentes, descripciones y props.

---

## Resumen de prioridades

| Prioridad | Brecha | Estado |
|-----------|--------|--------|
| ~~Alta~~ | ~~Añadir `projectId` a tools MCP~~ | ✅ Hecho |
| ~~Alta~~ | ~~Mejorar inferencia projectId~~ | ✅ Hecho |
| Media | `get_file_content` | ✅ Hecho |
| Media | Validación pre-edit (regla + tool) | ✅ Hecho |
| Baja | Búsqueda semántica (keyword; RAG con embeddings ampliable) | ✅ Hecho |
| Baja | JSDoc + generador manuales | ✅ Hecho |

---

## Plan de corrección de brechas

### Fase 1 — Completada
- [x] Añadir `projectId` y `currentFilePath` a `get_contract_specs`, `get_functions_in_file`, `get_import_graph`.
- [x] Mejorar `inferProjectIdFromPath`: match por segmento filesystem, match por `File.path` como sufijo.

### Fase 2 — Medio plazo (anti-alucinación + contexto) ✅
- [x] **get_file_content** — `GET /repositories/:id/file?path=&ref=` en ingest. Tool MCP que llama al ingest (INGEST_URL).
- [x] **Regla de validación pre-edit** — AGENTS.md reforzado. Tool `validate_before_edit(nodeName, projectId?)` que devuelve impacto + contrato.

### Fase 3 — Largo plazo (Q&A y manuales) ✅
- [x] **semantic_search** — Búsqueda por palabra clave en Component, Function, File (sin embeddings; ampliable a RAG).
- [x] **Extracción JSDoc** — Parser extrae JSDoc anterior a componentes/funciones. `description` en Component, Function del grafo.
- [x] **Generador de manuales** — `GET /graph/manual?projectId=` devuelve markdown con proyectos, componentes, descripciones y props.

### RAG con embeddings ✅

Implementado. Requiere FalkorDB 4.0+ (vector support):
1. `EMBEDDING_PROVIDER=openai|google` + `OPENAI_API_KEY` o `GOOGLE_API_KEY` — para `GET /embed?text=` y `POST /repositories/:id/embed-index`.
2. Tras sync: `POST /repositories/:id/embed-index` — indexa embeddings en Function y Component, crea índices vectoriales.
3. `semantic_search` usa vector search cuando hay embeddings; fallback a keyword.
