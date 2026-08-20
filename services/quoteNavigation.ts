// services/quoteNavigation.ts
//
// Puente entre el Embudo de Ventas y la vista de Cotizaciones.
//
// Desde el panel de una oportunidad el asesor puede pedir "ver", "editar",
// "imprimir" o "duplicar" la cotización asociada. Esas acciones viven en
// Quotes.tsx, que puede no estar montada en ese momento, así que la orden se
// deja escrita en localStorage y la vista la consume cuando se monta (o al
// instante, si ya estaba montada, gracias al evento).
//
// Es el mismo patrón que ya usa AXIS con "axis_quote_prompt" / "axis:create-quote".
// Se centraliza acá para que la clave y el nombre del evento existan una sola
// vez: si se escriben a mano en las dos pantallas, un typo rompe la navegación
// en silencio y no lo detecta ni el compilador ni una prueba.

/** Clave de localStorage donde queda la orden pendiente. */
export const QUOTE_ACTION_KEY = "pipeline:quote-action";

/** Evento que avisa a Cotizaciones que hay una orden nueva por leer. */
export const QUOTE_ACTION_EVENT = "pipeline:open-quote";

/**
 * Qué quiere hacer el asesor con la cotización.
 *
 * "ver" y "editar" abren la misma ficha porque hoy NO existe una vista de solo
 * lectura de cotizaciones: al hacer clic en una tarjeta en Cotizaciones se abre
 * el modal de edición. La diferencia se limita a la pestaña inicial (resumen vs
 * ítems). Cuando exista una vista de lectura, cambia el destino de "ver" y nada
 * más: el resto del embudo no se entera.
 */
export type QuoteActionMode = "ver" | "editar" | "imprimir" | "duplicar";

export interface QuoteAction {
  quoteId: string;
  mode: QuoteActionMode;
  /** Marca de tiempo para poder descartar órdenes viejas si alguna vez hiciera falta. */
  ts: number;
}

/** Deja la orden escrita y avisa. No navega: de eso se encarga quien llama. */
export function requestQuoteAction(quoteId: string, mode: QuoteActionMode): void {
  if (typeof window === "undefined") return;
  const action: QuoteAction = { quoteId, mode, ts: Date.now() };
  try {
    window.localStorage.setItem(QUOTE_ACTION_KEY, JSON.stringify(action));
  } catch {
    // Si localStorage está lleno o bloqueado no tiene sentido navegar a ciegas.
    return;
  }
  window.dispatchEvent(new CustomEvent(QUOTE_ACTION_EVENT, { detail: action }));
}

/** Lee la orden pendiente sin consumirla. Devuelve undefined si no hay o está corrupta. */
export function readQuoteAction(): QuoteAction | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(QUOTE_ACTION_KEY);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as QuoteAction;
    if (!parsed || typeof parsed.quoteId !== "string" || !parsed.quoteId) {
      clearQuoteAction();
      return undefined;
    }
    return parsed;
  } catch {
    clearQuoteAction();
    return undefined;
  }
}

export function clearQuoteAction(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(QUOTE_ACTION_KEY);
  } catch {
    /* nada que hacer */
  }
}
