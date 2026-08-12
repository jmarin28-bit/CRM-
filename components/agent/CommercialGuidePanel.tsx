import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Flame,
  Snowflake,
  Sparkles,
  Clock,
  MessageCircle,
  Mic,
  Square,
} from "lucide-react";
import { getTodayCommercialBriefing } from "../../services/commercialGuide";

const priorityClasses: Record<string, string> = {
  alta: "border-red-200 bg-red-50 text-red-700",
  media: "border-amber-200 bg-amber-50 text-amber-700",
  baja: "border-slate-200 bg-slate-50 text-slate-600",
};

type GuideChatMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
};

type PendingGuideAction =
  | {
      type: "crear_cotizacion";
      title: string;
      detail: string;
      prompt: string;
    }
  | null;

/*****************************************************************
 * UTILERÍAS GLOBALES Y PERSISTENCIA LOCAL (SCOPE SUPERIOR)     *
 *****************************************************************/
function addDaysAtNine(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}

function updateActivityLocally(activityId: string, updates: Record<string, unknown>) {
  const key = "crm_activities_v2";

  try {
    const raw = localStorage.getItem(key);
    const activities = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(activities)) return null;

    const updatedActivities = activities.map((activity: any) => {
      if (activity.id !== activityId) return activity;

      return {
        ...activity,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
    });

    localStorage.setItem(key, JSON.stringify(updatedActivities));

    return updatedActivities.find((activity: any) => activity.id === activityId);
  } catch {
    return null;
  }
}

function normalizeGuideQuestion(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

/*****************************************************************
 * EXTRACCIÓN Y NORMALIZACIÓN DE DATOS PARA COTIZACIONES (AXIS)  *
 *****************************************************************/
function isQuoteIntent(text: string) {
  const q = normalizeGuideQuestion(text);

  return (
    q.includes("cotizacion") ||
    q.includes("cotizar") ||
    q.includes("realiza una cotizacion") ||
    q.includes("prepara una cotizacion") ||
    q.includes("crear cotizacion")
  );
}

// Check if there are enough details to proceed with quotation creation
// FLEXIBLE: acepta múltiples estructuras — no requiere un orden específico.
// Mínimo requerido: intención de cotizar + al menos UNO de: código, descripción, valor/precio
function isQuoteReadyToPrepare(text: string) {
  const q = normalizeGuideQuestion(text);

  if (!isQuoteIntent(text)) return false;

  // Señales de contenido del ítem (basta con 1 sola señal detallada)
  const hasCode = q.includes("codigo") || q.includes("referencia") || q.includes("ref ");
  const hasDescription = q.includes("descripcion") || q.includes("columna") || q.includes("filtro") ||
    q.includes("kit") || q.includes("sello") || q.includes("bomba") || q.includes("valvula") ||
    q.includes("lampara") || q.includes("cartucho") || q.includes("oring") || q.includes("o ring") ||
    q.includes("mantenimiento") || q.includes("servicio") || q.includes("producto");
  const hasValue = q.includes("valor") || q.includes("precio") || q.includes("vale") ||
    q.includes("cuesta") || /\$\s*\d/.test(text) || /\d+\s*(usd|cop|pesos|dolares)/.test(q) ||
    /\b\d{3,}\b/.test(q); // cualquier número grande sugiere un precio
  const hasQuantity = q.includes("cantidad") || q.includes("cant ") || /\bcantidad\s+\d/.test(q) ||
    /\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/.test(q);

  // Necesitamos al menos 2 señales de detalle de ítem
  const signals = [hasCode, hasDescription, hasValue, hasQuantity].filter(Boolean).length;
  return signals >= 2;
}

function getMissingQuoteInfoText(text: string) {
  const q = normalizeGuideQuestion(text);
  const missing = [];

  const hasItem = q.includes("codigo") || q.includes("descripcion") || q.includes("referencia") ||
    q.includes("columna") || q.includes("filtro") || q.includes("kit") || q.includes("servicio");
  const hasValue = q.includes("valor") || q.includes("precio") || /\$\s*\d/.test(text) || /\d{3,}/.test(q);

  if (!hasItem) missing.push("código o descripción del producto");
  if (!hasValue) missing.push("valor o precio");

  if (missing.length === 0) return "";

  return `Para preparar la cotización necesito: ${missing.join(" y ")}. Puedes usar cualquier orden: cotización [nombre] código [X] descripción [Y] cantidad [N] valor [V] pesos/dólares.`;
}

function getQuoteCurrencyInfo(text: string) {
  const originalText = text.toLowerCase();
  const q = normalizeGuideQuestion(text);

  const compact = q
    .replace(/\./g, "")
    .replace(/\bu\s*s\s*d\b/g, "usd")
    .replace(/\bu\s*s\s*a\b/g, "usd");

  // USD: solo cuando se menciona explícitamente dólar/usd/dollar
  const mentionsUsd =
    /\b(dolar|dolares|usd|usb|dollar|dollars)\b/.test(compact) ||
    /\bus\s*dolar/.test(compact) ||
    originalText.includes("us$") ||
    originalText.includes("u$s") ||
    originalText.includes("usd") ||
    compact.includes("usd") ||
    compact.includes("dolar");

  // COP: mención explícita de peso/pesos/cop
  const mentionsCop =
    /\b(peso|pesos|cop)\b/.test(compact) ||
    /pesos\s+colombianos/.test(compact) ||
    /\$col\b/.test(compact);

  // USD tiene prioridad SOLO si se menciona explícitamente Y no hay mención de COP
  if (mentionsUsd && !mentionsCop) {
    return {
      currencyLabel: "USD dólares",
      normalizedPromptSuffix: "moneda USD dólares",
    };
  }

  // COP: mención explícita siempre gana
  if (mentionsCop) {
    return {
      currencyLabel: "COP pesos colombianos",
      normalizedPromptSuffix: "moneda COP pesos colombianos",
    };
  }

  // Sin mención explícita: dejar vacío para que el fallback lo maneje
  return {
    currencyLabel: "",
    normalizedPromptSuffix: "",
  };
}

// ============================================================
// FIX MONEDA POR VOZ
// ------------------------------------------------------------
// El dictado en español (Chrome, es-CO) convierte "500 dólares" en "$500",
// perdiendo la palabra de la moneda. Como en Colombia "$" se asume COP, la
// intención de dólares se pierde. Estas utilidades hacen EXPLÍCITA la moneda
// en la transcripción antes de construir la cotización.
// ============================================================
type SpokenCurrency = "" | "USD" | "COP";

// Detecta la moneda hablada en un fragmento crudo (los resultados interinos del
// reconocimiento NO están formateados, así que aún contienen "dolares"/"pesos").
function detectSpokenCurrency(rawText: string): SpokenCurrency {
  const t = (rawText || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/\b(dolar|dolares|usd|dollar|dollars)\b/.test(t) || t.includes("us$") || t.includes("u$s")) {
    return "USD";
  }
  if (/\b(peso|pesos|cop)\b/.test(t)) {
    return "COP";
  }
  return "";
}

// Indica si el texto ya menciona explícitamente una moneda (palabra o US$/u$s).
function hasExplicitCurrencyWord(text: string): boolean {
  const t = (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\b(dolar|dolares|usd|dollar|dollars|peso|pesos|cop)\b/.test(t) || t.includes("us$") || t.includes("u$s");
}

// Reescribe montos ambiguos "$500" como "500 <moneda>" usando la pista hablada.
// Solo actúa cuando hay un "$<número>" ambiguo y NO hay ya una palabra de moneda,
// para no alterar transcripciones que ya son explícitas.
function makeCurrencyExplicitFromHint(text: string, hint: SpokenCurrency): string {
  if (!hint) return text;
  if (hasExplicitCurrencyWord(text)) return text;
  if (!/\$\s*\d/.test(text)) return text;
  const word = hint === "USD" ? "dólares" : "pesos";
  return text
    .replace(/us\$\s*([\d.,]+)/gi, (_m, num) => `${num} ${word}`)
    .replace(/\$\s*([\d.,]+)/g, (_m, num) => `${num} ${word}`)
    .replace(/\s+/g, " ")
    .trim();
}

// Fuerza una moneda concreta en el borrador (usado por el selector manual).
// Convierte "$500" y normaliza cualquier palabra de moneda existente; si no hay
// ninguna mención de moneda, la agrega al final.
function forceDraftCurrency(text: string, currency: "USD" | "COP"): string {
  const word = currency === "USD" ? "dólares" : "pesos";
  let t = (text || "")
    .replace(/us\$\s*([\d.,]+)/gi, (_m, num) => `${num} ${word}`)
    .replace(/\$\s*([\d.,]+)/g, (_m, num) => `${num} ${word}`)
    .replace(/\b(d[oó]lares|d[oó]lar|usd|dollars?|pesos|peso|cop)\b/gi, word);
  if (!new RegExp(`\\b${word}\\b`, "i").test(t)) {
    t = `${t} ${word}`.trim();
  }
  return t.replace(/\s+/g, " ").trim();
}

function normalizeQuotePromptForAxis(text: string) {
  const originalText = text.trim();
  const currencyInfo = getQuoteCurrencyInfo(originalText);

  // ===== CLIENTE =====
  // Captura nombre cuando viene precedido de: "para", "cliente", "empresa", "a nombre de", "cotizacion", "cotizar"
  const clientMatch = originalText.match(
    /\b(?:para|cliente|empresa|a nombre de|cotizaci[oó]n|cotizar)\s+(.+?)(?=\s+(?:contacto|con|c[oó]digo|codigo|referencia|ref|cantidad|cant|valor|precio|vale|cuesta|moneda|peso|pesos|cop|d[oó]lar|d[oó]lares|usd|[,.;])\b|$)/i
  );
  let client = clientMatch?.[1]?.trim() || "";
  client = client.replace(/^[:,]/, '').trim();
  // Limpiar prefijos extra que se capturan cuando cotización los incluye
  client = client.replace(/^para\s+/i, '').trim();
  client = client.replace(/^a\s+nombre\s+de\s+/i, '').trim();
  if (client.endsWith(',')) client = client.slice(0, -1).trim();

  // ===== CONTACTO =====
  // Intento 1: con keyword "contacto" o "con"
  const contactMatch = originalText.match(
    /\b(?:contacto|con)\s+(.+?)(?=\s+(?:para|cliente|empresa|c[oó]digo|codigo|referencia|ref|cantidad|cant|valor|precio|vale|cuesta|moneda|peso|pesos|cop|d[oó]lar|d[oó]lares|usd|[,.;])\b|$)/i
  );
  let contact = contactMatch?.[1]?.trim() || "";
  contact = contact.replace(/^[:,]/, '').trim();
  if (contact.endsWith(',')) contact = contact.slice(0, -1).trim();

  // Intento 2 (sin keyword): detectar Nombre Apellido en el texto cuando no hay keyword "contacto"
  // Busca 2-3 palabras capitalizadas que NO sean parte del nombre del cliente
  if (!contact) {
    // Patron: dos o tres palabras con mayúscula inicial seguidas de fin de texto, coma, o keyword
    const personNameRegex = /\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{1,}(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{1,}){1,2})\s*(?=,|;|\bpesos\b|\bcop\b|\bdólar|\busd\b|\bvalor\b|\bprecio\b|\bcódigo\b|\bcodigo\b|\bcantidad\b|$)/g;
    const clientNorm = (client || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    let nameMatch;
    let candidateContact = "";
    let candidateIndex = -1;

    while ((nameMatch = personNameRegex.exec(originalText)) !== null) {
      const candidate = nameMatch[1].trim();
      const candidateNorm = candidate.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      // Descartar si es parte del nombre del cliente o de palabras clave de moneda/descripción
      const isClientWord = clientNorm && clientNorm.includes(candidateNorm.split(" ")[0]);
      const isCurrencyWord = /\b(pesos?|cop|usd|d[oó]lares?)\b/i.test(candidate);
      if (!isClientWord && !isCurrencyWord && candidate.split(" ").length >= 2) {
        candidateContact = candidate;
        candidateIndex = nameMatch.index;
      }
    }
    if (candidateContact) {
      contact = candidateContact;
    }
  }

  // Find all code matches to segment items
  const codeRegex = /\b(?:c[oó]digo|codigo|referencia|ref)\s+([A-Za-z0-9\-_.]+)/gi;
  const matches: { index: number; value: string; code: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = codeRegex.exec(originalText)) !== null) {
    matches.push({
      index: m.index,
      value: m[0],
      code: m[1]
    });
  }

  const segments: { text: string; code: string; codeMatchValue: string }[] = [];
  if (matches.length <= 1) {
    // Single item logic (legacy fallback)
    segments.push({
      text: originalText,
      code: matches[0]?.code || "",
      codeMatchValue: matches[0]?.value || ""
    });
  } else {
    // Multi-item logic: segment the text
    for (let i = 0; i < matches.length; i++) {
      const start = i === 0 ? 0 : matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : originalText.length;
      segments.push({
        text: originalText.substring(start, end),
        code: matches[i].code,
        codeMatchValue: matches[i].value
      });
    }
  }

  const lines: string[] = [];
  if (client) lines.push(`Cliente: ${client}`);
  if (contact) lines.push(`Contacto: ${contact}`);

  // Process each segment as an item
  segments.forEach((seg, idx) => {
    const segmentText = seg.text;
    const code = seg.code;

    // ===== CANTIDAD =====
    const quantityMatch = segmentText.match(
      /\b(?:cantidad|cant)\s+(?:de\s+)?(\d+(?:[.,]\d+)?|una|uno|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)/i
    );
    let quantity = quantityMatch?.[1]?.replace(",", ".").trim() || "1";
    const quantityWords: Record<string, string> = {
      un: "1", uno: "1", una: "1",
      dos: "2", tres: "3", cuatro: "4", cinco: "5",
      seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10"
    };
    quantity = quantityWords[quantity.toLowerCase()] || quantity;

    // ===== VALOR =====
    const valueMatch =
      segmentText.match(
        /\b(?:valor|precio|vale|cuesta)\s*(?:unitario)?\s*\$?\s*([\d.,]+)/i
      ) ||
      segmentText.match(/\$\s*([\d.,]+)/i) ||
      segmentText.match(/([\d.,]+)\s*(?:d[oó]lares|dólares|usd|pesos|cop)\b/i);
    const value = valueMatch?.[1]?.trim() || "";

    // ===== DESCRIPCIÓN =====
    let description = "";
    if (seg.codeMatchValue) {
      const codeIndexInSeg = segmentText.indexOf(seg.codeMatchValue);
      const afterCode = segmentText.substring(codeIndexInSeg + seg.codeMatchValue.length);
      const descMatch = afterCode.match(
        /^\s*,?\s*(.+?)(?=\s*,?\s*(?:cantidad|cant|valor|precio|vale|cuesta|moneda|peso|pesos|cop|d[oó]lar|d[oó]lares|usd)\b|$)/i
      );
      if (descMatch?.[1]) {
        let rawDesc = descMatch[1].trim();
        // Si el contacto fue detectado, eliminarlo de la descripción
        if (contact) {
          const escapedContact = contact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          rawDesc = rawDesc.replace(new RegExp(escapedContact, "gi"), "").trim();
        }
        description = rawDesc;
      }
    }

    if (!description) {
      description = segmentText;
      if (idx === 0) {
        // Only clean header info from the first segment
        if (clientMatch?.[0]) description = description.replace(clientMatch[0], " ");
        if (contactMatch?.[0]) description = description.replace(contactMatch[0], " ");
      }
      if (seg.codeMatchValue) {
        description = description.replace(seg.codeMatchValue, " ");
      }
      if (quantityMatch?.[0]) description = description.replace(quantityMatch[0], " ");
      if (valueMatch?.[0]) description = description.replace(valueMatch[0], " ");

      // Limpiar el contacto detectado (con o sin keyword) de la descripción
      if (contact) {
        const escapedContact = contact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        description = description.replace(new RegExp(escapedContact, "gi"), " ");
      }

      description = description
        .replace(/\b(?:moneda|peso|pesos|cop|colombiano|colombianos|d[oó]lar|d[oó]lares|usd|us\$|u\$s)\b/gi, " ")
        .replace(/\b(?:hola|necesito|quiero|realiza|realizar|prepara|preparar|crear|crea|haz|hacer)\b/gi, " ")
        .replace(/\b(?:una|un)?\s*cotizaci[oó]n\b/gi, " ")
        .replace(/[,:;]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    description = description
      .replace(/^\s*[,.:;-]+\s*/, "")
      .replace(/\s*[,.:;-]+\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();

    lines.push(`Ítem ${idx + 1}:`);
    if (code) lines.push(`Código: ${code}`);
    if (description) lines.push(`Descripción: ${description}`);
    lines.push(`Cantidad: ${quantity}`);
    if (value) lines.push(`Valor unitario: ${value}`);
  });

  let finalCurrency = currencyInfo.currencyLabel;
  if (!finalCurrency) {
    const ql = originalText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (/\b(dolar|dolares|usd)\b/.test(ql)) {
      finalCurrency = "USD dólares";
    } else if (/\b(peso|pesos|cop)\b/.test(ql)) {
      finalCurrency = "COP pesos colombianos";
    } else if (/\$\s*\d/.test(originalText)) {
      // En Colombia $ = pesos colombianos por defecto (NO dólares)
      finalCurrency = "COP pesos colombianos";
    }
    // Si no hay ninguna señal de moneda, no forzamos nada → el parser de Quotes usará COP por defecto
  }

  if (finalCurrency) lines.push(`Moneda: ${finalCurrency}`);

  return {
    prompt: lines.join("\n"),
    currencyLabel: finalCurrency,
  };
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center">
      <CheckCircle2 className="mx-auto mb-2 text-emerald-500" size={24} />
      <p className="text-sm font-semibold text-slate-800">
        No hay pendientes críticos visibles.
      </p>
      <p className="mt-1 text-xs text-slate-500">
        El agente no encontró vencidos ni riesgos urgentes por ahora.
      </p>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="rounded-xl bg-slate-100 p-2 text-slate-600">
          {icon}
        </div>
        <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

function GuideItemCard({
  title,
  detail,
  priority,
  actions,
}: {
  title: string;
  detail: string;
  priority: "alta" | "media" | "baja";
  actions?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">{title}</p>
          {detail && (
            <p className="mt-1 whitespace-pre-line text-sm text-slate-600">
              {detail}
            </p>
          )}
        </div>

        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase ${
            priorityClasses[priority] || priorityClasses.baja
          }`}
        >
          {priority}
        </span>
      </div>
      {actions && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {actions}
        </div>
      )}
    </div>
  );
}

/*****************************************************************
 * COMPONENTE PRINCIPAL PANEL                                    *
 *****************************************************************/
export default function CommercialGuidePanel() {
  const [refreshKey, setRefreshKey] = useState(0);
  const briefing = useMemo(() => getTodayCommercialBriefing(), [refreshKey]);
  const [chatInput, setChatInput] = useState("");
  const [pendingVoiceDraft, setPendingVoiceDraft] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingGuideAction>(null);
  const [chatMessages, setChatMessages] = useState<GuideChatMessage[]>([
    {
      id: "welcome",
      role: "agent",
      content:
        "Hola. Soy el Director Comercial IA. Activa el micrófono, dime tu instrucción y al detenerlo responderé automáticamente en texto y voz.",
    },
  ]);

  const recognitionRef = useRef<any>(null);
  const voiceProcessTimeoutRef = useRef<number | null>(null);
  const voiceFinalTextRef = useRef("");
  const voiceInterimTextRef = useRef("");
  const voiceSubmittedRef = useRef(false);
  const ignoreVoiceInputRef = useRef(false);
  // Moneda detectada mientras se dicta (antes de que Chrome colapse "dólares" a "$").
  const spokenCurrencyRef = useRef<SpokenCurrency>("");
  const [isListening, setIsListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastAgentResponse, setLastAgentResponse] = useState("");

  const hasMainItems =
    briefing.overdueFollowUps.length > 0 ||
    briefing.todayFollowUps.length > 0 ||
    briefing.riskOpportunities.length > 0 ||
    briefing.coldAccounts.length > 0;

  const orphanFollowUps = [
    ...briefing.overdueFollowUps,
    ...briefing.todayFollowUps,
    ...briefing.upcomingFollowUps,
  ].filter((item) =>
    `${item.title} ${item.detail}`
      .toLowerCase()
      .includes("empresa no encontrada")
  );

  const orphanOpportunities = briefing.riskOpportunities.filter((item) =>
    `${item.title} ${item.detail}`
      .toLowerCase()
      .includes("empresa no encontrada")
  );

  // ----------------------------------------------------------------
  // buildAgentAnswer — condiciones específicas PRIMERO, resumen al final
  // ----------------------------------------------------------------
  const buildAgentAnswer = (question: string) => {
    const q = normalizeGuideQuestion(question);

    if (!q) {
      return "Escribe una pregunta para revisar tus pendientes comerciales.";
    }

    // Identificar la intención de pendientes para MAÑANA
    const isTomorrowIntent =
      q.includes("manana") ||
      q.includes("mañana") ||
      q.includes("proximos dias") ||
      q.includes("próximos días") ||
      q.includes("agenda de manana") ||
      q.includes("agenda de mañana");

    // Identificar la intención de seguimientos diarios (Plan operativo)
    const isFollowUpIntent =
      !isTomorrowIntent && (
        q.includes("seguimientos tengo") ||
        q.includes("pendiente hoy") ||
        q.includes("pendientes hoy") ||
        q.includes("llamadas tengo hoy") ||
        q.includes("hacer hoy en seguimientos") ||
        q.includes("seguimientos del dia") ||
        q.includes("seguimiento del dia") ||
        q.includes("actividades tengo vencidas") ||
        q.includes("llamadas debo hacer hoy") ||
        q.includes("actividades para hoy")
      );

    // Identificar si la pregunta solicita el resumen comercial general
    const isBriefingIntent =
      !isTomorrowIntent &&
      !isFollowUpIntent && (
        q.includes("resumen comercial") ||
        q.includes("informe comercial") ||
        q.includes("briefing") ||
        q.includes("debo revisar hoy") ||
        q.includes("debo revisar el dia") ||
        q.includes("hago primero hoy") ||
        (q.includes("resumen") && (q.includes("hoy") || q.includes("del dia"))) ||
        (q.includes("informe") && (q.includes("hoy") || q.includes("del dia"))) ||
        (q.includes("briefing") && (q.includes("hoy") || q.includes("del dia"))) ||
        (q.includes("pendiente") && (q.includes("hoy") || q.includes("del dia"))) ||
        (q.includes("que tengo") && (q.includes("hoy") || q.includes("del dia")) && !q.includes("vencido") && !q.includes("para"))
      );

    if (isTomorrowIntent) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
      const dateStr = tomorrow.toLocaleDateString('es-CO', options);
      const capDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

      const parts: string[] = [];
      parts.push(`Pendientes para mañana - ${capDate}\n`);
      parts.push("Como tu Director Comercial IA, revisé tu agenda y compromisos programados para el día de mañana.\n");

      const tomorrowItems = briefing.tomorrowFollowUps || [];

      if (tomorrowItems.length > 0) {
        parts.push(`Tienes ${tomorrowItems.length} seguimiento(s) o compromiso(s) programado(s) para mañana:`);
        tomorrowItems.forEach((item, index) => {
          parts.push(`${index + 1}. ${item.title} — ${item.detail}`);
        });
      } else {
        parts.push("No tienes seguimientos ni reuniones programadas para mañana.");
      }

      if (briefing.overdueFollowUps && briefing.overdueFollowUps.length > 0) {
        parts.push(`\nNota: Tienes ${briefing.overdueFollowUps.length} seguimiento(s) vencido(s) que requieren tu atención hoy antes de pasar a la agenda de mañana.`);
      }

      return parts.join("\n");
    }

    if (isFollowUpIntent) {
      const parts: string[] = [];
      const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
      const dateStr = new Date().toLocaleDateString('es-CO', options);
      const capDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
      parts.push(`Seguimientos para hoy - ${capDate}\n`);
      parts.push("Como tu Director Comercial IA, revisé tus actividades, llamadas, reuniones, cotizaciones, notas de voz y recordatorios. Este es el plan operativo recomendado para hoy.\n");

      const helperPrint = (title: string, items: any[], emptyMsg: string, filterFn?: (i: any) => boolean) => {
        parts.push(title);
        const filtered = filterFn ? items.filter(filterFn) : items;
        if (!filtered || filtered.length === 0) {
          parts.push(emptyMsg);
        } else {
          filtered.slice(0, 5).forEach((item, index) => {
            parts.push(`${index + 1}. ${item.detail || item.title}`);
          });
          if (filtered.length > 5) {
            parts.push(`(y ${filtered.length - 5} más)`);
          }
        }
        parts.push("");
      };

      parts.push("Prioridad crítica\n");
      
      if (briefing.overdueFollowUps && briefing.overdueFollowUps.length > 0) {
        parts.push(`Seguimientos y actividades vencidas (${briefing.overdueFollowUps.length}):`);
        briefing.overdueFollowUps.slice(0, 5).forEach((item, index) => {
          parts.push(`${index + 1}. ${item.detail || item.title}`);
        });
        parts.push("");
      } else {
        parts.push("Actividades vencidas:\nNo tienes actividades vencidas.\n");
      }

      parts.push("Prioridad alta\n");
      helperPrint("Cotizaciones enviadas sin OC:", briefing.pendingQuotes || [], "No tienes cotizaciones enviadas sin OC.", (i) => i.detail.toLowerCase().includes("enviada sin oc"));
      helperPrint("Cotizaciones pendientes internas:", briefing.pendingQuotes || [], "No tienes cotizaciones pendientes internas.", (i) => i.detail.toLowerCase().includes("pendiente interno"));
      helperPrint("Visitas programadas:", briefing.todayFollowUps || [], "No tienes visitas programadas para hoy.", (i) => i.detail.toLowerCase().includes("visita") || i.detail.toLowerCase().includes("reunion") || i.detail.toLowerCase().includes("llamada"));

      parts.push("Prioridad rutinaria\n");
      const notesAndReminders = [...(briefing.todayTasks || []), ...(briefing.memoryAlerts || [])];
      helperPrint("Notas de voz y recordatorios procesados:", notesAndReminders, "No hay notas de voz pendientes de convertir en acciones.");

      parts.push("Acciones que puedo ayudarte a ejecutar:");
      parts.push("1. Crear llamadas de seguimiento.");
      parts.push("2. Programar recordatorios.");
      parts.push("3. Abrir cuenta.");
      parts.push("4. Abrir contacto.");
      parts.push("5. Abrir cotización.");
      parts.push("6. Abrir oportunidad.");
      parts.push("7. Preparar correo.");
      parts.push("8. Preparar WhatsApp.");
      parts.push("9. Convertir nota de voz en tarea.");
      parts.push("10. Reprogramar actividad vencida.");
      parts.push("");
      parts.push("¿Quieres que te ayude con alguna de estas acciones ahora mismo?");

      return parts.join("\n");
    }

    if (isBriefingIntent) {
      const parts: string[] = [];

      parts.push("Resumen comercial de hoy\n");

      // 1. Seguimientos vencidos
      parts.push("Seguimientos vencidos:");
      if (briefing.overdueFollowUps && briefing.overdueFollowUps.length > 0) {
        briefing.overdueFollowUps.forEach((item, index) => {
          parts.push(`${index + 1}. ${item.title} — ${item.detail}`);
        });
        parts.push("");
      } else {
        parts.push("No tienes seguimientos vencidos.");
        parts.push("");
      }

      // 2. Seguimientos para hoy
      parts.push("Seguimientos para hoy:");
      if (briefing.todayFollowUps && briefing.todayFollowUps.length > 0) {
        briefing.todayFollowUps.forEach((item, index) => {
          parts.push(`${index + 1}. ${item.title} — ${item.detail}`);
        });
        parts.push("");
      } else {
        parts.push("No tienes seguimientos programados para hoy.");
        parts.push("");
      }

      // 3. Oportunidades en riesgo
      const validRiskOpps = (briefing.riskOpportunities || []).filter(
        (item) => !item.detail.toLowerCase().includes("oportunidad sin cuenta vinculada")
      );
      parts.push("Oportunidades en riesgo:");
      if (validRiskOpps.length > 0) {
        validRiskOpps.forEach((item, index) => {
          parts.push(`${index + 1}. ${item.title} — ${item.detail}`);
        });
        parts.push("");
      } else {
        parts.push("No tienes oportunidades en riesgo.");
        parts.push("");
      }

      // 4. Oportunidades sin cuenta vinculada
      const orphanRiskOpps = (briefing.riskOpportunities || []).filter(
        (item) => item.detail.toLowerCase().includes("oportunidad sin cuenta vinculada")
      );
      if (orphanRiskOpps.length > 0) {
        parts.push("Oportunidades sin cuenta vinculada:");
        orphanRiskOpps.forEach((item, index) => {
          parts.push(`${index + 1}. ${item.title} — ${item.detail}`);
        });
        parts.push("");
      }

      // 5. Cuentas frías
      parts.push("Cuentas frías:");
      if (briefing.coldAccounts && briefing.coldAccounts.length > 0) {
        briefing.coldAccounts.forEach((item, index) => {
          parts.push(`${index + 1}. ${item.title} — ${item.detail}`);
        });
        parts.push("");
      } else {
        parts.push("No tienes cuentas frías.");
        parts.push("");
      }

      // 6. Cotizaciones en borrador/enviadas/sin respuesta
      const pendingQuotes = briefing.pendingQuotes || [];
      parts.push("Cotizaciones pendientes o borradores:");
      if (pendingQuotes.length > 0) {
        pendingQuotes.forEach((item, index) => {
          parts.push(`${index + 1}. ${item.detail}`);
        });
        parts.push("");
      } else {
        parts.push("No tienes cotizaciones pendientes de revisión o envío.");
        parts.push("");
      }

      // 7. Recordatorios del día (Tareas y Memorias abiertas)
      const todayTasks = briefing.todayTasks || [];
      const memoryAlerts = briefing.memoryAlerts || [];
      if (todayTasks.length > 0 || memoryAlerts.length > 0) {
        parts.push("Recordatorios y tareas del día:");
        let rIdx = 1;
        todayTasks.forEach((t) => {
          parts.push(`${rIdx++}. [Tarea] ${t.title} — ${t.detail}`);
        });
        memoryAlerts.forEach((m) => {
          parts.push(`${rIdx++}. [Memoria] ${m.title} — ${m.detail}`);
        });
        parts.push("");
      }

      // 8. Recomendación de prioridad
      parts.push("Recomendación:");
      if (briefing.recommendations && briefing.recommendations.length > 0) {
        briefing.recommendations.forEach((rec, index) => {
          parts.push(`${index + 1}. ${rec}`);
        });
      } else {
        parts.push("No hay recomendaciones en este momento.");
      }

      const hasAnyPending =
        (briefing.overdueFollowUps && briefing.overdueFollowUps.length > 0) ||
        (briefing.todayFollowUps && briefing.todayFollowUps.length > 0) ||
        validRiskOpps.length > 0 ||
        orphanRiskOpps.length > 0 ||
        (briefing.coldAccounts && briefing.coldAccounts.length > 0) ||
        pendingQuotes.length > 0 ||
        todayTasks.length > 0 ||
        memoryAlerts.length > 0;

      if (!hasAnyPending) {
        return "No tienes seguimientos ni tareas pendientes para hoy. Todo el radar comercial está al día.";
      }

      return parts.join("\n");
    }

    // 1. Seguimientos vencidos / atrasados (específico)
    if (q.includes("vencido") || q.includes("atrasado")) {
      if (briefing.overdueFollowUps.length === 0) {
        return "No tienes seguimientos vencidos visibles.";
      }

      return [
        `Tienes ${briefing.overdueFollowUps.length} seguimiento(s) vencido(s):`,
        ...briefing.overdueFollowUps.map(
          (item, index) => `${index + 1}. ${item.title} — ${item.detail}`
        ),
      ].join("\n");
    }

    // 2. Seguimientos para hoy (específico)
    if ((q.includes("hoy") || q.includes("del dia")) && !q.includes("vencido")) {
      if (briefing.todayFollowUps.length === 0) {
        return "No tienes seguimientos pendientes para hoy.";
      }

      return [
        `Tienes ${briefing.todayFollowUps.length} seguimiento(s) para hoy:`,
        ...briefing.todayFollowUps.map(
          (item, index) => `${index + 1}. ${item.title} — ${item.detail}`
        ),
      ].join("\n");
    }

    // 3. Oportunidades en riesgo (específico)
    if (q.includes("oportunidad") || q.includes("riesgo") || q.includes("negociacion")) {
      if (briefing.riskOpportunities.length === 0) {
        return "No veo oportunidades en riesgo en este momento.";
      }

      return [
        `Tienes ${briefing.riskOpportunities.length} oportunidad(es) en riesgo:`,
        ...briefing.riskOpportunities.map(
          (item, index) => `${index + 1}. ${item.title} — ${item.detail}`
        ),
      ].join("\n");
    }

    // 4. Empresas huérfanas / datos dañados (específico)
    if (
      q.includes("empresa no encontrada") ||
      q.includes("no encontrada") ||
      q.includes("danado") ||
      q.includes("dañado") ||
      q.includes("huerfano")
    ) {
      const totalOrphans = orphanFollowUps.length + orphanOpportunities.length;

      if (totalOrphans === 0) {
        return "No encontré registros huérfanos visibles en el radar actual.";
      }

      return [
        `Encontré ${totalOrphans} registro(s) con empresa no encontrada.`,
        `Seguimientos afectados: ${orphanFollowUps.length}.`,
        `Oportunidades afectadas: ${orphanOpportunities.length}.`,
        "",
        "Esto normalmente pasa por datos antiguos de prueba, cuentas eliminadas o actividades que quedaron sin vínculo válido.",
        "",
        "Siguiente paso recomendado: no borrarlos todavía. Primero podemos agregar una acción segura para marcarlos como realizados u ocultarlos del radar.",
      ].join("\n");
    }

    // 5. Cuentas frías (específico)
    if (q.includes("fria") || q.includes("fría") || q.includes("cuenta fria")) {
      if (briefing.coldAccounts.length === 0) {
        return "No veo cuentas frías en el radar actual.";
      }

      return [
        `Tienes ${briefing.coldAccounts.length} cuenta(s) fría(s):`,
        ...briefing.coldAccounts.map(
          (item, index) => `${index + 1}. ${item.title} — ${item.detail}`
        ),
      ].join("\n");
    }

    // 6. Recomendaciones (específico)
    if (
      q.includes("recomendacion") ||
      q.includes("recomendaciones") ||
      q.includes("que hago") ||
      q.includes("primero")
    ) {
      if (briefing.recommendations.length === 0) {
        return "No tengo recomendaciones críticas por ahora.";
      }

      return [
        "Estas son mis recomendaciones principales:",
        ...briefing.recommendations.map(
          (item, index) => `${index + 1}. ${item}`
        ),
      ].join("\n");
    }

    // 7. Resumen general de pendientes (ÚLTIMO — no captura preguntas específicas)
    if (q.includes("pendiente") || q.includes("que tengo") || q.includes("resumen") || q.includes("todo")) {
      return [
        `Tienes ${briefing.totalPending} pendientes importantes.`,
        `Vencidos: ${briefing.overdueFollowUps.length}.`,
        `Para hoy: ${briefing.todayFollowUps.length}.`,
        `Oportunidades en riesgo: ${briefing.riskOpportunities.length}.`,
        briefing.totalPending > 0
          ? "Mi recomendación: empieza por los seguimientos vencidos y luego revisa oportunidades en riesgo."
          : "No veo pendientes críticos por ahora.",
      ].join("\n");
    }

    return [
      "Puedo ayudarte con estas preguntas:",
      "• ¿Qué tengo pendiente?",
      "• ¿Qué seguimientos están vencidos?",
      "• ¿Qué tengo para hoy?",
      "• ¿Qué empresas no aparecen?",
      "• ¿Qué oportunidades están en riesgo?",
      "• ¿Qué hago primero?",
    ].join("\n");
  };

  const askAgent = (question: string, speak = false) => {
    const cleanQuestion = question.trim();
    if (!cleanQuestion) return;

    const normalizedQuestion = normalizeGuideQuestion(cleanQuestion);

    // El Agente Guía no crea cotizaciones. Las cotizaciones se crean desde
    // Axis (por voz) o directamente en el módulo de Cotizaciones.
    if (isQuoteIntent(cleanQuestion)) {
      const answer =
        "El Agente Guía no maneja cotizaciones. Para crear una cotización usa Axis (dictado por voz) o entra directamente al módulo de Cotizaciones.";

      const userMessage: GuideChatMessage = {
        id: `user_${Date.now()}`,
        role: "user",
        content: cleanQuestion,
      };

      const agentMessage: GuideChatMessage = {
        id: `agent_${Date.now()}`,
        role: "agent",
        content: answer,
      };

      setPendingAction(null);

      setChatMessages((prev) => [...prev, userMessage, agentMessage]);
      setLastAgentResponse(answer);

      if (speak) {
        window.setTimeout(() => {
          speakAgentResponse(answer);
        }, 450);
      }

      return;
    }

    const answer = buildAgentAnswer(cleanQuestion);

    const userMessage: GuideChatMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      content: cleanQuestion,
    };

    const agentMessage: GuideChatMessage = {
      id: `agent_${Date.now()}`,
      role: "agent",
      content: answer,
    };

    setChatMessages((prev) => [...prev, userMessage, agentMessage]);
    setLastAgentResponse(answer);

    if (speak) {
      window.setTimeout(() => {
        speakAgentResponse(answer);
      }, 450);
    }
  };

  const speakAgentResponse = (text: string) => {
    const cleanText = text
      .replace(/[•🔥⚠️✅❄️📈]/g, "")
      .replace(/\n+/g, ". ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanText) return;

    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setVoiceStatus("La voz no está disponible en este navegador.");
      return;
    }

    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = "es-CO";
    utterance.rate = 0.95;
    utterance.pitch = 1;

    utterance.onstart = () => {
      setIsSpeaking(true);
      setVoiceStatus("Reproduciendo respuesta...");
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setVoiceStatus("");
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
      setVoiceStatus("");
    };

    window.setTimeout(() => {
      window.speechSynthesis.speak(utterance);
    }, 100);
  };

  const processVoiceQuestion = (rawQuestion: string) => {
    const question = rawQuestion.trim();

    if (!question) {
      setChatInput("");
      setVoiceStatus("No detecté una instrucción para procesar.");
      return;
    }

    voiceSubmittedRef.current = true;
    ignoreVoiceInputRef.current = true;
    voiceFinalTextRef.current = "";
    voiceInterimTextRef.current = "";

    try {
      const currentRecognition = recognitionRef.current;

      if (currentRecognition) {
        currentRecognition.onresult = null;
        currentRecognition.onend = null;
        currentRecognition.onerror = null;
        currentRecognition.abort?.();
      }
    } catch {}

    recognitionRef.current = null;

    if (voiceProcessTimeoutRef.current) {
      window.clearTimeout(voiceProcessTimeoutRef.current);
      voiceProcessTimeoutRef.current = null;
    }

    setIsListening(false);
    setChatInput("");
    setVoiceStatus("Analizando instrucción...");

    askAgent(question, true);

    window.setTimeout(() => {
      setChatInput("");
      setVoiceStatus("");
      voiceFinalTextRef.current = "";
      voiceInterimTextRef.current = "";
    }, 700);

    window.setTimeout(() => {
      ignoreVoiceInputRef.current = false;
    }, 1800);
  };

  const stopAgentVoice = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setVoiceStatus("");
  };

  const startAgentListening = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("El micrófono por navegador no está disponible en este entorno.");
      return;
    }

    try {
      recognitionRef.current?.abort?.();
    } catch {}

    if (voiceProcessTimeoutRef.current) {
      window.clearTimeout(voiceProcessTimeoutRef.current);
      voiceProcessTimeoutRef.current = null;
    }

    stopAgentVoice();

    voiceFinalTextRef.current = "";
    voiceInterimTextRef.current = "";
    voiceSubmittedRef.current = false;
    ignoreVoiceInputRef.current = false;
    spokenCurrencyRef.current = "";
    setPendingVoiceDraft("");

    const recognition = new SpeechRecognition();
    recognition.lang = "es-CO";
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onstart = () => {
      setIsListening(true);
      setChatInput("");
      setVoiceStatus(
        "Escuchando... habla toda la instrucción. Cuando termines, presiona detener y el Director responderá."
      );
    };

    recognition.onresult = (event: any) => {
      if (voiceSubmittedRef.current || ignoreVoiceInputRef.current) return;

      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const resultText = event.results[i][0].transcript || "";

        // Capturar la moneda hablada. Los resultados interinos NO están
        // formateados, así que "dólares"/"pesos" aún aparecen aquí antes de que
        // Chrome los convierta a "$". Guardamos la última moneda detectada.
        const spoken = detectSpokenCurrency(resultText);
        if (spoken) {
          spokenCurrencyRef.current = spoken;
        }

        if (event.results[i].isFinal) {
          voiceFinalTextRef.current = `${voiceFinalTextRef.current} ${resultText}`.trim();
        } else {
          interimText += resultText + " ";
        }
      }

      voiceInterimTextRef.current = interimText.trim();

      const fullText = `${voiceFinalTextRef.current} ${voiceInterimTextRef.current}`.trim();

      setChatInput(fullText);

      if (fullText) {
        setVoiceStatus(
          `Te escucho: "${fullText}". Sigue hablando. Cuando termines, presiona detener y el Director responderá.`
        );
      }
    };

    recognition.onerror = (event: any) => {
      setIsListening(false);

      const errorCode = event?.error || "desconocido";

      if (errorCode === "not-allowed") {
        setVoiceStatus("");
        alert("Permiso de micrófono denegado.");
        return;
      }

      if (errorCode === "no-speech") {
        setVoiceStatus("No detecté voz. Intenta de nuevo hablando más cerca del micrófono.");
        return;
      }

      setVoiceStatus("");
      alert(`Error de micrófono: ${errorCode}`);
    };

    recognition.onend = () => {
      setIsListening(false);

      if (voiceSubmittedRef.current || ignoreVoiceInputRef.current) {
        return;
      }

      const rawFinalText = `${voiceFinalTextRef.current} ${voiceInterimTextRef.current}`.trim();
      // Hacer explícita la moneda si el dictado quedó como "$500".
      const finalText = makeCurrencyExplicitFromHint(rawFinalText, spokenCurrencyRef.current);

      if (finalText) {
        setChatInput(finalText);
        setPendingVoiceDraft(finalText);
        setVoiceStatus("Revisa la instrucción. Si está bien, presiona Confirmar. Si quedó mal, corrígela o cancélala.");
      } else {
        setChatInput("");
        setPendingVoiceDraft("");
        setVoiceStatus("Micrófono detenido. No detecté una instrucción.");
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopAgentListening = () => {
    const rawFinalText = `${voiceFinalTextRef.current} ${voiceInterimTextRef.current}`.trim();
    // Hacer explícita la moneda si el dictado quedó como "$500".
    const finalText = makeCurrencyExplicitFromHint(rawFinalText, spokenCurrencyRef.current);

    try {
      const currentRecognition = recognitionRef.current;

      if (currentRecognition) {
        currentRecognition.onresult = null;
        currentRecognition.onend = null;
        currentRecognition.onerror = null;
        currentRecognition.abort?.();
      }
    } catch {}

    recognitionRef.current = null;
    setIsListening(false);

    if (finalText) {
      setChatInput(finalText);
      setPendingVoiceDraft(finalText);
      setVoiceStatus("Revisa la instrucción. Si está bien, presiona Confirmar. Si quedó mal, corrígela o cancélala.");
    } else {
      setChatInput("");
      setPendingVoiceDraft("");
      setVoiceStatus("No detecté una instrucción para procesar.");
    }
  };

  const handleSendChatMessage = () => {
    const question = (chatInput || pendingVoiceDraft).trim();

    if (!question) return;

    setPendingVoiceDraft("");
    processVoiceQuestion(question);
  };

  const handleCancelVoiceDraft = () => {
    setChatInput("");
    setPendingVoiceDraft("");
    setVoiceStatus("Instrucción cancelada. Puedes volver a dictarla.");
  };

  // Selector manual de moneda para el borrador de voz: hace explícita la moneda
  // en la transcripción (p. ej. convierte "$500" en "500 dólares") para que la
  // cotización quede en la moneda correcta sin depender del dictado.
  const handleSetDraftCurrency = (currency: "USD" | "COP") => {
    spokenCurrencyRef.current = currency;
    const base = (pendingVoiceDraft || chatInput || "").trim();
    if (!base) return;
    const updated = forceDraftCurrency(base, currency);
    setPendingVoiceDraft(updated);
    setChatInput(updated);
    setVoiceStatus(
      currency === "USD"
        ? "Moneda marcada como dólares (USD)."
        : "Moneda marcada como pesos (COP)."
    );
  };

  // Moneda actualmente reflejada en el borrador (para resaltar el botón activo).
  const draftCurrency: SpokenCurrency = detectSpokenCurrency(pendingVoiceDraft || chatInput || "");

  const addAgentNotice = (content: string) => {
    const agentMessage: GuideChatMessage = {
      id: `agent_notice_${Date.now()}`,
      role: "agent",
      content,
    };

    setChatMessages((prev) => [...prev, agentMessage]);
    setLastAgentResponse(content);
  };

  const handleMarkFollowUpDone = (activityId?: string) => {
    if (!activityId) {
      addAgentNotice("No pude marcar este seguimiento porque no encontré el ID de la actividad.");
      return;
    }

    const confirmed = window.confirm(
      "¿Confirmas marcar este seguimiento como realizado?"
    );

    if (!confirmed) return;

    updateActivityLocally(activityId, {
      status: "realizado",
      completedAt: new Date().toISOString(),
    });

    setRefreshKey((prev) => prev + 1);

    addAgentNotice(
      "Listo. Marqué el seguimiento como realizado y actualicé el radar comercial."
    );
  };

  const handlePostponeFollowUp = (activityId: string | undefined, days: number) => {
    if (!activityId) {
      addAgentNotice("No pude posponer este seguimiento porque no encontré el ID de la actividad.");
      return;
    }

    const label = days === 1 ? "mañana" : `en ${days} días`;

    const confirmed = window.confirm(
      `¿Confirmas posponer este seguimiento para ${label}?`
    );

    if (!confirmed) return;

    updateActivityLocally(activityId, {
      followUpAt: addDaysAtNine(days),
      status: "pendiente",
    });

    setRefreshKey((prev) => prev + 1);

    addAgentNotice(
      `Listo. Posponí el seguimiento para ${label} a las 9:00 a. m.`
    );
  };

  const renderFollowUpActions = (activityId?: string) => {
    return (
      <>
        <button
          type="button"
          onClick={() => handleMarkFollowUpDone(activityId)}
          className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700"
        >
          Marcar realizado
        </button>

        <button
          type="button"
          onClick={() => handlePostponeFollowUp(activityId, 1)}
          className="rounded-xl bg-amber-100 px-3 py-2 text-xs font-black text-amber-800 hover:bg-amber-200"
        >
          Mañana
        </button>

        <button
          type="button"
          onClick={() => handlePostponeFollowUp(activityId, 3)}
          className="rounded-xl bg-orange-100 px-3 py-2 text-xs font-black text-orange-800 hover:bg-orange-200"
        >
          +3 días
        </button>
      </>
    );
  };

  const openQuoteReview = (prompt: string) => {
    const cleanPrompt = prompt.trim();
  
    if (!cleanPrompt) {
      addAgentNotice("No pude abrir Cotizaciones porque no encontré texto para preparar la cotización.");
      return;
    }
  
    localStorage.setItem("axis_quote_prompt", cleanPrompt);
  
    window.dispatchEvent(
      new CustomEvent("axis:navigate", {
        detail: { page: "quotes" },
      })
    );
  
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("axis:create-quote", {
          detail: { prompt: cleanPrompt },
        })
      );
    }, 500);
  
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("axis:create-quote", {
          detail: { prompt: cleanPrompt },
        })
      );
    }, 1200);
  };
  
  const handleReviewQuoteAction = () => {
    if (!pendingAction || pendingAction.type !== "crear_cotizacion") return;
  
    openQuoteReview(pendingAction.prompt);
  
    const confirmation =
      "Listo. Abrí Cotizaciones con la información preparada. Revísala antes de guardar, generar PDF o enviar cualquier documento.";
  
    setChatMessages((prev) => [
      ...prev,
      {
        id: `agent_quote_review_${Date.now()}`,
        role: "agent",
        content: confirmation,
      },
    ]);
  
    setLastAgentResponse(confirmation);
    setPendingAction(null);
  
    speakAgentResponse(confirmation);
  };

  const showDraftReview = Boolean(pendingVoiceDraft);
  const showOnlyStatus = Boolean(voiceStatus) && !showDraftReview;

  return (
    <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="rounded-2xl bg-slate-900 p-2 text-white">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900">
                Director Comercial IA · voz automática v2
              </h2>
              <p className="text-sm text-slate-500">
                Analiza prioridades, riesgos, memoria comercial y próximos pasos del CRM.
              </p>
            </div>
          </div>

          <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-medium text-slate-700">
            {briefing.summary}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
          <p className="text-2xl font-black text-slate-900">
            {briefing.totalPending}
          </p>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
            pendientes
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <section className="rounded-[26px] border border-slate-200 bg-slate-50 p-5">
          <div className="mb-4 flex items-center gap-2">
            <div className="rounded-xl bg-white p-2 text-slate-600 border border-slate-200">
              <MessageCircle size={18} />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">
                Habla con el Director Comercial IA
              </h3>
              <p className="text-xs text-slate-500">
                Habla, detén el micrófono y el Director responderá automáticamente.
              </p>
            </div>
          </div>

          <div className="max-h-[320px] space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4">
            {chatMessages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
                    message.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={isListening ? stopAgentListening : startAgentListening}
              className={`rounded-2xl px-4 py-3 text-white ${
                isListening ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
              }`}
              title={isListening ? "Detener micrófono" : "Hablar con el agente"}
            >
              {isListening ? <Square size={18} /> : <Mic size={18} />}
            </button>

            <div className="flex-1">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <input
                  value={chatInput}
                  onChange={(e) => {
                    setChatInput(e.target.value);

                    if (pendingVoiceDraft) {
                      setPendingVoiceDraft(e.target.value);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleSendChatMessage();
                    }
                  }}
                  placeholder="Habla con el Director o escribe tu instrucción..."
                  className="w-full border-0 bg-white px-4 py-3 text-sm font-semibold text-slate-700 outline-none"
                />

                {showDraftReview && (
                  <div className="border-t border-blue-200 bg-blue-50 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-blue-700">
                        Revisa la instrucción antes de enviarla.
                      </span>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleSendChatMessage}
                          className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700"
                        >
                          Confirmar y enviar
                        </button>

                        <button
                          type="button"
                          onClick={handleCancelVoiceDraft}
                          className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-xs font-black text-blue-700 hover:bg-blue-100"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>

                  </div>
                )}
              </div>
            </div>
          </div>

          {showOnlyStatus && (
            <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-bold text-blue-700">
              {voiceStatus}
            </div>
          )}
        </section>

        {!hasMainItems && <EmptyState />}

        {briefing.overdueFollowUps.length > 0 && (
          <Section title="Vencidos" icon={<AlertTriangle size={18} />}>
            <div className="space-y-3">
              {briefing.overdueFollowUps.map((item) => (
                <GuideItemCard
                  key={item.id}
                  title={item.title}
                  detail={item.detail}
                  priority={item.priority}
                  actions={renderFollowUpActions(item.activityId)}
                />
              ))}
            </div>
          </Section>
        )}

        {briefing.todayFollowUps.length > 0 && (
          <Section title="Para hoy" icon={<CalendarClock size={18} />}>
            <div className="space-y-3">
              {briefing.todayFollowUps.map((item) => (
                <GuideItemCard
                  key={item.id}
                  title={item.title}
                  detail={item.detail}
                  priority={item.priority}
                  actions={renderFollowUpActions(item.activityId)}
                />
              ))}
            </div>
          </Section>
        )}

        {briefing.riskOpportunities.length > 0 && (
          <Section title="Oportunidades en riesgo" icon={<Flame size={18} />}>
            <div className="space-y-3">
              {briefing.riskOpportunities.map((item) => (
                <GuideItemCard
                  key={item.id}
                  title={item.title}
                  detail={item.detail}
                  priority={item.priority}
                />
              ))}
            </div>
          </Section>
        )}

        {briefing.coldAccounts.length > 0 && (
          <Section title="Cuentas frías" icon={<Snowflake size={18} />}>
            <div className="space-y-3">
              {briefing.coldAccounts.map((item) => (
                <GuideItemCard
                  key={item.id}
                  title={item.title}
                  detail={item.detail}
                  priority={item.priority}
                />
              ))}
            </div>
          </Section>
        )}

        {briefing.upcomingFollowUps.length > 0 && (
          <Section title="Próximos seguimientos" icon={<Clock size={18} />}>
            <div className="space-y-3">
              {briefing.upcomingFollowUps.map((item) => (
                <GuideItemCard
                  key={item.id}
                  title={item.title}
                  detail={item.detail}
                  priority={item.priority}
                  actions={renderFollowUpActions(item.activityId)}
                />
              ))}
            </div>
          </Section>
        )}

        {briefing.recommendations.length > 0 && (
          <Section title="Recomendaciones" icon={<Sparkles size={18} />}>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <ul className="space-y-2">
                {briefing.recommendations.map((recommendation, index) => (
                  <li
                    key={`${recommendation}-${index}`}
                    className="text-sm text-slate-700"
                  >
                    {recommendation}
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}