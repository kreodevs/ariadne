# ESPECIFICACIÓN MAESTRA DE DISEÑO: Proyecto Oracle

**Núcleo Técnico:** FalkorSpecs

**Metodología:** Spec-Driven Development (SDD)

**Objetivo:** Indexación y Modernización de Sistemas Legacy (React/JS)

## 1. Mapeo de Entidades en FalkorDB (Blueprint de Datos)

Para que **FalkorSpecs** sea efectivo, el grafo debe representar el AST (Abstract Syntax Tree) de forma relacional. Los nodos y relaciones base son:

- **Nodos:**
  - `File`: Atributos (path, extensión, hash_contenido).
  - `Component`: Atributos (nombre, tipo: 'Class'|'Functional', export_type).
  - `Hook`: Atributos (nombre, tipo: 'Built-in'|'Custom').
  - `Function`: Atributos (nombre, params, is_async).
- **Relaciones:**
  - `(File)-[:CONTAINS]->(Component|Function)`
  - `(Component)-[:USES_HOOK]->(Hook)`
  - `(Component)-[:RENDERS]->(Component)`
  - `(Function)-[:CALLS]->(Function|API_Endpoint)`
  - `(File)-[:IMPORTS]->(File)`

## 2. Arquitectura del Sistema (System Blueprint)

### A. Ingestor de Contexto (The Oracle Scanner)

Servicio en segundo plano que utiliza **Tree-sitter** para parsear el código.

- **Lógica:** Si el archivo es `.jsx` o `.js`, extrae las dependencias y las inyecta en **FalkorDB** usando consultas Cypher optimizadas para matrices dispersas.

### B. Servidor de Especificaciones (The Spec Engine)

Módulo encargado de generar los archivos `PLAN.md` y `ARCHITECTURE.md` antes de cualquier intervención de la IA.

- **Protocolo:** No se envía código a la IA sin un "Context Bundle" que incluya el grafo de llamadas (Call Graph) extraído de **FalkorSpecs**.

## 3. Contratos de la API (API Specs)

Para que el sistema sea modular, el backend de **FalkorSpecs** expondrá:

| **Método** | **Endpoint**              | **Descripción**                                                                                |
| ---------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET`      | `/nodes/trace/:id`        | Devuelve el árbol completo de dependencias de un componente.                                   |
| `POST`     | `/validate/impact`        | Recibe un cambio propuesto y devuelve una lista de archivos que "se romperían" según el grafo. |
| `GET`      | `/specs/generate/:nodeId` | Genera una especificación inicial (boilerplate) basada en el análisis estático.                |

**4. Flujo de Trabajo SDD (The Ruleset)**
Basado en los documentos de investigación:

1. **Captura de Intención:** El usuario describe el cambio.
2. **Consulta al Oráculo:** **FalkorSpecs** entrega la realidad técnica del sistema legacy.
3. **Generación de Spec:** Se crea un documento de diseño que la IA debe seguir.
4. **Ejecución con Verificación:** El agente de IA escribe el código y el sistema valida que no haya "huérfanos" o referencias rotas en el grafo de FalkorDB. |

## 4. Flujo de Trabajo SDD (The Ruleset)

Basado en los documentos de investigación:

1. **Captura de Intención:** El usuario describe el cambio.
2. **Consulta al Oráculo:** **FalkorSpecs** entrega la realidad técnica del sistema legacy.
3. **Generación de Spec:** Se crea un documento de diseño que la IA debe seguir.
4. **Ejecución con Verificación:** El agente de IA escribe el código y el sistema valida que no haya "huérfanos" o referencias rotas en el grafo de FalkorDB.

## 5. Aplicación Inmediata (Next Steps)

Este documento es la "Constitución" técnica. Con él, puedes generar:

- **Blueprints:** La configuración de contenedores (NestJS + FalkorDB).
- **Specs:** Los archivos `.cursorrules` o `AGENTS.md` que instruyen a la IA a consultar siempre el endpoint `/nodes/trace/`.
- **Infografías:** El mapa visual de cómo el código legacy fluye hacia el grafo.
