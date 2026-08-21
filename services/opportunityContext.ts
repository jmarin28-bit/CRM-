// services/opportunityContext.ts
//
// Motor del Embudo de Ventas: reúne, para UNA oportunidad, todo lo que el CRM
// ya sabe de ella — empresa, contacto, asesor, cotización, actividad, próximo
// seguimiento y alertas.
//
// Por qué existe este archivo y no lógica suelta dentro de Pipeline.tsx:
//
//   1. La oportunidad es el centro comercial que conecta cotizaciones,
//      empresas, contactos y actividades. Si cada pantalla vuelve a cruzar
//      esos datos por su cuenta, terminan mostrando cifras distintas del
//      mismo negocio. Acá se cruza una sola vez.
//   2. Las fases siguientes (salud 0-100, explicación de factores, análisis
//      IA, recomendaciones, Director Comercial IA) necesitan exactamente este
//      mismo contexto. Construirlo aparte evita rehacerlo cuatro veces.
//   3. No toca localStorage ni React: recibe los datos ya leídos. Eso permite
//      probarlo en Node y, cuando IONCORE migre a backend, cambiar de dónde
//      salen los datos sin tocar la interfaz.
//
// Regla que se respeta en todo el archivo: aquí NO se inventa información.
// Todo lo que se reporta sale de un campo guardado. Cuando algo no se puede
// saber, se dice que no se sabe en lugar de rellenarlo con un valor plausible.

import type {
  AccountV2,
  ActivityV2,
  ContactV2,
  OpportunityStage,
  OpportunityV2,
  QuoteStatus,
  QuoteV2,
} from "../types";
// La extensión .ts es explícita a propósito: este módulo también se ejecuta en
// Node (`node --experimental-strip-types`) para las pruebas, y Node no adivina
// extensiones. Vite y tsc lo resuelven igual gracias a allowImportingTsExtensions.
import { calendarDaysBetween, followUpState, isActivityDone } from "./activityStatus.ts";
import type { FollowUpState } from "./activityStatus.ts";
// opportunityHealth importa de acá solo TIPOS y los umbrales por defecto, así
// que no hay ciclo en tiempo de ejecución: el puntaje no sabe qué es un contexto.
import { computeHealth } from "./opportunityHealth.ts";
import type { OpportunityHealth } from "./opportunityHealth.ts";

// ============================================================
// 1. Umbrales
// ============================================================
//
// Se reciben como parámetro (con estos valores por defecto) para que la vista
// pueda pasar los de BUSINESS_RULES y no existan dos verdades sobre qué es una
// oportunidad estancada. Este módulo no importa analytics/storage a propósito:
// hacerlo arrastraría localStorage y dejaría de poder probarse en Node.

export interface ContextThresholds {
  /** Días sin actividad tras los cuales la oportunidad se considera estancada. */
  stalledDays: number;
  /** Días dentro de los cuales una actividad cuenta como "reciente". */
  recentActivityDays: number;
  /** Días de cierre próximo que ya merecen atención. */
  closingSoonDays: number;
  /** Días sin respuesta tras enviar una cotización antes de avisar. */
  quoteSilenceDays: number;
}

export const DEFAULT_THRESHOLDS: ContextThresholds = {
  stalledDays: 14,
  recentActivityDays: 7,
  closingSoonDays: 7,
  quoteSilenceDays: 7,
};

// ============================================================
// 2. Etiquetas de cotización
// ============================================================
//
// Vivían dentro de Quotes.tsx. Se mueven acá porque el embudo también las
// necesita y dos tablas de etiquetas separadas se desincronizan en cuanto
// alguien agrega un estado nuevo.

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  borrador: "Borrador",
  pendiente_costo_proveedor: "Pendiente por costo del proveedor",
  revisada: "Revisada",
  enviada: "Enviada",
  con_oc: "Con OC",
  rechazada: "Rechazada",
  cancelada: "Cancelada",
  vencida: "Vencida",
};

export const QUOTE_STATUS_BADGE: Record<QuoteStatus, string> = {
  borrador: "bg-slate-100 text-slate-700",
  pendiente_costo_proveedor: "bg-amber-100 text-amber-700",
  revisada: "bg-indigo-100 text-indigo-700",
  enviada: "bg-blue-100 text-blue-700",
  con_oc: "bg-emerald-100 text-emerald-700",
  rechazada: "bg-rose-100 text-rose-700",
  cancelada: "bg-red-100 text-red-700",
  vencida: "bg-stone-100 text-stone-700",
};

export const quoteStatusLabel = (status?: QuoteStatus | string): string =>
  (status && QUOTE_STATUS_LABEL[status as QuoteStatus]) || String(status || "");

export const quoteStatusBadge = (status?: QuoteStatus | string): string =>
  (status && QUOTE_STATUS_BADGE[status as QuoteStatus]) || "bg-slate-100 text-slate-700";

// ============================================================
// 3. Tipos del contexto
// ============================================================

export interface NextAction {
  activityId: string;
  type: string;
  description: string;
  /** ISO de la fecha agendada. */
  at: string;
  state: FollowUpState;
  label: string;
  daysOverdue: number;
}

export type AlertSeverity = "info" | "warn" | "risk";

export interface OpportunityAlert {
  code: string;
  label: string;
  severity: AlertSeverity;
}

export interface OpportunityContext {
  opportunity: OpportunityV2;

  account?: AccountV2;
  contact?: ContactV2;
  accountName: string;
  /** Cadena vacía cuando la oportunidad no tiene contacto: no se inventa uno. */
  contactName: string;
  ownerName: string;

  quote?: QuoteV2;
  quoteStatusText: string;

  valorCOP: number;
  valorPonderadoCOP: number;

  /** Actividades atribuibles a esta oportunidad, de más reciente a más antigua. */
  activities: ActivityV2[];
  lastActivity?: ActivityV2;
  /** undefined cuando no hay ninguna actividad registrada. */
  daysSinceLastActivity?: number;
  daysSinceUpdate: number;
  /** Días hasta el cierre estimado. Negativo si la fecha ya pasó. */
  daysToClose: number;
  /** Días desde que se envió la cotización. undefined si no se ha enviado. */
  daysSinceQuoteSent?: number;

  nextAction?: NextAction;

  isOpen: boolean;
  hasRecentActivity: boolean;
  hasPendingFollowUp: boolean;
  alerts: OpportunityAlert[];
  /** Atajo para el punto rojo de la tarjeta: hay al menos una alerta grave. */
  hasRisk: boolean;

  /**
   * Salud comercial 0-100. Se calcula acá, en la misma pasada, y no en la vista:
   * si la tarjeta y el panel lo calcularan cada uno por su lado, el tablero
   * podría marcar una oportunidad en riesgo y el panel decir que está sana.
   */
  health: OpportunityHealth;
}

export interface ContextData {
  accounts: AccountV2[];
  contacts: ContactV2[];
  quotes: QuoteV2[];
  activities: ActivityV2[];
  users: Array<{ id: string; name: string }>;
  /** TRM vigente, para expresar en COP lo que está en USD. */
  trm: number;
  now?: Date;
  thresholds?: Partial<ContextThresholds>;
}

// ============================================================
// 4. Helpers
// ============================================================

const CLOSED_STAGES: OpportunityStage[] = ["Ganado", "Perdido"];

export const isOpenOpportunity = (etapa: string): boolean =>
  !CLOSED_STAGES.includes(etapa as OpportunityStage);

export const accountLabel = (account?: AccountV2): string =>
  account ? account.nombreComercial || account.razonSocial || "Empresa sin nombre" : "";

/** Los registros viejos guardaban el nombre en `name` en vez de `fullName`. */
export const contactLabel = (contact?: ContactV2): string =>
  contact ? contact.fullName || contact.name || "Contacto sin nombre" : "";

export const toCOPValue = (valor: number, moneda: string | undefined, trm: number): number => {
  const base = Number.isFinite(valor) ? valor : 0;
  return moneda === "USD" ? base * trm : base;
};

/**
 * Encuentra la cotización de una oportunidad.
 *
 * El vínculo está guardado por duplicado y a veces solo existe uno de los dos
 * lados: la oportunidad apunta con `quoteId` y la cotización con
 * `opportunityId`. Se buscan ambos, en ese orden, porque el que puso el asesor
 * a mano (quoteId) debe ganar sobre el que dejó automáticamente el asistente.
 */
export const resolveOpportunityQuote = (
  opp: Pick<OpportunityV2, "id" | "quoteId">,
  quotes: QuoteV2[]
): QuoteV2 | undefined =>
  (opp.quoteId ? quotes.find((q) => q.id === opp.quoteId) : undefined) ||
  quotes.find((q) => q.opportunityId === opp.id);

/**
 * Actividades atribuibles a la oportunidad.
 *
 * ActivityV2 nació ligada a la empresa y al contacto, no a la oportunidad, así
 * que el vínculo se deduce. El campo opcional `opportunityId` permite que lo
 * que se registre de ahora en adelante quede atado con precisión, sin migrar
 * nada de lo ya guardado:
 *
 *   1. Si la actividad declara opportunityId, manda ese dato y solo ese.
 *   2. Si no, se toma la actividad de la misma empresa, salvo que esté dirigida
 *      explícitamente a OTRO contacto: esa conversación es de otro hilo y
 *      mezclarla haría ver movimiento donde no lo hubo.
 *
 * Es una aproximación y está declarada como tal: con varias oportunidades
 * abiertas en la misma empresa y el mismo contacto, todas comparten historial.
 * Preferimos mostrar de más y decirlo, antes que ocultar una llamada real.
 */
export const activitiesForOpportunity = (
  opp: Pick<OpportunityV2, "id" | "accountId" | "contactId">,
  activities: ActivityV2[]
): ActivityV2[] =>
  activities
    .filter((a) => {
      if (a.opportunityId) return a.opportunityId === opp.id;
      if (a.accountId !== opp.accountId) return false;
      if (opp.contactId && a.contactId && a.contactId !== opp.contactId) return false;
      return true;
    })
    .sort((a, b) => createdTime(b) - createdTime(a));

/**
 * La línea de tiempo se ordena por createdAt, NO por followUpAt.
 *
 * createdAt es cuándo ocurrió el registro; followUpAt es una cita futura.
 * Ordenar por la fecha agendada pondría un seguimiento para dentro de una
 * semana por encima de la llamada de ayer, y la actividad más reciente
 * pasaría a ser un evento que todavía no sucedió.
 */
const createdTime = (a: ActivityV2): number => {
  const t = new Date(a.createdAt || 0).getTime();
  return Number.isFinite(t) ? t : 0;
};

/**
 * Próxima acción: el seguimiento pendiente más urgente.
 *
 * "Más urgente" es el de fecha más antigua, no el más cercano a hoy: si hay
 * uno vencido hace tres días y otro para mañana, el que hay que resolver es el
 * vencido. Mostrar el de mañana escondería el retraso.
 */
export const nextActionOf = (
  activities: ActivityV2[],
  now: Date = new Date()
): NextAction | undefined => {
  const pendientes = activities
    .filter((a) => a.followUpAt && !isActivityDone(a))
    .filter((a) => !Number.isNaN(new Date(a.followUpAt!).getTime()))
    .sort((a, b) => new Date(a.followUpAt!).getTime() - new Date(b.followUpAt!).getTime());

  const target = pendientes[0];
  if (!target) return undefined;

  const info = followUpState(target.followUpAt, target.status, now);
  return {
    activityId: target.id,
    type: target.type || "Seguimiento",
    description: target.description || "",
    at: target.followUpAt!,
    state: info.state,
    label: info.label,
    daysOverdue: info.daysOverdue,
  };
};

const daysSince = (iso: string | undefined, now: Date): number | undefined => {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return calendarDaysBetween(d, now);
};

// ============================================================
// 5. Alertas
// ============================================================
//
// Cada alerta apunta a algo que el asesor puede corregir hoy. No se marca lo
// que simplemente "se ve mal": una alerta que no sugiere una acción concreta
// solo enseña a ignorar el color rojo.

export const buildAlerts = (
  // Las alertas se calculan ANTES que la salud y no la reciben: la salud no
  // puede ser insumo de una alerta o el razonamiento se volvería circular.
  ctx: Omit<OpportunityContext, "alerts" | "hasRisk" | "health">,
  th: ContextThresholds
): OpportunityAlert[] => {
  const alerts: OpportunityAlert[] = [];
  if (!ctx.isOpen) return alerts; // Ganado y Perdido ya no exigen nada.

  const { opportunity: opp } = ctx;

  if (!ctx.contact) {
    alerts.push({
      code: "sin-contacto",
      label: "La oportunidad no tiene contacto asociado.",
      severity: "warn",
    });
  }

  if (!ctx.quote && (opp.etapa === "Cotización" || opp.etapa === "Negociación")) {
    alerts.push({
      code: "sin-cotizacion",
      label: `Está en etapa ${opp.etapa} pero no tiene cotización vinculada.`,
      severity: "warn",
    });
  }

  if (ctx.daysToClose < 0) {
    const dias = Math.abs(ctx.daysToClose);
    alerts.push({
      code: "cierre-vencido",
      label: `La fecha estimada de cierre pasó hace ${dias} ${dias === 1 ? "día" : "días"}.`,
      severity: "risk",
    });
  } else if (ctx.daysToClose <= th.closingSoonDays) {
    alerts.push({
      code: "cierre-proximo",
      label:
        ctx.daysToClose === 0
          ? "El cierre estimado es hoy."
          : `Cierre estimado en ${ctx.daysToClose} ${ctx.daysToClose === 1 ? "día" : "días"}.`,
      severity: "info",
    });
  }

  if (ctx.daysSinceLastActivity === undefined) {
    if (ctx.daysSinceUpdate >= th.stalledDays) {
      alerts.push({
        code: "sin-actividad-nunca",
        label: "No hay ninguna actividad registrada en esta oportunidad.",
        severity: "risk",
      });
    }
  } else if (ctx.daysSinceLastActivity >= th.stalledDays) {
    alerts.push({
      code: "sin-actividad",
      label: `Sin actividad registrada hace ${ctx.daysSinceLastActivity} días.`,
      severity: "risk",
    });
  }

  if (ctx.nextAction?.state === "vencido") {
    alerts.push({
      code: "seguimiento-vencido",
      label: `Hay un seguimiento vencido hace ${ctx.nextAction.daysOverdue} ${
        ctx.nextAction.daysOverdue === 1 ? "día" : "días"
      }.`,
      severity: "risk",
    });
  } else if (!ctx.nextAction) {
    alerts.push({
      code: "sin-proxima-accion",
      label: "No hay una próxima acción programada.",
      severity: "warn",
    });
  }

  // Silencio tras enviar la cotización.
  //
  // Ojo con la condición de "no hay respuesta": no basta con que hayan pasado
  // muchos días desde el envío. Si el asesor registró una gestión DESPUÉS de
  // enviarla ("se confirmó recepción", "quedaron de responder el lunes"), sí
  // hubo respuesta y decirle lo contrario es acusarlo de no haber trabajado.
  // Ese es justo el tipo de aviso falso que enseña a ignorar el color rojo.
  //
  // `daysSinceLastActivity < daysSinceQuoteSent` significa, en días naturales,
  // que la última gestión es posterior al envío.
  const huboGestionTrasEnviar =
    ctx.daysSinceLastActivity !== undefined &&
    ctx.daysSinceQuoteSent !== undefined &&
    ctx.daysSinceLastActivity < ctx.daysSinceQuoteSent;

  if (
    ctx.quote?.status === "enviada" &&
    ctx.daysSinceQuoteSent !== undefined &&
    ctx.daysSinceQuoteSent >= th.quoteSilenceDays &&
    !huboGestionTrasEnviar
  ) {
    alerts.push({
      code: "cotizacion-sin-respuesta",
      label: `La cotización se envió hace ${ctx.daysSinceQuoteSent} días y no hay respuesta registrada.`,
      severity: "risk",
    });
  }

  return alerts;
};

// ============================================================
// 6. Constructor
// ============================================================

export const buildOpportunityContext = (
  opp: OpportunityV2,
  data: ContextData
): OpportunityContext => {
  const now = data.now || new Date();
  const th = { ...DEFAULT_THRESHOLDS, ...(data.thresholds || {}) };

  const quote = resolveOpportunityQuote(opp, data.quotes);

  // La cotización sirve de respaldo para resolver empresa y contacto: hay
  // oportunidades creadas desde el asistente cuyo accountId quedó vacío pero
  // cuya cotización sí sabe de quién es.
  const account =
    data.accounts.find((a) => a.id === opp.accountId) ||
    (quote ? data.accounts.find((a) => a.id === quote.accountId) : undefined);
  const contact =
    data.contacts.find((c) => c.id === opp.contactId) ||
    (quote ? data.contacts.find((c) => c.id === quote.contactId) : undefined);

  const activities = activitiesForOpportunity(opp, data.activities);
  const lastActivity = activities[0];

  const valorCOP = toCOPValue(opp.valor, opp.moneda, data.trm);
  const probabilidad = Number.isFinite(opp.probabilidad) ? opp.probabilidad : 0;

  const base: Omit<OpportunityContext, "alerts" | "hasRisk" | "health"> = {
    opportunity: opp,
    account,
    contact,
    accountName: accountLabel(account),
    contactName: contactLabel(contact),
    ownerName: data.users.find((u) => u.id === opp.ownerId)?.name || "Sin asignar",

    quote,
    quoteStatusText: quote ? quoteStatusLabel(quote.status) : "",

    valorCOP,
    valorPonderadoCOP: valorCOP * (probabilidad / 100),

    activities,
    lastActivity,
    daysSinceLastActivity: daysSince(lastActivity?.createdAt, now),
    daysSinceUpdate: daysSince(opp.updatedAt, now) ?? 0,
    daysToClose: -(daysSince(opp.fechaEstimadaCierre, now) ?? 0),
    daysSinceQuoteSent: daysSince(quote?.sentAt, now),

    nextAction: nextActionOf(activities, now),

    isOpen: isOpenOpportunity(opp.etapa),
    hasRecentActivity: false,
    hasPendingFollowUp: false,
  };

  base.hasRecentActivity =
    base.daysSinceLastActivity !== undefined &&
    base.daysSinceLastActivity <= th.recentActivityDays;
  base.hasPendingFollowUp = !!base.nextAction;

  const alerts = buildAlerts(base, th);

  // Los mismos umbrales que usan las alertas: si el tablero dice "estancada" a
  // los 14 días, la salud tiene que empezar a castigar en el mismo día.
  const health = computeHealth(
    {
      etapa: opp.etapa,
      isOpen: base.isOpen,
      daysSinceLastActivity: base.daysSinceLastActivity,
      nextActionState: base.nextAction?.state,
      nextActionDaysOverdue: base.nextAction?.daysOverdue,
      daysToClose: base.daysToClose,
      hasQuote: !!quote,
      quoteStatus: quote?.status,
    },
    th
  );

  return {
    ...base,
    alerts,
    hasRisk: alerts.some((a) => a.severity === "risk"),
    health,
  };
};

/** Construye el contexto de todas las oportunidades de una sola pasada. */
export const buildOpportunityContextMap = (
  opportunities: OpportunityV2[],
  data: ContextData
): Map<string, OpportunityContext> => {
  const map = new Map<string, OpportunityContext>();
  for (const opp of opportunities) {
    map.set(opp.id, buildOpportunityContext(opp, data));
  }
  return map;
};
