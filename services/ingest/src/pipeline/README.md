# Pipeline de indexación

Parser Tree-sitter → Producer Cypher → FalkorDB.

## Módulos

- **parser.ts** — Extrae imports, componentes, funciones, rutas, props (destructuring, `PropTypes`, interfaces `XProps` / `type XProps`, `forwardRef<…, Props>`), llamadas, enums, modelos
- **producer.ts** — Genera Cypher MERGE y ejecuta batch
- **domain-extract.ts** — Extracción heurística de DomainConcept (tipos, opciones)
- **domain-types.ts** — Tipos para DomainConcept
- **project.ts** — MERGE de Project
- **falkor.ts** — Config FalkorDB

## Grafo de dominio

Durante el parse se extraen **DomainConcept**:

- **Componentes por patrón:** Cotizador*, *Template, BrandRider, Renta, Bonus, etc. → `category: 'tipo'`
- **Enums TypeScript** → `category: 'opcion'`, `options: [...]`
- **Constantes** (`const OPTIONS = {...}`, `const TIPOS = [...]`) → `category: 'opcion'`

Relación: `(DomainConcept)-[:DEFINED_IN]->(File)`.

El chat usa DomainConcept para consultas tipo "qué tipos de cotizaciones existen" sin leer archivos.

## Configuración de dominio (por proyecto)

**Primera ingesta:** Se infiere automáticamente `domain_config`:
- **componentPatterns** — Prefijos y sufijos comunes de componentes (ej. `Cotizador*`, `*Template`)
- **constNames** — Constantes y enums detectados (OPTIONS, TIPOS, etc.)

Se persiste en `repositories.domain_config` (PostgreSQL). Syncs posteriores usan esa config.

**Fallback:** Si no hay `domain_config` (ej. shadow, webhooks) o el proyecto es nuevo antes de inferir, se usan `DOMAIN_COMPONENT_PATTERNS` y `DOMAIN_CONST_NAMES` de env.

## Índices FalkorDB y batch

Al iniciar un full sync, se crean índices RANGE en File (projectId, path), Function (projectId, path, name), Component (projectId, name), DomainConcept (projectId, category). Si ya existen se ignoran.

- **FALKORDB_BATCH_SIZE** — Tamaño de chunk para `runCypherBatch` (default 500). Repos grandes benefician de 500–1000.
