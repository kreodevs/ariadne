Reporte de Arquitectura: Implementación de Modelo C4 para AriadneSpecs

1. Introducción y Propósito del Sistema

AriadneSpecs (o Ariadne) es una plataforma de ingeniería de conocimiento diseñada para la indexación de repositorios remotos y la materialización de grafos de código detallados en FalkorDB. El problema central que resuelve es la carencia de contexto estructurado y verificable que limita a las IAs al interactuar con bases de código legacy. En lugar de procesar archivos como texto plano, AriadneSpecs actúa como un "Oráculo de Contexto", proveyendo contratos de componentes, análisis de impacto y grafos de dependencias mediante el protocolo MCP (Model Context Protocol).

Este reporte formaliza la estructura técnica del sistema utilizando el Modelo C4, detallando la transición de una arquitectura monolítica hacia un ecosistema de microservicios orquestados que integran agentes de IA y bases de datos de grafos de alto rendimiento.

2. Nivel 1: Diagrama de Contexto del Sistema

En este nivel se definen las interacciones entre AriadneSpecs, sus usuarios y los sistemas externos que conforman su ecosistema operativo.

Actores de Usuario

- Desarrolladores: Operan la plataforma a través del frontend para gestionar la sincronización de repositorios, configurar credenciales y visualizar la topología del código.
- IDEs (Cursor / VS Code): Consumen el contexto de AriadneSpecs mediante un servidor MCP para asistir en tareas de refactorización, navegación y generación de código asistida por IA.

Sistemas Externos

- Proveedores de SCM (Bitbucket / GitHub): Fuentes de verdad donde reside el código fuente. AriadneSpecs extrae datos mediante APIs REST o clones superficiales (shallow clones).
- Servicios de LLM y Embeddings:
  - Cloud: OpenAI y Google para generación de embeddings y razonamiento.
  - Local: Ollama, integrado para proveedores que requieren privacidad estricta y procesamiento de vectores en infraestructura propia.

Responsabilidades del Sistema

Actor / Sistema Responsabilidad de AriadneSpecs
Desarrolladores Proveer visualización jerárquica y herramientas de diagnóstico de deuda técnica.
IDEs (vía MCP) Suministrar herramientas tipadas para extraer contratos y calcular el "radio de explosión".
Repositorios Remotos Ejecutar sincronizaciones completas e incrementales basadas en webhooks (Bitbucket/GitHub).
Infraestructura IA Proveer una capa de abstracción que impida la ejecución de queries destructivas en el grafo.

3. Nivel 2: Arquitectura de Contenedores (Monorepo AriadneSpecs)

El sistema se desglosa en componentes funcionales especializados que interactúan bajo un contrato compartido definido en el monorepo.

Componentes Funcionales (Contenedores)

- services/ingest (Microservicio de Ingesta):
  - Tecnología: NestJS 10, Tree-sitter, BullMQ.
  - Responsabilidad: Motor de análisis estático. Realiza el parseo de AST, identificación de símbolos y generación de sentencias Cypher. Expone el InternalChatToolsController para que el orquestador acceda a herramientas de búsqueda semántica sin redundancia de llamadas al LLM.
  - Comunicación: HTTP/REST, Redis Queues.
- services/api (API de Grafo):
  - Tecnología: NestJS 10, Redis (Caché).
  - Responsabilidad: Punto de entrada para consultas topológicas (impacto, contratos). Gestiona la resolución de nodos multi-repo y el saneo de escalares de FalkorDB.
  - Comunicación: HTTP/REST (OpenAPI 3.1).
- services/orchestrator:
  - Tecnología: NestJS, LangGraph, Redis.
  - Responsabilidad: Orquestación de flujos multi-paso para validaciones de refactorización (ciclos SDD). Consume el servicio de ingesta mediante un eje explícito orchestrator → ingest utilizando herramientas de recuperación (retriever) internas.
  - Comunicación: HTTP/REST (hacia ingest y api).
- services/mcp-ariadne (Oracle MCP Server):
  - Tecnología: Node.js, @modelcontextprotocol/sdk.
  - Responsabilidad: Expone herramientas como get_component_graph y find_similar_implementations. Soporta transporte local (Stdio) y remoto (Streamable HTTP).
  - Comunicación: MCP Protocol.
- frontend:
  - Tecnología: React 19, Vite, @xyflow/react.
  - Responsabilidad: Interfaz reactiva para exploración de grafos y gestión de proyectos.
  - Comunicación: HTTP/REST hacia la API y el Ingest.
- packages/ariadne-common:
  - Tecnología: TypeScript.
  - Responsabilidad: Contrato público que centraliza la lógica de enrutamiento de shards (effectiveShardMode), utilidades de Cypher y tipos compartidos.

4. Diseño de la Ingesta: Extracción y Procesamiento

La ingesta ha evolucionado de un modelo local (Cartographer legacy) a un pipeline remoto asíncrono orientado a la escalabilidad.

Fases del Pipeline

1. Fase Mapping: Escaneo del repositorio remoto para detectar la estructura de directorios y lenguajes presentes.
2. Fase Deps: Análisis de manifiestos (ej. package.json, go.mod) para integrar el contexto de librerías externas.
3. Fase Chunking Semántico: Uso de Tree-sitter para fragmentar el código en unidades lógicas (funciones, componentes, rutas) con metadatos de rango de líneas y commit_sha.
4. Generación de Grafo: Transformación de la metadata en operaciones MERGE de Cypher para FalkorDB.

Gestión y Seguridad

El procesamiento se delega a BullMQ (Redis), permitiendo una sincronización no bloqueante. Las credenciales de acceso (tokens de Bitbucket/GitHub) se almacenan en PostgreSQL cifradas mediante AES-256-GCM con una clave maestra (CREDENTIALS_ENCRYPTION_KEY).

5. Capa de Persistencia y Consultas en FalkorDB

AriadneSpecs utiliza FalkorDB para almacenar la topología del sistema, permitiendo consultas de grafos en memoria con soporte vectorial.

Esquema Lógico del Grafo

Nodo Categoría Descripción Relaciones
FILE Estructura Archivo físico indexado. CONTAINS (Component, Model)
COMPONENT Lógica Componente de UI o funcional. RENDERS, USES_HOOK
MODEL Contexto Definición de estructuras de datos. DEFINES
DOMAIN_CONCEPT Contexto Conceptos de dominio (categoría 'context'). DESCRIBES
FUNCTION Lógica Unidad de ejecución. CALLS

Shadow Graph Architecture

Dentro de la fase de validación de refactorización, el sistema utiliza Shadow Graphs. Estos son grafos temporales por sesión (ariadne-shadow-session-id) que permiten indexar código propuesto y compararlo contra el grafo principal (main). La API expone comparativas para detectar si la refactorización propuesta cumple con los contratos existentes o genera efectos secundarios no deseados.

Consultas Cypher Clave

Impacto (Radio de Explosión): MATCH (n {name: $nodeName})<-[:CALLS|RENDERS*]-(dep) RETURN dep

Extracción de Contrato y Contexto: MATCH (c:COMPONENT {name: $compName})-[:HAS_PROP]->(p:PROP) OPTIONAL MATCH (c)-[:RELATED_TO]->(m:MODEL) RETURN p.name, m.definition

Persistencia Vectorial

Los nodos FUNCTION y COMPONENT integran vectores de embedding (vecf32). El sistema permite el uso de Ollama para generar estos vectores localmente, permitiendo búsquedas semánticas directas en el motor de grafos sin exponer el código a nubes externas.

6. Definición de Endpoints de la API (NestJS)

La comunicación inter-servicios se formaliza mediante una API REST protegida por el InternalApiGuard para rutas de orquestación.

Endpoints de services/api

- GET /graph/impact/:nodeId: Calcula el radio de impacto recursivo.
- GET /graph/component/:name: Recupera la definición y dependencias.
- GET /graph/compare/:componentName: Compara el grafo principal contra el shadow graph.

Endpoints de services/ingest

- POST /repositories/:id/sync: Inicia la sincronización remota asíncrona.
- GET /repositories/:id/file: Obtiene contenido de archivo desde la fuente remota.
- GET /projects/:id/file: Fallback de búsqueda de archivos a nivel de proyecto multi-repo.
- POST /projects/:id/chat: Interfaz de chat agéntico con soporte de scope y twoPhase retrieval.

7. Visualización Jerárquica en el Frontend (React Flow)

La capa de presentación en React 19 visualiza la complejidad del grafo mediante la librería @xyflow/react.

- Normalización de Datos: Para evitar errores de renderizado de objetos en los IDs (típico de escalares de Falkor), el frontend aplica una normalización estricta basada en una clave compuesta: projectId / repoId / path.
- Vistas Dinámicas: Permite alternar entre el árbol de dependencias (depends) y la vista de consumidores de impacto (legacy_impact).
- Integración MCP: El frontend refleja los mismos estándares de visualización que las herramientas consumidas por el IDE, asegurando paridad de contexto entre el desarrollador y la IA.

8. Estrategia de Sharding y Escalabilidad

Con la versión 1.1.0, el sistema introduce particionamiento avanzado para manejar monorepos extensos y multi-tenancy.

Modos de Particionamiento

- FALKOR_SHARD_BY_PROJECT: Un grafo lógico independiente por cada proyecto Ariadne.
- FALKOR_SHARD_BY_DOMAIN: Particionamiento por segmentos de ruta o dominios funcionales. Implementado mediante la utilidad domainSegmentFromRepoPath en ariadne-common.

Infraestructura y Control

- Migraciones: El sistema utiliza la migración TypeORM ProjectFalkorShardRouting para gestionar la asignación de shards en PostgreSQL.
- Límites de Memoria: Se controla la estabilidad mediante FALKOR_GRAPH_NODE_SOFT_LIMIT para evitar desbordamientos de memoria en FalkorDB.
- Overflow: La variable FALKOR_AUTO_DOMAIN_OVERFLOW permite la creación dinámica de nuevos shards cuando un dominio excede su capacidad lógica.

9. Conclusiones y Futuras Extensiones

La arquitectura de AriadneSpecs se consolida como un sistema robusto de "Graph-RAG" para ingeniería de software. La paridad entre el stack tecnológico (PostgreSQL + FalkorDB + Redis) y los flujos de trabajo de IA permite una transición segura desde sistemas monolíticos hacia arquitecturas modernas asistidas.

Próximos Pasos

- Unificación de Lógica Reasoner: Integrar la lógica de razonamiento entre el Ingest (herramientas ReAct) y el Orquestador (LangGraph) para estandarizar la toma de decisiones agénticas.
- Observabilidad de Grafos: Implementar métricas de rendimiento para latencias de consultas Cypher complejas en shards de dominio.
- Expansión de Lenguajes: Incrementar la cobertura de Tree-sitter para lenguajes adicionales, manteniendo el modelo de persistencia dual y la seguridad cifrada de credenciales.
