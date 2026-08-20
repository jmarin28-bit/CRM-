/**
 * Pruebas del motor del Embudo de Ventas.
 *
 *   npm run test:pipeline
 *
 * Cubre activityStatus.ts y opportunityContext.ts. Ninguno de los dos toca
 * localStorage ni React, así que se ejecutan tal cual en Node.
 *
 * Todas las pruebas fijan `now` a una fecha concreta. Depender de la fecha del
 * sistema haría que la suite empiece a fallar sola con el paso del tiempo, y
 * una prueba que falla sin que nadie haya cambiado nada se termina ignorando.
 */
import {
  isActivityDone,
  followUpState,
  calendarDaysBetween,
} from "./activityStatus.ts";
import {
  buildOpportunityContext,
  buildOpportunityContextMap,
  activitiesForOpportunity,
  resolveOpportunityQuote,
  nextActionOf,
  quoteStatusLabel,
  toCOPValue,
  isOpenOpportunity,
  contactLabel,
  accountLabel,
  DEFAULT_THRESHOLDS,
} from "./opportunityContext.ts";
import type {
  AccountV2,
  ActivityV2,
  ContactV2,
  OpportunityStage,
  OpportunityV2,
  QuoteV2,
} from "../types.ts";

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

// "Hoy" para toda la suite: jueves 20 de agosto de 2026, 10:00 hora local.
const HOY = new Date(2026, 7, 20, 10, 0, 0);

/** Fecha ISO desplazada N días respecto de HOY (negativo = pasado). */
const dias = (n: number, hora = 9): string => {
  const d = new Date(HOY);
  d.setDate(d.getDate() + n);
  d.setHours(hora, 0, 0, 0);
  return d.toISOString();
};

const cuenta = (id: string, nombre: string): AccountV2 => ({
  id, ownerId: "u1", razonSocial: nombre.toUpperCase() + " SAS", nombreComercial: nombre,
  nit: "900-" + id, sector: "", clasificacion: "", ciudad: "Medellín", direccion: "CL 1",
  createdAt: dias(-200),
});

const contacto = (id: string, accountId: string, nombre: string): ContactV2 => ({
  id, ownerId: "u1", accountId, fullName: nombre, role: "Compras",
  email: "a@b.com", phone: "300", whatsapp: "300", createdAt: dias(-200),
});

const oportunidad = (over: Partial<OpportunityV2> = {}): OpportunityV2 => ({
  id: "o-1", accountId: "a-1", contactId: "c-1", ownerId: "u1",
  titulo: "Suministro de reactivos", etapa: "Cotización" as OpportunityStage,
  valor: 1_785_000, moneda: "COP", probabilidad: 60,
  fechaEstimadaCierre: dias(20), createdAt: dias(-30), updatedAt: dias(-3),
  ...over,
});

const actividad = (over: Partial<ActivityV2> = {}): ActivityV2 => ({
  id: "act-" + Math.random().toString(16).slice(2), ownerId: "u1", accountId: "a-1",
  contactId: "c-1", type: "Llamada", description: "Se llamó al cliente",
  user: "Juan Sierra", createdAt: dias(-2),
  ...over,
});

const cotizacion = (over: Partial<QuoteV2> = {}): QuoteV2 => ({
  id: "q-1", quoteNumber: "IC-PD-0003", type: "producto", status: "enviada", version: 1,
  accountId: "a-1", contactId: "c-1", opportunityId: "o-1", currency: "COP",
  issueDate: dias(-5), validUntil: dias(25), subtotal: 1_500_000, tax: 285_000,
  total: 1_785_000, items: [], terms: {} as any, createdAt: dias(-5), updatedAt: dias(-5),
  ...over,
});

const DATOS = {
  accounts: [cuenta("a-1", "Servicio Geológico Colombiano"), cuenta("a-2", "IONCORE")],
  contacts: [contacto("c-1", "a-1", "Johan Arévalo"), contacto("c-2", "a-1", "Otra Persona")],
  quotes: [cotizacion()],
  activities: [] as ActivityV2[],
  users: [{ id: "u1", name: "Juan Sierra" }],
  trm: 4000,
  now: HOY,
};

// ---------------------------------------------------------------------------
console.log("\n=== 1. activityStatus: cerrada o pendiente ===");
// ---------------------------------------------------------------------------
check("sin actividad no está cerrada", isActivityDone(undefined), false);
check("sin estado no está cerrada", isActivityDone({}), false);
check("completada cuenta como cerrada", isActivityDone({ status: "completada" }), true);
check("realizado cuenta como cerrada", isActivityDone({ status: "realizado" }), true);
check("cancelado cuenta como cerrada", isActivityDone({ status: "cancelado" }), true);
check("mayúsculas y espacios no confunden", isActivityDone({ status: " Completada " }), true);
check("pendiente NO está cerrada", isActivityDone({ status: "pendiente" }), false);
// "sent" es el estado de un correo enviado: la gestión ocurrió, pero el
// seguimiento que la acompaña sigue exigiendo respuesta. No es cierre.
check("sent NO está cerrada", isActivityDone({ status: "sent" }), false);

// ---------------------------------------------------------------------------
console.log("\n=== 2. activityStatus: vencido / hoy / próximo ===");
// ---------------------------------------------------------------------------
check("un seguimiento completado no aparece vencido",
  followUpState(dias(-5), "completada", HOY).state, "completado");
check("sin fecha", followUpState(null, "pendiente", HOY).state, "sin-fecha");
check("fecha basura se trata como sin fecha",
  followUpState("no es una fecha", "pendiente", HOY).state, "sin-fecha");
check("ayer está vencido", followUpState(dias(-1), "pendiente", HOY).state, "vencido");
check("etiqueta de ayer", followUpState(dias(-1), "pendiente", HOY).label, "Vencido ayer");
check("hace 3 días", followUpState(dias(-3), "pendiente", HOY).daysOverdue, 3);
check("mañana es próximo", followUpState(dias(1), "pendiente", HOY).label, "Mañana");
check("en 4 días", followUpState(dias(4), "pendiente", HOY).label, "En 4 días");

// Lo importante: agendado HOY a las 8:00 y ya son las 10:00 → sigue siendo
// "Hoy". Comparar por hora lo marcaría vencido a media mañana y el asesor
// vería alarmas rojas por seguimientos que todavía puede hacer.
check("hoy a las 8:00 con 'ahora' a las 10:00 sigue siendo Hoy",
  followUpState(dias(0, 8), "pendiente", HOY).state, "hoy");
check("hoy a las 8:00 no acumula retraso",
  followUpState(dias(0, 8), "pendiente", HOY).daysOverdue, 0);
check("días calendario, no de 24 horas",
  calendarDaysBetween(new Date(2026, 7, 19, 23, 30), new Date(2026, 7, 20, 0, 30)), 1);

// ---------------------------------------------------------------------------
console.log("\n=== 3. Vínculo oportunidad ↔ cotización ===");
// ---------------------------------------------------------------------------
{
  const porOpportunityId = resolveOpportunityQuote({ id: "o-1" }, [cotizacion()]);
  check("encuentra la cotización que apunta a la oportunidad", porOpportunityId?.id, "q-1");

  const porQuoteId = resolveOpportunityQuote(
    { id: "o-9", quoteId: "q-7" },
    [cotizacion(), cotizacion({ id: "q-7", quoteNumber: "IC-PD-0007", opportunityId: "" })]
  );
  check("encuentra la cotización por quoteId aunque no haya vuelta", porQuoteId?.id, "q-7");

  // El asesor eligió a mano con quoteId; el asistente dejó el otro lado. Gana
  // el humano: si no, corregir la cotización desde la oportunidad no serviría.
  const conflicto = resolveOpportunityQuote(
    { id: "o-1", quoteId: "q-7" },
    [cotizacion(), cotizacion({ id: "q-7", opportunityId: "" })]
  );
  check("ante conflicto manda el quoteId elegido a mano", conflicto?.id, "q-7");

  check("sin cotización devuelve undefined",
    resolveOpportunityQuote({ id: "o-404" }, [cotizacion()]), undefined);
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. Qué actividades pertenecen a la oportunidad ===");
// ---------------------------------------------------------------------------
{
  const lista: ActivityV2[] = [
    actividad({ id: "propia", opportunityId: "o-1" }),
    actividad({ id: "otra-opp", opportunityId: "o-2" }),
    actividad({ id: "misma-cuenta-mismo-contacto" }),
    actividad({ id: "misma-cuenta-sin-contacto", contactId: undefined }),
    actividad({ id: "misma-cuenta-otro-contacto", contactId: "c-2" }),
    actividad({ id: "otra-cuenta", accountId: "a-2" }),
  ];
  const ids = activitiesForOpportunity({ id: "o-1", accountId: "a-1", contactId: "c-1" }, lista)
    .map((a) => a.id).sort();

  check("incluye lo atado explícitamente y lo de la misma cuenta/contacto", ids,
    ["misma-cuenta-mismo-contacto", "misma-cuenta-sin-contacto", "propia"].sort());
  checkTrue("excluye la actividad de otra oportunidad", !ids.includes("otra-opp"));
  checkTrue("excluye la actividad de otro contacto", !ids.includes("misma-cuenta-otro-contacto"));
  checkTrue("excluye la actividad de otra empresa", !ids.includes("otra-cuenta"));

  // Sin contacto en la oportunidad no hay con qué discriminar: se muestra todo
  // lo de la empresa, que es más útil que un panel vacío.
  const sinContacto = activitiesForOpportunity({ id: "o-1", accountId: "a-1", contactId: "" }, lista)
    .map((a) => a.id);
  checkTrue("sin contacto en la oportunidad, entra también el otro contacto",
    sinContacto.includes("misma-cuenta-otro-contacto"));
}

{
  // El orden es por cuándo pasó (createdAt), no por la cita agendada.
  const lista = [
    actividad({ id: "vieja", createdAt: dias(-10) }),
    actividad({ id: "reciente", createdAt: dias(-1) }),
    actividad({ id: "agendada-lejos", createdAt: dias(-5), followUpAt: dias(30) }),
  ];
  const orden = activitiesForOpportunity({ id: "o-1", accountId: "a-1", contactId: "c-1" }, lista)
    .map((a) => a.id);
  check("ordenadas de más reciente a más antigua", orden, ["reciente", "agendada-lejos", "vieja"]);
  checkTrue("un seguimiento futuro no se cuela como lo más reciente", orden[0] === "reciente");
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. Próxima acción ===");
// ---------------------------------------------------------------------------
{
  check("sin seguimientos no hay próxima acción", nextActionOf([], HOY), undefined);

  check("un seguimiento ya completado no cuenta",
    nextActionOf([actividad({ followUpAt: dias(2), status: "completada" })], HOY), undefined);

  // Lo urgente es lo vencido, aunque haya algo más cerca en el calendario.
  const varias = [
    actividad({ id: "manana", followUpAt: dias(1), status: "pendiente" }),
    actividad({ id: "vencido", followUpAt: dias(-3), status: "pendiente" }),
    actividad({ id: "lejano", followUpAt: dias(10), status: "pendiente" }),
  ];
  const na = nextActionOf(varias, HOY);
  check("elige el vencido antes que el de mañana", na?.activityId, "vencido");
  check("y lo reporta como vencido", na?.state, "vencido");
  check("con los días de retraso", na?.daysOverdue, 3);

  const soloFuturo = nextActionOf([
    actividad({ id: "lejano", followUpAt: dias(10), status: "pendiente" }),
    actividad({ id: "manana", followUpAt: dias(1), status: "pendiente" }),
  ], HOY);
  check("sin vencidos, elige el más cercano", soloFuturo?.activityId, "manana");
  check("etiqueta legible", soloFuturo?.label, "Mañana");
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. Contexto completo: caso sano ===");
// ---------------------------------------------------------------------------
{
  const ctx = buildOpportunityContext(oportunidad(), {
    ...DATOS,
    activities: [
      actividad({ id: "llamada", createdAt: dias(-2) }),
      actividad({ id: "seguimiento", createdAt: dias(-2), followUpAt: dias(1), status: "pendiente" }),
    ],
  });

  check("empresa resuelta", ctx.accountName, "Servicio Geológico Colombiano");
  check("contacto resuelto", ctx.contactName, "Johan Arévalo");
  check("asesor resuelto", ctx.ownerName, "Juan Sierra");
  check("cotización vinculada", ctx.quote?.quoteNumber, "IC-PD-0003");
  check("estado de la cotización en texto", ctx.quoteStatusText, "Enviada");
  check("valor en COP", ctx.valorCOP, 1_785_000);
  check("valor ponderado = valor × probabilidad", ctx.valorPonderadoCOP, 1_785_000 * 0.6);
  check("días al cierre", ctx.daysToClose, 20);
  check("días desde la última actividad", ctx.daysSinceLastActivity, 2);
  check("días desde que se envió la cotización", ctx.daysSinceQuoteSent, undefined);
  checkTrue("hay actividad reciente", ctx.hasRecentActivity);
  checkTrue("hay seguimiento pendiente", ctx.hasPendingFollowUp);
  check("la próxima acción es el seguimiento de mañana", ctx.nextAction?.activityId, "seguimiento");
  checkTrue("está abierta", ctx.isOpen);
  checkTrue("sin alertas graves", !ctx.hasRisk);
  check("no aparecen alertas de las que sí se pueden evitar",
    ctx.alerts.map((a) => a.code), []);
}

// ---------------------------------------------------------------------------
console.log("\n=== 7. Contexto completo: caso en riesgo ===");
// ---------------------------------------------------------------------------
{
  const ctx = buildOpportunityContext(
    oportunidad({
      contactId: "",
      fechaEstimadaCierre: dias(-4),
      updatedAt: dias(-40),
    }),
    {
      ...DATOS,
      contacts: [], // el contacto ya no existe
      quotes: [cotizacion({ status: "enviada", sentAt: dias(-12) })],
      activities: [actividad({ id: "vieja", createdAt: dias(-25), contactId: undefined })],
    }
  );

  const codigos = ctx.alerts.map((a) => a.code).sort();
  checkTrue("avisa que no hay contacto", codigos.includes("sin-contacto"));
  checkTrue("avisa que el cierre ya pasó", codigos.includes("cierre-vencido"));
  checkTrue("avisa que no hay actividad reciente", codigos.includes("sin-actividad"));
  checkTrue("avisa que no hay próxima acción", codigos.includes("sin-proxima-accion"));
  checkTrue("avisa que la cotización lleva días sin respuesta",
    codigos.includes("cotizacion-sin-respuesta"));
  checkTrue("marca riesgo", ctx.hasRisk);
  check("el aviso de cierre dice cuántos días",
    ctx.alerts.find((a) => a.code === "cierre-vencido")?.label,
    "La fecha estimada de cierre pasó hace 4 días.");
  checkTrue("no hay actividad reciente", !ctx.hasRecentActivity);
  check("contacto vacío en vez de inventado", ctx.contactName, "");
}

// ---------------------------------------------------------------------------
console.log("\n=== 7bis. El silencio de la cotización mira la bitácora ===");
// ---------------------------------------------------------------------------
// Este caso salió de una prueba de render, no de una idea previa: una
// oportunidad sana mostraba el triángulo rojo. La cotización llevaba 11 días
// enviada, pero el asesor había registrado una llamada 2 días atrás. Decirle
// "no hay respuesta registrada" era falso y, peor, le echaba en cara un trabajo
// que sí hizo.
{
  const base = {
    ...DATOS,
    quotes: [cotizacion({ status: "enviada", sentAt: dias(-11) })],
  };

  const conGestionPosterior = buildOpportunityContext(oportunidad({}), {
    ...base,
    activities: [actividad({ id: "post", createdAt: dias(-2) })],
  });
  const codigosCon = conGestionPosterior.alerts.map((a) => a.code);
  checkTrue(
    "con una gestión posterior al envío, NO avisa silencio",
    !codigosCon.includes("cotizacion-sin-respuesta"),
  );

  const sinGestionPosterior = buildOpportunityContext(oportunidad({}), {
    ...base,
    // La única gestión es anterior al envío de la cotización.
    activities: [actividad({ id: "previa", createdAt: dias(-20) })],
  });
  checkTrue(
    "si la única gestión es anterior al envío, sí avisa",
    sinGestionPosterior.alerts.some((a) => a.code === "cotizacion-sin-respuesta"),
  );

  const sinGestionAlguna = buildOpportunityContext(oportunidad({ updatedAt: dias(-30) }), {
    ...base,
    activities: [],
  });
  checkTrue(
    "sin ninguna gestión, también avisa",
    sinGestionAlguna.alerts.some((a) => a.code === "cotizacion-sin-respuesta"),
  );

  // El mismo día no cuenta como "después": si la gestión y el envío caen en la
  // misma fecha, no hay forma de saber cuál ocurrió primero, y el aviso de
  // silencio solo aparece a los 7 días, así que el empate es irrelevante.
  const mismoDia = buildOpportunityContext(oportunidad({}), {
    ...base,
    activities: [actividad({ id: "mismo", createdAt: dias(-11) })],
  });
  checkTrue(
    "una gestión del mismo día del envío no silencia el aviso",
    mismoDia.alerts.some((a) => a.code === "cotizacion-sin-respuesta"),
  );
}

// ---------------------------------------------------------------------------
console.log("\n=== 8. Lo cerrado deja de exigir ===");
// ---------------------------------------------------------------------------
{
  // Una oportunidad ganada hace meses no debe pintarse de rojo por no tener
  // seguimiento: ya no hay nada que hacer con ella.
  const ganada = buildOpportunityContext(
    oportunidad({ etapa: "Ganado", fechaEstimadaCierre: dias(-90), updatedAt: dias(-90) }),
    { ...DATOS, activities: [] }
  );
  check("una oportunidad ganada no genera alertas", ganada.alerts, []);
  checkTrue("y no se marca en riesgo", !ganada.hasRisk);
  checkTrue("y no cuenta como abierta", !ganada.isOpen);

  const perdida = buildOpportunityContext(oportunidad({ etapa: "Perdido" }), { ...DATOS });
  check("una oportunidad perdida tampoco", perdida.alerts, []);
}

// ---------------------------------------------------------------------------
console.log("\n=== 9. Casos borde de datos reales ===");
// ---------------------------------------------------------------------------
{
  // Oportunidad sin empresa cuya cotización sí sabe de quién es.
  const ctx = buildOpportunityContext(
    oportunidad({ accountId: "", contactId: "" }),
    { ...DATOS, activities: [] }
  );
  check("la cotización rescata la empresa", ctx.accountName, "Servicio Geológico Colombiano");
  check("y el contacto", ctx.contactName, "Johan Arévalo");
}

{
  // Una empresa que no existe no debe romper el panel ni inventar un nombre.
  const ctx = buildOpportunityContext(
    oportunidad({ accountId: "a-404", contactId: "c-404", ownerId: "u-404" }),
    { ...DATOS, quotes: [], activities: [] }
  );
  check("empresa desconocida queda vacía, no 'Empresa no encontrada'", ctx.accountName, "");
  check("asesor desconocido se declara sin asignar", ctx.ownerName, "Sin asignar");
  check("sin cotización el texto de estado queda vacío", ctx.quoteStatusText, "");
  check("sin actividades, no se sabe hace cuánto", ctx.daysSinceLastActivity, undefined);
}

{
  // Contacto guardado con el campo legado `name`.
  const legado = { ...contacto("c-9", "a-1", ""), fullName: "", name: "Nombre Viejo" } as ContactV2;
  check("se lee el nombre legado", contactLabel(legado), "Nombre Viejo");
  check("empresa sin nombre comercial cae en la razón social",
    accountLabel({ ...cuenta("a-9", ""), nombreComercial: "" } as AccountV2), " SAS");
}

{
  // USD: el embudo suma en pesos, así que el valor tiene que convertirse.
  const ctx = buildOpportunityContext(
    oportunidad({ valor: 1000, moneda: "USD", probabilidad: 50 }),
    { ...DATOS, activities: [] }
  );
  check("1.000 USD a TRM 4.000 son 4.000.000 COP", ctx.valorCOP, 4_000_000);
  check("y el ponderado usa el valor ya convertido", ctx.valorPonderadoCOP, 2_000_000);
  check("toCOPValue deja los pesos como están", toCOPValue(500, "COP", 4000), 500);
  check("y protege contra un valor corrupto", toCOPValue(NaN as number, "COP", 4000), 0);
}

{
  // Probabilidad ausente: el ponderado debe ser cero, no NaN. Un NaN suelto
  // envenena el total del embudo entero.
  const ctx = buildOpportunityContext(
    oportunidad({ probabilidad: undefined as unknown as number }),
    { ...DATOS, activities: [] }
  );
  check("sin probabilidad el ponderado es cero", ctx.valorPonderadoCOP, 0);
}

// ---------------------------------------------------------------------------
console.log("\n=== 10. Umbrales y utilidades ===");
// ---------------------------------------------------------------------------
{
  // La vista pasa los umbrales de BUSINESS_RULES; el motor debe respetarlos.
  const base = { ...DATOS, activities: [actividad({ createdAt: dias(-10) })] };
  const conDefecto = buildOpportunityContext(oportunidad(), base);
  checkTrue("con umbral 14 días, 10 días sin actividad no alarma",
    !conDefecto.alerts.some((a) => a.code === "sin-actividad"));

  const estricto = buildOpportunityContext(oportunidad(), {
    ...base, thresholds: { stalledDays: 7 },
  });
  checkTrue("bajando el umbral a 7, sí alarma",
    estricto.alerts.some((a) => a.code === "sin-actividad"));
  check("el umbral por defecto sigue siendo 14", DEFAULT_THRESHOLDS.stalledDays, 14);
}

check("etiqueta de estado con guiones bajos", quoteStatusLabel("pendiente_costo_proveedor"),
  "Pendiente por costo del proveedor");
check("estado desconocido se muestra tal cual", quoteStatusLabel("inventado"), "inventado");
check("Ganado no es etapa abierta", isOpenOpportunity("Ganado"), false);
check("Cotización sí es etapa abierta", isOpenOpportunity("Cotización"), true);

{
  const mapa = buildOpportunityContextMap(
    [oportunidad({ id: "o-1" }), oportunidad({ id: "o-2", titulo: "Otra" })],
    { ...DATOS, activities: [] }
  );
  check("el mapa trae una entrada por oportunidad", mapa.size, 2);
  check("y se consulta por id", mapa.get("o-2")?.opportunity.titulo, "Otra");
}

// ---------------------------------------------------------------------------
console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail === 0 ? 0 : 1);
