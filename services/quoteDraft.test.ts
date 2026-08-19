/**
 * Prueba de IDA Y VUELTA de una cotización (punto 5 del reporte).
 *
 *   npm run test:draft
 *
 * Simula el ciclo completo sin React ni navegador:
 *
 *   borrador en pantalla → buildQuotePayload → guardar (JSON, como
 *   localStorage) → volver a leer → comparar campo por campo.
 *
 * El almacenamiento real serializa a JSON, así que la prueba pasa por
 * JSON.parse(JSON.stringify(...)) a propósito: ahí es donde se pierden los
 * `undefined`, se convierten las fechas y aparecen los strings que parecían
 * números mientras vivían en memoria.
 */
import {
  buildQuotePayload,
  diffQuoteRoundTrip,
  normalizeQuoteItem,
  toNumber,
  missingReferenceLabel,
  PERSISTED_QUOTE_FIELDS,
} from "./quoteDraft.ts";
import type { QuoteItem, QuoteV2 } from "../types.ts";

let pass = 0;
let fail = 0;

const check = (nombre: string, real: unknown, esperado: unknown) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) {
    pass++;
    console.log(`  ✅ ${nombre}`);
  } else {
    fail++;
    console.log(`  ❌ ${nombre}`);
    console.log(`       esperado: ${JSON.stringify(esperado)}`);
    console.log(`       recibido: ${JSON.stringify(real)}`);
  }
};

const checkTrue = (nombre: string, real: boolean) => check(nombre, real, true);

/** Lo que hace el almacenamiento: serializar y volver a leer. */
const roundTrip = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const item = (over: Partial<QuoteItem> = {}): QuoteItem =>
  ({
    id: "it-1",
    itemType: "producto",
    code: "23",
    description: "columna",
    quantity: 3,
    unit: "unidad",
    currency: "COP",
    unitPrice: 456,
    total: 1368,
    taxRate: 19,
    ...over,
  }) as QuoteItem;

const TERMS = {
  validityText: "15 días",
  billingText: "Factura electrónica",
  paymentTermsText: "30 días",
  paymentMethodText: "Transferencia",
  deliveryPlaceText: "Medellín",
  deliveryTimeText: "5 días",
  warrantyText: "1 año",
  cancellationText: "Sin penalidad",
};

const NOTES = {
  publicNotes: "Nota pública",
  technicalObservations: "Observación técnica",
  internalNotes: "Nota interna",
};

const TOTALS = { subtotal: 1668, tax: 316.92, total: 1984.92 };

// --------------------------------------------------------------------------
console.log("\n1. Ida y vuelta completa");
// --------------------------------------------------------------------------

{
  const draft: Partial<QuoteV2> = {
    id: "qt-1",
    type: "producto",
    status: "borrador",
    accountId: "a-prueba",
    contactId: "c-juan",
    opportunityId: "op-1",
    currency: "COP",
    issueDate: "2026-08-19",
    validUntil: "2026-09-03",
    items: [item(), item({ id: "it-2", code: "34", description: "filtro", quantity: 1, unitPrice: 300, total: 300 })],
    terms: TERMS as any,
    notes: NOTES as any,
    deliveryAddress: "CL 1 # 2-3",
    deliveryCity: "Medellín",
  };

  const guardado = buildQuotePayload({
    draft,
    quoteId: "qt-1",
    opportunityId: "op-1",
    totals: TOTALS,
    today: "2026-08-19",
  });

  const reabierto = roundTrip(guardado);
  const diferencias = diffQuoteRoundTrip(guardado as any, reabierto as any);

  check("ningún campo cambia al reabrir", diferencias, []);
  check("empresa se conserva", reabierto.accountId, "a-prueba");
  check("contacto se conserva", reabierto.contactId, "c-juan");
  check("oportunidad se conserva", reabierto.opportunityId, "op-1");
  check("moneda se conserva", reabierto.currency, "COP");
  check("ítems se conservan", reabierto.items.length, 2);
  check("términos se conservan", reabierto.terms, TERMS);
  check("notas se conservan", reabierto.notes, NOTES);
  check("totales se conservan", reabierto.total, TOTALS.total);
  check("dirección de entrega se conserva", reabierto.deliveryAddress, "CL 1 # 2-3");
}

// --------------------------------------------------------------------------
console.log("\n2. El diff detecta pérdidas de verdad");
// --------------------------------------------------------------------------

{
  // Si el diff no detectara nada, la prueba anterior no valdría nada. Aquí se
  // rompe a propósito para comprobar que sí grita.
  const a = { accountId: "a-1", contactId: "c-1", currency: "COP" } as any;
  const b = { accountId: "a-1", contactId: undefined, currency: "USD" } as any;

  const d = diffQuoteRoundTrip(a, b);
  check("detecta dos diferencias", d.length, 2);
  checkTrue("nombra el contacto perdido", d.some((x) => x.startsWith("contactId")));
  checkTrue("nombra la moneda cambiada", d.some((x) => x.startsWith("currency")));
  checkTrue("no inventa diferencias", !d.some((x) => x.startsWith("accountId")));
}

// --------------------------------------------------------------------------
console.log("\n3. Números que llegan como texto desde los inputs");
// --------------------------------------------------------------------------

{
  check("entero", toNumber("3"), 3);
  check("miles con punto", toNumber("1.250.000"), 1250000);
  check("miles con coma", toNumber("1,250,000"), 1250000);
  check("decimal con coma", toNumber("12,5"), 12.5);
  check("ya numérico", toNumber(456), 456);
  check("vacío", toNumber(""), 0);
  check("basura", toNumber("abc"), 0);
  check("nulo", toNumber(null), 0);

  // El caso que ensucia el almacenamiento: la tabla escribe strings.
  const sucio = item({ quantity: "3" as any, unitPrice: "456" as any, total: 0 });
  const limpio = normalizeQuoteItem(sucio, "COP");
  check("cantidad se guarda como número", limpio.quantity, 3);
  check("precio se guarda como número", limpio.unitPrice, 456);
  check("total se recalcula", limpio.total, 1368);
}

// --------------------------------------------------------------------------
console.log("\n4. La moneda del ítem sigue a la de la cotización");
// --------------------------------------------------------------------------

{
  // El asesor genera en COP y después cambia el desplegable a USD: los ítems
  // no pueden quedarse con COP escrito en disco.
  const draft: Partial<QuoteV2> = {
    accountId: "a-1",
    currency: "USD",
    items: [item({ currency: "COP" }), item({ id: "it-2", currency: "COP" })],
    terms: TERMS as any,
    notes: NOTES as any,
  };

  const guardado = buildQuotePayload({
    draft,
    quoteId: "qt-2",
    opportunityId: "",
    totals: TOTALS,
    today: "2026-08-19",
  });

  check(
    "todos los ítems quedan en la moneda de la cotización",
    guardado.items.map((i) => i.currency),
    ["USD", "USD"]
  );
  check("sin oportunidad se guarda undefined", guardado.opportunityId, undefined);
}

// --------------------------------------------------------------------------
console.log("\n5. Valores por defecto al guardar un borrador incompleto");
// --------------------------------------------------------------------------

{
  const guardado = buildQuotePayload({
    draft: { accountId: "a-1", items: [] },
    quoteId: "qt-3",
    opportunityId: "",
    totals: { subtotal: 0, tax: 0, total: 0 },
    today: "2026-08-19",
  });

  check("tipo por defecto", guardado.type, "producto");
  check("estado por defecto", guardado.status, "borrador");
  check("moneda por defecto", guardado.currency, "COP");
  check("fecha de emisión por defecto", guardado.issueDate, "2026-08-19");
  check("validez por defecto", guardado.validUntil, "2026-08-19");
  check("contacto vacío no se guarda como cadena vacía", guardado.contactId, undefined);
}

// --------------------------------------------------------------------------
console.log("\n6. Crear y actualizar producen lo mismo");
// --------------------------------------------------------------------------

{
  // La rama de actualizar fusiona el payload sobre el borrador previo. Si el
  // payload no cubriera un campo editable, el valor viejo sobreviviría y la
  // edición se perdería sin aviso.
  const previo: Partial<QuoteV2> = {
    id: "qt-4",
    accountId: "a-vieja",
    contactId: "c-vieja",
    currency: "COP",
    deliveryCity: "Bogotá",
    items: [item()],
    terms: TERMS as any,
    notes: NOTES as any,
  };

  const editado: Partial<QuoteV2> = {
    ...previo,
    accountId: "a-nueva",
    contactId: "c-nueva",
    currency: "USD",
    deliveryCity: "Medellín",
  };

  const payload = buildQuotePayload({
    draft: editado,
    quoteId: "qt-4",
    opportunityId: "op-9",
    totals: TOTALS,
    today: "2026-08-19",
  });

  const actualizado = { ...previo, ...payload } as any;

  check("la empresa editada gana", actualizado.accountId, "a-nueva");
  check("el contacto editado gana", actualizado.contactId, "c-nueva");
  check("la moneda editada gana", actualizado.currency, "USD");
  check("la ciudad editada gana", actualizado.deliveryCity, "Medellín");
  check("la oportunidad nueva gana", actualizado.opportunityId, "op-9");

  // Y ningún campo editable queda fuera del payload.
  const cubiertos = Object.keys(payload);
  const faltantes = PERSISTED_QUOTE_FIELDS.filter((f) => !cubiertos.includes(f));
  check("el payload cubre todos los campos persistidos", faltantes, []);
}

// --------------------------------------------------------------------------
console.log("\n7. Referencias que ya no existen");
// --------------------------------------------------------------------------

{
  const etiqueta = missingReferenceLabel("oportunidad", "op-123456789012345");
  checkTrue("avisa con símbolo visible", etiqueta.startsWith("⚠"));
  checkTrue("nombra el tipo de referencia", etiqueta.includes("Oportunidad"));
  checkTrue("muestra parte del id", etiqueta.includes("op-123456789"));
}

// --------------------------------------------------------------------------

console.log(`\n${pass} pruebas OK, ${fail} fallidas\n`);
if (fail > 0) process.exit(1);
