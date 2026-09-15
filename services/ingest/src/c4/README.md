# C4 (Entregas 1–3)

Pipeline: dominios / docker-compose / Falkor → `C4Model` → Archify HTML.

## Niveles

| Nivel | Fuente | Generador |
| ----- | ------ | --------- |
| **context** | `project.domainId`, `project_domain_dependencies`, `domain_domain_visibility`, multi-root | `sync` o `hybrid` (LLM opcional) |
| **container** | `docker-compose` (probe remoto si no está indexado), `pnpm-workspace.yaml`, `package.json` workspaces, o front/back suelto | `sync` |
| **component** | Subgrafo Falkor por `pathPrefix` del container (`IMPORTS`, `RENDERS`, rutas web) | `sync` |

## Configuración

**Ajustes → Sistema → pestaña «C4 / Diagramas»** (`system_settings`):

| Campo | Efecto |
| ----- | ------ |
| **C4 habilitado** | MERGE `:System`/`:Container` en Falkor durante sync |
| **Generar tras full sync** | Snapshot Context + Container + HTML Archify al terminar sync |
| **Ruta Archify CLI** | Opcional; vacío = autodetect `/opt/archify` (Docker: release pin `ARCHIFY_VERSION` en Dockerfile) |

## API

- `GET /projects/:id/c4?level=context|container|component` — JSON `C4Model` + `htmlReady` + `snapshotId`
- `POST /projects/:id/c4/generate` — body `{ level?, levels?, useLlm?, containerKey? }`
- `GET /projects/:id/c4/html?level=…` — HTML Archify (re-render lazy desde `archify_json` si el fichero falta en disco)
- `GET /projects/:id/c4/snapshots?level=&limit=` — historial
- `GET /projects/:id/c4/diff?from=&to=` — diff JSON + HTML Archify compare

`detect_changes` incluye `c4TopologyChanged` si los dos últimos snapshots container difieren en `contentHash`.

`useLlm` solo aplica a **context**: añade actores `person` y descripciones con evidencia `source: llm` (requiere API key en Ajustes → IA).

## Secuencia API (3.2)

- `GET /projects/:id/c4/sequence/routes` — rutas React indexadas (pantalla + API Nest si hay enlace)
- `POST /projects/:id/c4/sequence/generate` — flujo Route → API → backend (`body.routePath` opcional)
- `GET /projects/:id/c4/sequence/html` — HTML Archify sequence

Antes de invocar Archify CLI, `C4ArchifyRenderer` aplica `c4-archify-ir-fix.ts` (ingest: labels `org/repo`, sin self-loops, sin label `RENDERS`/`IMPORTS`/`CALLS` en componentes) y luego `sanitizeArchifySequenceIr` / `sanitizeArchifyArchitectureIr` (`ariadne-common`, incluye reflow del grid tras ensanchar componentes, normalización de `component.id` al patrón Archify `^[a-zA-Z][a-zA-Z0-9_-]*$` — p. ej. `8ca79cef_application` → `c_8ca79cef_application` — y deduplicación). Repos sin compose: se infiere **Web UI** (React/Vite) o **API** (NestJS) desde `package.json` raíz; en multi-root se enlaza front→back con **REST**. Los ids de componente Falkor usan hash estable (`compElementId`) para paths largos. Tras `validate`, usa `deliver` si el CLI lo soporta; si no, cae a `render` (Archify v2.9 en Docker). `npm run build` en ingest ejecuta `prebuild` de `ariadne-common`.

## Export / chat / parity

- `GET /projects/:id/c4/export` — 6 markdowns + `merged`
- `POST /internal/projects/:id/architecture-diagram` — respuesta chat
- Brownfield parity pack incluye `c4ContainerHtmlUrl`, `c4ContextHtmlUrl`, `c4ModelJson`

## Monorepos (pnpm / compose)

- El sync indexa `docker-compose.ya?ml` y `pnpm-workspace.yaml` (manifiestos de infra).
- **Container:** si hay `docker-compose`, los servicios del compose tienen prioridad; los workspaces pnpm solo se usan cuando no hay compose.
- Si el compose no está en `indexed_files` (sync previo), el escáner intenta leerlo del remoto vía `getFileContent`.
- **pathPrefixes** en servicios compose: se infieren desde `build.context`, `dockerfile` y carpetas existentes (`backend/`, `apps/<nombre>/`, etc.).

Ver [PLAN_C4_ARCHIFY.md](../../../docs/notebooklm/PLAN_C4_ARCHIFY.md).
