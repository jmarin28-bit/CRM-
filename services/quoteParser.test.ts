/**
 * Pruebas del parser de encabezado del Asistente de cotización.
 *
 *   npm run test:quotes
 *
 * La prueba que da nombre a este archivo es la primera: el asistente elegía
 * IONCORE para CUALQUIER texto dictado, porque las iniciales de un nombre de
 * una sola palabra son una sola letra ("i") y la comparación era
 * `texto.includes("i")`. Una cotización atribuida al cliente equivocado se
 * guarda sin que nadie lo note, así que estas pruebas existen sobre todo
 * para impedir que esa clase de falso positivo vuelva a entrar.
 */
import {
  parseQuoteHeader,
  splitHeaderNames,
  detectCurrencies,
  stripHeaderNames,
  scoreNameMatch,
  containsWholeWord,
  findAccount,
  findContact,
  toDisplayName,
  aliasesOf,
  collapseAcronymDots,
  scoreAliasMatch,
  reviewParsedItem,
  hasPendingReview,
} from "./quoteParser.ts";
import type { AccountV2, ContactV2 } from "../types.ts";

// --------------------------------------------------------------------------
// CRM de prueba
// --------------------------------------------------------------------------

const acc = (
  id: string,
  nombreComercial: string,
  razonSocial: string
): AccountV2 => ({
  id,
  ownerId: "u1",
  razonSocial,
  nombreComercial,
  nit: "900000000-1",
  sector: "",
  clasificacion: "",
  ciudad: "Medellín",
  direccion: "CL 1",
  createdAt: "2026-01-01T00:00:00.000Z",
});

const con = (id: string, accountId: string, fullName: string): ContactV2 => ({
  id,
  ownerId: "u1",
  accountId,
  fullName,
  role: "Compras",
  email: "a@b.com",
  phone: "300",
  whatsapp: "300",
  createdAt: "2026-01-01T00:00:00.000Z",
});

const ACCOUNTS: AccountV2[] = [
  acc("a-ion", "IONCORE", "IONCORE SAS"),
  acc("a-analtec", "ANALTEC", "ANALTEC LABORATORIOS S.A.S"),
  acc("a-prueba", "Empresa de Prueba SAS", "EMPRESA DE PRUEBA SAS"),
  acc("a-sgc", "SGC", "Servicios Geológicos Colombianos"),
  acc("a-quimica", "Química Andina", "QUIMICA ANDINA LTDA"),
];

const CONTACTS: ContactV2[] = [
  con("c-andres", "a-ion", "Andres Marin"),
  con("c-sandra", "a-ion", "Sandra García"),
  con("c-juan", "a-prueba", "Juan Pérez"),
  con("c-luis", "a-analtec", "Luis Restrepo"),
];

// --------------------------------------------------------------------------
// Arnés
// --------------------------------------------------------------------------

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

// --------------------------------------------------------------------------
// 1. LA REGRESIÓN PRINCIPAL
// --------------------------------------------------------------------------

console.log("\n1. Caso reportado: empresa y contacto dictados");

const CASO_REPORTADO =
  "cotización empresa de prueba sas juan pérez, codigo 23 columna cantidad 3 valor 456, codigo 34 filtro cantidad 1 valor 300";

{
  const r = parseQuoteHeader(CASO_REPORTADO, ACCOUNTS, CONTACTS);

  check("empresa detectada", r.account.match?.id, "a-prueba");
  check("contacto detectado", r.contact.match?.id, "c-juan");
  check("nombre de empresa leído", r.companyName, "Empresa de Prueba SAS");
  check("nombre de contacto leído", r.contactName, "Juan Pérez");
  check("sin avisos", r.warnings, []);

  // El corazón del bug: IONCORE no puede ganar nunca por sus iniciales.
  checkTrue("NO selecciona IONCORE", r.account.match?.id !== "a-ion");
  checkTrue("NO selecciona Andres Marin", r.contact.match?.id !== "c-andres");
}

// --------------------------------------------------------------------------
// 2. LA EMPRESA NO EXISTE → campo vacío + aviso (nunca la anterior)
// --------------------------------------------------------------------------

console.log("\n2. Empresa desconocida: avisar en vez de adivinar");

{
  const r = parseQuoteHeader(
    "cotización comercializadora del norte sas maria lopez, codigo 99 valvula cantidad 2 valor 150",
    ACCOUNTS,
    CONTACTS
  );

  check("sin empresa", r.account.match, undefined);
  check("sin contacto", r.contact.match, undefined);
  check("nombre leído para el aviso", r.companyName, "Comercializadora del Norte SAS");
  checkTrue(
    "avisa de la empresa faltante",
    r.warnings.some((w) => w.includes('No se encontró la empresa "Comercializadora del Norte SAS"'))
  );
  checkTrue(
    "avisa del contacto faltante",
    r.warnings.some((w) => w.includes('No se encontró el contacto "Maria Lopez"'))
  );
}

// --------------------------------------------------------------------------
// 3. NINGÚN texto arbitrario debe emparejar
// --------------------------------------------------------------------------

console.log("\n3. Textos que no nombran ninguna empresa");

{
  const sinEmpresa = [
    "codigo 23 columna cantidad 3 valor 456",
    "cotización de mantenimiento preventivo, codigo 10 valor 500",
    "necesito una cotizacion urgente, codigo 5 filtro cantidad 1 valor 90",
  ];

  sinEmpresa.forEach((texto, i) => {
    const r = parseQuoteHeader(texto, ACCOUNTS, CONTACTS);
    checkTrue(
      `texto ${i + 1} no inventa empresa (${r.account.match?.nombreComercial ?? "vacío"})`,
      r.account.match === undefined
    );
  });
}

// --------------------------------------------------------------------------
// 4. Formato con etiquetas (Director Comercial)
// --------------------------------------------------------------------------

console.log("\n4. Formato con etiquetas explícitas");

{
  const r = parseQuoteHeader(
    "cliente: ANALTEC LABORATORIOS S.A.S\ncontacto: Luis Restrepo\nmoneda: USD\ncódigo: 145\ncantidad: 1\nvalor: 451",
    ACCOUNTS,
    CONTACTS
  );

  check("empresa por etiqueta", r.account.match?.id, "a-analtec");
  check("contacto por etiqueta", r.contact.match?.id, "c-luis");
  check("moneda USD", r.currency.currency, "USD");
  check("no marca mezcla", r.currency.mixed, false);
}

// --------------------------------------------------------------------------
// 5. Iniciales: solo con 3+ letras y como palabra completa
// --------------------------------------------------------------------------

console.log("\n5. Iniciales");

{
  const r = parseQuoteHeader(
    "cotización para SGC, codigo 12 columna cantidad 1 valor 200",
    ACCOUNTS,
    CONTACTS
  );
  check("SGC empareja por iniciales", r.account.match?.id, "a-sgc");
}

{
  // "i" (iniciales de IONCORE) aparece en este texto como letra suelta dentro
  // de palabras, pero jamás como palabra completa.
  check(
    'containsWholeWord("cotizacion de prueba", "i")',
    containsWholeWord("cotizacion de prueba", "i"),
    false
  );
  check(
    'containsWholeWord("cotizacion para sgc", "sgc")',
    containsWholeWord("cotizacion para sgc", "sgc"),
    true
  );
  check("iniciales de 1 letra no puntúan", findAccount(["texto cualquiera con i"], [ACCOUNTS[0]]).match, undefined);
}

// --------------------------------------------------------------------------
// 6. Una sola palabra común no basta
// --------------------------------------------------------------------------

console.log("\n6. Coincidencias parciales insuficientes");

{
  // "Servicios" aparece en "Servicios Geológicos Colombianos" pero una sola
  // palabra genérica no puede seleccionar la cuenta.
  check(
    'scoreNameMatch("servicios", "Servicios Geológicos Colombianos")',
    scoreNameMatch("servicios", "Servicios Geológicos Colombianos"),
    0
  );
  checkTrue(
    "dos de tres palabras sí puntúan",
    scoreNameMatch("servicios geologicos", "Servicios Geológicos Colombianos") > 0
  );
  checkTrue(
    "razón social equivale a nombre comercial sin SAS",
    scoreNameMatch("analtec laboratorios", "ANALTEC LABORATORIOS S.A.S") >= 1000
  );
}

// --------------------------------------------------------------------------
// 7. Separación empresa / contacto
// --------------------------------------------------------------------------

console.log("\n7. Separación de nombres");

{
  const a = splitHeaderNames("cotización química andina ltda pedro gómez, codigo 1 valor 10");
  check("empresa antes de Ltda", a.companyName, "Química Andina Ltda");
  check("contacto después de LTDA", a.contactName, "Pedro Gómez");

  const b = splitHeaderNames("cotización analtec sas, codigo 5 filtro valor 30");
  check("empresa sin contacto", b.companyName, "Analtec SAS");
  check("contacto vacío", b.contactName, "");

  const c = splitHeaderNames("codigo 5 filtro cantidad 1 valor 30");
  check("sin encabezado", c.companyName, "");
}

// --------------------------------------------------------------------------
// 8. Moneda mixta
// --------------------------------------------------------------------------

console.log("\n8. Moneda");

{
  const mixto = detectCurrencies(
    "cotización en dólares, código 10 motor cantidad 1 valor 500 dólares, código 11 cable cantidad 2 valor 20000 pesos"
  );
  check("detecta mezcla", mixto.mixed, true);
  check("orden de aparición", mixto.currencies, ["USD", "COP"]);
  check("moneda base = primera", mixto.currency, "USD");

  check("solo pesos", detectCurrencies("valor 20000 pesos").mixed, false);
  check("solo USD", detectCurrencies("valor 500 USD").currency, "USD");
  check("US$ se reconoce", detectCurrencies("valor US$ 300").currency, "USD");
  check("sin moneda → COP", detectCurrencies("codigo 3 valor 100").currency, "COP");

  const r = parseQuoteHeader(
    "cotización en dólares, código 10 motor cantidad 1 valor 500 dólares, código 11 cable cantidad 2 valor 20000 pesos",
    ACCOUNTS,
    CONTACTS
  );
  checkTrue(
    "avisa de la mezcla",
    r.warnings.some((w) => w.includes("USD y COP"))
  );
}

// --------------------------------------------------------------------------
// 9. Limpieza de descripciones (que el nombre no ensucie el ítem)
// --------------------------------------------------------------------------

console.log("\n9. Limpieza de descripciones");

{
  const names = {
    companyName: "Empresa de Prueba SAS",
    contactName: "Juan Pérez",
  };

  check(
    "quita nombres pegados a la descripción",
    stripHeaderNames("prueba sas juan perez columna", names),
    "columna"
  );
  check("descripción limpia no se toca", stripHeaderNames("columna", names), "columna");
  check("filtro se conserva", stripHeaderNames("juan filtro", names), "filtro");
}

// --------------------------------------------------------------------------
// 10. Presentación de nombres
// --------------------------------------------------------------------------

console.log("\n10. Formato de nombres");

{
  check("title case con SAS", toDisplayName("empresa de prueba sas"), "Empresa de Prueba SAS");
  check("nombre de persona", toDisplayName("juan pérez"), "Juan Pérez");
  check("vacío", toDisplayName(""), "");
}

// --------------------------------------------------------------------------
// 11. Alias fonéticos (punto 4)
// --------------------------------------------------------------------------

console.log("\n11. Alias fonéticos");

{
  // Empresa cuyo nombre real es imposible de dictar tal cual.
  const hipico: AccountV2 = {
    ...acc("a-hipico", "H.I.P.I.C.O. S.A.S.", "H.I.P.I.C.O. SAS"),
    aliases: ["hipico"],
  };
  const conAlias = [...ACCOUNTS, hipico];

  check(
    "colapsa siglas con puntos",
    collapseAcronymDots("H.I.P.I.C.O. S.A.S."),
    "hipico sas"
  );
  check("normaliza y deduplica alias", aliasesOf({ aliases: ["Hípico", "hipico", "ab"] }), [
    "hipico",
  ]);
  check("acepta alias en una sola cadena", aliasesOf({ aliases: "hipico, ipico" } as any), [
    "hipico",
    "ipico",
  ]);
  check("descarta alias de menos de 3 letras", aliasesOf({ aliases: ["i", "io"] }), []);

  checkTrue("alias exacto puntúa alto", scoreAliasMatch("hipico", ["hipico"]) >= 900);
  check("alias corto no puede colarse", scoreAliasMatch("cotizacion de prueba", ["i"]), 0);

  // El caso de uso: se dicta el alias en medio de una frase sin puntuación.
  const r = parseQuoteHeader(
    "cotización hipico juan pérez, codigo 5 bomba cantidad 2 valor 900",
    conAlias,
    CONTACTS
  );
  check("alias selecciona la empresa correcta", r.account.match?.id, "a-hipico");
  check("alias da confianza alta", r.account.confidence, "alta");
  checkTrue(
    "sin aviso de empresa no encontrada",
    !r.warnings.some((w) => w.includes("No se encontró la empresa"))
  );

  // Sin el alias configurado, la misma frase NO debe inventar una empresa.
  const sinAlias = parseQuoteHeader(
    "cotización hipico juan pérez, codigo 5 bomba cantidad 2 valor 900",
    [...ACCOUNTS, acc("a-hipico", "H.I.P.I.C.O. S.A.S.", "H.I.P.I.C.O. SAS")],
    CONTACTS
  );
  checkTrue(
    "sin alias no se selecciona IONCORE ni otra empresa cualquiera",
    sinAlias.account.match?.id !== "a-ion"
  );

  // Alias en un contacto.
  const contactosAlias: ContactV2[] = [
    ...CONTACTS,
    { ...con("c-mj", "a-prueba", "María José Restrepo Ángel"), aliases: ["majo"] },
  ];
  const rc = findContact(["majo"], contactosAlias, undefined, "cotizacion majo");
  check("alias de contacto", rc.match?.id, "c-mj");

  // Un alias mal configurado no debe secuestrar todo: exige palabra completa.
  const trampa = [
    { ...acc("a-trampa", "Trampa", "Trampa SAS"), aliases: ["cot"] },
    ...ACCOUNTS,
  ];
  const rt = parseQuoteHeader(
    "cotización empresa de prueba sas juan pérez, codigo 23 columna cantidad 3 valor 456",
    trampa,
    CONTACTS
  );
  check(
    "alias contenido dentro de otra palabra no cuenta",
    rt.account.match?.id,
    "a-prueba"
  );
}

// --------------------------------------------------------------------------
// 12. Revisión por ítem (punto 6)
// --------------------------------------------------------------------------

console.log("\n12. Revisión por ítem");

{
  // El caso feliz reportado por el usuario NO debe generar marcas: si el
  // asistente marcara siempre, el asesor aprendería a ignorar las marcas.
  const limpio1 = reviewParsedItem("codigo 23 columna cantidad 3 valor 456", {
    code: "23",
    description: "columna",
    quantity: 3,
    unitPrice: 456,
  });
  check("línea bien dictada no se marca", limpio1.fields, []);

  const limpio2 = reviewParsedItem("codigo 34 filtro cantidad 1 valor 300", {
    code: "34",
    description: "filtro",
    quantity: 1,
    unitPrice: 300,
  });
  check("segunda línea del caso reportado tampoco", limpio2.fields, []);

  // Cantidad no dictada: se asumió 1.
  const sinCantidad = reviewParsedItem("codigo 12 valvula valor 5000", {
    code: "12",
    description: "valvula",
    quantity: 1,
    unitPrice: 5000,
  });
  check("cantidad asumida se marca", sinCantidad.fields, ["cantidad"]);

  // Valor ausente.
  const sinValor = reviewParsedItem("codigo 12 valvula cantidad 2", {
    code: "12",
    description: "valvula",
    quantity: 2,
    unitPrice: 0,
  });
  check("valor ausente se marca", sinValor.fields, ["valor"]);

  // Cifra suelta que no corresponde a nada: síntoma clásico de ruido.
  const sobrante = reviewParsedItem(
    "codigo 12 valvula cantidad 2 valor 5000 7000",
    { code: "12", description: "valvula", quantity: 2, unitPrice: 5000 }
  );
  check("cifra sin asignar se marca", sobrante.fields, ["valor"]);
  checkTrue(
    "el motivo nombra la cifra sobrante",
    sobrante.reasons.some((r) => r.includes("7000"))
  );

  // Descripción de relleno.
  const relleno = reviewParsedItem("codigo 12 cantidad 2 valor 5000", {
    code: "12",
    description: "Producto por definir",
    quantity: 2,
    unitPrice: 5000,
  });
  check("descripción de relleno se marca", relleno.fields, ["descripcion"]);

  // Código mencionado pero ilegible.
  const sinCodigo = reviewParsedItem("codigo valvula cantidad 2 valor 5000", {
    code: "",
    description: "valvula",
    quantity: 2,
    unitPrice: 5000,
  });
  check("código ilegible se marca", sinCodigo.fields, ["codigo"]);

  // Cantidad absurda.
  const absurda = reviewParsedItem("valvula cantidad 5000 valor 300", {
    code: "",
    description: "valvula",
    quantity: 5000,
    unitPrice: 300,
  });
  checkTrue("cantidad absurda se marca", absurda.fields.includes("cantidad"));

  // Separadores de miles no deben contarse como cifras sobrantes.
  const miles = reviewParsedItem("codigo 7 motor cantidad 2 valor 1.250.000", {
    code: "7",
    description: "motor",
    quantity: 2,
    unitPrice: 1250000,
  });
  check("separadores de miles no generan falsa alarma", miles.fields, []);

  // Códigos compuestos con guiones no deben generar falsas alarmas de cifras sobrantes
  const codigoCompuesto = reviewParsedItem("4) código 4450-5060 gases cantidad 1 valor 50", {
    code: "4450-5060",
    description: "gases",
    quantity: 1,
    unitPrice: 50,
  });
  check("código compuesto con guión 4450-5060 no genera falsa alarma", codigoCompuesto.fields, []);

  // Ítems de catálogo con números en la descripción técnica (ej: dimensiones, tamaños, 5/pk)
  const itemCatalogo = reviewParsedItem(
    "5) 7EM-G015-02-GST Zebron ZB-5HT w/Spliced Guard 2 m, GC Cap. Column 15 m x 0.32 mm x 0.10 µm, ea cantidad 2 valor 320",
    {
      code: "7EM-G015-02-GST",
      description: "Zebron ZB-5HT w/Spliced Guard 2 m, GC Cap. Column 15 m x 0.32 mm x 0.10 µm, ea",
      quantity: 2,
      unitPrice: 320,
    }
  );
  check("descripción técnica con dimensiones y código compuesto no genera falsa alarma", itemCatalogo.fields, []);

  // Atajo de bloqueo del guardado.
  check("sin marcas no bloquea", hasPendingReview({ a: limpio1 }), false);
  check("con marcas bloquea", hasPendingReview({ a: limpio1, b: sinValor }), true);
  check("sin revisiones no bloquea", hasPendingReview(undefined), false);
}

// --------------------------------------------------------------------------

console.log(`\n${pass} pruebas OK, ${fail} fallidas\n`);
if (fail > 0) process.exit(1);
