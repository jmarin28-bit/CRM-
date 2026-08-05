import { GoogleGenAI, Type } from "@google/genai";
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

export const callGeminiREST = async (
  modelId: string,
  contents: any,
  config?: any
): Promise<string> => {
  const apiKey = getRawApiKey();
  if (!apiKey) {
    throw new Error("Clave GEMINI_API_KEY no configurada en tu archivo .env.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;

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

  const bodyPayload: any = {
    contents: formattedContents,
  };

  if (config) {
    bodyPayload.generationConfig = config;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(bodyPayload),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg = errData?.error?.message || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(msg);
  }

  const data = await res.json();
  const textResp = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return textResp || "";
};

const getAI = () => {
  const apiKey = getRawApiKey();

  if (!apiKey) {
    console.warn("Gemini API Key not configured in environment.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const analyzeDealScore = async (
  opp: OpportunityV2,
  account: AccountV2,
  contact?: ContactV2,
  lastActivity?: ActivityV2
): Promise<{ score: number; justification: string; suggestedAction: string }> => {
  const ai = getAI();
  const modelId = "gemini-3-flash-preview";

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
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER },
            reasoning: { type: Type.STRING },
            recommended_action: { type: Type.STRING },
          },
          required: ["score", "reasoning", "recommended_action"],
        },
      },
    });

    const result = JSON.parse(cleanJsonString(response.text || "{}"));
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
  const ai = getAI();
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
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            accounts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  razonSocial: { type: Type.STRING },
                  nombreComercial: { type: Type.STRING },
                  nit: { type: Type.STRING },
                  sector: { type: Type.STRING },
                  ciudad: { type: Type.STRING },
                  direccion: { type: Type.STRING },
                },
              },
            },
            contacts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  accountId: { type: Type.STRING },
                  fullName: { type: Type.STRING },
                  role: { type: Type.STRING },
                  email: { type: Type.STRING },
                  phone: { type: Type.STRING },
                  whatsapp: { type: Type.STRING },
                },
              },
            },
          },
        },
      },
    });

    const result = JSON.parse(cleanJsonString(response.text || "{}"));
    
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
  const ai = getAI();
  // Use gemini-3.1-pro-preview for complex reasoning and multimodal tasks as requested
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

    const response = await ai.models.generateContent({
      model: modelId,
      contents: contents,
    });
    return response.text || "Lo siento, no pude procesar tu solicitud.";
  } catch (error) {
    console.error("Gemini Chat Error:", error);
    return "Tuve un problema conectando con el servidor de inteligencia Ioncore. Verifica tu conexión o el archivo adjunto.";
  }
};

export const extractRutData = async (file: {
  mimeType: string;
  data: string;
}): Promise<{
  razon_social?: string;
  nombre_comercial?: string;
  nit?: string;
  ciudad?: string;
  direccion?: string;
}> => {
  try {
    const res = await fetch("/api/extract-rut", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(file),
    });
    const result = await res.json();
    if (result.success && result.data) {
      return result.data;
    }
    if (result.error) {
      throw new Error(result.error);
    }
  } catch (err: any) {
    if (err.message) throw err;
  }
  throw new Error("No se pudo extraer información del RUT. Diligencie los campos manualmente.");
};

export const generateAIEmailResponse = async (
  contactName: string,
  contactRole: string,
  companyName: string,
  lastEmailText: string,
  promptTopic: string
): Promise<string> => {
  const ai = getAI();
  const modelId = "gemini-3-flash-preview";

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
    - Devuelve únicamente el cuerpo del correo redactado, listo para ser copiado o enviado (puedes usar etiquetas HTML básicas como <p> o <br> si es necesario, pero prefiere texto plano con saltos de línea legibles). No incluyas asunto ni explicaciones adicionales.
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
    });
    return response.text || "Estimado(a) " + contactName + ",\n\nEspero que se encuentre muy bien.\n\nAtentamente,\nEquipo de Ventas Ioncore";
  } catch (error) {
    console.error("Gemini Email Response Error:", error);
    return "Estimado(a) " + contactName + ",\n\nEspero que se encuentre muy bien.\n\nAtentamente,\nEquipo de Ventas Ioncore";
  }
};

export const generateAIWhatsAppResponse = async (
  contactName: string,
  companyName: string,
  promptTopic: string
): Promise<string> => {
  const ai = getAI();
  const modelId = "gemini-3-flash-preview";

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
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
    });
    return response.text || "Hola " + contactName + ", espero que te encuentres muy bien. ¿Cómo podemos apoyarte hoy desde Ioncore SAS?";
  } catch (e) {
    console.error("Error generating WhatsApp response with AI:", e);
    return "Hola " + contactName + ", espero que te encuentres muy bien. ¿Cómo podemos apoyarte hoy desde Ioncore SAS?";
  }
};
