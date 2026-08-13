/**
 * Extracción del NIT (casilla 5) y su dígito de verificación (casilla 6) del
 * RUT de la DIAN.
 *
 * Se aísla en su propio módulo porque el mismo algoritmo lo necesitan dos
 * lugares: el endpoint /api/extract-rut (que lee el PDF con pdf-parse) y el
 * parser local del navegador en services/gemini.ts. Antes cada uno tenía su
 * propia tanda de expresiones regulares y las dos fallaban en los mismos
 * casos, así que el NIT quedaba vacío mientras razón social, ciudad y
 * dirección sí se llenaban.
 *
 * Los casos que rompían el enfoque anterior:
 *
 *   1. El NIT y el DV impresos juntos ("9012345672"): el patrón exigía un
 *      límite de palabra después del noveno dígito.
 *   2. NIT que no empieza por 8 ni 9 (persona natural, cédula de 10 dígitos).
 *   3. El número de casilla siguiente pegado al valor ("901234567 6. DV"),
 *      que arrastra un "6" al final del número.
 *   4. El "4. Número de formulario" (11-14 dígitos) colándose como NIT.
 *
 * En vez de acertar con una sola regex, aquí se enumeran los números del
 * texto, se generan las lecturas posibles de cada uno y se puntúan. La señal
 * más fuerte es la aritmética: el DV se calcula a partir del NIT, así que si
 * el dígito impreso coincide con el calculado, ese candidato es casi con
 * certeza el correcto.
 *
 * Dos detalles que sólo se ven con un RUT real en la mano:
 *
 *   - El PDF de la DIAN es un formulario: primero imprime TODAS las etiquetas
 *     de la hoja y al final TODOS los valores juntos. Por eso la cercanía a la
 *     etiqueta "5. Número de Identificación Tributaria" es apenas una pista
 *     débil, no un requisito: el valor puede estar a mil caracteres.
 *   - Nunca se pueden unir dos números separados por espacios. Con el texto
 *     real "... 3 141165540998 9006664149 ..." (folio, número de formulario y
 *     NIT+DV, tres valores distintos), unirlos producía "3141165540", que por
 *     pura mala suerte tiene DV 9 válido y le ganaba al NIT verdadero
 *     900666414-9. Por eso los candidatos se arman token por token.
 */

// Pesos oficiales de la DIAN, alineados a la derecha sobre el número.
const DV_WEIGHTS = [71, 67, 59, 53, 47, 43, 41, 37, 29, 23, 19, 17, 13, 7, 3];

/** Calcula el dígito de verificación de un NIT. Devuelve "" si no aplica. */
export function computeNitDV(base: string): string {
  const digits = String(base || "").replace(/\D/g, "");
  if (!digits || digits.length > DV_WEIGHTS.length) return "";
  const weights = DV_WEIGHTS.slice(DV_WEIGHTS.length - digits.length);
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += parseInt(digits[i], 10) * weights[i];
  }
  const r = sum % 11;
  return r > 1 ? String(11 - r) : String(r);
}

export interface NitExtraction {
  /** NIT completo con guión, p. ej. "900745087-2". "" si no se encontró. */
  nit: string;
  /** Base sin DV, p. ej. "900745087". */
  base: string;
  /** Dígito de verificación. */
  dv: string;
  /** Puntaje del candidato ganador (útil para diagnóstico). */
  score: number;
  /** Cómo se obtuvo el DV: del texto, del cálculo, o ninguno. */
  dvSource: "impreso" | "calculado" | "ninguno";
}

const EMPTY: NitExtraction = { nit: "", base: "", dv: "", score: 0, dvSource: "ninguno" };

/**
 * Etiquetas que anuncian la casilla 5. El valor suele venir a menos de un par
 * de cientos de caracteres después, aunque a veces la DIAN imprime primero
 * todas las etiquetas de la fila y luego todos los valores.
 */
const NIT_ANCHORS: RegExp[] = [
  /5\s*\.?\s*N[uú]mero\s+de\s+identificaci[oó]n\s+tributaria\s*(?:\(\s*N\s*\.?\s*I\s*\.?\s*T\s*\.?\s*\))?/gi,
  /N[uú]mero\s+de\s+identificaci[oó]n\s+tributaria\s*(?:\(\s*N\s*\.?\s*I\s*\.?\s*T\s*\.?\s*\))?/gi,
  /\bN\s*\.?\s*I\s*\.?\s*T\s*\.?\s*\)?\s*[:\-]?/gi,
];

/** Ventana, en caracteres, en la que se considera que un número "pertenece" a la etiqueta. */
const ANCHOR_WINDOW = 260;

/**
 * El número de formulario es el falso positivo más común: son 11-14 dígitos
 * seguidos y aparece arriba del NIT en todas las hojas del RUT.
 */
const FORM_NUMBER_RE = /\d{0,2}\s*\.?\s*N[uú]mero\s+de\s+formulario\s*:?\s*((?:\d[\s.]?){9,16})/gi;

interface Candidate {
  base: string;
  dv: string;
  dvSource: "impreso" | "calculado";
  score: number;
}

/**
 * Localiza el DV impreso en la casilla 6. Se exige que el "6" no venga
 * precedido de otro dígito para no confundirlo con "16.", "26.", "36.", etc.
 */
function findPrintedDV(text: string): string[] {
  const found: string[] = [];
  const re = /(?:^|\D)6\s*\.\s*(?:DV|D[ií]gito\s+de\s+verificaci[oó]n)?\s*:?\s*(\d)(?!\d)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) found.push(m[1]);
  return found;
}

/** Rangos de texto ocupados por el número de formulario, para penalizarlos. */
function findFormNumberRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  FORM_NUMBER_RE.lastIndex = 0;
  while ((m = FORM_NUMBER_RE.exec(text)) !== null) {
    const start = m.index + m[0].indexOf(m[1]);
    ranges.push([start, start + m[1].length]);
  }
  return ranges;
}

interface NumberToken {
  digits: string;
  start: number;
  end: number;
}

/** Todos los números del texto, respetando los espacios como separadores. */
function tokenize(text: string): NumberToken[] {
  const tokens: NumberToken[] = [];
  // Se admiten puntos de miles y el guión del DV dentro de un mismo número
  // ("900.666.414-9"), pero nunca un espacio: dos números separados por un
  // espacio son dos casillas distintas del formulario.
  const re = /\d+(?:[.\-]\d+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ digits: m[0].replace(/\D/g, ""), start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

/** ¿Entre estas dos posiciones sólo hay espacios? */
function onlySpacesBetween(text: string, from: number, to: number): boolean {
  return to >= from && /^ *$/.test(text.slice(from, to));
}

/**
 * Arma la lista de números que vale la pena evaluar como NIT. Además de cada
 * número suelto, contempla las dos formas en que la DIAN parte el valor en
 * celdas separadas.
 */
function collectNumbers(text: string): Array<{ digits: string; start: number }> {
  const tokens = tokenize(text);
  const out: Array<{ digits: string; start: number }> = [];
  const seen = new Set<string>();

  const push = (digits: string, start: number) => {
    if (digits.length < 8 || digits.length > 24) return;
    const key = `${digits}@${start}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ digits, start });
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    push(t.digits, t.start);

    // NIT y DV en celdas contiguas: "900666414 9".
    const next = tokens[i + 1];
    if (
      next &&
      t.digits.length >= 8 && t.digits.length <= 10 &&
      next.digits.length === 1 &&
      onlySpacesBetween(text, t.end, next.start)
    ) {
      push(t.digits + next.digits, t.start);
    }

    // Un dígito por celda: "9 0 0 6 6 6 4 1 4 9". Sólo se unen dígitos
    // sueltos consecutivos, nunca números de varias cifras.
    const prev = tokens[i - 1];
    const startsGroup = !(prev && prev.digits.length === 1 && onlySpacesBetween(text, prev.end, t.start));
    if (t.digits.length === 1 && startsGroup) {
      let acc = "";
      let j = i;
      while (
        j < tokens.length &&
        tokens[j].digits.length === 1 &&
        (j === i || onlySpacesBetween(text, tokens[j - 1].end, tokens[j].start))
      ) {
        acc += tokens[j].digits;
        j++;
      }
      push(acc, t.start);
    }
  }

  return out;
}

/** Posiciones donde termina alguna etiqueta de la casilla 5. */
function findAnchorEnds(text: string): number[] {
  const ends: number[] = [];
  for (const anchor of NIT_ANCHORS) {
    anchor.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = anchor.exec(text)) !== null) {
      ends.push(m.index + m[0].length);
      if (m[0].length === 0) anchor.lastIndex++; // evita bucle infinito
    }
    if (ends.length) break; // basta con el ancla más específica que exista
  }
  return ends;
}

/**
 * Extrae el NIT y el DV de un texto plano ya obtenido del PDF del RUT.
 */
export function extractNitFromText(rawText: string): NitExtraction {
  const text = String(rawText || "").replace(/[\u00A0\s]+/g, " ").trim();
  if (!text) return { ...EMPTY };

  const printedDVs = findPrintedDV(text);
  const formRanges = findFormNumberRanges(text);
  const anchorEnds = findAnchorEnds(text);
  const numbers = collectNumbers(text);
  const candidates: Candidate[] = [];

  for (const { digits, start } of numbers) {
    const insideFormNumber = formRanges.some(([a, b]) => start >= a && start < b);
    const nearAnchor = anchorEnds.some((e) => start >= e - 4 && start <= e + ANCHOR_WINDOW);

    // Un NIT colombiano tiene entre 8 y 10 dígitos. Se prueban todos los
    // prefijos de esa longitud porque el dígito siguiente puede ser el DV
    // o basura arrastrada del número de casilla contiguo.
    for (const len of [9, 10, 8]) {
      if (digits.length < len) continue;
      const base = digits.slice(0, len);
      const computed = computeNitDV(base);
      const trailing = digits.slice(len, len + 1);

      let score = 0;
      let dv = computed;
      let dvSource: "impreso" | "calculado" = "calculado";

      if (trailing && trailing === computed) {
        // El dígito que sigue al NIT es exactamente su DV: lectura casi segura.
        score += 60;
        dv = trailing;
        dvSource = "impreso";
      } else if (printedDVs.includes(computed)) {
        // La casilla 6 imprimió el mismo DV que arroja el cálculo.
        score += 55;
        dvSource = "impreso";
      } else if (trailing) {
        // Hay dígitos de más que no son el DV: probablemente número de casilla pegado.
        score -= 5;
      }

      if (digits.length === len) score += 15;          // el número calza exacto
      if (digits.length === len + 1) score += 10;      // NIT + DV pegados
      if (len === 9 && /^[89]/.test(base)) score += 25; // NIT de empresa
      if (len === 10 && /^[1-9]/.test(base)) score += 5;
      if (nearAnchor) score += 40;
      if (insideFormNumber) score -= 90;

      // Ninguna casilla del RUT tiene más de 11 dígitos (NIT de 10 + DV). Un
      // número más largo es el número de formulario o la numeración impresa de
      // las responsabilidades ("123456789101112..."), no un NIT.
      if (digits.length > 11) score -= 40;

      if (score > 0) candidates.push({ base, dv, dvSource, score });
    }
  }

  if (!candidates.length) return { ...EMPTY };

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  return {
    nit: best.dv ? `${best.base}-${best.dv}` : best.base,
    base: best.base,
    dv: best.dv,
    score: best.score,
    dvSource: best.dvSource,
  };
}

/**
 * Normaliza un NIT que llegó de otra fuente (por ejemplo el modelo de IA),
 * completando el DV si falta. Devuelve "" si no hay nada aprovechable.
 */
export function normalizeNit(value: string, fallbackDv?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return "";

  // Si viene con guión se respeta la separación que ya trae.
  const hyphen = raw.match(/^\s*([\d.\s]{7,})-\s*(\d)\s*$/);
  if (hyphen) {
    const base = hyphen[1].replace(/\D/g, "");
    if (base.length >= 8) return `${base}-${hyphen[2]}`;
  }

  // Sin guión: si sobra un dígito y coincide con el DV calculado, se separa.
  for (const len of [9, 10, 8]) {
    if (digits.length === len + 1) {
      const base = digits.slice(0, len);
      if (computeNitDV(base) === digits.slice(len)) return `${base}-${digits.slice(len)}`;
    }
  }

  const dv = (fallbackDv || "").replace(/\D/g, "").slice(0, 1) || computeNitDV(digits);
  return dv ? `${digits}-${dv}` : digits;
}

/**
 * Devuelve un fragmento del texto alrededor de la casilla 5, para poder ver en
 * los logs qué leyó realmente pdf-parse cuando la extracción falla.
 */
export function nitDebugWindow(rawText: string): string {
  const text = String(rawText || "").replace(/[\u00A0\s]+/g, " ").trim();
  const ends = findAnchorEnds(text);
  if (!ends.length) return text.slice(0, 200);
  const start = Math.max(0, ends[0] - 60);
  return text.slice(start, ends[0] + 160);
}
