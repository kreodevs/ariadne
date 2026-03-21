# AriadneSpec Orchestrator (NestJS + LangGraph)

Orquestación de agentes y flujos de razonamiento cíclicos (constitution §2.C).

## Funciones

- **NestJS:** API HTTP para invocar flujos.
- **LangGraph:** Grafo de estado con nodo `validate_impact` que consulta el mapa de impacto (API) y aprueba/rechaza según dependientes (SDD §4).
- **GET /workflow/refactor/:nodeId** — Ejecuta el flujo de validación para el nodo dado.

## Variables de entorno

- `PORT` — Puerto HTTP (default 3001).
- `ARIADNESPEC_API_URL` — Base URL de la API (default http://api:3000).

## Ampliación

Añadir nodos al grafo: LLM para propuesta de refactor, verificación de contratos contra FalkorDB, persistencia de estado en Redis.
