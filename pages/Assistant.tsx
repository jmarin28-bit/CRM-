// pages/Assistant.tsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { AccountV2, ContactV2, ActivityV2, ChatMessage, OpportunityV2 } from '../types';
import { parseBulkData, getSmartResponse, parseModelJson } from '../services/gemini';
import { createActivity, createOpportunity } from '../services/storage';
import { todayLocal } from '../services/dates';
import Markdown from 'react-markdown';
import { 
  Send, 
  Sparkles, 
  AlertCircle, 
  Check, 
  Loader2, 
  Database, 
  UploadCloud, 
  Paperclip, 
  X, 
  FileText, 
  Phone, 
  CalendarDays, 
  MessageSquareText, 
  ShieldAlert, 
  Building2, 
  UserRound, 
  Clock3, 
  ChevronRight, 
  CalendarClock, 
  Mail, 
  Wand2,
  Copy
} from 'lucide-react';

interface AssistantProps {
  accounts: AccountV2[];
  contacts: ContactV2[];
  activities: ActivityV2[];
  opportunities: OpportunityV2[];
  onBulkImport: (data: { accounts: AccountV2[]; contacts: ContactV2[] }) => void;
  onCreateAccount: (data: Partial<AccountV2>) => void;
}

type AssistantMode =
  | 'copiado'
  | 'llamada'
  | 'prep_reunion'
  | 'seguimiento'
  | 'import';

const ASSISTANT_DRAFT_KEY = 'ioncore_assistant_draft_v1';

const MODE_CONFIG: Record<
  AssistantMode,
  {
    title: string;
    subtitle: string;
    icon: React.ComponentType<any>;
    intro: string;
    placeholder: string;
  }
> = {
  copiado: {
    title: 'Copiado Inteligente',
    subtitle: 'WhatsApp, correo y texto libre',
    icon: Sparkles,
    intro:
      'Pega una conversación de WhatsApp, correo o texto libre. La IA extraerá contexto comercial, señales de interés y la próxima acción sugerida.',
    placeholder:
      'Pega aquí una conversación, correo o nota comercial para analizar...',
  },
  llamada: {
    title: 'Log de Llamada',
    subtitle: 'Resumen, acuerdos y seguimiento',
    icon: Phone,
    intro:
      'Pega o dicta el resumen de una llamada. La IA organizará lo hablado, acuerdos, objeciones, urgencia y seguimiento sugerido.',
    placeholder:
      'Escribe o pega el resumen de la llamada. Ej: “Hablé con Jorge de Nucleolab...”',
  },
  prep_reunion: {
    title: 'Prep Reunión',
    subtitle: 'Última interacción y contexto previo',
    icon: CalendarDays,
    intro:
      'Pregunta por una empresa o contacto y la IA preparará el contexto previo: última interacción, notas recientes y enfoque recomendado para entrar a la reunión.',
    placeholder:
      'Ejemplo: “Prepárame reunión con Nucleolab y Jorge” o “¿Cuál fue la última interacción con Amspec?”',
  },
  seguimiento: {
    title: 'Redactar Seguimiento',
    subtitle: 'Correo, WhatsApp o siguiente paso',
    icon: MessageSquareText,
    intro:
      'Genera un seguimiento comercial listo para enviar o guardar como actividad: correo, WhatsApp, resumen post reunión o guion de llamada.',
    placeholder:
      'Ejemplo: “Redáctame un correo de seguimiento para Jorge de Nucleolab después de la videollamada”',
  },
  import: {
    title: 'Carga Masiva',
    subtitle: 'Importar CSV o texto desordenado',
    icon: UploadCloud,
    intro:
      'Pega texto, listas o registros sin estructura y la IA los convertirá en cuentas y contactos listos para importar.',
    placeholder: '',
  },
};

const normalize = (value?: string) =>
  (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Sin fecha';
  const d = new Date(value);
  if (isNaN(d.getTime())) return 'Sin fecha';
  return d.toLocaleString('es-CO');
};

const formatDate = (value?: string | null) => {
  if (!value) return 'Sin fecha';
  const d = new Date(value);
  if (isNaN(d.getTime())) return 'Sin fecha';
  return d.toLocaleDateString('es-CO');
};

const sortActivitiesDesc = (list: ActivityV2[]) =>
  [...list].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

const extractSuggestedAction = (text: string) => {
  const match =
    text.match(/pr[oó]xima acci[oó]n[:\s]*([\s\S]*?)(?:\n\n|$)/i) ||
    text.match(/🚀\s*pr[oó]xima acci[oó]n[:\s]*([\s\S]*?)(?:\n\n|$)/i);

  return match?.[1]?.trim() || '';
};

const extractUrgency = (text: string) => {
  const match = text.match(/urgencia[:\s]*([^\n]+)/i);
  return match?.[1]?.trim() || 'Media';
};

const extractInterest = (text: string) => {
  const match = text.match(/nivel de inter[eé]s[:\s]*([^\n]+)/i);
  return match?.[1]?.trim() || 'Medio';
};

const shouldSuggestOpportunity = (text: string) => {
  const normalized = text.toLowerCase();

  const positiveSignals = [
    'cotización',
    'cotizacion',
    'propuesta',
    'negociación',
    'negociacion',
    'compra',
    'cierre',
    'oportunidad',
    'interés',
    'interes',
    'score',
    'nivel de interés',
    'nivel de interes',
  ];

  return positiveSignals.some((term) => normalized.includes(term));
};

const Assistant: React.FC<AssistantProps> = ({
  accounts,
  contacts,
  activities,
  opportunities,
  onBulkImport,
  onCreateAccount,
}) => {
  const [mode, setMode] = useState<AssistantMode>('copiado');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'model',
      content: MODE_CONFIG.copiado.intro,
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [importText, setImportText] = useState('');
  const [parsedPreview, setParsedPreview] = useState<{
    accounts: AccountV2[];
    contacts: ContactV2[];
  } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [generatedWhatsApp, setGeneratedWhatsApp] = useState('');
  const [suggestedFollowUp, setSuggestedFollowUp] = useState('');
  const [internalTaskCreated, setInternalTaskCreated] = useState('');

  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedContactId, setSelectedContactId] = useState('');

  const [actionState, setActionState] = useState<Record<string, {
    activity?: boolean;
    followUp?: boolean;
    internalTask?: boolean;
    whatsapp?: boolean;
    opportunity?: boolean;
  }>>({});

  const [actionLog, setActionLog] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const saveAssistantState = () => {
    try {
      localStorage.setItem(
        ASSISTANT_DRAFT_KEY,
        JSON.stringify({
          mode,
          messages,
          input,
          importText,
          generatedWhatsApp,
          suggestedFollowUp,
          internalTaskCreated,
          selectedAccountId,
          selectedContactId,
          actionState,
        })
      );
    } catch {}
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ASSISTANT_DRAFT_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw);

      if (saved.mode) setMode(saved.mode);
      if (saved.messages?.length) setMessages(saved.messages);
      if (typeof saved.input === 'string') setInput(saved.input);
      if (typeof saved.importText === 'string') setImportText(saved.importText);
      if (typeof saved.generatedWhatsApp === 'string') setGeneratedWhatsApp(saved.generatedWhatsApp);
      if (typeof saved.suggestedFollowUp === 'string') setSuggestedFollowUp(saved.suggestedFollowUp);
      if (typeof saved.internalTaskCreated === 'string') setInternalTaskCreated(saved.internalTaskCreated);
      if (typeof saved.selectedAccountId === 'string') setSelectedAccountId(saved.selectedAccountId);
      if (typeof saved.selectedContactId === 'string') setSelectedContactId(saved.selectedContactId);
      if (saved.actionState) setActionState(saved.actionState);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        ASSISTANT_DRAFT_KEY,
        JSON.stringify({
          mode,
          messages,
          input,
          importText,
          generatedWhatsApp,
          suggestedFollowUp,
          internalTaskCreated,
          selectedAccountId,
          selectedContactId,
          actionState,
        })
      );
    } catch {}
  }, [
    mode,
    messages,
    input,
    importText,
    generatedWhatsApp,
    suggestedFollowUp,
    internalTaskCreated,
    selectedAccountId,
    selectedContactId,
    actionState,
  ]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (mode !== 'import' && messages.length <= 1) {
      setMessages([
        {
          id: `welcome_${mode}`,
          role: 'model',
          content: MODE_CONFIG[mode].intro,
          timestamp: Date.now(),
        },
      ]);
      saveAssistantState();
    }
  }, [mode, messages.length]);

  const contextText = useMemo(() => {
    const latestUserText = [...messages]
      .reverse()
      .find((m) => m.role === 'user')?.content;

    return normalize(input || latestUserText || '');
  }, [input, messages]);

  const detectedContact = useMemo(() => {
    if (!contextText) return null;
    return (
      contacts.find((c) => {
        const full = normalize(c.fullName);
        return full && contextText.includes(full);
      }) || null
    );
  }, [contacts, contextText]);

  const detectedAccount = useMemo(() => {
    if (detectedContact) {
      return accounts.find((a) => a.id === detectedContact.accountId) || null;
    }

    if (!contextText) return null;

    return (
      accounts.find((a) => {
        const rz = normalize(a.razonSocial);
        const nc = normalize(a.nombreComercial);
        return (rz && contextText.includes(rz)) || (nc && contextText.includes(nc));
      }) || null
    );
  }, [accounts, detectedContact, contextText]);

  const effectiveAccount = useMemo(() => {
    if (selectedAccountId) {
      return accounts.find((a) => a.id === selectedAccountId) || null;
    }
    return detectedAccount;
  }, [accounts, selectedAccountId, detectedAccount]);

  const availableContactsForSelectedAccount = useMemo(() => {
    if (!effectiveAccount) return contacts;
    return contacts.filter((c) => c.accountId === effectiveAccount.id);
  }, [contacts, effectiveAccount]);

  const effectiveContact = useMemo(() => {
    if (selectedContactId) {
      return contacts.find((c) => c.id === selectedContactId) || null;
    }
    return detectedContact;
  }, [contacts, selectedContactId, detectedContact]);

  useEffect(() => {
    if (detectedAccount && !selectedAccountId) {
      setSelectedAccountId(detectedAccount.id);
    }
  }, [detectedAccount, selectedAccountId]);

  useEffect(() => {
    if (detectedContact && !selectedContactId) {
      setSelectedContactId(detectedContact.id);
    }
  }, [detectedContact, selectedContactId]);

  useEffect(() => {
    if (
      selectedContactId &&
      effectiveContact &&
      effectiveAccount &&
      effectiveContact.accountId !== effectiveAccount.id
    ) {
      setSelectedContactId('');
    }
  }, [selectedContactId, effectiveContact, effectiveAccount]);

  const latestAccountActivity = useMemo(() => {
    if (!effectiveAccount) return null;
    return (
      sortActivitiesDesc(
        activities.filter((a) => a.accountId === effectiveAccount.id)
      )[0] || null
    );
  }, [activities, effectiveAccount]);

  const latestContactActivity = useMemo(() => {
    if (!effectiveContact) return null;
    return (
      sortActivitiesDesc(
        activities.filter((a) => a.contactId === effectiveContact.id)
      )[0] || null
    );
  }, [activities, effectiveContact]);

  const relatedContacts = useMemo(() => {
    if (!effectiveAccount) return [];
    return contacts
      .filter((c) => c.accountId === effectiveAccount.id)
      .map((c) => {
        const last = sortActivitiesDesc(
          activities.filter((a) => a.contactId === c.id)
        )[0];
        return { contact: c, lastActivity: last || null };
      });
  }, [contacts, activities, effectiveAccount]);

  const suggestedActions = useMemo(() => {
    switch (mode) {
      case 'copiado':
        return [
          'Extraer empresa y contacto',
          'Detectar necesidad y urgencia',
          'Sugerir próxima acción',
          'Crear cuenta desde IA',
        ];
      case 'llamada':
        return [
          'Resumir la llamada',
          'Listar acuerdos y objeciones',
          'Sugerir seguimiento',
          'Guardar gestión en CRM',
        ];
      case 'prep_reunion':
        return [
          'Última interacción con empresa',
          'Última interacción con contacto',
          'Ver otros contactos de la cuenta',
          'Enfoque sugerido para la reunión',
        ];
      case 'seguimiento':
        return [
          'Redactar correo',
          'Redactar WhatsApp',
          'Proponer próxima gestión',
          'Dejar mensaje listo para enviar',
        ];
      case 'import':
        return [
          'Detectar cuentas',
          'Detectar contactos',
          'Validar vista previa',
          'Importar al CRM',
        ];
      default:
        return [];
    }
  }, [mode]);

  const quickPrompts = useMemo(() => {
    switch (mode) {
      case 'copiado':
        return [
          'Analiza esta conversación y dime necesidad, urgencia y siguiente paso',
          'Extrae empresa, contacto y señales de compra',
        ];
      case 'llamada':
        return [
          'Resume la llamada y propón seguimiento',
          'Convierte esta llamada en una gestión comercial estructurada',
        ];
      case 'prep_reunion':
        return [
          '¿Cuál fue la última interacción con esta empresa?',
          'Prepárame reunión con esta cuenta y sus contactos',
        ];
      case 'seguimiento':
        return [
          'Redáctame un correo de seguimiento formal',
          'Hazme un WhatsApp breve para retomar conversación',
        ];
      default:
        return [];
    }
  }, [mode]);

  const canSuggestOpportunity = useMemo(() => {
    if (mode !== 'copiado' && mode !== 'seguimiento') return false;

    const latestModel =
      [...messages].reverse().find((m) => m.role === 'model')?.content || '';

    return shouldSuggestOpportunity(latestModel);
  }, [messages, mode]);

  const buildModePrompt = (rawText: string) => {
    switch (mode) {
      case 'copiado':
        return `MODO: COPIADO INTELIGENTE\nAnaliza el siguiente contenido comercial y responde en formato operativo CRM. Extrae empresa, contacto, necesidad, objeciones, urgencia, nivel de interés, próxima acción y fecha sugerida de seguimiento.\n\nCONTENIDO:\n${rawText}`;
      case 'llamada':
        return `MODO: LOG DE LLAMADA\nConvierte este resumen de llamada en una salida ejecutiva para CRM. Devuelve: resumen, acuerdos, objeciones, riesgos, siguiente paso y seguimiento sugerido.\n\nCONTENIDO:\n${rawText}`;
      case 'prep_reunion':
        return `MODO: PREP REUNIÓN\nUsa el contexto del CRM para responder: última interacción con la empresa, última interacción con el contacto, interacciones recientes con otros contactos relacionados, pendientes y recomendación para entrar a la reunión.\n\nCONSULTA:\n${rawText}`;
      case 'seguimiento':
        return `MODO: REDACTAR SEGUIMIENTO\nGenera una propuesta de seguimiento comercial útil para CRM: correo, WhatsApp o siguiente paso según el contexto. Debe ser profesional, corto y accionable.\n\nCONSULTA:\n${rawText}`;
      default:
        return rawText;
    }
  };

  const handleSelectMode = (newMode: AssistantMode) => {
    setMode(newMode);
    setInput('');
    setSelectedFile(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const allowedTypes = [
        'application/pdf', 
        'image/jpeg', 
        'image/png', 
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'text/plain'
      ];
      if (allowedTypes.includes(file.type) || file.name.endsWith('.docx') || file.name.endsWith('.doc') || file.name.endsWith('.txt')) {
        setSelectedFile(file);
      } else {
        alert('Por ahora solo aceptamos PDF, JPG, PNG, DOCX y TXT.');
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const allowedTypes = [
        'application/pdf', 
        'image/jpeg', 
        'image/png', 
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'text/plain'
      ];
      if (allowedTypes.includes(file.type) || file.name.endsWith('.docx') || file.name.endsWith('.doc') || file.name.endsWith('.txt')) {
        setSelectedFile(file);
      } else {
        alert('Por ahora solo aceptamos PDF, JPG, PNG, DOCX y TXT.');
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const pastedFile = new File([file], `captura_${Date.now()}.png`, {
            type: file.type,
          });
          setSelectedFile(pastedFile);
          return;
        }
      }
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        } else {
          reject(new Error('Failed to convert file to base64'));
        }
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleUsePrompt = (text: string) => {
    setInput(text);
  };

  const handleSendMessage = async () => {
    if ((!input.trim() && !selectedFile) || isLoading) return;

    const finalContent = buildModePrompt(input.trim());

    const userMsg: ChatMessage = {
      id: Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9),
      role: 'user',
      content: selectedFile ? `[Archivo Adjunto: ${selectedFile.name}] ${finalContent}` : finalContent,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    saveAssistantState(); 
    setInput('');
    const currentFile = selectedFile;
    setSelectedFile(null);
    setIsLoading(true);

    try {
      let fileData = undefined;

      if (currentFile) {
        const base64 = await fileToBase64(currentFile);
        fileData = {
          mimeType: currentFile.type,
          data: base64,
        };
      }

      const responseText = await getSmartResponse(
        userMsg.content,
        { accounts, contacts, activities },
        fileData
      );

      let isRutJson = false;

      {
        // Antes esto era JSON.parse(responseText) directo. Gemini casi siempre
        // devuelve el JSON envuelto en ```json, así que el parse lanzaba, el
        // catch se lo tragaba en silencio y el RUT nunca se procesaba: el
        // usuario veía el JSON crudo en el chat sin ninguna explicación.
        const data = parseModelJson<any>(responseText);
        if (data && data.razon_social && data.nit) {
          isRutJson = true;

          const accountData: Partial<AccountV2> = {
            razonSocial: data.razon_social,
            nit: data.nit,
            direccion: data.ubicacion || data.direccion || '',
            ciudad: data.ciudad || '',
            nombreComercial: data.nombre_comercial || '',
            sector: data.sector || '',
          };

          onCreateAccount(accountData);

          const botMsg: ChatMessage = {
            id: Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9),
            role: 'model',
            content:
              '✅ Datos del RUT procesados. Redirigiendo a Cuentas para crear el registro...',
            timestamp: Date.now(),
          };

          setMessages((prev) => [...prev, botMsg]);
          saveAssistantState();
        }
      }

      if (!isRutJson) {
        const botMsg: ChatMessage = {
          id: Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9),
          role: 'model',
          content: responseText,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, botMsg]);
        saveAssistantState();
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9),
          role: 'model',
          content: 'Lo siento, hubo un error procesando tu solicitud.',
          timestamp: Date.now(),
        },
      ]);
      saveAssistantState();
    } finally {
      setIsLoading(false);
    }
  };

  const markActionDone = (
    messageId: string,
    action: 'activity' | 'followUp' | 'internalTask' | 'whatsapp' | 'opportunity'
  ) => {
    setActionState((prev) => ({
      ...prev,
      [messageId]: {
        ...prev[messageId],
        [action]: true,
      },
    }));
  };

  const addActionLog = (text: string) => {
    setActionLog((prev) => [text, ...prev].slice(0, 8));
  };

  const cleanOpportunityTitle = (text: string) => {
    return text
      .replace(/\*\*/g, '')
      .replace(/🚀|📈|🧠|📌|✅|❌/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  };

  const resetAssistantWorkspace = () => {
    setMode('copiado');
    setMessages([
      {
        id: 'welcome',
        role: 'model',
        content: MODE_CONFIG.copiado.intro,
        timestamp: Date.now(),
      },
    ]);
    setInput('');
    setImportText('');
    setParsedPreview(null);
    setSelectedFile(null);
    setGeneratedWhatsApp('');
    setSuggestedFollowUp('');
    setInternalTaskCreated('');
    setSelectedAccountId('');
    setSelectedContactId('');
    setActionState({});
    setActionLog([]);
    localStorage.removeItem(ASSISTANT_DRAFT_KEY);
  };

  // ✅ ACCIONES CON VALIDACIÓN DE ÉXITO
  const handleSaveAsActivity = (modelText: string, messageId: string) => {
    const suggestedAction = extractSuggestedAction(modelText);

    if (!effectiveAccount) {
      alert('No se detectó una empresa para guardar la actividad.');
      return;
    }

    const created = createActivity({
      accountId: effectiveAccount.id,
      contactId: effectiveContact?.id,
      type: 'Análisis IA',
      description: suggestedAction
        ? `Resumen IA:\n\n${modelText}\n\nPróxima acción sugerida: ${suggestedAction}`
        : `Resumen IA:\n\n${modelText}`,
    });

    if (created?.id) {
      markActionDone(messageId, 'activity');
      addActionLog(`Actividad creada para ${effectiveContact?.fullName || effectiveAccount?.razonSocial || 'registro seleccionado'}.`);
      alert('Actividad guardada en el CRM.');
      saveAssistantState();
    } else {
      alert('No se pudo guardar la actividad.');
    }
  };

  const handleCreateFollowUp = (modelText: string, messageId: string) => {
    const suggestedAction = extractSuggestedAction(modelText);

    if (!effectiveAccount) {
      alert('No se detectó una empresa para crear seguimiento.');
      return;
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0);

    const created = createActivity({
      accountId: effectiveAccount.id,
      contactId: effectiveContact?.id,
      type: 'Seguimiento IA',
      description: suggestedAction || 'Seguimiento sugerido por IA',
      followUpAt: tomorrow.toISOString(),
    });

    if (created?.id && created?.followUpAt) {
      setSuggestedFollowUp(tomorrow.toLocaleString('es-CO'));
      markActionDone(messageId, 'followUp');
      addActionLog(`Seguimiento creado para ${effectiveContact?.fullName || effectiveAccount?.razonSocial || 'registro seleccionado'} el ${tomorrow.toLocaleString('es-CO')}.`);
      alert('Seguimiento creado para mañana a las 8:00 a. m.');
      saveAssistantState();
    } else {
      alert('No se pudo crear el seguimiento.');
    }
  };

  const handleCreateInternalTask = (modelText: string, messageId: string) => {
    const suggestedAction = extractSuggestedAction(modelText);

    if (!effectiveAccount) {
      alert('No se detectó una empresa para crear tarea interna.');
      return;
    }

    const created = createActivity({
      accountId: effectiveAccount.id,
      contactId: effectiveContact?.id,
      type: 'Tarea Interna IA',
      description:
        suggestedAction ||
        'Coordinar internamente la siguiente acción recomendada por la IA.',
    });

    if (created?.id) {
      setInternalTaskCreated(
        suggestedAction || 'Tarea interna creada correctamente.'
      );
      markActionDone(messageId, 'internalTask');
      addActionLog(`Tarea interna creada para ${effectiveContact?.fullName || effectiveAccount?.razonSocial || 'registro seleccionado'}.`);
      alert('Tarea interna creada en el CRM.');
      saveAssistantState();
    } else {
      alert('No se pudo crear la tarea interna.');
    }
  };

  const handleCreateOpportunityFromIA = (modelText: string, messageId: string) => {
    if (actionState[messageId]?.opportunity) {
      return;
    }

    const interest = extractInterest(modelText);
    const urgency = extractUrgency(modelText);
    const suggestedAction = extractSuggestedAction(modelText);

    if (!effectiveAccount || !effectiveContact) {
      alert('Se necesita seleccionar empresa y contacto para crear oportunidad.');
      return;
    }

    const rawTitle =
      suggestedAction ||
      `Oportunidad detectada por IA - ${
        effectiveAccount.nombreComercial || effectiveAccount.razonSocial
      }`;

    const cleanTitle = cleanOpportunityTitle(rawTitle);

    createOpportunity({
      accountId: effectiveAccount.id,
      contactId: effectiveContact.id,
      ownerId: effectiveAccount.ownerId,
      titulo: cleanTitle,
      etapa: 'Prospecto',
      valor: 0,
      moneda: 'COP',
      probabilidad:
        /alto/i.test(interest) || /alta/i.test(urgency) ? 60 : 30,
      fechaEstimadaCierre: todayLocal(),
    });

    markActionDone(messageId, 'opportunity');
    addActionLog(`Oportunidad "${cleanTitle}" creada para ${effectiveContact?.fullName || effectiveAccount?.razonSocial}.`);
    alert('Oportunidad creada en el pipeline.');
    saveAssistantState();
  };

  const handleGenerateWhatsApp = (modelText: string, messageId: string) => {
    const suggestedAction = extractSuggestedAction(modelText);

    const accountName =
      effectiveAccount?.nombreComercial || effectiveAccount?.razonSocial || 'su proceso';
    const contactName = effectiveContact?.fullName || 'Cliente';

    const message = `Hola ${contactName}, buen día. Te escribo para hacer seguimiento a lo conversado con ${accountName}. ${suggestedAction || 'Quedo atento a tus comentarios y al siguiente paso para avanzar.'}`;

    if (message.trim()) {
      setGeneratedWhatsApp(message);
      markActionDone(messageId, 'whatsapp');
      addActionLog(`WhatsApp sugerido generado para ${effectiveContact?.fullName || effectiveAccount?.razonSocial || 'registro seleccionado'}.`);
      saveAssistantState();
    } else {
      alert('No se pudo generar el mensaje de WhatsApp.');
    }
  };

  const handleAnalyzeImport = async () => {
    if (!importText.trim()) return;
    setIsLoading(true);
    try {
      const result = await parseBulkData(importText);
      setParsedPreview(result);
    } catch {
      alert('Error analizando los datos. Intenta de nuevo.');
    } finally {
      setIsLoading(false);
    }
  };

  const confirmImport = () => {
    if (parsedPreview) {
      onBulkImport(parsedPreview);
      setImportText('');
      setParsedPreview(null);
      alert('Datos importados correctamente al CRM.');
      setMode('copiado');
    }
  };

  const rightPanelTitle = useMemo(() => {
    if (mode === 'prep_reunion') return 'Contexto previo a reunión';
    if (mode === 'seguimiento') return 'Acciones de seguimiento';
    if (mode === 'llamada') return 'Resultado esperado';
    return 'Acciones sugeridas';
  }, [mode]);

  return (
    <div className="h-[calc(100vh-8rem)] grid grid-cols-12 gap-6">
      {/* Sidebar */}
      <div className="col-span-12 xl:col-span-3 bg-white rounded-[30px] border border-slate-200 p-4 space-y-3">
        {(Object.keys(MODE_CONFIG) as AssistantMode[]).map((item) => {
          const cfg = MODE_CONFIG[item];
          const Icon = cfg.icon;
          const active = mode === item;

          return (
            <button
              key={item}
              onClick={() => handleSelectMode(item)}
              className={`w-full flex items-center p-4 rounded-[22px] border text-left transition-all ${
                active
                  ? 'bg-white border-blue-500 ring-1 ring-blue-500 shadow-sm'
                  : 'bg-slate-50 border-slate-200 hover:bg-white'
              }`}
            >
              <div
                className={`p-2 rounded-xl mr-3 ${
                  active ? 'bg-blue-100 text-blue-600' : 'bg-slate-200 text-slate-500'
                }`}
              >
                <Icon size={18} />
              </div>
              <div>
                <div className="font-semibold text-slate-900">{cfg.title}</div>
                <div className="text-xs text-slate-500">{cfg.subtitle}</div>
              </div>
            </button>
          );
        })}

        <div className="p-4 bg-slate-50 rounded-[22px] border border-slate-200 mt-4">
          <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.22em] mb-3">
            ¿Qué puede hacer?
          </h4>
          <div className="space-y-2">
            {suggestedActions.map((item) => (
              <div key={item} className="flex items-start gap-2 text-sm text-slate-700">
                <ChevronRight size={16} className="text-slate-400 mt-0.5 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main area */}
      <div className="col-span-12 xl:col-span-9 bg-white rounded-[30px] border border-slate-200 overflow-hidden flex flex-col min-h-0">
        {mode === 'import' ? (
          <div className="flex-1 overflow-y-auto p-6">
            {!parsedPreview ? (
              <div className="max-w-3xl mx-auto space-y-6">
                <div className="text-center">
                  <h2 className="text-2xl font-black text-slate-900">Importación Inteligente</h2>
                  <p className="text-slate-500 mt-2">
                    Pega cualquier texto, lista o CSV desordenado. La IA estructurará los datos automáticamente.
                  </p>
                </div>

                <div className="bg-slate-50 p-4 rounded-[24px] border border-slate-200">
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Datos sin procesar
                  </label>
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    rows={12}
                    className="w-full rounded-[20px] border border-slate-200 p-4 text-sm font-mono focus:ring-0 focus:border-slate-300 bg-white"
                    placeholder={`Ejemplo:\nCliente: Constructora Bolivar, NIT 890900. Contacto: Maria Perez, Gerente (maria@bolivar.com).\nNueva empresa: Tech Solutions en Medellin...`}
                  />
                </div>

                <button
                  onClick={handleAnalyzeImport}
                  disabled={isLoading || !importText.trim()}
                  className="w-full bg-slate-900 text-white py-3 rounded-[20px] font-medium shadow-lg hover:bg-slate-800 disabled:opacity-70 flex items-center justify-center transition-all"
                >
                  {isLoading ? <Loader2 className="animate-spin mr-2" /> : <Sparkles className="mr-2" />}
                  {isLoading ? 'Analizando con IA...' : 'Procesar Datos'}
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <h2 className="text-xl font-bold text-slate-900">Vista Previa de Importación</h2>
                  <div className="space-x-3">
                    <button
                      onClick={() => setParsedPreview(null)}
                      className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={confirmImport}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 shadow-sm flex items-center"
                    >
                      <Check size={18} className="mr-2" />
                      Confirmar e Importar
                    </button>
                  </div>
                </div>

                {parsedPreview.accounts.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 font-semibold text-slate-700 flex items-center">
                      <Database size={16} className="mr-2" /> Cuentas Detectadas ({parsedPreview.accounts.length})
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Empresa</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Sector</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">NIT</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200">
                          {parsedPreview.accounts.map((acc) => (
                            <tr key={acc.id}>
                              <td className="px-4 py-2 text-sm text-slate-900 font-medium">
                                {acc.nombreComercial || acc.razonSocial}
                              </td>
                              <td className="px-4 py-2 text-sm text-slate-500">{acc.sector}</td>
                              <td className="px-4 py-2 text-sm text-slate-500">{acc.nit}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {parsedPreview.contacts.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 font-semibold text-slate-700 flex items-center">
                      <Database size={16} className="mr-2" /> Contactos Detectados ({parsedPreview.contacts.length})
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Nombre</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Cargo</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Email</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200">
                          {parsedPreview.contacts.map((c) => (
                            <tr key={c.id}>
                              <td className="px-4 py-2 text-sm text-slate-900 font-medium">{c.fullName}</td>
                              <td className="px-4 py-2 text-sm text-slate-500">{c.role}</td>
                              <td className="px-4 py-2 text-sm text-slate-500">{c.email}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {parsedPreview.accounts.length === 0 && parsedPreview.contacts.length === 0 && (
                  <div className="p-8 text-center text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                    <AlertCircle className="mx-auto h-8 w-8 text-slate-400 mb-2" />
                    No se detectaron datos estructurados claros. Intenta reformular el texto.
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-12 min-h-0">
            {/* Chat zone */}
            <div className="col-span-12 xl:col-span-8 flex flex-col min-h-0 border-r border-slate-100">
              <div className="px-6 py-5 border-b border-slate-100 bg-white">
                <h2 className="text-2xl font-black text-slate-900">{MODE_CONFIG[mode].title}</h2>
                <p className="text-sm text-slate-500 mt-1">{MODE_CONFIG[mode].subtitle}</p>

                {quickPrompts.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-4">
                    {quickPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => handleUsePrompt(prompt)}
                        className="px-3 py-2 rounded-full bg-slate-50 border border-slate-200 text-xs font-bold text-slate-600 hover:bg-white transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[85%]">
                      <div
                        className={`rounded-[24px] p-4 shadow-sm ${
                          msg.role === 'user'
                            ? 'bg-blue-600 text-white rounded-br-none'
                            : 'bg-slate-100 text-slate-800 rounded-bl-none'
                        }`}
                      >
                        {msg.role === 'model' ? (
                          <div className="prose prose-sm prose-slate max-w-none">
                            <Markdown>{msg.content}</Markdown>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                        )}
                      </div>

                      {msg.role === 'model' && msg.id !== 'welcome' && !msg.id.startsWith('welcome_') && (
                        <div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              onClick={() => handleSaveAsActivity(msg.content, msg.id)}
                              disabled={!effectiveAccount || actionState[msg.id]?.activity}
                              className={`px-3 py-2 rounded-full border text-xs font-black transition-colors ${
                                !effectiveAccount || actionState[msg.id]?.activity
                                  ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              Guardar como actividad
                            </button>

                            <button
                              onClick={() => handleCreateFollowUp(msg.content, msg.id)}
                              disabled={!effectiveAccount || actionState[msg.id]?.followUp}
                              className={`px-3 py-2 rounded-full border text-xs font-black transition-colors ${
                                !effectiveAccount || actionState[msg.id]?.followUp
                                  ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              Crear seguimiento
                            </button>

                            <button
                              onClick={() => handleCreateInternalTask(msg.content, msg.id)}
                              disabled={!effectiveAccount || actionState[msg.id]?.internalTask}
                              className={`px-3 py-2 rounded-full border text-xs font-black transition-colors ${
                                !effectiveAccount || actionState[msg.id]?.internalTask
                                  ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              Crear tarea interna
                            </button>

                            <button
                              onClick={() => handleGenerateWhatsApp(msg.content, msg.id)}
                              disabled={actionState[msg.id]?.whatsapp}
                              className={`px-3 py-2 rounded-full border text-xs font-black transition-colors ${
                                actionState[msg.id]?.whatsapp
                                  ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              Redactar WhatsApp
                            </button>

                            {canSuggestOpportunity && (
                              <button
                                onClick={() => handleCreateOpportunityFromIA(msg.content, msg.id)}
                                disabled={!effectiveAccount || !effectiveContact || actionState[msg.id]?.opportunity}
                                className={`px-3 py-2 rounded-full border text-xs font-black transition-colors ${
                                  !effectiveAccount || !effectiveContact || actionState[msg.id]?.opportunity
                                    ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                Crear oportunidad
                              </button>
                            )}
                          </div>
                          
                          <div className="mt-3 text-xs text-slate-500 space-y-1">
                            {!effectiveAccount && (
                              <p>• Falta seleccionar o detectar una empresa para guardar actividad, seguimiento o tarea interna.</p>
                            )}
                            {effectiveAccount && !effectiveContact && canSuggestOpportunity && (
                              <p>• Ya hay empresa, pero falta seleccionar o detectar un contacto para crear oportunidad.</p>
                            )}
                            {!canSuggestOpportunity && (
                              <p>• Este caso parece más operativo que comercial; por eso no se sugiere oportunidad como acción principal.</p>
                            )}
                          </div>

                          {/* ✅ Check de acciones ejecutadas */}
                          {(actionState[msg.id]?.activity ||
                            actionState[msg.id]?.followUp ||
                            actionState[msg.id]?.internalTask ||
                            actionState[msg.id]?.whatsapp) && (
                            <div className="mt-3 bg-slate-50 border border-slate-200 rounded-[18px] p-3">
                              <p className="text-[11px] font-black text-slate-500 uppercase tracking-[0.18em] mb-2">
                                Acciones ejecutadas
                              </p>

                              <div className="space-y-1 text-sm text-slate-700">
                                {actionState[msg.id]?.activity && <p>Guardar como actividad ✅</p>}
                                {actionState[msg.id]?.followUp && <p>Crear seguimiento ✅</p>}
                                {actionState[msg.id]?.internalTask && <p>Crear tarea interna ✅</p>}
                                {actionState[msg.id]?.whatsapp && <p>Redactar WhatsApp ✅</p>}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-slate-100 rounded-[24px] rounded-bl-none p-4 flex items-center space-x-2">
                      <Loader2 size={16} className="animate-spin text-slate-500" />
                      <span className="text-sm text-slate-500">Procesando información...</span>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50 flex flex-col items-center">
                <div className="w-full">
                  {selectedFile && (
                    <div className="mb-3 flex items-center bg-blue-50 border border-blue-100 rounded-lg p-2 w-fit">
                      <div className="bg-blue-100 p-1.5 rounded-md mr-2 text-blue-600">
                        <FileText size={16} />
                      </div>
                      <span className="text-sm text-blue-900 font-medium mr-2 max-w-[200px] truncate">
                        {selectedFile.name}
                      </span>
                      <button
                        onClick={() => setSelectedFile(null)}
                        className="text-blue-400 hover:text-blue-600 p-1 hover:bg-blue-100 rounded-full transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  <div
                    className={`flex items-end space-x-2 transition-all duration-200 rounded-xl p-1 ${
                      isDragging ? 'bg-blue-50 ring-2 ring-blue-400 ring-dashed' : ''
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileSelect}
                      className="hidden"
                      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.txt"
                    />

                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="p-3 mb-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Adjuntar archivo o pegar captura (PDF, JPG, PNG, DOCX, TXT)"
                    >
                      <Paperclip size={20} />
                    </button>

                    <textarea
                      value={input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        setTimeout(saveAssistantState, 0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      onPaste={handlePaste}
                      placeholder={MODE_CONFIG[mode].placeholder}
                      className="flex-1 rounded-lg border border-slate-200 focus:ring-0 focus:border-slate-300 p-3 shadow-sm bg-white min-h-[56px] max-h-40 resize-none"
                      disabled={isLoading}
                    />

                    <button
                      onClick={handleSendMessage}
                      disabled={isLoading || (!input.trim() && !selectedFile)}
                      className="mb-1 bg-blue-600 text-white rounded-lg px-4 py-3 hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      <Send size={20} />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-2 px-1 w-full text-center">
                  Puedes pegar texto largo, pegar una captura con Ctrl+V o adjuntar PDF, imagen, DOCX o TXT.
                </p>
              </div>
            </div>

            {/* Right panel */}
            <div className="col-span-12 xl:col-span-4 bg-white p-5 overflow-y-auto space-y-5">
              <button
                onClick={resetAssistantWorkspace}
                className="w-full px-4 py-3 rounded-[18px] border border-slate-200 text-sm font-black text-slate-600 hover:bg-slate-50"
              >
                Limpiar espacio de Inteligencia
              </button>

              <div className="bg-slate-50 border border-slate-200 rounded-[24px] p-5">
                <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.22em] mb-3">
                  {rightPanelTitle}
                </h3>
                <p className="text-sm text-slate-700 leading-relaxed">
                  {MODE_CONFIG[mode].intro}
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-[24px] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Building2 size={16} className="text-slate-400" />
                  <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.22em]">
                    Contexto manual
                  </h4>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-[0.18em] mb-2">
                      Empresa
                    </label>
                    <select
                      value={selectedAccountId}
                      onChange={(e) => {
                        setSelectedAccountId(e.target.value);
                        setSelectedContactId('');
                        saveAssistantState();
                      }}
                      className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-0 focus:border-slate-300"
                    >
                      <option value="">Usar empresa detectada automáticamente</option>
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.nombreComercial || acc.razonSocial}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-[0.18em] mb-2">
                      Contacto
                    </label>
                    <select
                      value={selectedContactId}
                      onChange={(e) => {
                        setSelectedContactId(e.target.value);
                        saveAssistantState();
                      }}
                      className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-0 focus:border-slate-300"
                    >
                      <option value="">Usar contacto detectado automáticamente</option>
                      {availableContactsForSelectedAccount.map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {mode === 'prep_reunion' && (
                <>
                  <div className="bg-white border border-slate-200 rounded-[24px] p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Building2 size={16} className="text-slate-400" />
                      <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.22em]">
                        Empresa seleccionada
                      </h4>
                    </div>
                    {effectiveAccount ? (
                      <div>
                        <p className="text-base font-black text-slate-900">
                          {effectiveAccount.nombreComercial || effectiveAccount.razonSocial}
                        </p>
                        <p className="text-xs font-bold text-slate-500 mt-1">
                          {effectiveAccount.razonSocial}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-wide">
                            {effectiveAccount.sector || 'Sin sector'}
                          </span>
                          <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-wide">
                            {effectiveAccount.ciudad || 'Sin ciudad'}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">
                        Escribe el nombre de la empresa para preparar el contexto o selecciónala manualmente.
                      </p>
                    )}
                  </div>

                  <div className="bg-white border border-slate-200 rounded-[24px] p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <UserRound size={16} className="text-slate-400" />
                      <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.22em]">
                        Contacto seleccionado
                      </h4>
                    </div>
                    {effectiveContact ? (
                      <div>
                        <p className="text-base font-black text-slate-900">
                          {effectiveContact.fullName}
                        </p>
                        <p className="text-xs font-bold text-slate-500 mt-1">
                          {effectiveContact.role || 'Sin cargo'}
                        </p>
                        <p className="text-xs text-slate-500 mt-2">
                          {effectiveContact.email || 'Sin email'}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">
                        Si quieres contexto por persona, incluye el nombre del contacto en la consulta o selecciónalo manualmente.
                      </p>
                    )}
                  </div>

                  <div className="bg-white border border-slate-200 rounded-[24px] p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Clock3 size={16} className="text-slate-400" />
                      <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.22em]">
                        Última interacción
                      </h4>
                    </div>

                    {latestAccountActivity || latestContactActivity ? (
                      <div className="space-y-4">
                        {latestAccountActivity && (
                          <div className="bg-slate-50 border border-slate-200 rounded-[18px] p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mb-2">
                              Empresa
                            </p>
                            <p className="text-sm font-bold text-slate-800">
                              {latestAccountActivity.type}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                              {formatDateTime(latestAccountActivity.createdAt)}
                            </p>
                            <p className="text-sm text-slate-700 mt-3 italic">
                              "{latestAccountActivity.description}"
                            </p>
                          </div>
                        )}

                        {latestContactActivity && (
                          <div className="bg-slate-50 border border-slate-200 rounded-[18px] p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mb-2">
                              Contacto
                            </p>
                            <p className="text-sm font-bold text-slate-800">
                              {latestContactActivity.type}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                              {formatDateTime(latestContactActivity.createdAt)}
                            </p>
                            <p className="text-sm text-slate-700 mt-3 italic">
                              "{latestContactActivity.description}"
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">
                        No se detectó actividad reciente con esa referencia.
                      </p>
                    )}
                  </div>

                  <div className="bg-white border border-slate-200 rounded-[24px] p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <CalendarClock size={16} className="text-slate-400" />
                      <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.22em]">
                        Otros contactos relacionados
                      </h4>
                    </div>

                    {relatedContacts.length > 0 ? (
                      <div className="space-y-3">
                        {relatedContacts.slice(0, 5).map(({ contact, lastActivity }) => (
                          <div
                            key={contact.id}
                            className="bg-slate-50 border border-slate-200 rounded-[18px] p-4"
                          >
                            <p className="text-sm font-black text-slate-900">
                              {contact.fullName}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                              {contact.role || 'Sin cargo'}
                            </p>
                            <p className="text-xs text-slate-500 mt-2">
                              Última interacción:{' '}
                              {lastActivity ? formatDate(lastActivity.createdAt) : 'Sin registro'}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">
                        No hay contactos asociados detectados.
                      </p>
                    )}
                  </div>
                </>
              )}

              {mode !== 'prep_reunion' && (
                <>
                  <div className="bg-white border border-slate-200 rounded-[24px] p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Wand2 size={16} className="text-slate-400" />
                      <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.22em]">
                        Sugerencias rápidas
                      </h4>
                    </div>

                    <div className="space-y-3">
                      {quickPrompts.map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => handleUsePrompt(prompt)}
                          className="w-full text-left bg-slate-50 border border-slate-200 rounded-[18px] p-3 text-sm text-slate-700 hover:bg-white transition-colors"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-[24px] p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <ShieldAlert size={16} className="text-slate-400" />
                      <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.22em]">
                        Contexto CRM
                      </h4>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-50 border border-slate-200 rounded-[18px] p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                          Cuentas
                        </p>
                        <p className="text-2xl font-black text-slate-900 mt-2">{accounts.length}</p>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-[18px] p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                          Contactos
                        </p>
                        <p className="text-2xl font-black text-slate-900 mt-2">{contacts.length}</p>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-[18px] p-4 col-span-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                          Actividades
                        </p>
                        <p className="text-2xl font-black text-slate-900 mt-2">{activities.length}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-[24px] p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Mail size={16} className="text-slate-400" />
                      <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.22em]">
                        Recomendación de uso
                      </h4>
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed">
                      Usa consultas cortas, específicas y orientadas a acción. Ejemplo:
                      <span className="font-semibold">
                        {' '}
                        “resume esta llamada y propón seguimiento”
                      </span>{' '}
                      o
                      <span className="font-semibold">
                        {' '}
                        “redáctame un correo de cierre”
                      </span>.
                    </p>
                  </div>
                  
                  {/* WhatsApp Generado */}
                  {generatedWhatsApp && (
                    <div className="bg-white border border-slate-200 rounded-[24px] p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <MessageSquareText size={16} className="text-slate-400" />
                        <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.22em]">
                          WhatsApp sugerido
                        </h4>
                      </div>

                      <div className="bg-slate-50 border border-slate-200 rounded-[18px] p-4">
                        <p className="text-sm text-slate-700 whitespace-pre-wrap">{generatedWhatsApp}</p>
                      </div>

                      <button
                        onClick={() => navigator.clipboard.writeText(generatedWhatsApp)}
                        className="mt-4 px-4 py-2 rounded-[16px] bg-slate-900 text-white text-xs font-black uppercase tracking-[0.18em] hover:bg-slate-800"
                      >
                        Copiar mensaje
                      </button>
                    </div>
                  )}

                  {/* Seguimiento Creado */}
                  {suggestedFollowUp && (
                    <div className="bg-white border border-slate-200 rounded-[24px] p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <Clock3 size={16} className="text-slate-400" />
                        <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.22em]">
                          Seguimiento creado
                        </h4>
                      </div>
                      <p className="text-sm text-slate-700">
                        Se programó un seguimiento para: <span className="font-black">{suggestedFollowUp}</span>
                      </p>
                    </div>
                  )}

                  {/* Tarea Interna Creada */}
                  {internalTaskCreated && (
                    <div className="bg-white border border-slate-200 rounded-[24px] p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <ShieldAlert size={16} className="text-slate-400" />
                        <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.22em]">
                          Tarea interna creada
                        </h4>
                      </div>
                      <p className="text-sm text-slate-700">{internalTaskCreated}</p>
                    </div>
                  )}

                  {/* Confirmaciones Log */}
                  {actionLog.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-[24px] p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <Check size={16} className="text-slate-400" />
                        <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.22em]">
                          Confirmaciones
                        </h4>
                      </div>

                      <div className="space-y-2">
                        {actionLog.map((item, index) => (
                          <div
                            key={`${item}_${index}`}
                            className="bg-slate-50 border border-slate-200 rounded-[16px] p-3 text-sm text-slate-700"
                          >
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Assistant;