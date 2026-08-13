import { AccountV2, ContactV2, ActivityV2, OpportunityV2 } from "../types";

/**
 * Extrae el JSON de una respuesta del modelo.
 *
 * La versión anterior era `str.replace(/```json\n|\n```/g, "")`, que exige un
 * salto de línea exacto pegado a la valla. Gemini no garantiza eso: manda
 * ```json seguido de \r\n, o con espacios, o acompaña el bloque con una frase
 * ("Aquí están los datos del RUT:"). En cualquiera de esos casos quedaban
 * restos y JSON.parse fallaba.
 *
 * Ahora se busca primero un bloque con vallas y, si no hay, se recorta desde
 * la primera llave o corchete hasta su cierre, así que tolera prosa alrededor.
 */
export const cleanJsonString = (str: string): string => {
  if (!str) return "";
  const text = str.trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1].trim()) return fenced[1].trim();

  const first = text.search(/[{[]/);
  if (first === -1) return text;

  const open = text[first];
  const close = open === "{" ? "}" : "]";
  const last = text.lastIndexOf(close);
  return last > first ? text.slice(first, last + 1) : text;
};

/**
 * Parsea la respuesta del modelo sin lanzar. Devuelve null si no hay JSON
 * válido, para que quien llama decida qué hacer en lugar de tragarse el error.
 */
export function parseModelJson<T = any>(raw: string): T | null {
  try {
    const cleaned = cleanJsonString(raw);
    if (!cleaned) return null;
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

export const getRawApiKey = (): string => {
  return (
    process.env.API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.VITE_GEMINI_API_KEY ||
    (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_GEMINI_API_KEY) ||
    (typeof import.meta !== "undefined" && (import.meta as any).env?.GEMINI_API_KEY) ||
    ""
  );
};

export const getOpenRouterApiKey = (): string => {
  return (
    process.env.OPENROUTER_API_KEY ||
    (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_OPENROUTER_API_KEY) ||
    ""
  );
};

export const callOpenRouterREST = async (
  prompt: string,
  modelId: string = "openrouter/free"
): Promise<string> => {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) throw new Error("Clave OPENROUTER_API_KEY no configurada.");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "Ioncore CRM",
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg = errData?.error?.message || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(msg);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
};

export const callGeminiREST = async (
  modelId: string,
  contents: any,
  config?: any
): Promise<string> => {
  // Si hay clave de OpenRouter configurada, usar OpenRouter free router
  const openRouterKey = getOpenRouterApiKey();
  if (openRouterKey) {
    let textPrompt = "";
    if (typeof contents === "string") textPrompt = contents;
    else if (Array.isArray(contents)) textPrompt = contents.map(c => typeof c === 'string' ? c : c.text || '').join('\n');
    else textPrompt = JSON.stringify(contents);
    return callOpenRouterREST(textPrompt);
  }

  const apiKey = getRawApiKey();
  if (!apiKey) {
    throw new Error("Ninguna clave de IA (OPENROUTER_API_KEY o GEMINI_API_KEY) está configurada en .env.");
  }


  try {
    const isAQKey = apiKey.startsWith('AQ.');
    const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
    const url = isAQKey ? baseUrl : `${baseUrl}?key=${encodeURIComponent(apiKey)}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    };

    let formattedContents: any[];
    if (typeof contents === "string") {
      formattedContents = [{ parts: [{ text: contents }] }];
    } else if (Array.isArray(contents)) {
      formattedContents = contents.map((item) => {
        if (typeof item === "string") return { parts: [{ text: item }] };
        if (item.text) return { parts: [{ text: item.text }] };
        if (item.inlineData) return { parts: [{ inlineData: item.inlineData }] };
        return item;
      });
    } else {
      formattedContents = [contents];
    }

    const bodyPayload: any = { contents: formattedContents };
    if (config) bodyPayload.generationConfig = config;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyPayload),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData?.error?.message || `HTTP ${res.status} ${res.statusText}`;
      if (openRouterKey) {
        console.warn("Gemini REST falló, derivando a OpenRouter:", msg);
        let textPrompt = typeof contents === "string" ? contents : JSON.stringify(contents);
        return callOpenRouterREST(textPrompt);
      }
      throw new Error(msg);
    }

    const data = await res.json();
    const textResp = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return textResp || "";
  } catch (err: any) {
    if (openRouterKey) {
      console.warn("Gemini REST error, usando fallback OpenRouter:", err.message);
      let textPrompt = typeof contents === "string" ? contents : JSON.stringify(contents);
      return callOpenRouterREST(textPrompt);
    }
    throw err;
  }
};




export const analyzeDealScore = async (
  opp: OpportunityV2,
  account: AccountV2,
  contact?: ContactV2,
  lastActivity?: ActivityV2
): Promise<{ score: number; justification: string; suggestedAction: string }> => {
  const modelId = "openrouter/free";

  const prompt = `
    Eres el Agente de Inteligencia Comercial Senior de Ioncore SAS. Tu especialidad es el Análisis Predictivo de Ventas.

    TU MISIÓN:
    Recibir datos de una negociación y devolver un puntaje (Score) del 0 al 100 que indique la probabilidad de cierre.

    REGLAS DE PUNTUACIÓN (Lógica Interna):
    1. SECTOR: Si es 'Industrial' o 'Energía', suma +25 puntos. Otros sectores suman +10.
    2. CARGO: Si el contacto es 'Gerente', 'Director' o 'Dueño', suma +20 puntos. Cargos operativos suman +5. (Si no hay contacto, suma 0).
    3. INTERACCIÓN: Si la última interacción fue 'Visita' o 'Visita Presencial', suma +30. Si fue 'Videoconferencia', suma +15. Si solo es 'Llamada' o 'Email', suma +5. (Si no hay interacción reciente, resta -10).
    4. UBICACIÓN: Si el cliente está en 'Bogotá' o 'Medellín', suma +10 por facilidad logística.

    DATOS DE LA NEGOCIACIÓN:
    - Oportunidad: ${opp.titulo} (${opp.valor} ${opp.moneda}) en etapa "${opp.etapa}".
    - Empresa: ${account.razonSocial} (Sector: ${account.sector}, Ubicación: ${account.ciudad}).
    - Contacto Clave: ${contact ? `${contact.fullName} (${contact.role})` : "No identificado"}.
    - Última Interacción: ${lastActivity ? `${lastActivity.type} el ${lastActivity.createdAt}` : "Sin registros recientes"}.

    FORMATO DE RESPUESTA (JSON):
    Responde estrictamente en JSON con los siguientes campos.
    - score: Número calculado según reglas.
    - reasoning: Breve explicación de los puntos sumados (Max 30 palabras). Incluye el "ESTADO SUGERIDO" (Frío/Tibio/Caliente) al final del texto.
    - recommended_action: Acción concreta para Juan Sierra (ej: "Agendar visita técnica inmediata").
  `;

  try {
    const rawText = await callGeminiREST(modelId, prompt);
    const result = parseModelJson<any>(rawText) || {};
    return {
      score: result.score || 0,
      justification: result.reasoning || "Análisis pendiente.",
      suggestedAction: result.recommended_action || "Revisar cliente."
    };
  } catch (error) {
    console.error("Gemini Scoring Error:", error);
    return { score: 0, justification: "Error calculando score.", suggestedAction: "Intenta de nuevo." };
  }
};

export const parseBulkData = async (
  inputText: string
): Promise<{ accounts: AccountV2[]; contacts: ContactV2[] }> => {
  const modelId = "gemini-3-flash-preview"; 

  const prompt = `
    ROLE: Data Processing Engine for Ioncore SAS CRM.
    
    TASK: Analyze the input text to extract Company (Account) and Person (Contact) information for bulk loading.
    
    DATA MODEL RULES:
    1. ACCOUNTS (Empresas):
       - Fields: razonSocial (Required), nombreComercial, NIT/Tax ID (Use "PENDIENTE" if missing), Sector, Ciudad, Direccion.
       - Generate a unique ID.
    2. CONTACTS (Personas):
       - Fields: Full Name, Role, Email, Phone, WhatsApp.
       - MUST be linked to an Account via 'accountId'. If the account is created in this batch, link it.
       - Generate a unique ID.
    
    OUTPUT:
    Return ONLY valid JSON with 'accounts' and 'contacts' arrays.

    Text to parse:
    "${inputText}"
  `;

  try {
    const rawText = await callGeminiREST(modelId, prompt);
    const result = parseModelJson<any>(rawText) || {};
    
    const accounts = (result.accounts || []).map((acc: any) => ({
      ...acc,
      createdAt: new Date().toISOString(),
    }));

    return { accounts, contacts: result.contacts || [] };
  } catch (error) {
    console.error("Gemini Parse Error:", error);
    throw new Error("Failed to parse data with AI.");
  }
};

export const getSmartResponse = async (
  query: string,
  contextData: { accounts: AccountV2[]; contacts: ContactV2[]; activities: ActivityV2[] },
  file?: { mimeType: string; data: string }
): Promise<string> => {
  const modelId = "gemini-3.1-pro-preview";

  // Context is important for "Identificar la Empresa y el Contacto"
  const contextString = JSON.stringify({
    knownAccounts: contextData.accounts.map(a => ({ razonSocial: a.razonSocial, id: a.id, nit: a.nit })),
    knownContacts: contextData.contacts.map(c => ({ name: c.fullName, role: c.role, accountId: c.accountId }))
  });

  const prompt = `
    Eres el Asistente de Operaciones de Ioncore SAS. Tu función es procesar datos crudos (copiados de chats, dictados o DOCUMENTOS ADJUNTOS) y transformarlos en registros estructurados para el CRM.

    CONTEXTO DE DATOS EXISTENTES (Úsalo para identificar empresas y contactos):
    ${contextString}

    1. ANÁLISIS DE DOCUMENTO (Si recibes un archivo):
    - Si es un RUT (DIAN Colombia): [CONFIGURACIÓN DE SALIDA TÉCNICA] Actúa como un procesador de datos JSON para Ioncore SAS. REGLA DE ORO: Tu respuesta debe ser SIEMPRE un ARRAY (lista entre corchetes []). Nunca respondas con un objeto solo {} ni con texto explicativo. SI EL ARCHIVO ESTÁ DAÑADO O NO ES UN RUT: Responde únicamente con una lista vacía: []
    - Si es otro documento: Procede con el análisis normal, generando el reporte en Markdown.

    FORMATO ESTRICTO (SOLO PARA RUT):
    [{
      "nombre": "Extraído de Casilla 35",
      "nit": "Extraído de Casilla 5",
      "ubicacion": "Extraído de Casilla 41",
      "vendedor": "Juan Sierra",
      "score": 90
    }]

    REGLAS DE SALIDA (PARA CHATS, LLAMADAS Y OTROS DOCUMENTOS):
    Presenta siempre la información en este orden exacto y con este formato Markdown:

    ### 🏢 REGISTRO DE CUENTA (O DOCUMENTO)
    **Nombre Comercial:** [Nombre]
    **Razón Social:** [Razón Social o "No especificado"]
    **NIT:** [NIT o "No especificado"]
    **Dirección:** [Dirección o "No especificada"]
    **Estado Sugerido:** [Prospecto / Negociación / Cliente Activo]
    *(Si es documento, añade campos extra aquí como Actividad Económica o Régimen)*

    ### 📝 REPORTE DE ACTIVIDAD / ANÁLISIS
    [Resumen profesional de la interacción o del documento analizado]

    ### 🤖 SCORE IA
    **Puntaje:** [Número]%
    **Justificación:** [Breve explicación del puntaje basada en reglas de Ioncore]

    ### 🚀 PRÓXIMA ACCIÓN
    [Tarea concreta para Juan Sierra]

    INPUT DEL USUARIO:
    "${query}"
  `;

  try {
    const contents: any[] = [{ text: prompt }];
    
    if (file) {
      contents.push({
        inlineData: {
          mimeType: file.mimeType,
          data: file.data
        }
      });
    }

    const responseText = await callGeminiREST(modelId, contents);
    return responseText || "Lo siento, no pude procesar tu solicitud.";
  } catch (error) {
    console.error("Gemini Chat Error:", error);
    return "Tuve un problema conectando con el servidor de inteligencia Ioncore. Verifica tu conexión o el archivo adjunto.";
  }
};

/**
 * Función local de extracción de campos de un PDF del RUT (DIAN Colombia Formulario 001).
 * Funciona offline leyendo la estructura interna del PDF cuando el backend o Gemini no están disponibles.
 */
export function parseRutPdfLocally(base64Data: string): {
  razon_social?: string;
  nombre_comercial?: string;
  nit?: string;
  dv?: string;
  ciudad?: string;
  direccion?: string;
  email?: string;
  telefono?: string;
} {
  try {
    const binStr = atob(base64Data);
    const textFragments: string[] = [];

    // 1. Fragmentos de texto dentro de paréntesis en corrientes PDF: (...)
    const parenRegex = /\(([^()]{1,250})\)/g;
    let match: RegExpExecArray | null;
    while ((match = parenRegex.exec(binStr)) !== null) {
      const t = match[1].trim();
      if (t && !t.includes("00000 65536") && !t.startsWith("/") && t.length > 1) {
        textFragments.push(t);
      }
    }

    // 2. Fragmentos hex en corrientes PDF: <...>
    const hexRegex = /<([0-9A-Fa-f]{4,500})>/g;
    while ((match = hexRegex.exec(binStr)) !== null) {
      try {
        const hex = match[1];
        let decoded = "";
        for (let i = 0; i < hex.length; i += 2) {
          const code = parseInt(hex.substr(i, 2), 16);
          if (code >= 32 && code <= 126) decoded += String.fromCharCode(code);
        }
        if (decoded.trim().length > 2) {
          textFragments.push(decoded.trim());
        }
      } catch {}
    }

    const fullRawText = textFragments.join(" ");

    let razon_social = "";
    let nit = "";
    let direccion = "";
    let ciudad = "";
    let email = "";
    let telefono = "";
    let nombre_comercial = "";

    // Extraer NIT (Casilla 5 y Casilla 6: Formato exacto NIT-DV: 900745087-2)
    let nitBase = "";
    const nitSpacedMatch = fullRawText.match(/\b([89]\s*\d\s*\d\s*\d\s*\d\s*\d\s*\d\s*\d\s*\d)\b/);
    if (nitSpacedMatch) {
      nitBase = nitSpacedMatch[1].replace(/\s+/g, "");
    } else {
      const nitDirect = fullRawText.match(/\b([89]\d{8,9})\b/);
      if (nitDirect) nitBase = nitDirect[1];
    }

    let dv = "";
    if (nitBase) {
      const cas6Match = fullRawText.match(/(?:6\.\s*(?:DV|D[ií]gito\s*de\s*verificaci[oó]n)?[:\s]*)(\d)\b/i);
      if (cas6Match) {
        dv = cas6Match[1];
      } else if (nitBase.length === 9) {
        const weights = [41, 37, 29, 23, 19, 17, 13, 7, 3];
        let sum = 0;
        for (let i = 0; i < 9; i++) sum += parseInt(nitBase[i], 10) * weights[i];
        const r = sum % 11;
        dv = r === 0 ? "0" : r === 1 ? "1" : String(11 - r);
      }
      nit = dv ? `${nitBase}-${dv}` : nitBase;
    }

    // Extraer Razón Social (Casilla 35 - Empresa con S.A.S., LTDA, S.A., E.U., etc. o Persona Natural)
    const empresaMatch = fullRawText.match(/\b([A-Z0-9\s.\-&]{3,60}\s+(?:S\.?A\.?S\.?|LTDA|S\.?A\.?|E\.?U\.?|INC|CORP))\b/i);
    if (empresaMatch) {
      razon_social = empresaMatch[1].replace(/\s+/g, " ").trim();
    } else {
      const cas35Match = fullRawText.match(/(?:35\s+|Razón\s*Social[:\s]*)([A-Z0-9\s.\-&]{3,60})/i);
      if (cas35Match && !cas35Match[1].toLowerCase().includes("casilla")) {
        razon_social = cas35Match[1].trim();
      }
    }

    // Extraer Nombre Comercial (Casilla 36)
    // Solo si existe un valor entre 36 y 37.
    // La casilla 37 (Sigla) NO se utiliza.
    const nombreComercialMatch = fullRawText.match(
      /36\.\s*Nombre\s+comercial\s+(.{2,100}?)(?=\s+37\.)/i
    );

    if (nombreComercialMatch) {
      const candidate = nombreComercialMatch[1]
        .replace(/\s+/g, " ")
        .trim();

      if (
        candidate &&
        !candidate.toLowerCase().includes("sigla") &&
        !candidate.toLowerCase().includes("casilla")
      ) {
        nombre_comercial = candidate;
      }
    }

    // Extraer Dirección (Casilla 41: CR, CARRERA, CL, CALLE, AV, TV, DG, etc.)
    const dirMatch = fullRawText.match(/\b((?:CR|CARRERA|CL|CALLE|AV|AVENIDA|TV|TRANSVERSAL|DG|DIAGONAL|AUTOPISTA|KM)\s+[A-Z0-9\s#\-.,]{5,60})\b/i);
    if (dirMatch) {
      direccion = sanitizeAddress(dirMatch[1]);
    }

    // Extraer Ciudad (Casilla 40)
    const ciudadMatch = fullRawText.match(/\b(Bogot[aá],?\s*D\.?C\.?|Medell[ií]n|Cali|Barranquilla|Cartagena|Bucaramanga|Pereira|Manizales|Cúcuta|Ibagué|Neiva|Santa Marta|Villavicencio|Rionegro|Envigado|Itagüí|Chía|Soacha)\b/i);
    if (ciudadMatch) {
      ciudad = ciudadMatch[1].trim();
    }

    return {
      razon_social,
      nombre_comercial,
      nit,
      dv,
      ciudad,
      direccion,
    };
  } catch (e) {
    console.error("Error al parsear el RUT localmente:", e);
    return {};
  }
}

function sanitizeAddress(addr: string): string {
  if (!addr || typeof addr !== "string") return "";
  let clean = addr.trim();
  clean = clean.split(/\s+[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/i)[0];
  clean = clean.split(/\s*@.*/)[0];
  clean = clean.split(/\s+(?:42\.|42\s|43\.|44\.|45\.|46\.|Correo|Email|Tel[eé]fono|CLASE|INFORMACI[OÓ]N)/i)[0];
  const validTokens = new Set(['sur', 'norte', 'este', 'oeste', 'bis', 'apto', 'of', 'oficina', 'piso', 'int', 'interior', 'mz', 'lt', 'km', 'local', 'bodega', 'torre', 'bloque']);
  const parts = clean.split(/\s+/);
  while (parts.length > 0) {
    const lastWord = parts[parts.length - 1].toLowerCase();
    if (/^[a-z]{4,}$/i.test(lastWord) && !validTokens.has(lastWord)) {
      parts.pop();
    } else {
      break;
    }
  }
  return parts.join(' ').trim();
}

/**
 * REGLAS ESTRUCTURADAS DEL PROMPT PARA EXTRACCIÓN DE RUT DIAN:
 *
 * 1. NIT: Extraer el número de identificación tributaria completo incluyendo el dígito de verificación (DV).
 *    Formato: XXXXXXXXX-X (Ejemplo: 900745087-2).
 * 2. RAZÓN SOCIAL: Extraer exclusivamente el valor del campo "35. Razón social".
 * 3. NOMBRE COMERCIAL: Extraer exclusivamente el valor del campo "36. Nombre comercial".
 * 4. CIUDAD: Extraer exclusivamente el valor del campo "40. Ciudad/Municipio".
 * 5. DIRECCIÓN: Extraer exclusivamente el valor del campo "41. Dirección principal".
 *    No agregar información de otros campos. No agregar nombres de personas.
 *    No agregar correos electrónicos. No agregar teléfonos.
 *    No concatenar texto que aparezca después de la dirección.
 * 6. CORREO: Si se extrae correo electrónico, debe mantenerse como un dato independiente y nunca formar parte de la dirección.
 * 7. SECTOR: NO inferir ni seleccionar el sector. Devolver vacío.
 * 8. CLASIFICACIÓN: NO inferir ni seleccionar la clasificación. Devolver vacío.
 * 9. SEDE: NO inferir ni copiar datos del RUT. Devolver vacío.
 */
export const extractRutData = async (file: {
  mimeType: string;
  data: string;
}): Promise<{
  razon_social?: string;
  nombre_comercial?: string;
  nit?: string;
  dv?: string;
  ciudad?: string;
  direccion?: string;
  email?: string;
  telefono?: string;
}> => {
  function cleanVal(v: any): string {
    if (!v || typeof v !== "string") return "";
    const invalid = [
      "primer apellido",
      "segundo apellido",
      "otros nombres",
      "tipo",
      "sin perjuicio",
      "casilla",
    ];
    const val = v.trim();
    if (invalid.some((i) => val.toLowerCase().includes(i))) return "";
    if (val.length < 2) return "";
    return val;
  }

  function buildResult(parsed: any, fallback?: any): {
    razon_social?: string; nombre_comercial?: string; nit?: string; dv?: string;
    ciudad?: string; direccion?: string; email?: string; telefono?: string;
  } {
    const fb = fallback || {};
    const rawDir = cleanVal(parsed.direccion) || fb.direccion || "";
    const rawNit = cleanVal(parsed.nit) || fb.nit || "";
    const rawDv = cleanVal(parsed.dv) || fb.dv || "";

    let finalNit = rawNit ? String(rawNit).replace(/[^\d\-]/g, "").trim() : "";
    if (finalNit && !finalNit.includes("-") && rawDv) {
      finalNit = `${finalNit}-${rawDv}`;
    }

    return {
      razon_social: cleanVal(parsed.razon_social) || fb.razon_social || "",
      nombre_comercial: cleanVal(parsed.nombre_comercial) || fb.nombre_comercial || "",
      nit: finalNit,
      dv: rawDv,
      ciudad: cleanVal(parsed.ciudad) || fb.ciudad || "",
      direccion: sanitizeAddress(rawDir),
      email: cleanVal(parsed.email) || fb.email || "",
      telefono: cleanVal(parsed.telefono) || fb.telefono || "",
    };
  }

  // ── 1. PRIMARIO: Backend /api/extract-rut + 2. COMPLEMENTO LOCAL ──
  let backendData: any = {};
  let backendWarning: string | null = null;

  try {
    console.log("[RUT Client] 📤 Enviando PDF al backend /api/extract-rut...");
    const res = await fetch("/api/extract-rut", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(file),
    });

    console.log(`[RUT Client] 📡 HTTP Status del backend: ${res.status} ${res.statusText}`);
    const result = await res.json();
    console.log("[RUT Client] 📥 Respuesta del backend:", result);

    if (res.ok && result.success && result.data) {
      backendData = result.data || {};
    } else if (result && result.error) {
      backendWarning = result.error;
      console.error("[RUT Client] ❌ Error del Backend:", result.error);
    }
  } catch (err: any) {
    console.error("[RUT Client] ❌ Error conectando con backend /api/extract-rut:", err.message);
    backendWarning = err.message;
  }

  // Extractor local para complementar cualquier campo faltante
  const localData = parseRutPdfLocally(file.data);

  // FUSIONAR CAMPO A CAMPO (Backend = fuente principal, Local = complemento para faltantes)
  const finalData = {
    razon_social: backendData.razon_social || localData.razon_social || "",
    nombre_comercial: backendData.nombre_comercial || localData.nombre_comercial || "",
    nit: backendData.nit || localData.nit || "",
    dv: backendData.dv || localData.dv || "",
    direccion: backendData.direccion || localData.direccion || "",
    ciudad: backendData.ciudad || localData.ciudad || "",
  };

  console.log('[RUT] Backend data:', backendData);
  console.log('[RUT] Local data:', localData);
  console.log('[RUT] Final merged data:', finalData);

  if (finalData.razon_social || finalData.nit || finalData.ciudad || finalData.direccion) {
    return buildResult(finalData);
  }

  throw new Error(backendWarning || "No se pudo leer automáticamente este RUT. Asegúrate de subir el PDF original descargado de la DIAN o ingresa los datos manualmente.");
};




export const generateAIEmailResponse = async (
  contactName: string,
  contactRole: string,
  companyName: string,
  lastEmailText: string,
  promptTopic: string
): Promise<string> => {
  const modelId = "openrouter/free";

  const prompt = `
    Eres un Asesor de Ventas Profesional en Ioncore SAS.
    Tu objetivo es redactar un correo electrónico formal, persuasivo y pulcro dirigido a un contacto comercial.

    DATOS DEL DESTINATARIO:
    - Nombre: ${contactName}
    - Cargo: ${contactRole}
    - Empresa: ${companyName}

    CONTEXTO DEL ÚLTIMO CORREO / CONVERSACIÓN:
    "${lastEmailText || 'No hay correos anteriores. Es el primer contacto.'}"

    TEMA O INSTRUCCIÓN ADICIONAL PARA LA RESPUESTA:
    "${promptTopic || 'Saludar y ofrecer los servicios de Ioncore SAS para mejorar sus procesos analíticos y de laboratorio.'}"

    INSTRUCCIONES DE REDACCIÓN:
    - Redacta en español formal de negocios.
    - Sé conciso, claro y profesional.
    - Termina con una firma profesional que incluya marcadores de posición para tu nombre y datos.
    - Devuelve únicamente el cuerpo del correo redactado, listo para ser copiado o enviado.
  `;

  try {
    const responseText = await callOpenRouterREST(prompt, modelId);
    return responseText || ("Estimado(a) " + contactName + ",\n\nEspero que se encuentre muy bien.\n\nAtentamente,\nEquipo de Ventas Ioncore");
  } catch (error) {
    console.error("OpenRouter Email Response Error:", error);
    return "Estimado(a) " + contactName + ",\n\nEspero que se encuentre muy bien.\n\nAtentamente,\nEquipo de Ventas Ioncore";
  }
};

export const generateAIWhatsAppResponse = async (
  contactName: string,
  companyName: string,
  promptTopic: string
): Promise<string> => {
  const modelId = "openrouter/free";

  const prompt = `
    Eres un Asesor Comercial Profesional en Ioncore SAS.
    Tu objetivo es redactar un mensaje corto, profesional, cercano y claro para ser enviado por WhatsApp al siguiente contacto comercial:

    DATOS DEL DESTINATARIO:
    - Nombre del contacto: ${contactName}
    - Empresa: ${companyName}

    TEMA / INSTRUCCIÓN DEL MENSAJE COMERCIAL:
    "${promptTopic || 'Saludar cordialmente y presentarte como asesor de Ioncore SAS para ofrecer soluciones para sus laboratorios.'}"

    INSTRUCCIONES DE REDACCIÓN:
    - Redacta en español de forma amigable y profesional.
    - Mantén el texto corto, conciso, fácil de leer en un chat de WhatsApp (usa saltos de línea para estructurar).
    - Puedes usar algún emoji sutil si lo consideras adecuado, pero con mucha moderación.
    - Devuelve ÚNICAMENTE el texto plano del mensaje redactado, sin encabezados, saludos genéricos de correo, firmas vacías ni explicaciones.
  `;

  try {
    const responseText = await callOpenRouterREST(prompt, modelId);
    return responseText || ("Hola " + contactName + ", espero que te encuentres muy bien. ¿Cómo podemos apoyarte hoy desde Ioncore SAS?");
  } catch (e) {
    console.error("Error generating WhatsApp response with OpenRouter:", e);
    return "Hola " + contactName + ", espero que te encuentres muy bien. ¿Cómo podemos apoyarte hoy desde Ioncore SAS?";
  }
};
