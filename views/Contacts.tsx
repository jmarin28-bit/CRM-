// pages/Contacts.tsx
import React, { useMemo, useState, useEffect } from 'react';
import { 
  listContactsByUser, 
  listAccountsByUser, 
  createActivity, 
  createTask,
  listActivities, 
  updateContact, 
  deleteContact,
  createContact,
  deleteActivity,
  isActivityDone,
  completeFollowUpActivity
} from '../services/storage';
import { generateAIEmailResponse, generateAIWhatsAppResponse } from '../services/gemini';
import { ContactV2, AccountV2, ActivityV2, CRMUser } from '../types';
import { CompleteFollowUpModal } from '../components/CompleteFollowUpModal';
import { 
  User, Mail, Phone, MessageCircle, Briefcase, 
  Plus, X, Search, Trash2, Building2, Calendar, Video, Clock, StickyNote, CheckCircle2
} from 'lucide-react';

const ACTIVITY_FILTERS = [
  "Todos", "IA", "Nota", "Seguimiento", "Tarea interna", "Llamada", "Correo", "Reunión", "Videollamada", "Visita", "WhatsApp"
];

const NEW_MANAGEMENT_TYPES = [
  "Nota", "Seguimiento", "Llamada", "Reunión", "Cotización enviada", "Tarea interna",
];

const ACTIVITY_DATE_FILTERS = ["Todas", "Hoy", "7 días", "30 días", "Este año"];

const normalizeText = (value?: string) =>
  (value || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();

const formatFullDateTime = (value?: string | null) => {
  if (!value) return "Sin fecha";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "Sin fecha";
  return d.toLocaleString("es-CO", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
};

const toIsoOrNull = (value?: string | null) => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
};

const matchesDateFilter = (dateValue: string, filter: string) => {
  const d = new Date(dateValue);
  if (isNaN(d.getTime())) return filter === "Todas";
  const now = new Date();
  if (filter === "Todas") return true;
  if (filter === "Hoy") return d.toDateString() === now.toDateString();
  if (filter === "7 días") {
    const past = new Date();
    past.setDate(now.getDate() - 7);
    return d >= past;
  }
  if (filter === "30 días") {
    const past = new Date();
    past.setDate(now.getDate() - 30);
    return d >= past;
  }
  if (filter === "Este año") return d.getFullYear() === now.getFullYear();
  return true;
};

const previewText = (
  text: string,
  expanded: boolean,
  max = 240,
  forceFull = false
) => {
  if (forceFull || expanded || text.length <= max) return text;
  return text.slice(0, max).trim() + "...";
};

const normalizeSearchText = (value: string) =>
  (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const InputWithIcon = ({ icon: Icon, label, ...props }: any) => (
  <div className="space-y-2">
    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
      {label}
    </label>
    <div className="relative group">
      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-300 group-focus-within:text-blue-500 transition-colors">
        <Icon size={15} />
      </div>
      <input
        {...props}
        className="w-full bg-slate-50 border border-slate-200 rounded-[20px] pl-11 pr-4 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all placeholder:text-slate-300 text-slate-700 shadow-sm"
      />
    </div>
  </div>
);

export default function Contacts({ activeUser }: { activeUser?: CRMUser }) {
  const [refresh, setRefresh] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedContact, setSelectedContact] = useState<ContactV2 | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  const [formData, setFormData] = useState({ fullName: "", role: "", email: "", phone: "", whatsapp: "", accountId: "" });
  const [newNote, setNewNote] = useState("");
  const [newManagementType, setNewManagementType] = useState("Nota");
  const [followUpDate, setFollowUpDate] = useState("");

  const [activitySearch, setActivitySearch] = useState("");
  const [activityTypeFilter, setActivityTypeFilter] = useState("Todos");
  const [activityDateFilter, setActivityDateFilter] = useState("Todas");
  const [visibleActivities, setVisibleActivities] = useState(10);
  const [expandedActivities, setExpandedActivities] = useState<Record<string, boolean>>({});

  const [showCallModal, setShowCallModal] = useState(false);
  const [callContact, setCallContact] = useState<ContactV2 | null>(null);
  const [callPhone, setCallPhone] = useState("");
  const [callOutcome, setCallOutcome] = useState("");
  const [callSummary, setCallSummary] = useState("");
  const [callInterest, setCallInterest] = useState("Medio");
  const [callUrgency, setCallUrgency] = useState("Media");
  const [callNextAction, setCallNextAction] = useState("");
  const [callFollowUpAt, setCallFollowUpAt] = useState("");

  const [followUpToComplete, setFollowUpToComplete] = useState<ActivityV2 | null>(null);

  // Gmail Modal State
  const [showGmailModal, setShowGmailModal] = useState(false);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [googleAccountEmail, setGoogleAccountEmail] = useState("");
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [emailsList, setEmailsList] = useState<any[]>([]);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiPromptTopic, setAiPromptTopic] = useState("");

  const checkGoogleConnection = async (): Promise<{ connected: boolean; email?: string }> => {
    try {
      const res = await fetch(`/api/google-oauth/status?userId=${activeUser?.id}`);
      if (res.ok) {
        const data = await res.json();
        setIsGoogleConnected(Boolean(data.connected));
        setGoogleAccountEmail(data.email || "");
        return data;
      }
    } catch (e) {
      console.error(e);
    }
    setIsGoogleConnected(false);
    return { connected: false };
  };

  useEffect(() => {
    if (activeUser?.id) {
      checkGoogleConnection();
    }
  }, [activeUser?.id]);

  const isEmailAllowed = useMemo(() => {
    if (isGoogleConnected) return true;
    if (!googleAccountEmail) return false;
    if (!activeUser?.email) return true;
    return googleAccountEmail.toLowerCase().trim() === activeUser.email.toLowerCase().trim();
  }, [isGoogleConnected, googleAccountEmail, activeUser?.email]);



  // Calendar Modal State
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [calTitle, setCalTitle] = useState("");
  const [calDate, setCalDate] = useState("");
  const [calDuration, setCalDuration] = useState(60);
  const [calDescription, setCalDescription] = useState("");
  const [calLocation, setCalLocation] = useState("");
  const [calCreateMeet, setCalCreateMeet] = useState(false);
  const [calLoading, setCalLoading] = useState(false);

  // WhatsApp Modal State
  const [showWaModal, setShowWaModal] = useState(false);
  const [waContact, setWaContact] = useState<ContactV2 | null>(null);
  const [waPhone, setWaPhone] = useState("");
  const [waMessage, setWaMessage] = useState("");
  const [waPrompt, setWaPrompt] = useState("");
  const [waStep, setWaStep] = useState<'draft' | 'confirm_register'>('draft');
  const [waGenerating, setWaGenerating] = useState(false);

  const contacts = useMemo(() => listContactsByUser(activeUser), [refresh, activeUser?.id]);
  const accounts = useMemo(() => listAccountsByUser(activeUser), [refresh, activeUser?.id]);

  useEffect(() => {
    const applyAxisSearch = (value?: string | null) => {
      const clean = (value || "").trim();
      if (!clean) return;

      setSearchTerm(clean);
      localStorage.removeItem("axis_contact_search");
    };

    applyAxisSearch(localStorage.getItem("axis_contact_search"));

    const handleAxisContactSearch = (event: Event) => {
      const customEvent = event as CustomEvent<{ search?: string }>;
      applyAxisSearch(customEvent.detail?.search);
    };

    window.addEventListener("axis:contact-search", handleAxisContactSearch);

    return () => {
      window.removeEventListener("axis:contact-search", handleAxisContactSearch);
    };
  }, []);

  // Nuevo bloque agregado justo debajo
  useEffect(() => {
    const openContactById = (contactId?: string | null) => {
      const cleanId = (contactId || "").trim();
      if (!cleanId) return;

      const found = contacts.find((contact) => contact.id === cleanId);

      if (!found) return;

      setSelectedContact(found);
      setSearchTerm("");
      localStorage.removeItem("axis_open_contact_id");
    };

    openContactById(localStorage.getItem("axis_open_contact_id"));

    const handleAxisOpenContact = (event: Event) => {
      const customEvent = event as CustomEvent<{ contactId?: string }>;
      openContactById(customEvent.detail?.contactId);
    };

    window.addEventListener("axis:open-contact", handleAxisOpenContact);

    return () => {
      window.removeEventListener("axis:open-contact", handleAxisOpenContact);
    };
  }, [contacts]);

  const filteredContacts = contacts.filter((c: any) => {
    const search = normalizeText(searchTerm);
    const account = accounts.find((a) => a.id === c.accountId);
    const contactName = normalizeText(c.fullName || c.name || `${c.firstName || ""} ${c.lastName || ""}`);
    const companyName = normalizeText(account?.nombreComercial || account?.razonSocial || "");
    const email = normalizeText(c.email || "");
    const phone = normalizeText(c.phone || c.whatsapp || "");

    return (
      !search ||
      contactName.includes(search) ||
      companyName.includes(search) ||
      email.includes(search) ||
      phone.includes(search)
    );
  });

  const selectedContactData = useMemo(() => {
    if (!selectedContact?.id) return null;
    return contacts.find((c) => c.id === selectedContact.id) || null;
  }, [selectedContact?.id, contacts]);

  const selectedAccount = useMemo(() => {
    if (!selectedContactData?.accountId) return null;
    return accounts.find((a) => a.id === selectedContactData.accountId) || null;
  }, [selectedContactData?.accountId, accounts]);
  
  const contactActivities = useMemo(() => {
    if (!selectedContactData) return [];
    const all = listActivities({ contactId: selectedContactData.id });

    // Guardar una gestión con fecha de seguimiento crea DOS registros: la
    // gestión en sí y un recordatorio pendiente que repite el mismo texto.
    // El recordatorio es necesario (el Dashboard cuenta los seguimientos
    // abiertos con él), pero no es una gestión ocurrida, así que mostrarlo acá
    // hacía que el historial repitiera la misma frase dos veces seguidas y que
    // el contador de "registros" dijera 2 por una sola acción del usuario.
    //
    // Se ocultan solo los recordatorios que otra actividad ya referencia, no
    // todo lo que esté pendiente: un seguimiento suelto sigue apareciendo.
    const companionIds = new Set(
      all.map((a) => a.followUpActivityId).filter(Boolean) as string[]
    );

    return all
      .filter((a) => !(companionIds.has(a.id) && !isActivityDone(a)))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [selectedContactData, refresh]);

  const filteredContactActivities = useMemo(() => {
    return contactActivities.filter((act) => {
      const search = normalizeText(activitySearch);
      const type = normalizeText(act.type);
      const desc = normalizeText(act.description);
      const user = normalizeText(act.user);
      const typeMatch = activityTypeFilter === "Todos" || type.includes(normalizeText(activityTypeFilter));
      const dateMatch = matchesDateFilter(act.createdAt, activityDateFilter);
      const textMatch = !search || type.includes(search) || desc.includes(search) || user.includes(search);
      return typeMatch && dateMatch && textMatch;
    });
  }, [contactActivities, activitySearch, activityTypeFilter, activityDateFilter]);
  
  const visibleFilteredActivities = useMemo(() => filteredContactActivities.slice(0, visibleActivities), [filteredContactActivities, visibleActivities]);

  useEffect(() => {
    setActivitySearch("");
    setActivityTypeFilter("Todos");
    setActivityDateFilter("Todas");
    setVisibleActivities(10);
    setExpandedActivities({});
  }, [selectedContactData?.id]);

  const handleDeleteActivity = (activityId: string) => {
    if (window.confirm("¿Estás seguro de que deseas eliminar este registro permanentemente?")) {
      deleteActivity(activityId);
      setRefresh(prev => prev + 1);
    }
  };

  const handleOpenNew = () => { 
    setFormData({ fullName: "", role: "", email: "", phone: "", whatsapp: "", accountId: "" }); 
    setIsEditing(false); 
    setShowForm(true); 
  };
  
  const handleSaveCall = () => {
    if (!callContact) return;
    if (!callOutcome) return alert("Debes seleccionar el resultado de la llamada.");
    
    const description = `Resultado: ${callOutcome}\nInterés: ${callInterest}\nUrgencia: ${callUrgency}\nPróxima acción: ${callNextAction || "Sin acción"}${callSummary ? `\n\nResumen:\n${callSummary.trim()}` : ""}`;
    
    createActivity({
      accountId: callContact.accountId,
      contactId: callContact.id,
      type: "Llamada",
      description,
      followUpAt: toIsoOrNull(callFollowUpAt),
    });

    if (callNextAction === "Crear tarea interna" || callNextAction === "Preparar cotización") {
      createTask({
        title: callNextAction === "Preparar cotización" ? `Preparar cotización - ${callContact.fullName}` : `Tarea interna - ${callContact.fullName}`,
        description,
        assignedTo: activeUser?.id,
        accountId: callContact.accountId,
        contactId: callContact.id,
        dueDate: toIsoOrNull(callFollowUpAt),
        createdBy: activeUser?.id,
        priority: callUrgency === "Alta" ? "Alta" : callUrgency === "Baja" ? "Baja" : "Media",
      });
    }
  
    setShowCallModal(false);
    setRefresh((r) => r + 1);
  };

  const handleSaveContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fullName || !formData.accountId) return alert("⚠️ Error: Nombre y Empresa requeridos.");
    isEditing && selectedContactData ? updateContact({ ...selectedContactData, ...formData }) : createContact(formData);
    setShowForm(false); setSelectedContact(null); setRefresh(r => r + 1);
  };

  const handleQuickAction = async (type: string) => {
    if (!selectedContactData) return;
    const accountName = selectedAccount?.nombreComercial || selectedAccount?.razonSocial || "Empresa";

    if (type === '📞 Llamada') {
      setCallContact(selectedContactData);
      setCallPhone(selectedContactData.phone || selectedContactData.whatsapp || "");
      setShowCallModal(true);
      return;
    }

    if (type === "💬 WhatsApp") {
      const phoneNum = selectedContactData.whatsapp || selectedContactData.phone;
      if (!phoneNum || !phoneNum.trim()) {
        alert("Este contacto no tiene un número de WhatsApp registrado.");
        return;
      }
      
      setWaContact(selectedContactData);
      setWaPhone(phoneNum);
      setWaMessage("");
      setWaPrompt("");
      setWaStep("draft");
      setShowWaModal(true);
      return;
    }

    // Acciones API de Google
    const connStatus = await checkGoogleConnection();
    if (!connStatus.connected) {
      alert("⚠️ Para usar esta función, primero debes conectar tu cuenta de Google en tu Perfil (icono de engranaje en la barra superior del CRM).");
      return;
    }

    if (type === "✉️ Correo") {
      setShowGmailModal(true);
      setGmailLoading(true);
      setEmailSubject("Seguimiento Comercial - IonCore SAS");
      setEmailBody("");
      setAiPromptTopic("");

      try {
        const res = await fetch(`/api/google-oauth/emails?userId=${activeUser?.id}&contactEmail=${selectedContactData.email}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setEmailsList(data.emails || []);
          }
        }
      } catch (e) {
        console.error("Error cargando correos:", e);
      } finally {
        setGmailLoading(false);
      }
    } else if (type === "📅 Reunión" || type === "🎥 Videollamada") {
      setCalTitle(`${type === "🎥 Videollamada" ? "Videollamada" : "Reunión"} con ${selectedContactData.fullName}`);
      setCalDate("");
      setCalDuration(60);
      setCalLocation("");
      setCalDescription(`Reunión comercial de seguimiento con ${selectedContactData.fullName} de ${accountName}.`);
      setCalCreateMeet(type === "🎥 Videollamada"); // Activo por defecto si viene del botón Video
      setShowCalendarModal(true);
    }
  };

  const handleGenerateAIWhatsApp = async () => {
    if (!waContact) return;
    setWaGenerating(true);
    try {
      const companyName = selectedAccount?.nombreComercial || selectedAccount?.razonSocial || "Empresa";
      const response = await generateAIWhatsAppResponse(
        waContact.fullName,
        companyName,
        waPrompt
      );
      setWaMessage(response);
    } catch (e) {
      console.error(e);
      alert("Error al generar mensaje con IA.");
    } finally {
      setWaGenerating(false);
    }
  };

  const handleOpenWhatsApp = () => {
    if (!waPhone) return;
    
    // Normalizar número colombiano
    const digits = waPhone.replace(/\D/g, "");
    let normalized = digits;
    if (digits.length === 10 && digits.startsWith("3")) {
      normalized = "57" + digits;
    } else if (digits.startsWith("57") && digits.length === 12) {
      normalized = digits;
    }
    
    const waUrl = `https://api.whatsapp.com/send?phone=${normalized}&text=${encodeURIComponent(waMessage)}`;
    window.open(waUrl, "_blank");
    setWaStep("confirm_register");
  };

  const handleRegisterWaActivity = () => {
    if (!waContact) return;
    
    createActivity({
      accountId: waContact.accountId,
      contactId: waContact.id,
      type: "WhatsApp",
      description: `Mensaje de WhatsApp abierto para envío:\nNúmero: ${waPhone}\n\nMensaje:\n${waMessage}`
    });
    
    setRefresh(prev => prev + 1);
    setShowWaModal(false);
  };

  const handleSendEmail = async () => {
    if (!selectedContactData?.email) return alert("El contacto no tiene correo registrado.");
    if (!emailSubject.trim() || !emailBody.trim()) return alert("Asunto y cuerpo del correo son requeridos.");

    setGmailLoading(true);
    try {
      const res = await fetch('/api/google-oauth/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: activeUser?.id,
          to: selectedContactData.email,
          subject: emailSubject,
          emailBody: emailBody
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          createActivity({
            accountId: selectedContactData.accountId,
            contactId: selectedContactData.id,
            type: "Correo",
            description: `Correo Enviado por Gmail:\nAsunto: ${emailSubject}\n\n${emailBody}`,
            gmailMessageId: data.id,
            threadId: data.threadId,
            from: googleAccountEmail,
            to: selectedContactData.email,
            subject: emailSubject,
            body: emailBody,
            sentAt: new Date().toISOString(),
            status: "sent"
          });
          alert("¡Correo enviado con éxito!");
          setShowGmailModal(false);
          setRefresh(r => r + 1);
        } else {
          alert(`Error al enviar correo: ${data.error || 'Respuesta fallida de la API'}`);
        }
      } else {
        const errText = await res.text();
        let errMsg = errText;
        try {
          const errJson = JSON.parse(errText);
          if (errJson.error) {
            errMsg = errJson.error;
          }
        } catch (e) {}
        alert(`Error al enviar correo: ${errMsg}`);
      }
    } catch (e: any) {
      console.error(e);
      alert(`Error al enviar correo: ${e.message}`);
    } finally {
      setGmailLoading(false);
    }
  };

  const handleGenerateAIResponse = async () => {
    if (!selectedContactData) return;
    setAiGenerating(true);
    try {
      const lastEmail = emailsList[0]?.body || "";
      const companyName = selectedAccount?.nombreComercial || selectedAccount?.razonSocial || "Empresa";
      
      const response = await generateAIEmailResponse(
        selectedContactData.fullName,
        selectedContactData.role || "Contacto",
        companyName,
        lastEmail,
        aiPromptTopic
      );
      setEmailBody(response);
    } catch (e) {
      console.error(e);
      alert("Error al generar respuesta con IA.");
    } finally {
      setAiGenerating(false);
    }
  };

  const handleCreateCalendarEvent = async () => {
    if (!calTitle.trim() || !calDate) return alert("Título y fecha de la reunión son requeridos.");
    // Sin contacto seleccionado la reunión igual se creaba en Google Calendar,
    // pero la actividad quedaba con accountId undefined: invisible en el timeline
    // de cualquier cuenta. Se corta antes de llamar a la API, no después
    // (mismo criterio que handleGenerateAIResponse más arriba).
    if (!selectedContactData) return alert("Seleccioná un contacto antes de agendar la reunión.");

    setCalLoading(true);
    try {
      const res = await fetch('/api/google-oauth/calendar-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: activeUser?.id,
          title: calTitle,
          description: calDescription,
          location: calLocation,
          dateTime: calDate,
          durationMinutes: calDuration,
          contactEmail: selectedContactData?.email || "",
          createMeet: calCreateMeet
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          const meetText = data.hangoutLink ? `\nEnlace de Google Meet: ${data.hangoutLink}` : "";
          const finalDescription = `${calDescription}${meetText}`;

          createActivity({
            accountId: selectedContactData.accountId,
            contactId: selectedContactData.id,
            type: calCreateMeet ? "Videollamada" : "Reunión",
            description: `Reunión agendada en Google Calendar: ${calTitle}\nFecha: ${new Date(calDate).toLocaleString('es-CO')}\nUbicación: ${calLocation || 'Google Meet'}\nDetalle: ${finalDescription}`
          });

          alert("¡Reunión agendada con éxito en Google Calendar!");
          setShowCalendarModal(false);
          setRefresh(r => r + 1);
        } else {
          alert(`Error al agendar: ${data.error}`);
        }
      } else {
        const errText = await res.text();
        let errMsg = errText;
        try {
          const errJson = JSON.parse(errText);
          if (errJson.error) {
            errMsg = errJson.error;
          }
        } catch (e) {}
        alert(`Error al agendar: ${errMsg}`);
      }
    } catch (e) {
      console.error(e);
      alert("Error al agendar reunión.");
    } finally {
      setCalLoading(false);
    }
  };

  const handleSaveNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim() || !selectedContactData) return;

    const followUpIso = toIsoOrNull(followUpDate);
    let followUpId: string | undefined = undefined;

    if (followUpIso) {
      const pendingAct = createActivity({
        accountId: selectedContactData.accountId,
        contactId: selectedContactData.id,
        type: newManagementType,
        description: `Seguimiento: ${newNote.trim()}`,
        followUpAt: followUpIso,
        status: "pendiente"
      });
      followUpId = pendingAct.id;
    }

    createActivity({
      accountId: selectedContactData.accountId,
      contactId: selectedContactData.id,
      type: newManagementType,
      description: newNote.trim(),
      followUpActivityId: followUpId,
      status: "completada"
    });

    if (newManagementType === "Tarea interna") {
      createTask({ 
        title: `Tarea interna - ${selectedContactData.fullName}`, 
        description: newNote.trim(), 
        assignedTo: activeUser?.id, 
        accountId: selectedContactData.accountId, 
        contactId: selectedContactData.id, 
        dueDate: followUpIso, 
        createdBy: activeUser?.id, 
        priority: "Media" 
      });
    }

    setNewNote("");
    setFollowUpDate("");
    setRefresh(r => r + 1);
  };

  return (
    <div className="p-8 xl:p-10 2xl:p-12 bg-slate-50 min-h-screen font-sans overflow-x-hidden">
      
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-5 mb-12">
        <div>
          <h1 className="text-5xl xl:text-6xl font-black uppercase tracking-tighter italic text-slate-900 leading-none">Contactos</h1>
          <p className="text-base text-slate-500 dark:text-slate-400 mt-2">Bienvenido de nuevo, {activeUser?.name}.</p>
        </div>
        <button onClick={handleOpenNew} className="bg-blue-600 hover:bg-slate-900 text-white px-8 py-3 rounded-[20px] font-black shadow-xl shadow-blue-200 flex items-center gap-2 transition-all uppercase text-xs tracking-widest"><Plus size={18} /> Nuevo Registro</button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[30%,70%] gap-6 h-[84vh]">
        {/* PANEL IZQUIERDO */}
        <div className="bg-white border border-slate-200 rounded-[36px] overflow-hidden flex flex-col min-h-0 shadow-sm">
          <div className="relative mb-0 p-5 border-b border-slate-100">
            <Search className="absolute left-8 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input type="text" placeholder="Filtrar por nombre..." className="w-full pl-10 pr-4 py-3 bg-slate-50 border-none rounded-2xl text-xs font-bold focus:ring-0" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <div className="space-y-3 flex-1 overflow-y-auto p-5 custom-scrollbar">
            {filteredContacts.map(c => (
              <div 
                key={c.id} 
                onClick={() => setSelectedContact(c)} 
                className={`group p-4 rounded-[24px] border-2 cursor-pointer transition-all relative min-h-[96px] ${selectedContactData?.id === c.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-50 hover:border-blue-100'}`}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-sm uppercase truncate">{c.fullName}</p>
                    <p className={`text-[10px] font-bold uppercase tracking-widest mt-1 ${selectedContactData?.id === c.id ? 'text-white/70' : 'text-blue-600'}`}>{accounts.find(a => a.id === c.accountId)?.razonSocial}</p>
                  </div>
                  <button onClick={(e) => {
                    e.stopPropagation();
                    // El botón está sobre la fila y aparece al pasar el mouse:
                    // sin confirmación un clic desviado borra el contacto.
                    if (!window.confirm(`¿Eliminar el contacto "${c.fullName}"? Sus oportunidades y cotizaciones se conservan en la cuenta.`)) return;
                    deleteContact(c.id);
                    if (selectedContact?.id === c.id) setSelectedContact(null);
                    setRefresh(r => r + 1);
                  }} className={`p-2 rounded-xl transition-all opacity-0 group-hover:opacity-100 ${selectedContactData?.id === c.id ? 'text-white/50 hover:text-white' : 'text-slate-300 hover:text-red-500'}`}><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* PANEL DERECHO */}
        <div className="bg-white rounded-[36px] border border-slate-200 flex flex-col overflow-hidden min-h-0 shadow-sm">
          {selectedContactData ? (
            <>
              <div className="px-8 xl:px-10 py-8 border-b border-slate-100 flex items-start justify-between gap-6">
                <div className="flex items-start gap-5 min-w-0">
                  <div className="w-16 h-16 rounded-[22px] bg-slate-900 text-white flex items-center justify-center text-3xl font-black shrink-0">{selectedContactData.fullName.charAt(0)}</div>
                  <div className="min-w-0">
                    <h2 className="text-3xl font-black text-slate-900 uppercase leading-none truncate">{selectedContactData.fullName}</h2>
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mt-2 truncate">{selectedContactData.role || "Sin cargo"}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedContact(null)} className="p-3 bg-slate-50 rounded-2xl text-slate-400 hover:text-slate-700 transition-all"><X size={20} /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 xl:p-10 space-y-8 custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-5">
                  <div className="bg-slate-50 rounded-[24px] p-6 border border-slate-100 min-h-[120px] flex flex-col justify-between">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Empresa</p>
                    <p className="text-sm font-black text-slate-900 truncate">
                      {selectedAccount?.nombreComercial || selectedAccount?.razonSocial || "Sin empresa"}
                    </p>
                  </div>
                  <div className="bg-slate-50 rounded-[24px] p-6 border border-slate-100 min-h-[120px] flex flex-col justify-between">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Email</p>
                    <p className="text-sm font-black text-slate-900 truncate">{selectedContactData.email || "Sin email"}</p>
                  </div>
                  <div className="bg-slate-50 rounded-[24px] p-6 border border-slate-100 min-h-[120px] flex flex-col justify-between">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Teléfono</p>
                    <p className="text-sm font-black text-slate-900 truncate">{selectedContactData.phone || selectedContactData.whatsapp || "Sin teléfono"}</p>
                  </div>
                  <div className="bg-slate-50 rounded-[24px] p-6 border border-slate-100 min-h-[120px] flex flex-col justify-between">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Historial</p>
                    <p className="text-sm font-black text-slate-900 truncate">{contactActivities.length} registros</p>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm">
                  <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.22em] mb-6 flex items-center gap-2"><StickyNote size={14} /> Nueva Gestión</p>
                  <textarea 
                    placeholder="¿Qué se habló con el cliente?" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-[24px] p-6 text-sm font-bold outline-none focus:ring-0 focus:border-slate-300 transition-all resize-none h-40 placeholder:text-slate-300 text-slate-700" 
                    value={newNote} 
                    onChange={e => setNewNote(e.target.value)} 
                  />
                  <div className="flex flex-col 2xl:flex-row 2xl:items-center 2xl:justify-between mt-6 gap-4">
                    <div className="flex items-center gap-3">
                      <select className="text-[11px] font-bold bg-white border border-slate-200 px-4 py-2 rounded-full outline-none" value={newManagementType} onChange={e => setNewManagementType(e.target.value)}>
                        {NEW_MANAGEMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input type="datetime-local" className="text-[11px] font-bold bg-white border border-slate-200 px-4 py-2 rounded-full outline-none" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)} />
                    </div>
                    <button onClick={handleSaveNote} className="bg-blue-600 text-white px-8 py-3 rounded-[18px] font-black text-[10px] uppercase hover:bg-blue-700 transition-all">Guardar Gestión</button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-5">
                  {[
                    { label: "Llamada", icon: Phone, action: "📞 Llamada" },
                    { label: "Correo", icon: Mail, action: "✉️ Correo" },
                    { label: "Agenda", icon: Calendar, action: "📅 Reunión" },
                    { label: "Video", icon: Video, action: "🎥 Videollamada" },
                    { label: "WhatsApp", icon: MessageCircle, action: "💬 WhatsApp" }
                  ].map(btn => (
                    <button 
                      key={btn.label} 
                      onClick={() => handleQuickAction(btn.action)} 
                      className="group flex flex-col items-center justify-center gap-3 p-6 bg-slate-50 border border-slate-200 rounded-[26px] hover:bg-slate-100 transition-all min-h-[132px]"
                    >
                      <div className="w-14 h-14 rounded-[18px] bg-white border border-slate-200 flex items-center justify-center text-slate-500">
                        <btn.icon size={20}/>
                      </div>
                      <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">{btn.label}</span>
                    </button>
                  ))}
                </div>

                <div className="space-y-8">
                  <div className="flex gap-3">
                    <div className="relative flex-1"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input type="text" placeholder="Buscar en historial..." className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold outline-none" value={activitySearch} onChange={e => setActivitySearch(e.target.value)} /></div>
                    <select className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs font-bold outline-none" value={activityTypeFilter} onChange={e => setActivityTypeFilter(e.target.value)}>
                      {ACTIVITY_FILTERS.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>

                  <div className="relative pl-10 space-y-8">
                    <div className="absolute left-[7px] top-0 bottom-0 w-0.5 bg-slate-100"></div>
                    {visibleFilteredActivities.map((act) => {
                      const expanded = !!expandedActivities[act.id];
                      const isFollowUp = normalizeText(act.type).includes("seguimiento");
                      const showDetailButton = !isFollowUp && act.description.length > 240;

                      return (
                        <div key={act.id} className="relative">
                          <div className="absolute -left-[10px] top-2 w-4 h-4 bg-white border-4 border-blue-600 rounded-full"></div>
                          <div className="bg-white border border-slate-100 p-8 rounded-[32px] shadow-sm hover:border-blue-100 transition-all">
                            <div className="flex justify-between items-start mb-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{act.type}</p>
                                  <button
                                    onClick={() => handleDeleteActivity(act.id)}
                                    className="p-1 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                                    title="Eliminar registro"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                                <p className="text-[11px] font-bold text-slate-400 uppercase mt-1">{formatFullDateTime(act.createdAt)} • {act.user || "Sistema"}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {act.followUpAt && !isActivityDone(act) && (
                                  <button
                                    type="button"
                                    onClick={() => setFollowUpToComplete(act)}
                                    className="bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter transition-colors flex items-center gap-1 shadow-sm cursor-pointer"
                                    title="Marcar este seguimiento como realizado"
                                  >
                                    <CheckCircle2 size={11} />
                                    Marcar realizado
                                  </button>
                                )}
                                {act.followUpAt && isActivityDone(act) && (
                                  <div className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter italic flex items-center gap-1">
                                    <CheckCircle2 size={11} />
                                    Completado
                                  </div>
                                )}
                                {act.followUpAt && !isActivityDone(act) && (
                                  <div className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter italic">
                                    Seguimiento: {formatFullDateTime(act.followUpAt)}
                                  </div>
                                )}
                              </div>
                            </div>
                            <p className="text-sm text-slate-700 font-bold leading-relaxed whitespace-pre-wrap break-words">
                              {previewText(act.description, expanded, 240, isFollowUp)}
                            </p>
                            
                            {showDetailButton && (
                              <button 
                                onClick={() => setExpandedActivities(prev => ({ ...prev, [act.id]: !prev[act.id] }))} 
                                className="mt-3 text-[10px] font-black uppercase text-blue-600"
                              >
                                {expanded ? "Ver menos" : "Ver detalle"}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
              <Building2 size={60} className="mb-4 opacity-20" />
              <p className="font-bold uppercase text-[10px] tracking-[0.4em]">Selecciona un contacto para gestionar</p>
            </div>
          )}
        </div>
      </div>

      {/* MODAL FORMULARIO */}
      {showForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-xl">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-5xl flex flex-col overflow-hidden border border-white">
            <div className="px-10 py-8 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h2 className="text-3xl xl:text-4xl font-black text-slate-900 uppercase tracking-tighter">
                  {isEditing ? "Editar" : "Nuevo"} Cliente
                </h2>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.24em] mt-2">
                  Registro comercial • CRM IonCore
                </p>
              </div>
              <button onClick={() => setShowForm(false)} className="p-4 bg-slate-50 rounded-2xl hover:bg-red-50 transition-all"><X size={24}/></button>
            </div>
            <form onSubmit={handleSaveContact} className="p-10 xl:p-12 space-y-10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 xl:gap-10">
                <InputWithIcon icon={User} label="Nombre Completo *" value={formData.fullName} onChange={(e:any)=>setFormData({...formData, fullName: e.target.value})}/>
                <InputWithIcon icon={Briefcase} label="Cargo" value={formData.role} onChange={(e:any)=>setFormData({...formData, role: e.target.value})}/>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Empresa *</label>
                  <select className="w-full bg-slate-50 border border-slate-200 rounded-[20px] px-4 py-3.5 text-sm font-bold outline-none text-slate-700 shadow-sm focus:ring-4 focus:ring-blue-500/10" value={formData.accountId} onChange={(e: any) => setFormData({ ...formData, accountId: e.target.value })}>
                    <option value="">Seleccionar empresa...</option>
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>{acc.nombreComercial || acc.razonSocial}</option>
                    ))}
                  </select>
                </div>
                <InputWithIcon icon={Mail} label="Email Corporativo" value={formData.email} onChange={(e:any)=>setFormData({...formData, email: e.target.value})}/>
                <InputWithIcon icon={Phone} label="Móvil" value={formData.phone} onChange={(e:any)=>setFormData({...formData, phone: e.target.value})}/>
                <InputWithIcon icon={MessageCircle} label="WhatsApp" value={formData.whatsapp} onChange={(e:any)=>setFormData({...formData, whatsapp: e.target.value})}/>
              </div>
              <div className="flex flex-col-reverse md:flex-row justify-end gap-4 pt-8 border-t border-slate-100">
                <button type="button" onClick={() => setShowForm(false)} className="px-10 py-4 font-black text-slate-400 uppercase text-[10px] tracking-[0.18em]">Cancelar</button>
                <button type="submit" className="bg-blue-600 text-white px-14 py-4 rounded-[22px] font-black text-sm uppercase shadow-2xl hover:bg-blue-700 active:scale-95 transition-all">Guardar en CRM</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE LLAMADA */}
      {showCallModal && callContact && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-xl">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-3xl overflow-hidden p-8">
            <h2 className="text-2xl font-black uppercase mb-2">Registrar llamada</h2>
            <p className="text-sm font-bold text-slate-400 mb-6">
              {callContact.fullName} • {accounts.find(a => a.id === callContact.accountId)?.nombreComercial || accounts.find(a => a.id === callContact.accountId)?.razonSocial || "Sin empresa"}
            </p>
            <div className="space-y-6">
              <select value={callOutcome} onChange={(e)=>setCallOutcome(e.target.value)} className="w-full bg-slate-50 border p-3 rounded-2xl font-bold"><option value="">Resultado...</option><option value="Contestó">Contestó</option><option value="No contestó">No contestó</option><option value="Solicita cotización">Solicita cotización</option></select>
              <textarea placeholder="Resumen de la llamada..." className="w-full bg-slate-50 border p-4 rounded-3xl h-32 font-bold" value={callSummary} onChange={(e)=>setCallSummary(e.target.value)}/>
              <div className="flex justify-end gap-4"><button onClick={()=>setShowCallModal(false)} className="px-6 font-black uppercase text-[10px]">Cerrar</button><button onClick={handleSaveCall} className="bg-blue-600 text-white px-8 py-3 rounded-2xl font-black uppercase text-[10px]">Guardar Llamada</button></div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL GMAIL */}
      {showGmailModal && selectedContactData && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-xl">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-6xl flex flex-col overflow-hidden border border-white h-[85vh]">
            <div className="px-10 py-8 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter flex items-center gap-3">
                  <Mail className="text-blue-600" size={28} /> Gmail: {selectedContactData.fullName}
                </h2>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.24em] mt-2">
                  Integración Directa • Historial & Envío de Correos
                </p>
              </div>
              <button 
                onClick={() => setShowGmailModal(false)} 
                className="p-4 bg-white rounded-2xl hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all shadow-sm"
              >
                <X size={24}/>
              </button>
            </div>

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 min-h-0">
              {/* COLUMNA IZQUIERDA: HISTORIAL DE CORREOS */}
              <div className="border-r border-slate-100 p-8 flex flex-col min-h-0 bg-slate-50/30">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Bandeja de Entrada / Enviados (Gmail)</h3>
                
                {gmailLoading && emailsList.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-2"></div>
                    <span className="text-xs font-bold uppercase">Cargando correos...</span>
                  </div>
                ) : emailsList.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-300 text-center p-8">
                    <Mail size={48} className="opacity-20 mb-3" />
                    <p className="text-xs font-bold uppercase">No se encontraron correos con este contacto</p>
                    <p className="text-[10px] text-slate-400 mt-1">Los correos con destinatario o remitente {selectedContactData.email} aparecerán aquí.</p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                    {emailsList.map((email: any) => (
                      <div 
                        key={email.id} 
                        className="bg-white border border-slate-100 p-5 rounded-2xl shadow-sm hover:border-blue-200 transition-all"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-[9px] font-black uppercase text-blue-600 tracking-wider">
                            {email.from.includes(selectedContactData.email) ? 'Recibido' : 'Enviado'}
                          </span>
                          <span className="text-[9px] font-bold text-slate-400">
                            {new Date(email.date).toLocaleDateString('es-CO')}
                          </span>
                        </div>
                        <h4 className="text-xs font-black text-slate-800 truncate">{email.subject}</h4>
                        <p className="text-[10px] text-slate-400 font-bold mt-1">De: {email.from} • Para: {email.to}</p>
                        <p className="text-xs text-slate-600 mt-3 bg-slate-50 p-3.5 rounded-xl border border-slate-100 leading-relaxed whitespace-pre-wrap max-h-36 overflow-y-auto">
                          {email.body}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* COLUMNA DERECHA: REDACTAR & IA */}
              <div className="p-8 flex flex-col min-h-0 overflow-y-auto custom-scrollbar space-y-6">
                <div className="flex flex-col gap-3">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Redactar Correo</h3>
                  
                  {googleAccountEmail === activeUser?.email ? (
                    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 text-[10px] text-emerald-800 font-bold flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span>Cuenta corporativa conectada</span>
                    </div>
                  ) : (
                    <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3 text-[10px] text-red-700 font-bold leading-normal">
                      La cuenta de Google conectada no coincide con tu correo corporativo. Conecta [{activeUser?.email}].
                    </div>
                  )}
                </div>
                
                {/* IA Assistant box */}
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-3xl p-5 space-y-4 shadow-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></div>
                    <span className="text-[10px] font-black text-blue-700 uppercase tracking-widest">Redactor de Correos IA (Gemini)</span>
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="Ej: Agradecer reunión, ofrecer catálogo de HPLC..." 
                      className="flex-1 bg-white border border-blue-200/50 rounded-xl px-4 py-2.5 text-xs font-bold outline-none text-slate-700 placeholder:text-slate-300"
                      value={aiPromptTopic}
                      disabled={!isEmailAllowed || aiGenerating}
                      onChange={(e) => setAiPromptTopic(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={handleGenerateAIResponse}
                      disabled={!isEmailAllowed || aiGenerating || !aiPromptTopic.trim()}
                      className="px-5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-xl font-black text-[10px] uppercase tracking-wider transition-all"
                    >
                      {aiGenerating ? 'Generando...' : 'Generar'}
                    </button>
                  </div>
                </div>

                {/* Email Fields */}
                <div className="space-y-4 flex-1 flex flex-col min-h-0">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">De</label>
                      <input 
                        type="text" 
                        readOnly 
                        disabled
                        className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none text-slate-500 cursor-not-allowed" 
                        value={activeUser?.email || ""}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Para</label>
                      <input 
                        type="text" 
                        readOnly 
                        disabled
                        className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none text-slate-500 cursor-not-allowed" 
                        value={selectedContactData?.email || ""}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Asunto</label>
                    <input 
                      type="text" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:border-blue-400 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed" 
                      value={emailSubject}
                      disabled={!isEmailAllowed || gmailLoading}
                      onChange={(e) => setEmailSubject(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1 flex-1 flex flex-col min-h-0">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Cuerpo del Mensaje</label>
                    <textarea 
                      placeholder={!isEmailAllowed ? "Conexión bloqueada. Por favor vincula tu cuenta de Google en tu Perfil." : "Redacta el contenido aquí..."}
                      className="w-full flex-1 bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs font-medium outline-none focus:border-blue-400 text-slate-700 resize-none min-h-[160px] custom-scrollbar disabled:opacity-50 disabled:cursor-not-allowed" 
                      value={emailBody}
                      disabled={!isEmailAllowed || gmailLoading}
                      onChange={(e) => setEmailBody(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 shrink-0">
                  <button 
                    type="button"
                    onClick={() => setShowGmailModal(false)} 
                    className="px-6 py-3 font-black text-slate-400 uppercase text-[10px]"
                  >
                    Cerrar
                  </button>
                  <button 
                    type="button"
                    onClick={handleSendEmail}
                    disabled={!isEmailAllowed || gmailLoading || !emailSubject.trim() || !emailBody.trim()}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-8 py-3 rounded-xl font-black text-[10px] uppercase tracking-wider flex items-center gap-2"
                  >
                    {gmailLoading ? 'Enviando...' : 'Enviar Correo'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL GOOGLE CALENDAR */}
      {showCalendarModal && selectedContactData && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-xl">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-2xl overflow-hidden border border-white">
            <div className="px-10 py-8 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter flex items-center gap-3">
                  <Calendar className="text-blue-600" size={28} /> Google Calendar
                </h2>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.24em] mt-2">
                  Agendar Evento & Crear Google Meet
                </p>
              </div>
              <button 
                onClick={() => setShowCalendarModal(false)} 
                className="p-4 bg-white rounded-2xl hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all shadow-sm"
              >
                <X size={24}/>
              </button>
            </div>
            
            <div className="p-10 space-y-6">
              {/* Contact pre-fill badge */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex flex-wrap gap-4 justify-between items-center text-xs">
                <div>
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Invitado:</span>
                  <p className="font-black text-slate-800 uppercase">{selectedContactData.fullName}</p>
                </div>
                <div>
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Correo:</span>
                  <p className="font-bold text-slate-600">{selectedContactData.email || 'Sin correo'}</p>
                </div>
                <div>
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Empresa:</span>
                  <p className="font-black text-slate-800 uppercase">
                    {selectedAccount?.nombreComercial || selectedAccount?.razonSocial || 'Sin empresa'}
                  </p>
                </div>
              </div>

              {/* Form fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Título del Evento</label>
                  <input 
                    type="text" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:border-blue-400 text-slate-700" 
                    value={calTitle}
                    onChange={(e) => setCalTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Fecha y Hora de Inicio</label>
                  <input 
                    type="datetime-local" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:border-blue-400 text-slate-700" 
                    value={calDate}
                    onChange={(e) => setCalDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Duración (Minutos)</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:border-blue-400 text-slate-700"
                    value={calDuration}
                    onChange={(e) => setCalDuration(Number(e.target.value))}
                  >
                    <option value={15}>15 minutos</option>
                    <option value={30}>30 minutos</option>
                    <option value={45}>45 minutos</option>
                    <option value={60}>1 hora (60 min)</option>
                    <option value={90}>1.5 horas (90 min)</option>
                    <option value={120}>2 horas (120 min)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Ubicación física</label>
                  <input 
                    type="text" 
                    placeholder="Dejar vacío si es videollamada"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:border-blue-400 text-slate-700" 
                    value={calLocation}
                    onChange={(e) => setCalLocation(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Descripción del Evento</label>
                <textarea 
                  placeholder="Detalles sobre los puntos a tratar..." 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs font-medium outline-none focus:border-blue-400 text-slate-700 h-24 resize-none" 
                  value={calDescription}
                  onChange={(e) => setCalDescription(e.target.value)}
                />
              </div>

              {/* Meet option toggle */}
              <div className="flex items-center justify-between bg-blue-50 border border-blue-100 p-4 rounded-2xl shadow-sm">
                <div className="flex items-center gap-3">
                  <Video className="text-blue-600" size={22} />
                  <div>
                    <h4 className="text-xs font-black text-blue-700 uppercase">Generar Google Meet</h4>
                    <p className="text-[10px] text-blue-500 font-semibold mt-0.5">Se creará una reunión virtual única y se adjuntará el enlace.</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="sr-only peer" 
                    checked={calCreateMeet}
                    onChange={(e) => setCalCreateMeet(e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-6 border-t border-slate-100 shrink-0">
                <button 
                  type="button"
                  onClick={() => setShowCalendarModal(false)} 
                  className="px-6 py-3 font-black text-slate-400 uppercase text-[10px]"
                >
                  Cerrar
                </button>
                <button 
                  type="button"
                  onClick={handleCreateCalendarEvent}
                  disabled={calLoading || !calTitle.trim() || !calDate}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-8 py-3 rounded-xl font-black text-[10px] uppercase tracking-wider flex items-center gap-2"
                >
                  {calLoading ? 'Creando...' : 'Agendar Reunión'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showWaModal && waContact && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-xl">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-xl overflow-hidden border border-white">
            
            {/* CABECERA */}
            <div className="px-10 py-8 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter flex items-center gap-3">
                  <MessageCircle className="text-emerald-600" size={28} /> WhatsApp Comercial
                </h2>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.24em] mt-2">
                  Gestión y Envío de Mensajes
                </p>
              </div>
              <button 
                onClick={() => setShowWaModal(false)} 
                className="p-4 bg-white rounded-2xl hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all shadow-sm"
              >
                <X size={24}/>
              </button>
            </div>

            {/* CUERPO DEL MODAL */}
            <div className="p-10 space-y-6">
              
              {/* Información de contacto */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex flex-wrap gap-4 justify-between items-center text-xs">
                <div>
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Destinatario:</span>
                  <p className="font-black text-slate-800 uppercase">{waContact.fullName}</p>
                </div>
                <div>
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Número de WhatsApp:</span>
                  <p className="font-bold text-slate-600">{waPhone}</p>
                </div>
                <div>
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Empresa:</span>
                  <p className="font-black text-slate-800 uppercase">
                    {selectedAccount?.nombreComercial || selectedAccount?.razonSocial || 'Sin empresa'}
                  </p>
                </div>
              </div>

              {waStep === 'draft' ? (
                <>
                  {/* REDACTAR / MENSAJE */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Redactar Mensaje</label>
                    <textarea 
                      placeholder="Escribe el mensaje de WhatsApp aquí..." 
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs font-semibold outline-none focus:border-slate-300 text-slate-700 h-32 resize-none" 
                      value={waMessage}
                      onChange={(e) => setWaMessage(e.target.value)}
                    />
                  </div>

                  {/* ASISTENTE IA GEMINI */}
                  <div className="bg-blue-50/50 border border-blue-100 p-6 rounded-3xl space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-blue-700 uppercase tracking-widest">Asistente de Redacción IA (Gemini)</span>
                    </div>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder="Ej: Saludar, ofrecer demo de equipos Ioncore y pedir disponibilidad..."
                        className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2 text-xs font-medium outline-none focus:border-blue-400 text-slate-700" 
                        value={waPrompt}
                        onChange={(e) => setWaPrompt(e.target.value)}
                      />
                      <button 
                        type="button"
                        onClick={handleGenerateAIWhatsApp}
                        disabled={waGenerating}
                        className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider shrink-0 transition-colors"
                      >
                        {waGenerating ? 'Generando...' : 'Generar'}
                      </button>
                    </div>
                  </div>

                  {/* ACCIONES FOOTER */}
                  <div className="flex justify-end gap-3 pt-6 border-t border-slate-100 shrink-0">
                    <button 
                      type="button"
                      onClick={() => setShowWaModal(false)} 
                      className="px-6 py-3 font-black text-slate-400 uppercase text-[10px]"
                    >
                      Cerrar
                    </button>
                    <button 
                      type="button"
                      onClick={handleOpenWhatsApp}
                      disabled={!waMessage.trim()}
                      className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-8 py-3 rounded-xl font-black text-[10px] uppercase tracking-wider flex items-center gap-2 transition-colors shadow-lg shadow-emerald-600/10"
                    >
                      Abrir en WhatsApp
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* CONFIRMACIÓN DE REGISTRO EN EL HISTORIAL */}
                  <div className="space-y-4 py-4">
                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-2xl text-xs font-semibold leading-relaxed">
                      Se ha abierto WhatsApp en una pestaña externa para proceder con el envío de tu mensaje. 
                      Dado que WhatsApp es una aplicación externa, el envío final debe ser confirmado en esa ventana.
                    </div>
                    
                    <p className="text-xs font-bold text-slate-700">
                      ¿Deseas registrar esta interacción en el historial comercial de este contacto?
                    </p>

                    <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl text-xs text-slate-500 max-h-24 overflow-y-auto italic font-medium whitespace-pre-wrap">
                      {waMessage}
                    </div>
                  </div>

                  {/* ACCIONES FOOTER */}
                  <div className="flex justify-end gap-3 pt-6 border-t border-slate-100 shrink-0">
                    <button 
                      type="button"
                      onClick={() => setShowWaModal(false)} 
                      className="px-6 py-3 font-black text-slate-400 hover:text-slate-600 uppercase text-[10px]"
                    >
                      No registrar
                    </button>
                    <button 
                      type="button"
                      onClick={handleRegisterWaActivity}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-black text-[10px] uppercase tracking-wider transition-colors shadow-lg shadow-blue-600/10"
                    >
                      Sí, registrar en historial
                    </button>
                  </div>
                </>
              )}

            </div>
          </div>
        </div>
      )}

      {/* MODAL COMPLETAR SEGUIMIENTO CON GESTIÓN */}
      {followUpToComplete && (
        <CompleteFollowUpModal
          isOpen={!!followUpToComplete}
          activity={followUpToComplete}
          onClose={() => setFollowUpToComplete(null)}
          onConfirm={(activityId, resultNote, options) => {
            completeFollowUpActivity(activityId, resultNote, activeUser || undefined);
            setFollowUpToComplete(null);
            setRefresh((r) => r + 1);
            if (options?.createQuote) {
              window.dispatchEvent(new CustomEvent("axis:navigate", { detail: { page: "quotes" } }));
            }
          }}
        />
      )}
    </div>
  );
}