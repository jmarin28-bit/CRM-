import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  Square,
  Copy,
  Trash2,
  Search,
  FileText,
  Save,
  CalendarPlus,
  Clock,
  Sparkles,
  CheckCircle2
} from "lucide-react";
import {
  listContactsByUser,
  listAccountsByUser,
  createActivity,
  listActivitiesByUser,
  updateActivity,
  deleteActivity,
  clearAllPendingFollowUps,
  getActiveUser,
  isActivityDone,
  completeFollowUpActivity
} from "../services/storage";
import { CompleteFollowUpModal } from "../components/CompleteFollowUpModal";

// ==========================================
// HELPERS DE BUSQUEDA Y NORMALIZACION
// ==========================================
const normalizeText = (value: string) =>
  (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const getContactDisplayName = (contact: any) => {
  return (
    contact.fullName ||
    contact.name ||
    `${contact.firstName || ""} ${contact.lastName || ""}`.trim()
  );
};

/** Extrae SOLO el nombre de la persona, descartando el sufijo de empresa.
 *  Ejemplo: "Johan Arevalo · SERVICIO GEOLOGICO COLOMBIANO" → "Johan Arevalo"
 *  Separa por '·', '•', ' - ', ' / ' y toma la primera parte. */
const getContactPersonName = (contact: any): string => {
  const full = getContactDisplayName(contact);
  // Separadores comunes usados cuando el fullName trae empresa concatenada
  const separatorMatch = full.match(/^([^·•]+?)\s*[·•]\s*.+$/) ||
                         full.match(/^([^-]+?)\s+-\s+[A-Z].+$/);
  return separatorMatch ? separatorMatch[1].trim() : full.trim();
};

const formatAxisDateTime = (value?: string | null) => {
  if (!value) return "Sin fecha";

  const d = new Date(value);
  if (isNaN(d.getTime())) return "Sin fecha";

  return d.toLocaleString("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getFollowUpStatus = (value?: string | null, status?: string) => {
  if (status && isActivityDone({ status })) {
    return {
      label: "Completada",
      className: "bg-emerald-100 text-emerald-700",
    };
  }

  if (!value) {
    return {
      label: "Sin fecha",
      className: "bg-slate-100 text-slate-600",
    };
  }

  const followUpDate = new Date(value);
  if (isNaN(followUpDate.getTime())) {
    return {
      label: "Sin fecha",
      className: "bg-slate-100 text-slate-600",
    };
  }

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  if (followUpDate < startOfToday) {
    return {
      label: "Vencido",
      className: "bg-red-100 text-red-700",
    };
  }

  if (followUpDate >= startOfToday && followUpDate <= endOfToday) {
    return {
      label: "Hoy",
      className: "bg-amber-100 text-amber-700",
    };
  }

  return {
    label: "Próximo",
    className: "bg-emerald-100 text-emerald-700",
  };
};

const findContactMatchesInText = (text: string): ContactMatch[] => {
  const normalized = normalizeText(text);
  const contacts = listContactsByUser();

  return contacts
    .map((contact: any) => {
      // Usar SOLO el nombre de la persona (sin sufijo de empresa) para scoring
      const personName = normalizeText(getContactPersonName(contact));
      const nameWords = personName.split(" ").filter((word) => word.length > 2);

      let score = 0;

      if (personName && normalized.includes(personName)) {
        score = personName.length + 300;
      } else {
        const matchedWords = nameWords.filter((word) => normalized.includes(word));
        score = matchedWords.length * 40;
      }

      return { contact, score };
    })
    .filter((match) => match.score >= 40)
    .sort((a, b) => b.score - a.score);
};

const findContactInText = (text: string) => {
  const matches = findContactMatchesInText(text);
  if (!matches.length) return null;

  const bestScore = matches[0].score;
  const topMatches = matches.filter((match) => match.score === bestScore);

  if (topMatches.length > 1) return null;

  return matches[0].contact;
};

const findAccountInText = (text: string, accounts: any[]) => {
  if (!text || !text.trim()) return null;
  const normalized = normalizeText(text);

  let bestMatch: any = null;
  let bestScore = 0;

  accounts.forEach((acc: any) => {
    const name = normalizeText(acc.nombreComercial || acc.razonSocial || "");
    if (!name || name.length < 3) return;

    if (normalized.includes(name)) {
      const score = name.length + 200;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = acc;
      }
    } else {
      const words = name.split(" ").filter((w: string) => w.length > 2);
      const matched = words.filter((w: string) => normalized.includes(w));
      if (matched.length >= 2) {
        const score = matched.length * 30;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = acc;
        }
      }
    }
  });

  return bestScore >= 40 ? bestMatch : null;
};

const getNextWeekdayDate = (weekday: number) => {
  const today = new Date();
  const result = new Date(today);
  const diff = (weekday + 7 - today.getDay()) % 7 || 7;
  result.setDate(today.getDate() + diff);
  result.setHours(9, 0, 0, 0);
  return result;
};

const addDaysToDate = (baseDate: Date, days: number) => {
  const result = new Date(baseDate);
  result.setDate(result.getDate() + days);
  result.setHours(9, 0, 0, 0);
  return result;
};

const detectFollowUpDate = (text: string) => {
  const t = normalizeText(text);
  const now = new Date();
  const result = new Date(now);

  if (t.includes("manana") || t.includes("mañana")) {
    result.setDate(now.getDate() + 1);
    result.setHours(9, 0, 0, 0);
    return result.toISOString();
  }

  if (t.includes("lunes")) return getNextWeekdayDate(1).toISOString();
  if (t.includes("martes")) return getNextWeekdayDate(2).toISOString();
  if (t.includes("miercoles") || t.includes("miércoles")) return getNextWeekdayDate(3).toISOString();
  if (t.includes("jueves")) return getNextWeekdayDate(4).toISOString();
  if (t.includes("viernes")) return getNextWeekdayDate(5).toISOString();
  if (t.includes("sabado") || t.includes("sábado")) return getNextWeekdayDate(6).toISOString();
  if (t.includes("domingo")) return getNextWeekdayDate(0).toISOString();

  const daysMatch = t.match(/en\s+(\d+)\s+dias/);
  if (daysMatch?.[1]) {
    result.setDate(now.getDate() + Number(daysMatch[1]));
    result.setHours(9, 0, 0, 0);
    return result.toISOString();
  }

  return null;
};

const buildQuotePromptFromAxisText = (text: string) => {
  const raw = (text || "").trim();
  if (!raw) return "";

  const cleaned = raw
    .replace(/^tarea creada desde axis:\s*/i, "")
    .replace(/^gestion registrada desde axis:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const firstCodeMatch = cleaned.match(/\bc[oó]digo\b/i);
  if (!firstCodeMatch || firstCodeMatch.index === undefined) {
    return cleaned;
  }

  const intro = cleaned.slice(0, firstCodeMatch.index).trim();
  const itemsBlock = cleaned.slice(firstCodeMatch.index).trim();

  const splitItems = itemsBlock
    .split(/(?=\bc[oó]digo\b)/i)
    .map((item) => item.trim())
    .filter(Boolean);

  if (splitItems.length <= 1) {
    return cleaned;
  }

  const formattedItems = splitItems.map((item, index) => {
    const withoutExtraIntent = item
      .replace(/\by también\b.*$/i, "")
      .replace(/\by tambien\b.*$/i, "")
      .replace(/\btambién\b.*$/i, "")
      .replace(/\btambien\b.*$/i, "")
      .replace(/\bademás\b.*$/i, "")
      .replace(/\bademas\b.*$/i, "")
      .replace(/\bseguimiento\b.*$/i, "")
      .replace(/\bllamar\b.*$/i, "")
      .replace(/\brecordar\b.*$/i, "")
      .replace(/\bmañana\b.*$/i, "")
      .replace(/\bmanana\b.*$/i, "")
      .replace(/\bviernes\b.*$/i, "")
      .trim();

    return `${index + 1}) ${withoutExtraIntent}`;
  });

  return [intro, ...formattedItems].filter(Boolean).join("\n\n");
};

type AxisSuggestionType =
  | "guardar_gestion"
  | "crear_seguimiento"
  | "crear_cotizacion";

type AxisSuggestion = {
  type: AxisSuggestionType;
  title: string;
  detail: string;
};

type LastFollowUpSummary = {
  activityId: string;
  contactId: string;
  contactName: string;
  accountName: string;
  followUpAt: string;
  description: string;
};

type ContactMatch = {
  contact: any;
  score: number;
};

const analyzeAxisTextLocally = (text: string): AxisSuggestion[] => {
  const t = normalizeText(text);
  const suggestions: AxisSuggestion[] = [];

  if (!t.trim()) return suggestions;

  suggestions.push({
    type: "guardar_gestion",
    title: "Guardar gestión",
    detail: "Registrar esta conversación en el historial del contacto."
  });

  const hasFollowUpIntent =
    t.includes("llamar") ||
    t.includes("seguimiento") ||
    t.includes("hacer seguimiento") ||
    t.includes("revisar") ||
    t.includes("recordar") ||
    t.includes("manana") ||
    t.includes("mañana") ||
    t.includes("lunes") ||
    t.includes("martes") ||
    t.includes("miercoles") ||
    t.includes("miércoles") ||
    t.includes("jueves") ||
    t.includes("viernes");

  if (hasFollowUpIntent) {
    suggestions.push({
      type: "crear_seguimiento",
      title: "Crear seguimiento",
      detail: "Crear una tarea/seguimiento con la fecha detectada en el texto."
    });
  }

  const hasQuoteIntent =
    t.includes("cotizacion") ||
    t.includes("cotización") ||
    t.includes("cotizar") ||
    t.includes("precio") ||
    t.includes("valor") ||
    t.includes("codigo") ||
    t.includes("código") ||
    t.includes("columna") ||
    t.includes("hplc");

  if (hasQuoteIntent) {
    suggestions.push({
      type: "crear_cotizacion",
      title: "Crear cotización",
      detail: "Enviar este texto al asistente de cotización."
    });
  }

  return suggestions.filter(
    (item, index, arr) => arr.findIndex((x) => x.type === item.type) === index
  );
};

export default function Axis() {
  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef("");
  const gotSpeechRef = useRef(false);
  const manualStopRef = useRef(false);
  const startTimeoutRef = useRef<number | null>(null);
  const readyTimeoutRef = useRef<number | null>(null);

  const [micStatus, setMicStatus] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isMicReady, setIsMicReady] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [supported, setSupported] = useState(true);
  const [axisMessage, setAxisMessage] = useState("");
  const [selectedContactId, setSelectedContactId] = useState("");
  const [axisSuggestions, setAxisSuggestions] = useState<AxisSuggestion[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [lastFollowUpSummary, setLastFollowUpSummary] = useState<LastFollowUpSummary | null>(null);
  const [followUpToComplete, setFollowUpToComplete] = useState<any | null>(null);

  const axisContacts = useMemo(() => listContactsByUser(), [refresh]);
  const axisAccounts = useMemo(() => listAccountsByUser(), [refresh]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("axis_last_followup_summary");
      if (!raw) return;

      const parsed = JSON.parse(raw);

      if (parsed?.activityId && parsed?.contactId) {
        setLastFollowUpSummary(parsed);
      }
    } catch {
      localStorage.removeItem("axis_last_followup_summary");
    }
  }, []);

  const contactMatches = useMemo(() => {
    if (!transcript.trim()) return [];
    return findContactMatchesInText(transcript);
  }, [transcript, refresh]);

  const ambiguousContacts = useMemo(() => {
    if (selectedContactId || contactMatches.length <= 1) return [];

    const bestScore = contactMatches[0]?.score || 0;
    return contactMatches.filter((match) => match.score === bestScore);
  }, [selectedContactId, contactMatches]);

  const detectedContact = useMemo(() => {
    if (!transcript.trim()) return null;
    return findContactInText(transcript);
  }, [transcript, refresh]);

  const selectedContact = useMemo(() => {
    if (!selectedContactId) return null;
    return axisContacts.find((c: any) => c.id === selectedContactId) || null;
  }, [selectedContactId, axisContacts]);

  const resolvedContact =
    selectedContact || (ambiguousContacts.length > 1 ? null : detectedContact);

  const detectedAccount = useMemo(() => {
    if (!transcript.trim()) return null;
    return findAccountInText(transcript, axisAccounts);
  }, [transcript, axisAccounts, refresh]);

  const resolvedAccount = useMemo(() => {
    if (resolvedContact?.accountId) {
      const acc = axisAccounts.find((a: any) => a.id === resolvedContact.accountId);
      if (acc) return acc;
    }
    return detectedAccount;
  }, [resolvedContact, detectedAccount, axisAccounts]);

  const pendingFollowUps = useMemo(() => {
    return listActivitiesByUser()
      .filter((activity: any) => activity.followUpAt)
      .filter((activity: any) => !isActivityDone(activity))
      .sort((a: any, b: any) => {
        return new Date(a.followUpAt).getTime() - new Date(b.followUpAt).getTime();
      })
      .slice(0, 8);
  }, [refresh]);

  const startListening = () => {
    console.log("Axis: intentando iniciar micrófono");

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSupported(false);
      alert("SpeechRecognition no está disponible en este navegador o en este entorno.");
      return;
    }

    try {
      recognitionRef.current?.abort?.();
    } catch {
      // Ignorar instancia previa dañada.
    }

    setIsMicReady(false);
    if (readyTimeoutRef.current) {
      window.clearTimeout(readyTimeoutRef.current);
      readyTimeoutRef.current = null;
    }

    finalTranscriptRef.current = transcript.trim();
    gotSpeechRef.current = false;
    manualStopRef.current = false;
    setMicStatus("Preparando micrófono...");

    const recognition = new SpeechRecognition();
    recognition.lang = "es-CO";
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onstart = () => {
      console.log("Axis: micrófono iniciado");
      setIsListening(true);
      setMicStatus("Micrófono iniciado. Espera un momento...");

      readyTimeoutRef.current = window.setTimeout(() => {
        setIsMicReady(true);
        setMicStatus("Habla ahora.");
      }, 700);

      if (startTimeoutRef.current) {
        window.clearTimeout(startTimeoutRef.current);
        startTimeoutRef.current = null;
      }
    };

    recognition.onresult = (event: any) => {
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const resultText = event.results[i][0].transcript || "";

        if (resultText.trim()) {
          gotSpeechRef.current = true;
        }

        if (event.results[i].isFinal) {
          finalTranscriptRef.current = `${finalTranscriptRef.current} ${resultText}`.trim();
        } else {
          interimText += resultText + " ";
        }
      }

      setTranscript(`${finalTranscriptRef.current} ${interimText}`.trim());
    };

    recognition.onerror = (event: any) => {
      console.error("Axis error completo:", event);
      const errorCode = event?.error || "desconocido";

      let friendlyMessage = "Error de micrófono/transcripción.";

      if (errorCode === "not-allowed") {
        friendlyMessage = "Permiso de micrófono denegado.";
      } else if (errorCode === "service-not-allowed") {
        friendlyMessage = "El servicio de reconocimiento de voz no está permitido en este entorno.";
      } else if (errorCode === "audio-capture") {
        friendlyMessage = "No se detectó micrófono disponible.";
      } else if (errorCode === "network") {
        friendlyMessage = "Error de red del reconocimiento de voz.";
      } else if (errorCode === "aborted") {
        friendlyMessage = "La captura de voz fue cancelada.";
      } else if (errorCode === "no-speech") {
        friendlyMessage = "No se detectó voz. Intenta hablar más cerca del micrófono.";
      }

      setMicStatus(friendlyMessage);
      setIsMicReady(false);
      if (readyTimeoutRef.current) {
        window.clearTimeout(readyTimeoutRef.current);
        readyTimeoutRef.current = null;
      }
      setIsListening(false);

      if (errorCode !== "aborted") {
        alert(`${friendlyMessage} (${errorCode})`);
      }
    };

    recognition.onend = () => {
      setIsMicReady(false);
      if (readyTimeoutRef.current) {
        window.clearTimeout(readyTimeoutRef.current);
        readyTimeoutRef.current = null;
      }

      setIsListening(false);

      if (!gotSpeechRef.current && !manualStopRef.current) {
        setMicStatus("No capté audio. Intenta iniciar el micrófono de nuevo.");
      } else {
        setMicStatus("Micrófono detenido.");
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopListening = () => {
    manualStopRef.current = true;
    setIsMicReady(false);

    if (readyTimeoutRef.current) {
      window.clearTimeout(readyTimeoutRef.current);
      readyTimeoutRef.current = null;
    }

    if (startTimeoutRef.current) {
      window.clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }

    recognitionRef.current?.stop();
    setIsListening(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(transcript);
      alert("Texto copiado.");
    } catch {
      alert("No se pudo copiar el texto.");
    }
  };

  const handleClear = () => {
    setTranscript("");
    setAxisMessage("");
    setMicStatus("");
    setIsMicReady(false);
    setSelectedContactId("");
    setAxisSuggestions([]);
    setLastFollowUpSummary(null);
    localStorage.removeItem("axis_last_followup_summary");

    if (readyTimeoutRef.current) {
      window.clearTimeout(readyTimeoutRef.current);
      readyTimeoutRef.current = null;
    }
  };

  const handleAnalyzeAxisText = () => {
    const text = transcript.trim();

    if (!text) {
      alert("Primero graba o escribe una conversación.");
      return;
    }

    const suggestions = analyzeAxisTextLocally(text);

    if (!suggestions.length) {
      setAxisSuggestions([]);
      setAxisMessage("No detecté acciones claras. Puedes guardar la gestión manualmente.");
      return;
    }

    setAxisSuggestions(suggestions);
    setAxisMessage(
      `Axis detectó ${suggestions.length} acción(es). Revisa y ejecuta si está correcto.`
    );
  };

  const handleExecuteAxisSuggestions = () => {
    if (!axisSuggestions.length) {
      alert("Primero analiza el texto con Axis.");
      return;
    }

    const hasManagement = axisSuggestions.some((s) => s.type === "guardar_gestion");
    const hasFollowUp = axisSuggestions.some((s) => s.type === "crear_seguimiento");
    const hasQuote = axisSuggestions.some((s) => s.type === "crear_cotizacion");

    if (hasManagement) {
      handleSaveManagement();
    }

    if (hasFollowUp) {
      handleCreateFollowUp();
    }

    setAxisSuggestions([]);

    if (hasQuote) {
      handleCreateQuote();
    } else {
      setAxisMessage("Acciones ejecutadas correctamente.");
    }
  };

  const handleSearchContacts = () => {
    const text = transcript.trim();

    if (!text) {
      alert("Primero graba o escribe un texto para buscar.");
      return;
    }

    localStorage.setItem("axis_contact_search", text);

    window.dispatchEvent(
      new CustomEvent("axis:navigate", {
        detail: { page: "contacts" }
      })
    );

    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("axis:contact-search", {
          detail: { search: text }
        })
      );
    }, 150);
  };

  const handleCreateQuote = () => {
    const text = transcript.trim();

    if (!text) {
      alert("Primero graba o escribe el texto de la cotización.");
      return;
    }

    let quotePrompt = buildQuotePromptFromAxisText(text);

    if (resolvedContact && !quotePrompt.toLowerCase().includes(resolvedContact.fullName.toLowerCase())) {
      quotePrompt = `Contacto: ${resolvedContact.fullName}\nCliente: ${resolvedAccount?.nombreComercial || resolvedAccount?.razonSocial || ''}\n${quotePrompt}`;
    } else if (resolvedAccount && !quotePrompt.toLowerCase().includes((resolvedAccount.nombreComercial || resolvedAccount.razonSocial).toLowerCase())) {
      quotePrompt = `Cliente: ${resolvedAccount.nombreComercial || resolvedAccount.razonSocial}\n${quotePrompt}`;
    }

    localStorage.setItem("axis_quote_prompt", quotePrompt);

    window.dispatchEvent(
      new CustomEvent("axis:navigate", {
        detail: { page: "quotes" }
      })
    );

    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("axis:create-quote", {
          detail: { prompt: quotePrompt }
        })
      );
    }, 150);
  };

  const getActionContactOrWarn = () => {
    if (ambiguousContacts.length > 1 && !selectedContactId) {
      alert(
        "Encontré varios contactos parecidos. Selecciona manualmente el contacto correcto antes de continuar."
      );
      return null;
    }

    const contact = resolvedContact;

    if (!contact) {
      alert("Selecciona un contacto o incluye el nombre en la transcripción.");
      return null;
    }

    return contact;
  };

  const handleSaveManagement = () => {
    const text = transcript.trim();

    if (!text) {
      alert("Primero graba o escribe una gestión.");
      return;
    }

    const contact = getActionContactOrWarn();
    if (!contact) return;

    const account = resolvedAccount;

    if (!account) {
      alert("Encontré el contacto, pero no encontré la empresa vinculada.");
      return;
    }

    createActivity({
      accountId: account.id,
      contactId: contact.id,
      type: "IA",
      description: `Gestión registrada desde Axis:\n\n${text}`,
      followUpAt: null,
    });

    setAxisMessage(
      `Gestión guardada para ${getContactDisplayName(contact)} · ${
        account.nombreComercial || account.razonSocial
      }`
    );

    setRefresh((prev) => prev + 1);
  };

  const handleCreateFollowUp = () => {
    const text = transcript.trim();

    if (!text) {
      alert("Primero graba o escribe una gestión.");
      return;
    }

    const contact = getActionContactOrWarn();
    if (!contact) return;

    const account = resolvedAccount;

    if (!account) {
      alert("Encontré el contacto, pero no encontré la empresa vinculada.");
      return;
    }

    const followUpAt = detectFollowUpDate(text);

    if (!followUpAt) {
      alert(
        "No detecté fecha de seguimiento. Di algo como: llamar mañana, llamar el viernes o seguimiento en 3 días."
      );
      return;
    }

    const activity = createActivity({
      accountId: account.id,
      contactId: contact.id,
      type: "Seguimiento",
      description: `Tarea creada desde Axis:\n\n${text}`,
      followUpAt,
    });

    const summary: LastFollowUpSummary = {
      activityId: activity.id,
      contactId: contact.id,
      contactName: getContactDisplayName(contact),
      accountName: account.nombreComercial || account.razonSocial || "Sin empresa",
      followUpAt,
      description: text,
    };

    setLastFollowUpSummary(summary);
    localStorage.setItem("axis_last_followup_summary", JSON.stringify(summary));
    localStorage.setItem("axis_open_contact_id", contact.id);

    setRefresh((prev) => prev + 1);

    setAxisMessage(
      `Seguimiento creado para ${summary.contactName} · ${summary.accountName}`
    );

    window.dispatchEvent(
      new CustomEvent("axis:navigate", {
        detail: { page: "contacts" },
      })
    );

    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("axis:open-contact", {
          detail: { contactId: contact.id },
        })
      );
    }, 150);
  };

  const handleOpenContactFromFollowUp = (contactId?: string) => {
    if (!contactId) {
      alert("Este seguimiento no tiene contacto vinculado.");
      return;
    }

    localStorage.setItem("axis_open_contact_id", contactId);

    window.dispatchEvent(
      new CustomEvent("axis:navigate", {
        detail: { page: "contacts" },
      })
    );

    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("axis:open-contact", {
          detail: { contactId },
        })
      );
    }, 150);
  };

  const handleCreateQuoteFromFollowUp = (activity: any) => {
    const text = (activity?.description || "").trim();

    if (!text) {
      alert("Este seguimiento no tiene texto para crear la cotización.");
      return;
    }

    const quotePrompt = buildQuotePromptFromAxisText(text);

    localStorage.setItem("axis_quote_prompt", quotePrompt);

    window.dispatchEvent(
      new CustomEvent("axis:navigate", {
        detail: { page: "quotes" },
      })
    );

    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("axis:create-quote", {
          detail: { prompt: quotePrompt },
        })
      );
    }, 150);
  };

  const handlePostponeFollowUp = (
    activityId: string,
    mode: "tomorrow" | "plus3" | "nextMonday"
  ) => {
    let nextDate: Date;

    if (mode === "tomorrow") {
      nextDate = addDaysToDate(new Date(), 1);
    } else if (mode === "plus3") {
      nextDate = addDaysToDate(new Date(), 3);
    } else {
      nextDate = getNextWeekdayDate(1);
    }

    updateActivity(activityId, {
      followUpAt: nextDate.toISOString(),
      status: "pendiente",
    });

    setRefresh((prev) => prev + 1);
    setAxisMessage(
      `Seguimiento pospuesto para ${formatAxisDateTime(nextDate.toISOString())}.`
    );
  };

  const handleCompleteFollowUp = (activityId: string) => {
    updateActivity(activityId, {
      status: "completada",
      completedAt: new Date().toISOString(),
    });

    setRefresh((prev) => prev + 1);
    setAxisMessage("Seguimiento marcado como completado.");
  };

  const handleDeleteFollowUp = (activityId: string) => {
    if (window.confirm("¿Estás seguro de que deseas eliminar este seguimiento permanentemente?")) {
      deleteActivity(activityId);
      setRefresh((prev) => prev + 1);
      setAxisMessage("Seguimiento eliminado correctamente.");
    }
  };

  const handleClearAll = () => {
    const user = getActiveUser();
    if (!user) return;
    if (window.confirm("¿Estás absolutamente seguro de que deseas eliminar TODOS los seguimientos pendientes y vencidos de tu lista? Esta acción es irreversible.")) {
      clearAllPendingFollowUps(user.id);
      setRefresh((prev) => prev + 1);
      setAxisMessage("Todos los seguimientos pendientes han sido eliminados.");
    }
  };

  return (
    <div className="p-8 bg-slate-50 min-h-screen dark:bg-slate-900 transition-colors">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Axis</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Prueba inicial de transcripción por voz con depuración avanzada.
          </p>
        </div>

        {!supported && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Este navegador no soporta transcripción por voz.
          </div>
        )}

        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={isListening ? stopListening : startListening}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all ${
                isListening
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
            >
              {isListening ? <Square size={16} /> : <Mic size={16} />}
              {isListening ? "Detener" : "Iniciar micrófono"}
            </button>

            <button
              type="button"
              onClick={handleCopy}
              disabled={!transcript.trim()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Copy size={16} />
              Copiar texto
            </button>

            <button
              type="button"
              onClick={handleAnalyzeAxisText}
              disabled={!transcript.trim()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles size={16} />
              Analizar con IA
            </button>

            <button
              type="button"
              onClick={handleSearchContacts}
              disabled={!transcript.trim()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Search size={16} />
              Buscar en Contactos
            </button>

            <button
              type="button"
              onClick={handleCreateQuote}
              disabled={!transcript.trim()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileText size={16} />
              Crear cotización
            </button>

            <button
              type="button"
              onClick={handleSaveManagement}
              disabled={!transcript.trim()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={16} />
              Guardar gestión
            </button>

            <button
              type="button"
              onClick={handleCreateFollowUp}
              disabled={!transcript.trim()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CalendarPlus size={16} />
              Crear tarea
            </button>

            <button
              type="button"
              onClick={handleClear}
              disabled={!transcript.trim()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={16} />
              Limpiar
            </button>
          </div>

          {isListening && !isMicReady && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
              Espera un momento. Axis está preparando el micrófono.
            </div>
          )}

          {isListening && isMicReady && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
              Micrófono listo. Habla ahora.
            </div>
          )}

          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className="text-sm font-black text-amber-900">
                  Revisa contacto y empresa antes de actuar
                </p>
                <p className="text-xs font-semibold text-amber-700 mt-1">
                  Si el micrófono escribe mal el nombre de la empresa, selecciona el contacto correcto aquí.
                </p>
              </div>

              <span className="px-3 py-1 rounded-full bg-white border border-amber-200 text-[10px] font-black uppercase tracking-widest text-amber-700">
                Revisión
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black text-amber-700 uppercase tracking-widest mb-2">
                  Contacto
                </label>

                <select
                  value={selectedContactId}
                  onChange={(e) => setSelectedContactId(e.target.value)}
                  className="w-full border border-amber-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-amber-100 focus:border-amber-400 bg-white"
                >
                  <option value="">
                    {detectedContact
                      ? `Detectado: ${getContactPersonName(detectedContact)}`
                      : "Seleccionar contacto manualmente..."}
                  </option>

                  {axisContacts.map((contact: any) => {
                    return (
                      <option key={contact.id} value={contact.id}>
                        {getContactPersonName(contact)}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-amber-700 uppercase tracking-widest mb-2">
                  Empresa vinculada
                </label>

                <div className="w-full border border-amber-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 bg-white min-h-[46px]">
                  {resolvedAccount
                    ? resolvedAccount.nombreComercial || resolvedAccount.razonSocial
                    : "Sin empresa detectada"}
                </div>
              </div>
            </div>

            {ambiguousContacts.length > 1 && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-red-700">
                Encontré varios contactos parecidos. Selecciona manualmente el contacto correcto antes de guardar gestión o crear tarea.
              </div>
            )}
          </div>

          {axisSuggestions.length > 0 && (
            <div className="rounded-2xl border border-purple-200 bg-purple-50 px-4 py-4">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <p className="text-sm font-black text-purple-900">
                    Acciones sugeridas por Axis
                  </p>
                  <p className="text-xs font-semibold text-purple-700 mt-1">
                    Revisa antes de ejecutar. Por ahora es análisis local, sin Gemini.
                  </p>
                </div>

                <span className="px-3 py-1 rounded-full bg-white border border-purple-200 text-[10px] font-black uppercase tracking-widest text-purple-700">
                  Beta
                </span>
              </div>

              <div className="space-y-2">
                {axisSuggestions.map((item) => (
                  <div
                    key={item.type}
                    className="flex items-start gap-3 rounded-xl bg-white border border-purple-100 px-4 py-3"
                  >
                    <CheckCircle2 size={17} className="text-purple-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-black text-slate-900">
                        {item.title}
                      </p>
                      <p className="text-xs font-semibold text-slate-500 mt-1">
                        {item.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleExecuteAxisSuggestions}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold bg-purple-600 text-white hover:bg-purple-700"
                >
                  <Sparkles size={16} />
                  Ejecutar sugerencias
                </button>

                <button
                  type="button"
                  onClick={() => setAxisSuggestions([])}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold bg-white border border-purple-200 text-purple-700 hover:bg-purple-100"
                >
                  Cancelar sugerencias
                </button>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-3">
              Transcripción
            </p>

            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Aquí aparecerá el texto transcrito..."
              className="w-full min-h-[320px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 text-sm dark:text-white outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />

            {micStatus && (
              <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">
                {micStatus}
              </div>
            )}

            {axisMessage && (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
                {axisMessage}
              </div>
            )}

            {lastFollowUpSummary && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
                <p className="text-[11px] font-black uppercase tracking-widest text-amber-700 mb-2">
                  Último seguimiento creado
                </p>

                <p className="text-sm font-black text-slate-900">
                  {lastFollowUpSummary.contactName}
                </p>

                <p className="text-xs font-bold text-slate-500 mt-1">
                  {lastFollowUpSummary.accountName}
                </p>

                <p className="text-xs font-black text-amber-700 mt-3">
                  {formatAxisDateTime(lastFollowUpSummary.followUpAt)}
                </p>

                <p className="text-xs font-semibold text-slate-700 mt-3 whitespace-pre-wrap">
                  {lastFollowUpSummary.description}
                </p>

                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem("axis_open_contact_id", lastFollowUpSummary.contactId);

                    window.dispatchEvent(
                      new CustomEvent("axis:navigate", {
                        detail: { page: "contacts" },
                      })
                    );

                    setTimeout(() => {
                      window.dispatchEvent(
                        new CustomEvent("axis:open-contact", {
                          detail: { contactId: lastFollowUpSummary.contactId },
                        })
                      );
                    }, 150);
                  }}
                  className="mt-4 px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-black hover:bg-amber-700 transition-colors"
                >
                  Ver en contacto
                </button>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-900/30 px-4 py-3 text-[12px] text-blue-700 dark:text-blue-400">
            Usa Chrome o Edge para esta prueba inicial. Esta versión solo convierte voz a texto.
          </div>
        </div>

        {/* Seguimientos pendientes */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 mt-6 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-sm font-black text-slate-900 dark:text-white">
                Seguimientos pendientes
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
                Próximas acciones creadas desde Axis o desde el historial.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {pendingFollowUps.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-[10px] font-black uppercase tracking-wider transition-colors"
                >
                  Limpiar todo
                </button>
              )}
              <div className="px-3 py-1.5 rounded-xl bg-blue-50 text-blue-700 text-xs font-black">
                {pendingFollowUps.length}
              </div>
            </div>
          </div>

          {pendingFollowUps.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-4 text-xs text-slate-400 font-semibold">
              No hay seguimientos pendientes.
            </div>
          ) : (
            <div className="space-y-3">
              {pendingFollowUps.map((activity: any) => {
                const contact = axisContacts.find((c: any) => c.id === activity.contactId);
                const account = axisAccounts.find((a: any) => a.id === activity.accountId);
                const followUpStatus = getFollowUpStatus(activity.followUpAt, activity.status);

                return (
                  <div
                    key={activity.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50 dark:bg-slate-900/40 dark:border-slate-700 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-900 dark:text-white">
                          {contact ? getContactDisplayName(contact) : "Sin contacto"}
                        </p>
                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                          {account?.nombreComercial || account?.razonSocial || "Sin empresa"}
                        </p>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-2">
                        <div className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-50 text-amber-700 text-[11px] font-black">
                          <Clock size={13} />
                          {formatAxisDateTime(activity.followUpAt)}
                        </div>
                        <div className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest ${followUpStatus.className}`}>
                          {followUpStatus.label}
                        </div>
                      </div>
                    </div>

                    <p className="mt-3 text-xs text-slate-600 dark:text-slate-300 font-semibold whitespace-pre-wrap line-clamp-3">
                      {activity.description}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenContactFromFollowUp(activity.contactId)}
                        className="px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-black hover:bg-blue-700 transition-colors"
                      >
                        Ver contacto
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCreateQuoteFromFollowUp(activity)}
                        className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 transition-colors"
                      >
                        Crear cotización
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePostponeFollowUp(activity.id, "tomorrow")}
                        className="px-3 py-2 rounded-xl bg-amber-100 text-amber-800 text-xs font-black hover:bg-amber-200 transition-colors"
                      >
                        Mañana
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePostponeFollowUp(activity.id, "plus3")}
                        className="px-3 py-2 rounded-xl bg-orange-100 text-orange-800 text-xs font-black hover:bg-orange-200 transition-colors"
                      >
                        +3 días
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePostponeFollowUp(activity.id, "nextMonday")}
                        className="px-3 py-2 rounded-xl bg-violet-100 text-violet-800 text-xs font-black hover:bg-violet-200 transition-colors"
                      >
                        Próximo lunes
                      </button>
                      <button
                        type="button"
                        onClick={() => setFollowUpToComplete(activity)}
                        className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-700 transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2 size={13} />
                        ✓ Marcar como realizada
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteFollowUp(activity.id)}
                        className="px-3 py-2 rounded-xl bg-rose-100 text-rose-800 text-xs font-black hover:bg-rose-200 transition-colors flex items-center gap-1"
                      >
                        <Trash2 size={13} />
                        Eliminar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {followUpToComplete && (
        <CompleteFollowUpModal
          isOpen={!!followUpToComplete}
          activity={followUpToComplete}
          onClose={() => setFollowUpToComplete(null)}
          onConfirm={(activityId, resultNote, options) => {
            const act = followUpToComplete;
            completeFollowUpActivity(activityId, resultNote);
            setFollowUpToComplete(null);
            setRefresh((prev) => prev + 1);
            setAxisMessage("Seguimiento marcado como completado y registrado en historial.");

            if (options?.createQuote && act) {
              handleCreateQuoteFromFollowUp(act);
            } else if (options?.createNextFollowUp && act?.contactId) {
              handleOpenContactFromFollowUp(act.contactId);
            }
          }}
        />
      )}
    </div>
  );
}