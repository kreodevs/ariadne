# Pipeline de ingesta (FalkorDB)

- **parser.ts** — Tree-sitter: TS/JS/JSX, componentes, Nest, rutas, etc.
- **producer.ts** — Cypher (`File`, `Component`, `Function`, `IMPORTS`, …).
- **tsconfig-resolve.ts** — Merge de `tsconfig`/`jsconfig` con `extends` (TypeScript API) para aliases en imports.
- **prisma-extract.ts** — `getDMMF` (`@prisma/internals`): nodos `Model`, `Enum`, relaciones `RELATES_TO` / `USES_ENUM`.
- **markdown-chunk.ts** / **markdown-graph.ts** — Chunking semántico de `.md` y nodos `Document` + `HAS_CHUNK` desde `File`.
- **project.ts**, **falkor.ts**, **domain-*** — Proyecto Falkor y dominio.

Shadow y sync comparten producer + resolución de imports; Prisma y tsconfig virtual se aplican también en `POST /shadow`.
