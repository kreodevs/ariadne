# Parse progresivo: archivos grandes

Cuando Ariadne omite archivos por **Error de parse**, puede deberse a que el archivo supera el límite de tree-sitter (~800 líneas / ~60KB).

## Qué hacer

1. Comprueba el tamaño: `wc -l path/to/file.tsx`
2. Si **> ~800 líneas**: sigue la guía en `docs/REFACTOR_USE_PAUTA.md` (repo Ariadne)
3. Divide el archivo en módulos < 800 líneas
4. Ejecuta **Sync** o **Resync** (desde repo o desde proyecto, si usas proyectos multi-root) para reindexar

## Orden de extracción

1. `types.ts` — interfaces
2. `constants.ts` — constantes
3. `*Utils.ts` — utilidades puras
4. `*Api.ts` / `*Notifications.ts` — I/O
5. `*Domain.ts` — lógica de dominio
6. `use*State.ts` — estado
7. `*Actions.ts` — acciones
8. Orquestador (archivo original reducido)

## Comandos

```bash
# Archivos > 800 líneas
find src \( -name "*.ts" -o -name "*.tsx" \) -exec wc -l {} \; | awk '$1 > 800'
```

Ver guía completa: `docs/REFACTOR_USE_PAUTA.md`
