# ProjectDetail

- **`ProjectDetail.tsx`** — Vista del proyecto: pestañas **General** (repos, roles, sync, **selector de dominio** FK `projects.domain_id`) y **Arquitectura** (mismo selector + whitelist `project → dominio`, C4). El botón **Resync (proyecto)** en cada fila de repo encola `resync-for-project` para **todos** los repositorios del proyecto (mismo comportamiento desde cualquier fila).
- **`ArchitecturePanel.tsx`** — Dominio del proyecto, dependencias `project → dominio`, y `C4Previewer` (Kroki).
