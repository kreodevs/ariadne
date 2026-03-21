# Ariadne (ariadne-ai-scout) — Documento de presentación ejecutiva

Documento único para presentaciones ante ejecutivos e inversionistas. Fuente para generación de infografías, presentaciones y materiales derivados en NotebookLM.

---

## 1. Resumen Ejecutivo (The Hook)

Ariadne no es solo una herramienta que “analiza código”: es el primer oráculo que convierte la base de código legacy en una memoria verificable que la inteligencia artificial puede consultar antes de actuar. Transforma el riesgo de refactorizar en decisión informada, el “no sé qué romperé” en impacto exacto, y la documentación obsoleta en respuestas ancladas al grafo real del proyecto. Las organizaciones dejan de elegir entre velocidad y seguridad: la IA trabaja con el mismo contrato que el equipo — componentes, dependencias y reglas — sin inventar archivos ni asumir estructuras. Eso no es automatización; es gobernanza del cambio.

---

## 2. El Problema y la Solución (Storytelling)

**El dolor:** Hoy las empresas tienen bases de código enormes que nadie se atreve a tocar sin miedo. Cada cambio es una apuesta: “¿esto romperá algo que no veo?”. La documentación está desactualizada, el conocimiento está en la cabeza de quien se fue, y las herramientas de IA — por potentes que sean — alucinan rutas, inventan componentes o proponen cambios que no respetan la estructura real. El resultado: más parálisis o más incidentes.

**La cura:** Ariadne construye una memoria estructural del código — un grafo indexado desde los repositorios reales — y la expone a la IA a través de un protocolo estándar (MCP). La IA ya no adivina: pregunta. “¿Qué se rompe si modifico este componente?” “¿Cuáles son las props reales?” “¿Qué archivos tocar para este cambio?” Las respuestas vienen del índice, no del modelo. El equipo recupera confianza para cambiar; la IA deja de ser un riesgo y se convierte en un socio que cumple contratos.

---

## 3. Exposición de Potencial y Funcionalidades

Cada función se traduce a beneficio de negocio:

- **Indexación desde repositorios remotos (Bitbucket/GitHub):** El sistema mantiene el grafo actualizado con sync completo y webhooks; no depende de copias locales. *Beneficio: una única fuente de verdad accesible por equipos e IA.*

- **Grafo de conocimiento (FalkorDB):** Componentes, funciones, imports, props y llamadas se modelan como nodos y relaciones. *Beneficio: consultas de impacto y dependencias en milisegundos; escalabilidad sin reescribir documentación.*

- **Validación antes de editar:** La IA obtiene impacto (qué se rompe) y contrato (props y firmas reales) antes de proponer código. *Beneficio: refactors que respetan la estructura existente y reducen regresiones.*

- **Chat y análisis en lenguaje natural:** Preguntas como “¿cómo está implementado el login?” o “¿qué funciones no se usan?” se responden con datos del grafo y del código. *Beneficio: onboarding más rápido y diagnósticos de deuda técnica sin auditorías manuales.*

- **Plan de modificación (flujo legacy):** Lista de archivos a modificar y preguntas de afinación generadas solo a partir del índice; sin rutas inventadas. *Beneficio: integración con flujos de producto (ej. MaxPrime) con respuestas exactas y verificables.*

- **Diagnóstico estructurado:** Detección de antipatrones (código spaghetti, funciones “dios”, imports circulares), duplicados por similitud semántica y plan de reingeniería priorizado. *Beneficio: priorización objetiva de la deuda y ROI medible de las mejoras.*

- **Credenciales cifradas en base de datos:** Tokens y secrets no viajan en variables sueltas. *Beneficio: seguridad y cumplimiento en entornos corporativos.*

---

## 4. Paisaje Competitivo (El Diferenciador)

Existen herramientas de análisis estático (SonarQube, CodeClimate), IDEs con refactors asistidos, y asistentes de código (GitHub Copilot, Cursor) que sugieren cambios. La diferencia no es “más análisis” ni “más IA”: es que la IA actúe con **contexto verificado**.

SonarQube y similares ofrecen métricas y reglas; no exponen un grafo consultable por la IA en tiempo de edición. Los asistentes de código no tienen memoria estructural del proyecto: generan sugerencias a partir de contexto limitado y pueden alucinar archivos o dependencias. **Ariadne cierra ese hueco:** el mismo grafo que alimenta diagnósticos se expone vía MCP para que la IA consulte impacto, contratos y listas de archivos antes de proponer cambios. La ventaja injusta es la verificación: cada respuesta de “qué tocar” o “qué se rompe” está anclada al índice real.

Si en un nicho no hay competencia directa (oráculo MCP + grafo para IA en refactors legacy), estamos definiendo la categoría: **“contexto verificable para IA en código legacy”**. El océano azul es la convergencia de análisis estático, grafo de conocimiento y protocolo estándar (MCP) para que cualquier cliente (Cursor, MaxPrime, orquestadores internos) consuma el mismo contrato sin acoplamiento a un único IDE o vendor.

---

## 5. Modelo Económico y ROI

**Costo de adquisición:** Despliegue on-premise o en la nube (Docker Compose documentado); integración con Bitbucket/GitHub existentes; configuración de credenciales y webhooks. No hay licencias por desarrollador en el modelo actual del código: el costo es infraestructura (FalkorDB, PostgreSQL, Redis, servicios NestJS/React) y tiempo de implementación.

**Retorno de inversión:** Reducción de incidentes por refactors mal acotados (la IA deja de proponer cambios que rompen dependencias no vistas); aceleración de onboarding (preguntas en lenguaje natural sobre el código y diagnósticos de deuda sin auditorías manuales); priorización objetiva de reingeniería (antipatrones y duplicados cuantificados); y flujos legacy (ej. listas de archivos a modificar) con precisión verificable, evitando ciclos de corrección y retrabajo. El tiempo de recuperación depende del volumen de cambios en legacy y del coste de un incidente o de una semana de auditoría manual; en escenarios con bases de código grandes y equipos que ya usan IA para código, el ROI se justifica por la reducción de regresiones y por la capacidad de escalar refactors con confianza.

---

## 6. Nota de Integridad

Toda la información de esta presentación se basa en las capacidades reales del software Ariadne (ariadne-ai-scout / AriadneSpecs), documentadas en el repositorio y en los servicios desplegados: ingest, API, orquestador, servidor MCP y frontend. Las funcionalidades descritas — indexación desde Bitbucket/GitHub, grafo FalkorDB, herramientas MCP (impacto, contrato, validación previa, análisis, chat, plan de modificación), diagnóstico de deuda y antipatrones, credenciales cifradas — están implementadas y referenciables en código y documentación. No se han exagerado capacidades ni se han prometido resultados no soportados por el sistema. El tono es persuasivo y orientado a negocio, pero cada afirmación es defendible frente a una revisión técnica o comercial.
