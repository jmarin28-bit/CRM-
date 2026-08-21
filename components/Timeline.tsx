import React, { useMemo, useState } from "react";
import { createActivity, listActivities, getActiveUser } from "../services/storage";
import type { ActivityType } from "../types";
// El dibujo de la lista y el formato de fecha se comparten con el panel del
// Embudo de Ventas. Si cada pantalla tuviera su propia versión, la misma
// gestión se vería distinta en dos lugares y arreglar un detalle exigiría
// acordarse de tocar los dos archivos.
import ActivityTimeline from "./ActivityTimeline";
import { toLocalDatetimeValue } from "../services/activityDraft";

type Props = {
  accountId?: string;
  contactId?: string;
};

const TYPES: Array<{ key: ActivityType; label: string; icon: string }> = [
  { key: "Llamada", label: "Llamada", icon: "📞" },
  { key: "Reunión", label: "Reunión", icon: "📅" },
  { key: "Videollamada", label: "Videollamada", icon: "🎥" },
  { key: "Visita", label: "Visita", icon: "🏢" },
  { key: "Correo", label: "Correo", icon: "✉️" },
  { key: "Nota", label: "Nota", icon: "📝" },
];

export default function Timeline({ accountId, contactId }: Props) {
  const active = getActiveUser?.() ? getActiveUser() : { name: "Usuario" };
  const userName = (active as any).name || "Usuario";

  const [type, setType] = useState<ActivityType>("Llamada");
  const [text, setText] = useState("");
  const [followUpAt, setFollowUpAt] = useState<string>("");

  const [tick, setTick] = useState(0);

  const items = useMemo(() => {
    void tick;
    const data = listActivities({ accountId, contactId });
    return Array.isArray(data) ? data : [];
  }, [accountId, contactId, tick]);

  const onSave = () => {
    const desc = text.trim();
    if (!desc) return;
    // accountId es opcional en Props, pero una actividad sin cuenta no aparece
    // en ningún timeline. Mejor no guardarla que guardarla huérfana.
    if (!accountId) return;

    createActivity({
      accountId,
      contactId,
      type,
      description: desc,
      followUpAt: followUpAt ? new Date(followUpAt).toISOString() : undefined,
    });

    setText("");
    setFollowUpAt("");
    setTick((x) => x + 1);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-bold text-slate-900">Historial de Actividad</div>
        <div className="text-xs text-slate-500">Usuario: {userName}</div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {TYPES.map((t) => {
          const active = t.key === type;
          return (
            <button
              key={t.key}
              onClick={() => setType(t.key)}
              className={
                "rounded-full px-3 py-1 text-xs font-semibold border transition-colors " +
                (active
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100")
              }
              type="button"
            >
              {t.icon} {t.label}
            </button>
          );
        })}
      </div>

      {accountId && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
              placeholder={`Escribir seguimiento… (ej: se envió cotización)`}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
              onClick={onSave}
              type="button"
            >
              Guardar
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-xs font-semibold text-slate-600">Fecha/Hora de seguimiento (opcional):</div>
            <input
              type="datetime-local"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
              value={followUpAt}
              onChange={(e) => setFollowUpAt(e.target.value)}
              placeholder={toLocalDatetimeValue(new Date())}
            />
          </div>
        </div>
      )}

      <div className="mt-4">
        <ActivityTimeline
          activities={items}
          emptyLabel="No hay actividades registradas."
        />
      </div>

      <div className="mt-3 text-[11px] text-slate-500">
        *Esto guarda el seguimiento. El siguiente paso será mostrar “Próximos seguimientos” en el Dashboard.
      </div>
    </div>
  );
}
