# Funcionalidades de Ariadne (Oracle / MCP Server)

Ariadne es la interfaz de "Oráculo" del ecosistema Relic, encargada de exponer el conocimiento estructural del código fuente a agentes de IA mediante el protocolo MCP (Model Context Protocol).

---

## 1. Interfaz de Contexto IA (MCP Server)
*   **Servidor MCP de 23 Herramientas:** Implementación de un catálogo robusto de funciones invocables por la IA para evitar alucinaciones.
*   **Transporte Streamable HTTP:** Optimizado para integraciones con Cursor e IDEs modernos sin problemas de estado.
*   **Resolución Inteligente de Proyectos:** Capacidad de mapear archivos locales a proyectos indexados mediante `.relic-project` o inferencia de rutas.

---

## 2. Herramientas de Análisis Estructural
*   **Mapeo de Dependencias (`get_component_graph`):** Visualización del árbol de dependencias directo e indirecto de cualquier componente.
*   **Análisis de Impacto (`get_legacy_impact`):** Identificación de todos los dependientes (quién llama a quién) para predecir colaterales.
*   **Especificación de Contratos (`get_contract_specs`):** Extracción exacta de props (requeridas/opcionales) y firmas de funciones detectadas por el scanner.

---

## 3. Seguridad y Refactorización (SDD)
*   **Pre-flight Check (`analyze_local_changes`):** Análisis preventivo del radio de explosión de los cambios en *stage* antes de realizar el commit.
*   **Validación de Firma (`check_breaking_changes`):** Alerta automática si una edición rompe la firma usada en otros sitios del sistema.
*   **Localización de Símbolos (`get_definitions` / `get_references`):** Ubicación exacta de definiciones y todos los usos activos de una función o clase.

---

## 4. Inteligencia de Código y Descubrimiento
*   **Búsqueda Semántica Avanzada:** Localización de lógica basada en el significado técnico (`semantic_search`).
*   **Detección de Patrones Existentes:** Evita la duplicidad buscando implementaciones similares (`find_similar_implementations`).
*   **Rastreo de Alcance (`trace_reachability`):** Identificación de código muerto o inalcanzable desde los puntos de entrada oficiales.

---

## 5. Consultas en Lenguaje Natural
*   **Codebase Chat (`ask_codebase`):** Interfaz que traduce preguntas del desarrollador en insights precisos sobre la arquitectura e implementación del proyecto.
*   **Generación de Planes Quirúrgicos (`get_modification_plan`):** Identificación de archivos específicos a modificar y preguntas críticas de negocio antes de iniciar una tarea.

---

## 6. Estándares y Calidad
*   **Extracción de Estándares (`get_project_standards`):** Recuperación de reglas de Prettier, ESLint y tsconfig para asegurar que el código generado sea indistinguible del original.
*   **Auditoría de Exports (`check_export_usage`):** Identificación de módulos exportados que no tienen importaciones activas.
