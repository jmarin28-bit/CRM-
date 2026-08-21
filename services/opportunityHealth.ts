/**
 * Salud comercial de una oportunidad (0-100).
 *
 * Por qué este módulo existe aparte de opportunityContext:
 *
 *   1. No importa nada del contexto, así que no hay ciclo de importación. El
 *      contexto arma el input y llama acá; acá no se sabe qué es un contexto.
 *   2. Es puro y sin localStorage, así que se prueba en Node y sobrevive intacto
 *      la migración al backend. El día que el puntaje lo calcule el servidor,
 *      esta función se vuelve la referencia contra la cual comparar, no código
 *      a botar.
 *
 * CÓMO SE LEE EL NÚMERO (Etapa 14, importante):
 *
 * Esto es "Salud comercial: 82/100", NO "Probabilidad de ganar: 82%". No es lo
 * mismo y confundirlos hace daño real: una probabilidad promete un pronóstico
 * que estos datos no pueden sostener, y el asesor terminaría discutiendo con el
 * número en vez de usarlo. Lo que mide es cuán bien atendida está la
 * negociación: si se está gestionando, si tiene próximo paso, si las fechas
 * cuadran y si el papeleo acompaña a la etapa. Un negocio puede tener salud 95 y
 * perderse porque el cliente no tenía presupuesto; eso no es un fallo del
 * puntaje, es que el puntaje nunca prometió eso.
 *
 * MODELO: se parte de 100 y se restan penalizaciones, cada una con su texto.
 * Se eligió así, en vez de sumar puntos desde 0, porque la Etapa 6 pide explicar
 * los factores: restar deja una lista de frases concretas ("Sin gestión hace 21
 * días, -25") en vez de un peso abstracto imposible de justificarle a nadie.
 * Los factores se devuelven desde ya porque calcularlos ES el cálculo; la
 * pantalla que los explica llega en su etapa.
 */

// La extensión .ts es explícita a propósito: este módulo también corre en Node
// (`node --experimental-strip-types`) y Node no adivina extensiones.
import { DEFAULT_THRESHOLDS } from "./opportunityContext.ts";
import type { ContextThresholds } from "./opportunityContext.ts";

export type HealthSeverity = "warn" | "risk";

export interface HealthFactor {
  /** Estable, para pruebas y para que la IA pueda razonar sobre él sin parsear texto. */
  code: string;
  /** Frase lista para mostrarle al asesor. */
  label: string;
  /** Siempre negativo: lo que este problema le resta a la salud. */
  points: number;
  severity: HealthSeverity;
}

export type HealthBand = "sana" | "atencion" | "riesgo" | "cerrada";

export interface OpportunityHealth {
  score: number;
  band: HealthBand;
  bandLabel: string;
  factors: HealthFactor[];
  /**
   * false en oportunidades ya cerradas. Un negocio Ganado no tiene "salud":
   * mostrarle 45/100 a alguien que ya facturó es ruido. La vista pregunta por
   * esto antes de pintar nada.
   *
   * Es un booleano suelto, no una unión discriminada: el tsconfig de IONCORE no
   * tiene strictNullChecks y sin eso TypeScript NO estrecha uniones por un
   * discriminante booleano. Comprobado con un caso mínimo, no supuesto.
   */
  isScored: boolean;
}

/** Lo mínimo que hace falta para puntuar. Deliberadamente no es el contexto entero. */
export interface HealthInput {
  etapa: string;
  isOpen: boolean;
  /** undefined cuando no hay ninguna gestión registrada. */
  daysSinceLastActivity?: number;
  /** Estado del próximo seguimiento. undefined = no hay ninguno agendado. */
  nextActionState?: string;
  nextActionDaysOverdue?: number;
  /** Negativo si la fecha estimada de cierre ya pasó. */
  daysToClose: number;
  hasQuote: boolean;
  quoteStatus?: string;
}

// ── Umbrales de banda ────────────────────────────────────────────────────
export const HEALTHY_SCORE = 70;
export const ATTENTION_SCORE = 40;

/**
 * Debajo de esto la tarjeta del embudo muestra el puntaje; encima no muestra
 * nada. El tablero ya usa el color y la posición para comunicar, y si las
 * treinta tarjetas gritan un número, ninguna se lee. Marcar solo lo que está en
 * riesgo es lo que hace que la marca signifique algo.
 */
export const CARD_SCORE_THRESHOLD = ATTENTION_SCORE;

/** Etapas en las que ya se espera que exista una cotización. */
const STAGES_REQUIRING_QUOTE = ["Cotización", "Negociación"];

/** Estados de cotización que son un problema, no un avance. */
const BAD_QUOTE_STATUS: Record<string, string> = {
  rechazada: "La cotización fue rechazada",
  vencida: "La cotización está vencida",
  cancelada: "La cotización fue cancelada",
};

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

export const bandOf = (score: number): HealthBand =>
  score >= HEALTHY_SCORE ? "sana" : score >= ATTENTION_SCORE ? "atencion" : "riesgo";

export const bandLabel = (band: HealthBand): string =>
  band === "sana"
    ? "Sana"
    : band === "atencion"
    ? "Requiere atención"
    : band === "riesgo"
    ? "En riesgo"
    : "Cerrada";

/**
 * Clases de Tailwind por banda. Van acá y no en la vista para que la tarjeta y
 * el panel no puedan pintar de colores distintos el mismo puntaje.
 */
export const HEALTH_BAND_CLASS: Record<HealthBand, string> = {
  sana: "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-900/30 dark:border-emerald-800",
  atencion: "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/30 dark:border-amber-800",
  riesgo: "text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-900/30 dark:border-rose-800",
  cerrada: "text-slate-600 bg-slate-50 border-slate-200 dark:text-slate-300 dark:bg-slate-800 dark:border-slate-700",
};

/** Clase de la barra de progreso, del mismo origen que el color del texto. */
export const HEALTH_BAR_CLASS: Record<HealthBand, string> = {
  sana: "bg-emerald-500",
  atencion: "bg-amber-500",
  riesgo: "bg-rose-500",
  cerrada: "bg-slate-400",
};

// ============================================================
// Factores
// ============================================================

/**
 * 1. Días sin gestión.
 *
 * Es la señal más fuerte que hay en localStorage y desde la Fase C es fiable de
 * verdad: toda gestión nueva queda atada a su oportunidad con opportunityId, así
 * que "hace 21 días que nadie llama" ya no es una deducción por empresa.
 */
const activityFactor = (input: HealthInput, th: ContextThresholds): HealthFactor | undefined => {
  const d = input.daysSinceLastActivity;

  if (d === undefined) {
    // Pesa lo mismo que una abandonada hace más de un mes, y no menos. Al
    // principio restaba -25 y las pruebas de borde destaparon la inversión: una
    // oportunidad sin UNA sola gestión registrada salía mejor puntuada que una
    // con una llamada vieja de 40 días. No haber hecho nunca nada no puede
    // puntuar mejor que haber hecho algo, por viejo que sea.
    return {
      code: "sin-gestion",
      label: "No tiene ninguna gestión registrada",
      points: -35,
      severity: "risk",
    };
  }
  if (d <= th.recentActivityDays) return undefined;

  const label = `Sin gestión hace ${d} ${plural(d, "día", "días")}`;
  if (d <= th.stalledDays) return { code: "gestion-tibia", label, points: -10, severity: "warn" };
  if (d < 30) return { code: "gestion-estancada", label, points: -25, severity: "risk" };
  return { code: "gestion-abandonada", label, points: -35, severity: "risk" };
};

/**
 * 2. Seguimiento.
 *
 * No tener próximo paso pesa menos que tenerlo vencido, y es a propósito: no
 * haber agendado es un descuido, dejar caer algo que uno mismo se prometió es
 * una promesa incumplida al cliente.
 */
const followUpFactor = (input: HealthInput): HealthFactor | undefined => {
  const state = input.nextActionState;

  if (!state) {
    return {
      code: "sin-seguimiento",
      label: "No tiene un próximo paso agendado",
      points: -15,
      severity: "warn",
    };
  }
  if (state !== "vencido") return undefined;

  const overdue = Number.isFinite(input.nextActionDaysOverdue)
    ? Number(input.nextActionDaysOverdue)
    : 0;
  const label = overdue > 0
    ? `El seguimiento venció hace ${overdue} ${plural(overdue, "día", "días")}`
    : "El seguimiento está vencido";

  return overdue > 7
    ? { code: "seguimiento-vencido-viejo", label, points: -30, severity: "risk" }
    : { code: "seguimiento-vencido", label, points: -20, severity: "risk" };
};

/**
 * 3. Fecha estimada de cierre vencida.
 *
 * Casi nunca significa que el negocio se perdió: significa que el pronóstico
 * quedó desactualizado. Y un pronóstico desactualizado contamina el forecast de
 * todo el equipo, así que cuenta como problema aunque la negociación siga viva.
 */
const closeDateFactor = (input: HealthInput): HealthFactor | undefined => {
  const dtc = Number.isFinite(input.daysToClose) ? input.daysToClose : 0;
  if (dtc >= 0) return undefined;

  const overdue = Math.abs(dtc);
  const label = `La fecha de cierre venció hace ${overdue} ${plural(overdue, "día", "días")}`;

  return overdue > 30
    ? { code: "cierre-vencido-viejo", label, points: -25, severity: "risk" }
    : { code: "cierre-vencido", label, points: -20, severity: "risk" };
};

/**
 * 4. Coherencia entre la cotización y la etapa.
 *
 * No se premia tener cotización: se penaliza que la etapa diga una cosa y los
 * documentos otra. Una oportunidad en "Negociación" sin nada cotizado casi
 * siempre es una tarjeta que alguien arrastró de más, y esa es exactamente la
 * clase de dato que infla el embudo sin que nadie lo note.
 *
 * En etapas tempranas no tener cotización es lo normal y no resta nada.
 */
const quoteFactor = (input: HealthInput): HealthFactor | undefined => {
  if (!input.hasQuote) {
    if (!STAGES_REQUIRING_QUOTE.includes(input.etapa)) return undefined;
    return {
      code: "etapa-sin-cotizacion",
      label: `Está en etapa ${input.etapa} pero no tiene cotización asociada`,
      points: -15,
      severity: "warn",
    };
  }

  const problema = BAD_QUOTE_STATUS[String(input.quoteStatus || "")];
  if (!problema) return undefined;

  return { code: "cotizacion-caida", label: problema, points: -15, severity: "warn" };
};

// ============================================================
// Cálculo
// ============================================================

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function computeHealth(
  input: HealthInput,
  thresholds?: Partial<ContextThresholds>
): OpportunityHealth {
  // Un negocio cerrado no se puntúa. Ver el comentario de isScored.
  if (!input.isOpen) {
    return { score: 0, band: "cerrada", bandLabel: bandLabel("cerrada"), factors: [], isScored: false };
  }

  const th = { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) };

  const factors = [
    activityFactor(input, th),
    followUpFactor(input),
    closeDateFactor(input),
    quoteFactor(input),
  ].filter(Boolean) as HealthFactor[];

  // Ordenadas por lo que más resta: cuando la Etapa 6 las muestre, lo primero
  // que se lea tiene que ser lo que más está costando.
  factors.sort((a, b) => a.points - b.points);

  const score = clamp(100 + factors.reduce((sum, f) => sum + f.points, 0));
  const band = bandOf(score);

  return { score, band, bandLabel: bandLabel(band), factors, isScored: true };
}

/** Texto exacto que pide la Etapa 14. Existe para que nadie lo escriba a mano. */
export const healthSentence = (health: OpportunityHealth): string =>
  health.isScored ? `Salud comercial: ${health.score}/100` : "";
