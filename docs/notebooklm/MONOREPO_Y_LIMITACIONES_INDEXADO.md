# Monorepos y limitaciones del indexado AriadneSpecs

Este documento explica limitaciones históricas del indexado en **monorepos** y cómo mitigarlas. **Actualización:** el sync indexa **Prisma** (`prisma-extract` → nodos `Model`/`Enum`), **OpenAPI** (`swagger.json` / `openapi.yaml` → `OpenApiOperation`), **TypeORM** (`@Entity` → `Model` con `source=typeorm`), **`tsconfig` / `.env.example`** como `File` con `fileRole`, y **`manifestDeps`** incluye `depKeys` + `scripts`. El chat **`ask_codebase`** con **`responseMode: evidence_first`** devuelve un **JSON MDD** de 7 secciones y, si el retriever viene vacío pero hay archivos en índice, **inyecta** lecturas mínimas (`package.json`, prisma, env, openapi, etc.) para no responder en vacío.

---

## 1. Estructura típica de un monorepo

```
repo/
├── apps/
│   ├── admin/     # React frontend
│   ├── api/       # NestJS backend
│   └── worker/    # Procesamiento AI
├── libs/          # Código compartido
├── prisma/        # Schema de BD (schema.prisma)
└── package.json
```

**Por defecto** (`repositories.index_include_rules` = `null`), el indexador considera **todo el repo** desde la raíz: entran los paths que pasan el filtro global (`shouldSyncIndexPath` en `sync-path-filter.ts`). No hay exclusión automática de `apps/` o `libs/`. Los paths en el grafo son relativos al repo: `apps/admin/src/App.tsx`, `libs/shared/src/utils.ts`.

### 1.1 Alcance del índice por repositorio (opcional)

Puedes **restringir** qué se indexa por repo (columna **`index_include_rules`**, JSONB; **`PATCH /repositories/:id`** con `indexIncludeRules`; UI **Editar** en `/repos/:id/edit`):

| Valor | Comportamiento |
|--------|----------------|
| **`null`** | Igual que siempre: todo el repo sujeto a `shouldSyncIndexPath` (más exclusiones e2e/migrations/tests según env). |
| **`{ "entries": [] }`** | Solo manifiestos/código en **raíz**: `package.json` y archivos en la raíz del repo (un solo segmento de path, sin dotfile inicial) con extensión `.json`, `.js`, `.ts`, `.jsx`, `.tsx` (p. ej. `tsconfig.json`). |
| **`{ "entries": […] }`** | Lo anterior **más** cada entrada: **`kind: "path_prefix"`** + `path` → todo lo indexable bajo ese prefijo; **`kind: "file"`** + `path` → ese archivo aunque solo no pasara el filtro global. |

Los prefijos y archivos explícitos **no** desactivan exclusiones de seguridad (`node_modules`, `.git`, `dist`, etc.). Tras cambiar reglas conviene **Re-sincronizar** el repo. El webhook incremental Bitbucket aplica la misma lógica (`index-include-rules.ts`). Si el sync usa API (sin clone), **`listRootFiles`** en GitHub/Bitbucket completa manifiestos en raíz.

---

## 2. Por qué a veces faltan resultados (y qué está cubierto ahora)

### 2.1 Prisma y modelos de datos

| Aspecto | Detalle |
|---------|---------|
| **Parser Tree-sitter** | Solo `.js`, `.jsx`, `.ts`, `.tsx` en el pipeline AST genérico |
| **Prisma** | Los `.prisma` se indexan en **sync** vía **`prisma-extract`** (`@prisma/internals` / DMMF) → nodos **`Model`**, **`Enum`**, relaciones, **`fieldSummary`** |
| **Herramientas** | Cypher `MATCH (m:Model)` con `m.source = 'prisma'`; `ask_codebase` / MDD incluyen entidades desde el grafo |

Si tras un **resync** aún no ves modelos, revisa que el job de sync haya completado y que el path del schema esté en el repo (p. ej. `prisma/schema.prisma`).

### 2.2 NestController y NestService

| Aspecto | Detalle |
|---------|---------|
| **Nodos en grafo** | `NestController`, `NestService`, `NestModule` sí se crean |
| **semantic_search** | Solo consulta **Function**, **Component** y **File** |
| **Embed-index** | Solo genera embeddings para **Function** y **Component** |

Los controladores (`AuthController`, `AppController`) y servicios existen en el grafo, pero **no se incluyen en la búsqueda semántica** ni en el índice vectorial. Por eso "API routes endpoints controllers" devuelve vacío.

### 2.3 Model (clases de datos en TS)

| Aspecto | Detalle |
|---------|---------|
| **Nodos Model** | Se crean para clases en `*Model` o en paths `/models/` |
| **semantic_search** | No consulta el label `Model` |
| **Embed-index** | No indexa nodos `Model` |

Clases como `UserModel` en `libs/db/src/models/user.model.ts` se indexan como `Model`, pero la búsqueda semántica no los tiene en cuenta.

### 2.4 Componentes React

Los componentes (`Button`, `Card`, `App`) sí están en el grafo y se indexan para embeddings. Si "UI components screens" devuelve vacío, es probable que:

- El **embed-index** no se haya ejecutado tras el sync, o
- El **projectId** que usa la herramienta no coincida con el del repo indexado.

---

## 3. Flujo recomendado para monorepos

### Antes de generar documentación

1. **Sync completo**: `POST /repositories/:id/resync` para reindexar el repo.
2. **Embed-index**: Se ejecuta tras el sync si `EMBEDDING_PROVIDER` y `OPENAI_API_KEY` están configurados. Verificar en el job del sync que el embed-index termine sin errores.
3. **projectId**: Usar el **Repository ID** (`roots[].id` de `list_known_projects`) para el monorepo como un solo proyecto.

### Herramientas MCP alternativas

En vez de depender solo de `semantic_search`:

| Necesidad | Herramienta | Notas |
|-----------|-------------|-------|
| Proyectos/repos | `list_known_projects` | Obtener IDs correctos |
| Rutas NestJS | `get_graph_summary` (ingest) o Cypher directo | NestController tiene `route` |
| Componentes | `get_component_graph`, `get_contract_specs` | Mejor que `semantic_search` para componentes |
| Modelos TS | `get_definitions` con symbol `*Model` | Para clases en `/models/` |
| Prisma / esquema BD | `get_file_content` | Path `prisma/schema.prisma`. TypeORM: `execute_cypher` MATCH (m:Model) → `get_file_content` en path. El chat tiene hints ORM-agnósticos. |

### Scope para acotar búsquedas en monorepos

Las herramientas `ask_codebase` y `get_modification_plan` aceptan **scope** para filtrar por paths:

```json
{
  "scope": {
    "includePathPrefixes": ["apps/api", "libs/db"],
    "excludePathGlobs": ["**/*.test.ts", "**/__mocks__/**"],
    "repoIds": ["uuid-repo-frontend"]
  }
}
```

**Ejemplos por sección del MDD:**

| Sección MDD | Scope sugerido | Motivo |
|-------------|----------------|--------|
| Modelos, API, BD | `includePathPrefixes: ["apps/api", "libs", "prisma"]` | Solo backend y schemas |
| Componentes UI, pantallas | `includePathPrefixes: ["apps/admin"]` | Solo frontend |
| Reglas de negocio | `includePathPrefixes: ["libs/shared", "apps/api"]` | Código compartido y API |
| Tests (si INDEX_TESTS=true) | `includePathPrefixes: ["**/*.test.*", "**/*.spec.*"]` | Solo archivos de test |

> **Nota:** `includePathPrefixes` actúa como filtro: si se especifica, solo se consideran paths que empiecen por alguno de los prefijos. Para Prisma usar `get_file_content` explícitamente; no está en el grafo.

---

## 4. Mejoras posibles (roadmap)

### Implementado (gaps resueltos)

1. **`semantic_search` extendido**: Incluye Model, NestController, NestService, NestModule, Route, DomainConcept además de Function, Component y File.
2. **Tests**: Con `INDEX_TESTS=true` (env en ingest), se indexan `*.test.*` y `*.spec.*`.
3. **Truncado configurable**: `TRUNCATE_PARSE_MAX_BYTES` (env en ingest, default 25000).
4. **Scope documentado**: Ver sección 3 arriba.

### Medio plazo

3. **Añadir Prisma al indexado**: Incluir `.prisma` en extensiones y crear un parser que extraiga modelos, enums y relaciones a nodos del grafo.
4. **Extender embed-index**: Generar embeddings para `Model`, `NestController`, `NestService` para que la búsqueda vectorial los incluya.

---

## 5. Verificación rápida

Para comprobar si el repo está bien indexado:

```cypher
# Nodos por tipo (en FalkorDB o vía get_graph_summary)
MATCH (n) WHERE n.projectId = $projectId RETURN labels(n)[0] AS tipo, count(*) AS c
```

Si hay `NestController` y `NestService` con cuenta > 0, el indexado de NestJS está correcto. El límite está en qué nodos usa `semantic_search`, no en el sync.

---

## 6. Gaps restantes

| Gap | Estado | Notas |
|-----|--------|-------|
| **Route, NestModule, DomainConcept** | ✅ Resuelto | Incluidos en `semantic_search` (keyword fallback). |
| **Tests** | ✅ Resuelto | `INDEX_TESTS=true` en ingest para indexar `*.test.*`, `*.spec.*`. |
| **Scope** | ✅ Documentado | Ver sección 3; ejemplos por sección MDD. |
| **Truncado** | ✅ Configurable | `TRUNCATE_PARSE_MAX_BYTES` (env ingest, default 25000). |
| **Path aliases (tsconfig)** | ⚠️ Parcial | Ver sección 6.1. |
| **Otras extensiones (.css, .md, .graphql)** | 📋 Roadmap | Ver sección 6.2: CSS (variables, tokens), MD (docs, ADR), GraphQL (parser específico). |

### 6.1 Path aliases en monorepos

El sync usa **solo** `tsconfig.json` o `jsconfig.json` en la **raíz del repo**. No resuelve `extends`; si los `paths` están solo en `tsconfig.base.json` y el root solo extiende, el sync no los verá.

#### Flujo de resolución

1. **Relativos** (`./foo`, `../lib/utils`) → resueltos por path del archivo importador.
2. **Paths de tsconfig** (`@repo/shared`, `libs/api`) → `resolveWithTsconfig` + `baseUrl` generan candidatos.
3. **Alias @/** → fallback heurístico: `src/`, `lib/`, `app/` según si hay carpeta `src` en el path.

Orden de candidatos: se prueba cada uno contra `pathSet` (archivos indexados); el primer match crea la relación IMPORTS.

#### Ejemplo monorepo

```json
// tsconfig.json o tsconfig.base.json en raíz
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@repo/shared": ["libs/shared/src"],
      "@repo/shared/*": ["libs/shared/src/*"],
      "@api/*": ["apps/api/src/*"]
    }
  }
}
```

Para `import { utils } from '@repo/shared/utils'` en `apps/admin/src/App.tsx`:
- Candidatos: `libs/shared/src/utils`, `libs/shared/src/utils.ts`, etc.
- Si existe `libs/shared/src/utils.ts` en pathSet → IMPORTS se crea.

**Importante:** Los paths del mapping deben coincidir con la estructura real. Si tu alias apunta a `libs/shared/*` pero los archivos están en `libs/shared/src/*`, ajusta el mapping.

#### Limitación: extends no resuelto

Si el root tiene solo `{"extends": "./tsconfig.base.json"}` y los `paths` están en el base, el sync **no** hereda esos paths. Workaround:

- Añadir `compilerOptions.paths` en el `tsconfig.json` raíz (aunque duplique), o
- Implementar resolución de `extends` en el ingest (roadmap).

#### Checklist si IMPORTS fallan

| Paso | Verificación |
|------|--------------|
| 1 | ¿Existe `tsconfig.json` o `jsconfig.json` en la raíz? |
| 2 | ¿Tiene `compilerOptions.paths` (o está en el archivo que extiende, con la limitación anterior)? |
| 3 | ¿Los archivos referenciados existen bajo `libs/` o `apps/` y están en el pathSet del sync? |
| 4 | ¿El mapping usa wildcards correctos? (`@repo/*` → `libs/shared/*` con `*` en ambos lados). |

**Cypher para comprobar IMPORTS:**

```cypher
MATCH (a:File)-[:IMPORTS]->(b:File)
WHERE a.projectId = $projectId
RETURN a.path AS from, b.path AS to
LIMIT 20
```

Si ves muchos `to = null` o imports que deberían resolverse y no aparecen, revisar tsconfig.

### 6.2 Otras extensiones (CSS, MD, GraphQL)

| Extensión | Casos de uso | Estado actual | Próximos pasos |
|-----------|--------------|---------------|----------------|
| **.css** | Variables (`--color-primary`), design tokens, módulos CSS, selectores por componente | No indexado. `get_file_content(path)` para leer archivos concretos. | Roadmap: `INDEX_CSS=true` → nodos File, extractor opcional de variables/selectores para scope y búsqueda. |
| **.md** | README, docs, ADRs, guías de contribución, convenciones | No indexado. `get_file_content(path)` para docs concretos. Chat puede incluir README vía fuentes. | Roadmap: `INDEX_MD=true` → nodos File, chunking por secciones para RAG en ask_codebase. |
| **.graphql / .gql** | Schemas, queries, mutations | No indexado | Roadmap: parser específico (tree-sitter-graphql o extractor de tipos/operaciones). |

**CSS:** Útil para "qué variables de diseño usa el proyecto", "qué componentes usan X clase". Hoy: ruta fija con `get_file_content`.

**MD:** Útil para "qué convenciones documenta el README", "qué ADRs hay". Hoy: `get_file_content("README.md")` o paths conocidos.

---

## 7. Referencias

- [db_schema.md](db_schema.md) — Nodos Falkor y tablas PostgreSQL
- [mcp_server_specs.md](mcp_server_specs.md) — Herramientas MCP
- [chat/README.md](../services/ingest/src/chat/README.md) — Scope, monorepos, prefijos
- [pipeline/README.md](../services/ingest/src/pipeline/README.md) — Proceso de indexado
