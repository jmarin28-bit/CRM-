import React, { useMemo, useState } from "react";
import { createActivity, listActivities, getActiveUser } from "../services/storage";
import type { ActivityType } from "../types";

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

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-CO", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function toLocalDatetimeValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

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

  const selectedMeta = TYPES.find((t) => t.key === type);

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

      <div className="mt-4 space-y-2">
        {items.length === 0 ? (
          <div className="text-sm text-slate-500 italic">No hay actividades registradas.</div>
        ) : (
          items.map((a: any) => (
            <div key={a.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900">
                    {(TYPES.find((t) => t.key === a.type)?.label || a.type || selectedMeta?.label)}{" "}
                    <span className="font-normal text-slate-500">· {a.user || "—"}</span>
                  </div>
                  <div className="mt-1 text-sm text-slate-700 break-words">{a.description}</div>

                  {a.followUpAt ? (
                    <div className="mt-2 inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                      Seguimiento: {formatWhen(a.followUpAt)}
                    </div>
                  ) : null}
                </div>

                <div className="shrink-0 text-xs text-slate-500">{formatWhen(a.createdAt)}</div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-3 text-[11px] text-slate-500">
        *Esto guarda el seguimiento. El siguiente paso será mostrar “Próximos seguimientos” en el Dashboard.
      </div>
    </div>
  );
}
