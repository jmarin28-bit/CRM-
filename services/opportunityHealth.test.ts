/**
 * Pruebas de la salud comercial.
 *
 * Se prueban los bordes, no el centro: un puntaje que acierta en el caso obvio y
 * falla en el día 14 exacto es peor que no tener puntaje, porque nadie lo va a
 * revisar. También se prueba lo que el número NO debe decir (Etapa 14), que es
 * la clase de cosa que se rompe sola cuando alguien "mejora" un texto.
 *
 * Correr con: npm run test:health
 */

import {
  computeHealth,
  healthSentence,
  bandOf,
  HEALTHY_SCORE,
  ATTENTION_SCORE,
  CARD_SCORE_THRESHOLD,
  type HealthInput,
} from "./opportunityHealth.ts";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) {
    pass++;
    console.log(`  OK   ${name}`);
  } else {
    fail++;
    console.log(`  FALLA ${name}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
  }
};

/** Una oportunidad impecable: base contra la cual medir cada penalización. */
const sana = (over: Partial<HealthInput> = {}): HealthInput => ({
  etapa: "Negociación",
  isOpen: true,
  daysSinceLastActivity: 1,
  nextActionState: "proximo",
  nextActionDaysOverdue: 0,
  daysToClose: 20,
  hasQuote: true,
  quoteStatus: "enviada",
  ...over,
});

const codes = (input: HealthInput) => computeHealth(input).factors.map((f) => f.code);

console.log("\n=== 1. El caso sano ===");
{
  const h = computeHealth(sana());
  check("una oportunidad bien atendida saca 100", h.score === 100, h.score);
  check("y no lista ningún problema", h.factors.length === 0, h.factors);
  check("queda en la banda sana", h.band === "sana", h.band);
  check("se puntúa", h.isScored === true);
}

console.log("\n=== 2. Días sin gestión ===");
{
  check("a los 7 días todavía no penaliza", computeHealth(sana({ daysSinceLastActivity: 7 })).score === 100);
  // El día 8 es el primero que duele: es el borde de recentActivityDays.
  check("al día 8 empieza a restar", computeHealth(sana({ daysSinceLastActivity: 8 })).score === 90, computeHealth(sana({ daysSinceLastActivity: 8 })).score);
  check("a los 14 sigue siendo tibia", codes(sana({ daysSinceLastActivity: 14 })).includes("gestion-tibia"));
  // 15 es el primer día pasado stalledDays: acá el problema cambia de categoría.
  check("a los 15 pasa a estancada", codes(sana({ daysSinceLastActivity: 15 })).includes("gestion-estancada"));
  check("a los 30 pasa a abandonada", codes(sana({ daysSinceLastActivity: 30 })).includes("gestion-abandonada"));
  check(
    "no tener ninguna gestión es peor que tener una vieja de 8 días",
    computeHealth(sana({ daysSinceLastActivity: undefined })).score <
      computeHealth(sana({ daysSinceLastActivity: 8 })).score
  );
  // Esta es la que destapó una inversión real: con -25, no haber hecho NUNCA
  // nada puntuaba mejor que haber llamado hace 40 días. Se dejan las dos
  // comparaciones para que no vuelva a colarse.
  check(
    "no tener ninguna gestión no puntúa mejor que una abandonada hace 40 días",
    computeHealth(sana({ daysSinceLastActivity: undefined })).score <=
      computeHealth(sana({ daysSinceLastActivity: 40 })).score
  );
  const unDia = computeHealth(sana({ daysSinceLastActivity: 8 })).factors[0].label;
  check("el texto usa plural correcto", unDia === "Sin gestión hace 8 días", unDia);
}

console.log("\n=== 3. Seguimiento ===");
{
  check("sin próximo paso resta 15", computeHealth(sana({ nextActionState: undefined })).score === 85);
  check(
    "un seguimiento vencido pesa más que no haber agendado",
    computeHealth(sana({ nextActionState: "vencido", nextActionDaysOverdue: 2 })).score <
      computeHealth(sana({ nextActionState: undefined })).score
  );
  check(
    "vencido hace mucho pesa más que vencido ayer",
    computeHealth(sana({ nextActionState: "vencido", nextActionDaysOverdue: 20 })).score <
      computeHealth(sana({ nextActionState: "vencido", nextActionDaysOverdue: 1 })).score
  );
  check("un seguimiento para hoy no penaliza", computeHealth(sana({ nextActionState: "hoy" })).score === 100);
  const uno = computeHealth(sana({ nextActionState: "vencido", nextActionDaysOverdue: 1 })).factors[0].label;
  check("el singular está bien escrito", uno === "El seguimiento venció hace 1 día", uno);
}

console.log("\n=== 4. Fecha de cierre ===");
{
  check("cerrar hoy no penaliza", computeHealth(sana({ daysToClose: 0 })).score === 100);
  check("un cierre vencido resta", codes(sana({ daysToClose: -1 })).includes("cierre-vencido"));
  check("vencido hace más de un mes resta más", codes(sana({ daysToClose: -40 })).includes("cierre-vencido-viejo"));
  const l = computeHealth(sana({ daysToClose: -3 })).factors[0].label;
  check("el texto dice hace cuánto venció", l === "La fecha de cierre venció hace 3 días", l);
}

console.log("\n=== 5. Cotización vs. etapa ===");
{
  // Lo normal en etapas tempranas es no tener nada cotizado todavía.
  check("Prospecto sin cotización no penaliza", computeHealth(sana({ etapa: "Prospecto", hasQuote: false, quoteStatus: undefined })).score === 100);
  check("Contactado sin cotización tampoco", computeHealth(sana({ etapa: "Contactado", hasQuote: false, quoteStatus: undefined })).score === 100);
  check(
    "Negociación sin cotización sí penaliza",
    codes(sana({ etapa: "Negociación", hasQuote: false, quoteStatus: undefined })).includes("etapa-sin-cotizacion")
  );
  check(
    "Cotización sin cotización también",
    codes(sana({ etapa: "Cotización", hasQuote: false, quoteStatus: undefined })).includes("etapa-sin-cotizacion")
  );
  check("una cotización rechazada resta", codes(sana({ quoteStatus: "rechazada" })).includes("cotizacion-caida"));
  check("una vencida resta", codes(sana({ quoteStatus: "vencida" })).includes("cotizacion-caida"));
  check("una con OC no resta", computeHealth(sana({ quoteStatus: "con_oc" })).score === 100);
  check("una enviada no resta", computeHealth(sana({ quoteStatus: "enviada" })).score === 100);
}

console.log("\n=== 6. El puntaje no se sale de 0-100 ===");
{
  const peor = computeHealth({
    etapa: "Negociación",
    isOpen: true,
    daysSinceLastActivity: undefined,
    nextActionState: "vencido",
    nextActionDaysOverdue: 90,
    daysToClose: -120,
    hasQuote: false,
  });
  // Las penalizaciones suman más de 100 a propósito; el clamp es lo que se prueba.
  check("el peor caso posible no baja de 0", peor.score === 0, peor.score);
  check("y no devuelve un negativo disfrazado", peor.score >= 0);
  check("el peor caso enumera sus cuatro problemas", peor.factors.length === 4, peor.factors.map((f) => f.code));
  check("nunca pasa de 100", computeHealth(sana()).score <= 100);
}

console.log("\n=== 7. Orden y explicabilidad de los factores ===");
{
  const h = computeHealth(sana({ daysSinceLastActivity: 45, nextActionState: undefined }));
  check("lo que más resta va primero", h.factors[0].points <= h.factors[1].points, h.factors.map((f) => f.points));
  check("todo factor trae texto para el asesor", h.factors.every((f) => f.label.length > 0));
  check("todo factor resta, ninguno suma", h.factors.every((f) => f.points < 0));
  check("todo factor trae un código estable", h.factors.every((f) => /^[a-z-]+$/.test(f.code)));
  // La suma tiene que reconstruir el puntaje, o la explicación de la Etapa 6
  // mostraría números que no cuadran con el total.
  const suma = 100 + h.factors.reduce((s, f) => s + f.points, 0);
  check("la suma de los factores explica el puntaje", suma === h.score, { suma, score: h.score });
}

console.log("\n=== 8. Oportunidades cerradas ===");
{
  const ganado = computeHealth(sana({ etapa: "Ganado", isOpen: false, daysSinceLastActivity: 200 }));
  check("un negocio ganado no se puntúa", ganado.isScored === false);
  check("y no inventa problemas", ganado.factors.length === 0);
  check("queda en banda cerrada", ganado.band === "cerrada", ganado.band);
  const perdido = computeHealth(sana({ etapa: "Perdido", isOpen: false }));
  check("un negocio perdido tampoco se puntúa", perdido.isScored === false);
}

console.log("\n=== 9. Bandas ===");
{
  check("70 ya es sana", bandOf(HEALTHY_SCORE) === "sana");
  check("69 requiere atención", bandOf(HEALTHY_SCORE - 1) === "atencion");
  check("40 requiere atención", bandOf(ATTENTION_SCORE) === "atencion");
  check("39 está en riesgo", bandOf(ATTENTION_SCORE - 1) === "riesgo");
  check("0 está en riesgo", bandOf(0) === "riesgo");
  check("100 es sana", bandOf(100) === "sana");
  check(
    "la marca de la tarjeta coincide con el borde de riesgo",
    CARD_SCORE_THRESHOLD === ATTENTION_SCORE
  );
}

console.log("\n=== 10. El texto que exige la Etapa 14 ===");
{
  const h = computeHealth(sana({ daysSinceLastActivity: 8 }));
  const frase = healthSentence(h);
  check("dice 'Salud comercial: 90/100'", frase === "Salud comercial: 90/100", frase);
  // Lo importante no es que diga esto, sino que NO diga lo otro: llamarlo
  // probabilidad prometería un pronóstico que estos datos no sostienen.
  check("no habla de probabilidad", !/probabilidad/i.test(frase));
  check("no usa el símbolo de porcentaje", !frase.includes("%"));
  check("una cerrada no produce frase", healthSentence(computeHealth(sana({ isOpen: false }))) === "");
}

console.log(
  fail === 0 ? `\n✅ ${pass} pruebas OK, 0 fallidas` : `\n❌ ${fail} fallidas de ${pass + fail}`
);
process.exit(fail === 0 ? 0 : 1);
