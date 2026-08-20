// services/activityStatus.ts
//
// Estado de una actividad/seguimiento, sin depender de localStorage.
//
// Esta lógica vivía dentro de storage.ts (isActivityDone) y repetida en
// Axis.tsx (getFollowUpStatus). Separarla en un módulo puro permite:
//   1. usarla desde el motor del embudo sin arrastrar todo el almacenamiento,
//   2. probarla en Node,
//   3. que "vencido" signifique lo mismo en Axis, en el Dashboard y en el
//      panel de la oportunidad. Si cada pantalla decide por su cuenta qué es
//      un seguimiento vencido, el asesor ve tres respuestas distintas para el
//      mismo dato y deja de confiar en todas.
//
// storage.ts vuelve a exportar isActivityDone para no romper los imports que
// ya existen: la implementación es una sola.

/**
 * Una actividad está "cerrada" cuando ya no exige acción.
 *
 * Se aceptan variantes en masculino/femenino porque en localStorage conviven
 * registros escritos por distintas versiones de la app. Normalizar acá es más
 * seguro que migrar datos guardados.
 */
export function isActivityDone(activity: { status?: string } | null | undefined): boolean {
  if (!activity) return false;
  const s = (activity.status || "").toLowerCase().trim();
  return (
    s === "completada" ||
    s === "completado" ||
    s === "realizado" ||
    s === "realizada" ||
    s === "cancelada" ||
    s === "cancelado"
  );
}

export type FollowUpState = "sin-fecha" | "vencido" | "hoy" | "proximo" | "completado";

export interface FollowUpInfo {
  state: FollowUpState;
  label: string;
  /** Días de retraso. Solo es mayor que cero cuando state === "vencido". */
  daysOverdue: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Diferencia en días naturales (no en horas): hoy a las 23:00 y hoy a las 01:00 son el mismo día. */
export function calendarDaysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / DAY_MS);
}

/**
 * Clasifica la fecha de un seguimiento respecto de "ahora".
 *
 * Se compara por día calendario a propósito: un seguimiento agendado para hoy
 * a las 9:00 sigue siendo "Hoy" a las 15:00, no "Vencido". Marcarlo vencido a
 * media mañana genera alarmas que el asesor aprende a ignorar.
 */
export function followUpState(
  followUpAt: string | null | undefined,
  status?: string,
  now: Date = new Date()
): FollowUpInfo {
  if (isActivityDone({ status })) {
    return { state: "completado", label: "Completada", daysOverdue: 0 };
  }
  if (!followUpAt) {
    return { state: "sin-fecha", label: "Sin fecha", daysOverdue: 0 };
  }

  const date = new Date(followUpAt);
  if (Number.isNaN(date.getTime())) {
    return { state: "sin-fecha", label: "Sin fecha", daysOverdue: 0 };
  }

  const diff = calendarDaysBetween(now, date); // negativo = quedó atrás
  if (diff < 0) {
    const dias = Math.abs(diff);
    return {
      state: "vencido",
      label: dias === 1 ? "Vencido ayer" : `Vencido hace ${dias} días`,
      daysOverdue: dias,
    };
  }
  if (diff === 0) return { state: "hoy", label: "Hoy", daysOverdue: 0 };
  if (diff === 1) return { state: "proximo", label: "Mañana", daysOverdue: 0 };
  return { state: "proximo", label: `En ${diff} días`, daysOverdue: 0 };
}
