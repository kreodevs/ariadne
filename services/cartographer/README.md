# Cartographer (FalkorSpecs Ingestor)

Servicio de análisis estático que indexa código JS/TS/JSX/TSX con Tree-sitter y persiste la topología en FalkorDB.

## Funciones

- **Scanner:** Descubre archivos `.js`, `.jsx`, `.ts`, `.tsx` (excluye `node_modules`, `*.test.*`).
- **Parser (Tree-sitter):** Extrae imports, componentes React (clase y funcionales), hooks y uso de componentes (RENDERS).
- **Graph producer:** Genera Cypher con `MERGE` (idempotente) y ejecuta contra FalkorDB.
- **Multi-proyecto:** Al iniciar, crea/actualiza un nodo `:Project` con `projectId`, `projectName` (de `package.json` o carpeta), `rootPath` y `lastIndexed`. Todos los nodos incluyen `projectId` para aislamiento. Relación `(Project)-[:CONTAINS]->(File)`.

## Uso

- `SCAN_PATH`: ruta a indexar (por defecto `/app/src-to-analyze` en Docker).
- `FALKORDB_HOST`, `FALKORDB_PORT`: conexión a FalkorDB.

No modifica el código fuente (solo lectura).

## Scripts

- `npm run build` — compila TypeScript.
- `npm start` — ejecuta el indexado una vez.
