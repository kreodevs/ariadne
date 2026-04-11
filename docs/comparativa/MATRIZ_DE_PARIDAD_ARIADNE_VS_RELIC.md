# Matriz de Paridad Funcional: Ariadne vs. Relic

**Fecha:** 10 de Abril, 2026  
**Rol:** Arquitectura de Software  
**Contexto:** Análisis de capas entre el Oráculo (Ariadne - Interface/Tooling) y la Plataforma (Relic - Ingest/Graph).

---

## 1. Introducción
Este documento identifica la paridad funcional entre Ariadne y Relic. Aunque comparten la misma base de datos (FalkorDB), Ariadne se enfoca en la servidumbre de herramientas a la IA, mientras que Relic se enfoca en la ingesta y el procesamiento de la información.

---

## 2. Matriz de Paridad (Funcionalidades Equivalentes)

| Capacidad Recreada | Ariadne (Proyecto A) | Relic (Proyecto B) | Nivel de Paridad |
| :--- | :--- | :--- | :--- |
| **Análisis de Código** | Extracción de Símbolos (`specs`) | Motor de Ingesta (Tree-sitter) | **Idéntico** |
| **Análisis de Impacto** | `get_legacy_impact` (Tool) | Impact Analysis Service | **Idéntico** |
| **Inteligencia AI** | `ask_codebase` (Tool) | Chat NL→Cypher | **Total** |
| **Planificación** | `get_modification_plan` (Tool) | Motor de Planes de Cambio | **Total** |
| **Almacenamiento** | Grafo de Herramientas | Grafo de Conocimiento (FalkorDB) | **Técnica** |

---

## 3. Funcionalidades Únicas

### Proyecto A: Ariadne (The Oracle/Interface)
*Estas capacidades pertenecen a la interacción humano/IA y no al procesamiento de datos base.*

1.  **Protocolo MCP Nativo:** Servidor estandarizado para Cursor/IDEs (Streamable HTTP, JSON-RPC).
2.  **Pre-flight Check (`analyze_local_changes`):** Análisis de radio de explosión sobre el `git staged` antes de confirmar cambios.
3.  **Alineación de Estándares (`get_project_standards`):** Lectura de ESLint/Prettier para forzar a la IA a seguir el estilo local.
4.  **Guardias de Refactorización:** Validación en tiempo real de contratos y firmas contra el uso en todo el repo.
5.  **Auditoría de Exports:** Detección específica de símbolos exportados que no se usan externamente.

### Proyecto B: Relic (The Engine/Core)
*Estas capacidades pertenecen a la infraestructura crítica y persistencia de datos.*

1.  **Orquestación de Sincronización:** Gestión de webhooks (Bitbucket/GitHub) y colas de trabajo (BullMQ).
2.  **Infraestructura de Despliegue:** Configuración total de Docker, Dokploy y proxies inversos.
3.  **Gestión de Datos (Postgres/Redis):** Persistencia de metadatos de proyectos, credenciales y estados de sync.
4.  **Caché Multicapa (LRU + Redis):** Optimización de rendimiento para consultas de grafos de alta profundidad.
5.  **Indexación Multirepo:** Lógica de unificación de múltiples "roots" bajo una única entidad de proyecto.

---

## 4. Veredicto del Arquitecto

Ariadne y Relic forman un sistema simbiótico:
- **Relic** es la **Fuente de Verdad Estática** (Cómo es el código).
- **Ariadne** es la **Interfaz de Verdad Dinámica** (Cómo se usa el código para construir).

La relación es de **Frontend agéntico (Ariadne)** vs **Backend de conocimiento (Relic)**. Se recomienda mantener la separación de responsabilidades para permitir que Ariadne evolucione su catálogo de herramientas sin saturar el núcleo de indexación de Relic.
