# Ariadne: Sección Administradores y Sección Usuarios

## Objetivo

Separar la aplicación en dos zonas claras:

1. **Sección Administradores** — Todo lo actual (gestión de repos, credenciales, chat técnico, índice, análisis). Exclusiva para rol `admin`.
2. **Sección Usuarios** — Nueva zona donde cualquier usuario autenticado puede hacer preguntas a Ariadne sobre un repositorio y recibir respuestas en tono **tutorial / soporte**, sin contenido técnico de código. Disponible también para administradores.

---

## Roles y acceso

| Rol      | Sección Administradores | Sección Usuarios |
|----------|--------------------------|------------------|
| Admin    | Sí (completo)            | Sí               |
| Usuario  | No                       | Sí               |

- **Admin**: JWT con `applications[].roles` incluyendo `admin` o `isSystemAdmin: true` (comportamiento actual del SSO).
- **Usuario**: Cualquier otro usuario con token válido (p. ej. rol `user` o sin rol admin). No se exige un rol explícito "user"; basta con estar autenticado y no ser admin para restringir a la sección usuarios.

---

## 1. Sección exclusiva para administradores

Incluye todo lo que existe hoy:

- **Repositorios**: listado, detalle, crear, editar, eliminar, sync, jobs, análisis de job.
- **Credenciales**: listado, crear, editar, eliminar.
- **Chat técnico** (`/repos/:id/chat`): preguntas NL→Cypher, diagnósticos, duplicados, reingeniería, código muerto, full audit, plan de modificación, índice del grafo. Respuestas con contexto de código y grafo.
- **Índice** (`/repos/:id/index`): vista del grafo indexado.
- **Ayuda** (`/ayuda`): documentación (puede quedarse visible para ambos si se desea).

La navegación actual (Repositorios, + Nuevo repo, Credenciales, Ayuda) se considera parte de esta sección: solo se muestra o se permite acceso a esas rutas cuando el usuario es admin.

---

## 2. Sección Usuarios (y administradores)

### Propósito

El usuario elige un repositorio y hace preguntas en lenguaje natural. Ariadne responde como un **tutorial o experto en soporte**:

- Explicaciones en prosa, pasos, recomendaciones de uso.
- Basado en el conocimiento del proyecto (manual, conceptos de dominio, estructura de alto nivel).
- **No** incluir: fragmentos de código, Cypher, detalles de implementación, nombres de archivos o funciones salvo cuando sea necesario para orientar (ej. “en la pantalla X puedes…”).
- Tono: útil para quien usa el sistema, no para quien lo desarrolla.

### Flujo

1. El usuario entra a la sección (ej. **Consulta** o **Preguntar a Ariadne**).
2. Ve una lista de repositorios a los que puede preguntar (solo lectura: mismo `GET /repositories` o un subconjunto si más adelante hay ACL).
3. Selecciona un repositorio.
4. Abre un chat asociado a ese repo: escribe preguntas y recibe respuestas en modo soporte/tutorial (sin pestañas de diagnóstico ni análisis técnico).

### Disponibilidad

- Visible y accesible para **usuarios** (no admin).
- Visible y accesible para **administradores** (pueden usar esta misma interfaz además del chat técnico).

---

## Plan de implementación

### Fase 1: Auth y rutas por rol

| Paso | Descripción |
|------|-------------|
| 1.1 | **ProtectedRoute**: Dejar de exigir solo admin. Permitir acceso a la app si el token es **válido** (validado contra SSO). Si no hay token o no es válido, redirigir al SSO como ahora. |
| 1.2 | **Rutas admin-only**: Agrupar o marcar las rutas actuales que son solo para admin: `/`, `/repos/new`, `/repos/:id`, `/repos/:id/edit`, `/repos/:id/chat`, `/repos/:id/index`, `/credentials`, `/credentials/new`, `/credentials/:id/edit`. Crear un componente o wrapper **AdminRoute** que compruebe `hasAdminRole(token)`; si no es admin, redirigir a la sección usuarios (ej. `/consulta`) o mostrar “Acceso denegado”. |
| 1.3 | **Navegación según rol**: En `Layout`, si el usuario es admin, mostrar: Repositorios, + Nuevo repo, Credenciales, **Consulta** (enlace a sección usuarios), Ayuda. Si el usuario no es admin, mostrar solo: **Consulta**, Ayuda (opcional). |
| 1.4 | **Ruta por defecto**: Usuario no admin que entra a `/` → redirigir a `/consulta`. Admin puede seguir entrando a `/` (lista de repos). |

### Fase 2: Backend — Chat modo soporte

| Paso | Descripción |
|------|-------------|
| 2.1 | **Nuevo endpoint en Ingest**: `POST /repositories/:id/support-chat` con body `{ message: string, history?: Array<{ role, content }> }`. Misma forma que el chat actual pero con semántica distinta. |
| 2.2 | **ChatService (ingest)**: Añadir método `supportChat(repositoryId, req)` que: (1) obtenga contexto del proyecto (manual del proyecto, resumen del grafo de alto nivel, conceptos de dominio si existen); (2) llame al LLM con un **system prompt de soporte/tutorial**: instrucciones claras de que la respuesta debe ser en prosa, orientada al usuario final, sin código ni Cypher ni jerga de implementación; (3) opcionalmente usar un subgrafo o resumen (p. ej. `getGraphSummary`) para dar contexto sin exponer herramientas de desarrollador. No usar las mismas tools que el chat técnico (sin execute_cypher, sin get_file_content de código). |
| 2.3 | **Respuesta**: Mismo contrato que el chat actual (`{ answer: string }`) para reutilizar cliente; no devolver `cypher` ni `result` en modo soporte, o devolverlos vacíos. |
| 2.4 | **API (BFF)**: Exponer el nuevo endpoint vía proxy al ingest (ej. `POST /api/repositories/:id/support-chat`) para que el frontend lo use con la misma base de autenticación. |

### Fase 3: Frontend — Sección Usuarios

| Paso | Descripción |
|------|-------------|
| 3.1 | **Ruta**: Añadir ruta `/consulta` (o `/soporte` / `/preguntar`). Fuera de AdminRoute; accesible por cualquier usuario autenticado. |
| 3.2 | **Página “Consulta”**: Vista con dos estados o dos pantallas: (A) Lista de repositorios (solo lectura: nombre, proyecto/repo, sin botones crear/editar/eliminar/sync); (B) Al elegir un repo, mostrar el chat de soporte para ese repo. |
| 3.3 | **Componente SupportChat**: Interfaz de chat similar a RepoChat (input, historial, markdown en respuestas) pero: sin pestañas de Diagnóstico/Duplicados/Reingeniería/Full Audit; sin mostrar Cypher ni resultados de queries; llamadas a `POST .../support-chat`. Mensaje breve de bienvenida indicando que puede preguntar sobre el uso del sistema/proyecto y que Ariadne responderá como guía o soporte. |
| 3.4 | **API frontend**: Añadir en `api` un método `supportChat(repoId, { message, history })` que llame al nuevo endpoint del BFF. |
| 3.5 | **Navegación**: En Layout, enlace “Consulta” a `/consulta`; para admins puede ir junto a Repositorios/Credenciales; para usuarios será la opción principal. |

### Fase 4: Ajustes y documentación

| Paso | Descripción |
|------|-------------|
| 4.1 | **Ayuda**: Decidir si `/ayuda` es solo admin o también usuario; recomendación: disponible para ambos. |
| 4.2 | **Mensajes de acceso**: Pantalla “Acceso denegado” para usuario no admin que intente entrar a una ruta admin (con enlace a “Ir a Consulta”). |
| 4.3 | **README / docs**: Actualizar documentación de la app (y este documento) con la descripción de las dos secciones y los roles. |
| 4.4 | **SSO**: Confirmar con el equipo de SSO que los JWTs incluyen `applications[].roles` (o equivalente) para distinguir admin; si solo existe “admin”, el resto de usuarios autenticados se tratan como rol usuario por defecto. |

---

## Consideraciones

- **Lista de repos en Consulta**: Por ahora puede ser la misma que `GET /repositories`. Si en el futuro se define ACL por aplicación o por equipo, el backend podría filtrar por usuario y devolver solo los repos permitidos.
- **Manual del proyecto**: El chat de soporte debe apoyarse en el manual generado por Ariadne (si existe) y en conceptos de dominio; así las respuestas siguen alineadas al proyecto sin bajar a código.
- **Idioma**: Mantener coherencia con el resto de la app (español para mensajes e interfaz; el LLM puede responder en español en modo soporte).
- **Coste**: El modo soporte también consume LLM; se puede limitar historial o longitud de contexto para controlar coste.

---

## Resumen de entregables

| Área        | Entregable |
|------------|------------|
| Auth       | ProtectedRoute por token válido; AdminRoute para rutas admin; redirección no-admin a `/consulta`. |
| Navegación| Nav según rol (admin: Repos, Credenciales, Consulta, Ayuda; usuario: Consulta, Ayuda). |
| Backend    | `POST /repositories/:id/support-chat` en ingest + proxy en API; `ChatService.supportChat()` con system prompt soporte/tutorial. |
| Frontend   | Ruta `/consulta`, lista de repos (solo lectura), página SupportChat con `api.supportChat()`. |
| Docs       | Este documento (AriadneUsuarios.md) como plan de implementación y referencia de las dos secciones. |
