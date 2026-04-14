# Funcionalidades de Relic (FalkorSpecs)

Relic es un ecosistema de análisis de código basado en grafos diseñado para proporcionar "memoria estructural" a agentes de IA y desarrolladores. A continuación se listan sus funcionalidades principales:

---

## 1. Motor de Ingesta e Indexación
*   **Análisis Estático (Tree-sitter):** Procesa archivos fuente para extraer componentes, hooks, funciones, clases, imports y props.
*   **Mapeo de Relaciones:** Identifica conexiones estructurales como `IMPORTS`, `RENDERS`, `CALLS`, `HAS_PROP` y `DECLARES`.
*   **Sincronización Automática:** Soporte para repositorios de Bitbucket y GitHub con procesos de Full Sync y Re-sync mediante webhooks.
*   **Multilenguaje/Multi-framework:** Diseñado inicialmente para ecosistemas de React/TypeScript/NestJS.

---

## 2. Grafo de Conocimiento (FalkorDB)
*   **Persistencia Estructural:** Almacena el conocimiento del código en una base de datos de grafos de alto rendimiento (FalkorDB).
*   **Consultas Cypher:** Permite realizar consultas complejas sobre la arquitectura del software que el análisis estático tradicional no puede resolver.
*   **Episodic Memory:** Almacena contextos de sesiones previas para mejorar el grounding de la IA.

---

## 3. Servidor MCP (FalkorSpecs Oracle)
Proporciona una interfaz estandarizada para que agentes de IA (como Cursor o Antigravity) consuman el conocimiento del grafo:
*   **Contexto de Archivos:** Obtención de información estructural antes de realizar ediciones.
*   **Validación Pre-edición:** Comprobación de firmas de funciones y props de componentes para evitar errores de tipo.
*   **Análisis de Impacto:** Identificación automática de qué partes del sistema se verán afectadas al modificar un nodo específico.
*   **Grounding Estructural:** Proporciona definiciones y referencias exactas para evitar alucinaciones de la IA.

---

## 4. Análisis Avanzado y Diagnóstico
*   **Detección de Deuda Técnica:** Identificación de patrones de código complejos o ineficientes.
*   **Búsqueda Semántica:** Localización de implementaciones y lógica de negocio basada en el significado, no solo en palabras clave.
*   **Detección de Duplicados:** Análisis cross-package para encontrar código redundante en monorepos.
*   **Análisis de Código Muerto:** Identificación de nodos en el grafo que no tienen referencias activas.
*   **Auditoría heurística de seguridad:** Modo dedicado (secretos/higiene en fuentes indexadas), complementario a SAST formal.
*   **Análisis por `projectId` Ariadne:** Endpoint de ingest que resuelve el repositorio objetivo en proyectos multi-root (`idePath` / `repositoryId`) antes de ejecutar el mismo pipeline que por repo.

---

## 5. Chat e Inteligencia de Código
*   **Chat NL→Cypher:** Permite realizar preguntas en lenguaje natural sobre el código, las cuales se traducen internamente a consultas de grafo para obtener respuestas precisas.
*   **Generación de Planes de Modificación:** Crea planes quirúrgicos detallando qué archivos editar y qué preguntas de negocio resolver antes de proceder.
*   **Reingeniería de Stack:** Facilita la migración o actualización de librerías mediante el mapeo de dependencias.

---

## 6. Infraestructura y Despliegue
*   **Arquitectura Modular (Docker):** Servicios dedicados para ingesta (`ingest`), API de análisis (`api`), orquestación de agentes (`orchestrator`) y visualización (`frontend`).
*   **Soporte Multi-root:** Capacidad de gestionar y consultar múltiples repositorios dentro de un mismo proyecto indexado.
*   **Caché de Análisis:** Sistema de caché por capas (LRU + Redis) para acelerar diagnósticos frecuentes sobre el grafo.
