Diseño Técnico: Extensión C4 Model (Contexto y Contenedor) para AriadneSpecs v1.1.0

1. Objetivos y Alcance del Diseño

El propósito de esta extensión es elevar la capacidad de observación de AriadneSpecs v1.1.0, transmutando el grafo de código de grano fino (micro) en abstracciones arquitectónicas de alto nivel siguiendo el estándar C4 Model. Mientras que las versiones anteriores se centraban en la navegación de archivos y componentes, la versión 1.1.0 introduce la necesidad de un "mapa topológico" macro que sirva tanto para la visualización humana como para el enriquecimiento del contexto en agentes de IA a través del servicio mcp-ariadne.

Esta arquitectura integra las nuevas capacidades de sharding por dominio y espacios de embedding para permitir que grandes monorepositorios sean digeribles por herramientas como Cursor. El objetivo es que un desarrollador o una IA pueda comprender el "Big Picture" (Contexto de Sistema y Contenedores) antes de profundizar en la lógica estática analizada por Tree-sitter, utilizando el grafo como una memoria estructural que valide planes de modificación (SDD).

2. Lógica de Ingesta y Abstracción de Infraestructura

El pipeline de ingesta en el servicio ingest debe evolucionar de un mapeo uno-a-uno de archivos a una lógica de agregación semántica. El "Producer Cypher" ahora identificará entidades C4 mediante el análisis de descriptores de infraestructura y patrones de código.

Tabla de Mapeo de Entidades y Criterios de Agrupación

Nodo Ariadne (Origen) Nivel C4 Entidad C4 Resultante Criterio de Agrupación
:Project Nivel 1 Software System Nodo raíz multi-repo que define el límite del sistema.
:Repository / :Route Nivel 2 Container (App/Service) Agrupa todos los nodos :Route y :Component dentro de un shard de repositorio. Identificado por servicios NestJS.
:Model / :Entity Nivel 2 Container (Database) Unifica nodos :Model que referencian esquemas TypeORM o relacionales.
:Redis / BullMQ Nivel 2 Container (Queue/Cache) Identificado por el uso de utilidades de ariadne-common para mensajería.

Abstracción de Relaciones y "Shadow Graphs"

El sistema generará relaciones (:Container)-[:INTERACTS_WITH]->(:Container) analizando:

- Interacción de Red: Llamadas entre servicios detectadas mediante el cruce de :Route y clientes HTTP.
- Persistencia: Vínculos entre lógica de negocio y nodos :Model.
- Flujo SDD: Se habilitará la creación de un Shadow Graph (Grafo Sombra) para comparar la arquitectura "Main" contra una propuesta de diseño ("Draft"), permitiendo visualizar cambios de impacto arquitectónico antes de persistir cambios en el grafo principal.

3. Consultas Cypher y Estrategia de Sharding por Dominio

Con la introducción de FALKOR_SHARD_BY_DOMAIN, la extracción de la topología C4 debe ser consciente de que un Sistema (Nivel 1) puede residir en múltiples grafos físicos.

Resolución de Sharding y Compound Keys

Para garantizar la estabilidad de los IDs en entornos distribuidos y evitar colisiones de nombres entre repositorios, se utilizarán claves compuestas (projectId + repoId + path). El servicio api empleará la utilidad effectiveShardMode de ariadne-common para determinar la estrategia de ruteo.

Ejemplo de Consulta Cypher (Nivel 2 - Contenedores)

Esta consulta utiliza las propiedades de filtrado por proyecto y asegura la obtención de metadatos críticos, incluyendo el ruteo a espacios de embedding.

// Extracción de contenedores con soporte para Sharding y Embeddings
MATCH (c:Container)
WHERE c.projectId = $projectId
AND c.repoId IN $allowedRepoIds
OPTIONAL MATCH (c)-[r:INTERACTS_WITH]->(target:Container)
RETURN
c.id AS stableId, // Basado en compound key
c.name AS name,
c.type AS containerType,
c.embedding_space_id AS embeddingSpace,
collect({targetId: target.id, type: r.type}) AS relations

Cuando el modo de particionado por dominio esté activo, el motor de consultas iterará sobre los segmentos devueltos por listGraphNamesForProjectRouting para reconstruir la vista unificada.

4. Especificación del nuevo Endpoint de API

El servicio api expondrá la topología C4 bajo el estándar OpenAPI 3.1. Este endpoint es crítico para el servidor mcp-ariadne, permitiendo a la IA solicitar un "mapa de arquitectura" del proyecto.

Ruta: GET /graph/c4/:projectId?level=[context|container]

Estructura de Respuesta JSON (Normalizada)

La respuesta incluye metadatos de los espacios de embedding para que el consumidor sepa dónde realizar búsquedas semánticas dentro de cada contenedor.

{
"projectId": "uuid-proyecto-v110",
"level": "container",
"nodes": [
{
"id": "proj:repo-auth:path-root",
"label": "Identity Service",
"type": "NestJS/Container",
"metadata": {
"shards": ["domain_auth"],
"embeddings": {
"spaceId": "ollama-vector-index-01",
"provider": "ollama"
}
}
}
],
"edges": [
{
"source": "proj:repo-auth:path-root",
"target": "proj:repo-db:path-postgres",
"relation": "INTERACTS_WITH",
"metadata": { "protocol": "TypeORM/Postgres" }
}
]
}

5. Integración de Subflows en React Flow (Frontend)

La visualización en el frontend utilizará @xyflow/react v12.10 para representar la jerarquía C4 de forma interactiva.

- Lógica de Subflows: Los nodos de Nivel 1 (Contexto de Sistema) se implementarán como nodos "Padre" que actúan como límites (Boundaries). Los contenedores de Nivel 2 se renderizarán como nodos "Hijos" anidados, permitiendo el colapso y expansión de sistemas.
- Saneo de Datos (Falkor Fix): Para mitigar el error [object Object] en la UI debido a la serialización de escalares complejos de FalkorDB, se implementará la utilidad sanitizeFalkorProperties(). Esta función iterará sobre el objeto metadata de cada nodo, aplanando cualquier objeto escalar de la base de datos en strings o números nativos antes de su paso a node.data.
- Navegación Vertical: Un doble clic en un contenedor de Nivel 2 disparará una consulta al GraphService para cargar el grafo de componentes (Nivel 3) filtrado por el repoId correspondiente.

6. Consideraciones de Rendimiento y Escalabilidad

La gestión de grafos de gran escala bajo el modelo C4 requiere estrategias de poda y optimización de memoria.

- High-Level Pruning (Poda Arquitectónica): Durante la generación del grafo C4, el pipeline de ingest debe ignorar nodos que no contribuyan a la arquitectura (como funciones auxiliares internas o archivos de configuración menores) para asegurar que el grafo se mantenga por debajo del FALKOR_GRAPH_NODE_SOFT_LIMIT (100,000 nodos).
- Caché de Impacto Arquitectónico: Dado que la topología de contenedores es más estable que el código fuente, se utilizará Redis para cachear las respuestas del endpoint C4. El TTL de estas consultas se invalidará únicamente tras un proceso exitoso de resync del proyecto o una actualización vía Webhook.
- Eficiencia en Sharding: El uso de domainSegmentFromRepoPath garantiza que las consultas de arquitectura no realicen escaneos globales (broadcast) innecesarios, dirigiendo la carga de trabajo solo a los shards físicos relevantes en el clúster de FalkorDB.
