# Dominios (gobierno de arquitectura)

- **Entidades:** `DomainEntity`, `ProjectDomainDependencyEntity` (whitelist proyecto → dominio).
- **API:** `DomainsController` bajo `/domains` — CRUD de dominios; dependencias por proyecto en `ProjectsController` (`GET|POST|DELETE .../domain-dependencies`). Proxificado por la API gateway como `/api/domains` y `/api/projects/...`.
- **Falkor:** `ProjectsService.getCypherShardContexts()` combina grafos del proyecto con los de proyectos en dominios permitidos; el par `(graphName, cypherProjectId)` alimenta chat/MCP para Cypher correcto por shard.
