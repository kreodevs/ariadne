# Pipeline de ingesta (FalkorDB)

- **parser.ts** — Tree-sitter: TS/JS/JSX, componentes, Nest, rutas React Router (`RouteInfo.enclosingComponent`), **entidades TypeORM** (`@Entity` → `:Model` con `source=typeorm` + `fieldSummary`), **tsconfig.json** / **.env.example** (nodo `File` con `fileRole`). Los **`.prisma`** no se parsean aquí: **`prisma-extract.ts`** en sync. `Parser.parse` usa `bufferSize` acorde al tamaño UTF-8 del archivo (el binding por defecto ~32 KiB lanza `Invalid argument` si el código es más largo). Si aún falla, fallback truncado (`TRUNCATE_PARSE_MAX_BYTES`).
- **storybook-documentation.ts** — Detección de rutas Storybook, parseo MDX/MD y markdown general (`README`, `docs/`, …).
- **producer.ts** — Cypher (`File`, `Component`, `Function`, `StorybookDoc`, `MarkdownDoc`, `IMPORTS`, `RENDERS` desde JSX y desde `<Route element={…}/>` hacia la página, `STORYBOOK_*`, `MARKDOWN_*`, …).
- **tsconfig-resolve.ts** — Merge de `tsconfig`/`jsconfig` con `extends` (TypeScript API) para aliases en imports (docs → `*_TARGETS_FILE`).
- **prisma-extract.ts** — `getDMMF` (`@prisma/internals`): nodos `Model`, `Enum`, relaciones `RELATES_TO` / `USES_ENUM`; propiedad `fieldSummary` (JSON de campos).
- **openapi-spec-ingest.ts** — `swagger.json` / `openapi.{yaml,yml,json}`: `File.openApiTruth`, nodos `OpenApiOperation`, relación `DEFINES_OP` (fuente de verdad API / MDD §4).
- **markdown-chunk.ts** / **markdown-graph.ts** — Utilidades legadas (`Document` + `HAS_CHUNK`); el sync actual indexa markdown vía **`MarkdownDoc`** en producer, no por este par.
- **project.ts**, **falkor.ts**, **domain-*** — Proyecto Falkor y dominio.
- **c4-infrastructure.ts** / **c4-cypher.ts** — Tras indexar archivos, el sync infiere contenedores desde `docker-compose*`, manifiestos `kubernetes/`/`k8s/` y `workspaces` en `package.json`; escribe `:System`, `:Container`, `File-[:PART_OF]->Container` y roll-up `[:COMMUNICATES_WITH]` (imports/calls entre archivos de distintos contenedores).

Shadow y sync comparten producer + resolución de imports; Prisma y tsconfig virtual se aplican también en `POST /shadow`.
