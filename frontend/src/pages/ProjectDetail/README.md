# ProjectDetail

Vista de detalle de proyecto Ariadne.

## ArchitecturePanel

- **Dominios** — gobierno (`domainId`, whitelist). Botón **Inferir desde índice** (`POST .../domain-dependencies/infer`) sugiere dependencias desde package.json, workspaces y compose si hay dominios coincidentes en catálogo.
- **Diagramas** — pestañas Archify:
  - **C4** — Context, Container, Component (`C4DiagramViewer`), evidencias (`C4EvidencePanel`), compare (`C4SnapshotCompare`).
  - **Secuencia** — API request/response (`C4SequenceViewer`, rutas Falkor).
  - **Proceso** — workflow con selector de flujos indexados (`C4WorkflowViewer`: ruta, enum, journey, job, wizard…).
  - **Estados** — lifecycle sync job / HTTP (`C4LifecycleViewer`).
  - Export `.md` común. Si Archify falla, la UI muestra `archifyError` del ingest.

API: `GET/POST /projects/:id/c4` (`htmlReady`, `snapshotId`), `GET .../c4/html`. Ver `services/ingest/src/c4/README.md`.
