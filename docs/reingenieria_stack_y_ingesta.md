# Reingeniería: Stack NestJS/TypeORM/PostgreSQL e Ingesta por Repositorio + Webhook

**Estado:** Objetivo de diseño  
**Alcance:** Stack tecnológico, arquitectura microservicios, modelo de ingesta de código

---

## 1. Objetivo

Alinear el proyecto con un **stack estándar** (NestJS, TypeORM, PostgreSQL) y una arquitectura de **microservicios**, y sustituir la ingesta basada en **vigilancia de directorio local (chokidar)** por un modelo **repositorio remoto + webhook**: lectura inicial completa del código desde un repositorio (p. ej. Bitbucket) y actualizaciones incrementales vía webhooks.

---

## 2. Stack objetivo

| Capa | Tecnología | Notas |
|------|------------|--------|
| **Framework backend** | NestJS | Todos los servicios que exponen API o lógica de negocio deben ser NestJS. |
| **ORM / persistencia relacional** | TypeORM | Entidades, migraciones y consultas sobre PostgreSQL. |
| **Base de datos relacional** | PostgreSQL | Datos maestros, jobs de ingesta, metadatos de repos, auditoría. |
| **Grafo (si se mantiene)** | FalkorDB | Sigue siendo el “cerebro” de topología/dependencias; puede alimentarse desde los microservicios. |
| **Cola / caché** | Redis | Estados, caché, colas ligeras entre microservicios. |

Los servicios existentes (API, Orquestador, Cartographer conceptual) deben **evolucionar o reimplementarse** como microservicios NestJS que usen TypeORM + PostgreSQL donde corresponda.

---

## 3. Arquitectura microservicios

- **Cada servicio:** una aplicación NestJS desplegable de forma independiente, con su propia base de datos o esquema si aplica.
- **Comunicación:** REST/HTTP entre servicios; Redis para caché o colas cuando haga falta.
- **Configuración:** variables de entorno por servicio; en Docker/K8s, un contenedor por servicio.
- **Bases de datos:**
  - **PostgreSQL:** por servicio o esquemas separados (repos, jobs, usuarios, etc.).
  - **FalkorDB:** compartido para el grafo de conocimiento (o un microservicio “Grafo” que sea el único que hable con FalkorDB).
  - **Redis:** compartido para sesiones, caché, colas.

No se asume un directorio local montado como “fuente de verdad”; la fuente de verdad es el **repositorio remoto** (Bitbucket u otro).

---

## 4. Modelo de ingesta: de chokidar a repositorio + webhook

### 4.1 Situación actual (a reemplazar)

- **Cartographer** escanea un directorio local (`SCAN_PATH`) con **chokidar**.
- Escaneo completo al arranque y luego eventos `add`/`change`/`unlink` sobre el filesystem.
- Dependencia de montar código en el contenedor (p. ej. `./src` como volumen).

**Limitaciones:** acoplado al filesystem local, no escala bien para múltiples repos, no se integra de forma nativa con Bitbucket/Git.

### 4.2 Modelo objetivo: lectura inicial + webhook

1. **Lectura inicial (full sync)**  
   - Entrada: URL/identificador del repositorio (p. ej. Bitbucket: proyecto + repo, o clone URL con credenciales).  
   - Proceso:  
     - Clonar el repositorio (git) en un directorio de trabajo efímero, o  
     - Obtener el árbol de archivos y contenido vía **API de Bitbucket** (Repository API: listado de archivos, contenido por path).  
   - Recorrer todos los archivos relevantes (`.js`, `.jsx`, `.ts`, `.tsx`; excluir `node_modules`, `.git`, etc.).  
   - Para cada archivo: parsear (Tree-sitter), extraer entidades (imports, componentes, hooks, props, etc.) y persistir en PostgreSQL y/o FalkorDB según el diseño.  
   - Al finalizar: marcar el job de “full sync” como completado; opcionalmente limpiar el clone si se usó filesystem.

2. **Actualizaciones incrementales (webhook)**  
   - Bitbucket (u otro) envía un **webhook** al desencadenar eventos (push, PR, etc.).  
   - El microservicio de ingesta expone un endpoint (p. ej. `POST /webhooks/bitbucket` o `POST /ingest/events`).  
   - Payload del webhook: identificación del repo, rama, commits, archivos cambiados (si el provider lo incluye).  
   - Lógica:  
     - Validar firma/token del webhook.  
     - Determinar qué archivos cambiaron (por listado en el payload o por `git diff` entre commits si se hace clone/fetch).  
     - Re-ejecutar solo el pipeline de análisis para esos archivos (parse → actualizar grafo/BD).  
   - Sin chokidar: la “vigilancia” la hace el proveedor (Bitbucket) llamando al webhook.

### 4.3 Flujo resumido

```
[Bitbucket] ---- clone/API ----> [Microservicio Ingesta]
       |                              |
       |  webhook (push/PR)            |  full sync: parse → TypeORM/PostgreSQL + FalkorDB
       +----------------------------->|  incremental: solo archivos cambiados → actualizar grafo/BD
```

- **Full sync:** bajo demanda (registro de repo, botón “Indexar”, o cron) o tras configurar un repo nuevo.  
- **Incremental:** cada vez que llega un webhook de cambio.

---

## 5. Especificaciones técnicas sugeridas

### 5.1 Microservicio de ingesta (reemplazo conceptual del Cartographer)

- **Stack:** NestJS + TypeORM + PostgreSQL.
- **Responsabilidades:**
  - Registrar repositorios (Bitbucket: proyecto, slug, rama por defecto, credenciales/token).
  - Ejecutar **full sync** (clone o API de Bitbucket para leer todo el árbol y contenido).
  - Exponer **webhook** para eventos de Bitbucket; parsear payload y actualizar solo archivos afectados.
  - Mantener en PostgreSQL: estado del último sync, lista de archivos indexados, errores por archivo.
  - Siguen existiendo: parser (Tree-sitter), producer de grafo (Cypher a FalkorDB); la diferencia es el **origen de los archivos** (repo remoto + webhook en lugar de chokidar + disco local).

### 5.2 Bitbucket

- **Full sync:**  
  - Opción A: `git clone` (requiere credenciales en el servicio).  
  - Opción B: Bitbucket REST API (Repository Files / Raw content) para listar y leer archivos sin clone completo.
- **Webhook:**  
  - Configurar en Bitbucket: Repository → Settings → Webhooks → URL del microservicio, evento “Repository push” (y opcionalmente “Pull request”).  
  - Verificar firma (p. ej. `X-Hub-Signature` si Bitbucket lo soporta) o token en header/query.

### 5.3 Persistencia

- **PostgreSQL (TypeORM):**  
  - Tablas sugeridas: `repositories` (id, provider, project_key, repo_slug, default_branch, last_sync_at, status), `sync_jobs` (id, repository_id, type: 'full'|'incremental', started_at, finished_at, status, payload), `indexed_files` (repo_id, path, checksum o revision, indexed_at).  
  - Permite auditoría, reintentos y no depender del filesystem para saber “qué está indexado”.
- **FalkorDB:**  
  - Sigue almacenando el grafo (File, Component, Hook, Prop, relaciones). El producer actual puede reutilizarse; la entrada pasa a ser “lista de { path, content }” obtenida del repo en lugar del disco local.

---

## 6. Cambios respecto al diseño actual

| Aspecto | Actual | Objetivo |
|--------|--------|----------|
| Stack backend | Express (API), NestJS (Orchestrator), script Node (Cartographer) | NestJS en todos los servicios que exponan lógica/API |
| Persistencia | FalkorDB + Redis | + PostgreSQL + TypeORM para repos, jobs, metadatos |
| Origen del código | Directorio local + chokidar | Repositorio remoto (Bitbucket) + full sync + webhook |
| Trigger incremental | chokidar (add/change) | Webhook (push/PR) |
| Despliegue | Contenedores con volumen de código | Microservicios sin montar código; datos vía clone/API + webhook |

---

## 7. Próximos pasos (orden sugerido)

1. **Documentar** en `architecture.md` el stack objetivo (NestJS, TypeORM, PostgreSQL) y el modelo repositorio + webhook, y marcar chokidar como “legacy / a sustituir”.
2. **Diseñar** el esquema PostgreSQL (repos, sync_jobs, indexed_files) y las entidades TypeORM.
3. **Implementar** el microservicio de ingesta en NestJS: registro de repo, full sync (clone o API Bitbucket), endpoint webhook, pipeline parse → producer sin chokidar.
4. **Configurar** en Bitbucket el webhook apuntando al nuevo endpoint.
5. **Migrar** la API y el orquestador (si aún no lo están) a NestJS + TypeORM donde corresponda, y conectar con el nuevo servicio de ingesta.

Este documento sirve como **referencia de reingeniería** para ese objetivo; no modifica por sí solo el código existente.
