# Pipeline de ingesta (FalkorDB)

- **parser.ts** — Tree-sitter: TS/JS/JSX, componentes, Nest, rutas, etc. Salida temprana para MD/MDX Storybook y markdown de proyecto (`:StorybookDoc` / `:MarkdownDoc` vía producer). CSF: **`storybook-csf-ast.ts`** en `*.stories.*`.
- **storybook-documentation.ts** — Detección de rutas Storybook, parseo MDX/MD y markdown general (`README`, `docs/`, …).
- **producer.ts** — Cypher (`File`, `Component`, `Function`, `StorybookDoc`, `MarkdownDoc`, `IMPORTS`, `STORYBOOK_*`, `MARKDOWN_*`, …).
- **tsconfig-resolve.ts** — Merge de `tsconfig`/`jsconfig` con `extends` (TypeScript API) para aliases en imports (docs → `*_TARGETS_FILE`).
- **prisma-extract.ts** — `getDMMF` (`@prisma/internals`): nodos `Model`, `Enum`, relaciones `RELATES_TO` / `USES_ENUM`.
- **markdown-chunk.ts** / **markdown-graph.ts** — Utilidades legadas (`Document` + `HAS_CHUNK`); el sync actual indexa markdown vía **`MarkdownDoc`** en producer, no por este par.
- **project.ts**, **falkor.ts**, **domain-*** — Proyecto Falkor y dominio.

Shadow y sync comparten producer + resolución de imports; Prisma y tsconfig virtual se aplican también en `POST /shadow`.
