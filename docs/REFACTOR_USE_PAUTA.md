# Parse progresivo de archivos grandes

Guía para **cualquier archivo** que supere el límite de tree-sitter (~800 líneas / ~60KB → "Invalid argument") o sea difícil de mantener.

---

## Flujo: "Parse falló"

Cuando Ariadne omite archivos por **Error de parse** (modal "Archivos omitidos"):

1. Comprueba si el archivo es grande: `wc -l <path>` o tamaño en bytes.
2. Si **> ~800 líneas o > ~60KB**: probable fallo por límite de tree-sitter. → Sigue esta guía.
3. Si es pequeño: puede ser sintaxis inválida o lenguaje no soportado. Revisar manualmente.
4. Tras refactorizar, vuelve a ejecutar **Sync/Resync** para reindexar.

---

## Objetivo

Dividir un archivo grande en módulos **parseables uno a uno** hasta que el orquestador quede bajo el umbral. Cada extracción reduce el tamaño del archivo original sin romper el flujo.

---

## Criterio de éxito

- **Cada módulo resultante < ~800 líneas** → tree-sitter parsea sin fallo
- Orquestador final < ~300 líneas → margen cómodo
- Ariadne indexa Function, CALLS, imports de todos los módulos

---

## Comandos útiles

```bash
# Archivos con más de 800 líneas
find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | awk '$1 > 800 {print $1, $2}'

# Archivos > 60KB
find src -type f \( -name "*.ts" -o -name "*.tsx" \) -size +60k -exec ls -lh {} \;

# Contar líneas de un archivo
wc -l path/to/file.tsx
```

---

## Metodología: orden de extracción

Extraer en **orden de dependencias**. Lo más aislado primero, lo que ensambla al final.

| Paso | Qué extraer | Dependencias | Archivo típico |
|------|-------------|--------------|----------------|
| 1 | Interfaces, tipos | ninguna | `types.ts` |
| 2 | Constantes, enums | ninguna | `constants.ts` |
| 3 | Utilidades puras (formateo, validación) | types, constants | `*Utils.ts` |
| 4 | Llamadas a APIs / webhooks / I/O | types, a veces utils | `*Api.ts`, `*Notifications.ts` |
| 5 | Lógica de dominio (CRUD, cálculos) | types, api, utils | `*Domain.ts`, `*Service.ts` |
| 6 | Estado (useState, useStorage, etc.) | types | `use*State.ts`, `*State.ts` |
| 7 | Acciones que orquestan dominio + estado | types, state, domain, api | `*Actions.ts` |
| 8 | Orquestador (Provider, componente slim, index) | todo lo anterior | archivo original reducido |

---

## Checklist de extracción

- [ ] Identificar archivos grandes (`wc -l`, `find -size`)
- [ ] Crear `types.ts` con interfaces/tipos usados
- [ ] Extraer constantes a `constants.ts` si existen
- [ ] Extraer utilidades puras (sin React ni I/O) a `*Utils.ts`
- [ ] Extraer llamadas a API/webhooks a `*Api.ts` o `*Notifications.ts`
- [ ] Extraer lógica de dominio a `*Domain.ts` o `*Service.ts`
- [ ] Extraer hooks de estado a `use*State.ts`
- [ ] Extraer acciones a `*Actions.ts`
- [ ] Reducir archivo original a orquestador (< ~300 líneas)
- [ ] Verificar: `npm run build` sin errores
- [ ] Verificar: cada módulo < 800 líneas
- [ ] Ejecutar Sync/Resync en Ariadne

---

## Reglas prácticas

1. **Sin dependencias circulares**: cada módulo solo importa de pasos anteriores.
2. **Límite por archivo**: si un dominio supera ~800 líneas, divídelo por subdominio (ej. `detailPauta.ts` + `cotizador.ts` en vez de un solo `pautaDomain.ts`).
3. **Probar tras cada extracción**: el archivo original debe seguir compilando; tree-sitter debe parsear tanto el original como el nuevo módulo.
4. **Orquestador mínimo**: solo imports + compose + export; la lógica vive en los módulos.
5. **Imports**: las rutas relativas se calculan **desde el archivo nuevo**, no desde el de origen. Usar `get_definitions` o listar el repo para confirmar rutas reales.

---

## Cómo identificar bloques

| Patrón en el archivo | Extraer a |
|----------------------|-----------|
| `export interface X`, `type Y =` | `types.ts` |
| `const FOOBAR =`, `enum X` | `constants.ts` |
| Funciones que no usan React ni I/O | `*Utils.ts` |
| `fetch(`, `axios`, webhooks, `localStorage` | `*Api.ts`, `*Notifications.ts` |
| Funciones que mutan estado o llaman a API | `*Domain.ts`, `*Service.ts` |
| `useState`, `useEffect`, `useSessionStorage` | `use*State.ts` |
| Funciones que llaman domain + state + api | `*Actions.ts` |
| `createContext`, `Provider`, componente raíz | orquestador |

---

## Anti-patterns

- **Extraer el orquestador primero**: rompe dependencias. Extraer siempre de menos a más dependencias.
- **Módulos > 800 líneas**: dividir por subdominio antes de crear el archivo.
- **Inventar rutas de import**: derivar desde el archivo de origen; verificar con `get_definitions`.
- **Extraer sin probar**: ejecutar build tras cada extracción.
- **Dejar lógica en el orquestador**: debe ser solo compose.

---

## Plantilla por tipo de archivo

| Tipo original | Módulos típicos | Orquestador |
|---------------|-----------------|-------------|
| Context/Provider | types, State, Actions, Domain, Api, Notifications | Provider + hook |
| Componente grande | types, use*State, *Api, *Charts | Componente slim |
| Service/Util | types, Repository, Notifications, Validation | Funciones que delegan |
| Utils monolítico | validate*, format*, api*, constants | index re-export |

---

## Ejemplo aplicado: usePauta.tsx

*Archivo original ~4500 líneas. Solo como referencia concreta.*

Orden aplicado:

1. `types.ts` — IPautaProps, EliminarMediosInterface
2. `pautaNotificaciones.ts` — webhooks Teams
3. `pautaDetailPauta.ts` — lógica detailpautas
4. `pautaCotizador.ts` — cotizador
5. `pautaActions.ts` — agregarMedio, eliminarMedios, addCircle...
6. `usePautaState.ts` — useState, useSessionStorage
7. `usePauta.tsx` — Provider + usePauta (~250 líneas)

Estructura resultante:

```
contexts/
├── usePauta.tsx
├── usePautaState.ts
├── pautaActions.ts
├── pautaDetailPauta.ts
├── pautaCotizador.ts
├── pautaNotificaciones.ts
└── types.ts
```

---

## Beneficios

- Tree-sitter parsea todos los módulos sin "Invalid argument"
- Indexación completa en Ariadne
- Tests unitarios por módulo
- Menos conflictos en merges
- Responsabilidades claras
