# Plan de Mejora: Supremacía de Ariadne (Microservicios)

## 1. Diagnóstico Real de la Arquitectura
Tras una revisión detallada de la orquestación (`docker-compose.yml`), reconozco un error en mi análisis anterior. **Ariadne NO depende de Relic.** Ariadne posee su propio clúster de microservicios:
- Su propio motor `ingest` (Postgres, FalkorDB, LangChain para NL a Cypher).
- Su propio `orchestrator` (LangGraph).
- Su interfaz agéntica `mcp-ariadne` (el Oráculo para el IDE del usuario).

Las llamadas HTTP (REST) que hace `mcp-ariadne` no salen hacia Relic, sino hacia su propio servicio hermano `ingest` (`http://ingest:3002`). Este patrón de microservicios centralizado es altamente robusto y delegar el procesamiento a Ingest evita que el protocolo MCP degenere hacia un backend "gordo". ¡Es un buen diseño!

## 2. La Verdadera Brecha: Qué hace mejor Relic que debemos adoptar
Al comparar los módulos `ingest` de ambos repositorios, notamos que **Relic tiene un sistema superior de desambiguación multi-root** que protege al desarrollador.

1. **Resolución Heurística en el Ingest (`path-repo-resolution.util.ts`):** En Relic, si el IDE envía una ruta absoluta pero no existe un archivo de configuración, el servicio Ingest infiere inteligentemente a qué repositorio local pertenece comparando los slugs y projectKeys directamente. En Ariadne, esta lógica es inexistente en Ingest; Ariadne confía a ciegas en que el usuario no borrará o configurará mal el `.ariadne-project` desde el cliente MCP.
2. **Enriquecimiento de Scope Dinámico (`mcp-scope-enrichment.ts`):** Relic combina los metadatos de su base de datos con peticiones en tiempo real para decirle a las herramientas de ChatGPT o Claude exactamente en qué "lugar" del código se encuentra el usuario antes de correr las consultas a FalkorDB.

## 3. Plan de Adopción (Mejorando a Ariadne sin romper su estabilidad)

Nuestra meta es tomar estos heurísticos avanzados de Relic y portarlos a Ariadne, ajustándolos a la naturaleza del producto:

**Estado (última actualización):** `[x]` hecho · `[ ]` pendiente

### Fase 4: Portar el Cerebro Heurístico a Ariadne Ingest — **hecha**
- `[x]` Exportar la lógica de `path-repo-resolution.util.ts` desde el `ingest` de Relic al `ingest` de Ariadne. *(Implementado en `services/ingest/src/projects/path-repo-resolution.util.ts` + `projects.service.ts`.)*
- `[x]` Implementar el endpoint de inferencia en el `projects.controller.ts` de Ariadne (`:id/resolve-repo-for-path`).
- *Por qué no rompe:* Son funcionalidades puramente aditivas en el API interno. 

### Fase 5: Enriquecimiento Dinámico de Contexto en el MCP — **hecha**
- `[x]` Crear en `mcp-ariadne` un equivalente de `mcp-scope-enrichment.ts` para que, antes de disparar herramientas complejas (`ask_codebase` o extracciones), el MCP pida al Ingest deducir dinámicamente si la ruta que mira el IDE encaja con algún repo, basándose en la nueva API, e inyectando esa información automáticamente. *(Archivo `services/mcp-ariadne/src/mcp-scope-enrichment.ts`; `scope.repoIds` en `ask_codebase` y `get_modification_plan`.)*
- `[x]` Integrarlo junto con la lectura local y rígida de `.ariadne-project`, teniendo así dos capas de seguridad:
  1. Local-first (Fuerte): Lee `.ariadne-project`. Si esto funciona, excelente (cero latencia). *(`loadAriadneProjectConfigNearFile` desde la ruta del fichero del IDE.)*
  2. Fallback Heurístico (Inteligente): Si no hay local-config, hace ping a su backend `ingest` pidiendo resolución heurística de los slugs. *(Más inferencia Falkor previa si aplica.)*

### Fase 6: Paridad y Limpieza Final — **hecha** (código base; tests opcionales)
- `[x]` `AnalyticsService` en ingest + `POST /projects/:id/analyze` para modos de código con resolución multi-root (`idePath` / `repositoryId`). MCP `get_project_analysis` distingue proyecto vs repo y envía `idePath` cuando hay proyecto multi-root.
- **Plan de implementación:** [Plan_Implementacion_Fase6_AnalyticsService.md](./Plan_Implementacion_Fase6_AnalyticsService.md)

Con este enfoque, respetamos los límites de responsabilidad: el `mcp-ariadne` se mantiene como una interfaz ligera e inteligente para el humano/bot que la consuma, pidiendo soporte al cerebro de Ingest de Ariadne pero combinándolo con la velocidad de la lectura en memoria.
