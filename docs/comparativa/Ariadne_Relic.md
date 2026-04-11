# Plan de Evolución: Ariadne Pro (Enriquecido con Relic)

**Objetivo:** Evolucionar el servidor MCP Ariadne incorporando capacidades de análisis avanzado, detección de deuda técnica y navegación multi-root, manteniendo su total independencia como producto y su agilidad característica.

---

## 1. Filosofía de Evolución: "Ariadne Autónomo"

Ariadne evoluciona incorporando el conocimiento analítico (arquitectura y queries) de Relic pero portándolo e implementándolo **nativamente** dentro de su propio código:

*   **100% Autonomía:** La navegación, el análisis estructural y ahora las analíticas avanzadas son nativas de Ariadne.
*   **Cero Dependencias Externa:** Ariadne interactúa directamente con su propia base de datos (Grafo Neo4j) y el sistema de archivos local del usuario.
*   **Aislamiento Total:** Ariadne **NO** se comunica con Relic. Ni llamadas REST/JSON, ni consultas a la base de datos de Relic. Ariadne tiene su propio motor de consulta y cálculo in-memory o en base a Cypher.

---

## 2. Capacidades de Analítica Avanzada Portadas

Se implementan lógicas avanzadas directamente en el código de Ariadne, utilizando consultas Cypher contra Neo4j o análisis local, basadas en la experiencia de Relic:

1.  **`get_sync_status` (Frescura del Oráculo):**
    *   Verifica la última fecha de indexación directamente de los nodos de metadatos (`SyncStatus` o similar) almacenados en el grafo de Ariadne.
2.  **`get_debt_report` (Diagnóstico de Código Crítico):**
    *   Ariadne ejecuta localmente métricas basándose en la falta de aristas (usos/referencias) en Neo4j para determinar código muerto o aislado.
3.  **`find_duplicates` (Detector de Redundancia):**
    *   Identifica componentes o archivos con contenido casi idéntico leyendo las propiedades de los nodos (`contentHash`) directamente en Neo4j.

---

## 3. Navegación Multi-root Autónoma

Para manejar monorepos y múltiples entornos sin depender de la infraestructura de Relic:

1.  **Descubrimiento Local de Raíces**: Ariadne leerá **exclusivamente** un archivo de configuración local (`.ariadne-project`) para mapear los IDs de repositorio del grafo con las rutas físicas del disco del usuario.
2.  **Resolución de Paths Absolutos**: Ariadne transformará automáticamente los paths relativos del grafo en paths absolutos operativos. Esto permite que el Agente pueda ejecutar `view_file` o `grep` sin pasos intermedios de navegación.

---

## 4. Estado de Implementación

### Fase 1: Puente de Analítica [COMPLETADA]
*   ✅ Refactorización de las herramientas analíticas (`get_debt_report`, `find_duplicates`, `get_sync_status`).
*   ✅ Reemplazo total de llamadas REST/HTTP por consultas Cypher nativas directas al grafo de Ariadne.
*   ✅ Aislamiento total de las dependencias externas.

### Fase 2: Infraestructura Compartida [COMPLETADA]
*   ✅ Conexión de Ariadne a la capa de caché compartida (Redis) para acelerar diagnósticos estructurales.
*   ✅ Handshake de resiliencia: Si el motor de analítica no está disponible, Ariadne oculta las herramientas Pro y opera en modo Lite.

### Fase 3: Navegación Pro y Resolución Local [COMPLETADA]
*   [x] **Descubrimiento de `.ariadne-project`**: Implementado lector de configuración local exclusivo (`.ariadne-project`) en Ariadne para mapear `repoId` a rutas absolutas.
*   [x] **Resolución de Paths Absolutos**: Actualizado `get_definitions` y `get_references` para devolver rutas vinculadas al filesystem local.
*   [x] **Handshake de Contexto**: Mejorar `list_known_projects` para incluir metadatos de ramas y estado de sincronización (todo con resoluciones nativas a Neo4j).
*   [x] **UI de Diagnóstico**: Enriquecer los informes de `get_project_analysis` con enlaces profundos `[file](file://...)`.

---

## 5. Estrategia de Estabilidad

Ariadne garantiza que ninguna de estas inclusiones rompa su funcionalidad base:
1.  **Cero Dependencia en Build-time**: Ariadne compila y arranca sin necesidad de que Relic esté presente.
2.  **Fallback Dinámico**: Las herramientas que dependen de APIs externas validan la conectividad en caliente; si falla, devuelven un mensaje descriptivo sin abortar la ejecución.
3.  **Aislamiento de Configuración**: Las credenciales y rutas de Ariadne son independientes de las de Relic.
