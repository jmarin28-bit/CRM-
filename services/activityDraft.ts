// services/activityDraft.ts
//
// Reglas para registrar una gestión o un seguimiento desde el panel de la
// oportunidad.
//
// Por qué vive acá y no dentro de Pipeline.tsx:
//
//   1. Convertir el valor de un <input type="datetime-local"> a ISO es un punto
//      clásico de error de zona horaria. En Colombia (UTC-5) una fecha mal
//      convertida corre el seguimiento cinco horas, y un seguimiento agendado
//      para las 8:00 a.m. aparece "vencido" desde el día anterior. Eso se
//      prueba mejor en Node que a ojo en el navegador.
//   2. Las validaciones ("¿qué pasó?", "¿cuándo?") son reglas de negocio, no
//      pintura. En un componente de 1.400 líneas quedan escondidas.
//   3. Cuando IONCORE migre a backend, esta validación se reusa tal cual: no
//      toca localStorage ni React.
//
// Este módulo NO guarda nada. Devuelve un borrador validado y quien llama
// decide si lo manda a createActivity().

/**
 * Tipos de gestión ofrecidos en el panel.
 *
 * Son los mismos textos que ya escriben AXIS y la bitácora de contactos
 * ("Llamada", "Correo", "Nota"...). Si acá se inventara un vocabulario nuevo,
 * el mismo hecho quedaría guardado con dos nombres y los filtros por tipo
 * dejarían de servir.
 */
export const ACTIVITY_TYPES = [
  "Llamada",
  "Correo",
  "Reunión",
  "Visita",
  "WhatsApp",
  "Nota",
] as const;

export type ActivityDraftType = (typeof ACTIVITY_TYPES)[number] | string;

/**
 * Tipo con el que se guarda un seguimiento programado.
 *
 * AXIS ya guarda sus tareas con este texto exacto (`type: "Seguimiento"` en
 * handleCreateFollowUp). Usar el mismo hace que lo que se cree desde el embudo
 * aparezca en las listas de AXIS y del Dashboard sin tocar esas pantallas.
 */
export const FOLLOW_UP_TYPE = "Seguimiento";

// ============================================================
// 1. Fechas
// ============================================================

const pad = (n: number) => String(n).padStart(2, "0");

/** Convierte un Date al formato que espera <input type="datetime-local">. */
export function toLocalDatetimeValue(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Lee un valor de datetime-local como hora LOCAL.
 *
 * Se parsea a mano en vez de `new Date(value)` a propósito. El motor trata
 * "2026-08-21" (solo fecha) como UTC y "2026-08-21T09:00" como local: son dos
 * reglas distintas para cadenas casi iguales. Construir el Date por
 * componentes elimina la duda y no depende de esa sutileza.
 */
export function parseLocalDatetime(value: string | undefined | null): Date | undefined {
  if (!value) return undefined;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return undefined;
  const [, y, mo, d, hh, mi] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), 0, 0);
  if (Number.isNaN(date.getTime())) return undefined;
  // Rechaza fechas imposibles: new Date(2026, 1, 31) no falla, se corre a marzo.
  if (date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) return undefined;
  return date;
}

export type FollowUpPreset = "manana" | "tres-dias" | "proxima-semana";

export const FOLLOW_UP_PRESETS: Array<{ key: FollowUpPreset; label: string; days: number }> = [
  { key: "manana", label: "Mañana", days: 1 },
  { key: "tres-dias", label: "En 3 días", days: 3 },
  { key: "proxima-semana", label: "En una semana", days: 7 },
];

/**
 * Hora por defecto de los atajos: 9 de la mañana.
 *
 * Es la misma que usa AXIS al detectar "el viernes" en una transcripción. Que
 * los dos caminos propongan la misma hora evita que el asesor vea dos
 * comportamientos distintos para la misma intención.
 */
export const DEFAULT_FOLLOW_UP_HOUR = 9;

/** Devuelve el valor de datetime-local correspondiente a un atajo. */
export function presetDatetimeValue(preset: FollowUpPreset, now: Date = new Date()): string {
  const days = FOLLOW_UP_PRESETS.find((p) => p.key === preset)?.days ?? 1;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, DEFAULT_FOLLOW_UP_HOUR, 0, 0, 0);
  return toLocalDatetimeValue(d);
}

// ============================================================
// 2. Validación
// ============================================================

export interface ActivityDraft {
  type: ActivityDraftType;
  description: string;
  /** Valor crudo del input datetime-local. Cadena vacía = sin seguimiento. */
  followUpLocal: string;
}

/**
 * Resultado de la validación.
 *
 * A propósito NO es una unión discriminada del estilo
 * `{ok:false, error} | {ok:true, ...}`, que sería lo natural en TypeScript.
 * El tsconfig de IONCORE no tiene `strict` ni `strictNullChecks`, y sin
 * strictNullChecks el compilador NO estrecha uniones por un discriminante
 * booleano: dentro de `if (!result.ok)` sigue viendo las dos ramas y marca
 * error al leer `result.error`. Comprobado con un caso mínimo, no supuesto.
 *
 * Un objeto plano con todos los campos siempre presentes funciona igual con o
 * sin strict y no obliga a poner `!` en cada acceso. Si algún día se activa
 * strict, esto sigue compilando.
 */
export interface ActivityDraftResult {
  ok: boolean;
  /** Cadena vacía cuando ok es true. */
  error: string;
  type: string;
  description: string;
  /** ISO, o null cuando la gestión no agenda nada. */
  followUpAt: string | null;
}

const invalid = (error: string): ActivityDraftResult => ({
  ok: false,
  error,
  type: "",
  description: "",
  followUpAt: null,
});

export interface ValidateOptions {
  /** true cuando el asesor pulsó "Crear seguimiento" y la fecha es obligatoria. */
  requireFollowUp: boolean;
  now?: Date;
}

/**
 * Valida el borrador antes de guardarlo.
 *
 * Criterio sobre fechas pasadas: se rechaza solo lo anterior a HOY, no lo
 * anterior a este instante. Agendar un seguimiento que ya nació vencido casi
 * siempre es un año o un mes mal tecleado, y guardarlo mete una alerta roja
 * falsa en el embudo. En cambio "hoy a las 8:00" cuando ya son las 10:00 es
 * legítimo: el asesor está registrando algo que quedó pendiente esta mañana.
 * La regla es avisar de lo que seguro es un error, no vigilar al asesor.
 */
export function validateActivityDraft(
  draft: ActivityDraft,
  opts: ValidateOptions
): ActivityDraftResult {
  const description = (draft.description || "").trim();
  if (!description) {
    return invalid(
      opts.requireFollowUp
        ? "Escribí qué hay que hacer en el seguimiento."
        : "Escribí qué pasó en la gestión."
    );
  }

  const type = String(draft.type || "").trim() || "Nota";
  const raw = (draft.followUpLocal || "").trim();

  if (!raw) {
    if (opts.requireFollowUp) {
      return invalid("Un seguimiento necesita fecha y hora.");
    }
    return { ok: true, error: "", type, description, followUpAt: null };
  }

  const when = parseLocalDatetime(raw);
  if (!when) {
    return invalid("La fecha del seguimiento no es válida.");
  }

  const now = opts.now || new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  if (when.getTime() < startOfToday.getTime()) {
    return invalid("La fecha del seguimiento ya pasó. Revisá el día.");
  }

  return { ok: true, error: "", type, description, followUpAt: when.toISOString() };
}
