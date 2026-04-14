# Cadena de migraciones TypeORM (Ariadne ingest)

Documento de **Fase 0**: diseño cerrado para incorporar columnas previstas por el plan de motor (roles multi-root, huella de índice) **sin** reutilizar timestamps ya ocupados en este monorepo.

## 1. Colisión resuelta (`1739180800000`)

En historiales de desarrollo paralelos, el timestamp `1739180800000` se asignó a migraciones **distintas**:

| Repo / línea | Archivo en Ariadne | Contenido |
|----------------|-------------------|-----------|
| Ariadne (canónico) | `1739180800000-EmbeddingSpaces.ts` | Tabla `embedding_spaces`, FKs en `repositories` |
| Otra línea (referencia interna) | — | Solo `ALTER project_repositories ADD role` |

**Regla:** en Ariadne **no** se reemplaza `EmbeddingSpaces1739180800000`. El rol por repo se añade en una migración **posterior** con timestamp nuevo.

## 2. Orden actual (extracto relevante)

1. … migraciones base hasta `1739180700000` (`project_repositories` sin `role`).
2. `1739180800000` — **EmbeddingSpaces** (Ariadne).
3. `1740000000000` — **ProjectFalkorShardRouting**.
4. `1743100000000` — **IngestRuntimeFlags** (`ingest_runtime_flags`).
5. **`1743200000000` — `ProjectRepositoryRole`** — `project_repositories.role` (varchar128, nullable).
6. **`1743300000000` — `IndexedFileContentHash`** — `indexed_files.content_hash` (varchar 64, nullable).

## 3. Entornos

- **BD nueva:** `migration:run` aplica la cadena completa; sin pasos manuales.
- **BD ya en `1743100000000`:** el siguiente deploy con código nuevo ejecuta solo `1743200000000` y `1743300000000`.
- **BD muy antigua sin `EmbeddingSpaces`:** debe aplicarse primero la cadena histórica de Ariadne hasta `1743100000000` antes de estas dos; no mezclar archivos de migración de otra línea con el mismo timestamp que `EmbeddingSpaces`.

## 4. Downgrade

Las migraciones nuevas implementan `down` con `DROP COLUMN IF EXISTS` / efectos reversibles. En producción suele evitarse revertir; usar solo en desarrollo.

## 5. Uso de columnas (implementación progresiva)

- **`project_repositories.role`:** etiqueta opcional (p. ej. `frontend`) para diagnósticos y, en fases posteriores, inferencia de alcance en chat. `ProjectsService.findOne` / `findAll` exponen `role` en cada repo. Actualización vía SQL o API futura.
- **`indexed_files.content_hash`:** reservado para huellas de contenido en sync y caché de analyze (Fase 2 del plan); la columna puede quedar `NULL` hasta que el pipeline la rellene.

## 6. Validación recomendada

Tras `migration:run` en copia de BD:

```sql
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'project_repositories' AND column_name = 'role';
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'indexed_files' AND column_name = 'content_hash';
```
