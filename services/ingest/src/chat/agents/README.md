# Pipeline de Chat (Retriever → Synthesizer)

## Flujo unificado

```
Usuario → Retriever (Cypher + archivos + RAG) → Synthesizer → Respuesta humana
```

Todas las preguntas pasan por el mismo pipeline. No hay clasificación code vs knowledge.

## Agentes

### Retriever (implícito en runUnifiedPipeline)
- **Tools:** `execute_cypher`, `semantic_search`, `get_graph_summary`, `get_file_content`
- **Tarea:** Reunir contexto relevante (grafo FalkorDB, contenido de archivos)
- **Salida:** Datos crudos pasados al Synthesizer. NO escribe la respuesta final.

### Synthesizer (implícito en runUnifiedPipeline)
- **Entrada:** Pregunta del usuario + contexto reunido por el Retriever
- **Tarea:** Sintetizar en prosa clara, como un desarrollador senior explicando a un colega
- **Restricciones:** Prohibido listas crudas de paths/funciones. Siempre explicación narrativa.

## Módulos legacy (no usados por chat)

Los agentes `CoordinatorAgent`, `CodeAnalysisAgent`, `KnowledgeExtractionAgent` permanecen en el código por referencia, pero el chat usa directamente `runUnifiedPipeline` en `chat.service.ts`.
