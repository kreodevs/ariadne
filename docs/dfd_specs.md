### 1. Capa de Ingesta (El Cartógrafo)

- **Entrada:** Repositorio de código fuente (JS/JSX legacy).
- **Proceso:** El agente **Cartógrafo** invoca a **Tree-sitter**.
- **Dato Saliente:** Flujo de Nodos AST (Abstract Syntax Tree). Tree-sitter descompone cada archivo en estructuras lógicas, identificando funciones, componentes de clase y patrones de importación.

### 2. Capa de Transformación y Carga

- **Proceso:** El **Graph Mapper** traduce el AST a consultas Cypher.
- **Almacenamiento:** Se inyectan los datos en **FalkorDB**.
- **Resultado:** Se crea el **Grafo de Conocimiento Estructural**. Aquí, lo que antes era un archivo plano ahora es una red de relaciones donde cada componente sabe exactamente quién lo usa y qué recursos consume.

### 3. Capa de Consulta y Contexto (El Oráculo)

- **Trigger:** El usuario solicita una tarea (ej. _"Migrar este componente a Hooks"_).
- **Proceso:** El agente **Oráculo** interroga a FalkorDB.
- **Dato Saliente:** **Context Bundle**. Este paquete contiene el código del archivo objetivo MÁS las firmas de sus dependencias, asegurando que la IA tenga el mapa completo antes de proponer cambios.

### 4. Capa de Ejecución y Verificación (The Weaver)

- **Proceso:** El agente **Weaver** recibe el _Context Bundle_ y genera el código moderno (TS/Hooks).
- **Bucle de Retroalimentación:** Antes de guardar, el código pasa por un **"Re-Scan"**. El Cartógrafo genera un grafo temporal del nuevo código.
- **Validación de Integridad:** Se comparan las "huellas dactilares" (contratos) del grafo legacy vs. el grafo moderno. Si hay una ruptura no declarada en la especificación, el flujo se detiene.

### Resumen del Ciclo de Vida del Dato en FalkorSpecs:

1. **Código Crudo:** (Inseguro, propenso a alucinaciones).
2. **AST (Tree-sitter):** (Estructurado pero aislado por archivo).
3. **Grafo (FalkorDB):** (Conectado, vision global del sistema).
4. **Spec (SDD):** (Intención validada y contractualmente segura).
5. **Código Moderno:** (Resultado final con "Zero Drift").
