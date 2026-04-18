# ProjectDetail

- **`ProjectDetail.tsx`** — Vista del proyecto: pestañas **General** (repos, roles, sync, **selector de dominio** FK `projects.domain_id`) y **Arquitectura** (mismo selector + whitelist `project → dominio`, C4).
- **`ArchitecturePanel.tsx`** — Dominio del proyecto, dependencias `project → dominio`, y `C4Previewer` (Kroki).
