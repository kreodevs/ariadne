### 1. Agent: The Cartographer (Scanner & Indexer)

**Rol:** Responsable de la ingesta y la fidelidad del grafo.

- **Herramientas:** Tree-sitter, FalkorDB Client.
- **Misión:** Transformar archivos estáticos en nodos y relaciones relacionales.
- **Specs de Operación:**
  - **Extracción Estricta:** Debe mapear cada `import`, `export` y `call_expression`. Si encuentra una referencia que no puede resolver localmente, debe marcar el nodo con el atributo `unresolved: true`.
  - **Detección de Deuda:** Si identifica un componente de clase (`class extends React.Component`), debe etiquetarlo automáticamente como `Legacy:True`.
  - **Invariante:** El Cartógrafo nunca modifica el código; su única salida permitida son consultas Cypher para **FalkorSpecs**.

### 2. Agent: The Oracle (Context Provider)

**Rol:** El guardián del contexto. Es el puente entre el grafo y el agente que codifica.

- **Herramientas:** Cypher Query Engine, LangGraph.
- **Chat (ingest):** Arquitectura agéntica: Coordinator (clasificación LLM) → CodeAnalysis | KnowledgeExtraction | Explorer ReAct. El MCP expone `ask_codebase` que delega a este flujo.
- **Misión:** Entregar a la IA el "mínimo contexto necesario pero suficiente" para realizar una tarea.
- **Specs de Operación:**
  - **Análisis de Impacto:** Ante una solicitud de cambio, debe ejecutar un "Trace de Dependencias" (`MATCH (n)-[*1..2]->(m)`) y adjuntar las firmas de los componentes relacionados.
  - **Generador de Specs:** Basándose en el grafo, genera el archivo `ARCHITECTURE.md` temporal que describe cómo interactúa el código legacy con el resto del sistema.
  - **Filtro de Alucinaciones:** Si el agente de codificación solicita información sobre una función que no existe en el grafo de **FalkorSpecs**, el Oráculo debe emitir un error de "Referencia no encontrada" en lugar de intentar buscarla en su memoria interna.

### 3. Agent: The Weaver (Refactor & Verifier)

**Rol:** El encargado de transformar el código siguiendo la Constitución.

- **Herramientas:** File System, Test Runner.
- **Misión:** Reescribir el código legacy a moderno (ej. de JS a TS) asegurando que el "contrato" no cambie.
- **Specs de Operación:**
  - **Protocolo SDD:** No puede empezar a escribir sin que el Oráculo le entregue una Spec validada.
  - **Verificación de Grafo:** Una vez generado el nuevo código, debe solicitar al Cartógrafo un "Re-scan" preventivo. Si el nuevo grafo rompe relaciones existentes en el grafo original (Zero Drift), el cambio es rechazado.
  - **Alineación de Tipos:** Si el objetivo es migrar a TypeScript, debe usar los nodos `Prop` del grafo para generar las interfaces `Type` exactas, prohibiendo el uso de `any` a menos que esté en la Spec original.

### Protocolo de Comunicación entre Agentes (The Handshake)

1. **Trigger:** El usuario solicita modernizar `OrderList.jsx`.
2. **Oracle:** Consulta a **FalkorSpecs**: _"Dame todo lo que OrderList renderiza y quién lo llama"_.
3. **Oracle a Weaver:** _"Aquí tienes el código de OrderList y el contrato de sus 3 dependencias. Migra a Functional Component + Hooks"_.
4. **Weaver:** Genera el código.
5. **Cartographer:** Escanea el output de Weaver.
6. **FalkorSpecs:** Compara el "Grafo Antes" vs "Grafo Después". Si las conexiones vitales persisten, el cambio se consolida.
