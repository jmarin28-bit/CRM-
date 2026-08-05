// pages/Quotes.tsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  QuoteV2,
  QuoteItem,
  QuoteItemType,
  QuoteUnit,
  QuoteType,
  QuoteCurrency,
  QuoteStatus,
  QuoteTerms,
  QuoteNotes,
  AccountV2,
  ContactV2,
  CRMUser,
  AdvisorBudgetV2
} from '../types';
import {
  listQuotesByUser,
  createQuote,
  updateQuote,
  deleteQuote,
  listAccountsByUser,
  listContactsByUser,
  updateQuoteStatus,
  duplicateQuote,
  listOpportunitiesByUser,
  createOpportunity,
  updateOpportunity,
  listUsers,
  listBudgets,
  getBudgetForAdvisor,
  saveBudget,
  getTRM,
  saveTRM,
  uid
} from '../services/storage';
import { toLocalDateKey, todayLocal, calendarPartsOf, currentPeriod, periodBounds, periodOptions } from '../services/dates';
import {
  Plus, Trash2, X, List, ShieldCheck, StickyNote, Building2, Mic
} from 'lucide-react';

const formatMoneyByCurrency = (amount: number, currency: QuoteCurrency = "COP") => {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "USD" ? 2 : 0,
    maximumFractionDigits: currency === "USD" ? 2 : 0
  }).format(amount || 0);
};

// ==========================================
// HELPERS DE INTELIGENCIA LOCAL (IA Básica)
// ==========================================
const normalizeText = (value: string) =>
  (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const buildInitials = (value: string) => {
  return normalizeText(value)
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("");
};

const numberWordsToDigits = (text: string) => {
  const map: Record<string, string> = {
    cero: "0",
    uno: "1",
    una: "1",
    dos: "2",
    tres: "3",
    cuatro: "4",
    cinco: "5",
    seis: "6",
    siete: "7",
    ocho: "8",
    nueve: "9",
  };

  return text.replace(
    /\b(cero|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/gi,
    (match) => map[normalizeText(match)] || match
  );
};

const normalizeSpokenMoneyAndCodes = (text: string) => {
  return numberWordsToDigits(text)
    .replace(/\bvalo\s+r\b/gi, "valor")
    .replace(/\bpre\s+cio\b/gi, "precio")
    .replace(/\bc[oó]\s+digo\b/gi, "codigo")
    .replace(/\bUSB\b/gi, "USD")
    .replace(/\bUS B\b/gi, "USD")
    .replace(/\bdolares\b/gi, "USD")
    .replace(/\bdólares\b/gi, "USD")
    .replace(/\bpesos colombianos\b/gi, "COP")
    .replace(/\s+/g, " ")
    .trim();
};

const cleanKnownBusinessWords = (text: string) => {
  return text
    // Frases comunes mal transcritas de "cotización"
    .replace(/\bestaci[oó]n\b/ig, "")
    .replace(/\bconstaci[oó]n\b/ig, "")
    .replace(/\bcotizaci[oó]n\b/ig, "")
    .replace(/\bcotizacion\b/ig, "")

    // Variaciones comunes de IonCore por dictado
    .replace(/\bion\s+ion\s+core\b/ig, "")
    .replace(/\bion\s*core\b/ig, "")
    .replace(/\bioncore\b/ig, "")
    .replace(/\baion\s*core\b/ig, "")
    .replace(/\bay[oó]n\s*core\b/ig, "")
    .replace(/\ballon\s*core\b/ig, "")
    .replace(/\bjohn\s*corn\b/ig, "")
    .replace(/\byoung\s*core\b/ig, "")
    .replace(/\bhay\s+un\s+core\b/ig, "")
    .replace(/\bun\s+core\b/ig, "")
    .replace(/\byoung\b/ig, "")

    // Contacto de prueba / nombres detectados frecuentes
    .replace(/\bpara\s+sandra\s+garc[ií]a\b/ig, "")
    .replace(/\ba\s+sandra\s+garc[ií]a\b/ig, "")
    .replace(/\bsandra\s+garc[ií]a\b/ig, "")
    .replace(/\bsandra\s+garci\b/ig, "")
    .replace(/\bsandra\b/ig, "")
    .replace(/\bgarc[ií]a\b/ig, "")
    .replace(/\bgarci\b/ig, "")

    .replace(/\s+/g, " ")
    .trim();
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const removeEntityFromDescription = (value: string, entityName?: string) => {
  let cleaned = value;
  const entity = normalizeText(entityName || "");

  if (!entity) return cleaned;

  const ignored = ["sas", "s.a.s", "sa", "s.a", "ltda", "empresa", "grupo"];

  const words = entity
    .split(" ")
    .filter((word) => word.length > 1 && !ignored.includes(word));

  if (words.length > 1) {
    cleaned = cleaned.replace(
      new RegExp(`\\b${words.map(escapeRegExp).join("\\s+")}\\b`, "ig"),
      ""
    );
  }

  words.forEach((word) => {
    cleaned = cleaned.replace(new RegExp(`\\b${escapeRegExp(word)}\\b`, "ig"), "");
  });

  return cleaned.replace(/\s+/g, " ").trim();
};

const keepOnlyProductDescription = (value: string) => {
  const cleaned = value.trim();

  const productMatch = cleaned.match(
    /\b(o\s*ring|oring|filtro|columna\s+(?:de\s+)?hplc|columna\s+hplc|hplc|lampara|lámpara|kit|sello|cartucho|bomba|inyector|nebulizador|rotor|valvula|válvula|mantenimiento)\b/i
  );

  if (!productMatch) return cleaned;

  const start = productMatch.index || 0;
  let result = cleaned.slice(start);

  result = result.replace(
    /\b(?:sandra|garc[ií]a|ay[oó]n|allon|ion|core|ioncore|john|corn|young|codigo|c[oó]digo|cod|cantidad|cant|valor|precio|moneda|usd|cop|\$|llamar|seguimiento|agendar|recordar|enviar|hay que|toca)\b.*$/i,
    ""
  );

  return result.replace(/\s+/g, " ").trim();
};

const detectQuoteTypeFromPrompt = (text: string): QuoteType => {
  const t = normalizeText(text);

  if (/\bproducto\b/.test(t)) return "producto";
  if (/\bservicio\b/.test(t)) return "servicio";

  if (
    t.includes("mantenimiento") ||
    t.includes("diagnostico") ||
    t.includes("instalacion") ||
    t.includes("soporte") ||
    t.includes("capacitacion") ||
    t.includes("visita tecnica") ||
    t.includes("mano de obra")
  ) {
    return "servicio";
  }

  return "producto";
};

const detectCurrencyFromPrompt = (text: string): QuoteCurrency => {
  const t = normalizeText(text);

  // Prioridad 1: Dólares / USD
  if (
    t.includes("usd") ||
    t.includes("us$") ||
    t.includes("dolar") ||
    t.includes("dolares") ||
    t.includes("dollar") ||
    t.includes("dollars")
  ) {
    return "USD";
  }

  // Prioridad 2: Pesos / COP
  if (
    t.includes("peso") ||
    t.includes("pesos") ||
    t.includes("cop") ||
    t.includes("colombianos")
  ) {
    return "COP";
  }

  return "COP";
};

const detectPaymentTermsFromPrompt = (text: string) => {
  const t = normalizeText(text);

  if (t.includes("contado")) return "Contado.";
  if (t.includes("contra entrega")) return "Pago contra entrega.";
  if (t.includes("30 dias")) return "30 días después de enviada la factura.";
  if (t.includes("45 dias")) return "45 días después de enviada la factura.";
  if (t.includes("60 dias")) return "60 días después de enviada la factura.";
  if (t.includes("90 dias")) return "90 días después de enviada la factura.";
  if (t.includes("120 dias")) return "120 días después de enviada la factura.";

  return "";
};

const detectValidityFromPrompt = (text: string) => {
  const t = normalizeText(text);

  if (t.includes("15 dias")) return "15 días calendario.";
  if (t.includes("30 dias")) return "30 días calendario.";

  return "";
};

const extractQuantity = (text: string) => {
  const cleaned = normalizeSpokenMoneyAndCodes(text);

  const match =
    cleaned.match(/cantidad\s*[:\-]?\s*(\d+)/i) ||
    cleaned.match(/cant\s*[:\-]?\s*(\d+)/i) ||
    cleaned.match(/(?:unidad|unidades|uds|und)\s*[:\-]?\s*(\d+)/i) ||
    cleaned.match(/(\d+)\s*(unidades|unidad|uds|und|horas|dias|días)/i);

  if (match) {
    const value = Number(match[1]);
    return Number.isNaN(value) ? 1 : value;
  }

  return 1;
};

const extractCode = (text: string) => {
  let cleaned = normalizeSpokenMoneyAndCodes(text)
    .replace(/^\d+\)\s*/i, "")
    .trim();

  // Intentar extraer código del patrón "codigo X"
  const spokenDigitsMatch = cleaned.match(
    /(?:c[oó]digo|codigo|codig|cod|parte|pn|p\/n)\s*(?:es|son|n[uú]mero)?\s*[:\-]?\s*((?:\d\s*){2,})/i
  );

  if (spokenDigitsMatch?.[1]) {
    return spokenDigitsMatch[1].replace(/\s+/g, "").trim();
  }

  const explicitMatch = cleaned.match(
    /(?:c[oó]digo|codigo|codig|cod|parte|pn|p\/n)\s*(?:es|son|n[uú]mero)?\s*[:\-]?\s*([A-Za-z0-9._\-\/]+)/i
  );

  if (explicitMatch?.[1]) {
    return explicitMatch[1].trim();
  }

  // Si aún no se encuentra, intentar extraer el primer token que contenga dígitos
  const firstTokenMatch = cleaned.match(/^([\w.\-/]*\d[\w.\-/]*)\s+/);
  if (firstTokenMatch?.[1]) {
    return firstTokenMatch[1].trim();
  }

  // Último recurso: buscar cualquier número al inicio
  const firstNumber = cleaned.match(/^(\d+)/);
  if (firstNumber?.[1]) {
    return firstNumber[1];
  }

  return "";
};

const parseLocalizedAmount = (rawValue: string) => {
  let value = (rawValue || "").trim();

  value = value.replace(/[^\d.,]/g, "");

  if (!value) return 0;

  const hasDot = value.includes(".");
  const hasComma = value.includes(",");

  if (hasDot && hasComma) {
    const lastDot = value.lastIndexOf(".");
    const lastComma = value.lastIndexOf(",");

    if (lastComma > lastDot) {
      value = value.replace(/\./g, "").replace(",", ".");
    } else {
      value = value.replace(/,/g, "");
    }

    const result = Number(value);
    return Number.isNaN(result) ? 0 : result;
  }

  if (hasComma) {
    const parts = value.split(",");
    const lastPart = parts[parts.length - 1];

    const looksLikeThousands =
      parts.length > 2 ||
      (parts.length === 2 && lastPart.length === 3 && parts[0].length <= 3);

    if (looksLikeThousands) {
      value = value.replace(/,/g, "");
    } else {
      value = value.replace(",", ".");
    }

    const result = Number(value);
    return Number.isNaN(result) ? 0 : result;
  }

  if (hasDot) {
    const parts = value.split(".");
    const lastPart = parts[parts.length - 1];

    const looksLikeThousands =
      parts.length > 2 ||
      (parts.length === 2 && lastPart.length === 3 && parts[0].length <= 3);

    if (looksLikeThousands) {
      value = value.replace(/\./g, "");
    }

    const result = Number(value);
    return Number.isNaN(result) ? 0 : result;
  }

  const result = Number(value);
  return Number.isNaN(result) ? 0 : result;
};

const extractUnitPrice = (text: string, qty?: number, code?: string) => {
  const cleaned = normalizeSpokenMoneyAndCodes(text);

  const match =
    cleaned.match(
      /(?:precio|valor|valor\s+unitario|v\.?\s*unitario|unitario)\s*(?:es|son)?\s*[:\-]?\s*(?:us\$|usd|cop|\$)?\s*([\d.,]+)/i
    ) ||
    cleaned.match(/(?:us\$|usd|cop|\$)\s*([\d.,]+)/i) ||
    cleaned.match(/([\d.,]+)\s*(?:usd|cop|dolares|dólares|pesos)/i);

  if (match?.[1]) {
    return parseLocalizedAmount(match[1]);
  }

  // Fallback inteligente: buscar otros números si no hay coincidencia explícita de precio
  const numbers = cleaned.match(/\b\d+(?:[.,]\d+)?\b/g);
  if (numbers && numbers.length > 0) {
    for (let i = numbers.length - 1; i >= 0; i--) {
      const val = parseLocalizedAmount(numbers[i]);
      if (val > 0 && val !== qty && numbers[i] !== code) {
        return val;
      }
    }
  }

  return 0;
};

// ============================================================
// FIX PARSER IA: evitar ítems falsos desde encabezado / moneda
// ============================================================
// Palabras reservadas que NUNCA son un código real. Si aparecen justo
// después de "codigo", la línea es un encabezado/instrucción, no un ítem.
// (Se comparan en minúsculas y sin acentos, tal como devuelve normalizeText).
const RESERVED_ITEM_WORDS = new Set([
  "descripcion",
  "cantidad",
  "valor",
  "moneda",
  "usd",
  "dolar",
  "dolares",
  "cop",
  "peso",
  "pesos",
  "precio",
  "unitario",
  "producto",
  "servicio",
]);

// Encabezado de cotización o instrucción de moneda: no debe generar ítem.
// Ej: "cotizacion Bgreen cesar martinez moneda usd", "moneda pesos".
const isHeaderOrCurrencyLine = (line: string) => {
  const n = normalizeText(line);
  if (!n) return true;
  if (/^cotizaci?on\b/.test(n)) return true;
  if (/^moneda\b/.test(n)) return true;
  return false;
};

// Patrón inválido "codigo <palabra reservada>": no debe crear ítem.
// Ej: "codigo descripcion cantidad usd", "codigo usd", "codigo pesos".
const codeFollowedByReservedWord = (line: string) => {
  const n = normalizeText(line);
  const match = n.match(/\bcod(?:igo)?\b\s+([^\s]+)/);
  if (!match) return false;
  return RESERVED_ITEM_WORDS.has(match[1]);
};

// Verifica que un ítem tenga información mínima válida antes de agregarlo:
// código que no sea palabra reservada y descripción real (no placeholder)
// cuando no hay valor unitario.
const isValidParsedItem = (item: QuoteItem) => {
  const code = (item.code || "").trim();
  const description = (item.description || "").trim();
  const quantity = item.quantity || 0;
  const unitPrice = item.unitPrice || 0;

  // Validación:
  // - cantidad mayor a 0
  if (quantity <= 0) return false;
  // - valor unitario mayor a 0
  if (unitPrice <= 0) return false;

  // - Si hay descripción, no puede ser solo "Producto por definir" o "Servicio por definir"
  const descNorm = normalizeText(description);
  if (description && (descNorm === "producto por definir" || descNorm === "servicio por definir")) return false;

  // - Si hay código, no puede ser palabra reservada
  const codeNorm = normalizeText(code);
  if (code && RESERVED_ITEM_WORDS.has(codeNorm)) return false;

  return true;
};

const splitItemsFromPrompt = (text: string) => {
  // Encontrar todas las ocurrencias de "codigo" o "código" o "cod" válidas.
  // Un "codigo" es válido si no está seguido por una palabra reservada.
  const regex = /\bc[oó]d(?:ig[oó])?\b\s*(?:es|son|n[uú]mero)?\s*[:\-]?\s*([a-zA-Z0-9._\-\/]+)/gi;
  const matches: { index: number; code: string }[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const code = match[1];
    const codeNorm = normalizeText(code);
    if (!RESERVED_ITEM_WORDS.has(codeNorm)) {
      matches.push({ index: match.index, code });
    }
  }

  // Si hay al menos un código válido, hacemos split por estas posiciones.
  if (matches.length > 0) {
    const segments: string[] = [];
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      let segment = text.substring(start, end).trim();
      // Remover números de línea del siguiente ítem al final (ej: "2)" , "3)", etc.)
      segment = segment.replace(/\n\d+\)\s*$/, '').trim();
      segments.push(segment);
    }
    return segments;
  }

  // Si no hay códigos válidos con el prefijo "codigo", hacemos el fallback original por líneas.
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const itemLines = lines.filter((line) => {
    if (isHeaderOrCurrencyLine(line)) return false;
    if (codeFollowedByReservedWord(line)) return false;
    if (/^\d+\)/.test(line)) return true;
    if (/^[A-Za-z0-9][A-Za-z0-9._\-\/]{2,}\s+.+/.test(line)) return true;
    return false;
  });

  if (itemLines.length > 0) {
    return itemLines;
  }

  return [text.trim()];
};

const removeExplicitCodeFromDescription = (value: string) => {
  return value.replace(
    /(?:c[oó]digo|codigo|codig|cod|parte|pn|p\/n)\s*(?:es|son|n[uú]mero)?\s*[:\-]?\s*(?:\d+(?:\s+\d+)+|[A-Za-z0-9._\-\/]+)/ig,
    ""
  );
};

const extractDescription = (
  text: string,
  account?: AccountV2,
  contact?: ContactV2
) => {
  let cleaned = normalizeSpokenMoneyAndCodes(text);

  cleaned = cleanKnownBusinessWords(cleaned);

  cleaned = cleaned.replace(/^\d+\)\s*/i, "");

  cleaned = cleaned.replace(/\b[ií]tem\s*\d+\b[,\s.:;-]*/ig, "");

  cleaned = cleaned.replace(/^hola\b[,\s]*/ig, "");
  cleaned = cleaned.replace(/^c[oó]mo est[aá]s\b[,\s]*/ig, "");
  cleaned = cleaned.replace(/^mira\b[,\s]*/ig, "");
  cleaned = cleaned.replace(/\bhable\b/ig, "");
  cleaned = cleaned.replace(/\bhablé\b/ig, "");

  cleaned = cleaned.replace(/\bcotizaci[oó]n\b/ig, "");
  cleaned = cleaned.replace(/\bcotizacion\b/ig, "");
  cleaned = cleaned.replace(/\bcotizar\b/ig, "");
  cleaned = cleaned.replace(/\bproducto\b/ig, "");
  cleaned = cleaned.replace(/\bservicio\b/ig, "");
  cleaned = cleaned.replace(/\bnecesita\b/ig, "");
  cleaned = cleaned.replace(/\bnecesitan\b/ig, "");
  cleaned = cleaned.replace(/\bsolicita\b/ig, "");
  cleaned = cleaned.replace(/\bsolicitan\b/ig, "");
  cleaned = cleaned.replace(/\brequiere\b/ig, "");
  cleaned = cleaned.replace(/\brequieren\b/ig, "");

  // "moneda: usd/cop/dolares/pesos" es una declaración global de moneda,
  // no parte de la descripción del producto. Se corta todo desde "moneda"
  // en adelante (puede quedar pegada al último ítem del prompt).
  cleaned = cleaned.replace(/\bmoneda\b\s*[:\-]?\s*(?:usd|cop|dolares|dólares|pesos)?.*$/i, "");

  cleaned = removeEntityFromDescription(cleaned, account?.nombreComercial);
  cleaned = removeEntityFromDescription(cleaned, account?.razonSocial);
  cleaned = removeEntityFromDescription(cleaned, contact ? getContactDisplayName(contact) : "");

  cleaned = removeExplicitCodeFromDescription(cleaned);

  cleaned = cleaned.replace(/^([\w.\-/]*\d[\w.\-/]*)\s+/, "");

  cleaned = cleaned.replace(/cantidad\s*[:\-]?\s*(?:us\$|usd|cop|\$)?\s*[\d.,]+/ig, "");
  cleaned = cleaned.replace(/cantidad\s*[:\-]?\s*\d+/ig, "");
  cleaned = cleaned.replace(/cant\s*[:\-]?\s*\d+/ig, "");
  cleaned = cleaned.replace(/(?:propio|unidad|unidades|uds|und)\s*[:\-]?\s*\d+/ig, "");
  cleaned = cleaned.replace(/\d+\s*(?:unidad|unidades|uds|und)/ig, "");

  cleaned = cleaned.replace(
    /(?:precio|valor|valor\s+unitario|v\.?\s*unitario|unitario)\s*(?:es|son)?\s*[:\-]?\s*(?:us\$|usd|cop|\$)?\s*[\d.,]+/ig,
    ""
  );
  cleaned = cleaned.replace(/(?:us\$|usd|cop|\$)\s*[\d.,]+/ig, "");
  cleaned = cleaned.replace(/[\d.,]+\s*(?:usd|cop|dolares|dólares|pesos)/ig, "");

  cleaned = cleaned.replace(/\bUSD\b/ig, "");
  cleaned = cleaned.replace(/\bCOP\b/ig, "");
  cleaned = cleaned.replace(/\bUS\$\b/ig, "");
  cleaned = cleaned.replace(/\$/g, "");

  cleaned = cleaned.replace(
    /\b(?:y\s+)?(?:hay\s+que|toca|debo|debemos|llamar(?:le|la|lo)?|hacer seguimiento|seguimiento|agendar|recordar|revisar|enviar).*$/i,
    ""
  );

  cleaned = cleanKnownBusinessWords(cleaned);

  cleaned = removeEntityFromDescription(cleaned, account?.nombreComercial);
  cleaned = removeEntityFromDescription(cleaned, account?.razonSocial);
  cleaned = removeEntityFromDescription(cleaned, contact ? getContactDisplayName(contact) : "");

  cleaned = cleaned.replace(/\bpara\b/ig, "");
  cleaned = cleaned.replace(/\ba\b/ig, "");
  cleaned = cleaned.replace(/\bde\b\s*$/ig, "");
  cleaned = cleaned.replace(/\bla\b/ig, "");
  cleaned = cleaned.replace(/\bel\b/ig, "");
  cleaned = cleaned.replace(/\buna\b/ig, "");
  cleaned = cleaned.replace(/\bun\b/ig, "");

  cleaned = cleaned.replace(/\bdescripci[oó]n\b[,\s.:;-]*/ig, "");
  cleaned = cleaned.replace(/\bdesc\b[,\s.:;-]*/ig, "");

  cleaned = cleaned.replace(/^[,\s.:;-]+/g, "");
  cleaned = cleaned.replace(/[,\s.:;-]+$/g, "");
  cleaned = cleaned.replace(/,\s*/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  const productOnly = keepOnlyProductDescription(cleaned);

  cleaned = productOnly || cleaned;

  cleaned = cleanKnownBusinessWords(cleaned);
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned || "";
};

const detectProductDescriptionFromPrompt = (text: string) => {
  const t = normalizeText(text);

  const products = [
    "o ring",
    "oring",
    "filtro",
    "columna hplc",
    "columna de hplc",
    "hplc",
    "lampara",
    "lámpara",
    "kit",
    "sello",
    "cartucho",
    "bomba",
    "inyector",
    "nebulizador",
    "rotor",
    "valvula",
    "válvula",
    "mantenimiento"
  ];

  const found = products.find((product) => t.includes(normalizeText(product)));

  if (!found) return "";

  if (found === "oring") return "o ring";
  if (found === "columna de hplc") return "columna hplc";

  return found;
};

const findAccountFromPrompt = (text: string, accounts: AccountV2[]) => {
  const t = normalizeText(text);

  const explicitSegment =
    text.match(/(?:cotizacion|cotización)\s+(?:para|a nombre de|a)\s+([^,.\n]+)/i)?.[1] ||
    text.match(/(?:cliente|empresa|cuenta)\s*[:\-]?\s*([^,.\n]+)/i)?.[1] ||
    "";

  const explicit = normalizeText(explicitSegment);

  const ignoredWords = ["sas", "s.a.s", "ltda", "sa", "s.a", "empresa", "grupo"];

  let bestMatch: AccountV2 | undefined;
  let bestScore = 0;

  accounts.forEach((a) => {
    const commercial = normalizeText(a.nombreComercial || "");
    const legal = normalizeText(a.razonSocial || "");
    const initialsCommercial = buildInitials(a.nombreComercial || "");
    const initialsLegal = buildInitials(a.razonSocial || "");

    const candidates = [
      commercial,
      legal,
      initialsCommercial,
      initialsLegal
    ].filter(Boolean);

    candidates.forEach((candidate) => {
      const words = candidate
        .split(" ")
        .filter((word) => word.length > 2 && !ignoredWords.includes(word));

      let score = 0;

      if (explicit && candidate && explicit.includes(candidate)) {
        score = candidate.length + 500;
      } else if (candidate && t.includes(candidate)) {
        score = candidate.length + 300;
      } else {
        const matchedWords = words.filter((word) => t.includes(word));
        score = matchedWords.length * 40;

        const firstWord = words[0];
        if (firstWord && explicit.includes(firstWord)) score += 120;
        if (firstWord && t.includes(firstWord)) score += 80;
      }

      if (candidate && explicit.startsWith(candidate)) {
        score += 120;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = a;
      }
    });
  });

  return bestScore >= 40 ? bestMatch : undefined;
};

const getContactDisplayName = (contact: any) => {
  return (
    contact.fullName ||
    contact.name ||
    `${contact.firstName || ""} ${contact.lastName || ""}`.trim()
  );
};

const stripNamesFromDescription = (
  value: string,
  account?: AccountV2,
  contact?: ContactV2,
  prompt?: string
) => {
  if (!value) return value;

  let cleaned = value;

  const fullCandidates = [
    account?.nombreComercial || "",
    account?.razonSocial || "",
    contact ? getContactDisplayName(contact) : ""
  ].filter(Boolean);

  fullCandidates.forEach((candidate) => {
    if (candidate.length > 3) {
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      cleaned = cleaned.replace(new RegExp(escaped, "ig"), "");
    }
  });

  const contactWords = (contact ? getContactDisplayName(contact) : "")
    .split(" ")
    .map((w) => w.trim())
    .filter((w) => w.length > 2);

  contactWords.forEach((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(`\\b${escaped}\\b`, "ig"), "");
  });

  const companyWords = [
    ...(account?.nombreComercial || "").split(" "),
    ...(account?.razonSocial || "").split(" ")
  ]
    .map((w) => w.trim())
    .filter((w) => w.length > 4)
    .filter((w) => !["sas", "s.a.s", "ltda", "sa", "empresa", "grupo"].includes(normalizeText(w)));

  companyWords.forEach((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(`\\b${escaped}\\b`, "ig"), "");
  });

  if (prompt) {
    const normalizedPrompt = normalizeText(prompt);
    if (normalizedPrompt.startsWith("sgc ")) {
      cleaned = cleaned.replace(/\bsgc\b/ig, "");
    }
  }

  cleaned = cleaned.replace(/\bcotizacion\b/ig, "");
  cleaned = cleaned.replace(/\bcotización\b/ig, "");
  cleaned = cleaned.replace(/\bproducto\b/ig, "");
  cleaned = cleaned.replace(/\bservicio\b/ig, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
};

const findContactFromPromptLoose = (
  text: string,
  contacts: ContactV2[],
  allAccounts?: AccountV2[]
) => {
  const t = normalizeText(text);
  if (!t) return undefined;

  console.log("[FINDCONTACT DEBUG] Input text:", text, "normalized:", t);
  console.log("[FINDCONTACT DEBUG] Available contacts:", contacts.map(c => ({name: getContactDisplayName(c), id: c.id})));

  // Estrategia 1: si el texto tiene 3+ palabras, probablemente sea "Nombre Apellido Empresa"
  // Extraer solo las 2-3 primeras palabras como nombre de persona
  const words = t.split(" ").filter((w) => w.length > 2);
  let searchName = t;

  // Detect if extra words after name could be a company hint
  let companyHint = "";
  if (words.length > 2) {
    // Tomar las 2 primeras palabras (nombre + apellido típicamente)
    searchName = words.slice(0, 2).join(" ");
    // Words beyond the first 2 could be a company name hint
    companyHint = words.slice(2).join(" ");
  }

  console.log("[FINDCONTACT DEBUG] Search name:", searchName, "Company hint:", companyHint);

  let bestMatch: ContactV2 | undefined;
  let bestScore = 0;

  contacts.forEach((c: any) => {
    const name = normalizeText(getContactDisplayName(c));
    if (!name) return;

    const nameWords = name.split(" ").filter((word: string) => word.length > 2);

    let score = 0;

    // Match exacto
    if (searchName === name) {
      score = name.length + 600;
    }
    // searchName está completamente dentro del nombre del contacto
    else if (name.includes(searchName)) {
      score = searchName.length + 400;
    }
    // El nombre del contacto está dentro de searchName
    else if (searchName.includes(name)) {
      score = name.length + 350;
    }
    // Buscar palabras individuales coincidentes
    else {
      const searchWords = searchName.split(" ");
      const matchedWords = searchWords.filter((w: string) => nameWords.some((nw) => nw === w || nw.startsWith(w)));
      score = matchedWords.length * 50;

      // Bonus si las primeras palabras coinciden
      if (nameWords[0] && searchWords[0] === nameWords[0]) score += 100;
      if (nameWords[1] && searchWords[1] === nameWords[1]) score += 80;
    }

    // Company hint disambiguation: if there is a company hint and this contact
    // belongs to an account whose name matches the hint, boost the score significantly
    if (companyHint && allAccounts && c.accountId) {
      const contactAccount = allAccounts.find((a) => a.id === c.accountId);
      if (contactAccount) {
        const acctName = normalizeText(
          contactAccount.nombreComercial || contactAccount.razonSocial || ""
        );
        const hintWords = companyHint.split(" ").filter((w) => w.length > 2);
        const matchedHintWords = hintWords.filter((hw) => acctName.includes(hw));
        if (matchedHintWords.length > 0) {
          score += 500;
        }
      }
    }

    console.log(`[FINDCONTACT DEBUG] Contact "${getContactDisplayName(c)}" (${name}): score ${score}`);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = c;
    }
  });

  console.log("[FINDCONTACT DEBUG] Best match:", bestMatch ? getContactDisplayName(bestMatch) : "NONE", "score:", bestScore);
  return bestScore >= 30 ? bestMatch : undefined;
};

const findContactFromPrompt = (
  text: string,
  contacts: ContactV2[],
  accountId?: string
) => {
  const t = normalizeText(text);

  const explicitSegment =
    text.match(/(?:contacto|atencion|atención|dirigido a)\s*[:\-]?\s*([^,.\n]+)/i)?.[1] ||
    text.match(/(?:para|a nombre de|a)\s+([^,.\n]+?)\s+(?:de|del)\s+/i)?.[1] ||
    "";

  const explicit = normalizeText(explicitSegment);

  const candidates = accountId
    ? contacts.filter((c) => c.accountId === accountId)
    : contacts;

  let bestMatch: ContactV2 | undefined;
  let bestScore = 0;

  candidates.forEach((c: any) => {
    const name = normalizeText(getContactDisplayName(c));
    const nameWords = name.split(" ").filter((word) => word.length > 2);

    let score = 0;

    if (explicit && name && explicit.includes(name)) {
      score = name.length + 500;
    } else if (name && t.includes(name)) {
      score = name.length + 300;
    } else {
      const matchedWords = nameWords.filter((word) => t.includes(word));
      score = matchedWords.length * 35;

      const firstName = nameWords[0];
      if (firstName && explicit.includes(firstName)) score += 80;
      if (firstName && t.includes(firstName)) score += 60;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = c;
    }
  });

  return bestScore >= 35 ? bestMatch : undefined;
};

// ==========================================
// TÉRMINOS Y CONDICIONES POR DEFECTO
// ==========================================
const WATERMARK_URL = `${window.location.origin}/ioncore-watermark.png`;

const defaultProductTerms: QuoteTerms = {
  validityText: "15 días calendario. Enviar orden de compra a comercial@ioncore-sas.com",
  billingText: "La factura se entrega con el pedido.",
  paymentTermsText: "30 días después de enviada la factura.",
  paymentMethodText: "Si los valores de la cotización se expresan en dólares estadounidenses, la factura se liquidará a la TRM vigente el día de pago.\nConsignación bancaria Bancolombia cuenta de ahorros 186-000072-56 IonCore SAS.\nEnviar comprobante a comercial@ioncore-sas.com",
  deliveryPlaceText: "En sus instalaciones.",
  deliveryTimeText: "25 a 35 días después de recibida la orden de compra y en función de la disponibilidad de fábrica.",
  warrantyText: "30 días contados a partir de la fecha de entrega.",
  cancellationText: "Una vez recibida la orden de compra tendrá un plazo máximo de 2 días para la cancelación de la misma. La cancelación fuera de los términos establecidos generará un cargo correspondiente al 20% del valor total de la orden."
};

const defaultServiceTerms: QuoteTerms = {
  validityText: "15 días calendario. Enviar orden de compra a comercial@ioncore-sas.com",
  billingText: "Una vez finalizado el servicio se enviará la factura correspondiente.",
  paymentTermsText: "30 días después de enviada la factura.",
  paymentMethodText: "Consignación bancaria Bancolombia cuenta de ahorros 186-000072-56 IonCore SAS.\nEnviar comprobante a comercial@ioncore-sas.com",
  deliveryPlaceText: "En sus instalaciones.",
  deliveryTimeText: "10 días hábiles después de legalizada la orden de compra o según previo acuerdo con el cliente.",
  warrantyText: "30 días contados a partir de la fecha de ejecución.",
  cancellationText: "Una vez recibida la orden de compra tendrá un plazo máximo de 2 días para la cancelación de la misma."
};

const defaultNotes: QuoteNotes = {
  publicNotes: "La factura se liquidará a la TRM representativa del mercado el día del pago (aplica para negociaciones en USD).",
  technicalObservations: "",
  internalNotes: ""
};

const getEmptyQuoteDraft = (type: QuoteType = 'producto'): Partial<QuoteV2> => {
  const now = new Date();
  const validUntil = new Date(now);
  validUntil.setDate(validUntil.getDate() + 15);

  return {
    type,
    currency: "COP",
    status: "borrador",
    issueDate: toLocalDateKey(now),
    validUntil: toLocalDateKey(validUntil),
    items: [],
    terms: type === 'servicio' ? defaultServiceTerms : defaultProductTerms,
    notes: { ...defaultNotes },
    subtotal: 0,
    tax: 0,
    total: 0,
    version: 1
  };
};

const getQuoteStatusLabel = (status: QuoteStatus) => {
  switch (status) {
    case "borrador":
      return "Borrador";
    case "pendiente_costo_proveedor":
      return "Pendiente por costo del proveedor";
    case "revisada":
      return "Revisada";
    case "enviada":
      return "Enviada";
    case "con_oc":
      return "Con OC";
    case "rechazada":
      return "Rechazada";
    case "cancelada":
      return "Cancelada";
    case "vencida":
      return "Vencida";
    default:
      return status;
  }
};

const getQuoteStatusBadgeClass = (status: QuoteStatus) => {
  switch (status) {
    case "borrador":
      return "bg-slate-100 text-slate-700";
    case "pendiente_costo_proveedor":
      return "bg-amber-100 text-amber-700";
    case "revisada":
      return "bg-indigo-100 text-indigo-700";
    case "enviada":
      return "bg-blue-100 text-blue-700";
    case "con_oc":
      return "bg-emerald-100 text-emerald-700";
    case "rechazada":
      return "bg-rose-100 text-rose-700";
    case "cancelada":
      return "bg-red-100 text-red-700";
    case "vencida":
      return "bg-stone-100 text-stone-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

interface QuotesProps {
  activeUser: CRMUser;
  pendingQuoteData?: any;
  onClearPending?: () => void;
}

export default function Quotes({ activeUser, pendingQuoteData, onClearPending }: QuotesProps) {
  const [refresh, setRefresh] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [quotes, setQuotes] = useState<QuoteV2[]>([]);

  const accounts = useMemo(() => listAccountsByUser(activeUser), [refresh, activeUser]);
  const allContacts = useMemo(() => listContactsByUser(activeUser), [refresh, activeUser]);
  const opportunities = useMemo(() => listOpportunitiesByUser(activeUser), [refresh, activeUser]);

  // Refs to avoid stale closures in useEffect
  const accountsRef = useRef(accounts);
  const allContactsRef = useRef(allContacts);

  useEffect(() => { accountsRef.current = accounts; }, [accounts]);
  useEffect(() => { allContactsRef.current = allContacts; }, [allContacts]);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | "todos">("todos");

  // Filtros Avanzados
  const [accountFilter, setAccountFilter] = useState<string>("todos");
  const [contactFilter, setContactFilter] = useState<string>("todos");
  const [advisorFilter, setAdvisorFilter] = useState<string>("todos");
  const [dateStartFilter, setDateStartFilter] = useState<string>("");
  const [dateEndFilter, setDateEndFilter] = useState<string>("");
  const [viewTab, setViewTab] = useState<'activas' | 'historico' | 'todas'>('activas');
  const [visibleCount, setVisibleCount] = useState<number>(10);
  const [showKPIs, setShowKPIs] = useState(false);
  const [kpiSubTab, setKpiSubTab] = useState<'metrics' | 'targets'>('metrics');
  const [budgetPeriodType, setBudgetPeriodType] = useState<'mensual' | 'trimestral' | 'anual'>('mensual');
  const [budgetPeriod, setBudgetPeriod] = useState<string>(() => currentPeriod('mensual'));
  const [budgetCurrency, setBudgetCurrency] = useState<'COP' | 'USD'>('COP');
  const [selectedAdvisorDetailsId, setSelectedAdvisorDetailsId] = useState<string>('all');

  // TRM vigente, configurable por el director. Reemplaza los 4000 literales
  // que estaban repetidos por toda la página. `trmDraft` es lo que se está
  // tipeando; solo pasa a globalTRM al guardar, para que un campo a medio
  // escribir ("40") no recalcule todos los reportes en vivo.
  const [globalTRM, setGlobalTRM] = useState<number>(() => getTRM());
  const [trmDraft, setTrmDraft] = useState<string>(() => String(getTRM()));
  const [editingTRM, setEditingTRM] = useState(false);

  const commitTRM = () => {
    const parsed = parseFloat(trmDraft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      alert("La TRM debe ser un número mayor que cero.");
      return;
    }
    const saved = saveTRM(parsed);
    setGlobalTRM(saved.trmDefault);
    setTrmDraft(String(saved.trmDefault));
    setEditingTRM(false);
    // Fuerza el recálculo de los memos que dependen de refresh.
    setRefresh(r => r + 1);
  };
  const budgets = useMemo(() => listBudgets(), [refresh]);

  // Modal Rechazo Premium
  const [rejectionModal, setRejectionModal] = useState<{ quoteId: string } | null>(null);
  const [rejectionReasonText, setRejectionReasonText] = useState("");

  // Modal Orden de Compra (Con OC)
  const [showOCModal, setShowOCModal] = useState<{ quoteId: string } | null>(null);
  const [ocFormFechaOC, setOcFormFechaOC] = useState(todayLocal());
  const [ocFormTRM, setOcFormTRM] = useState(() => String(getTRM()));
  const [ocFormNumeroOC, setOcFormNumeroOC] = useState("");
  const [ocFormValorOC, setOcFormValorOC] = useState("");

  // Modal de Presupuestos para Director
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetFormAdvisorId, setBudgetFormAdvisorId] = useState("");
  const [budgetFormPeriodType, setBudgetFormPeriodType] = useState<'mensual' | 'trimestral' | 'anual'>('mensual');
  const [budgetFormPeriod, setBudgetFormPeriod] = useState(() => currentPeriod('mensual'));
  const [budgetFormCurrency, setBudgetFormCurrency] = useState<'COP' | 'USD'>('COP');
  const [budgetFormValue, setBudgetFormValue] = useState("");
  const [closeOppAsLost, setCloseOppAsLost] = useState(false);

  const users = useMemo(() => listUsers(), [refresh]);

  const [draft, setDraft] = useState<Partial<QuoteV2>>(getEmptyQuoteDraft('producto'));
  const [activeTab, setActiveTab] = useState<'general' | 'items' | 'condiciones' | 'observaciones'>('general');
  const [applyTax, setApplyTax] = useState(true);

  // Prellenar desde datos de Axis
  useEffect(() => {
    if (!pendingQuoteData) return;

    const newDraft = getEmptyQuoteDraft('producto');

    // Prellenar moneda
    if (pendingQuoteData.currency) {
      newDraft.currency = pendingQuoteData.currency === 'USD' ? 'USD' : 'COP';
    }

    // Prellenar items desde los datos extraídos
    if (pendingQuoteData.items && Array.isArray(pendingQuoteData.items)) {
      newDraft.items = pendingQuoteData.items.map((item: any) => ({
        id: `item_${Date.now()}_${Math.random()}`,
        code: item.code || '',
        description: item.description || '',
        quantity: item.quantity || 1,
        unitPrice: item.unitValue || 0,
        itemType: 'producto' as QuoteItemType,
      }));
    }

    // Intentar encontrar la empresa desde el nombre en los datos
    if (pendingQuoteData.client) {
      const foundAccount = accounts.find((a: AccountV2) => {
        const norm = (v: string) => (v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const targetNorm = norm(pendingQuoteData.client);
        return norm(a.razonSocial || '').includes(targetNorm) || norm(a.nombreComercial || '').includes(targetNorm);
      });
      if (foundAccount) {
        newDraft.accountId = foundAccount.id;
      }
    }

    // Intentar encontrar el contacto desde el nombre
    if (pendingQuoteData.contact) {
      const foundContact = allContacts.find((c: ContactV2) => {
        const norm = (v: string) => (v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const targetNorm = norm(pendingQuoteData.contact);
        return norm(c.fullName || '').includes(targetNorm) || norm(c.name || '').includes(targetNorm);
      });
      if (foundContact) {
        newDraft.contactId = foundContact.id;
      }
    }

    setDraft(newDraft);
    setShowModal(true);
    onClearPending?.();
  }, [pendingQuoteData, accounts, allContacts]);

  const canDelete = true;

  // Estados del asistente
  const [showAIHelper, setShowAIHelper] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMessage, setAiMessage] = useState("");
  const [aiExpanded, setAiExpanded] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [listeningStatus, setListeningStatus] = useState<'preparando' | 'hablando' | ''>('');
  const recognitionRef = useRef<any>(null);

  const handleToggleMic = () => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Tu navegador no soporta el reconocimiento de voz. Te recomendamos usar Google Chrome o Edge.");
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      return;
    }

    try {
      setListeningStatus('preparando');
      const rec = new SpeechRecognition();
      rec.lang = 'es-ES';
      rec.continuous = true;
      rec.interimResults = true;

      rec.onstart = () => {
        setListeningStatus('hablando');
        setIsListening(true);
      };

      rec.onresult = (event: any) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setAiPrompt(transcript);
      };

      rec.onend = () => {
        setIsListening(false);
        setListeningStatus('');
      };

      rec.onerror = (e: any) => {
        console.error("Error en reconocimiento de voz:", e);
        setIsListening(false);
        setListeningStatus('');
      };

      recognitionRef.current = rec;
      rec.start();
    } catch (err) {
      console.error("Error al iniciar micrófono:", err);
      setIsListening(false);
      setListeningStatus('');
    }
  };

  const handleCreateWithAI = (externalPrompt?: string, overrideAccounts?: AccountV2[], overrideContacts?: ContactV2[]) => {
    const prompt = (externalPrompt || aiPrompt).trim();
    if (!prompt) return;

    const activeAccounts = overrideAccounts || accounts;
    const activeContacts = overrideContacts || allContacts;

    setAiLoading(true);
    setAiMessage("");

    try {
      // ============================================================
      // DETECCIÓN DE FORMATO ESTRUCTURADO (desde Director Comercial)
      // ============================================================
      const isStructuredFormat =
        /c[oó]digo\s*:/i.test(prompt) &&
        (/cantidad\s*:/i.test(prompt) || /valor(?:\s*unitario)?\s*:/i.test(prompt));

      if (isStructuredFormat) {
        const clientMatch = prompt.match(/cliente\s*:\s*([^\r\n]*)/i);
        const clientName = clientMatch?.[1]?.trim() || "";

        const contactMatch = prompt.match(/contacto\s*:\s*([^\r\n]*)/i);
        const contactName = contactMatch?.[1]?.trim() || "";

        const currencyLine = prompt.match(/moneda\s*:\s*([^\r\n]*)/i);
        let detectedCurrency: QuoteCurrency = "COP";

        if (currencyLine) {
          detectedCurrency = detectCurrencyFromPrompt(currencyLine[1]);
        } else {
          detectedCurrency = detectCurrencyFromPrompt(prompt);
        }

        const itemBlocks = prompt.split(/[ií]tem\s*\d+\s*:/i).filter((block) => block.trim());
        const blocksToProcess = itemBlocks.length > 0 ? itemBlocks : [prompt];

        const items: QuoteItem[] = blocksToProcess
          .map((block) => {
            const codeMatch = block.match(/c[oó]digo\s*:\s*(.+?)(?:\r?\n|$)/i);
            const descMatch = block.match(/descripci[oó]n\s*:\s*(.+?)(?:\r?\n|$)/i);
            const qtyMatch = block.match(/cantidad\s*:\s*(.+?)(?:\r?\n|$)/i);
            const priceMatch = block.match(/valor(?:\s*unitario)?\s*:\s*(.+?)(?:\r?\n|$)/i);

            const code = codeMatch?.[1]?.trim() || "";
            const description = descMatch?.[1]?.trim() || "";
            const quantity = qtyMatch
              ? parseFloat(qtyMatch[1].trim().replace(/[^0-9.]/g, "")) || 1
              : 1;
            const unitPrice = priceMatch
              ? parseLocalizedAmount(priceMatch[1].trim())
              : 0;

            if (!code && !description && unitPrice === 0) return null;

            return {
              id: crypto.randomUUID(),
              itemType: "producto" as QuoteItemType,
              code,
              description: description || "Producto por definir",
              quantity,
              unit: "unidad" as QuoteUnit,
              currency: detectedCurrency,
              unitPrice,
              taxRate: 19,
              total: quantity * unitPrice,
            };
          })
          .filter(Boolean)
          .filter(isValidParsedItem) as QuoteItem[];

        // 1. Intentar encontrar la empresa directamente por nombre
        let account = clientName
          ? findAccountFromPrompt(clientName, activeAccounts)
          : undefined;

        // 2. Intentar encontrar el contacto por nombre
        let contact = contactName
          ? findContactFromPromptLoose(contactName, activeContacts, activeAccounts)
          : clientName
            ? findContactFromPromptLoose(clientName, activeContacts, activeAccounts)
            : undefined;

        // 3. Si encontramos contacto pero no empresa, deducir la empresa del contacto
        if (!account && contact?.accountId) {
          account = activeAccounts.find((a) => a.id === contact!.accountId);
        }

        // 4. Si tenemos empresa pero no contacto, buscar contacto asociado a esa empresa
        if (account && !contact) {
          contact = findContactFromPrompt(clientName || prompt, activeContacts, account.id);
        }

        // Si no encontramos contacto ni empresa pero tenemos clientName, crear datos temporales
        if (!account && !contact && clientName) {
          console.log("[QUOTES DEBUG] Creating fallback account/contact for:", clientName);
          
          // Extraer nombre de persona (primeras 2-3 palabras)
          const words = clientName.split(" ").filter(w => w.length > 2);
          const personName = words.slice(0, 2).join(" ");
          const companyName = words.slice(2).join(" ") || "Empresa pendiente";
          
          // Crear empresa temporal
          account = {
            id: "temp_" + Date.now(),
            ownerId: "",
            nombreComercial: companyName,
            razonSocial: companyName.toUpperCase(),
            nit: "PENDIENTE",
            ciudad: "Ciudad pendiente",
            direccion: "",
            sector: "Otros" as any,
            clasificacion: "A" as any,
            createdAt: new Date().toISOString()
          };
          
          // Crear contacto temporal
          contact = {
            id: "temp_contact_" + Date.now(),
            ownerId: "",
            accountId: account.id,
            fullName: personName,
            role: "Contacto pendiente",
            email: "pendiente@empresa.com",
            phone: "0000000000",
            whatsapp: "0000000000",
            createdAt: new Date().toISOString()
          };
          
          console.log("[QUOTES DEBUG] Created temporary account:", account.nombreComercial);
          console.log("[QUOTES DEBUG] Created temporary contact:", contact.fullName);
        }

        const detectedType = detectQuoteTypeFromPrompt(prompt);

        const nextTerms =
          detectedType === "servicio"
            ? { ...defaultServiceTerms }
            : { ...defaultProductTerms };

        // Aplicar todo el draft de una sola vez
        setDraft((prev) => ({
          ...prev,
          type: detectedType,
          currency: detectedCurrency,
          accountId: account?.id || "",
          contactId: contact?.id || "",
          opportunityId: "", // se creará en handleSave al guardar
          deliveryAddress: account?.direccion || "",
          deliveryCity: account?.ciudad || "",
          items: items.length > 0 ? items : [{
            id: crypto.randomUUID(),
            itemType: "producto" as QuoteItemType,
            code: "",
            description: "Producto por definir",
            quantity: 1,
            unit: "unidad" as QuoteUnit,
            currency: detectedCurrency,
            unitPrice: 0,
            total: 0,
            taxRate: 19,
          }],
          terms: nextTerms,
          notes: prev.notes || defaultNotes,
        }));

        const accountName = account?.nombreComercial || account?.razonSocial || "No detectada";
        const displayContactName = contact ? getContactDisplayName(contact as any) : "No detectado";

        setAiMessage(
          account
            ? `Borrador generado (formato Director). Cuenta: ${accountName}. Contacto: ${displayContactName}. Verifica y guarda para vincular la oportunidad al embudo.`
            : `Borrador generado sin empresa confiable. Cliente indicado: "${clientName}". Selecciónala manualmente.`
        );

        setAiLoading(false);

        return;
      }

      // ============================================================
      // FORMATO NATURAL / LIBRE (parser original — NO SE TOCA)
      // ============================================================
      const detectedType = detectQuoteTypeFromPrompt(prompt);
      const detectedCurrency = detectCurrencyFromPrompt(prompt);
      const detectedPayment = detectPaymentTermsFromPrompt(prompt);
      const detectedValidity = detectValidityFromPrompt(prompt);

      let account = findAccountFromPrompt(prompt, accounts);
      let contact = findContactFromPrompt(prompt, allContacts, account?.id);

      if (!account && contact?.accountId) {
        account = accounts.find((a) => a.id === contact.accountId);
      }

      if (account && contact && contact.accountId !== account.id) {
        contact = undefined;
      }

      if (account && !contact) {
        contact = findContactFromPrompt(prompt, allContacts, account.id);
      }

      const isService = detectedType === "servicio";

      const nextTerms =
        detectedType === "servicio"
          ? { ...defaultServiceTerms }
          : { ...defaultProductTerms };

      if (detectedPayment) {
        nextTerms.paymentTermsText = detectedPayment;
      }

      if (detectedValidity) {
        nextTerms.validityText = detectedValidity;
      }

      const itemBlocks = splitItemsFromPrompt(prompt);

      const items: QuoteItem[] = itemBlocks
        .map((block) => {
          const qty = extractQuantity(block);
          const itemCode = extractCode(block);
          const itemPrice = extractUnitPrice(block, qty, itemCode);

          const itemDescription = extractDescription(block, account, contact);
          const productFallback = detectProductDescriptionFromPrompt(block);

          const finalDescription =
            stripNamesFromDescription(
              itemDescription
                .replace(/^(para|a)\s+/i, "")
                .trim(),
              account,
              contact,
              block
            ) ||
            productFallback ||
            (isService ? "Servicio por definir" : "Producto por definir");

          return {
            id: crypto.randomUUID(),
            itemType: (isService ? "servicio" : "producto") as QuoteItemType,
            code: itemCode || "",
            description: finalDescription,
            quantity: qty,
            unit: (isService ? "servicio" : "unidad") as QuoteUnit,
            currency: detectedCurrency,
            unitPrice: itemPrice,
            total: qty * itemPrice,
            taxRate: 19
          };
        })
        .filter(isValidParsedItem);

      if (items.length === 0) {
        items.push({
          id: crypto.randomUUID(),
          itemType: isService ? "servicio" : "producto",
          code: "",
          description: isService ? "Servicio por definir" : "Producto por definir",
          quantity: 1,
          unit: isService ? "servicio" : "unidad",
          currency: detectedCurrency,
          unitPrice: 0,
          total: 0,
          taxRate: 19
        });
      }

      if (!account) {
        setAiMessage("No se detectó una empresa válida. Selecciónala manualmente antes de guardar.");
      }

      setDraft((prev) => ({
        ...prev,
        type: detectedType,
        currency: detectedCurrency,
        accountId: account?.id || "",
        contactId: contact?.id || "",
        opportunityId: "", // se creará en handleSave al guardar
        deliveryAddress: account?.direccion || "",
        deliveryCity: account?.ciudad || "",
        items,
        terms: nextTerms,
        notes: prev.notes || defaultNotes
      }));

      const accountName = account?.nombreComercial || account?.razonSocial || "No detectada";
      const contactName = contact ? getContactDisplayName(contact as any) : "No detectado";

      setAiMessage(
        account
          ? `Borrador generado. Cuenta: ${accountName}. Contacto: ${contactName}. Verifica y guarda para vincular la oportunidad al embudo.`
          : `Borrador generado sin empresa confiable. Selecciónala manualmente antes de guardar.`
      );
    } catch (error) {
      console.error(error);
      setAiMessage("Error al procesar la cotización con IA.");
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    const applyAxisQuotePrompt = (value?: string | null) => {
      const clean = (value || "").trim();
      if (!clean) return;
      resetQuoteDraft();
      setAiPrompt(clean);
      setShowAIHelper(true);
      setShowModal(true);
      setActiveTab("items");
      localStorage.removeItem("axis_quote_prompt");
      // ✅ Ejecutar parser automáticamente pasando el texto directo
      setTimeout(() => {
        handleCreateWithAI(clean, accountsRef.current, allContactsRef.current);
      }, 300);
    };

    // ✅ Revisar localStorage al cargar
    const storedPrompt = localStorage.getItem("axis_quote_prompt");
    if (storedPrompt) {
      applyAxisQuotePrompt(storedPrompt);
    }

    // ✅ Escuchar evento del Director Comercial
    const handleAxisCreateQuote = (event: Event) => {
      const customEvent = event as CustomEvent<{ prompt?: string }>;
      applyAxisQuotePrompt(customEvent.detail?.prompt);
    };

    window.addEventListener("axis:create-quote", handleAxisCreateQuote);

    return () => {
      window.removeEventListener("axis:create-quote", handleAxisCreateQuote);
    };
  }, []);

  const selectedContact = allContacts.find((c) => c.id === draft.contactId);
  const contactMobile = selectedContact?.whatsapp || selectedContact?.phone || "";
  const contactEmail = selectedContact?.email || "";

  const accountOpportunities = useMemo(() => {
    if (!draft.accountId) return [];

    // Si la cotización ya tiene una oportunidad asociada, mostrar únicamente esa opción
    if (draft.opportunityId) {
      const linked = opportunities.find((opp) => opp.id === draft.opportunityId);
      return linked ? [linked] : [];
    }

    // Si no está vinculada, no listamos otras oportunidades antiguas para evitar errores
    return [];
  }, [opportunities, draft.accountId, draft.opportunityId]);

  // Salvaguarda: si la oportunidad vinculada pertenece a una empresa distinta a la
  // seleccionada actualmente (p. ej. quedó de una cotización anterior reutilizada
  // por el asistente de IA), se desvincula automáticamente para que "Oportunidad
  // vinculada" vuelva a mostrar "Se creará nueva oportunidad al guardar".
  useEffect(() => {
    if (!draft.opportunityId) return;

    const linked = opportunities.find((opp) => opp.id === draft.opportunityId);
    if (linked && linked.accountId !== draft.accountId) {
      setDraft((prev) => ({ ...prev, opportunityId: "" }));
    }
  }, [draft.accountId, draft.opportunityId, opportunities]);

  const totals = useMemo(() => {
    const items = draft.items || [];
    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const tax = applyTax ? subtotal * 0.19 : 0;
    return { subtotal, tax, total: subtotal + tax };
  }, [draft.items, applyTax]);

  const handleCreateOpportunityFromQuote = () => {
    if (!draft.accountId) {
      setActiveTab("general");
      alert("Primero selecciona una empresa cliente.");
      return;
    }

    if (!draft.items?.length) {
      setActiveTab("items");
      alert("Primero agrega al menos un ítem a la cotización.");
      return;
    }

    const account = accounts.find((a) => a.id === draft.accountId);
    const firstItem = draft.items?.[0];

    const closeDate = new Date();
    closeDate.setDate(closeDate.getDate() + 30);

    const quoteId = draft.id || uid("qt");

    const opportunity = createOpportunity({
      titulo: `Cotización - ${
        firstItem?.description ||
        account?.nombreComercial ||
        account?.razonSocial ||
        "Nueva oportunidad"
      }`,
      etapa: "Cotización",
      accountId: draft.accountId,
      contactId: draft.contactId || undefined,
      ownerId: activeUser.id,
      valor: totals.total || 0,
      moneda: draft.currency || "COP",
      fechaEstimadaCierre: toLocalDateKey(closeDate),
      quoteId: quoteId,
    } as any);

    setDraft((prev) => ({
      ...prev,
      id: quoteId,
      opportunityId: opportunity.id,
    }));

    setRefresh((prev) => prev + 1);
    setActiveTab("general");
  };

  // La oportunidad NO se auto-selecciona. Cada cotización nueva obtiene
  // su propia oportunidad al guardar (handleSave). Si el usuario quiere
  // vincular a una existente, la elige manualmente en el dropdown.

  const quoteMissingFields = useMemo(() => {
    const missing: string[] = [];
    if (!draft.accountId) missing.push("Empresa cliente");
    if (!draft.items?.length) missing.push("Al menos un ítem");
    return missing;
  }, [draft.accountId, draft.items]);

  const canSaveQuote = quoteMissingFields.length === 0;

  useEffect(() => {
    setQuotes(listQuotesByUser(activeUser));
  }, [refresh, activeUser]);

  const filteredQuotes = useMemo(() => {
    return quotes.filter((q) => {
      // 1. Tab filter
      if (viewTab === 'activas') {
        const activeStatuses: QuoteStatus[] = ['borrador', 'pendiente_costo_proveedor', 'revisada', 'enviada'];
        if (!activeStatuses.includes(q.status)) return false;
      } else if (viewTab === 'historico') {
        const historyStatuses: QuoteStatus[] = ['con_oc', 'rechazada', 'cancelada', 'vencida'];
        if (!historyStatuses.includes(q.status)) return false;
      }

      // 2. Search Term filter
      const term = searchTerm.trim().toLowerCase();
      const account = accounts.find((a) => a.id === q.accountId);
      const contact = allContacts.find((c) => c.id === q.contactId);
      const owner = users.find((u) => u.id === q.ownerId);

      const accountName = account?.nombreComercial || account?.razonSocial || "";
      const contactName = (contact as any)?.fullName || (contact as any)?.name || "";
      const ownerName = owner?.name || "";

      const matchesSearch =
        !term ||
        (q.quoteNumber || "").toLowerCase().includes(term) ||
        q.type.toLowerCase().includes(term) ||
        q.currency.toLowerCase().includes(term) ||
        accountName.toLowerCase().includes(term) ||
        contactName.toLowerCase().includes(term) ||
        ownerName.toLowerCase().includes(term);

      if (!matchesSearch) return false;

      // 3. Status filter
      if (statusFilter !== "todos" && q.status !== statusFilter) return false;

      // 4. Account filter
      if (accountFilter !== "todos" && q.accountId !== accountFilter) return false;

      // 5. Contact filter
      if (contactFilter !== "todos" && q.contactId !== contactFilter) return false;

      // 6. Advisor/User filter
      if (advisorFilter !== "todos" && q.ownerId !== advisorFilter) return false;

      // 7. Date range filter
      if (dateStartFilter) {
        const start = new Date(dateStartFilter);
        const qDate = new Date(q.createdAt);
        if (qDate < start) return false;
      }
      if (dateEndFilter) {
        const end = new Date(dateEndFilter);
        end.setHours(23, 59, 59, 999);
        const qDate = new Date(q.createdAt);
        if (qDate > end) return false;
      }

      return true;
    });
  }, [quotes, viewTab, searchTerm, statusFilter, accountFilter, contactFilter, advisorFilter, dateStartFilter, dateEndFilter, accounts, allContacts, users]);

  const handlePrintProduct = (quote: QuoteV2) => {
    const acc = accounts.find(a => a.id === quote.accountId);
    const con = allContacts.find(c => c.id === quote.contactId);
    const printContactMobile = con?.whatsapp || con?.phone || "";

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>IonCore - Cotización ${quote.quoteNumber}</title>
          <style>
            @page { size: A4 portrait; margin: 1.5cm 1.5cm 3.2cm 1.5cm; }
            body {
              font-family: Arial, sans-serif;
              color: #243b53;
              margin: 0;
              padding: 0;
              font-size: 12px;
            }
            .watermark {
              position: fixed;
              top: 50%;
              left: 50%;
              width: 58%;
              max-width: 700px;
              transform: translate(-50%, -50%);
              opacity: 0.06;
              z-index: -1;
              pointer-events: none;
            }
            .page {
              position: relative;
              z-index: 1;
              padding: 10px 14px 10px 14px;
              box-sizing: border-box;
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              margin-bottom: 20px;
            }
            .logo {
              font-size: 44px;
              font-weight: 900;
              color: #173f8a;
              margin: 0;
            }
            .slogan {
              font-size: 11px;
              letter-spacing: 3px;
              color: #6b7280;
              font-weight: 700;
              text-transform: uppercase;
              margin-top: 6px;
            }
            .quote-box {
              text-align: right;
            }
            .quote-box h2 {
              margin: 0;
              font-size: 16px;
              color: #333;
            }
            .quote-number {
              font-size: 24px;
              font-weight: 900;
              color: #173f8a;
              margin: 8px 0;
            }
            .line {
              border-top: 3px solid #333;
              margin: 18px 0 28px 0;
            }
            .info-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 16px;
              margin-bottom: 24px;
            }
            .info-card {
              border: 1px solid #d8dee9;
              border-radius: 12px;
              padding: 14px;
            }
            .info-card h3 {
              margin: 0 0 12px 0;
              font-size: 12px;
              text-transform: uppercase;
              font-weight: 900;
              color: #222;
              border-bottom: 1px solid #e5e7eb;
              padding-bottom: 8px;
            }
            .info-line {
              margin: 5px 0;
              font-size: 12px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 18px;
              margin-bottom: 24px;
            }
            th {
              background: #233fa3;
              color: white;
              padding: 10px;
              font-size: 11px;
              text-transform: uppercase;
              text-align: left;
            }
            td {
              padding: 10px;
              border-bottom: 1px solid #e5e7eb;
              vertical-align: top;
            }
            .right { text-align: right; }
            .center { text-align: center; }
            .totals {
              width: 320px;
              margin-left: auto;
              margin-bottom: 28px;
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .total-row {
              display: flex;
              justify-content: space-between;
              padding: 6px 0;
              font-size: 13px;
            }
            .grand-total {
              border-top: 3px solid #333;
              margin-top: 8px;
              padding-top: 10px;
              font-size: 18px;
              font-weight: 900;
              color: #173f8a;
            }
            .section-title {
              margin-top: 22px;
              margin-bottom: 10px;
              font-size: 14px;
              font-weight: 900;
              color: #1f2937;
            }
            .terms-table {
              width: 100%;
              border-collapse: collapse;
              break-inside: auto;
              page-break-inside: auto;
            }
            .terms-table tr {
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .terms-table td {
              border: 1px solid #dbe3ef;
              padding: 10px;
              vertical-align: top;
            }
            .terms-label {
              width: 170px;
              font-weight: 900;
              color: #1f2937;
            }
            .notes-box,
            .signature,
            .footer-inline {
              page-break-inside: avoid;
              break-inside: avoid;
            }
            .notes-box {
              margin-top: 12px;
              padding: 12px;
              border-left: 4px solid #173f8a;
              background: #f8fafc;
              font-style: italic;
            }
            .signature {
              width: 280px;
              border-top: 2px solid #333;
              text-align: center;
              padding-top: 8px;
              margin-top: 16px;
              page-break-inside: avoid;
            }
            .footer-inline {
              margin-top: 26px;
              padding-top: 10px;
              text-align: center;
              font-size: 9px;
              color: #6b7280;
            }
            .muted { color: #6b7280; }
          </style>
        </head>
        <body>
          <img src="${WATERMARK_URL}" class="watermark" />
          <div class="page">
            <div class="header">
              <div>
                <div class="logo">IonCore</div>
                <div class="slogan">SOLUCIONES PARA NECESIDADES ANALÍTICAS</div>
              </div>
              <div class="quote-box">
                <h2>COTIZACIÓN COMERCIAL</h2>
                <div class="quote-number">${quote.quoteNumber}</div>
                <div>Fecha de Emisión: ${quote.issueDate || ""}</div>
                <div style="margin-top:10px;font-weight:700;">Moneda: ${quote.currency}</div>
              </div>
            </div>

            <div class="line"></div>

            <div class="info-grid">
              <div class="info-card">
                <h3>INFORMACIÓN DEL CLIENTE</h3>
                <div class="info-line"><strong>${acc?.nombreComercial || acc?.razonSocial || ""}</strong></div>
                <div class="info-line">NIT: ${acc?.nit || ""}</div>
                <div class="info-line">Contacto: ${con?.fullName || ""}</div>
                <div class="info-line">Teléfono: ${printContactMobile || "No registrado"}</div>
                <div class="info-line">Correo: ${con?.email || "No registrado"}</div>
                <div class="info-line">Dirección de entrega: ${quote.deliveryAddress || acc?.direccion || ""}</div>
                <div class="info-line">Ciudad: ${quote.deliveryCity || acc?.ciudad || ""}</div>
                <div class="info-line">Válido hasta: ${quote.validUntil || ""}</div>
              </div>

              <div class="info-card">
                <h3>PROVEEDOR</h3>
                <div class="info-line"><strong>${quote.providerName || "IONCORE SAS"}</strong></div>
                <div class="info-line">NIT: 901.900.030-1</div>
                <div class="info-line">Contacto: ${(quote as any).providerContact || "Sandra Garcia"}</div>
                <div class="info-line">Teléfono: ${(quote as any).providerPhone || "3018299110"}</div>
                <div class="info-line">Correo: ${(quote as any).providerEmail || "comercial@ioncore-sas.com"}</div>
                <div class="info-line">Dirección: ${(quote as any).providerAddress || "Carrera 21 #51-70"}</div>
                <div class="info-line">Ciudad: ${(quote as any).providerCity || "Bogotá"}</div>
              </div>
            </div>

            <div style="margin-bottom:14px;">Gracias por su confianza. Enviamos nuestra propuesta comercial, preparada para responder a sus necesidades.</div>

            <table>
              <thead>
                <tr>
                  <th>Ítem</th>
                  <th>Código</th>
                  <th>Detalle</th>
                  <th class="center">Cant.</th>
                  <th class="right">Valor Unitario (${quote.currency})</th>
                  <th class="right">Total (${quote.currency})</th>
                </tr>
              </thead>
              <tbody>
                ${(quote.items || []).map((item, index) => `
                  <tr>
                    <td class="center">${index + 1}</td>
                    <td>${item.code || ""}</td>
                    <td>${item.description || ""}</td>
                    <td class="center">${item.quantity || 0}</td>
                    <td class="right">${formatMoneyByCurrency(item.unitPrice || 0, quote.currency)}</td>
                    <td class="right"><strong>${formatMoneyByCurrency(item.total || 0, quote.currency)}</strong></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>

            <div class="totals">
              <div class="total-row"><span>Subtotal</span><span>${formatMoneyByCurrency(quote.subtotal || 0, quote.currency)}</span></div>
              <div class="total-row"><span>IVA</span><span>${formatMoneyByCurrency(quote.tax || 0, quote.currency)}</span></div>
              <div class="total-row grand-total"><span>TOTAL NETO:</span><span>${formatMoneyByCurrency(quote.total || 0, quote.currency)}</span></div>
            </div>

            <div class="section-title" style="margin-top:20px;">CONDICIONES COMERCIALES</div>
            <table class="terms-table" style="margin-bottom:14px;">
              <tr><td class="label">Validez de la oferta:</td><td>${quote.terms?.validityText || ""}</td></tr>
              <tr><td class="label">Facturación:</td><td>${quote.terms?.billingText || ""}</td></tr>
              <tr><td class="label">Términos de pago:</td><td>${quote.terms?.paymentTermsText || ""}</td></tr>
              <tr><td class="label">Forma de pago:</td><td>${quote.terms?.paymentMethodText || ""}</td></tr>
              <tr><td class="label">Lugar de entrega:</td><td>${quote.terms?.deliveryPlaceText || ""}</td></tr>
              <tr><td class="label">Tiempo de entrega:</td><td>${quote.terms?.deliveryTimeText || ""}</td></tr>
              <tr><td class="label">Garantía:</td><td>${quote.terms?.warrantyText || ""}</td></tr>
              <tr><td class="label">Cancelación:</td><td>${quote.terms?.cancellationText || ""}</td></tr>
            </table>

            ${quote.notes?.publicNotes ? `
              <div class="notes-box">
                <strong>Observaciones Generales:</strong><br/>
                <span style="white-space: pre-wrap;">${quote.notes.publicNotes}</span>
              </div>
            ` : ""}

            <div class="signature">
              <div style="font-weight:900;font-size:16px;">Andrés Marín</div>
              <div class="muted" style="font-size:12px; text-transform:uppercase; letter-spacing:1px;">Market Growth Specialist</div>
            </div>

            <div class="footer-inline" style="margin-top:16px; text-align:center; font-size:9px; color:#6b7280;">
              Carrera 21 #51-70 Bogotá, Colombia &nbsp;&nbsp;&nbsp; +57 301 8299110 &nbsp;&nbsp;&nbsp; www.ioncore-sas.com
            </div>
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  const handlePrintService = (quote: QuoteV2) => {
    const acc = accounts.find(a => a.id === quote.accountId);
    const con = allContacts.find(c => c.id === quote.contactId);
    const printContactMobile = con?.whatsapp || con?.phone || "";

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>IonCore - Cotización ${quote.quoteNumber}</title>
          <style>
            @page { size: A4 portrait; margin: 1.5cm 1.5cm 3.2cm 1.5cm; }
            body {
              font-family: Georgia, serif;
              color: #183153;
              margin: 0;
              padding: 0;
              font-size: 12px;
              line-height: 1.4;
            }
            .watermark {
              position: fixed;
              top: 50%;
              left: 50%;
              width: 58%;
              max-width: 700px;
              transform: translate(-50%, -50%);
              opacity: 0.06;
              z-index: -1;
              pointer-events: none;
            }
            .page {
              position: relative;
              z-index: 1;
              padding: 10px 14px 10px 14px;
              box-sizing: border-box;
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              margin-bottom: 20px;
            }
            .logo {
              font-size: 52px;
              color: #183153;
              margin: 0;
              font-weight: 500;
            }
            .slogan {
              color: #4f46e5;
              font-style: italic;
              font-size: 15px;
              margin-top: 6px;
            }
            .quote-box {
              text-align: right;
            }
            .quote-box h2 {
              margin: 0;
              font-size: 16px;
              color: #333;
            }
            .quote-number {
              font-size: 24px;
              font-weight: 900;
              color: #173f8a;
              margin: 8px 0;
            }
            .line {
              border-top: 3px solid #333;
              margin: 18px 0 28px 0;
            }
            .info-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 16px;
              margin-bottom: 24px;
            }
            .info-card {
              border: 1px solid #d8dee9;
              border-radius: 12px;
              padding: 14px;
            }
            .info-card h3 {
              margin: 0 0 12px 0;
              font-size: 12px;
              text-transform: uppercase;
              font-weight: 900;
              color: #222;
              border-bottom: 1px solid #e5e7eb;
              padding-bottom: 8px;
            }
            .info-line {
              margin: 5px 0;
              font-size: 12px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 18px;
              margin-bottom: 24px;
            }
            th {
              background: #1e40af;
              color: white;
              padding: 10px;
              font-size: 11px;
              text-transform: uppercase;
              text-align: left;
            }
            td {
              padding: 10px;
              border-bottom: 1px solid #e5e7eb;
              vertical-align: top;
            }
            .right { text-align: right; }
            .center { text-align: center; }
            .totals {
              width: 300px;
              margin-left: auto;
              margin-top: 10px;
              margin-bottom: 18px;
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .total-row {
              display: flex;
              justify-content: space-between;
              padding: 5px 0;
            }
            .total-strong {
              font-weight: 900;
              font-size: 18px;
              color: #183153;
            }
            .section-title {
              margin-top: 18px;
              margin-bottom: 10px;
              font-size: 14px;
              font-weight: 900;
              color: #1f2937;
            }
            .cond-table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
              break-inside: auto;
              page-break-inside: auto;
            }
            .cond-table tr {
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .cond-table td {
              border: 1px solid #d8dee9;
              padding: 8px 10px;
              vertical-align: top;
            }
            .terms-label {
              width: 180px;
              font-weight: 900;
            }
            .notes-box,
            .signature,
            .footer-inline {
              page-break-inside: avoid;
              break-inside: avoid;
            }
            .notes-box {
              margin-top: 12px;
              padding: 12px;
              border-left: 4px solid #1e40af;
              background: #f8fafc;
              font-style: italic;
            }
            .signature {
              width: 280px;
              border-top: 2px solid #333;
              text-align: center;
              padding-top: 8px;
              margin-top: 12px;
              page-break-inside: avoid;
            }
            .footer-inline {
              margin-top: 26px;
              padding-top: 10px;
              text-align: center;
              font-size: 9px;
              color: #6b7280;
            }
            .muted { color: #6b7280; }
          </style>
        </head>
        <body>
          <img src="${WATERMARK_URL}" class="watermark" />
          <div class="page">
            <div class="header">
              <div>
                <div class="logo">IonCore</div>
                <div class="slogan">SOLUCIONES PARA NECESIDADES ANALÍTICAS</div>
              </div>
              <div class="quote-box">
                <h2>COTIZACIÓN COMERCIAL</h2>
                <div class="quote-number">${quote.quoteNumber}</div>
                <div>Fecha de Emisión: ${quote.issueDate || ""}</div>
                <div style="margin-top:10px;font-weight:700;">Moneda: ${quote.currency}</div>
              </div>
            </div>

            <div class="line"></div>

            <div class="info-grid">
              <div class="info-card">
                <h3>INFORMACIÓN DEL CLIENTE</h3>
                <div class="info-line"><strong>${acc?.nombreComercial || acc?.razonSocial || ""}</strong></div>
                <div class="info-line">NIT: ${acc?.nit || ""}</div>
                <div class="info-line">Contacto: ${con?.fullName || ""}</div>
                <div class="info-line">Teléfono: ${printContactMobile || "No registrado"}</div>
                <div class="info-line">Correo: ${con?.email || "No registrado"}</div>
                <div class="info-line">Dirección de entrega: ${quote.deliveryAddress || acc?.direccion || ""}</div>
                <div class="info-line">Ciudad: ${quote.deliveryCity || acc?.ciudad || ""}</div>
                <div class="info-line">Válido hasta: ${quote.validUntil || ""}</div>
              </div>

              <div class="info-card">
                <h3>PROVEEDOR</h3>
                <div class="info-line"><strong>${quote.providerName || "IONCORE SAS"}</strong></div>
                <div class="info-line">NIT: 901.900.030-1</div>
                <div class="info-line">Contacto: ${(quote as any).providerContact || "Sandra Garcia"}</div>
                <div class="info-line">Teléfono: ${(quote as any).providerPhone || "3018299110"}</div>
                <div class="info-line">Correo: ${(quote as any).providerEmail || "comercial@ioncore-sas.com"}</div>
                <div class="info-line">Dirección: ${(quote as any).providerAddress || "Carrera 21 #51-70"}</div>
                <div class="info-line">Ciudad: ${(quote as any).providerCity || "Bogotá"}</div>
              </div>
            </div>

            <div style="margin-bottom:14px;">Gracias por su confianza. Enviamos nuestra propuesta comercial, preparada para responder a sus necesidades.</div>

            <table class="items">
              <thead>
                <tr>
                  <th>Ítem</th>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th class="center">Cant. (${quote.items?.[0]?.unit || "servicio"})</th>
                  <th class="right">Valor Unitario (${quote.currency})</th>
                  <th class="right">Total (${quote.currency})</th>
                </tr>
              </thead>
              <tbody>
                ${(quote.items || []).map((item, index) => `
                  <tr>
                    <td class="center">${index + 1}</td>
                    <td>${item.code || ""}</td>
                    <td>${item.description || ""}</td>
                    <td class="center">${item.quantity || 0}</td>
                    <td class="right">${formatMoneyByCurrency(item.unitPrice || 0, quote.currency)}</td>
                    <td class="right"><strong>${formatMoneyByCurrency(item.total || 0, quote.currency)}</strong></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>

            <div class="totals">
              <div class="total-row"><span>Subtotal</span><span>${formatMoneyByCurrency(quote.subtotal || 0, quote.currency)}</span></div>
              <div class="total-row"><span>IVA</span><span>${formatMoneyByCurrency(quote.tax || 0, quote.currency)}</span></div>
              <div class="total-row total-strong"><span>Total</span><span>${formatMoneyByCurrency(quote.total || 0, quote.currency)}</span></div>
            </div>

            ${quote.notes?.technicalObservations ? `
              <div class="section-title">Observaciones Técnicas y Requisitos</div>
              <div class="notes-box" style="margin-top: 12px; padding: 12px; border-left: 4px solid #f59e0b; background: #f8fafc; font-style: italic;">
                <span style="white-space: pre-wrap;">${quote.notes.technicalObservations}</span>
              </div>
            ` : ""}

            <div class="section-title" style="margin-top:20px;">CONDICIONES COMERCIALES</div>
            <table class="cond-table" style="margin-bottom:14px;">
              <tr><td class="label">Validez de la oferta:</td><td>${quote.terms?.validityText || ""}</td></tr>
              <tr><td class="label">Facturación:</td><td>${quote.terms?.billingText || ""}</td></tr>
              <tr><td class="label">Términos de pago:</td><td>${quote.terms?.paymentTermsText || ""}</td></tr>
              <tr><td class="label">Forma de pago:</td><td>${quote.terms?.paymentMethodText || ""}</td></tr>
              <tr><td class="label">Lugar de ejecución:</td><td>${quote.terms?.deliveryPlaceText || ""}</td></tr>
              <tr><td class="label">Tiempo de ejecución:</td><td>${quote.terms?.deliveryTimeText || ""}</td></tr>
              <tr><td class="label">Garantía:</td><td>${quote.terms?.warrantyText || ""}</td></tr>
              <tr><td class="label">Cancelación:</td><td>${quote.terms?.cancellationText || ""}</td></tr>
            </table>

            ${quote.notes?.publicNotes ? `
              <div class="notes-box" style="margin-top: 12px; padding: 12px; border-left: 4px solid #1e40af; background: #f8fafc; font-style: italic;">
                <strong>Nota visible al cliente:</strong><br/>
                <span style="white-space: pre-wrap;">${quote.notes.publicNotes}</span>
              </div>
            ` : ""}

            <div class="signature">
              <div style="font-weight:900;font-size:16px;">Andrés Marín</div>
              <div class="muted" style="font-size:12px; text-transform:uppercase; letter-spacing:1px;">Market Growth Specialist</div>
            </div>

            <div class="footer-inline" style="margin-top:16px; text-align:center; font-size:9px; color:#6b7280;">
              Carrera 21 #51-70 Bogotá, Colombia &nbsp;&nbsp;&nbsp; +57 301 8299110 &nbsp;&nbsp;&nbsp; www.ioncore-sas.com
            </div>
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  const handlePrint = (quote: QuoteV2) => {
    if (quote.type === "servicio") {
      handlePrintService(quote);
    } else {
      handlePrintProduct(quote);
    }
  };

  const handleDuplicateQuote = (quoteId: string) => {
    duplicateQuote(quoteId);
    setRefresh((prev) => prev + 1);
  };

  const handleStatusChange = (quoteId: string, status: QuoteStatus) => {
    if (status === "rechazada") {
      setRejectionModal({ quoteId });
      setRejectionReasonText("");
      setCloseOppAsLost(false);
    } else if (status === "con_oc") {
      const q = quotes.find(item => item.id === quoteId);
      setShowOCModal({ quoteId });
      setOcFormFechaOC(q?.fechaOC || todayLocal());
      // Si la OC ya tenía una TRM congelada se respeta; si no, se propone la vigente.
      setOcFormTRM(q?.trmAplicada ? String(q.trmAplicada) : String(globalTRM));
      setOcFormNumeroOC(q?.numeroOC || "");
      setOcFormValorOC(q?.valorOC ? String(q.valorOC) : (q?.total ? String(q.total) : ""));
    } else {
      updateQuoteStatus(quoteId, status);
      setRefresh((prev) => prev + 1);
    }
  };

  const handleConfirmOC = () => {
    if (!showOCModal) return;
    const trm = parseFloat(ocFormTRM);
    if (isNaN(trm) || trm <= 0) {
      alert("Por favor, ingresa una TRM válida mayor a 0.");
      return;
    }
    if (!ocFormFechaOC) {
      alert("Por favor, selecciona la fecha de la Orden de Compra.");
      return;
    }
    const valOC = parseFloat(ocFormValorOC);

    updateQuoteStatus(
      showOCModal.quoteId,
      "con_oc",
      undefined,
      false,
      ocFormFechaOC,
      trm,
      ocFormNumeroOC.trim() || undefined,
      Number.isFinite(valOC) ? valOC : undefined
    );

    setShowOCModal(null);
    setRefresh((prev) => prev + 1);
  };

  const prepopulateBudgetValue = (advId: string, type: 'mensual' | 'trimestral' | 'anual', period: string, currency: 'COP' | 'USD') => {
    const existing = budgets.find(b => b.advisorId === advId && b.periodo === period && b.tipoPeriodo === type);
    if (existing) {
      const mMeta = existing.monedaMeta || 'COP';
      if (mMeta === currency && existing.presupuestoAsignado !== undefined) {
        setBudgetFormValue(String(existing.presupuestoAsignado));
      } else {
        const val = currency === 'COP' ? existing.presupuestoCOP : existing.presupuestoUSD;
        setBudgetFormValue(String(val));
      }
    } else {
      setBudgetFormValue('');
    }
  };

  const handleSaveBudget = () => {
    if (activeUser.role !== 'director') {
      alert("Solo el Director Comercial puede gestionar metas");
      return;
    }
    if (!budgetFormAdvisorId) {
      alert("Por favor, selecciona un asesor comercial.");
      return;
    }
    const val = parseFloat(budgetFormValue);
    if (isNaN(val) || val < 0) {
      alert("Por favor, ingresa un presupuesto válido (número positivo).");
      return;
    }

    const existingIndex = budgets.findIndex(b => b.advisorId === budgetFormAdvisorId && b.periodo === budgetFormPeriod && b.tipoPeriodo === budgetFormPeriodType);

    const budgetId = existingIndex !== -1 ? budgets[existingIndex].id : `bd_${budgetFormAdvisorId}_${budgetFormPeriodType}_${budgetFormPeriod}_${Date.now()}`;

    // El rango se recalcula siempre, incluso al editar una meta ya guardada:
    // las metas creadas antes de este fix arrastran fechas inválidas
    // ("2026-02-31", "2026-Q3-31", "2026-31") y conservarlas propagaría el error.
    const bounds = periodBounds(budgetFormPeriod, budgetFormPeriodType);
    if (!bounds) {
      alert("El periodo seleccionado no es válido.");
      return;
    }

    const budgetData: AdvisorBudgetV2 = {
      id: budgetId,
      advisorId: budgetFormAdvisorId,
      periodo: budgetFormPeriod,
      tipoPeriodo: budgetFormPeriodType,
      presupuestoCOP: budgetFormCurrency === 'COP' ? val : val * globalTRM,
      presupuestoUSD: budgetFormCurrency === 'USD' ? val : val / globalTRM,
      fechaInicio: bounds.fechaInicio,
      fechaFin: bounds.fechaFin,
      monedaMeta: budgetFormCurrency,
      presupuestoAsignado: val
    };

    try {
      saveBudget(budgetData);
      setShowBudgetModal(false);
      setRefresh(r => r + 1);
      alert("Meta guardada exitosamente.");
    } catch (err: any) {
      alert(err.message || "Error al guardar la meta.");
    }
  };

  const resetAIQuoteHelper = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
    setIsListening(false);
    setListeningStatus('');
    setShowAIHelper(false);
    setAiPrompt("");
    setAiLoading(false);
    setAiMessage("");
    setAiExpanded(false);
  };

  const resetQuoteDraft = () => {
    setDraft(getEmptyQuoteDraft("producto"));
    setApplyTax(true);
    setActiveTab("general");
  };

  const handleAddItem = () => {
    const isService = draft.type === "servicio";
    const newItem: QuoteItem = {
      id: crypto.randomUUID(),
      itemType: isService ? "servicio" : "producto",
      code: "",
      description: "",
      quantity: 1,
      unit: isService ? "hora" : "unidad",
      currency: (draft.currency || "COP") as QuoteCurrency,
      unitPrice: 0,
      total: 0,
      taxRate: 19,
      serviceMode: isService ? "fijo" : undefined
    };
    setDraft({ ...draft, items: [...(draft.items || []), newItem] });
  };

  const handleItemChange = (id: string, field: keyof QuoteItem, value: any) => {
    const items = [...(draft.items || [])];
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) return;

    const item = { ...items[idx], [field]: value };
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPrice) || 0;
    item.total = qty * price;
    items[idx] = item;

    setDraft({ ...draft, items });
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    const missing: string[] = [];

    if (!draft.accountId) missing.push("Empresa cliente");
    if (!draft.items?.length) missing.push("Al menos un ítem");

    if (missing.length > 0) {
      alert(`Faltan campos obligatorios:\n- ${missing.join("\n- ")}`);
      return;
    }

    const quoteId = draft.id || uid("qt");
    let finalOpportunityId = draft.opportunityId || "";

    // Título descriptivo de la oportunidad a partir de TODOS los ítems actuales
    // de la cotización (no solo el primero) para que refleje el contenido real
    // y no datos de cotizaciones anteriores. Ej: "Cotización - filtro de jeringa
    // y columna HPLC".
    const buildQuoteOppTitle = () => {
      const descriptions = (draft.items || [])
        .map((it) => (it.description || "").trim())
        .filter(Boolean);

      let summary = "";
      if (descriptions.length === 0) {
        const account = accounts.find((a) => a.id === draft.accountId);
        summary =
          account?.nombreComercial ||
          account?.razonSocial ||
          "Nueva oportunidad";
      } else if (descriptions.length === 1) {
        summary = descriptions[0];
      } else {
        const shown = descriptions.slice(0, 3);
        const rest = descriptions.length - shown.length;
        const joined = `${shown.slice(0, -1).join(", ")} y ${
          shown[shown.length - 1]
        }`;
        summary = rest > 0 ? `${joined} (+${rest} más)` : joined;
      }

      return `Cotización - ${summary}`;
    };

    if (!finalOpportunityId) {
      const closeDate = new Date();
      closeDate.setDate(closeDate.getDate() + 30);

      const createdOpportunity = createOpportunity({
        titulo: buildQuoteOppTitle(),
        etapa: "Cotización",
        accountId: draft.accountId!,
        contactId: draft.contactId || undefined,
        ownerId: activeUser.id,
        valor: totals.total || 0,
        moneda: draft.currency || "COP",
        fechaEstimadaCierre: toLocalDateKey(closeDate),
        quoteId: quoteId,
      } as any);

      finalOpportunityId = createdOpportunity.id;
    } else {
      // Una sola oportunidad vinculada por cotización: al guardar, sincronizar
      // su valor con el TOTAL de todos los ítems (no solo el primero) para que
      // el embudo y los KPIs lean el valor total de la cotización completa.
      // Además se actualiza el título para que refleje los ítems actuales y no
      // quede con datos de una cotización anterior.
      const linkedOpp = listOpportunitiesByUser(activeUser).find(
        (o) => o.id === finalOpportunityId
      );

      if (
        linkedOpp &&
        linkedOpp.etapa !== "Ganado" &&
        linkedOpp.etapa !== "Perdido"
      ) {
        // Solo re-sincronizamos el título si sigue siendo un título autogenerado
        // ("Cotización - ..."), para no pisar un nombre que el usuario haya
        // puesto manualmente.
        const isAutoTitle = (linkedOpp.titulo || "").startsWith("Cotización -");

        updateOpportunity({
          ...linkedOpp,
          accountId: draft.accountId!,
          contactId: draft.contactId || "",
          quoteId: quoteId,
          valor: totals.total || 0,
          titulo: isAutoTitle ? buildQuoteOppTitle() : linkedOpp.titulo,
        });
      }
    }

    const quoteData = {
      id: quoteId,
      type: draft.type || 'producto',
      status: draft.status || 'borrador',
      accountId: draft.accountId!,
      contactId: draft.contactId,
      opportunityId: finalOpportunityId || undefined,
      currency: draft.currency || "COP",
      issueDate: draft.issueDate || todayLocal(),
      validUntil: draft.validUntil || todayLocal(),
      items: draft.items as any,
      terms: draft.terms as any,
      notes: draft.notes as any,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      deliveryAddress: draft.deliveryAddress,
      deliveryCity: draft.deliveryCity,
    };

    if (draft.id) {
      updateQuote({
        ...draft,
        ...quoteData,
      } as QuoteV2);
    } else {
      createQuote(quoteData);
    }

    resetAIQuoteHelper();
    resetQuoteDraft();
    setShowModal(false);
    setRefresh(p => p + 1);
  };

  const isQuoteInPeriod = (qDateStr: string, periodType: 'mensual' | 'trimestral' | 'anual', period: string) => {
    // calendarPartsOf resuelve dos cosas que antes fallaban:
    //  1) los strings "YYYY-MM-DD" se leen literal, sin pasar por new Date(),
    //     que los interpretaba como medianoche UTC y en Colombia los corría un
    //     día para atrás (el 1 de cada mes caía en el mes anterior);
    //  2) los timestamps ISO se convierten al calendario LOCAL, que es el
    //     mismo criterio con el que ahora se calcula fechaOC.
    const parts = calendarPartsOf(qDateStr);
    if (!parts) return false;
    const { year, month } = parts;

    if (periodType === 'mensual') {
      return `${year}-${String(month).padStart(2, '0')}` === period;
    } else if (periodType === 'trimestral') {
      const segments = period.split('-Q');
      if (segments.length !== 2) return false;
      const expectedYear = parseInt(segments[0], 10);
      const quarter = parseInt(segments[1], 10);
      if (year !== expectedYear) return false;
      return Math.ceil(month / 3) === quarter;
    } else {
      return String(year) === period;
    }
  };

  return (
    <div className="p-6 lg:p-8 bg-slate-50 min-h-screen">
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Cotizaciones IonCore</h1>
          <p className="text-slate-500 text-sm">Módulo de generación de ofertas comerciales.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowKPIs(!showKPIs)}
            className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-5 py-2.5 rounded-lg font-bold flex items-center gap-2 shadow-sm transition-all text-xs uppercase tracking-wider"
          >
            📊 {showKPIs ? "Ocultar KPIs" : "Ver KPIs"}
          </button>
          <button
            onClick={() => {
              resetAIQuoteHelper();
              resetQuoteDraft();
              setShowModal(true);
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg font-bold flex items-center gap-2 shadow-sm transition-all"
          >
            <Plus size={18} /> Nueva Cotización
          </button>
        </div>
      </div>

      {showKPIs && (
        <div className="bg-white border border-slate-200 p-6 rounded-[28px] shadow-sm mb-6 space-y-6 animate-fadeIn">
          {/* KPI subtabs header */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setKpiSubTab('metrics')}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  kpiSubTab === 'metrics'
                    ? 'bg-slate-900 text-white shadow-md shadow-slate-900/10'
                    : 'bg-slate-50 border border-slate-200 text-slate-500 hover:bg-slate-100'
                }`}
              >
                📊 Métricas de Cotizaciones
              </button>
              <button
                type="button"
                onClick={() => setKpiSubTab('targets')}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  kpiSubTab === 'targets'
                    ? 'bg-slate-900 text-white shadow-md shadow-slate-900/10'
                    : 'bg-slate-50 border border-slate-200 text-slate-500 hover:bg-slate-100'
                }`}
              >
                🎯 Metas y Presupuesto por Asesor
              </button>
            </div>
            
            {kpiSubTab === 'targets' && (
              <div className="flex flex-wrap items-center gap-3">
                {/* Asesor Filter for Director View */}
                {activeUser.role === 'director' && (
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] font-black uppercase text-slate-400">Ver Asesor:</label>
                    <select
                      value={selectedAdvisorDetailsId}
                      onChange={(e) => setSelectedAdvisorDetailsId(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-slate-50 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 font-bold"
                    >
                      <option value="all">Consolidado Equipo</option>
                      {users.filter(u => u.role === 'asesor').map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Period Type */}
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-400">Período:</label>
                  <select
                    value={budgetPeriodType}
                    onChange={(e) => {
                      const type = e.target.value as any;
                      setBudgetPeriodType(type);
                      setBudgetPeriod(currentPeriod(type));
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-slate-50 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 font-bold"
                  >
                    <option value="mensual">Mensual</option>
                    <option value="trimestral">Trimestral</option>
                    <option value="anual">Anual</option>
                  </select>
                </div>

                {/* Period Selection */}
                <select
                  value={budgetPeriod}
                  onChange={(e) => setBudgetPeriod(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-slate-50 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 font-bold"
                >
                  {periodOptions(budgetPeriodType).map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>

                {/* Currency Selection */}
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-400">Moneda:</label>
                  <select
                    value={budgetCurrency}
                    onChange={(e) => setBudgetCurrency(e.target.value as any)}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-slate-50 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 font-bold"
                  >
                    <option value="COP">COP ($)</option>
                    <option value="USD">USD (US$)</option>
                  </select>
                </div>

                {/* TRM global: la edita solo el director porque afecta los
                    reportes de todo el equipo. Las OC ya confirmadas conservan
                    su trmAplicada, así que no se revalúan al cambiarla. */}
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-400">TRM:</label>
                  {activeUser.role === 'director' ? (
                    editingTRM ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="1"
                          step="any"
                          autoFocus
                          value={trmDraft}
                          onChange={(e) => setTrmDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitTRM();
                            if (e.key === 'Escape') {
                              setTrmDraft(String(globalTRM));
                              setEditingTRM(false);
                            }
                          }}
                          className="w-24 px-2.5 py-1.5 rounded-lg border border-blue-300 text-xs bg-white outline-none focus:ring-2 focus:ring-blue-100 font-bold"
                        />
                        <button
                          type="button"
                          onClick={commitTRM}
                          className="px-2 py-1.5 rounded-lg bg-blue-600 text-white text-[10px] font-black uppercase hover:bg-blue-700"
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTrmDraft(String(globalTRM));
                            setEditingTRM(false);
                          }}
                          className="px-2 py-1.5 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-black uppercase hover:bg-slate-200"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setTrmDraft(String(globalTRM));
                          setEditingTRM(true);
                        }}
                        title="Editar la TRM usada en reportes y en nuevas OC"
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-slate-50 hover:bg-slate-100 hover:border-blue-300 font-bold text-slate-700"
                      >
                        ${globalTRM.toLocaleString('es-CO')} <span className="text-slate-400">✎</span>
                      </button>
                    )
                  ) : (
                    <span className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-slate-50 font-bold text-slate-500">
                      ${globalTRM.toLocaleString('es-CO')}
                    </span>
                  )}
                </div>

                {activeUser.role === 'director' && (
                  <button
                    type="button"
                    onClick={() => {
                      const firstAdv = users.filter(u => u.role === 'asesor')[0]?.id || '';
                      setBudgetFormAdvisorId(firstAdv);
                      setBudgetFormPeriodType(budgetPeriodType);
                      setBudgetFormPeriod(budgetPeriod);
                      setBudgetFormCurrency(budgetCurrency);
                      prepopulateBudgetValue(firstAdv, budgetPeriodType, budgetPeriod, budgetCurrency);
                      setShowBudgetModal(true);
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-blue-100 flex items-center gap-1.5"
                  >
                    🎯 Gestionar metas
                  </button>
                )}
              </div>
            )}
          </div>

          {kpiSubTab === 'metrics' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Resumen de Flujo */}
              <div className="bg-slate-900 p-5 rounded-[24px] text-white space-y-3 shadow-xl border border-slate-800">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Resumen de Flujo</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-2xl font-black">{quotes.length}</p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase">Creadas</p>
                  </div>
                  <div>
                    <p className="text-2xl font-black">{quotes.filter(q => q.sentAt).length}</p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase">Enviadas</p>
                  </div>
                </div>
                <div className="border-t border-slate-800 pt-3 flex justify-between items-center">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Conversión a OC</span>
                  <span className="px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-xs font-black">
                    {(() => {
                      const conOcCount = quotes.filter(q => q.status === 'con_oc').length;
                      const sentCount = quotes.filter(q => q.sentAt).length;
                      return sentCount > 0 ? ((conOcCount / sentCount) * 100).toFixed(1) : "0.0";
                    })()}%
                  </span>
                </div>
              </div>

              {/* Card 2: Estados en Historial */}
              <div className="bg-white p-5 rounded-[24px] border border-slate-200 shadow-sm space-y-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Historial por Estados</p>
                <div className="grid grid-cols-2 gap-3 text-slate-800">
                  <div>
                    <p className="text-xl font-black text-emerald-600">{quotes.filter(q => q.status === 'con_oc').length}</p>
                    <p className="text-[9px] text-slate-500 font-bold uppercase">Con OC</p>
                  </div>
                  <div>
                    <p className="text-xl font-black text-rose-600">{quotes.filter(q => q.status === 'rechazada').length}</p>
                    <p className="text-[9px] text-slate-500 font-bold uppercase">Rechazadas</p>
                  </div>
                  <div>
                    <p className="text-xl font-black text-red-500">{quotes.filter(q => q.status === 'cancelada').length}</p>
                    <p className="text-[9px] text-slate-500 font-bold uppercase">Canceladas</p>
                  </div>
                  <div>
                    <p className="text-xl font-black text-stone-500">{quotes.filter(q => q.status === 'vencida').length}</p>
                    <p className="text-[9px] text-slate-500 font-bold uppercase">Vencidas</p>
                  </div>
                </div>
              </div>

              {/* Card 3: Valores Financieros */}
              <div className="bg-white p-5 rounded-[24px] border border-slate-200 shadow-sm space-y-3 lg:col-span-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Valores de Negocio</p>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between border-b border-slate-100 pb-1">
                    <span className="text-slate-500 font-bold uppercase text-[9px]">Total Cotizado</span>
                    <div className="text-right">
                      <p className="font-black text-slate-800">{formatMoneyByCurrency(quotes.filter(q => q.currency === "COP").reduce((sum, q) => sum + q.total, 0), "COP")}</p>
                      <p className="text-[9px] text-slate-400 font-semibold">{formatMoneyByCurrency(quotes.filter(q => q.currency === "USD").reduce((sum, q) => sum + q.total, 0), "USD")}</p>
                    </div>
                  </div>
                  <div className="flex justify-between border-b border-slate-100 pb-1">
                    <span className="text-emerald-600 font-bold uppercase text-[9px]">Valor Ganado</span>
                    <div className="text-right">
                      <p className="font-black text-emerald-600">{formatMoneyByCurrency(quotes.filter(q => q.status === "con_oc" && q.currency === "COP").reduce((sum, q) => sum + q.total, 0), "COP")}</p>
                      <p className="text-[9px] text-emerald-500 font-semibold">{formatMoneyByCurrency(quotes.filter(q => q.status === "con_oc" && q.currency === "USD").reduce((sum, q) => sum + q.total, 0), "USD")}</p>
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-rose-600 font-bold uppercase text-[9px]">Valor Perdido</span>
                    <div className="text-right">
                      <p className="font-black text-rose-600">{formatMoneyByCurrency(quotes.filter(q => q.currency === "COP").reduce((sum, q) => { const opp = opportunities.find(o => o.id === q.opportunityId); return opp?.etapa === "Perdido" ? sum + q.total : sum; }, 0), "COP")}</p>
                      <p className="text-[9px] text-rose-500 font-semibold">{formatMoneyByCurrency(quotes.filter(q => q.currency === "USD").reduce((sum, q) => { const opp = opportunities.find(o => o.id === q.opportunityId); return opp?.etapa === "Perdido" ? sum + q.total : sum; }, 0), "USD")}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 4: Motivos de Rechazo */}
              <div className="bg-white p-5 rounded-[24px] border border-slate-200 shadow-sm space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Motivos de Rechazo</p>
                <div className="overflow-y-auto max-h-[85px] space-y-1.5 pr-1">
                  {(() => {
                    const reasons = quotes.reduce((acc, q) => {
                      if (q.status === 'rechazada' && q.rejectionReason) {
                        const r = q.rejectionReason.trim();
                        acc[r] = (acc[r] || 0) + 1;
                      }
                      return acc;
                    }, {} as Record<string, number>);
                    const sorted = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
                    if (sorted.length === 0) return <p className="text-xs text-slate-400 italic">No hay motivos registrados</p>;
                    return sorted.slice(0, 3).map(([reason, count]) => (
                      <div key={reason} className="flex justify-between items-center text-xs border-b border-slate-50 pb-1">
                        <span className="text-slate-600 truncate max-w-[150px] font-medium" title={reason}>{reason}</span>
                        <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 text-[10px] font-black">{count}</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>
          ) : (
            // Targets & Budgets View
            (() => {
              const isDirector = activeUser.role === 'director';
              const showDirectorView = isDirector && selectedAdvisorDetailsId === 'all';
              // TRM vigente. Ojo: los closures de abajo hacen
              // `q.trmAplicada || rate`, así que una OC ya confirmada conserva
              // su tasa y no se revalúa al cambiar la TRM global.
              const rate = globalTRM;

              const convertToReportCurrency = (val: number, fromCurr: string) => {
                if (fromCurr === budgetCurrency) return val;
                if (budgetCurrency === 'COP') return val * rate;
                return val / rate;
              };

              const getAdvisorStats = (advisorId: string) => {
                const b = budgets.find(x => x.advisorId === advisorId && x.periodo === budgetPeriod && x.tipoPeriodo === budgetPeriodType);
                const metaCurrency = b?.monedaMeta || 'COP';
                
                const budgetValueInMeta = b 
                  ? (b.presupuestoAsignado !== undefined ? b.presupuestoAsignado : (metaCurrency === 'COP' ? b.presupuestoCOP : b.presupuestoUSD)) 
                  : 0;

                // Convertir el presupuesto de la meta al tipo de moneda de reporte seleccionada
                let budgetValue = 0;
                if (b) {
                  if (metaCurrency === budgetCurrency) {
                    budgetValue = budgetValueInMeta;
                  } else if (metaCurrency === 'COP' && budgetCurrency === 'USD') {
                    budgetValue = budgetValueInMeta / rate;
                  } else {
                    budgetValue = budgetValueInMeta * rate;
                  }
                }

                const advisorQuotes = quotes.filter(q => q.ownerId === advisorId);
                const periodQuotes = advisorQuotes.filter(q => isQuoteInPeriod(q.createdAt, budgetPeriodType, budgetPeriod));
                const conOcQuotes = periodQuotes.filter(q => q.status === 'con_oc');

                const getQuoteValueInMeta = (q: QuoteV2) => {
                  if (q.valorConvertidoAMonedaMeta !== undefined) {
                    return q.valorConvertidoAMonedaMeta;
                  }
                  // Fallback para cotizaciones heredadas o antiguas
                  if (q.currency === metaCurrency) return q.total;
                  if (metaCurrency === 'COP') return q.total * rate;
                  return q.total / rate;
                };

                const getQuoteValueInReport = (q: QuoteV2) => {
                  // Conservar la TRM usada en el cierre o usar rate como fallback
                  const trm = q.trmAplicada || rate;
                  if (q.currency === budgetCurrency) return q.total;
                  if (budgetCurrency === 'COP') return q.total * trm;
                  return q.total / trm;
                };

                const wonValueInMeta = conOcQuotes.reduce((sum, q) => sum + getQuoteValueInMeta(q), 0);
                const wonValueInReport = conOcQuotes.reduce((sum, q) => sum + getQuoteValueInReport(q), 0);

                const fulfillment = budgetValueInMeta > 0 ? (wonValueInMeta / budgetValueInMeta) * 100 : 0;
                const missingValueInReport = Math.max(0, budgetValue - wonValueInReport);
                const missingValueInMeta = Math.max(0, budgetValueInMeta - wonValueInMeta);

                const advOpps = opportunities.filter(o => o.ownerId === advisorId && o.etapa !== 'Ganado' && o.etapa !== 'Perdido');
                const openPipelineValue = advOpps.reduce((sum, o) => sum + convertToReportCurrency(o.valor || 0, o.moneda), 0);
                const weightedPipeline = advOpps.reduce((sum, o) => sum + convertToReportCurrency((o.valor || 0) * ((o.probabilidad || 0) / 100), o.moneda), 0);
                const forecast = wonValueInReport + weightedPipeline;

                const createdCount = periodQuotes.length;
                const sentCount = periodQuotes.filter(q => q.sentAt).length;
                const conOcCount = periodQuotes.filter(q => q.status === 'con_oc').length;
                const conversionRate = sentCount > 0 ? (conOcCount / sentCount) * 100 : 0;

                const rejectedCount = periodQuotes.filter(q => q.status === 'rechazada').length;
                const cancelledCount = periodQuotes.filter(q => q.status === 'cancelada').length;
                const expiredCount = periodQuotes.filter(q => q.status === 'vencida').length;

                const totalValue = periodQuotes.reduce((sum, q) => sum + convertToReportCurrency(q.total, q.currency), 0);
                const lostValue = periodQuotes.reduce((sum, q) => {
                  const opp = opportunities.find(o => o.id === q.opportunityId);
                  return opp?.etapa === 'Perdido' ? sum + convertToReportCurrency(q.total, q.currency) : sum;
                }, 0);

                return {
                  budgetValue,
                  wonValue: wonValueInReport,
                  fulfillment,
                  missingValue: missingValueInReport,
                  openPipelineValue,
                  forecast,
                  createdCount,
                  sentCount,
                  conOcCount,
                  conversionRate,
                  rejectedCount,
                  cancelledCount,
                  expiredCount,
                  totalValue,
                  lostValue,
                  metaCurrency,
                  budgetValueInMeta,
                  wonValueInMeta,
                  missingValueInMeta
                };
              };

              const displayAdvisorId = activeUser.role === 'director' ? (showDirectorView ? 'all' : (selectedAdvisorDetailsId === 'all' ? activeUser.id : selectedAdvisorDetailsId)) : activeUser.id;

              if (displayAdvisorId !== 'all') {
                const stats = getAdvisorStats(displayAdvisorId);
                const advName = users.find(u => u.id === displayAdvisorId)?.name || 'Asesor';

                return (
                  <div className="space-y-6">
                    {isDirector && (
                      <div className="flex justify-between items-center">
                        <button
                          type="button"
                          onClick={() => setSelectedAdvisorDetailsId('all')}
                          className="text-xs font-black text-blue-600 hover:text-blue-800 uppercase tracking-widest flex items-center gap-1.5 transition-colors"
                        >
                          ← Volver al Consolidado del Equipo
                        </button>
                        <span className="text-sm font-bold text-slate-700">Visualizando: <strong>{advName}</strong></span>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {/* Presupuesto */}
                      <div className="bg-slate-900 text-white p-5 rounded-[24px] space-y-2 border border-slate-800 shadow-lg">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Presupuesto Asignado</p>
                        <p className="text-3xl font-black">{formatMoneyByCurrency(stats.budgetValue, budgetCurrency)}</p>
                        <p className="text-[10px] text-slate-500 font-semibold">Meta comercial fijada para el período.</p>
                      </div>

                      {/* Cumplimiento */}
                      <div className="bg-white p-5 rounded-[24px] border border-slate-200 shadow-sm space-y-3">
                        <div className="flex justify-between items-center">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cumplimiento de Meta</p>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                            stats.fulfillment >= 100 ? 'bg-emerald-100 text-emerald-700' : (stats.fulfillment >= 80 ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700')
                          }`}>
                            {stats.fulfillment.toFixed(1)}%
                          </span>
                        </div>
                        <p className="text-3xl font-black text-slate-800">{formatMoneyByCurrency(stats.wonValue, budgetCurrency)}</p>
                        <div className="w-full bg-slate-100 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all ${
                              stats.fulfillment >= 100 ? 'bg-emerald-500' : (stats.fulfillment >= 80 ? 'bg-blue-500' : 'bg-rose-500')
                            }`}
                            style={{ width: `${Math.min(100, stats.fulfillment)}%` }}
                          />
                        </div>
                        {stats.metaCurrency && stats.budgetValueInMeta !== undefined && (
                          <p className="text-[10px] text-slate-500 font-semibold mt-1">
                            Meta real: <strong>{formatMoneyByCurrency(stats.wonValueInMeta, stats.metaCurrency)}</strong> de <strong>{formatMoneyByCurrency(stats.budgetValueInMeta, stats.metaCurrency)}</strong>
                          </p>
                        )}
                      </div>

                      {/* Faltante */}
                      <div className="bg-white p-5 rounded-[24px] border border-slate-200 shadow-sm space-y-2">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Faltante para Meta</p>
                        <p className={`text-3xl font-black ${stats.missingValue === 0 ? 'text-emerald-600' : 'text-slate-800'}`}>
                          {stats.missingValue === 0 ? '¡Meta Cumplida!' : formatMoneyByCurrency(stats.missingValue, budgetCurrency)}
                        </p>
                        <p className="text-[10px] text-slate-500 font-semibold">Valor restante para alcanzar el presupuesto.</p>
                      </div>

                      {/* Pipeline Abierto */}
                      <div className="bg-white p-5 rounded-[24px] border border-slate-200 shadow-sm space-y-2">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pipeline Abierto</p>
                        <p className="text-2xl font-black text-slate-800">{formatMoneyByCurrency(stats.openPipelineValue, budgetCurrency)}</p>
                        <p className="text-[10px] text-slate-500 font-semibold">Oportunidades activas del asesor.</p>
                      </div>

                      {/* Forecast */}
                      <div className="bg-white p-5 rounded-[24px] border border-slate-200 shadow-sm space-y-2">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Forecast (Cierre Proyectado)</p>
                        <p className="text-2xl font-black text-blue-600">{formatMoneyByCurrency(stats.forecast, budgetCurrency)}</p>
                        <p className="text-[10px] text-slate-500 font-semibold">Valor ganado + pipeline ponderado.</p>
                      </div>

                      {/* Conversión y Cotizaciones */}
                      <div className="bg-white p-5 rounded-[24px] border border-slate-200 shadow-sm space-y-2">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Conversión a OC</p>
                        <p className="text-2xl font-black text-slate-800">{stats.conversionRate.toFixed(1)}%</p>
                        <p className="text-[10px] text-slate-500 font-semibold">
                          Con OC: <strong>{stats.conOcCount}</strong> · Enviadas: <strong>{stats.sentCount}</strong>
                        </p>
                      </div>
                    </div>

                    <div className="bg-slate-50 p-5 rounded-[20px] border border-slate-200/60 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-semibold text-slate-700">
                      <div>
                        <p className="text-slate-400 text-[10px] uppercase font-black">Cotiz. Creadas</p>
                        <p className="text-lg font-black text-slate-800">{stats.createdCount}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 text-[10px] uppercase font-black">Cotiz. Rechazadas</p>
                        <p className="text-lg font-black text-rose-600">{stats.rejectedCount}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 text-[10px] uppercase font-black">Cotiz. Canceladas</p>
                        <p className="text-lg font-black text-red-500">{stats.cancelledCount}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 text-[10px] uppercase font-black">Cotiz. Vencidas</p>
                        <p className="text-lg font-black text-stone-500">{stats.expiredCount}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-slate-400 text-[10px] uppercase font-black">Valor Total Cotizado</p>
                        <p className="text-base font-black text-slate-800">{formatMoneyByCurrency(stats.totalValue, budgetCurrency)}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-slate-400 text-[10px] uppercase font-black">Valor Perdido Comercial</p>
                        <p className="text-base font-black text-rose-600">{formatMoneyByCurrency(stats.lostValue, budgetCurrency)}</p>
                      </div>
                    </div>

                    {/* Tabla de Cotizaciones de Cierre (Con OC) - Regla 7 */}
                    <div className="bg-white border border-slate-200/80 p-5 rounded-[24px] shadow-sm space-y-4">
                      <div>
                        <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Desglose de Cotizaciones Ganadas (Con OC)</h4>
                        <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Cotizaciones que suman al cumplimiento de la meta en este período.</p>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-slate-100 text-slate-400 font-black uppercase tracking-wider text-[9px] bg-slate-50/50">
                              <th className="p-3">Cotización</th>
                              <th className="p-3">Cliente</th>
                              <th className="p-3 text-right">Valor Original</th>
                              <th className="p-3 text-center">Moneda Original</th>
                              <th className="p-3 text-right">TRM Aplicada</th>
                              <th className="p-3 text-right">Valor Convertido</th>
                              <th className="p-3 text-center">Moneda Meta</th>
                              <th className="p-3 text-center">Fecha Cierre</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {(() => {
                              const advisorQuotes = quotes.filter(q => q.ownerId === displayAdvisorId);
                              const periodQuotes = advisorQuotes.filter(q => isQuoteInPeriod(q.createdAt, budgetPeriodType, budgetPeriod));
                              const conOcQuotes = periodQuotes.filter(q => q.status === 'con_oc');

                              if (conOcQuotes.length === 0) {
                                  return (
                                    <tr>
                                      <td colSpan={8} className="p-6 text-center text-slate-400 italic">
                                        No hay cotizaciones cerradas en este período.
                                      </td>
                                    </tr>
                                  );
                              }

                              return conOcQuotes.map(q => {
                                  const trm = q.trmAplicada || rate;
                                  const mOriginal = q.monedaOriginal || q.currency;
                                  const vOriginal = q.valorOriginal !== undefined ? q.valorOriginal : q.total;
                                  const mMeta = q.monedaMeta || stats.metaCurrency;
                                  const valMeta = q.valorConvertidoAMonedaMeta !== undefined 
                                    ? q.valorConvertidoAMonedaMeta 
                                    : (mMeta === mOriginal ? vOriginal : (mMeta === 'COP' ? vOriginal * trm : vOriginal / trm));
                                  const clientName = accounts.find(a => a.id === q.accountId)?.nombreComercial || "Cliente";

                                  return (
                                    <tr key={q.id} className="hover:bg-slate-50/50 font-medium text-slate-700 transition-colors">
                                      <td className="p-3 font-bold text-slate-900">{q.quoteNumber}</td>
                                      <td className="p-3">{clientName}</td>
                                      <td className="p-3 text-right font-bold">{formatMoneyByCurrency(vOriginal, mOriginal)}</td>
                                      <td className="p-3 text-center">
                                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-bold text-[9px]">{mOriginal}</span>
                                      </td>
                                      <td className="p-3 text-right font-mono text-slate-500">
                                        {trm.toLocaleString("es-CO")}
                                      </td>
                                      <td className="p-3 text-right font-black text-blue-600">
                                        {formatMoneyByCurrency(valMeta, mMeta)}
                                      </td>
                                      <td className="p-3 text-center">
                                        <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 font-bold text-[9px]">{mMeta}</span>
                                      </td>
                                      <td className="p-3 text-center text-slate-500">{q.fechaOC || q.approvedAt?.split('T')[0] || q.updatedAt.split('T')[0]}</td>
                                    </tr>
                                  );
                              });
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                );
              }

              const teamAdvisors = users.filter(u => u.role === 'asesor');
              const teamStats = teamAdvisors.map(u => ({
                id: u.id,
                name: u.name,
                ...getAdvisorStats(u.id)
              }));

              const totalTeamBudget = teamStats.reduce((sum, s) => sum + s.budgetValue, 0);
              const totalTeamWon = teamStats.reduce((sum, s) => sum + s.wonValue, 0);
              const teamFulfillment = totalTeamBudget > 0 ? (totalTeamWon / totalTeamBudget) * 100 : 0;
              const teamForecast = teamStats.reduce((sum, s) => sum + s.forecast, 0);

              const ranking = [...teamStats].sort((a, b) => b.fulfillment - a.fulfillment);
              const belowTarget = teamStats.filter(s => s.fulfillment < 100);
              const nearTarget = teamStats.filter(s => s.fulfillment >= 80 && s.fulfillment < 100);

              return (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-slate-900 text-white p-5 rounded-[24px] space-y-2 border border-slate-800 shadow-lg">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Presupuesto del Equipo</p>
                      <p className="text-2xl font-black">{formatMoneyByCurrency(totalTeamBudget, budgetCurrency)}</p>
                      <p className="text-[10px] text-slate-500 font-semibold">Meta global consolidada.</p>
                    </div>

                    <div className="bg-white p-5 rounded-[24px] border border-slate-200 shadow-sm space-y-2">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Valor Ganado Total</p>
                      <p className="text-2xl font-black text-emerald-600">{formatMoneyByCurrency(totalTeamWon, budgetCurrency)}</p>
                      <p className="text-[10px] text-slate-500 font-semibold">Faltante: <strong>{formatMoneyByCurrency(Math.max(0, totalTeamBudget - totalTeamWon), budgetCurrency)}</strong></p>
                    </div>

                    <div className="bg-white p-5 rounded-[24px] border border-slate-200 shadow-sm space-y-3">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cumplimiento General</p>
                      <div className="flex justify-between items-center text-lg font-black text-slate-800">
                        <span>{teamFulfillment.toFixed(1)}%</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full bg-blue-600 transition-all"
                          style={{ width: `${Math.min(100, teamFulfillment)}%` }}
                        />
                      </div>
                    </div>

                    <div className="bg-white p-5 rounded-[24px] border border-slate-200 shadow-sm space-y-2">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Forecast del Equipo</p>
                      <p className="text-2xl font-black text-blue-600">{formatMoneyByCurrency(teamForecast, budgetCurrency)}</p>
                      <p className="text-[10px] text-slate-500 font-semibold">Ponderación de cierres probables.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="bg-white border border-slate-200/80 p-5 rounded-[24px] shadow-sm space-y-3 lg:col-span-2">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ranking de Asesores</p>
                      <div className="space-y-3">
                        {ranking.map((adv, idx) => (
                          <div
                            key={adv.id}
                            onClick={() => setSelectedAdvisorDetailsId(adv.id)}
                            className="flex items-center justify-between p-3.5 bg-slate-50 hover:bg-slate-100 rounded-2xl cursor-pointer border border-slate-200/30 transition-all group"
                          >
                            <div className="flex items-center gap-3">
                              <span className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-900 text-white text-xs font-black">
                                #{idx + 1}
                              </span>
                              <div>
                                <p className="text-xs font-black text-slate-800 group-hover:text-blue-600 transition-colors">{adv.name}</p>
                                <p className="text-[10px] text-slate-400 font-semibold">Pipeline: {formatMoneyByCurrency(adv.openPipelineValue, budgetCurrency)}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-black text-slate-800">{formatMoneyByCurrency(adv.wonValue, budgetCurrency)} / {formatMoneyByCurrency(adv.budgetValue, budgetCurrency)}</p>
                              <span className={`text-[10px] font-black ${adv.fulfillment >= 100 ? 'text-emerald-600' : 'text-blue-600'}`}>
                                {adv.fulfillment.toFixed(1)}% cumplimiento
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="bg-white border border-slate-200 p-5 rounded-[24px] shadow-sm space-y-3">
                        <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Cerca de Cumplir (&gt;=80%)</p>
                        <div className="space-y-2">
                          {nearTarget.length === 0 ? (
                            <p className="text-xs text-slate-400 italic">Ningún asesor en este rango</p>
                          ) : (
                            nearTarget.map(adv => (
                              <div key={adv.id} className="flex justify-between items-center text-xs">
                                <span className="font-bold text-slate-700">{adv.name}</span>
                                <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 font-black">{adv.fulfillment.toFixed(1)}%</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="bg-white border border-slate-200 p-5 rounded-[24px] shadow-sm space-y-3">
                        <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest">Por Debajo de la Meta (&lt;100%)</p>
                        <div className="space-y-2">
                          {belowTarget.length === 0 ? (
                            <p className="text-xs text-slate-400 italic">Todos han cumplido la meta 🎉</p>
                          ) : (
                            belowTarget.map(adv => (
                              <div key={adv.id} className="flex justify-between items-center text-xs">
                                <span className="font-bold text-slate-700">{adv.name}</span>
                                <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-600 font-black">{adv.fulfillment.toFixed(1)}%</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      )}

      <div className="bg-white border border-slate-200 p-5 rounded-[24px] shadow-sm mb-6 space-y-4">
        {/* Fila 1: Pestañas de Vista */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex gap-2">
            {[
              { id: 'activas', label: 'Activas' },
              { id: 'historico', label: 'Histórico' },
              { id: 'todas', label: 'Todas' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  setViewTab(tab.id as any);
                  setVisibleCount(10);
                }}
                className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                  viewTab === tab.id
                    ? 'bg-slate-900 text-white shadow-md'
                    : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Total filtrado:</span>
            <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-800 text-xs font-black">
              {filteredQuotes.length}
            </span>
          </div>
        </div>

        {/* Fila 2: Buscador y Estado */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Búsqueda rápida</label>
            <input
              type="text"
              placeholder="Número, cliente, contacto..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-slate-50 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 focus:bg-white"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Estado de Cotización</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as QuoteStatus | "todos")}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-slate-50 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 focus:bg-white"
            >
              <option value="todos">Todos los estados</option>
              <option value="borrador">Borrador</option>
              <option value="pendiente_costo_proveedor">Pendiente por costo del proveedor</option>
              <option value="revisada">Revisada</option>
              <option value="enviada">Enviada</option>
              <option value="con_oc">Con OC</option>
              <option value="rechazada">Rechazada</option>
              <option value="cancelada">Cancelada</option>
              <option value="vencida">Vencida</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Empresa Cliente</label>
            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-slate-50 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 focus:bg-white"
            >
              <option value="todos">Todas las empresas</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.nombreComercial || a.razonSocial}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Fila 3: Contacto, Asesor y Rango de Fechas */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Contacto</label>
            <select
              value={contactFilter}
              onChange={(e) => setContactFilter(e.target.value)}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-slate-50 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 focus:bg-white"
            >
              <option value="todos">Todos los contactos</option>
              {allContacts.map(c => (
                <option key={c.id} value={c.id}>{c.fullName}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Asesor Comercial</label>
            <select
              value={advisorFilter}
              onChange={(e) => setAdvisorFilter(e.target.value)}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-slate-50 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 focus:bg-white"
            >
              <option value="todos">Todos los asesores</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.role === 'director' ? 'Director' : 'Asesor'})</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Fecha Desde</label>
            <input
              type="date"
              value={dateStartFilter}
              onChange={(e) => setDateStartFilter(e.target.value)}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-slate-50 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 focus:bg-white"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Fecha Hasta</label>
            <input
              type="date"
              value={dateEndFilter}
              onChange={(e) => setDateEndFilter(e.target.value)}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-slate-50 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 focus:bg-white"
            />
          </div>
        </div>

        {/* Fila 4: Botón de Limpiar Filtros */}
        {(searchTerm || statusFilter !== 'todos' || accountFilter !== 'todos' || contactFilter !== 'todos' || advisorFilter !== 'todos' || dateStartFilter || dateEndFilter) && (
          <div className="flex justify-end pt-2 border-t border-slate-100">
            <button
              onClick={() => {
                setSearchTerm("");
                setStatusFilter("todos");
                setAccountFilter("todos");
                setContactFilter("todos");
                setAdvisorFilter("todos");
                setDateStartFilter("");
                setDateEndFilter("");
              }}
              className="text-xs font-black text-red-500 hover:text-red-700 uppercase tracking-widest transition-colors"
            >
              Limpiar filtros
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredQuotes.slice(0, visibleCount).map(q => {
          return (
            <div
              key={q.id}
              onClick={() => {
                setDraft(q);
                setApplyTax(q.tax > 0);
                setActiveTab("general");
                setShowModal(true);
              }}
              className="bg-white border border-slate-200 p-7 rounded-[28px] shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all group cursor-pointer"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-black text-slate-900">{q.quoteNumber}</div>
                  <div className="text-xs text-slate-500 uppercase tracking-wider">
                    {q.type === "servicio" ? "Servicio" : "Producto"} · {q.currency}
                  </div>
                  <div className="text-sm text-slate-700">
                    {accounts.find((a) => a.id === q.accountId)?.nombreComercial ||
                      accounts.find((a) => a.id === q.accountId)?.razonSocial ||
                      "Sin cuenta"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {(() => {
                      const c = allContacts.find((x) => x.id === q.contactId) as any;
                      return (
                        c?.fullName ||
                        c?.name ||
                        `${c?.firstName || ""} ${c?.lastName || ""}`.trim() ||
                        "Sin contacto"
                      );
                    })()}
                  </div>
                  <div className="text-xs font-black text-slate-900 mt-1">
                    {formatMoneyByCurrency(q.total, q.currency)}
                  </div>
                  <div className="text-[10px] text-slate-400 font-semibold mt-1">
                    Creado: {new Date(q.createdAt).toLocaleDateString()}
                  </div>
                  {q.status === "rechazada" && q.rejectionReason && (
                    <div className="text-[10px] text-red-500 font-semibold italic mt-1 max-w-[200px] truncate" title={q.rejectionReason}>
                      Motivo: {q.rejectionReason}
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end gap-2">
                  {canDelete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteQuote(q.id);
                        setRefresh(r => r + 1);
                      }}
                      className="p-2 -m-2 text-slate-300 hover:text-red-500 transition-colors"
                      title="Eliminar cotización"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                  <div
                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${getQuoteStatusBadgeClass(q.status)}`}
                  >
                    {getQuoteStatusLabel(q.status)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-4" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => handlePrint(q)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold hover:bg-slate-50 transition-colors"
                >
                  Imprimir
                </button>

                <button
                  type="button"
                  onClick={() => handleDuplicateQuote(q.id)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold hover:bg-slate-50 transition-colors"
                >
                  Duplicar
                </button>

                <select
                  value={q.status}
                  onChange={(e) => handleStatusChange(q.id, e.target.value as QuoteStatus)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold outline-none hover:bg-slate-50 transition-colors"
                >
                  <option value="borrador">Borrador</option>
                  <option value="pendiente_costo_proveedor">Pendiente por costo del proveedor</option>
                  <option value="revisada">Revisada</option>
                  <option value="enviada">Enviada</option>
                  <option value="con_oc">Con OC</option>
                  <option value="rechazada">Rechazada</option>
                  <option value="cancelada">Cancelada</option>
                  <option value="vencida">Vencida</option>
                </select>
              </div>
            </div>
          );
        })}
        {filteredQuotes.length === 0 && (
          <div className="col-span-full py-12 text-center text-slate-400">
            No se encontraron cotizaciones con los filtros actuales.
          </div>
        )}
      </div>

      {filteredQuotes.length > visibleCount && (
        <div className="flex justify-center mt-8 mb-12">
          <button
            onClick={() => setVisibleCount(prev => prev + 10)}
            className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-8 py-3 rounded-xl font-bold shadow-sm transition-all"
          >
            Cargar más cotizaciones
          </button>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 bg-white">
          <div className="bg-white w-full h-screen flex flex-col overflow-hidden">
            <div className="px-8 py-5 border-b flex justify-between items-center bg-slate-50 shrink-0">
              <h2 className="text-xl font-black uppercase tracking-tighter text-slate-900">
                {draft.type === "servicio" ? "Nueva Cotización de Servicio" : "Nueva Cotización de Producto"}
              </h2>
              <button
                onClick={() => {
                  resetAIQuoteHelper();
                  resetQuoteDraft();
                  setShowModal(false);
                }}
                className="p-2 hover:bg-slate-200 rounded-full text-slate-500"
              >
                <X size={20} />
              </button>
            </div>

            <div className="bg-white px-8 pt-5 pb-3 border-b border-slate-200 shrink-0">
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <button
                  type="button"
                  onClick={() => setShowAIHelper(false)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 10,
                    border: "1px solid #ccc",
                    background: !showAIHelper ? "#2563eb" : "#fff",
                    color: !showAIHelper ? "#fff" : "#000",
                    fontWeight: 600
                  }}
                >
                  Formulario manual
                </button>

                <button
                  type="button"
                  onClick={() => setShowAIHelper(true)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 10,
                    border: "1px solid #ccc",
                    background: showAIHelper ? "#2563eb" : "#fff",
                    color: showAIHelper ? "#fff" : "#000",
                    fontWeight: 600
                  }}
                >
                  Asistente rápido
                </button>
              </div>

              <div className="flex gap-6 mt-4">
                {[
                  { id: 'general', label: 'Datos Generales', icon: Building2 },
                  { id: 'items', label: 'Líneas / Ítems', icon: List },
                  { id: 'condiciones', label: 'Condiciones', icon: ShieldCheck },
                  { id: 'observaciones', label: 'Notas', icon: StickyNote }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`flex items-center gap-2 pb-3 px-2 text-xs font-black uppercase tracking-widest border-b-2 transition-all ${
                      activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    <tab.icon size={16} /> {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-0 flex bg-slate-50">
              <div className="flex-1 min-w-0 overflow-y-auto px-8 py-6">
                {draft.status === "vencida" && (
                  <div className="bg-amber-50 border border-amber-200 p-5 rounded-[24px] mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <span className="text-xl mt-0.5">⚠️</span>
                      <div>
                        <p className="text-xs font-black text-amber-800">Esta cotización está Vencida</p>
                        <p className="text-[10px] text-amber-600 font-semibold mt-0.5">
                          No se ha modificado automáticamente la oportunidad vinculada. Puedes renovar la validez del documento por 15 días, duplicarla para incrementar la versión, o actualizar su información comercial.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          const newValidDate = new Date();
                          newValidDate.setDate(newValidDate.getDate() + 15);
                          setDraft(prev => ({
                            ...prev,
                            status: "revisada",
                            validUntil: toLocalDateKey(newValidDate)
                          }));
                          alert("Se ha renovado la validez por 15 días y fijado el estado en 'Revisada'. Recuerda guardar para aplicar los cambios.");
                        }}
                        className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all"
                      >
                        Renovar (15 días)
                      </button>
                    </div>
                  </div>
                )}
                {activeTab === 'general' && (
                  <div className="space-y-6 w-full max-w-none">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 bg-white p-6 lg:p-7 rounded-[28px] border border-slate-200 shadow-sm">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Empresa Cliente *</label>
                        <select
                          className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700"
                          value={draft.accountId || ''}
                          onChange={e => {
                            const accId = e.target.value;
                            const acc = accounts.find(a => a.id === accId);
                            setDraft({
                              ...draft,
                              accountId: accId,
                              contactId: "",
                              opportunityId: "",
                              deliveryAddress: acc?.direccion || "",
                              deliveryCity: acc?.ciudad || ""
                            });
                          }}
                        >
                          <option value="">Seleccionar empresa...</option>
                          {accounts.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.nombreComercial || a.razonSocial}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Contacto Principal</label>
                        <select
                          className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700"
                          value={draft.contactId || ''}
                          onChange={e => setDraft({ ...draft, contactId: e.target.value })}
                        >
                          <option value="">Seleccionar contacto...</option>
                          {draft.accountId &&
                            allContacts
                              .filter(c => c.accountId === draft.accountId)
                              .map(c => (
                                <option key={c.id} value={c.id}>
                                  {c.fullName}
                                </option>
                              ))}
                        </select>
                        {draft.contactId && (
                          <p className="text-[10px] text-slate-500 mt-2 font-medium">
                            Tel: {contactMobile || "No registrado"} | Correo: {contactEmail || "No registrado"}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 bg-white p-6 lg:p-7 rounded-[28px] border border-slate-200 shadow-sm">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Tipo de Oferta</label>
                        <select
                          className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700"
                          value={draft.type}
                          onChange={(e) => {
                            const nextType = e.target.value as QuoteType;
                            setDraft({
                              ...draft,
                              type: nextType,
                              items: [],
                              terms: nextType === "servicio" ? defaultServiceTerms : defaultProductTerms
                            });
                          }}
                        >
                          <option value="producto">Suministro de Equipos / Productos</option>
                          <option value="servicio">Prestación de Servicios</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Moneda</label>
                        <select
                          className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700"
                          value={draft.currency}
                          onChange={e => setDraft({ ...draft, currency: e.target.value as QuoteCurrency })}
                        >
                          <option value="COP">Pesos Colombianos (COP)</option>
                          <option value="USD">Dólares (USD)</option>
                        </select>
                      </div>

                      <div className="col-span-1 md:col-span-2 xl:col-span-4">
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                          Oportunidad vinculada
                        </label>
                        <select
                          className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700"
                          value={draft.opportunityId || ""}
                          onChange={e => setDraft({ ...draft, opportunityId: e.target.value })}
                          disabled={!draft.accountId}
                        >
                          <option value="">
                            {!draft.accountId
                              ? "Selecciona primero una empresa..."
                              : "🆕 Se creará nueva oportunidad al guardar"}
                          </option>

                          {accountOpportunities.map((opp) => (
                            <option key={opp.id} value={opp.id}>
                              {opp.titulo} · {opp.etapa}
                            </option>
                          ))}
                        </select>

                        {draft.accountId && accountOpportunities.length === 0 && (
                          <p className="text-[10px] text-slate-500 mt-2 font-medium">
                            No hay oportunidades abiertas para esta empresa.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 bg-white p-6 lg:p-7 rounded-[28px] border border-slate-200 shadow-sm">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                          Dirección de entrega
                        </label>
                        <input
                          className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700"
                          value={draft.deliveryAddress || ""}
                          onChange={e => setDraft({ ...draft, deliveryAddress: e.target.value })}
                          placeholder="Dirección de entrega"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                          Ciudad de entrega
                        </label>
                        <input
                          className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700"
                          value={draft.deliveryCity || ""}
                          onChange={e => setDraft({ ...draft, deliveryCity: e.target.value })}
                          placeholder="Ciudad"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'items' && (
                  <div className="space-y-4 h-full flex flex-col">
                    <div className="flex items-center justify-between bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm">
                      <div>
                        <p className="text-sm font-black text-slate-900">
                          Ítems de la cotización
                        </p>
                        <p className="text-xs text-slate-500 font-semibold">
                          Revisa que el número de ítems coincida con la solicitud del cliente.
                        </p>
                      </div>

                      <div className="px-4 py-2 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 text-sm font-black">
                        {(draft.items || []).length} ítems
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-[28px] overflow-hidden shadow-sm h-[calc(100vh-380px)] min-h-[420px] flex flex-col">
                      <div className="flex-1 overflow-auto">
                        <table className="w-full min-w-[1280px] text-sm">
                          <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                            <tr>
                              <th className="px-4 py-4 text-center w-[60px]">#</th>
                              <th className="px-6 py-4 text-left w-[180px]">Código</th>
                              <th className="px-6 py-4 text-left">{draft.type === "servicio" ? "Descripción del Servicio" : "Descripción"}</th>
                              {draft.type === "servicio" && (
                                <th className="px-4 py-4 text-center w-[100px]">Unidad</th>
                              )}
                              <th className="px-6 py-4 text-center w-[100px]">Cant.</th>
                              <th className="px-6 py-4 text-right w-[140px]">V. Unitario</th>
                              <th className="px-6 py-4 text-right w-[140px]">Subtotal</th>
                              <th className="px-6 py-4 w-[50px]"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {(draft.items || []).map((i, index) => (
                              <tr key={i.id} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="px-4 py-4 text-center text-xs font-black text-slate-500">
                                  {index + 1}
                                </td>
                                <td className="p-2">
                                  <input
                                    className="w-full border border-transparent hover:border-slate-200 focus:border-blue-500 rounded p-2 text-xs font-mono outline-none"
                                    value={i.code || ''}
                                    placeholder="Ref..."
                                    onChange={e => handleItemChange(i.id, 'code', e.target.value)}
                                  />
                                </td>
                                <td className="p-2">
                                  <input
                                    className="w-full border border-transparent hover:border-slate-200 focus:border-blue-500 rounded p-2 text-xs outline-none"
                                    value={i.description}
                                    placeholder="Descripción..."
                                    onChange={e => handleItemChange(i.id, 'description', e.target.value)}
                                  />
                                </td>

                                {draft.type === "servicio" && (
                                  <td className="p-2">
                                    <select
                                      className="w-full border-none focus:ring-0 text-xs text-center outline-none bg-transparent hover:bg-slate-50 rounded"
                                      value={i.unit}
                                      onChange={(e) => handleItemChange(i.id, "unit", e.target.value)}
                                    >
                                      <option value="hora">Hora</option>
                                      <option value="dia">Día</option>
                                      <option value="servicio">Servicio</option>
                                      <option value="otro">Otro</option>
                                    </select>
                                  </td>
                                )}

                                <td className="p-2">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    pattern="[0-9.,]*"
                                    className="w-full border border-transparent hover:border-slate-200 focus:border-blue-500 rounded p-2 text-xs text-center font-bold outline-none"
                                    value={i.quantity ?? ''}
                                    onChange={e => handleItemChange(i.id, 'quantity', e.target.value)}
                                  />
                                </td>
                                <td className="p-2">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    pattern="[0-9.,]*"
                                    className="w-full border border-transparent hover:border-slate-200 focus:border-blue-500 rounded p-2 text-xs text-right font-mono outline-none"
                                    value={i.unitPrice ?? ''}
                                    onChange={e => handleItemChange(i.id, 'unitPrice', e.target.value)}
                                  />
                                </td>
                                <td className="px-6 py-4 text-right font-black text-slate-900 text-xs">
                                  {formatMoneyByCurrency(i.total, draft.currency)}
                                </td>
                                <td className="p-2 text-center">
                                  <button
                                    onClick={() => setDraft({ ...draft, items: draft.items?.filter(x => x.id !== i.id) })}
                                    className="text-slate-300 hover:text-red-500 p-2"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button
                        onClick={handleAddItem}
                        className="shrink-0 w-full py-4 bg-slate-50 text-blue-600 text-[10px] font-black uppercase tracking-widest hover:bg-blue-50 border-t border-slate-100 transition-colors"
                      >
                        + Añadir Línea
                      </button>
                    </div>

                    <div className="flex justify-end shrink-0">
                      <div className="bg-slate-900 p-5 rounded-[24px] text-white space-y-3 w-full sm:w-96 shadow-xl">
                        <div className="flex justify-between text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                          <span>Subtotal</span>
                          <span>{formatMoneyByCurrency(totals.subtotal, draft.currency)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                          <label className="flex items-center gap-2 cursor-pointer hover:text-white transition-colors">
                            <input
                              type="checkbox"
                              checked={applyTax}
                              onChange={e => setApplyTax(e.target.checked)}
                              className="rounded text-blue-600 focus:ring-0 accent-blue-600"
                            />
                            IVA (19%)
                          </label>
                          <span className="text-white">{formatMoneyByCurrency(totals.tax, draft.currency)}</span>
                        </div>
                        <div className="flex justify-between text-2xl font-black border-t border-slate-700 pt-4 text-blue-400 tracking-tighter mt-2">
                          <span>TOTAL</span>
                          <span>{formatMoneyByCurrency(totals.total, draft.currency)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'condiciones' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-6xl mx-auto">
                    <div className="bg-white p-5 rounded-2xl border border-slate-200">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Validez de la oferta</label>
                      <input className="w-full border-b border-slate-200 py-2 text-sm focus:border-blue-500 outline-none font-bold text-slate-700" value={draft.terms?.validityText || ''} onChange={e => setDraft({ ...draft, terms: { ...draft.terms!, validityText: e.target.value } })} />
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-slate-200">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Facturación</label>
                      <input className="w-full border-b border-slate-200 py-2 text-sm focus:border-blue-500 outline-none font-bold text-slate-700" value={draft.terms?.billingText || ''} onChange={e => setDraft({ ...draft, terms: { ...draft.terms!, billingText: e.target.value } })} />
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-slate-200">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Términos de Pago</label>
                      <input className="w-full border-b border-slate-200 py-2 text-sm focus:border-blue-500 outline-none font-bold text-slate-700" value={draft.terms?.paymentTermsText || ''} onChange={e => setDraft({ ...draft, terms: { ...draft.terms!, paymentTermsText: e.target.value } })} />
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-slate-200">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Método de Pago</label>
                      <textarea rows={3} className="w-full border-b border-slate-200 py-2 text-sm focus:border-blue-500 outline-none font-bold text-slate-700 resize-none" value={draft.terms?.paymentMethodText || ''} onChange={e => setDraft({ ...draft, terms: { ...draft.terms!, paymentMethodText: e.target.value } })} />
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-slate-200">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Tiempo de Entrega</label>
                      <input className="w-full border-b border-slate-200 py-2 text-sm focus:border-blue-500 outline-none font-bold text-slate-700" value={draft.terms?.deliveryTimeText || ''} onChange={e => setDraft({ ...draft, terms: { ...draft.terms!, deliveryTimeText: e.target.value } })} />
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-slate-200">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Lugar de Entrega / Ejecución</label>
                      <input className="w-full border-b border-slate-200 py-2 text-sm focus:border-blue-500 outline-none font-bold text-slate-700" value={draft.terms?.deliveryPlaceText || ''} onChange={e => setDraft({ ...draft, terms: { ...draft.terms!, deliveryPlaceText: e.target.value } })} />
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-slate-200">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Garantía</label>
                      <input className="w-full border-b border-slate-200 py-2 text-sm focus:border-blue-500 outline-none font-bold text-slate-700" value={draft.terms?.warrantyText || ''} onChange={e => setDraft({ ...draft, terms: { ...draft.terms!, warrantyText: e.target.value } })} />
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-slate-200">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Cancelación</label>
                      <textarea rows={3} className="w-full border-b border-slate-200 py-2 text-sm focus:border-blue-500 outline-none font-bold text-slate-700 resize-none" value={draft.terms?.cancellationText || ''} onChange={e => setDraft({ ...draft, terms: { ...draft.terms!, cancellationText: e.target.value } })} />
                    </div>
                  </div>
                )}

                {activeTab === 'observaciones' && (
                  <div className="space-y-6 max-w-6xl mx-auto">
                    <div className="bg-white p-6 rounded-2xl border border-slate-200">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Observaciones Generales (Visibles en PDF)</label>
                      <textarea rows={4} className="w-full border border-slate-200 rounded-xl p-4 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none font-medium text-slate-700" value={draft.notes?.publicNotes || ''} onChange={e => setDraft({ ...draft, notes: { ...draft.notes!, publicNotes: e.target.value } })} />
                    </div>

                    {draft.type === "servicio" && (
                      <div className="bg-amber-50 p-6 rounded-2xl border border-amber-200">
                        <label className="block text-[10px] font-black text-amber-700 uppercase tracking-widest mb-3">Condiciones o Requisitos Técnicos (Visibles en PDF)</label>
                        <textarea
                          rows={5}
                          className="w-full border border-amber-200 bg-white rounded-xl p-4 text-sm focus:ring-2 focus:ring-amber-500 outline-none resize-none font-medium text-slate-700"
                          placeholder="Ej: Requiere punto eléctrico 220V..."
                          value={draft.notes?.technicalObservations || ''}
                          onChange={e => setDraft({ ...draft, notes: { ...(draft.notes || defaultNotes), technicalObservations: e.target.value } })}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {showAIHelper && (
                <aside
                  className={`shrink-0 border-l border-slate-200 bg-white flex flex-col ${
                    aiExpanded ? "w-[560px]" : "w-[430px]"
                  }`}
                >
                  <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-black text-slate-900">
                        Asistente de cotización
                      </p>
                      <p className="text-[11px] text-slate-500 font-semibold mt-1">
                        Pega una cotización o varios ítems numerados.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        resetAIQuoteHelper();
                        resetQuoteDraft();
                        setShowModal(false);
                      }}
                      className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                      title="Cerrar asistente"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                          Entrada IA
                        </p>
                        {listeningStatus && (
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full animate-pulse transition-all ${
                            listeningStatus === 'preparando' 
                              ? 'bg-amber-50 text-amber-600 border border-amber-100' 
                              : 'bg-red-50 text-red-600 border border-red-100'
                          }`}>
                            {listeningStatus === 'preparando' ? 'Preparando micrófono...' : '🎙️ Ahora sí, habla'}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleToggleMic}
                          className={`p-2 rounded-xl border transition-all ${
                            isListening 
                              ? "bg-red-500 border-red-500 text-white animate-pulse" 
                              : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                          }`}
                          title={isListening ? "Detener grabación" : "Grabar con micrófono"}
                        >
                          <Mic size={14} />
                        </button>

                        <button
                          type="button"
                          onClick={() => setAiExpanded((prev) => !prev)}
                          className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-[10px] font-black uppercase tracking-widest text-blue-700 hover:bg-blue-50 transition-colors"
                        >
                          {aiExpanded ? "Compactar" : "Ampliar"}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-slate-400 font-black uppercase tracking-widest bg-slate-50/50 p-2.5 rounded-2xl border border-slate-100/80">
                      <span>Moneda Detectada:</span>
                      {(() => {
                        const detected = detectCurrencyFromPrompt(aiPrompt);
                        return (
                          <div className="flex items-center gap-1.5 ml-auto">
                            <button
                              type="button"
                              onClick={() => {
                                if (/moneda\s*:\s*[^\r\n]*/i.test(aiPrompt)) {
                                  setAiPrompt(prev => prev.replace(/moneda\s*:\s*[^\r\n]*/i, "moneda: pesos"));
                                } else {
                                  setAiPrompt(prev => {
                                    const trimmed = prev.trim();
                                    return trimmed ? `${trimmed}\nmoneda: pesos` : "moneda: pesos";
                                  });
                                }
                              }}
                              className={`px-2 py-0.5 rounded-[6px] text-[9px] font-black tracking-wider transition-all duration-300 ${
                                detected === 'COP' 
                                  ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-100 cursor-default' 
                                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 cursor-pointer'
                              }`}
                            >
                              PESOS (COP)
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (/moneda\s*:\s*[^\r\n]*/i.test(aiPrompt)) {
                                  setAiPrompt(prev => prev.replace(/moneda\s*:\s*[^\r\n]*/i, "moneda: dólares"));
                                } else {
                                  setAiPrompt(prev => {
                                    const trimmed = prev.trim();
                                    return trimmed ? `${trimmed}\nmoneda: dólares` : "moneda: dólares";
                                  });
                                }
                              }}
                              className={`px-2 py-0.5 rounded-[6px] text-[9px] font-black tracking-wider transition-all duration-300 ${
                                detected === 'USD' 
                                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-100 cursor-default' 
                                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 cursor-pointer'
                              }`}
                            >
                              DÓLARES (USD)
                            </button>
                          </div>
                        );
                      })()}
                    </div>

                    <textarea
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder={`Ej:
cotización para Ioncore, contacto Sandra Garcia, producto, USD

1) código 145, ESTANDAR DE OQPV, cantidad 1, valor 451
2) código 146, COLUMNA HPLC, cantidad 2, valor 800
3) código 147, FILTRO EN LÍNEA, cantidad 1, valor 120
4) código 148, KIT DE SELLOS, cantidad 3, valor 90`}
                      className={`w-full rounded-2xl border border-slate-200 bg-white p-4 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-y transition-all ${
                        aiExpanded ? "min-h-[560px]" : "min-h-[360px]"
                      }`}
                    />

                    <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-[11px] text-blue-700 font-semibold">
                      Para cotizaciones largas usa líneas numeradas: 1), 2), 3).
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCreateWithAI()}
                      disabled={aiLoading || !aiPrompt.trim()}
                      className="w-full px-5 py-3 rounded-xl bg-blue-600 text-white font-black text-sm hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                    >
                      {aiLoading ? "Procesando..." : "Llenar cotización"}
                    </button>

                    {aiMessage && (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 font-bold">
                        {aiMessage}
                      </div>
                    )}

                    <div className="text-[11px] text-slate-400 font-medium border-t border-slate-100 pt-4">
                      La IA puede cometer errores. Revisa los ítems, cantidades, valores y oportunidad antes de guardar.
                    </div>
                  </div>
                </aside>
              )}
            </div>

            {quoteMissingFields.length > 0 && (
              <div className="px-8 pb-2 text-xs font-semibold text-amber-700 bg-white shrink-0 flex items-center gap-3">
                <span>
                  Falta: {quoteMissingFields.join(" · ")}
                </span>

                {quoteMissingFields.includes("Oportunidad vinculada") && (
                  <>
                    <button
                      type="button"
                      onClick={() => setActiveTab("general")}
                      className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 font-black uppercase tracking-widest text-[10px] hover:bg-amber-100"
                    >
                      Ir a Datos Generales
                    </button>

                    {draft.accountId && draft.items?.length ? (
                      <button
                        type="button"
                        onClick={handleCreateOpportunityFromQuote}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 border border-blue-600 text-white font-black uppercase tracking-widest text-[10px] hover:bg-blue-700"
                      >
                        Crear oportunidad y vincular
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            )}

            <div className="px-8 py-5 border-t bg-white flex flex-col-reverse sm:flex-row sm:justify-end gap-3 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.1)] relative z-20 shrink-0">
              <button
                onClick={() => {
                  resetAIQuoteHelper();
                  resetQuoteDraft();
                  setShowModal(false);
                }}
                className="px-6 py-2 font-black text-[10px] uppercase text-slate-400 hover:text-slate-600 tracking-widest"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={!canSaveQuote}
                className={`px-10 py-3 rounded-xl font-black text-[11px] uppercase tracking-widest shadow-lg transition-all ${
                  canSaveQuote
                    ? "bg-blue-600 text-white shadow-blue-200 hover:bg-blue-700 hover:-translate-y-0.5"
                    : "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
                }`}
              >
                Guardar Cotización
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectionModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-md rounded-[28px] border border-slate-100 shadow-2xl p-7 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">Cerrar y Rechazar Cotización</h3>
              <button
                onClick={() => setRejectionModal(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Motivo del Rechazo *</label>
                <textarea
                  placeholder="Especifica el motivo (ej. precio costoso, tiempo de entrega, otra alternativa...)"
                  rows={3}
                  value={rejectionReasonText}
                  onChange={(e) => setRejectionReasonText(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none resize-none font-medium text-slate-700"
                />
              </div>

              <label className="flex items-start gap-3 cursor-pointer bg-slate-50 hover:bg-slate-100 p-4 rounded-2xl border border-slate-200/50 transition-all select-none">
                <input
                  type="checkbox"
                  checked={closeOppAsLost}
                  onChange={(e) => setCloseOppAsLost(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-0 accent-blue-600 mt-1 h-4 w-4"
                />
                <div>
                  <p className="text-xs font-black text-slate-800">Cerrar oportunidad en el embudo</p>
                  <p className="text-[10px] text-slate-500 font-semibold mt-0.5">Mover la oportunidad vinculada a la etapa "Perdido" y fijar probabilidad en 0%.</p>
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setRejectionModal(null)}
                className="px-4 py-2 font-black text-[10px] uppercase text-slate-400 hover:text-slate-600 tracking-widest"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (!rejectionReasonText.trim()) {
                    alert("Por favor, ingresa el motivo del rechazo.");
                    return;
                  }
                  updateQuoteStatus(rejectionModal.quoteId, "rechazada", rejectionReasonText, closeOppAsLost);
                  setRejectionModal(null);
                  setRefresh(r => r + 1);
                }}
                className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-widest rounded-xl shadow-lg shadow-red-100 hover:-translate-y-0.5 transition-all"
              >
                Confirmar Rechazo
              </button>
            </div>
          </div>
        </div>
      )}

      {showOCModal && (() => {
        const q = quotes.find(item => item.id === showOCModal.quoteId);
        if (!q) return null;

        const period = ocFormFechaOC.slice(0, 7);
        const budget = budgets.find(b => b.advisorId === (q.ownerId || "system") && b.periodo === period && b.tipoPeriodo === "mensual");
        const metaCurrency = budget?.monedaMeta || "COP";

        const trmVal = parseFloat(ocFormTRM) || globalTRM;
        let valorConvertido = q.total;
        let requiresConversion = q.currency !== metaCurrency;

        if (requiresConversion) {
          if (q.currency === "USD" && metaCurrency === "COP") {
            valorConvertido = q.total * trmVal;
          } else if (q.currency === "COP" && metaCurrency === "USD") {
            valorConvertido = q.total / trmVal;
          }
        }

        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
            <div className="bg-white w-full max-w-md rounded-[28px] border border-slate-100 shadow-2xl p-7 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">Registrar Orden de Compra (Con OC)</h3>
                <button
                  onClick={() => setShowOCModal(null)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Número de Orden de Compra (OC)</label>
                  <input
                    type="text"
                    placeholder="Ej. OC-2026-0892"
                    value={ocFormNumeroOC}
                    onChange={(e) => setOcFormNumeroOC(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none font-medium text-slate-700"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Fecha de la Orden de Compra (OC) *</label>
                  <input
                    type="date"
                    value={ocFormFechaOC}
                    onChange={(e) => setOcFormFechaOC(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none font-medium text-slate-700"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tasa de Cambio (TRM Aplicada) *</label>
                  <input
                    type="number"
                    value={ocFormTRM}
                    onChange={(e) => setOcFormTRM(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none font-medium text-slate-700 font-mono"
                  />
                </div>

                {/* Vista previa de conversión */}
                <div className="bg-slate-50 border border-slate-200/50 rounded-2xl p-4 space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Resumen y Conversión de Cierre</p>
                  
                  <div className="grid grid-cols-2 gap-y-2 text-xs">
                    <div>
                      <span className="text-slate-500 font-semibold">Valor original:</span>
                    </div>
                    <div className="text-right font-bold text-slate-800">
                      {formatMoneyByCurrency(q.total, q.currency)}
                    </div>

                    <div>
                      <span className="text-slate-500 font-semibold">Moneda original:</span>
                    </div>
                    <div className="text-right font-bold text-slate-800">
                      {q.currency}
                    </div>

                    {requiresConversion && (
                      <>
                        <div>
                          <span className="text-slate-500 font-semibold">TRM aplicada:</span>
                        </div>
                        <div className="text-right font-bold text-slate-800 font-mono">
                          {formatMoneyByCurrency(trmVal, "COP").replace("COP", "").trim()}
                        </div>

                        <div>
                          <span className="text-slate-500 font-semibold">Valor convertido:</span>
                        </div>
                        <div className="text-right font-black text-blue-600">
                          {formatMoneyByCurrency(valorConvertido, metaCurrency)}
                        </div>
                      </>
                    )}

                    <div>
                      <span className="text-slate-500 font-semibold">Moneda de la meta:</span>
                    </div>
                    <div className="text-right font-black text-slate-800">
                      {metaCurrency}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowOCModal(null)}
                  className="px-4 py-2 font-black text-[10px] uppercase text-slate-400 hover:text-slate-600 tracking-widest"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmOC}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-widest rounded-xl shadow-lg shadow-emerald-100 hover:-translate-y-0.5 transition-all"
                >
                  Confirmar OC
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showBudgetModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-md rounded-[28px] border border-slate-100 shadow-2xl p-7 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">Gestionar Metas Comerciales</h3>
              <button
                type="button"
                onClick={() => setShowBudgetModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Advisor Selection */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Asesor Comercial *</label>
                <select
                  value={budgetFormAdvisorId}
                  onChange={(e) => {
                    const advId = e.target.value;
                    setBudgetFormAdvisorId(advId);
                    prepopulateBudgetValue(advId, budgetFormPeriodType, budgetFormPeriod, budgetFormCurrency);
                  }}
                  className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none font-bold text-slate-700 bg-slate-50"
                >
                  <option value="">Seleccionar Asesor...</option>
                  {users.filter(u => u.role === 'asesor').map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>

              {/* Period Type Selection */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tipo de Período *</label>
                  <select
                    value={budgetFormPeriodType}
                    onChange={(e) => {
                      const type = e.target.value as any;
                      setBudgetFormPeriodType(type);
                      const newPeriod = currentPeriod(type);
                      setBudgetFormPeriod(newPeriod);
                      prepopulateBudgetValue(budgetFormAdvisorId, type, newPeriod, budgetFormCurrency);
                    }}
                    className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none font-bold text-slate-700 bg-slate-50"
                  >
                    <option value="mensual">Mensual</option>
                    <option value="trimestral">Trimestral</option>
                    <option value="anual">Anual</option>
                  </select>
                </div>

                {/* Period Selection Details */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Período *</label>
                  <select
                    value={budgetFormPeriod}
                    onChange={(e) => {
                      const period = e.target.value;
                      setBudgetFormPeriod(period);
                      prepopulateBudgetValue(budgetFormAdvisorId, budgetFormPeriodType, period, budgetFormCurrency);
                    }}
                    className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none font-bold text-slate-700 bg-slate-50"
                  >
                    {periodOptions(budgetFormPeriodType).map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Currency & Value */}
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Moneda *</label>
                  <select
                    value={budgetFormCurrency}
                    onChange={(e) => {
                      const curr = e.target.value as any;
                      setBudgetFormCurrency(curr);
                      prepopulateBudgetValue(budgetFormAdvisorId, budgetFormPeriodType, budgetFormPeriod, curr);
                    }}
                    className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none font-bold text-slate-700 bg-slate-50"
                  >
                    <option value="COP">COP</option>
                    <option value="USD">USD</option>
                  </select>
                </div>

                <div className="col-span-2 flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Presupuesto Asignado *</label>
                  <input
                    type="number"
                    placeholder="Monto de la meta..."
                    value={budgetFormValue}
                    onChange={(e) => setBudgetFormValue(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none font-bold text-slate-700 bg-slate-50"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowBudgetModal(false)}
                className="px-4 py-2 font-black text-[10px] uppercase text-slate-400 hover:text-slate-600 tracking-widest"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveBudget}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-widest rounded-xl shadow-lg shadow-blue-100 hover:-translate-y-0.5 transition-all"
              >
                Guardar Meta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}