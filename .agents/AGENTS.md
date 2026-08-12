# Reglas y Memoria del Proyecto: Ioncore CRM3 V4

Este archivo sirve como la **memoria persistente** y el conjunto de reglas del proyecto para asistentes IA.

---

## 📌 Visión General del Proyecto
**Ioncore CRM3 V4** es un CRM inteligente para **Ioncore SAS**, potenciado por la API de Google Gemini. Permite gestionar cuentas, contactos, oportunidades (pipeline), cotizaciones, proyectos e integraciones con Google Apps Script y servicios de IA.

- **Stack Principal**: React 19, Vite, TypeScript (~5.8), Tailwind / Vanilla CSS.
- **Librerías Clave**:
  - `@google/genai` (Integración con Gemini API)
  - `motion` (Framer Motion v12)
  - `lucide-react` (Iconografía)
  - `@dnd-kit/core` & `@dnd-kit/sortable` (Drag & drop para Pipeline/Kanban)
  - `recharts` (Visualizaciones y gráficos)
  - `jspdf` & `frappe-gantt` (Reportes PDF y diagramas Gantt)

---

## 📁 Estructura del Código
- `views/`: Vistas principales de la aplicación (`Accounts`, `Assistant`, `Axis`, `Contacts`, `Dashboard`, `Pipeline`, `Projects`, `Quotes`, `Login`).
- `services/`: Lógica de negocio e integración con APIs externas:
  - `gemini.ts`: Integración directa con Gemini AI.
  - `storage.ts`: Persistencia de datos locales y estado.
  - `googleScript.ts`: Integración con Google Apps Script.
  - `commercialGuide.ts`, `agentMemory.ts`, `analytics.ts`.
- `components/`: Componentes UI reutilizables y estructura de maquetación (`Layout.tsx`).
- `types.ts`: Tipos globales TypeScript y modelos de datos (Accounts, Contacts, Deals, Quotes, etc.).

---

## ⚙️ Reglas de Desarrollo y Buenas Prácticas
0. **🛡️ Regla de Oro - No Regresión (`.agents/rules/no_regression.md`)**:
   - **PROHIBIDO DAÑAR LO QUE YA FUNCIONA**.
   - Mapear dependencias antes de tocar código.
   - No eliminar funciones o lógica existente a menos que se pida explícitamente.
   - Validar ejecutando lints y verificaciones tras cambios.
1. **Preservar Tipado Strict en TypeScript**: Mantener las definiciones centralizadas en `types.ts`.
2. **Estilo y Diseño UI**: Mantener la estética visual moderna, limpia y fluida en tema oscuro/claro con micro-animaciones en componentes interactivos (`motion`).
3. **Manejo de Respuestas de IA y Claves Gemini (Formato `AQ.`)**:
   - Google AI Studio actualizó el formato de las claves de la API de `AIzaSy...` a **`AQ.`** (Authentication Keys / Auth Keys) para mejorar la seguridad y evitar filtraciones.
   - Las claves `AQ.` deben enviarse únicamente en cabeceras de solicitud (`x-goog-api-key`), omitiendo `Authorization: Bearer` (que se reserva exclusivamente para tokens OAuth2).
   - Todas las llamadas a Gemini se procesan de manera segura con validaciones de esquemas JSON y manejo de excepciones robusto (`services/gemini.ts`).
4. **Integridad de Datos**: Al realizar cambios en servicios de almacenamiento o esquemas, asegurar compatibilidad con la estructura actual en `services/storage.ts`.
5. **Formato e Idioma**: Mantener la interfaz y comentarios relevantes en español según los requerimientos del cliente Ioncore SAS.

---

## ⚡ Habilidades y Herramientas (Skills) del Proyecto
- **CodeGraph MCP (`codegraph`)**: Herramienta de búsqueda relacional semántica e intencional del código. Permite a Bruno, Molly y Walter inspeccionar llamadas, dependencias y referencias simbólicas mediante el grafo estructural del CRM en lugar de leer archivos crudos completos.
- **AgentMemory (`.agents/skills/`)**: Servidor y motor de memoria persistente compartido para Bruno, Molly y Walter. Utiliza **Git Snapshots** y **Memory Trees** vinculados al equipo `"crm-team"` (puerto 3111) para conservar aprendizajes, decisiones y contexto entre sesiones sin duplicar el consumo de tokens.
- **Token Saver (`.agents/skills/token-saver/SKILL.md`)**: Habilidad de optimización y compresión de contextos y salidas extensas de comandos para Bruno, Molly y Walter.
- **Antigravity Skills Repository (`.agents/antigravity-skills/`)**: Catálogo masivo con más de 300 habilidades especializadas (desarrollo frontend/backend, arquitectura, testing, UI/UX, optimizaciones y refactorización).
- **Codebase Memory MCP (`codebase-memory-mcp`)**: Servidor MCP de mapa estructural de código indexado (`DeusData/codebase-memory-mcp`). Directiva estricta para @bruno y @walter: Cada vez que intenten inspeccionar o analizar archivos de código del CRM, deben consultar primero el mapa estructural e índice semántico provisto por este servidor MCP en lugar de realizar lecturas crudas de los archivos fuente para optimizar el consumo de tokens.
- **Antigravity Context MCP (`.agents/antigravity-context-mcp/`)**: Servidor MCP de contexto persistente entre sesiones (recuperación de walkthroughs, planes de implementación, notas encriptadas y checklists de tareas).

---

## 🔒 Decisiones Técnicas Protegidas (NO Revertir)

### Axis — Separación de Contacto y Empresa Vinculada (`views/Axis.tsx`)
**Fecha**: 2026-08-12 | **Aprobado por**: Usuario

- **`getContactPersonName(contact)`**: Función que extrae **SOLO el nombre de la persona** desde `contact.fullName`, eliminando el sufijo de empresa si viene concatenado (ej: `"johan arevalo · SERVICIO GEOLOGICO COLOMBIANO"` → `"johan arevalo"`). Separadores reconocidos: `·`, `•`, ` - `. **NO eliminar ni modificar esta función**.
- **`findContactMatchesInText`**: Usa `getContactPersonName` (NO `getContactDisplayName`) para el scoring, evitando falsos positivos cuando palabras de la empresa aparecen en el texto dictado.
- **Dropdown de Contacto en Axis**: Las opciones muestran **SOLO `getContactPersonName(contact)`** — sin sufijo de empresa. La empresa se muestra exclusivamente en el campo `Empresa Vinculada`.
- **`findAccountInText`**: Detecta la empresa directamente desde la transcripción cuando no hay contacto seleccionado. `resolvedAccount` usa jerarquía: empresa del contacto → empresa detectada en texto.
- **`detectedAccount`**: `useMemo` que llama `findAccountInText(transcript, axisAccounts)`.

### Quotes — Contacto Primario y Clasificación de Ítems (`views/Quotes.tsx`)
**Fecha**: 2026-08-12 | **Aprobado por**: Usuario

- Al seleccionar una cuenta sin contacto explícito, se auto-selecciona el contacto primario de esa cuenta.
- `detectItemTypeAndUnit`: clasifica ítems como **Servicio** (mano de obra: mantenimientos, correctivos, capacitaciones, OQ/PV) o **Producto** (consumibles, reactivos, equipos, refacciones).
- La tabla de ítems incluye columna `Unidad / Tipo` con selector: `Producto/Unidad`, `Servicio (Mano de obra)`, `Hora`, `Día`, `Lote`, `Otro`.
- `detectQuoteTypeFromPrompt`: ignora nombres de empresa que contengan "servicio" para no confundir el tipo de cotización.

### Director Comercial IA — Jerarquía de Intenciones y Ciclo de Vida de Actividades (`components/agent/CommercialGuidePanel.tsx` & `services/storage.ts`)
**Fecha**: 2026-08-12 | **Aprobado por**: Usuario

- **Ciclo de Vida de Actividades**:
  - `vencida` es una **condición derivada** (`!isActivityDone(activity) && followUpAt < ahora`). NO es un estado estático permanente.
  - Al marcar como realizada desde AXIS o el Director IA, se guarda `status: "completada"` y `completedAt: timestamp`.
  - Una actividad completada o cancelada NUNCA vuelve a reportarse como vencida o pendiente.
- **Jerarquía Estricta de Intenciones en `buildAgentAnswer`**:
  1. `isTomorrowIntent` → Mañana (`tomorrowFollowUps`).
  2. `isOverdueIntent` → Vencidos exclusivamente (`overdueFollowUps`).
  3. `isTodayFollowUpIntent` → Seguimientos/llamadas de hoy exclusivamente (`todayFollowUps`).
  4. `isTodayPendingIntent` → Consolidado limpio de pendientes de hoy (vencidos + hoy + cotizaciones + tareas) SIN menú 1-10.
  5. `isBriefingIntent` → Plan operativo comercial completo con menú de acciones 1-10.


