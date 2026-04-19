# Legacy / The Forge

- **`LegacyCoordinatorService`** — Consume el JSON MDD de 7 secciones devuelto por `ask_codebase` con `responseMode: evidence_first` (orchestrator → ingest `POST /internal/repositories/:id/mdd-evidence`). Mapea a secciones del Workshop, ejecuta el semáforo (`SemaphoreService`) y el gate `assertLegacyIndexSddGate` (alineación índice ↔ SDD).
- **`SemaphoreService`** — Valida presencia de `evidence_paths`, coherencia OpenAPI y umbral de complejidad.
- **Tipos** — `mdd-document.types.ts` alineado con `services/ingest/src/chat/mdd-document.types.ts`.
