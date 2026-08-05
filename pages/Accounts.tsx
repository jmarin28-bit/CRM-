import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  createAccount,
  createContact,
  listAccountsByUser,
  listContactsByAccountId,
  deleteAccount,
  countAccountRelations,
  listActivities,
  listOpportunitiesByUser,
  listQuotesByUser,
  getActiveUser,
} from "../services/storage";
import type {
  SectorOption,
  ClientClassificationOption,
  AccountV2,
  OpportunityV2,
  QuoteV2,
  ActivityV2,
} from "../types";
import { extractRutData } from "../services/gemini";
import {
  User,
  Mail,
  Phone,
  Briefcase,
  Plus,
  X,
  Cloud,
  Trash2,
  Building2,
  MapPin,
  Target,
  MessageCircle,
  Hash,
  Globe,
  Search,
  FileText,
  TrendingUp,
  Clock3,
  Users,
} from "lucide-react";

const InputWithIcon = ({
  icon: Icon,
  label,
  isOptional = false,
  error,
  ...props
}: any) => (
  <div className="space-y-2">
    <label className="text-[11px] font-black text-slate-400 uppercase tracking-[0.22em] ml-1">
      {label}
      {isOptional ? " (Opcional)" : ""}
    </label>

    <div className="relative group">
      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-300">
        <Icon size={14} />
      </div>

      <input
        {...props}
        className={`w-full border rounded-2xl pl-10 pr-4 py-3 text-sm font-bold outline-none focus:ring-0 transition-all placeholder:text-slate-300 text-slate-700 ${
          error
            ? "bg-red-50/40 border-red-300 focus:border-red-400"
            : "bg-white border-slate-200 focus:border-slate-300"
        }`}
      />
    </div>

    {error && (
      <p className="text-[11px] font-black text-red-600 uppercase tracking-[0.12em] ml-1">
        {error}
      </p>
    )}
  </div>
);

type ContactDraft = {
  fullName: string;
  role: string;
  email: string;
  phone: string;
  whatsapp: string;
};

const SECTORS: SectorOption[] = [
  "Farma",
  "Lab Terceros",
  "Petróleo",
  "Ambiental",
  "Alimentos",
  "Otros",
];

const CLASSIFICATIONS: ClientClassificationOption[] = ["AAA", "AA", "A", "B", "C"];

const emptyContact = (): ContactDraft => ({
  fullName: "",
  role: "",
  email: "",
  phone: "",
  whatsapp: "",
});

interface AccountsProps {
  pendingData?: Partial<AccountV2> | null;
  onClearPending?: () => void;
}

const formatDateTime = (value?: string | null) => {
  if (!value) return "Sin fecha";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "Sin fecha";
  return d.toLocaleString("es-CO");
};

const ACCOUNT_ACTIVITY_FILTERS = [
  "Todos",
  "Análisis IA",
  "Nota",
  "Seguimiento IA",
  "Tarea Interna IA",
  "Llamada",
  "Correo",
  "Reunión",
  "Videollamada",
  "Visita",
];

const normalizeText = (value?: string) =>
  (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();

const previewText = (
  text: string,
  expanded: boolean,
  max = 220,
  forceFull = false
) => {
  if (forceFull || expanded || text.length <= max) return text;
  return text.slice(0, max).trim() + "...";
};

const getOnlyDigits = (value: string) => value.replace(/\D/g, "");

const isValidEmail = (value: string) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
};

const isValidColombianMobile = (value: string) => {
  const digits = getOnlyDigits(value);
  return /^3\d{9}$/.test(digits);
};

const hasAnyContactData = (contact: ContactDraft) => {
  return Boolean(
    contact.fullName.trim() ||
    contact.role.trim() ||
    contact.email.trim() ||
    contact.phone.trim() ||
    contact.whatsapp.trim()
  );
};

export default function Accounts({ pendingData, onClearPending }: AccountsProps) {
  const [refresh, setRefresh] = useState(0);
  const activeUser = getActiveUser();

  const [openNew, setOpenNew] = useState(!!pendingData);
  const [saving, setSaving] = useState(false);
  const [rutLoading, setRutLoading] = useState(false);
  const [rutError, setRutError] = useState("");
  const [formError, setFormError] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [searchTerm, setSearchTerm] = useState("");

  const [activitySearch, setActivitySearch] = useState("");
  const [activityTypeFilter, setActivityTypeFilter] = useState("Todos");
  const [visibleActivities, setVisibleActivities] = useState(5);
  const [expandedActivities, setExpandedActivities] = useState<Record<string, boolean>>({});

  const [razonSocial, setRazonSocial] = useState(pendingData?.razonSocial || "");
  const [nombreComercial, setNombreComercial] = useState(pendingData?.nombreComercial || "");
  const [nit, setNit] = useState(pendingData?.nit || "");
  const [sector, setSector] = useState<SectorOption | "">(pendingData?.sector || "");
  const [clasificacion, setClasificacion] = useState<ClientClassificationOption | "">(pendingData?.clasificacion || "");
  const [sede, setSede] = useState((pendingData as any)?.sede || "");
  const [ciudad, setCiudad] = useState(pendingData?.ciudad || "");
  const [direccion, setDireccion] = useState(pendingData?.direccion || "");
  const [contactsDraft, setContactsDraft] = useState<ContactDraft[]>([emptyContact()]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (pendingData) {
      setOpenNew(true);
      setRazonSocial(pendingData.razonSocial || "");
      setNombreComercial(pendingData.nombreComercial || "");
      setNit(pendingData.nit || "");
      setSector(pendingData.sector || "");
      setClasificacion(pendingData.clasificacion || "");
      setSede((pendingData as any).sede || "");
      setCiudad(pendingData.ciudad || "");
      setDireccion(pendingData.direccion || "");
      if (onClearPending) onClearPending();
    }
  }, [pendingData, onClearPending]);

  const accounts = useMemo(
    () => listAccountsByUser(activeUser || undefined), 
    [refresh, activeUser?.id]
  );

  const filteredAccounts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return accounts;

    return accounts.filter((a) => {
      const text = [
        a.razonSocial,
        a.nombreComercial,
        a.nit,
        a.ciudad,
        a.sector,
      ]
        .join(" ")
        .toLowerCase();

      return text.includes(term);
    });
  }, [accounts, searchTerm]);

  const [selectedAccount, setSelectedAccount] = useState<AccountV2 | null>(null);

  useEffect(() => {
    if (!filteredAccounts.length) {
      setSelectedAccount(null);
      return;
    }

    if (!selectedAccount) {
      setSelectedAccount(filteredAccounts[0]);
      return;
    }

    const exists = filteredAccounts.find((a) => a.id === selectedAccount.id);
    if (!exists) setSelectedAccount(filteredAccounts[0]);
  }, [filteredAccounts, selectedAccount]);

  useEffect(() => {
    setActivitySearch("");
    setActivityTypeFilter("Todos");
    setVisibleActivities(5);
    setExpandedActivities({});
  }, [selectedAccount?.id]);

  const accountContacts = useMemo(
    () => (selectedAccount ? listContactsByAccountId(selectedAccount.id) : []),
    [selectedAccount, refresh]
  );

  const accountActivities = useMemo<ActivityV2[]>(
    () =>
      selectedAccount
        ? listActivities({ accountId: selectedAccount.id }).sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )
        : [],
    [selectedAccount, refresh]
  );

  const accountOpportunities = useMemo<OpportunityV2[]>(
    () =>
      selectedAccount
        ? listOpportunitiesByUser().filter((o) => o.accountId === selectedAccount.id)
        : [],
    [selectedAccount, refresh]
  );

  const accountQuotes = useMemo<QuoteV2[]>(
    () =>
      selectedAccount
        ? listQuotesByUser().filter((q) => q.accountId === selectedAccount.id)
        : [],
    [selectedAccount, refresh]
  );

  const nextFollowUp = useMemo(() => {
    const now = Date.now();
    return [...accountActivities]
      .filter((a) => a.followUpAt && new Date(a.followUpAt).getTime() >= now)
      .sort(
        (a, b) =>
          new Date(a.followUpAt || "").getTime() - new Date(b.followUpAt || "").getTime()
      )[0] || null;
  }, [accountActivities]);

  const filteredAccountActivities = useMemo(() => {
    return accountActivities.filter((act) => {
      const search = normalizeText(activitySearch);
      const type = normalizeText(act.type);
      const desc = normalizeText(act.description);
      const user = normalizeText(act.user);
  
      const typeMatch =
        activityTypeFilter === "Todos" ||
        type.includes(normalizeText(activityTypeFilter));
  
      const textMatch =
        !search ||
        type.includes(search) ||
        desc.includes(search) ||
        user.includes(search);
  
      return typeMatch && textMatch;
    });
  }, [accountActivities, activitySearch, activityTypeFilter]);
  
  const visibleFilteredActivities = useMemo(() => {
    return filteredAccountActivities.slice(0, visibleActivities);
  }, [filteredAccountActivities, visibleActivities]);

  const resetForm = () => {
    setRazonSocial("");
    setNombreComercial("");
    setNit("");
    setSector("");
    setClasificacion("");
    setSede("");
    setCiudad("");
    setDireccion("");
    setContactsDraft([emptyContact()]);
    setRutError("");
  };

  const handleOpenNew = () => {
    resetForm();
    setFormError("");
    setFormErrors({});
    setRutError("");
    setOpenNew(true);
  };

  async function saveAccount() {
    const errors: Record<string, string> = {};

    if (!razonSocial.trim()) {
      errors.razonSocial = "Falta razón social";
    }

    if (!nit.trim()) {
      errors.nit = "Falta NIT";
    }

    if (!sector) {
      errors.sector = "Falta sector";
    }

    if (!clasificacion) {
      errors.clasificacion = "Falta clasificación";
    }

    if (!ciudad.trim()) {
      errors.ciudad = "Falta ciudad";
    }

    if (!direccion.trim()) {
      errors.direccion = "Falta dirección";
    }

    contactsDraft.forEach((contact, index) => {
      const shouldValidateContact = index === 0 || hasAnyContactData(contact);
      if (!shouldValidateContact) return;

      const prefix = `contact_${index}_`;

      if (!contact.fullName.trim()) {
        errors[`${prefix}fullName`] = "Falta nombre";
      }

      if (!contact.role.trim()) {
        errors[`${prefix}role`] = "Falta cargo";
      }

      if (!contact.email.trim()) {
        errors[`${prefix}email`] = "Falta email";
      } else if (!isValidEmail(contact.email)) {
        errors[`${prefix}email`] = "Email inválido";
      }

      if (contact.phone.trim()) {
        const phoneDigits = getOnlyDigits(contact.phone);
        if (phoneDigits.length < 7 || phoneDigits.length > 10) {
          errors[`${prefix}phone`] = "Teléfono inválido";
        }
      }

      if (!contact.whatsapp.trim()) {
        errors[`${prefix}whatsapp`] = "Falta WhatsApp";
      } else if (!isValidColombianMobile(contact.whatsapp)) {
        errors[`${prefix}whatsapp`] = "Debe iniciar por 3 y tener 10 dígitos";
      }
    });

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      setFormError("⚠️ Revisa los campos marcados en rojo. Falta información obligatoria o hay datos inválidos.");
      return;
    }

    setFormErrors({});
    setFormError("");
    setSaving(true);
    try {
      const acc = createAccount({
        razonSocial: razonSocial.trim(),
        nombreComercial: nombreComercial.trim(),
        nit: nit.trim(),
        sector: sector as any,
        clasificacion: clasificacion as any,
        sede: sede.trim(),
        ciudad: ciudad.trim(),
        direccion: direccion.trim(),
      });

      for (const c of contactsDraft.filter((contact, index) => index === 0 || hasAnyContactData(contact))) {
        createContact({
          accountId: acc.id,
          fullName: c.fullName.trim(),
          role: c.role.trim(),
          email: c.email.trim().toLowerCase(),
          phone: getOnlyDigits(c.phone),
          whatsapp: getOnlyDigits(c.whatsapp),
        });
      }

      setOpenNew(false);
      resetForm();
      setRefresh((x) => x + 1);
      setSelectedAccount(acc);
    } finally {
      setSaving(false);
    }
  }

  async function runBrowserOcr(file: File): Promise<{ razon_social?: string; nit?: string; direccion?: string; ciudad?: string }> {
    try {
      if (!(window as any).Tesseract) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("No se pudo cargar motor de OCR Tesseract."));
          document.head.appendChild(script);
        });
      }

      const Tesseract = (window as any).Tesseract;
      if (Tesseract && Tesseract.recognize) {
        const workerResult = await Tesseract.recognize(file, 'spa+eng');
        const text = workerResult?.data?.text || '';

        const result: { razon_social?: string; nit?: string; direccion?: string; ciudad?: string } = {};

        const nitMatch = text.match(/(?:NIT|Casilla\s*5|Identificaci[oó]n)[:\s]*([\d.\-]{8,15})/i) ||
                         text.match(/\b(\d{9,10}-\d|\d{3}\.\d{3}\.\d{3}-\d|\d{9})\b/);
        if (nitMatch) result.nit = nitMatch[1].replace(/[^\d\-]/g, '');

        const razonMatch = text.match(/(?:Razon\s*Social|Razón\s*Social|Casilla\s*35)[:\s]*([^\r\n]{3,60})/i) ||
                           text.match(/35\s+([A-Z0-9\s.\-&]{4,60}\s+(?:S\.?A\.?S\.?|LTDA|S\.?A\.?|E\.?U\.?))/i) ||
                           text.match(/([A-Z0-9\s.\-&]{4,60}\s+(?:S\.?A\.?S\.?|LTDA|S\.?A\.?|E\.?U\.?))/i);
        if (razonMatch) result.razon_social = razonMatch[1].trim();

        const dirMatch = text.match(/(?:Direcci[oó]n|Casilla\s*41)[:\s]*([^\r\n]{5,60})/i) ||
                         text.match(/(Calle|Carrera|Cra|Cl|Av|Avenida|Transversal|Tv|Diagonal|Dg)[^\r\n]{5,50}/i);
        if (dirMatch) result.direccion = dirMatch[0].trim();

        const ciudadMatch = text.match(/\b(Bogot[aá]|Medell[ií]n|Cali|Barranquilla|Cartagena|Bucaramanga|Pereira|Manizales|Cúcuta|Ibagué|Neiva|Santa Marta|Villavicencio|Rionegro|Envigado|Itagüí|Chía|Soacha)\b/i);
        if (ciudadMatch) result.ciudad = ciudadMatch[0];

        return result;
      }
    } catch (e) {
      console.warn("Browser Tesseract OCR fallback error:", e);
    }
    return {};
  }

  async function onAutofillRut(file: File) {
    setRutLoading(true);
    setRutError("");
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        try {
          const base64 = String(reader.result).split(",")[1];
          const fileMime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/png");
          let data = await extractRutData({
            mimeType: fileMime,
            data: base64,
          });

          // Si el backend no extrajo Razón Social ni NIT (ej: foto o PDF escaneado sin texto vectorial), ejecutar OCR de navegador
          if (!data.razon_social && !data.nit) {
            const ocrData = await runBrowserOcr(file);
            if (ocrData.razon_social || ocrData.nit) {
              data = { ...data, ...ocrData };
            }
          }

          if (data.razon_social) setRazonSocial(data.razon_social);
          if (data.nombre_comercial) setNombreComercial(data.nombre_comercial);
          if (data.nit) setNit(data.nit);
          if (data.ciudad) setCiudad(data.ciudad);
          if (data.direccion) setDireccion(data.direccion);

          if (!data.razon_social && !data.nit) {
            setRutError("No se pudo detectar información de Razón Social o NIT en el documento. Revisa los campos manualmente.");
          }
        } catch (err: any) {
          console.error("RUT extraction error:", err);
          setRutError(err?.message || "Error al extraer datos del RUT. Verifica el archivo.");
        } finally {
          setRutLoading(false);
        }
      };
      reader.onerror = () => {
        setRutError("Error leyendo el archivo del RUT.");
        setRutLoading(false);
      };
    } catch {
      setRutError("Error al procesar la lectura del RUT.");
      setRutLoading(false);
    }
  }

  const handleDeleteAccount = (account: AccountV2) => {
    const nombre = account.nombreComercial || account.razonSocial || "esta empresa";
    const rel = countAccountRelations(account.id);

    // El borrado ahora arrastra todo lo que colgaba de la cuenta, así que hay
    // que decir qué se va antes de hacerlo. Sin este detalle el usuario no
    // tiene forma de saber que también pierde las cotizaciones.
    const arrastra = [
      rel.contacts && `${rel.contacts} contacto(s)`,
      rel.opportunities && `${rel.opportunities} oportunidad(es)`,
      rel.quotes && `${rel.quotes} cotización(es)`,
      rel.activities && `${rel.activities} actividad(es)`,
      rel.tasks && `${rel.tasks} tarea(s)`,
    ].filter(Boolean) as string[];

    const mensaje = arrastra.length
      ? `Vas a eliminar "${nombre}" y también:\n\n• ${arrastra.join("\n• ")}\n\nEsta acción no se puede deshacer. ¿Continuar?`
      : `Vas a eliminar "${nombre}". Esta acción no se puede deshacer. ¿Continuar?`;

    if (!window.confirm(mensaje)) return;

    const wasSelected = selectedAccount?.id === account.id;
    deleteAccount(account.id);
    setRefresh((r) => r + 1);
    if (wasSelected) setSelectedAccount(null);
  };

  return (
    <div className="p-8 bg-slate-50 min-h-screen text-slate-900 font-sans overflow-x-hidden">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-black tracking-tighter uppercase text-slate-900 leading-none">
            Cuentas
          </h1>
          <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-[0.28em]">
            Base de datos maestra • IonCore SAS
          </p>
        </div>

        <button
          onClick={handleOpenNew}
          className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-[20px] font-black shadow-xl shadow-blue-200 flex items-center gap-2 transition-all active:scale-95 uppercase text-xs tracking-widest"
        >
          <Plus size={18} /> Nueva Empresa
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6 h-[80vh]">
        <div className="col-span-12 xl:col-span-4 bg-white rounded-[34px] border border-slate-200 overflow-hidden flex flex-col min-h-0">
          <div className="p-4 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
              <input
                type="text"
                placeholder="Buscar empresa, NIT, ciudad o sector..."
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-0 focus:border-slate-300 placeholder:text-slate-300"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.22em]">
              Empresas
            </p>
            <span className="text-xs font-black text-slate-500">
              {filteredAccounts.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {filteredAccounts.length > 0 ? (
              filteredAccounts.map((a) => {
                const isSelected = selectedAccount?.id === a.id;

                return (
                  <div
                    key={a.id}
                    onClick={() => setSelectedAccount(a)}
                    className={`group border-b border-slate-100 px-4 py-4 cursor-pointer transition-colors ${
                      isSelected ? "bg-slate-100/70" : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-800 uppercase truncate">
                          {a.nombreComercial || a.razonSocial}
                        </p>
                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide truncate mt-1">
                          {a.razonSocial}
                        </p>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteAccount(a);
                        }}
                        className="p-2 rounded-xl text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                        title="Eliminar empresa"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-[10px] font-black uppercase tracking-wide border border-blue-100">
                        {a.clasificacion || "S/C"}
                      </span>
                      <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-wide">
                        {a.sector || "Sin sector"}
                      </span>
                      <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-wide">
                        {a.ciudad || "Sin ciudad"}
                      </span>
                    </div>

                    <p className="mt-3 text-[11px] font-bold text-slate-400">
                      NIT: {a.nit}
                    </p>
                  </div>
                );
              })
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center px-8">
                <Building2 size={42} className="text-slate-200 mb-4" />
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">
                  No hay cuentas para mostrar
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="col-span-12 xl:col-span-8 bg-white rounded-[34px] border border-slate-200 overflow-hidden flex flex-col min-h-0">
          {selectedAccount ? (
            <>
              <div className="px-8 py-7 border-b border-slate-100 flex items-start justify-between gap-6">
                <div className="flex items-start gap-5 min-w-0">
                  <div className="w-16 h-16 rounded-[22px] bg-slate-900 text-white flex items-center justify-center text-3xl font-black shrink-0">
                    {(selectedAccount.nombreComercial || selectedAccount.razonSocial).charAt(0)}
                  </div>

                  <div className="min-w-0">
                    <h2 className="text-3xl font-black text-slate-900 uppercase leading-none truncate">
                      {selectedAccount.nombreComercial || selectedAccount.razonSocial}
                    </h2>
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mt-2 truncate">
                      {selectedAccount.razonSocial}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="px-3 py-1 rounded-full bg-blue-600 text-white text-[10px] font-black uppercase tracking-wide shadow-lg shadow-blue-100">
                        Clase {selectedAccount.clasificacion || "N/A"}
                      </span>
                      <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-wide">
                        NIT {selectedAccount.nit}
                      </span>
                      <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-wide">
                        {selectedAccount.sector || "Sin sector"}
                      </span>
                      <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-wide">
                        {selectedAccount.ciudad || "Sin ciudad"}
                      </span>
                      <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-wide">
                        {(selectedAccount as any).sede || "Sin sede"}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => handleDeleteAccount(selectedAccount)}
                  className="p-3 bg-slate-50 rounded-2xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                  title="Eliminar empresa"
                >
                  <Trash2 size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  <div className="bg-slate-50 border border-slate-200 rounded-[26px] p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-2xl bg-white border border-slate-200 flex items-center justify-center">
                        <TrendingUp size={16} className="text-slate-500" />
                      </div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                        Oportunidades
                      </p>
                    </div>
                    <p className="text-3xl font-black text-slate-900">{accountOpportunities.length}</p>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-[26px] p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-2xl bg-white border border-slate-200 flex items-center justify-center">
                        <FileText size={16} className="text-slate-500" />
                      </div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                        Cotizaciones
                      </p>
                    </div>
                    <p className="text-3xl font-black text-slate-900">{accountQuotes.length}</p>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-[26px] p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-2xl bg-white border border-slate-200 flex items-center justify-center">
                        <Clock3 size={16} className="text-slate-500" />
                      </div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                        Próximo seguimiento
                      </p>
                    </div>
                    <p className="text-sm font-black text-slate-900 leading-snug">
                      {nextFollowUp ? formatDateTime(nextFollowUp.followUpAt) : "Sin programación"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <section className="bg-white border border-slate-200 rounded-[30px] p-6">
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.22em] mb-6">
                      Información corporativa
                    </p>

                    <div className="space-y-5">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                          <Building2 size={15} className="text-slate-500" />
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.18em] mb-1">
                            Razón social
                          </p>
                          <p className="text-sm font-bold text-slate-700">
                            {selectedAccount.razonSocial}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                          <Globe size={15} className="text-slate-500" />
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.18em] mb-1">
                            Nombre comercial
                          </p>
                          <p className="text-sm font-bold text-slate-700">
                            {selectedAccount.nombreComercial || "No registrado"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                          <Hash size={15} className="text-slate-500" />
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.18em] mb-1">
                            NIT
                          </p>
                          <p className="text-sm font-bold text-slate-700">{selectedAccount.nit}</p>
                        </div>
                      </div>

                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                          <Target size={15} className="text-slate-500" />
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.18em] mb-1">
                            Sector
                          </p>
                          <p className="text-sm font-bold text-slate-700 uppercase">
                            {selectedAccount.sector || "No definido"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                          <MapPin size={15} className="text-slate-500" />
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.18em] mb-1">
                            Ubicación
                          </p>
                          <p className="text-sm font-bold text-slate-700">
                            {(selectedAccount as any).sede || "Sede no registrada"}
                          </p>
                          <p className="text-sm font-bold text-slate-700 mt-1">
                            {selectedAccount.ciudad}
                          </p>
                          <p className="text-sm font-bold text-slate-500 mt-1">
                            {selectedAccount.direccion}
                          </p>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="bg-white border border-slate-200 rounded-[30px] p-6">
                    <div className="flex items-center justify-between mb-6 gap-4">
                      <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.22em]">
                        Contactos asociados
                      </p>
                      <span className="text-xs font-black text-slate-500">
                        {accountContacts.length}
                      </span>
                    </div>

                    <div className="space-y-3 max-h-[420px] overflow-y-auto custom-scrollbar pr-1">
                      {accountContacts.length > 0 ? (
                        accountContacts.map((c) => (
                          <div
                            key={c.id}
                            className="bg-slate-50 border border-slate-200 rounded-[24px] p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-black text-slate-800 uppercase truncate">
                                  {c.fullName}
                                </p>
                                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mt-1">
                                  {c.role || "Sin cargo"}
                                </p>
                              </div>

                              {c.whatsapp ? (
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 mt-1"></div>
                              ) : null}
                            </div>

                            <div className="mt-4 space-y-2">
                              <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
                                <Mail size={13} className="text-slate-400 shrink-0" />
                                <span className="truncate">{c.email || "Sin email"}</span>
                              </div>
                              <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
                                <Phone size={13} className="text-slate-400 shrink-0" />
                                <span>{c.phone || "Sin teléfono"}</span>
                              </div>
                              <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
                                <MessageCircle size={13} className="text-slate-400 shrink-0" />
                                <span>{c.whatsapp || "Sin WhatsApp"}</span>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="h-[240px] flex items-center justify-center text-center">
                          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                            No hay contactos asociados
                          </p>
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                <section className="bg-white border border-slate-200 rounded-[30px] p-6">
                  <div className="flex flex-col gap-4 mb-6">
                    <div className="flex flex-col md:flex-row md:items-center gap-3">
                      <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                          type="text"
                          placeholder="Buscar en la bitácora..."
                          className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:ring-0 focus:border-slate-300"
                          value={activitySearch}
                          onChange={(e) => setActivitySearch(e.target.value)}
                        />
                      </div>

                      <select
                        className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs font-bold outline-none"
                        value={activityTypeFilter}
                        onChange={(e) => setActivityTypeFilter(e.target.value)}
                      >
                        {ACCOUNT_ACTIVITY_FILTERS.map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.22em]">
                        Actividad reciente
                      </p>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-600">
                        {filteredAccountActivities.length} resultado(s)
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {visibleFilteredActivities.length > 0 ? (
                      visibleFilteredActivities.map((act) => {
                        const expanded = !!expandedActivities[act.id];
                        const isFollowUp = normalizeText(act.type).includes("seguimiento");
                        const showDetailButton = !isFollowUp && act.description.length > 220;

                        return (
                          <div
                            key={act.id}
                            className="bg-slate-50 border border-slate-200 rounded-[24px] p-5"
                          >
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                                {act.type}
                              </span>
                              <span className="text-slate-300">•</span>
                              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                                {formatDateTime(act.createdAt)}
                              </span>
                              <span className="text-slate-300">•</span>
                              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                                {act.user}
                              </span>
                            </div>

                            <p className="text-sm font-bold text-slate-700 italic leading-relaxed whitespace-pre-wrap">
                              "{previewText(act.description, expanded, 220, isFollowUp)}"
                            </p>

                            {showDetailButton && (
                              <button
                                onClick={() =>
                                  setExpandedActivities((prev) => ({
                                    ...prev,
                                    [act.id]: !prev[act.id],
                                  }))
                                }
                                className="mt-4 text-[10px] font-black uppercase tracking-widest text-blue-600 hover:text-slate-900"
                              >
                                {expanded ? "Ver menos" : "Ver detalle"}
                              </button>
                            )}

                            {act.followUpAt ? (
                              <div className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white border border-slate-200">
                                <Clock3 size={14} className="text-slate-400" />
                                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                                  Seguimiento: {formatDateTime(act.followUpAt)}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    ) : (
                      <div className="h-[180px] flex items-center justify-center text-center">
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                          Sin actividad registrada para esta cuenta
                        </p>
                      </div>
                    )}
                  </div>

                  {filteredAccountActivities.length > visibleActivities && (
                    <div className="flex justify-center pt-6">
                      <button
                        onClick={() => setVisibleActivities((prev) => prev + 10)}
                        className="px-6 py-3 rounded-2xl bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-700 font-black text-[10px] uppercase tracking-widest transition-all"
                      >
                        Ver historial
                      </button>
                    </div>
                  )}
                </section>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
              <Building2 size={56} className="mb-4 opacity-30" />
              <p className="font-black uppercase text-[10px] tracking-[0.28em] text-slate-400">
                Selecciona una empresa
              </p>
            </div>
          )}
        </div>
      </div>

      {openNew && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-xl">
          <div className="bg-white rounded-[60px] shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden border border-white">
            <div className="p-10 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-4xl font-black text-slate-900 uppercase tracking-tighter">
                Alta de Empresa
              </h2>
              <button
                onClick={() => setOpenNew(false)}
                className="w-14 h-14 bg-slate-50 rounded-3xl flex items-center justify-center text-slate-800 hover:bg-slate-100 transition-colors"
              >
                <X size={28} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-10 space-y-12 custom-scrollbar">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-4">
                  <button
                    disabled={rutLoading}
                    onClick={() => fileInputRef.current?.click()}
                    className="bg-blue-600 text-white px-8 py-4 rounded-[20px] font-black text-sm flex items-center gap-2 shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all active:scale-95 disabled:bg-slate-300"
                  >
                    <Cloud size={18} />
                    {rutLoading ? "Procesando RUT..." : "Extraer Datos de RUT (PDF o Imagen)"}
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    hidden
                    accept="application/pdf,image/png,image/jpeg,image/webp,image/*"
                    onChange={(e) => e.target.files?.[0] && onAutofillRut(e.target.files[0])}
                  />
                </div>

                {rutError && (
                  <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold flex items-center justify-between">
                    <span>{rutError}</span>
                    <button onClick={() => setRutError("")} className="text-amber-500 hover:text-amber-700 font-bold ml-2">✕</button>
                  </div>
                )}
              </div>

              <section>
                <h3 className="text-[12px] font-black text-slate-400 uppercase tracking-[0.28em] mb-8 border-b border-slate-100 pb-6">
                  Información Corporativa
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <InputWithIcon
                    icon={Building2}
                    label="Razón Social *"
                    value={razonSocial}
                    onChange={(e: any) => setRazonSocial(e.target.value)}
                    placeholder="Razón Social (Legal)"
                    error={formErrors.razonSocial}
                  />

                  <InputWithIcon
                    icon={Globe}
                    label="Nombre Comercial"
                    isOptional
                    value={nombreComercial}
                    onChange={(e: any) => setNombreComercial(e.target.value)}
                    placeholder="Nombre Comercial"
                  />

                  <InputWithIcon
                    icon={Hash}
                    label="NIT *"
                    value={nit}
                    onChange={(e: any) => setNit(e.target.value)}
                    placeholder="NIT"
                    error={formErrors.nit}
                  />

                  <div className="space-y-2">
                    <label className="text-[11px] font-black text-slate-400 uppercase tracking-[0.22em] ml-1">
                      Sector *
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-300">
                        <Target size={14} />
                      </div>
                      <select
                        className={`w-full border rounded-2xl pl-10 pr-4 py-3 text-sm font-bold outline-none appearance-none text-slate-700 focus:ring-0 ${
                          formErrors.sector
                            ? "bg-red-50/40 border-red-300 focus:border-red-400"
                            : "bg-white border-slate-200 focus:border-slate-300"
                        }`}
                        value={sector}
                        onChange={(e: any) => setSector(e.target.value as any)}
                      >
                        <option value="">Seleccionar sector industrial...</option>
                        {SECTORS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                    {formErrors.sector && (
                      <p className="text-[11px] font-black text-red-600 uppercase tracking-[0.12em] ml-1">
                        {formErrors.sector}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-black text-slate-400 uppercase tracking-[0.22em] ml-1">
                      Clasificación *
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-300">
                        <TrendingUp size={14} />
                      </div>
                      <select
                        className={`w-full border rounded-2xl pl-10 pr-4 py-3 text-sm font-bold outline-none appearance-none text-slate-700 focus:ring-0 ${
                          formErrors.clasificacion
                            ? "bg-red-50/40 border-red-300 focus:border-red-400"
                            : "bg-white border-slate-200 focus:border-slate-300"
                        }`}
                        value={clasificacion}
                        onChange={(e: any) => setClasificacion(e.target.value as any)}
                      >
                        <option value="">Seleccionar clasificación...</option>
                        {CLASSIFICATIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    {formErrors.clasificacion && (
                      <p className="text-[11px] font-black text-red-600 uppercase tracking-[0.12em] ml-1">
                        {formErrors.clasificacion}
                      </p>
                    )}
                  </div>

                  <InputWithIcon
                    icon={MapPin}
                    label="Sede"
                    isOptional
                    value={sede}
                    onChange={(e: any) => setSede(e.target.value)}
                    placeholder="Ej: Sede Principal, Bogotá, Medellín, Rionegro"
                    error={formErrors.sede}
                  />

                  <InputWithIcon
                    icon={MapPin}
                    label="Ciudad / Municipio *"
                    value={ciudad}
                    onChange={(e: any) => setCiudad(e.target.value)}
                    placeholder="Ciudad / Municipio"
                    error={formErrors.ciudad}
                  />

                  <InputWithIcon
                    icon={MapPin}
                    label="Dirección *"
                    value={direccion}
                    onChange={(e: any) => setDireccion(e.target.value)}
                    placeholder="Dirección"
                    error={formErrors.direccion}
                  />
                </div>
              </section>

              <section>
                <div className="flex justify-between items-center mb-8 border-b border-slate-100 pb-6">
                  <h3 className="text-[12px] font-black text-slate-400 uppercase tracking-[0.28em]">
                    Contactos Asociados
                  </h3>
                  <button
                    onClick={() => setContactsDraft([...contactsDraft, emptyContact()])}
                    className="bg-slate-100 text-slate-700 px-4 py-2 rounded-2xl font-black text-[10px] uppercase tracking-[0.18em] hover:bg-slate-200 transition-colors"
                  >
                    + Añadir
                  </button>
                </div>

                <div className="space-y-6">
                  {contactsDraft.map((c, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-50 border border-slate-200 p-6 rounded-[30px] grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 relative"
                    >
                      <InputWithIcon
                        icon={User}
                        label="Nombre Completo *"
                        value={c.fullName}
                        onChange={(e: any) => {
                          const n = [...contactsDraft];
                          n[idx].fullName = e.target.value;
                          setContactsDraft(n);
                        }}
                        placeholder="Nombre Completo"
                        error={formErrors[`contact_${idx}_fullName`]}
                      />

                      <InputWithIcon
                        icon={Briefcase}
                        label="Cargo *"
                        value={c.role}
                        onChange={(e: any) => {
                          const n = [...contactsDraft];
                          n[idx].role = e.target.value;
                          setContactsDraft(n);
                        }}
                        placeholder="Cargo"
                        error={formErrors[`contact_${idx}_role`]}
                      />

                      <InputWithIcon
                        icon={Mail}
                        label="Email *"
                        value={c.email}
                        onChange={(e: any) => {
                          const n = [...contactsDraft];
                          n[idx].email = e.target.value;
                          setContactsDraft(n);
                        }}
                        placeholder="Email"
                        error={formErrors[`contact_${idx}_email`]}
                      />

                      <InputWithIcon
                        icon={Phone}
                        label="Teléfono"
                        isOptional
                        value={c.phone}
                        onChange={(e: any) => {
                          const n = [...contactsDraft];
                          n[idx].phone = e.target.value;
                          setContactsDraft(n);
                        }}
                        placeholder="Teléfono fijo o alterno"
                        error={formErrors[`contact_${idx}_phone`]}
                      />

                      <InputWithIcon
                        icon={MessageCircle}
                        label="WhatsApp *"
                        value={c.whatsapp}
                        onChange={(e: any) => {
                          const n = [...contactsDraft];
                          n[idx].whatsapp = e.target.value;
                          setContactsDraft(n);
                        }}
                        placeholder="WhatsApp"
                        error={formErrors[`contact_${idx}_whatsapp`]}
                      />

                      {idx > 0 && (
                        <button
                          onClick={() =>
                            setContactsDraft(contactsDraft.filter((_, i) => i !== idx))
                          }
                          className="absolute top-5 right-6 text-red-400 font-black text-[10px] uppercase tracking-[0.16em] hover:text-red-600"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="p-8 border-t border-slate-100 bg-white space-y-4">
              {formError && (
                <div className="rounded-[22px] border border-red-200 bg-red-50 px-5 py-4 text-sm font-black text-red-700">
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-6">
                <button
                  onClick={() => setOpenNew(false)}
                  className="px-8 py-4 font-black text-slate-400 uppercase text-[11px] tracking-[0.18em] hover:text-slate-600 transition-colors"
                >
                  Cancelar
                </button>

                <button
                  onClick={saveAccount}
                  disabled={saving}
                  className="bg-blue-600 text-white px-12 py-4 rounded-[22px] font-black text-sm uppercase shadow-xl shadow-slate-200 hover:bg-blue-700 transition-all active:scale-95"
                >
                  {saving ? "Guardando..." : "Guardar en CRM"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}