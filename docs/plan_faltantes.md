# Plan: Faltantes (modelo, operación, calidad, opcional)

**Objetivo:** Ejecutar todos los ítems pendientes en los 4 bloques identificados. Orden por dependencias y valor.

**Estado:** Fase 0, 1, 2 y 4 completas. Pendiente: 3 (tests/CI).

---

## Fase 0: Precondiciones (calidad base) ✅

| # | Tarea | Detalle | Salida |
|---|--------|---------|--------|
| 0.1 | Arreglar tests Cartographer | Asegurar que `npm run test` en `services/cartographer` ejecute vitest (deps instaladas, config correcta). Añadir test de parser para `functions`/`calls` si falta. | Tests verdes en cartographer |
| 0.2 | Validar Bitbucket diff en ingest | Probar `getChangedPathsInCommit` con un repo real en Bitbucket Cloud; si el formato de diff difiere, adaptar el parseo de líneas o usar otro endpoint (p. ej. commits con `diffstat`). | Doc o fix en `BitbucketService` |

**Criterio de salida:** Tests cartographer pasan; ingest puede listar archivos cambiados por commit en Bitbucket Cloud.

---

## Fase 1: Modelo de grafo y parser

### 1.1 CALLS entre archivos ✅

| # | Tarea | Detalle | Salida |
|---|--------|---------|--------|
| 1.1.1 | Resolución de callee por import | En el parser (o en una capa post-parse por archivo): para cada `call_expression` que sea un identifier o `module.identifier`, resolver si viene de un import (named/default) y mapear a `(targetFilePath, exportName)`. Mantener un mapa repo-wide: por archivo, exports (nombre → tipo) para los que indexamos. | Estructura `resolvedCalls: { callerPath, callerName, calleePath, calleeName }[]` |
| 1.1.2 | Producer: CALLS cross-file | En el producer, además de CALLS mismo-archivo: para cada `resolvedCalls` con `calleePath` distinto, MERGE (caller:Function {path: callerPath, name: callerName}), MERGE (callee:Function {path: calleePath, name: calleeName}), MERGE (caller)-[:CALLS]->(callee). Asegurar que los Function de callee existan (archivo ya indexado o mismo batch). | Grafo con CALLS entre archivos |
| 1.1.3 | Orden de indexación | Para que los callee existan al crear CALLS: indexar en orden topológico de imports (archivos sin dependencias primero) o en dos pasadas (primera: todos los Function; segunda: todos los CALLS cross-file). | Sin CALLS rotos |

### 1.2 NestJS (módulos, controladores, servicios) ✅

| # | Tarea | Detalle | Salida |
|---|--------|---------|--------|
| 1.2.1 | Nodos y relaciones | Definir en `db_schema`: `:Module` (path, name), `:Controller` (path, name), `:Service` (path, name). Relaciones: File CONTAINS Module/Controller/Service; Module CONTAINS Controller/Service (o Module IMPORTS Module). | Esquema en docs |
| 1.2.2 | Parser NestJS | En parser (o módulo específico Nest): detectar `@Module()`, `@Controller()`, `@Injectable()` / `@Service()`, y metadatos (rutas, nombre de clase). Extraer `modules`, `controllers`, `services` con path y nombre. Opcional: rutas HTTP por controlador. | ParsedFile.nestModules, nestControllers, nestServices |
| 1.2.3 | Producer NestJS | MERGE Module/Controller/Service con path+name; (File)-[:CONTAINS]->(Module|Controller|Service); (Module)-[:DECLARES]->(Controller|Service) según imports del módulo. | Grafo NestJS poblado |
| 1.2.4 | MCP/API | Herramienta MCP opcional: `get_nest_dependencies(controllerName)` o exponer en API `GET /graph/nest/controller/:name`. | IA puede consultar estructura Nest |

### 1.3 Strapi v4 ✅

| # | Tarea | Detalle | Salida |
|---|--------|---------|--------|
| 1.3.1 | Nodos Strapi | Definir `:ContentType`, `:Controller` (Strapi), `:Service` (Strapi), rutas API. Relaciones con File. | Esquema en docs |
| 1.3.2 | Parser Strapi | Detectar schemas en `src/api/**/content-types`, controllers en `src/api/**/controllers`, services en `src/api/**/services`; extraer nombres y rutas. | ParsedFile.strapiContentTypes, strapiControllers, strapiServices |
| 1.3.3 | Producer + consultas | MERGE nodos y relaciones; opcionalmente herramienta MCP o endpoint para “qué controladores usan este service”. | Grafo Strapi poblado y consultable |

**Criterio de salida Fase 1:** CALLS cross-file operativos; grafo opcionalmente con Nest y Strapi según prioridad de producto.

---

## Fase 2: Operación y producto

### 2.1 Frontend mínimo ✅

| # | Tarea | Detalle | Salida |
|---|--------|---------|--------|
| 2.1.1 | Stack y repo | Decidir stack (React + Vite, Next, o estático). Crear frontend en raíz (`frontend/`) con app que apunte a la API del ingest (base URL configurable). | Proyecto frontend creado |
| 2.1.2 | Listado de repos | Página que llame `GET /repositories`, muestre tabla (provider, projectKey, repoSlug, status, lastSyncAt). | UI listado repos |
| 2.1.3 | Detalle repo + sync | Detalle por repo: `GET /repositories/:id`; botón “Sync” que llame `POST /repositories/:id/sync`. Mostrar último job (sync_jobs) y estado. | UI sync manual |
| 2.1.4 | Listado de jobs | Para un repo, listar `sync_jobs` (tipo, status, startedAt, finishedAt, error_message). Si la API no expone `GET /repositories/:id/jobs`, añadir endpoint en ingest. | UI jobs por repo |
| 2.1.5 | Alta de repo | Formulario para `POST /repositories` (provider, projectKey, repoSlug, defaultBranch). | UI crear repo |
| 2.1.6 | Docker e integración | Servir frontend (build estático o dev) y documentar en README; opcionalmente añadir servicio en docker-compose con nginx o el mismo dev server. | Acceso vía URL en entorno local/prod |

### 2.2 Migraciones TypeORM (ingest) ✅

| # | Tarea | Detalle | Salida |
|---|--------|---------|--------|
| 2.2.1 | Script de migración | En `services/ingest`: script npm que use DataSource de TypeORM y ejecute `runMigrations()`. Asegurar que `data-source.ts` (o equivalente compilado) cargue entidades y carpeta de migraciones. | `npm run migration:run` funcional |
| 2.2.2 | Entorno prod | En Dockerfile o arranque del contenedor ingest: si `NODE_ENV=production` y existe script, ejecutar migraciones antes de `node dist/main.js`, o documentar que el operador debe ejecutar migraciones una vez. | Migraciones aplicadas en prod |
| 2.2.3 | Desactivar synchronize en prod | Confirmar que en producción TypeORM usa `synchronize: false` (ya condicionado por NODE_ENV en app.module). | Sin auto-sync en prod |

### 2.3 Validación de webhook Bitbucket ✅

| # | Tarea | Detalle | Salida |
|---|--------|---------|--------|
| 2.3.1 | Documentar firma Bitbucket | Revisar docs de Bitbucket Cloud/Server: si el webhook envía header de firma (p. ej. `X-Hub-Signature`, `X-Request-Signature`) y algoritmo. | Nota en `docs/bitbucket_webhook.md` |
| 2.3.2 | Implementar verificación | En `WebhooksController` o `WebhooksService`: si `BITBUCKET_WEBHOOK_SECRET` está definido, leer body crudo (requiere raw body en Nest), calcular HMAC y comparar con header. Si no coincide, responder 401. | Webhook rechaza requests no firmados cuando hay secret |
| 2.3.3 | Probar con webhook real | Crear webhook en Bitbucket con secret y enviar push; verificar que ingest acepta y que un payload manipulado es rechazado. | Validación verificada |

**Criterio de salida Fase 2:** Frontend operativo para repos y syncs; migraciones ejecutables en prod; webhook validado cuando hay secret.

---

## Fase 3: Calidad y robustez (complementos)

| # | Tarea | Detalle | Salida |
|---|--------|---------|--------|
| 3.1 | Tests ingest | Añadir tests unitarios (o de integración) en `services/ingest`: BitbucketService (mock de fetch), SyncService (mock FalkorDB + repo), parser/producer con fixtures. | Suite de tests ingest |
| 3.2 | Tests API | Tests para GraphController/GraphService (mock FalkorService y CacheService) y para AppController (openapi, health). | Suite de tests API |
| 3.3 | CI (opcional) | Pipeline (GitHub Actions u otro) que ejecute tests de cartographer, ingest y api; y build de todos los servicios. | CI definido y pasando |

---

## Fase 4: Opcional / consolidación ✅

| # | Tarea | Detalle | Salida |
|---|--------|---------|--------|
| 4.1 | Mover /shadow al ingest ✅ | Implementar `POST /shadow` en el servicio ingest (mismo pipeline parse→producer, grafo FalkorSpecsShadow). Actualizar API para que `CARTOGRAPHER_URL` apunte al ingest o a una variable `INGEST_URL`. Opcionalmente deprecar o eliminar el contenedor cartographer en docker-compose. | Un solo servicio para ingesta + shadow |
| 4.2 | Herramienta MCP extra ✅ | Añadir en MCP una herramienta p. ej. `get_functions_in_file(path)` o `get_import_graph(filePath)` que consulte el grafo (File CONTAINS Function, File IMPORTS File) y devuelva markdown. | Nueva tool MCP documentada y usable |
| 4.3 | README services ✅ | Crear `services/README.md` con tabla: servicio, puerto, responsabilidad, cómo levantar (docker o local). | Índice de servicios en repo |

---

## Orden sugerido de ejecución

1. **Fase 0** (precondiciones): 0.1 → 0.2.
2. **Fase 1**: 1.1 (CALLS cross-file) → después 1.2 (Nest) y 1.3 (Strapi) según prioridad.
3. **Fase 2**: 2.2 (migraciones) y 2.3 (webhook) en paralelo; 2.1 (frontend) cuando se quiera exponer la operación.
4. **Fase 3**: en paralelo o después de estabilizar 1 y 2.
5. **Fase 4**: cuando convenga (consolidar shadow, MCP extra, README).

---

## Dependencias entre fases

- Fase 1.1 (CALLS cross-file) puede depender de 0.1 si los tests del parser son la base para no regresar.
- Fase 2.1 (frontend) puede consumir endpoints que aún no existan (p. ej. `GET /repositories/:id/jobs`); en ese caso añadir esos endpoints en ingest dentro del mismo 2.1.
- Fase 4.1 (shadow en ingest) es independiente; se puede hacer en cualquier momento una vez el ingest esté estable.

---

## Resumen por bloque

| Bloque | Ítems | Fases |
|--------|--------|--------|
| 1. Modelo | CALLS cross-file, NestJS, Strapi | 1.1, 1.2, 1.3 |
| 2. Operación | Frontend, migraciones, webhook | 2.1, 2.2, 2.3 |
| 3. Calidad | Tests cartographer, Bitbucket diff, tests ingest/API, CI | 0.1, 0.2, 3.x |
| 4. Opcional | Shadow en ingest, MCP extra, README services | 4.1, 4.2, 4.3 |

Este documento sirve como checklist; se puede ir tildando en el repo o en un issue/epic por fase.
