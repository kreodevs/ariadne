# Plan de implementación: Fase 6 — `AnalyticsService` y análisis multi-root

Objetivo: una **única capa de entrada** para análisis estructurado (deuda, duplicados, reingeniería, código muerto, seguridad) que **resuelva el `repositoryId` correcto** cuando el cliente envía `projectId` Ariadne y/o una ruta de IDE, sin duplicar reglas entre MCP e ingest.

**Implementación (referencia en código):**

- `ChatService.analyze` sigue siendo el motor; `POST /repositories/:id/analyze` (`ChatController`) exige `:id` = **repositorio**.
- **`AnalyticsService`** (`services/ingest/src/chat/analytics.service.ts`): `resolveRepositoryIdForAnalysis` + `analyzeByProjectId` → `chat.analyze`.
- `ProjectChatController` `POST /projects/:projectId/analyze` enruta `agents`/`skill` a `analyzeByProject` y modos de código a `AnalyticsService`.
- `GET /projects/:id/resolve-repo-for-path` y `ProjectsService.resolveRepoForPath` siguen siendo la heurística de path.
- `JobAnalysisService` (jobs incrementales) sigue **fuera de alcance** salvo que se reutilice el mismo resolvedor.

---

## 0. Decisiones de producto — **cerradas (aceptadas)**

1. **Multi-root:** por defecto **un solo `repositoryId` objetivo** — mono-repo → único repo; varios repos → `idePath` + `resolveRepoForPath`; si sigue sin resolverse → **400** con mensaje claro (pedir `repositoryId` o ruta más específica). **No** analizar todos los repos en serie ni merge de informes salvo **demanda explícita** y un modo/API aparte (futuro).
2. **Resolución:** **ingest** es fuente de verdad; el cliente (MCP u otro) envía `projectId` Ariadne y opcionalmente `idePath` / `repositoryId`; no duplicar heurística solo en el cliente.
3. **Implementación v1:** **fachada** `AnalyticsService` que delega en `ChatService.analyze`; refactor grande del `ChatService` queda para una v2.

Documentar estas reglas en `services/ingest/README.md` o `chat/README.md` al implementar el endpoint.

---

## 1. Fachada `AnalyticsService` (ingest)

**Ubicación:** `services/ingest/src/chat/analytics.service.ts` (provider en `ChatModule`).

**Responsabilidades:**

1. **`resolveRepositoryIdForAnalysis(input)`**  
   Entrada: `{ repositoryId?: string; projectId?: string; idePath?: string }` (no todas obligatorias; validar combinaciones).

   Reglas sugeridas (orden):

   - Si viene **`repositoryId`**: comprobar que existe en BD; devolverlo (opcional: comprobar que pertenece a `projectId` si ambos vienen).
   - Si viene solo **`projectId`**:
     - Cargar repos del proyecto (`ProjectsService` / repositorios asociados).
     - Si **un solo repo** → ese `repositoryId`.
     - Si **varios** y hay **`idePath`** → `ProjectsService.resolveRepoForPath(projectId, idePath)`; si `repoId` null → error400 con mensaje claro (“especifica repo o idePath más concreto”).
     - Si **varios** y no hay `idePath` → error 400 (“multi-root: requiere repositoryId o idePath”).

2. **`runAnalysis(repositoryId, mode)`**  
   Delegar en `ChatService.analyze(repositoryId, mode)` (sin copiar lógica).

**Tests unitarios mínimos:** `resolveRepositoryIdForAnalysis` con fixtures en memoria (mock de repos del proyecto) y casos: mono-repo, multi-root + path que matchea slug, multi-root sin path (error esperado).

---

## 2. API HTTP

**Opción recomendada (compatibilidad):** mantener `POST /repositories/:id/analyze` como está (**`:id` = repo**).

**Añadir** (nuevo):

- `POST /projects/:projectId/analyze`  
  - Body: `{ mode, idePath?: string, repositoryId?: string }`  
  - Flujo: `AnalyticsService.resolveRepositoryIdForAnalysis` → `runAnalysis`.

**Ampliar** `ProjectChatController` (ya existe `POST :projectId/analyze` para modos `agents`/`skill`):

- O **unificar** en un solo handler con `mode` discriminado (cuidado con rutas duplicadas en Nest: un solo `@Post` y switch de modo),  
- O mantener rutas separadas: p. ej. `POST .../analyze-code` para modos de código y dejar `analyze` actual para agents/skill.

**Criterio:** no romper clientes que ya llaman `POST /projects/:id/analyze` con body `{ mode: 'agents' | 'skill' }`.

---

## 3. MCP (`get_project_analysis`)

1. Añadir **`currentFilePath`** (opcional) al contrato de la herramienta si aún no basta con `projectId`.
2. Lógica:
   - Si el `projectId` que pasa el usuario es **proyecto Ariadne** (conocido por `list_known_projects`: `id` vs `roots[].id`), preferir **`POST /projects/:projectId/analyze`** con `idePath: currentFilePath` cuando no se pase explícitamente `roots[].id`.
   - Si el usuario pasa **`roots[].id`** (repo), seguir usando **`POST /repositories/:id/analyze`** (cero cambio de comportamiento).

3. Opcional: endpoint único en ingest que acepte siempre `projectOrRepoId` + `idePath` y resuelva internamente (menos bifurcación en MCP); puede ser fase 2.

---

## 4. Documentación y contrato

- Actualizar `services/ingest/README.md` y `services/ingest/src/chat/README.md`: tabla **qué es `:id`** en cada ruta.
- Actualizar `services/mcp-ariadne/README.md`: cuándo usar `projectId` de proyecto vs repo para **get_project_analysis**.
- En `Plan_Autonomia_Ariadne.md` § Fase 6: enlace a este documento y checklist `[ ]` → `[x]` por hito.

---

## 5. Orden de trabajo (hitos)

| Orden | Hito | Entregable |
|-------|------|------------|
| 1 | Decisiones §0 | Nota en README |
| 2 | `AnalyticsService` + tests de resolución | Servicio en `chat/analytics.service.ts` (tests automatizados de resolución opcionales / pendientes) |
| 3 | `POST /projects/:projectId/analyze` (modos de código) | Hecho (`ProjectChatController`) |
| 4 | MCP `get_project_analysis` | Hecho (`ingestProjectExists` + `idePath`) |
| 5 | QA manual | Script + guía: [QA_Fase6_Resultado.md](./QA_Fase6_Resultado.md), `scripts/qa-fase6-analytics.sh` |
| 6 | `JobAnalysisService` + ruta por proyecto | `analyzeJobForProject` + `GET /projects/:projectId/jobs/:jobId/analysis` (validación `project_repositories`); tests `job-analysis.service.spec.ts` |

---

## 6. Riesgos y mitigación

- **Ambigüedad multi-root sin path:** mitigar con 400 explícito y mensaje que cite `resolve-repo-for-path` o `roots[].id`.
- **Doble mantenimiento MCP/ingest:** priorizar resolución en **ingest**; MCP solo envía `idePath`.
- **Refactor grande de `ChatService`:** aplazar; la fachada evita el big-bang.

---

## 7. Definición de “Fase 6 hecha”

- [x] Existe `AnalyticsService` con resolución centralizada de `repositoryId` (`services/ingest/src/chat/analytics.service.ts`).
- [x] Ruta documentada **análisis por `projectId` + `idePath` / `repositoryId` opcional** (`POST /projects/:projectId/analyze` para modos de código).
- [x] `get_project_analysis` en MCP usa proyecto vs repo (`ingestProjectExists`) y envía `idePath` cuando aplica.
- [x] Tests Vitest: `services/ingest/src/chat/analytics.service.spec.ts` (resolución mono/multi-root, `repositoryId`, delegación a `chat.analyze`).
- [x] Análisis de job incremental por proyecto: `GET /projects/:projectId/jobs/:jobId/analysis` (`JobAnalysisService.analyzeJobForProject`); Vitest `services/ingest/src/repositories/job-analysis.service.spec.ts`.
