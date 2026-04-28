# JSDoc y documentación en código (Ariadne)

Este documento define **cómo documentamos** el monorepo Ariadne para que colaboradores y herramientas (IDE, TypeDoc, futuros generadores) obtengan contexto sin depender solo del chat.

## Licencia y aviso de copyright

- El repositorio usa **Apache License 2.0** ([`LICENSE`](../LICENSE), [`NOTICE`](../NOTICE), [`AUTHORS.md`](../AUTHORS.md)).
- En **archivos nuevos** o al refactorizar bloques grandes, incluye al menos en el encabezado del archivo:

```ts
/**
 * @fileoverview Descripción breve del módulo (una o dos frases).
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 */
```

- Si un archivo ya tiene `@fileoverview`, puedes añadir `@copyright` y `@license` en la misma cabecera.

## Convenciones JSDoc (TypeScript)

| Etiqueta        | Uso |
|----------------|-----|
| `@fileoverview` | Qué hace el archivo/módulo y su papel en la arquitectura (ingest, api, MCP, frontend). |
| `@module`      | Nombre lógico del módulo (opcional; útil en entry points). |
| `@packageDocumentation` | Solo en `*.ts` de entrada de paquete si usas TypeDoc con `entryPointStrategy`. |
| `@param`       | Cada parámetro público de funciones exportadas o métodos de clase pública. |
| `@returns` / `@return` | Valor de retorno; usa `void` o `Promise<...>` explícito. |
| `@throws`      | Errores que el llamador debe manejar (`NotFoundException`, `Error`, etc.). |
| `@see`         | Rutas a docs (`docs/notebooklm/...`), otros módulos o endpoints HTTP. |
| `@deprecated`  | Con sustituto o fecha de retirada si aplica. |
| `@internal`    | API no estable; no garantizada entre versiones menores. |

### NestJS (servicios, controladores, processors)

- **Clases `@Injectable()`**: documenta la responsabilidad del servicio y las dependencias inyectadas relevantes para el lector.
- **Métodos públicos**: `@param`, `@returns`, `@throws` cuando no sea obvio por los tipos.
- **Controladores**: referencia verbos y rutas (`GET /repositories/jobs/active`) en `@fileoverview` o en el método.

### Frontend (React + Vite)

- Componentes de página: qué ruta (`react-router`) cubren y qué datos de API consumen.
- Hooks compartidos: contrato de entrada/salida y efectos secundarios (localStorage, polling, etc.).

### MCP (`services/mcp-ariadne`)

- **Catálogo JSDoc de tools:** [`services/mcp-ariadne/src/mcp-tools.doc.ts`](../services/mcp-ariadne/src/mcp-tools.doc.ts) — tabla nombre → rol técnico, dependencias (`INGEST_URL`, API Nest, Falkor) y constante `MCP_ARIADNE_TOOLS_DOC_REVISION` (subir al añadir/quitar tools).
- **Implementación:** [`services/mcp-ariadne/src/index.ts`](../services/mcp-ariadne/src/index.ts) — `ListTools` (JSON Schema por tool) y `CallTool` (ramas por `name`). JSDoc `@see` enlaza al `.doc.ts`.
- **Narrativa / producto:** [`services/mcp-ariadne/README.md`](../services/mcp-ariadne/README.md) y [`docs/notebooklm/mcp_server_specs.md`](notebooklm/mcp_server_specs.md).

## Mapa rápido de entry points (mantener cabeceras al día)

| Ruta | Rol |
|------|-----|
| `services/ingest/src/main.ts` | Bootstrap ingest: migraciones, Falkor opcional, Nest + rawBody webhooks. |
| `services/api/src/main.ts` | API pública, CORS, proxy a ingest, auth OTP. |
| `services/orchestrator/src/main.ts` | LangGraph / flujos de orquestación. |
| `services/mcp-ariadne/src/index.ts` | Servidor MCP (HTTP streamable). |
| `services/mcp-ariadne/src/mcp-tools.doc.ts` | JSDoc del catálogo de herramientas MCP (paridad con `index.ts`). |
| `packages/ariadne-common/src/index.ts` | Reexportaciones Falkor/Cypher compartidas. |
| `frontend/src/main.tsx` | Montaje React. |

## Documentación narrativa (no sustituye JSDoc)

- Arquitectura, despliegue y flujos: [`README.md`](../README.md) y [`docs/notebooklm/`](../docs/notebooklm/).
- Manual de operación: [`docs/manual/README.md`](../docs/manual/README.md).
- Contribución y proceso: [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Generación futura de sitios de API (opcional)

Si se añade TypeDoc u otro generador, centralizar configuración en la raíz o por paquete y enlazar desde este archivo. Hoy el **source of truth** es el código + este repositorio de Markdown.
