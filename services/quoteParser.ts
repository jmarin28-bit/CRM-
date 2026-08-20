/**
 * Extracción de EMPRESA, CONTACTO y MONEDA desde el texto dictado o pegado
 * en el "Asistente de cotización".
 *
 * ------------------------------------------------------------------------
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ------------------------------------------------------------------------
 * El emparejador anterior (findAccountFromPrompt en views/Quotes.tsx) usaba
 * las iniciales de la empresa como candidato de búsqueda. Para un nombre de
 * una sola palabra —"IONCORE"— las iniciales son la cadena "i", y la prueba
 * de coincidencia era `texto.includes(candidato)`. Cualquier frase en español
 * contiene una "i", así que IONCORE ganaba con 301 puntos (umbral: 40) sin
 * importar lo que se hubiera dictado.
 *
 * El contacto tenía un problema distinto: cuando no encontraba a nadie por
 * nombre, tomaba `contactosDeLaCuenta[0]`, es decir, un contacto arbitrario.
 *
 * Los dos fallos empujan en la misma dirección peligrosa: fabrican confianza
 * en vez de admitir que no encontraron nada, y la cotización termina
 * atribuida a otro cliente sin que el asesor lo note.
 *
 * ------------------------------------------------------------------------
 * REGLAS QUE ESTE MÓDULO SE IMPONE
 * ------------------------------------------------------------------------
 * 1. Nunca devolver una coincidencia que no supere el umbral. Vacío es un
 *    resultado válido; adivinar no lo es.
 * 2. Nunca emparejar por una sola palabra corta o común.
 * 3. Las iniciales solo cuentan si tienen 3+ letras y aparecen como palabra
 *    completa en el texto.
 * 4. Siempre reportar QUÉ nombre se leyó del texto, aunque no se encuentre,
 *    para poder avisar: «No se encontró la empresa "X"».
 *
 * Las funciones son puras y sin dependencias de React o del navegador, para
 * poder probarlas con `npm run test:quotes`.
 */

import type { AccountV2, ContactV2, QuoteCurrency } from "../types";

// ==========================================================================
// TIPOS
// ==========================================================================

/** Qué tan seguros estamos de una coincidencia. "ninguna" ⇒ no hay match. */
export type MatchConfidence = "alta" | "media" | "ninguna";

export interface EntityMatch<T> {
  /** El registro del CRM, o undefined si no se encontró nada confiable. */
  match?: T;
  /** Nombre tal como se leyó del texto dictado (para el mensaje de aviso). */
  searchedName: string;
  score: number;
  confidence: MatchConfidence;
}

export interface HeaderNames {
  /** Segmento del texto anterior al primer ítem. */
  header: string;
  /** Nombre de empresa leído, ya presentable (Title Case). "" si no hay. */
  companyName: string;
  /** Nombre de contacto leído, ya presentable. "" si no hay. */
  contactName: string;
  /** Variantes de la empresa a probar contra el CRM, de mejor a peor. */
  companyCandidates: string[];
  /** Variantes del contacto a probar contra el CRM. */
  contactCandidates: string[];
}

export interface CurrencyDetection {
  /** Moneda a aplicar. Si hay mezcla, la primera que aparece en el texto. */
  currency: QuoteCurrency;
  /** Todas las monedas detectadas, en orden de aparición. */
  currencies: QuoteCurrency[];
  /** true si el texto menciona COP y USD a la vez. Requiere confirmación. */
  mixed: boolean;
}

export interface QuoteHeaderParse extends HeaderNames {
  account: EntityMatch<AccountV2>;
  contact: EntityMatch<ContactV2>;
  currency: CurrencyDetection;
  /** Avisos para mostrar al asesor. Vacío = todo limpio. */
  warnings: string[];
}

// ==========================================================================
// NORMALIZACIÓN
// ==========================================================================

/** minúsculas, sin tildes, espacios colapsados. */
export const normalize = (value: string): string =>
  (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Formas societarias colombianas. Se ignoran al comparar nombres porque
 * "Analtec SAS" y "Analtec S.A.S." son la misma empresa, pero también sirven
 * de ANCLA para separar la empresa del contacto: en "empresa de prueba sas
 * juan perez", el "sas" marca dónde termina la razón social.
 */
const LEGAL_SUFFIX_WORDS = new Set([
  "sas",
  "sa",
  "ltda",
  "limitada",
  "eu",
  "sca",
  "scs",
  "bic",
  "esp",
  "ese",
  "ips",
  "eps",
  "inc",
  "llc",
  "corp",
  "co",
  "cia",
  "spa",
]);

/**
 * Palabras que no identifican a nadie. Si la única coincidencia entre el
 * texto y una empresa es una de estas, no es una coincidencia.
 */
const STOPWORDS = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "y",
  "e",
  "para",
  "por",
  "con",
  "en",
  "al",
  "un",
  "una",
  "empresa",
  "empresas",
  "cliente",
  "clientes",
  "cuenta",
  "contacto",
  "senor",
  "senora",
  "sr",
  "sra",
  "don",
  "dona",
  "ing",
  "dr",
  "dra",
  "grupo",
  "compania",
  "sociedad",
  "cotizacion",
  "cotizar",
  "cotiza",
  "nombre",
  ...LEGAL_SUFFIX_WORDS,
]);

/**
 * Palabras genéricas que encabezan decenas de razones sociales colombianas.
 *
 * Son "significativas" para formar un nombre, pero por sí solas no
 * identifican a nadie: si lo único que coincide entre el texto dictado y una
 * cuenta es "servicios", no hay coincidencia. Sin esta lista,
 * "cotización de servicios de mantenimiento" seleccionaría a "Servicios
 * Geológicos Colombianos".
 */
const WEAK_NAME_WORDS = new Set([
  "servicio",
  "servicios",
  "solucion",
  "soluciones",
  "comercializadora",
  "distribuidora",
  "distribuciones",
  "industria",
  "industrias",
  "tecnologia",
  "tecnologias",
  "laboratorio",
  "laboratorios",
  "ingenieria",
  "consultores",
  "consultoria",
  "corporacion",
  "internacional",
  "nacional",
  "colombia",
  "colombiana",
  "colombianos",
  "andina",
  "general",
  "generales",
  "suministros",
  "equipos",
  "productos",
  "insumos",
]);

/** Palabras significativas: sirven para identificar una entidad. */
export const significantWords = (value: string): string[] =>
  normalize(value)
    .replace(/[.,;:()]/g, " ")
    .split(" ")
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

/** Quita la forma societaria del final: "analtec sas" → "analtec". */
const stripLegalSuffix = (value: string): string => {
  const words = normalize(value).replace(/\./g, "").split(" ").filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIX_WORDS.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ");
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * ¿Aparece `needle` como palabra o frase completa dentro de `haystack`?
 *
 * Esto reemplaza el `includes()` del código anterior, que era la causa raíz:
 * "i".includes dentro de cualquier frase es siempre verdadero. Exigir
 * fronteras de palabra hace que "i" solo empareje con la palabra "i".
 */
export const containsWholeWord = (haystack: string, needle: string): boolean => {
  const h = normalize(haystack);
  const n = normalize(needle);
  if (!h || !n) return false;
  return new RegExp(`(^|\\W)${escapeRegExp(n)}($|\\W)`).test(h);
};

/** Siglas que se escriben en mayúscula sostenida. "Ltda" y "Limitada" no. */
const UPPERCASE_SUFFIXES = new Set([
  "sas",
  "sa",
  "eu",
  "esp",
  "ese",
  "ips",
  "eps",
  "bic",
  "llc",
  "inc",
  "sca",
  "scs",
]);

/** "empresa de prueba sas" → "Empresa de Prueba SAS" */
export const toDisplayName = (value: string): string => {
  const clean = (value || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean
    .split(" ")
    .map((word) => {
      const bare = normalize(word).replace(/\./g, "");
      if (UPPERCASE_SUFFIXES.has(bare)) return word.toUpperCase();
      // Conectores en minúscula, salvo al inicio.
      if (["de", "del", "la", "las", "el", "los", "y", "e"].includes(bare)) {
        return bare;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .map((word, i) =>
      i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word
    )
    .join(" ");
};

const buildInitials = (value: string): string =>
  normalize(value)
    .split(" ")
    .filter((part) => part.length > 0 && !STOPWORDS.has(part))
    .map((part) => part[0])
    .join("");

// ==========================================================================
// 1. AISLAR EL ENCABEZADO (lo que viene antes del primer ítem)
// ==========================================================================

/**
 * Marcadores que indican que empezaron los ítems. Todo lo anterior es
 * encabezado: empresa, contacto, moneda, tipo.
 */
const ITEM_START = /\b(c[oó]d(?:ig[oó])?|[ií]tem|referencia|ref)\b|(?:^|\n)\s*\d+\s*\)/i;

export const extractHeader = (prompt: string): string => {
  const text = (prompt || "").trim();
  if (!text) return "";
  const m = text.match(ITEM_START);
  const cut = m && m.index !== undefined ? text.slice(0, m.index) : text;
  return cut.trim();
};

/**
 * Palabras que aparecen en el encabezado pero no nombran a nadie: moneda,
 * tipo de cotización, muletillas. Si lo único que queda tras quitarlas es
 * vacío, el encabezado no traía empresa ni contacto.
 *
 * Sin esto, "cotización en dólares, código 10..." dejaba "en dólares" como
 * nombre de empresa y disparaba el aviso «No se encontró la empresa "En
 * Dólares"», que es ruido que entrena al asesor a ignorar los avisos.
 */
const NON_NAME_WORDS = new Set([
  ...STOPWORDS,
  "usd",
  "cop",
  "dolar",
  "dolares",
  "dollar",
  "dollars",
  "peso",
  "pesos",
  "colombianos",
  "moneda",
  "producto",
  "productos",
  "servicio",
  "servicios",
  "item",
  "items",
  "urgente",
  "favor",
  "rapido",
  "nueva",
  "nuevo",
  "total",
  "iva",
  "hoy",
  "manana",
]);

/** ¿Queda algo que pueda ser un nombre propio? */
const looksLikeName = (value: string): boolean =>
  normalize(value)
    .replace(/[.,;:()]/g, " ")
    .split(" ")
    .some((w) => w.length > 2 && !NON_NAME_WORDS.has(w));

/** Frases de moneda que se retiran del encabezado antes de separar nombres. */
const CURRENCY_PHRASE =
  /\b(?:en\s+)?(?:d[oó]lares|d[oó]lar|dollars?|usd|pesos?\s+colombianos|pesos?|cop)\b/gi;

/** Quita muletillas iniciales: "cotización para ...", "hazme una cotización de ..." */
const stripLeadIn = (value: string): string =>
  (value || "")
    .replace(
      /^\s*(?:hazme|hac[eé]me|genera|generar|crea|crear|arma|armar|nueva|una|un|el|la)\s+/i,
      ""
    )
    .replace(/^\s*(?:cotizaci[oó]n|cotizar|cotiza|constaci[oó]n|estaci[oó]n)\s*/i, "")
    .replace(/^\s*(?:para|a nombre de|de|a|al|el|la)\s+/i, "")
    .trim();

// ==========================================================================
// 2. SEPARAR EMPRESA DE CONTACTO
// ==========================================================================

const LABEL_COMPANY = /(?:empresa|cliente|cuenta|raz[oó]n\s+social)\s*[:\-]\s*([^,;\n\r]+)/i;
const LABEL_CONTACT = /(?:contacto|atenci[oó]n|atn|dirigido\s+a|a\s+nombre\s+de)\s*[:\-]\s*([^,;\n\r]+)/i;

/**
 * Separa el encabezado en empresa y contacto.
 *
 * Tres estrategias, en orden de fiabilidad:
 *
 *   A. Etiquetas explícitas — "empresa: Acme SAS, contacto: Juan Pérez".
 *      Es el formato que produce el Director Comercial.
 *
 *   B. Ancla de forma societaria — "empresa de prueba sas juan pérez".
 *      El "sas" marca el final de la razón social; lo que sigue es la
 *      persona. Es lo que produce el dictado por voz, que no pone comas.
 *
 *   C. Coma — "acme sas, juan pérez".
 *
 * Cuando ninguna aplica, devolvemos el encabezado entero como candidato de
 * empresa y dejamos que el emparejador decida. Si no encuentra nada, el
 * asesor recibe un aviso y elige a mano; nunca se rellena a ciegas.
 */
export const splitHeaderNames = (prompt: string): HeaderNames => {
  const header = extractHeader(prompt);
  const empty: HeaderNames = {
    header,
    companyName: "",
    contactName: "",
    companyCandidates: [],
    contactCandidates: [],
  };
  if (!header) return empty;

  let companyRaw = "";
  let contactRaw = "";

  // --- A. Etiquetas explícitas ---
  const labelledCompany = header.match(LABEL_COMPANY)?.[1]?.trim() || "";
  const labelledContact = header.match(LABEL_CONTACT)?.[1]?.trim() || "";

  if (labelledCompany || labelledContact) {
    companyRaw = labelledCompany;
    contactRaw = labelledContact;
  } else {
    // La moneda se detecta aparte; aquí solo estorba.
    const body = stripLeadIn(header.replace(CURRENCY_PHRASE, " ").replace(/\s+/g, " "));

    // --- B. Ancla de forma societaria ---
    const words = body.split(/\s+/).filter(Boolean);
    let anchor = -1;
    for (let i = 0; i < words.length; i++) {
      const bare = normalize(words[i]).replace(/[.,]/g, "");
      if (LEGAL_SUFFIX_WORDS.has(bare)) anchor = i;
    }

    if (anchor >= 0 && anchor < words.length - 1) {
      companyRaw = words.slice(0, anchor + 1).join(" ");
      contactRaw = words.slice(anchor + 1).join(" ");
    } else if (anchor === words.length - 1) {
      // La forma societaria cierra el encabezado: todo es empresa.
      companyRaw = body;
    } else if (body.includes(",")) {
      // --- C. Coma ---
      const [first, ...rest] = body.split(",");
      companyRaw = first.trim();
      contactRaw = rest.join(" ").trim();
    } else {
      companyRaw = body;
    }
  }

  const clean = (v: string) =>
    v
      .replace(/[,;.]+$/, "")
      .replace(/\s+/g, " ")
      .trim();

  companyRaw = clean(companyRaw);
  contactRaw = clean(contactRaw);

  // Descartar lo que solo es ruido: moneda, tipo, muletillas.
  if (!looksLikeName(companyRaw)) companyRaw = "";
  if (!looksLikeName(contactRaw)) contactRaw = "";

  return {
    header,
    companyName: toDisplayName(companyRaw),
    contactName: toDisplayName(contactRaw),
    companyCandidates: buildCandidates(companyRaw),
    contactCandidates: buildCandidates(contactRaw),
  };
};

/**
 * Variantes a probar contra el CRM.
 *
 * "empresa de prueba sas" es ambiguo: "empresa" puede ser parte del nombre
 * (Empresa de Prueba SAS) o una etiqueta ("empresa Acme SAS"). En vez de
 * elegir, probamos ambas y nos quedamos con la que puntúe mejor.
 */
const buildCandidates = (raw: string): string[] => {
  const base = (raw || "").trim();
  if (!base) return [];

  const out = [base];

  const withoutLead = stripLeadIn(base);
  if (withoutLead && withoutLead !== base) out.push(withoutLead);

  const withoutSuffix = stripLegalSuffix(base);
  if (withoutSuffix && withoutSuffix !== normalize(base)) out.push(withoutSuffix);

  return Array.from(new Set(out.filter(Boolean)));
};

// ==========================================================================
// 3. EMPAREJAR CONTRA EL CRM
// ==========================================================================

/** Umbrales. Por debajo de MIN no se devuelve nada. */
const SCORE_HIGH = 600;
const SCORE_MIN = 260;

/**
 * Puntúa un nombre candidato contra un nombre del CRM.
 *
 * Deliberadamente conservador: solo puntúa alto cuando hay evidencia real
 * (igualdad, contención de frase completa, o mayoría de palabras
 * significativas coincidentes). Una sola palabra suelta nunca alcanza.
 */
export const scoreNameMatch = (candidate: string, target: string): number => {
  const c = normalize(candidate);
  const t = normalize(target);
  if (!c || !t) return 0;

  const cBare = stripLegalSuffix(c);
  const tBare = stripLegalSuffix(t);

  // Igualdad (ignorando la forma societaria).
  if (cBare && cBare === tBare) return 1000;
  if (c === t) return 1000;

  // Una contiene a la otra como frase completa.
  //
  // La contención solo vale si lo contenido identifica algo por sí mismo:
  // "analtec" dentro de "analtec laboratorios" sí; "servicios" dentro de
  // "servicios geologicos colombianos" no, porque media Colombia se llama así.
  const identifies = (phrase: string): boolean => {
    const words = significantWords(phrase);
    if (words.length === 0) return false;
    if (words.length === 1) return !WEAK_NAME_WORDS.has(words[0]);
    return true;
  };

  if (tBare.length >= 4 && identifies(tBare) && containsWholeWord(cBare, tBare)) {
    return 700 + tBare.length;
  }
  if (cBare.length >= 4 && identifies(cBare) && containsWholeWord(tBare, cBare)) {
    return 640 + cBare.length;
  }

  // Solapamiento de palabras significativas.
  const targetWords = significantWords(t);
  const candidateWords = significantWords(c);
  if (targetWords.length === 0 || candidateWords.length === 0) return 0;

  const matched = targetWords.filter((w) =>
    candidateWords.some((cw) => cw === w || (w.length > 4 && cw.startsWith(w)))
  );

  if (matched.length === 0) return 0;

  // Una sola palabra de una empresa multi-palabra no basta: "servicios"
  // aparece en decenas de razones sociales.
  const ratio = matched.length / targetWords.length;
  if (matched.length === 1 && targetWords.length > 1) return 0;
  if (ratio < 0.5) return 0;
  // Coincidir solo en palabras genéricas no identifica a nadie.
  if (matched.every((w) => WEAK_NAME_WORDS.has(w))) return 0;

  return Math.round(ratio * 500) + matched.join("").length;
};

/**
 * Puntaje por iniciales — "SGC" para "Servicios Geológicos Colombianos".
 *
 * Exige 3+ letras y aparición como palabra completa. Con 1-2 letras las
 * iniciales coinciden con casi cualquier texto, que es exactamente el bug
 * que este módulo viene a corregir.
 */
const scoreInitials = (candidate: string, target: string): number => {
  const initials = buildInitials(target);
  if (initials.length < 3) return 0;
  return containsWholeWord(candidate, initials) ? 620 : 0;
};

// --------------------------------------------------------------------------
// Alias fonéticos (punto 4)
// --------------------------------------------------------------------------

/**
 * Une las siglas escritas con puntos: "h.i.p.i.c.o. s.a.s." → "hipico sas".
 *
 * Hace falta porque la razón social se escribe con puntos pero se DICTA
 * seguida, y `containsWholeWord` trata cada punto como frontera de palabra.
 */
export const collapseAcronymDots = (value: string): string =>
  normalize(value)
    // Secuencias de 2+ letras sueltas separadas por punto: "s.a.s." → "sas".
    .replace(/\b(?:[a-z0-9]\.){2,}/g, (run) => run.replace(/\./g, ""))
    .replace(/\s+/g, " ")
    .trim();

/** Longitud mínima de un alias utilizable. Evita repetir el bug de "i". */
const MIN_ALIAS_LENGTH = 3;

/**
 * Lista de alias de un registro, ya normalizados y filtrados.
 *
 * Acepta el campo `aliases` (string[]) y, por comodidad para quien lo edite a
 * mano, también una cadena con alias separados por coma o punto y coma.
 */
export const aliasesOf = (entity: {
  aliases?: string[] | string;
}): string[] => {
  const raw = entity?.aliases;
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,;|]/)
      : [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const value = collapseAcronymDots(item || "");
    if (value.length < MIN_ALIAS_LENGTH) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
};

/**
 * Puntúa un candidato contra los alias configurados del registro.
 *
 * El alias lo escribió una persona a propósito para este registro, así que
 * vale más que cualquier heurística: 900, por encima del umbral "alta" (600)
 * y por debajo de la igualdad exacta de nombre (1000).
 *
 * Aun así exige coincidencia de PALABRA COMPLETA y 3+ caracteres. Un alias
 * mal configurado no debe poder volver a secuestrar todas las cotizaciones.
 */
export const scoreAliasMatch = (
  candidate: string,
  aliases: string[]
): number => {
  const c = collapseAcronymDots(candidate);
  if (c.length < MIN_ALIAS_LENGTH) return 0;

  let best = 0;
  for (const alias of aliases) {
    if (c === alias) {
      best = Math.max(best, 950);
      continue;
    }
    if (containsWholeWord(c, alias) || containsWholeWord(alias, c)) {
      best = Math.max(best, 900);
    }
  }
  return best;
};

const confidenceOf = (score: number): MatchConfidence => {
  if (score >= SCORE_HIGH) return "alta";
  if (score >= SCORE_MIN) return "media";
  return "ninguna";
};

/**
 * @param headerText Texto completo del encabezado. Solo se usa para buscar
 *   ALIAS: si alguien dicta "cotización hipico juan pérez" no hay forma
 *   ortográfica de saber dónde termina la empresa, pero el alias "hipico"
 *   configurado a mano sí se puede reconocer dentro de la frase.
 */
export const findAccount = (
  candidates: string[],
  accounts: AccountV2[],
  headerText?: string
): EntityMatch<AccountV2> => {
  const searchedName = toDisplayName(candidates[0] || "");
  const aliasProbes = [...candidates, headerText || ""].filter(Boolean);
  let best: AccountV2 | undefined;
  let bestScore = 0;

  for (const account of accounts || []) {
    const targets = [account.nombreComercial, account.razonSocial].filter(
      Boolean
    ) as string[];

    const aliases = aliasesOf(account);
    if (aliases.length > 0) {
      for (const probe of aliasProbes) {
        const score = scoreAliasMatch(probe, aliases);
        if (score > bestScore) {
          bestScore = score;
          best = account;
        }
      }
    }

    for (const candidate of candidates) {
      for (const target of targets) {
        const score = Math.max(
          scoreNameMatch(candidate, target),
          scoreInitials(candidate, target)
        );
        if (score > bestScore) {
          bestScore = score;
          best = account;
        }
      }
    }
  }

  const confidence = confidenceOf(bestScore);
  return {
    match: confidence === "ninguna" ? undefined : best,
    searchedName,
    score: bestScore,
    confidence,
  };
};

const contactDisplayName = (contact: any): string =>
  contact?.fullName ||
  contact?.name ||
  `${contact?.firstName || ""} ${contact?.lastName || ""}`.trim();

/**
 * Busca el contacto por nombre.
 *
 * A diferencia del código anterior, si no hay coincidencia NO se devuelve el
 * primer contacto de la cuenta. Un contacto equivocado en una cotización es
 * peor que un campo vacío: el campo vacío se ve, el contacto equivocado no.
 *
 * `accountId` restringe la búsqueda cuando ya sabemos la empresa, pero si el
 * nombre dictado no coincide con nadie de esa empresa, se devuelve vacío.
 */
export const findContact = (
  candidates: string[],
  contacts: ContactV2[],
  accountId?: string,
  headerText?: string
): EntityMatch<ContactV2> => {
  const searchedName = toDisplayName(candidates[0] || "");
  const pool = accountId
    ? (contacts || []).filter((c) => c.accountId === accountId)
    : contacts || [];
  const aliasProbes = [...candidates, headerText || ""].filter(Boolean);

  let best: ContactV2 | undefined;
  let bestScore = 0;

  for (const contact of pool) {
    const name = contactDisplayName(contact);

    const aliases = aliasesOf(contact);
    if (aliases.length > 0) {
      for (const probe of aliasProbes) {
        const score = scoreAliasMatch(probe, aliases);
        if (score > bestScore) {
          bestScore = score;
          best = contact;
        }
      }
    }

    if (!name) continue;

    for (const candidate of candidates) {
      const score = scoreNameMatch(candidate, name);
      if (score > bestScore) {
        bestScore = score;
        best = contact;
      }
    }
  }

  const confidence = confidenceOf(bestScore);
  return {
    match: confidence === "ninguna" ? undefined : best,
    searchedName,
    score: bestScore,
    confidence,
  };
};

// ==========================================================================
// 4. MONEDA (incluida la mezcla)
// ==========================================================================

// "us$" no puede llevar \b al final: el "$" ya es un carácter no-palabra, así
// que \b exigiría una letra pegada y "US$ 300" no coincidiría.
const USD_TOKENS = /\busd\b|us\s*\$|u\s*\$\s*s|\bd[oó]lar(?:es)?\b|\bdollars?\b|\bdls\b/gi;
const COP_TOKENS = /\bcop\b|\bpesos?\b|\bcolombianos\b/gi;

/**
 * Detecta la moneda y avisa si el texto mezcla dos.
 *
 * Mezclar monedas sin darse cuenta produce un total sin sentido —sumar 500
 * USD con 20.000 COP como si fueran la misma unidad—, así que el asistente
 * debe preguntar en vez de asumir.
 */
export const detectCurrencies = (text: string): CurrencyDetection => {
  const t = normalize(text);

  const hits: { currency: QuoteCurrency; index: number }[] = [];

  for (const m of t.matchAll(new RegExp(USD_TOKENS.source, "gi"))) {
    hits.push({ currency: "USD", index: m.index ?? 0 });
  }
  for (const m of t.matchAll(new RegExp(COP_TOKENS.source, "gi"))) {
    hits.push({ currency: "COP", index: m.index ?? 0 });
  }

  hits.sort((a, b) => a.index - b.index);

  const ordered: QuoteCurrency[] = [];
  for (const hit of hits) {
    if (!ordered.includes(hit.currency)) ordered.push(hit.currency);
  }

  return {
    currency: ordered[0] || "COP",
    currencies: ordered,
    mixed: ordered.length > 1,
  };
};

// ==========================================================================
// 5. LIMPIEZA DE DESCRIPCIONES
// ==========================================================================

/**
 * Quita de una descripción de ítem los nombres de empresa y contacto leídos
 * del encabezado.
 *
 * Importante: opera sobre lo LEÍDO, no sobre lo emparejado. Si el asesor
 * dicta "empresa de prueba sas juan pérez" y esa empresa no existe en el
 * CRM, igual hay que evitar que "prueba sas juan perez" acabe como
 * descripción de un ítem o como código falso.
 */
export const stripHeaderNames = (
  description: string,
  names: Pick<HeaderNames, "companyName" | "contactName">
): string => {
  let cleaned = description || "";
  if (!cleaned) return cleaned;

  const phrases = [names.companyName, names.contactName].filter(
    (p) => p && p.trim().length > 3
  );
  if (phrases.length === 0) return cleaned;

  // Primero la frase completa, luego palabra por palabra.
  for (const phrase of phrases) {
    cleaned = cleaned.replace(accentInsensitive(phrase, false), " ");
  }

  for (const phrase of phrases) {
    for (const word of significantWords(phrase)) {
      cleaned = cleaned.replace(accentInsensitive(word, true), " ");
    }
  }

  // Restos de la forma societaria: "prueba sas juan perez" pierde "prueba",
  // "juan" y "perez" por ser palabras significativas, pero "sas" es stopword
  // y sobreviviría como basura al inicio de la descripción.
  if (names.companyName) {
    for (const word of normalize(names.companyName).split(" ")) {
      const bare = word.replace(/\./g, "");
      if (LEGAL_SUFFIX_WORDS.has(bare)) {
        cleaned = cleaned.replace(accentInsensitive(bare, true), " ");
      }
    }
  }

  return cleaned.replace(/\s+/g, " ").replace(/^[\s,;.-]+|[\s,;.-]+$/g, "").trim();
};

/**
 * Limpieza completa de la descripción de un ítem: nombres del encabezado y
 * palabras de moneda.
 *
 * La moneda se dicta pegada al valor ("valor 20000 pesos"), y el extractor de
 * descripción se queda con lo que sobra, así que sin esto la línea aparece
 * como "cable pesos" en la tabla de ítems.
 */
export const cleanItemDescription = (
  description: string,
  names: Pick<HeaderNames, "companyName" | "contactName">
): string =>
  stripHeaderNames(description, names)
    .replace(CURRENCY_PHRASE, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;.-]+|[\s,;.-]+$/g, "")
    .trim();

/**
 * Regex que ignora tildes: el asesor dicta "Juan Pérez" y el reconocimiento
 * de voz puede escribir "juan perez" (o al revés). Comparar sin normalizar el
 * texto original dejaría el nombre a medio borrar.
 */
const ACCENT_CLASSES: Record<string, string> = {
  a: "[aáàäâ]",
  e: "[eéèëê]",
  i: "[iíìïî]",
  o: "[oóòöô]",
  u: "[uúùüû]",
  n: "[nñ]",
  c: "[cç]",
};

const accentInsensitive = (value: string, wholeWord: boolean): RegExp => {
  const pattern = normalize(value)
    .split("")
    .map((ch) => {
      if (ACCENT_CLASSES[ch]) return ACCENT_CLASSES[ch];
      if (ch === " ") return "\\s+";
      return escapeRegExp(ch);
    })
    .join("");

  return new RegExp(wholeWord ? `(?:^|\\b)${pattern}(?:\\b|$)` : pattern, "gi");
};

// ==========================================================================
// 6. ORQUESTADOR
// ==========================================================================

/**
 * Lee el encabezado completo y devuelve empresa, contacto, moneda y los
 * avisos que el asesor debe ver antes de guardar.
 */
export const parseQuoteHeader = (
  prompt: string,
  accounts: AccountV2[],
  contacts: ContactV2[]
): QuoteHeaderParse => {
  const names = splitHeaderNames(prompt);
  const currency = detectCurrencies(prompt);
  const warnings: string[] = [];

  const account = findAccount(names.companyCandidates, accounts, names.header);

  // El contacto se busca primero dentro de la empresa detectada; si no
  // aparece ahí, se busca en toda la libreta, porque puede que la empresa
  // esté mal detectada y el contacto sea la pista buena.
  let contact = findContact(
    names.contactCandidates,
    contacts,
    account.match?.id,
    names.header
  );

  if (!contact.match && names.contactCandidates.length > 0) {
    const global = findContact(
      names.contactCandidates,
      contacts,
      undefined,
      names.header
    );
    if (global.match) contact = global;
  }

  // --- Avisos ---
  // Si un alias resolvió la empresa, no hay nada que avisar aunque el texto
  // no tuviera un nombre reconocible: para eso se configuró el alias.
  if (!names.companyName && !names.contactName && !account.match && !contact.match) {
    warnings.push(
      "No se detectó empresa ni contacto en el texto. Selecciónalos manualmente."
    );
  }

  if (names.companyName && !account.match) {
    warnings.push(
      `No se encontró la empresa "${names.companyName}" en el CRM. Selecciónala manualmente o créala en Cuentas.`
    );
  }

  if (names.contactName && !contact.match) {
    warnings.push(
      `No se encontró el contacto "${names.contactName}" en el CRM. Selecciónalo manualmente.`
    );
  }

  if (account.match && account.confidence === "media") {
    const shown =
      account.match.nombreComercial || account.match.razonSocial || "";
    warnings.push(
      `Empresa detectada por coincidencia parcial: "${shown}". Verifica que sea la correcta.`
    );
  }

  if (contact.match && contact.confidence === "media") {
    warnings.push(
      `Contacto detectado por coincidencia parcial: "${contactDisplayName(
        contact.match
      )}". Verifica que sea el correcto.`
    );
  }

  // El contacto pertenece a otra empresa: casi siempre es un error de lectura.
  if (
    account.match &&
    contact.match &&
    contact.match.accountId !== account.match.id
  ) {
    warnings.push(
      `El contacto "${contactDisplayName(
        contact.match
      )}" no pertenece a la empresa seleccionada. Revísalo antes de guardar.`
    );
  }

  if (currency.mixed) {
    warnings.push(
      `El texto menciona ${currency.currencies.join(
        " y "
      )}. Se aplicó ${currency.currency} a todos los ítems: confirma la moneda antes de guardar.`
    );
  }

  return { ...names, account, contact, currency, warnings };
};

// ==========================================================================
// 7. REVISIÓN POR ÍTEM (punto 6)
// ==========================================================================
//
// El parser puede equivocarse al leer una cantidad o un valor —por ruido en
// el audio, por una cifra dictada a medias o por varias cifras sueltas en la
// misma frase. Guardar eso en silencio es el mismo pecado que inventar una
// empresa: el error queda escrito y nadie lo ve.
//
// Estas funciones NO corrigen nada. Solo señalan qué campos merecen una
// mirada humana, para que la interfaz los marque y exija confirmación.
//
// Criterio de diseño: se marca lo que es incierto POR CÓMO SE LEYÓ EL TEXTO,
// no lo que parece caro o barato. Un umbral de precio inventado produciría
// avisos falsos, y un aviso falso repetido enseña al asesor a ignorarlos
// todos — que es justo lo que estamos intentando evitar.

/** Campo de un ítem que quedó en duda. */
export type ItemReviewField = "cantidad" | "valor" | "descripcion" | "codigo";

export interface ItemReview {
  /** Campos a resaltar. Vacío ⇒ la línea se leyó sin ambigüedad. */
  fields: ItemReviewField[];
  /** Motivos legibles, en el mismo orden, para el tooltip. */
  reasons: string[];
}

/** Forma mínima de ítem que necesita el revisor. */
export interface ReviewableItem {
  code?: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export const EMPTY_ITEM_REVIEW: ItemReview = { fields: [], reasons: [] };

/** Descripciones de relleno que el generador pone cuando no entendió nada. */
const PLACEHOLDER_DESCRIPTIONS = new Set([
  "producto por definir",
  "servicio por definir",
]);

/** Marcas que indican que la cantidad se dictó de forma explícita. */
const EXPLICIT_QUANTITY =
  /\b(cantidad|cant|unidades?|uds?|piezas?|pzas?)\b|\bx\s*\d/i;

/** Marcas que indican que se dictó un código. */
const CODE_MENTIONED = /\b(c[oó]d(?:ig[oó])?|referencia|ref)\b/i;

/** Marcas que indican que se dictó un valor. */
const VALUE_MENTIONED = /\b(valor|precio|vale|cuesta|c\/u|unitario)\b|\$/i;

/** Todos los números del texto, ya sin separadores de miles. */
const numberTokens = (text: string): string[] =>
  (text.match(/\d[\d.,]*/g) || [])
    .map((token) => token.replace(/[.,](?=\d{3}\b)/g, "").replace(/[.,]$/, ""))
    .map((token) => token.replace(/[.,]/g, ""))
    .filter(Boolean);

/**
 * Revisa una línea ya parseada contra el texto del que salió.
 *
 * @param block Fragmento de texto dictado que originó el ítem.
 * @param item  Ítem resultante.
 */
export const reviewParsedItem = (
  block: string,
  item: ReviewableItem
): ItemReview => {
  const fields: ItemReviewField[] = [];
  const reasons: string[] = [];
  const text = block || "";

  const flag = (field: ItemReviewField, reason: string) => {
    if (!fields.includes(field)) {
      fields.push(field);
      reasons.push(reason);
    }
  };

  // --- Cantidad ---
  const qty = Number(item.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    flag("cantidad", "No se pudo leer la cantidad.");
  } else if (!Number.isInteger(qty)) {
    flag("cantidad", `Cantidad con decimales (${qty}). Confirma el número.`);
  } else if (qty > 999) {
    flag("cantidad", `Cantidad inusualmente alta (${qty}). Confirma el número.`);
  } else if (!EXPLICIT_QUANTITY.test(text)) {
    flag(
      "cantidad",
      "No se dictó una cantidad; se asumió 1. Confirma si es correcta."
    );
  }

  // --- Valor unitario ---
  const price = Number(item.unitPrice);
  if (!Number.isFinite(price) || price <= 0) {
    flag(
      "valor",
      VALUE_MENTIONED.test(text)
        ? "Se mencionó un valor pero no se pudo leer."
        : "No se dictó un valor unitario."
    );
  } else if (price >= 1e12) {
    flag("valor", "Valor fuera de rango. Probablemente se leyeron dígitos de más.");
  }

  // --- Cifras sobrantes: señal fuerte de lectura ambigua ---
  // Si en la línea hay números que no corresponden ni al código, ni a la
  // cantidad, ni al valor, ni a la descripción técnica, es que algo se leyó mal o se perdió por el camino.
  const codeNumbers = numberTokens(String(item.code || ""));
  const descNumbers = numberTokens(String(item.description || ""));
  const consumed = [
    String(item.code || "").replace(/[.,]/g, ""),
    ...codeNumbers,
    ...descNumbers,
    Number.isFinite(qty) ? String(qty) : "",
    Number.isFinite(price) ? String(price) : "",
  ]
    .map((v) => v.replace(/[.,]/g, ""))
    .filter(Boolean);

  const cleanTextForTokens = text.replace(/^\s*\d+[\).]\s*/, "");
  const leftovers = [...numberTokens(cleanTextForTokens)];
  for (const used of consumed) {
    const at = leftovers.indexOf(used);
    if (at !== -1) leftovers.splice(at, 1);
  }

  if (leftovers.length > 0) {
    flag(
      "valor",
      `La línea tiene cifras sin asignar (${leftovers.join(
        ", "
      )}). Confirma cantidad y valor.`
    );
  }

  // --- Descripción ---
  const description = normalize(item.description || "");
  if (!description || PLACEHOLDER_DESCRIPTIONS.has(description)) {
    flag("descripcion", "No se entendió qué se está cotizando. Escríbelo.");
  } else if (description.length < 3) {
    flag("descripcion", "Descripción demasiado corta. Confirma que esté completa.");
  }

  // --- Código ---
  if (CODE_MENTIONED.test(text) && !String(item.code || "").trim()) {
    flag("codigo", "Se mencionó un código pero no se pudo leer.");
  }

  return { fields, reasons };
};

/** true si algún ítem quedó marcado. Atajo para bloquear el guardado. */
export const hasPendingReview = (
  reviews: Record<string, ItemReview> | undefined
): boolean =>
  Object.values(reviews || {}).some((review) => review.fields.length > 0);
