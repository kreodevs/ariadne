# Revisión: extracción Ariadne sobre el ejemplo CirculoActivoProvider

Código de ejemplo: componente React con contexto (`createContext`/`useContext`), hooks, arrow functions y constantes.

## Lo que el parser/indexador **sí** extrae correctamente

| Elemento | Cómo se detecta | En el grafo |
|----------|------------------|-------------|
| **Componente** `CirculoActivoProvider` | Arrow function con nombre PascalCase asignada a const + JSX en el archivo | `Component { name: CirculoActivoProvider }`, `File CONTAINS Component` |
| **Hooks usados** | Cualquier `call_expression` cuyo callee empiece por `use` y length > 3 | `Hook { name }`, `Component -[:USES_HOOK]-> Hook` para cada hook del archivo |
| En este archivo: `useState`, `useEffect`, `useContext`, `useMapaContext`, `useCirclesContext`, `useStore` | Líneas 566-574 parser: recorre todos los `call_expression` y filtra por `calleeName.startsWith('use')` | Todos quedan como hooks usados por el único componente |
| **Arrow functions** `createCircles`, `refreshFilters` | `variable_declarator` con valor `arrow_function` o `function`; nombre del declarador | `Function { path, name }`, `File CONTAINS Function` |
| **Función** `useCirculoActivo` | Misma lógica (const con arrow function); no es PascalCase así que no se considera componente | `Function { name: useCirculoActivo }` |
| **Props del componente** | `extractPropsFromPattern` sobre el primer parámetro (object_pattern) | `Prop { name: children }`, `Component -[:HAS_PROP]-> Prop` |
| **Renders (JSX)** | Tags que pasan `isJsxComponentTag`: PascalCase o `Foo.Bar` | `Component { name: CirculosMapaContext.Provider }`, `CirculoActivoProvider -[:RENDERS]-> CirculosMapaContext.Provider` |
| **Llamadas entre funciones** | Dentro del cuerpo de cada función, `call_expression` con callee identificado; si el callee está en `result.functions` → CALLS | p. ej. `createCircles` llama a `buscarRutas`, `buscarMedios`, `addNewCircle`, etc. (resueltas si están en el mismo archivo o vía imports) |
| **JSDoc del componente** | `getPrecedingJSDoc` antes del nodo del componente | Se guarda en `Component.description` (y en chunking para embeddings) |

Detalles de implementación:

- **Componentes:** `function_declaration` + `arrow_function` con nombre PascalCase (y opcionalmente export default con inferencia por path). Incluye `Context.Provider` vía `isJsxComponentTag` (patrón `Foo.Bar`).
- **Hooks:** Lista global por archivo; el producer asocia todos los `hooksUsed` del archivo a cada componente del mismo archivo (en un archivo con un solo componente es correcto).
- **Funciones:** `function_declaration` y `variable_declarator` con valor `arrow_function`/`function`; todas las funciones nombradas (incluido el propio componente como función) van a `result.functions` y luego a nodos `Function` y relaciones `CALLS`.

## Modelado añadido (Context, custom hooks, DomainConcept context)

A partir de la extensión del pipeline se modela también:

| Elemento | Cómo se detecta | En el grafo |
|----------|------------------|-------------|
| **Contexto** `CirculosMapaContext = createContext(null)` | `variable_declarator` cuyo valor es `call_expression` con callee `createContext` o `React.createContext` | `Context { name }`, `File -[:CONTAINS]-> Context`; además `DomainConcept { category: 'context' }` y `(DomainConcept)-[:DEFINED_IN]->(File)` |
| **Custom hook definido** `useCirculoActivo = () => useContext(...)` | `variable_declarator` con nombre que cumple `/^use[A-Z][a-zA-Z0-9]*$/` y valor `arrow_function` o `function`; o `function_declaration` con ese nombre | `Hook { name: useCirculoActivo }`, `File -[:CONTAINS]-> Hook` (el Hook existe en el archivo donde se define; en otros archivos que lo llamen sigue habiendo `Component -[:USES_HOOK]-> Hook`) |

## Constantes (DomainConcept)

- **Enums TS** → `category: 'opcion'`, `options: [...]`.
- **Constantes objeto/array** (ej. `const OPTIONS = { ... }`) → si el nombre coincide con `constNames` del config → `category: 'opcion'`.
- **Contextos** `const X = createContext(...)` → `Context` + `DomainConcept { category: 'context' }`.

## Resumen por tipo de nodo (tras la extensión)

- **Component:** CirculoActivoProvider.
- **Hook (usados):** useState, useEffect, useContext, useMapaContext, useCirclesContext, useStore.
- **Hook (definido):** useCirculoActivo (`File CONTAINS Hook`).
- **Function:** CirculoActivoProvider, createCircles, refreshFilters, useCirculoActivo.
- **Prop:** children.
- **Renders:** CirculosMapaContext.Provider.
- **Context:** CirculosMapaContext (`File CONTAINS Context`).
- **DomainConcept:** CirculosMapaContext con `category: 'context'`.
