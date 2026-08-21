// components/ActivityTimeline.tsx
//
// Dibuja una lista de gestiones de la bitácora, de la más reciente a la más
// antigua.
//
// IMPORTANTE: este componente NO lee de localStorage. Recibe las actividades ya
// resueltas. Esa es la diferencia entre reusar la bitácora y crear un segundo
// historial: si cada pantalla llamara a listActivities() con sus propios
// filtros, el embudo mostraría una lista y el panel otra para el mismo negocio.
// Acá el que llama decide QUÉ actividades son; este archivo solo decide cómo se
// ven.
//
// En el Embudo de Ventas las actividades vienen de
// opportunityContext.activitiesForOpportunity(), que es la misma fuente que
// alimenta el indicador de "gestión reciente" de la tarjeta. Por construcción,
// tarjeta y panel no pueden contradecirse.

import React from "react";
import { Phone, Mail, Users, Building2, MessageCircle, StickyNote, CheckCircle2, Bell } from "lucide-react";
import type { ActivityV2 } from "../types";
import { followUpState, isActivityDone } from "../services/activityStatus";

interface Props {
  activities: ActivityV2[];
  /** Cuántas mostrar antes de cortar. undefined = todas. */
  limit?: number;
  emptyLabel?: string;
  /** Momento de referencia para calcular vencidos. Se inyecta en las pruebas. */
  now?: Date;
}

/**
 * Icono por tipo de gestión.
 *
 * La comparación es laxa (minúsculas, `includes`) porque el campo `type` es un
 * string libre: conviven "Llamada", "Seguimiento", "Seguimiento completado" y
 * lo que haya escrito AXIS. Un `switch` exacto dejaría la mitad sin icono.
 */
const iconFor = (type: string) => {
  const t = (type || "").toLowerCase();
  if (t.includes("llamada")) return Phone;
  if (t.includes("correo") || t.includes("mail")) return Mail;
  if (t.includes("reunión") || t.includes("reunion") || t.includes("videollamada")) return Users;
  if (t.includes("visita")) return Building2;
  if (t.includes("whatsapp")) return MessageCircle;
  if (t.includes("completad")) return CheckCircle2;
  if (t.includes("seguimiento")) return Bell;
  return StickyNote;
};

const formatWhen = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const FOLLOW_UP_BADGE: Record<string, string> = {
  vencido: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  hoy: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  proximo: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  completado: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  "sin-fecha": "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

const ActivityTimeline: React.FC<Props> = ({
  activities,
  limit,
  emptyLabel = "Todavía no hay gestiones registradas en esta oportunidad.",
  now,
}) => {
  if (!activities || activities.length === 0) {
    return (
      <div className="p-4 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-sm text-slate-400">
        {emptyLabel}
      </div>
    );
  }

  const shown = typeof limit === "number" ? activities.slice(0, limit) : activities;

  return (
    <ol className="relative space-y-3">
      {shown.map((a, index) => {
        const Icon = iconFor(a.type);
        const done = isActivityDone(a);
        const info = a.followUpAt ? followUpState(a.followUpAt, a.status, now) : undefined;
        const isLast = index === shown.length - 1;

        return (
          <li key={a.id} className="relative pl-8">
            {/* Línea vertical que une los hitos. No se dibuja en el último
                para que no quede un trazo colgando en el aire. */}
            {!isLast && (
              <span
                aria-hidden="true"
                className="absolute left-[11px] top-7 bottom-[-12px] w-px bg-slate-200 dark:bg-slate-700"
              />
            )}

            <span
              className={`absolute left-0 top-1 w-6 h-6 rounded-full flex items-center justify-center ${
                done
                  ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400"
                  : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
              }`}
            >
              <Icon size={13} />
            </span>

            <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-800/40 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-300 break-words">
                  {a.type || "Gestión"}
                </span>
                <span className="text-[10px] text-slate-400 shrink-0 whitespace-nowrap">
                  {formatWhen(a.createdAt)}
                </span>
              </div>

              {/* whitespace-pre-line: AXIS guarda las transcripciones con saltos
                  de línea ("Gestión registrada desde Axis:\n\n..."). Sin esto
                  todo queda pegado en un párrafo ilegible. */}
              <p className="mt-1 text-sm text-slate-700 dark:text-slate-300 break-words whitespace-pre-line">
                {a.description || "Sin descripción."}
              </p>

              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="text-[10px] text-slate-400">{a.user || "—"}</span>
                {info && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      FOLLOW_UP_BADGE[info.state] || FOLLOW_UP_BADGE["sin-fecha"]
                    }`}
                  >
                    {info.label}
                  </span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default ActivityTimeline;
