# CONSTITUCIÓN Y ESPECIFICACIÓN MAESTRA: AriadneSpecs AI

**ID:** LL-CORE-001

**IMJ Name:** FalkorSpecs

**Framework:** Spec-Driven Development (SDD) & Zero-Drift Engineering

**Graph Engine:** FalkorDB (Low-Latency Matrix Integration)

## 1. Misión y Propósito (The Intent)

AriadneSpecs AI utiliza inteligencia artificial para transformar sistemas heredados en arquitecturas modernas. Su núcleo es un **Grafo de Conocimiento Estructural** alojado en FalkorDB que previene alucinaciones al forzar a la IA a consultar la topología real del código (AST) antes de proponer cambios.

## 2. Stack Tecnológico Definido (The Constraints)

### A. Capa de Análisis Estático (The Scanner)

- **Tree-sitter:** Parser multilingüe para extraer nodos de JS/JSX/TSX.
- **FalkorDB Client:** Pipeline en Node.js para mapear nodos del AST a una estructura de grafo.

### B. Capa de Datos (The Memory Graph)

- **FalkorDB:** Motor principal. Almacena relaciones: `(Component)-[DEPENDS_ON]->(Hook)`, `(Function)-[CALLS]->(API_Endpoint)`.
- **Redis Stack:** Para persistencia de estados de los agentes y caché de fragmentos de código.

### C. Orquestación de Agentes (The Logic)

- **NestJS + LangGraph:** Para flujos de razonamiento cíclicos.
- **Cypher Query Language:** Lenguaje de consulta para interrogar a FalkorDB sobre la estructura del código legacy.

---

## 3. Especificaciones de Implementación (Blueprint Ready)

### Módulo 1: Scanner & Graph Ingestor

- **Input:** Directorio raíz del código legacy.
- **Proceso:** 1. Tree-sitter identifica `import_statement` y `export_statement`.

2. Genera una consulta Cypher para FalkorDB: `CREATE (:File {name: 'App.js'})-[:IMPORTS]->(:File {name: 'Header.js'})`.

- **Output:** Grafo de dependencias completo en memoria.

### Módulo 2: Context Provider (The Anti-Hallucination Oracle)

- **Función:** Antes de que la IA reciba un componente para refactorizar, este módulo ejecuta una consulta en FalkorDB:
  - _Query:_ `MATCH (c:Component {name: $target})-[*1..2]->(d) RETURN d`
  - _Propósito:_ Traer no solo el código del componente, sino también la firma de todas sus dependencias directas e indirectas.

### Módulo 3: API Service (OpenAPI 3.1)

- **Endpoint `GET /graph/impact/:nodeId`:** Devuelve qué archivos se verían afectados si se modifica una función específica, basado en el análisis de FalkorDB.

---

## 4. Reglas de Verificación (SDD Protocol)

Basado en los principios de tu cuaderno de investigación:

1. **Validación de Intención:** Ninguna Spec de refactorización se aprueba si el "Mapa de Impacto" de FalkorDB muestra riesgos de regresión no gestionados.
2. **Sincronización de Contratos:** El sistema debe verificar que las _props_ identificadas en el grafo de FalkorDB coincidan con la nueva especificación de TypeScript.
3. **Inmutabilidad del Grafo:** Durante una sesión de refactorización, el grafo de FalkorDB actúa como la "Fuente de Verdad" bloqueada; la IA no puede inventar relaciones que no existan allí.
