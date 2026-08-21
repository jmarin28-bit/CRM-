// services/activityDraft.test.ts
//
// Ejecutar con:  npm run test:activity
//
// Lo que más se prueba acá es la conversión de fechas. Es la parte que a ojo
// "se ve bien" en el navegador y falla en producción: un desfase de zona
// horaria mueve el seguimiento unas horas y recién se nota cuando el asesor
// abre el CRM y ve en rojo algo que agendó bien.

import {
  ACTIVITY_TYPES,
  DEFAULT_FOLLOW_UP_HOUR,
  FOLLOW_UP_PRESETS,
  FOLLOW_UP_TYPE,
  parseLocalDatetime,
  presetDatetimeValue,
  toLocalDatetimeValue,
  validateActivityDraft,
  type ActivityDraft,
} from "./activityDraft.ts";

let ok = 0;
let fail = 0;

function check(nombre: string, condicion: boolean, detalle?: string) {
  if (condicion) {
    ok++;
    console.log(`  ✓ ${nombre}`);
  } else {
    fail++;
    console.error(`  ✗ ${nombre}${detalle ? ` → ${detalle}` : ""}`);
  }
}

function eq(nombre: string, actual: unknown, esperado: unknown) {
  check(nombre, actual === esperado, `esperaba ${JSON.stringify(esperado)}, obtuvo ${JSON.stringify(actual)}`);
}

// Reloj fijo: jueves 20 de agosto de 2026, 10:00 de la mañana.
const HOY = new Date(2026, 7, 20, 10, 0, 0, 0);

const borrador = (over: Partial<ActivityDraft> = {}): ActivityDraft => ({
  type: "Llamada",
  description: "Se llamó al cliente",
  followUpLocal: "",
  ...over,
});

console.log("\n=== 1. Formato de datetime-local ===");
{
  eq("una fecha se formatea con ceros a la izquierda",
    toLocalDatetimeValue(new Date(2026, 0, 5, 9, 7)), "2026-01-05T09:07");
  eq("medianoche no se pierde",
    toLocalDatetimeValue(new Date(2026, 11, 31, 0, 0)), "2026-12-31T00:00");
}

console.log("\n=== 2. Lectura de datetime-local ===");
{
  const d = parseLocalDatetime("2026-08-21T09:00");
  check("devuelve un Date", d instanceof Date);
  eq("el año se respeta", d?.getFullYear(), 2026);
  eq("el mes se respeta (agosto = 7)", d?.getMonth(), 7);
  eq("el día se respeta", d?.getDate(), 21);

  // El corazón del asunto: la hora leída es la hora LOCAL escrita por el
  // asesor, no una hora corrida por interpretar la cadena como UTC.
  eq("la hora es la que se escribió, no la de UTC", d?.getHours(), 9);
  eq("los minutos se respetan", d?.getMinutes(), 0);

  eq("una cadena vacía no es fecha", parseLocalDatetime(""), undefined);
  eq("undefined no es fecha", parseLocalDatetime(undefined), undefined);
  eq("un texto cualquiera no es fecha", parseLocalDatetime("mañana"), undefined);
  eq("una fecha sin hora no sirve para agendar", parseLocalDatetime("2026-08-21"), undefined);

  // new Date(2026, 1, 31) NO falla: se corre al 3 de marzo en silencio. Si no
  // se revisa, el asesor cree que agendó el 31 de febrero y el CRM guarda otra
  // fecha sin decir nada.
  eq("el 31 de febrero se rechaza en vez de correrse a marzo",
    parseLocalDatetime("2026-02-31T09:00"), undefined);
  eq("el mes 13 se rechaza", parseLocalDatetime("2026-13-01T09:00"), undefined);
  check("el 29 de febrero de un año bisiesto sí vale",
    parseLocalDatetime("2028-02-29T09:00") instanceof Date);
}

console.log("\n=== 3. Ida y vuelta ===");
{
  // Formatear y volver a leer tiene que dar exactamente el mismo instante.
  const original = new Date(2026, 7, 20, 16, 45, 0, 0);
  const vuelta = parseLocalDatetime(toLocalDatetimeValue(original));
  eq("formatear y leer devuelve el mismo instante", vuelta?.getTime(), original.getTime());
}

console.log("\n=== 4. Atajos de fecha ===");
{
  const manana = parseLocalDatetime(presetDatetimeValue("manana", HOY));
  eq("'Mañana' cae al día siguiente", manana?.getDate(), 21);
  eq("'Mañana' propone las 9:00", manana?.getHours(), DEFAULT_FOLLOW_UP_HOUR);

  const tres = parseLocalDatetime(presetDatetimeValue("tres-dias", HOY));
  eq("'En 3 días' cae al 23", tres?.getDate(), 23);

  const semana = parseLocalDatetime(presetDatetimeValue("proxima-semana", HOY));
  eq("'En una semana' cae al 27", semana?.getDate(), 27);

  // Fin de mes: el 30 de agosto + 3 días es el 2 de septiembre, no el 33 de agosto.
  const finDeMes = parseLocalDatetime(presetDatetimeValue("tres-dias", new Date(2026, 7, 30, 10, 0)));
  eq("cruzar el fin de mes cambia el mes", finDeMes?.getMonth(), 8);
  eq("cruzar el fin de mes da el día correcto", finDeMes?.getDate(), 2);

  check("hay tres atajos", FOLLOW_UP_PRESETS.length === 3);
}

console.log("\n=== 5. Validación: descripción ===");
{
  const r = validateActivityDraft(borrador({ description: "   " }), { requireFollowUp: false, now: HOY });
  eq("una gestión sin texto no se guarda", r.ok, false);
  check("el mensaje habla de la gestión", r.error.includes("gestión"), r.error);

  const s = validateActivityDraft(borrador({ description: "" }), { requireFollowUp: true, now: HOY });
  eq("un seguimiento sin texto no se guarda", s.ok, false);
  check("el mensaje habla del seguimiento", s.error.includes("seguimiento"), s.error);

  const t = validateActivityDraft(borrador({ description: "  hola  " }), { requireFollowUp: false, now: HOY });
  eq("el texto se guarda sin espacios sobrantes", t.description, "hola");
}

console.log("\n=== 6. Validación: gestión sin fecha ===");
{
  const r = validateActivityDraft(borrador(), { requireFollowUp: false, now: HOY });
  eq("una gestión sin fecha es válida", r.ok, true);
  eq("y no agenda nada", r.followUpAt, null);
  eq("conserva el tipo elegido", r.type, "Llamada");
  eq("no trae mensaje de error", r.error, "");

  const sinTipo = validateActivityDraft(borrador({ type: "" }), { requireFollowUp: false, now: HOY });
  eq("sin tipo se guarda como Nota en vez de vacío", sinTipo.type, "Nota");
}

console.log("\n=== 7. Validación: seguimiento ===");
{
  const sinFecha = validateActivityDraft(borrador(), { requireFollowUp: true, now: HOY });
  eq("un seguimiento sin fecha no se guarda", sinFecha.ok, false);
  check("y lo dice", sinFecha.error.includes("fecha"), sinFecha.error);

  const basura = validateActivityDraft(borrador({ followUpLocal: "el viernes" }), { requireFollowUp: true, now: HOY });
  eq("una fecha ilegible no se guarda", basura.ok, false);

  const bueno = validateActivityDraft(
    borrador({ type: FOLLOW_UP_TYPE, followUpLocal: "2026-08-21T09:00" }),
    { requireFollowUp: true, now: HOY }
  );
  eq("un seguimiento con fecha futura es válido", bueno.ok, true);
  eq("se guarda con el tipo que lee AXIS", bueno.type, "Seguimiento");

  // El ISO tiene que representar las 9:00 LOCALES. Se comprueba releyéndolo:
  // comparar la cadena contra un literal fijo haría que la prueba pasara o
  // fallara según la zona horaria de la máquina, que es justo lo que no
  // queremos comprobar.
  const releido = new Date(bueno.followUpAt as string);
  eq("el ISO guardado representa las 9:00 locales", releido.getHours(), 9);
  eq("y el día correcto", releido.getDate(), 21);
}

console.log("\n=== 8. Validación: fechas que ya pasaron ===");
{
  const ayer = validateActivityDraft(
    borrador({ followUpLocal: "2026-08-19T09:00" }),
    { requireFollowUp: true, now: HOY }
  );
  eq("agendar para ayer se rechaza", ayer.ok, false);
  check("y se explica por qué", ayer.error.includes("pasó"), ayer.error);

  // Un año mal tecleado es el error real que esta regla ataca.
  const anioViejo = validateActivityDraft(
    borrador({ followUpLocal: "2025-08-21T09:00" }),
    { requireFollowUp: true, now: HOY }
  );
  eq("un año mal tecleado se rechaza", anioViejo.ok, false);

  // Pero NO se bloquea lo de hoy más temprano: son las 10:00 y el asesor
  // registra algo que quedó pendiente a las 8:00. Es legítimo y frecuente.
  const hoyTemprano = validateActivityDraft(
    borrador({ followUpLocal: "2026-08-20T08:00" }),
    { requireFollowUp: true, now: HOY }
  );
  eq("hoy más temprano sí se permite", hoyTemprano.ok, true);

  const hoyMismo = validateActivityDraft(
    borrador({ followUpLocal: "2026-08-20T00:00" }),
    { requireFollowUp: true, now: HOY }
  );
  eq("la medianoche de hoy sí se permite", hoyMismo.ok, true);
}

console.log("\n=== 9. Coherencia con el resto del CRM ===");
{
  // Si alguien renombra el tipo, AXIS y el Dashboard dejan de ver los
  // seguimientos creados desde el embudo y nadie se entera hasta que un
  // seguimiento se pierde.
  eq("el tipo de seguimiento es el mismo que escribe AXIS", FOLLOW_UP_TYPE, "Seguimiento");
  check("los tipos ofrecidos incluyen Llamada", ACTIVITY_TYPES.includes("Llamada" as never));
  check("los tipos ofrecidos incluyen Correo", ACTIVITY_TYPES.includes("Correo" as never));
  check("los tipos ofrecidos incluyen Nota", ACTIVITY_TYPES.includes("Nota" as never));
}

console.log(`\n${"=".repeat(46)}`);
console.log(`${ok} comprobaciones OK, ${fail} fallidas`);
console.log("=".repeat(46));
if (fail > 0) process.exit(1);
