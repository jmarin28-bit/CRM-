/**
 * Construcción y verificación del objeto que se GUARDA de una cotización.
 *
 * ------------------------------------------------------------------------
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ------------------------------------------------------------------------
 * El payload de guardado se armaba en línea dentro de `handleSave`, en dos
 * ramas distintas: `createQuote(quoteData)` para las nuevas y
 * `updateQuote({ ...draft, ...quoteData })` para las existentes. Dos caminos
 * que deben producir lo mismo pero que nadie garantizaba que lo hicieran, y
 * que no se podían probar sin montar React.
 *
 * El punto 5 del reporte pide que al reabrir una cotización guardada TODOS
 * los campos se vean exactamente como se guardaron. Para poder afirmarlo hace
 * falta poder ejecutarlo: por eso la construcción del payload vive aquí, es
 * pura, y `services/quoteDraft.test.ts` la recorre de ida y vuelta.
 *
 * ------------------------------------------------------------------------
 * QUÉ NORMALIZA
 * ------------------------------------------------------------------------
 * 1. La moneda de cada ítem sigue a la moneda de la cotización. Si el asesor
 *    cambia el desplegable de COP a USD después de que el asistente generó
 *    las líneas, los ítems se quedaban con la moneda vieja escrita en disco.
 * 2. `total` de cada ítem se recalcula desde cantidad × precio, para que un
 *    total heredado de una edición a medias no llegue al almacenamiento.
 * 3. Cantidades y precios se guardan como números. Los inputs de la tabla
 *    escriben strings ("3"), y un string en disco rompe las sumas al releer.
 *
 * Las funciones son puras y sin dependencias de React o del navegador.
 */

import type {
  QuoteCurrency,
  QuoteItem,
  QuoteNotes,
  QuoteTerms,
  QuoteV2,
} from "../types";

export interface QuoteTotals {
  subtotal: number;
  tax: number;
  total: number;
}

/**
 * Campos que el formulario de cotización edita y que, por tanto, deben
 * sobrevivir a un guardar + reabrir. Es la lista contra la que compara la
 * prueba de ida y vuelta.
 */
export const PERSISTED_QUOTE_FIELDS = [
  "id",
  "type",
  "status",
  "accountId",
  "contactId",
  "opportunityId",
  "currency",
  "issueDate",
  "validUntil",
  "items",
  "terms",
  "notes",
  "subtotal",
  "tax",
  "total",
  "deliveryAddress",
  "deliveryCity",
] as const;

/** Convierte a número lo que venga del input (string, null, undefined). */
export const toNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;

  // "1.250.000" y "1,250,000" son un millón doscientos cincuenta mil; "12,5"
  // es doce coma cinco. Se quitan los separadores de miles y se deja el
  // decimal como punto.
  const cleaned = value
    .trim()
    .replace(/\s/g, "")
    .replace(/[.,](?=\d{3}\b)/g, "")
    .replace(",", ".");

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Deja un ítem listo para guardar: números como números, moneda alineada con
 * la cotización y total recalculado.
 */
export const normalizeQuoteItem = (
  item: QuoteItem,
  currency: QuoteCurrency
): QuoteItem => {
  const quantity = toNumber(item.quantity);
  const unitPrice = toNumber(item.unitPrice);

  return {
    ...item,
    quantity,
    unitPrice,
    currency,
    total: quantity * unitPrice,
  };
};

export interface BuildQuotePayloadArgs {
  draft: Partial<QuoteV2>;
  quoteId: string;
  opportunityId: string;
  totals: QuoteTotals;
  /** Fecha de hoy en calendario local, "YYYY-MM-DD". */
  today: string;
}

/**
 * Arma el objeto a persistir a partir del borrador en pantalla.
 *
 * Devuelve SIEMPRE la misma forma, se trate de una cotización nueva o de una
 * edición: quien llama decide si la pasa a `createQuote` o la fusiona sobre
 * el registro existente con `updateQuote`.
 */
export const buildQuotePayload = ({
  draft,
  quoteId,
  opportunityId,
  totals,
  today,
}: BuildQuotePayloadArgs) => {
  const currency = (draft.currency || "COP") as QuoteCurrency;
  const items = (draft.items || []).map((item) =>
    normalizeQuoteItem(item as QuoteItem, currency)
  );

  return {
    id: quoteId,
    type: draft.type || "producto",
    status: draft.status || "borrador",
    accountId: draft.accountId!,
    // "" y undefined significan lo mismo aquí, pero solo undefined sobrevive
    // igual a una ida y vuelta por JSON.
    contactId: draft.contactId || undefined,
    opportunityId: opportunityId || undefined,
    currency,
    issueDate: draft.issueDate || today,
    validUntil: draft.validUntil || today,
    items,
    terms: draft.terms as QuoteTerms,
    notes: draft.notes as QuoteNotes,
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    deliveryAddress: draft.deliveryAddress,
    deliveryCity: draft.deliveryCity,
  };
};

// ==========================================================================
// VERIFICACIÓN DE IDA Y VUELTA
// ==========================================================================

/**
 * Compara lo que se guardó contra lo que se lee al reabrir y devuelve las
 * diferencias en lenguaje llano. Lista vacía = la cotización se reabre
 * idéntica.
 *
 * Se usa en las pruebas, pero está aquí a propósito: si mañana alguien añade
 * un campo al formulario y olvida incluirlo en `buildQuotePayload`, la prueba
 * de ida y vuelta lo señala por nombre.
 */
export const diffQuoteRoundTrip = (
  saved: Partial<QuoteV2>,
  reopened: Partial<QuoteV2>
): string[] => {
  const differences: string[] = [];

  for (const field of PERSISTED_QUOTE_FIELDS) {
    const before = (saved as any)[field];
    const after = (reopened as any)[field];

    if (JSON.stringify(before) !== JSON.stringify(after)) {
      differences.push(
        `${field}: se guardó ${JSON.stringify(
          before
        )} pero se reabrió ${JSON.stringify(after)}`
      );
    }
  }

  return differences;
};

// ==========================================================================
// REFERENCIAS QUE YA NO EXISTEN
// ==========================================================================

/**
 * Una cotización guarda ids de empresa, contacto y oportunidad. Esos
 * registros pueden desaparecer o cambiar de dueño después.
 *
 * Cuando eso pasa, el `<select>` correspondiente no encuentra su `<option>`
 * y el navegador lo pinta vacío — o peor, con el texto del marcador, que en
 * el caso de la oportunidad dice "Se creará nueva oportunidad al guardar"
 * cuando en realidad SÍ hay una vinculada. El dato está bien en disco pero la
 * pantalla miente, que es exactamente lo que el punto 5 pide evitar.
 *
 * Esta función construye la etiqueta de una opción de respaldo para que la
 * referencia siga siendo visible y evidente.
 */
export const missingReferenceLabel = (
  kind: "empresa" | "contacto" | "oportunidad",
  id: string
): string =>
  `⚠ ${kind[0].toUpperCase()}${kind.slice(1)} guardada no disponible (${id.slice(
    0,
    12
  )}). No la pierdas: revísala antes de guardar.`;
