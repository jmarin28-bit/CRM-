import React, { useMemo, useState } from "react";
import { 
  Users, 
  TrendingUp, 
  Briefcase, 
  Zap, 
  Clock3, 
  AlertCircle, 
  Plus, 
  Flame, 
  AlertTriangle, 
  X, 
  User, 
  Mail, 
  Settings,
  AlertCircle as AlertIcon,
  Download,
  Upload
} from "lucide-react";
import { exportBackup, importBackup } from "../services/backupService";
import {
  listActivitiesByUser,
  listAccounts,
  listAccountsByUser,
  listContacts,
  listContactsByUser,
  getAdvisorMetrics,
  createUser,
  listUsers,
  listActivities,
  listOverdueActivities,
  listQuotesByUser,
  listOpportunities,
  listOpportunitiesByUser,
  getTasksByUser,
  updateTaskStatus,
  retireAdvisorAndReassign,
  transferAdvisorItem,
  listQuotes,
  reactivateUser,
  deleteUser
} from "../services/storage";
import { getDirectorDashboard } from "../services/analytics";
import { getCommercialRadar } from "../services/radar";

// Tipos base
type TaskStatus = "Pendiente" | "En progreso" | "Finalizado" | "Por hacer";
interface CRMUser {
  id: string;
  name: string;
  email: string;
  role: string;
  activo: boolean;
  createdAt: string;
}

export default function Dashboard({ 
  activeUser, 
  accounts: propAccounts, 
  allAccounts: propAllAccounts, 
  allContacts: propAllContacts, 
  opportunities: propOpportunities, 
  analytics: propAnalytics, 
  radar: propRadar,
  daysBetween: propDaysBetween 
}: any) {
  const [refreshTasks, setRefreshTasks] = useState(0);
  const [refreshAdvisors, setRefreshAdvisors] = useState(0);
  const [showAdvisorModal, setShowAdvisorModal] = useState(false);
  const [advisorForm, setAdvisorForm] = useState({
    name: "",
    email: "",
    password: "",
  });

  // Estados para retiro y redistribución
  const [showRetireAdvisorModal, setShowRetireAdvisorModal] = useState(false);
  const [advisorToRetire, setAdvisorToRetire] = useState<CRMUser | null>(null);
  const [reassignOwnerId, setReassignOwnerId] = useState("");
  const [showRedistributeModal, setShowRedistributeModal] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState("");
  const [transferItemKey, setTransferItemKey] = useState("");
  const [deletingAdvisorId, setDeletingAdvisorId] = useState<string | null>(null);

  const daysBetween = useMemo(() => propDaysBetween || ((date: string | Date | undefined) => {
    if (!date) return 0;
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }), [propDaysBetween]);

  const allAccounts = useMemo(() => propAllAccounts || listAccounts() || [], [propAllAccounts, refreshAdvisors]);
  const allContacts = useMemo(() => propAllContacts || listContacts() || [], [propAllContacts, refreshAdvisors]);

  // Datos del usuario activo (en vivo, filtrados por rol) para los KPIs personales.
  // No usar las props de App: son un snapshot tomado al iniciar sesión y quedan desactualizadas.
  const myContacts = useMemo(() => listContactsByUser(activeUser) || [], [activeUser?.id, refreshAdvisors]);
  const myAccounts = useMemo(() => listAccountsByUser(activeUser) || [], [activeUser?.id, refreshAdvisors]);
  const opportunities = useMemo(() => listOpportunitiesByUser(activeUser) || [], [activeUser?.id, refreshAdvisors]);
  const analytics = useMemo(() => propAnalytics || getDirectorDashboard(), [propAnalytics, refreshAdvisors]);
  const radar = useMemo(() => propRadar || getCommercialRadar(), [propRadar, refreshAdvisors]);

  const accountsSafe = useMemo(() => {
    return Array.isArray(propAccounts) ? propAccounts : allAccounts;
  }, [propAccounts, allAccounts]);

  const accountNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accountsSafe) {
      const name = a.nombreComercial || a.razonSocial || "Cuenta";
      m.set(a.id, name);
    }
    return m;
  }, [accountsSafe]);

  const userQuotes = useMemo(() => listQuotesByUser(), [refreshAdvisors]);
  const userActivities = useMemo(() => listActivitiesByUser(), [refreshAdvisors]);
  
  const advisors = useMemo(() => {
    return (listUsers() || []).filter((user) => user.role === "asesor");
  }, [refreshAdvisors]);

  // Helper para cuentas
  const getAdvisorAccounts = (advisorId?: string) => {
    if (!advisorId) return [];
    return (allAccounts || []).filter((account: any) => account.ownerId === advisorId);
  };

  const getTaskStatusColor = (status?: string) => {
    if (status === "Finalizado") return "text-emerald-600 bg-emerald-50 border-emerald-100";
    if (status === "En progreso") return "text-amber-600 bg-amber-50 border-amber-100";
    return "text-slate-600 bg-slate-50 border-slate-200";
  };

  const getTaskPriorityOrder = (priority?: string) => {
    if (priority === "Alta") return 0;
    if (priority === "Media") return 1;
    return 2;
  };

  const isTaskOverdue = (task: { endDate?: string; status?: string }) => {
    if (!task.endDate || task.status === "Finalizado") return false;
    const end = new Date(task.endDate);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return end.getTime() < startOfToday.getTime();
  };

  const userTasks = useMemo(() => {
    return getTasksByUser().sort((a, b) => {
      const priorityDiff = getTaskPriorityOrder(a.priority) - getTaskPriorityOrder(b.priority);
      if (priorityDiff !== 0) return priorityDiff;
      const dateA = a.endDate ? new Date(a.endDate).getTime() : Number.MAX_SAFE_INTEGER;
      const dateB = b.endDate ? new Date(b.endDate).getTime() : Number.MAX_SAFE_INTEGER;
      return dateA - dateB;
    });
  }, [refreshTasks]);

  // Métricas calculadas para Alertas
  const pendingTasksCount = useMemo(() => {
    const tasksCount = (userTasks || []).filter((task) => task.status === "Pendiente" || task.status === "Por hacer").length;
    const followUpsCount = (userActivities || []).filter((a) => a.followUpAt && a.status !== "completada" && a.status !== "realizado").length;
    return tasksCount + followUpsCount;
  }, [userTasks, userActivities]);

  const inProgressTasksCount = useMemo(() => (userTasks || []).filter((task) => task.status === "En progreso").length, [userTasks]);

  const completedTasksCount = useMemo(() => {
    const tasksCount = (userTasks || []).filter((task) => task.status === "Finalizado").length;
    const followUpsCount = (userActivities || []).filter((a) => a.followUpAt && (a.status === "completada" || a.status === "realizado")).length;
    return tasksCount + followUpsCount;
  }, [userTasks, userActivities]);

  const overdueTasksCount = useMemo(() => {
    const tasksCount = (userTasks || []).filter((task) => isTaskOverdue(task)).length;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const followUpsCount = (userActivities || []).filter((a) => a.followUpAt && a.status !== "completada" && a.status !== "realizado" && new Date(a.followUpAt).getTime() < startOfToday.getTime()).length;
    return tasksCount + followUpsCount;
  }, [userTasks, userActivities]);

  const overdueFollowUpsCount = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return (userActivities || []).filter((a) => a.followUpAt && a.status !== "completada" && a.status !== "realizado" && new Date(a.followUpAt).getTime() < startOfToday.getTime()).length;
  }, [userActivities]);

  const staleOpportunitiesCount = useMemo(() => {
    return (opportunities || []).filter((opp: any) => {
      if (opp.etapa === "Ganado" || opp.etapa === "Perdido") return false;
      const relatedActivities = (userActivities || []).filter((a) => a.accountId === opp.accountId);
      if (relatedActivities.length === 0) return true;
      const latestActivity = relatedActivities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      return daysBetween(latestActivity?.createdAt) > 7;
    }).length;
  }, [opportunities, userActivities, daysBetween]);

  const coldAccountsCount = useMemo(() => {
    // Solo cuentas del usuario autenticado (antes usaba allAccounts y un asesor
    // contaba como "frías" las cuentas de todo el equipo)
    return (myAccounts || []).filter((acc: any) => {
      const relatedActivities = (userActivities || []).filter((a) => a.accountId === acc.id);
      if (relatedActivities.length === 0) return true;
      const latestActivity = relatedActivities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      return daysBetween(latestActivity?.createdAt) > 30;
    }).length;
  }, [myAccounts, userActivities, daysBetween]);

  const hotOpportunitiesCount = useMemo(() => {
    return (opportunities || []).filter((opp: any) => opp.etapa === "Negociación" || opp.etapa === "Cotización" || Number(opp.probabilidad || 0) >= 70).length;
  }, [opportunities]);

  const quotesWithoutRecentResponseCount = useMemo(() => {
    return (userQuotes || []).filter((quote: any) => {
      if (quote.status !== "enviada" && quote.status !== "revisada") return false;
      const issuedDays = daysBetween(quote.issueDate);
      if (issuedDays < 5) return false;
      const relatedActivities = (userActivities || []).filter((a) => a.accountId === quote.accountId);
      if (relatedActivities.length === 0) return true;
      const latestActivity = relatedActivities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      return daysBetween(latestActivity?.createdAt) > 5;
    }).length;
  }, [userQuotes, userActivities, daysBetween]);

  const getAccountName = (accountId?: string) => {
    return allAccounts.find((a: any) => a.id === accountId)?.nombreComercial || "Sin empresa";
  };

  const getContactName = (contactId?: string) => {
    return allContacts.find((c: any) => c.id === contactId)?.fullName || "Sin contacto";
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(val);

  const handleChangeTaskStatus = (taskId: string, status: TaskStatus) => {
    updateTaskStatus(taskId, status);
    setRefreshTasks((prev) => prev + 1);
  };

  const handleCreateAdvisor = (e: React.FormEvent) => {
    e.preventDefault();
    const { name, email, password } = advisorForm;
    if (!name.trim() || !email.trim() || !password.trim()) { alert("Completa todos los campos."); return; }
    createUser({ name, email, password, role: "asesor" });
    setAdvisorForm({ name: "", email: "", password: "" });
    setShowAdvisorModal(false);
    setRefreshAdvisors((prev) => prev + 1);
  };

  // Lógica de Retiro
  const handleOpenRetireAdvisor = (advisor: CRMUser) => {
    setAdvisorToRetire(advisor);
    setReassignOwnerId("");
    setShowRetireAdvisorModal(true);
  };

  const handleRetireAdvisor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!advisorToRetire || !reassignOwnerId) { alert("Datos incompletos."); return; }
    if (advisorToRetire.id === reassignOwnerId) { alert("Escoge un responsable diferente."); return; }
    retireAdvisorAndReassign(advisorToRetire.id, reassignOwnerId);
    setShowRetireAdvisorModal(false);
    setAdvisorToRetire(null);
    setRefreshAdvisors((prev) => prev + 1);
  };

  const handleOpenRedistributeAdvisor = (advisor: CRMUser) => {
    setAdvisorToRetire(advisor);
    setTransferTargetId("");
    setTransferItemKey("");
    setShowRedistributeModal(true);
  };

  const handleRedistributeAdvisor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!advisorToRetire) return;
    if (!transferTargetId) { alert("Selecciona el asesor que recibirá el elemento."); return; }
    if (!transferItemKey) { alert("Selecciona qué elemento quieres transferir."); return; }

    const [kind, itemId] = transferItemKey.split("::");
    try {
      transferAdvisorItem(kind as "account" | "contact" | "quote", itemId, advisorToRetire.id, transferTargetId);
    } catch (err: any) {
      alert(err?.message || "No se pudo completar la transferencia.");
      return;
    }

    setShowRedistributeModal(false);
    setAdvisorToRetire(null);
    setRefreshAdvisors((prev) => prev + 1);
  };

  const handleReactivateAdvisor = (advisor: CRMUser) => {
    reactivateUser(advisor.id);
    setRefreshAdvisors((prev) => prev + 1);
  };

  const handleDeleteAdvisor = (advisor: CRMUser, bypassConfirm = false) => {
    const advisorAccounts = getAdvisorAccounts(advisor.id);

    if (advisorAccounts.length > 0) {
      alert("No puedes eliminar este asesor porque todavía tiene cuentas asignadas.");
      return;
    }

    if (!bypassConfirm) {
      setDeletingAdvisorId(advisor.id);
      return;
    }

    deleteUser(advisor.id);
    setDeletingAdvisorId(null);
    setRefreshAdvisors((prev) => prev + 1);
  };

  return (
    <div className="space-y-10 pb-20 w-full px-6 xl:px-8">
      {/* Cabecera */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white leading-none">Resumen Comercial</h1>
          <p className="text-base text-slate-500 dark:text-slate-400 mt-2">Bienvenido de nuevo, {activeUser.name}.</p>
        </div>
        {/* La proyección va en su propia fila, encima de los botones.
            Antes estaba DENTRO de la fila de botones, y como ese bloque ocupa
            dos líneas de alto, al no caber todo a lo ancho el flex-wrap
            empujaba "Nuevo asesor" a un segundo renglón y lo dejaba colgando
            debajo de la cifra. Separando el dato de los controles, los tres
            botones quedan siempre alineados entre sí. */}
        {activeUser.role === "director" && (
          <div className="flex flex-col items-start md:items-end gap-4">
            <div className="hidden sm:block md:text-right">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Proyección de Ventas</div>
              <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{formatCurrency(analytics?.forecast || 0)}</div>
            </div>

            {/* Se conserva flex-wrap como red de seguridad para pantallas muy
                angostas: si llegara a hacer falta partir, que parta acá y no
                arrastre la cifra. */}
            <div className="flex flex-wrap items-center gap-3 md:justify-end">
              <button
                type="button"
                onClick={() => exportBackup()}
                title="Descargar copia de seguridad en JSON con todos los datos de Ioncore CRM"
                className="inline-flex items-center gap-2 rounded-[18px] bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 px-5 py-3 text-[11px] font-black uppercase tracking-widest transition-all shadow-sm cursor-pointer"
              >
                <Download size={16} className="text-blue-600 dark:text-blue-400" /> Respaldar datos
              </button>

              <label
                title="Subir archivo JSON para restaurar los datos de Ioncore CRM"
                className="inline-flex items-center gap-2 rounded-[18px] bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 px-5 py-3 text-[11px] font-black uppercase tracking-widest transition-all shadow-sm cursor-pointer"
              >
                <Upload size={16} className="text-emerald-600 dark:text-emerald-400" /> Restaurar datos
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      importBackup(file);
                    }
                    e.target.value = "";
                  }}
                />
              </label>

              <button
                onClick={() => setShowAdvisorModal(true)}
                className="inline-flex items-center gap-2 rounded-[18px] bg-slate-900 px-5 py-3 text-[11px] font-black uppercase tracking-widest text-white transition-all hover:bg-blue-600"
              >
                <Plus size={16} /> Nuevo asesor
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Stats Principales */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded-[32px] p-7 shadow-sm min-h-[180px] flex flex-col justify-between">
          <div className="flex items-start justify-between mb-6">
            <div>
              <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Mis Contactos</p>
              <p className="text-4xl font-black text-slate-900 mt-3">{myContacts.length}</p>
            </div>
            <div className="w-14 h-14 rounded-[20px] bg-slate-50 border border-slate-200 flex items-center justify-center">
              <Users size={22} className="text-slate-500" />
            </div>
          </div>
          <p className="text-sm font-bold text-emerald-600">↗ {myContacts.length} bajo gestión</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-[32px] p-7 shadow-sm min-h-[180px] flex flex-col justify-between">
          <div className="flex items-start justify-between mb-6">
            <div>
              <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Oportunidades Activas</p>
              <p className="text-4xl font-black text-slate-900 mt-3">{(opportunities || []).filter((o: any) => o.etapa !== "Ganado" && o.etapa !== "Perdido").length}</p>
            </div>
            <div className="w-14 h-14 rounded-[20px] bg-emerald-50 border border-emerald-100 flex items-center justify-center">
              <TrendingUp size={22} className="text-emerald-600" />
            </div>
          </div>
          <p className="text-sm font-bold text-slate-500">Estado: Estable</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-[32px] p-7 shadow-sm min-h-[180px] flex flex-col justify-between">
          <div className="flex items-start justify-between mb-6">
            <div>
              <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Prospectos</p>
              <p className="text-4xl font-black text-slate-900 mt-3">{(opportunities || []).filter((o: any) => o.etapa === "Prospecto").length}</p>
            </div>
            <div className="w-14 h-14 rounded-[20px] bg-amber-50 border border-amber-100 flex items-center justify-center">
              <Briefcase size={22} className="text-amber-600" />
            </div>
          </div>
          <p className="text-sm font-bold text-amber-600">+2 esta semana</p>
        </div>
      </div>

      {/* Gestión de Equipo (Solo Director) */}
      {activeUser.role === "director" && (
        <div className="bg-white dark:bg-slate-800 rounded-[30px] shadow-sm border border-slate-100 p-8">
          <div className="flex items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white">Equipo comercial</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Gestión de asesores y carteras.</p>
            </div>
            <div className="rounded-[18px] bg-blue-50 px-4 py-2 text-sm font-black text-blue-700">
              {(advisors || []).filter(a => a.activo).length} activos
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {(advisors || []).map((advisor) => (
              <div key={advisor.id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-5 flex flex-col justify-between min-h-[200px]">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900 truncate">{advisor.name}</p>
                      <p className="text-[11px] font-bold text-slate-500 truncate mt-1">{advisor.email}</p>
                    </div>
                    <div className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${advisor.activo ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                      {advisor.activo ? "Activo" : "Inactivo"}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-[11px] font-bold text-slate-500">
                    <div className="rounded-[16px] border border-slate-200 bg-white px-3 py-3">
                      <div className="text-[10px] uppercase tracking-widest text-slate-400">Cuentas</div>
                      <div className="mt-1 text-slate-900">{getAdvisorAccounts(advisor.id).length}</div>
                    </div>
                    <div className="rounded-[16px] border border-slate-200 bg-white px-3 py-3">
                      <div className="text-[10px] uppercase tracking-widest text-slate-400">Creado</div>
                      <div className="mt-1 text-slate-900">
                        {new Date(advisor.createdAt).toLocaleDateString("es-CO")}
                      </div>
                    </div>
                  </div>
                </div>

                {advisor.activo ? (
                  <div className="mt-4 grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenRetireAdvisor(advisor)}
                      className="w-full rounded-[16px] bg-rose-600 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-rose-700"
                    >
                      Retiro rápido
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenRedistributeAdvisor(advisor)}
                      className="w-full rounded-[16px] bg-slate-900 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-blue-600"
                    >
                      Redistribuir cartera
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      onClick={() => handleReactivateAdvisor(advisor)}
                      className="w-full rounded-[16px] bg-emerald-600 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-emerald-700"
                    >
                      Reactivar
                    </button>

                    {deletingAdvisorId === advisor.id ? (
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDeleteAdvisor(advisor, true)}
                          className="w-full rounded-[16px] bg-red-600 px-2 py-3 text-[9px] font-black uppercase tracking-[0.1em] text-white transition-all hover:bg-red-700"
                        >
                          Sí, borrar
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingAdvisorId(null)}
                          className="w-full rounded-[16px] bg-slate-100 px-2 py-3 text-[9px] font-black uppercase tracking-[0.1em] text-slate-700 transition-all hover:bg-slate-200"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleDeleteAdvisor(advisor)}
                        className="w-full rounded-[16px] bg-slate-200 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-700 transition-all hover:bg-slate-300"
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Radar Inteligente */}
      <div className="bg-white dark:bg-slate-800 rounded-[30px] shadow-sm border border-slate-100 p-8">
        <h2 className="text-xl font-black mb-5 flex items-center gap-2"><Zap className="text-blue-500" size={24} /> Radar Comercial</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-5">
          <div className="p-5 rounded-[22px] bg-orange-50 border border-orange-100 text-orange-900">
            <div className="text-xs font-bold uppercase mb-1">🔥 Tratos Calientes</div>
            <div className="text-2xl font-black">{radar?.hotDeals?.length || 0}</div>
          </div>
          <div className="p-5 rounded-[22px] bg-red-50 border border-red-100 text-red-900">
            <div className="text-xs font-bold uppercase mb-1">⚠ En Riesgo</div>
            <div className="text-2xl font-black">{radar?.riskDeals?.length || 0}</div>
          </div>
          <div className="p-5 rounded-[22px] bg-slate-100 border border-slate-200 text-slate-900">
            <div className="text-xs font-bold uppercase mb-1">❄ Cuentas Frías</div>
            <div className="text-2xl font-black">{radar?.coldAccounts?.length || 0}</div>
          </div>
          <div className="p-5 rounded-[22px] bg-emerald-50 border border-emerald-100 text-emerald-900">
            <div className="text-xs font-bold uppercase mb-1">📈 Venta Adicional</div>
            <div className="text-2xl font-black">{radar?.upsell?.length || 0}</div>
          </div>
        </div>
      </div>

      {/* Mis Tareas */}
      <section className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm">
        <div className="flex items-center justify-between mb-7">
          <h3 className="text-[12px] font-black uppercase tracking-widest">Mis tareas operativas</h3>
          <Clock3 size={16} className="text-slate-400" />
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
          <div className="bg-slate-50 border border-slate-200 rounded-[22px] p-5">
            <p className="text-[10px] font-black uppercase text-slate-500 mb-2">Pendientes</p>
            <p className="text-3xl font-black">{pendingTasksCount}</p>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-[22px] p-5">
            <p className="text-[10px] font-black uppercase text-amber-700 mb-2">En progreso</p>
            <p className="text-3xl font-black">{inProgressTasksCount}</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-100 rounded-[22px] p-5">
            <p className="text-[10px] font-black uppercase text-emerald-700 mb-2">Finalizadas</p>
            <p className="text-3xl font-black">{completedTasksCount}</p>
          </div>
          <div className="bg-red-50 border border-red-100 rounded-[22px] p-5">
            <p className="text-[10px] font-black uppercase text-red-700 mb-2">Vencidas</p>
            <p className="text-3xl font-black">{overdueTasksCount}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-5">
          {(userTasks || []).slice(0, 6).map((task) => (
            <div key={task.id} className={`rounded-[26px] p-5 border shadow-sm ${isTaskOverdue(task) ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"}`}>
              <div className="flex justify-between items-start gap-2">
                <p className="text-sm font-black text-slate-900">{task.title}</p>
                <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-md border ${getTaskStatusColor(task.status)}`}>{task.status}</span>
              </div>
              <div className="mt-4 text-[10px] font-bold text-slate-500 space-y-1">
                <p className="text-blue-600 uppercase">{getAccountName(task.accountId)}</p>
                <p>Fin: {task.endDate}</p>
              </div>
              <div className="mt-4 flex gap-2">
                {task.status !== "Finalizado" && (
                  <button onClick={() => handleChangeTaskStatus(task.id, "Finalizado")} className="flex-1 bg-emerald-600 text-white py-2 rounded-xl text-[10px] font-black uppercase">Finalizar</button>
                )}
                {task.status === "Pendiente" && (
                  <button onClick={() => handleChangeTaskStatus(task.id, "En progreso")} className="flex-1 bg-amber-500 text-white py-2 rounded-xl text-[10px] font-black uppercase">Empezar</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Alertas */}
      <section className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm">
        <h3 className="text-[12px] font-black uppercase tracking-widest mb-6">Alertas Comerciales</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-5">
          <div className="bg-rose-50 border border-rose-100 rounded-[22px] p-5">
            <p className="text-[10px] font-black uppercase text-rose-700 mb-2">Quotes sin respuesta</p>
            <p className="text-3xl font-black">{quotesWithoutRecentResponseCount}</p>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-[22px] p-5">
            <p className="text-[10px] font-black uppercase text-amber-700 mb-2">Oport. sin actividad</p>
            <p className="text-3xl font-black">{staleOpportunitiesCount}</p>
          </div>
          <div className="bg-red-50 border border-red-100 rounded-[22px] p-5">
            <p className="text-[10px] font-black uppercase text-red-700 mb-2">Seguim. vencidos</p>
            <p className="text-3xl font-black">{overdueFollowUpsCount}</p>
          </div>
          <div className="bg-slate-100 border border-slate-200 rounded-[22px] p-5">
            <p className="text-[10px] font-black uppercase text-slate-700 mb-2">Cuentas frías</p>
            <p className="text-3xl font-black">{coldAccountsCount}</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-100 rounded-[22px] p-5">
            <p className="text-[10px] font-black uppercase text-emerald-700 mb-2">Oport. calientes</p>
            <p className="text-3xl font-black">{hotOpportunitiesCount}</p>
          </div>
        </div>
      </section>

      {/* MODAL: Crear Asesor */}
      {showAdvisorModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/70 p-6 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[32px] bg-white p-8 shadow-2xl">
            <div className="flex justify-between mb-8">
              <h3 className="text-2xl font-black">Nuevo asesor</h3>
              <button onClick={() => setShowAdvisorModal(false)}><X size={20}/></button>
            </div>
            <form onSubmit={handleCreateAdvisor} className="space-y-4">
              <input type="text" placeholder="Nombre" value={advisorForm.name} onChange={e => setAdvisorForm({...advisorForm, name: e.target.value})} className="w-full rounded-2xl bg-slate-50 p-4 border" />
              <input type="email" placeholder="Email" value={advisorForm.email} onChange={e => setAdvisorForm({...advisorForm, email: e.target.value})} className="w-full rounded-2xl bg-slate-50 p-4 border" />
              <input type="text" placeholder="Contraseña inicial" value={advisorForm.password} onChange={e => setAdvisorForm({...advisorForm, password: e.target.value})} className="w-full rounded-2xl bg-slate-50 p-4 border" />
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase">Crear</button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Retiro Rápido */}
      {showRetireAdvisorModal && advisorToRetire && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/70 p-6 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[32px] bg-white p-8">
            <h3 className="text-2xl font-black mb-4">Retiro Rápido: {advisorToRetire.name}</h3>
            <form onSubmit={handleRetireAdvisor} className="space-y-6">
              <select 
                value={reassignOwnerId} 
                onChange={e => setReassignOwnerId(e.target.value)}
                className="w-full rounded-2xl bg-slate-50 p-4 border font-bold"
              >
                <option value="">Seleccionar nuevo responsable...</option>
                {listUsers().filter(u => u.activo && u.id !== advisorToRetire.id).map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
              <div className="flex gap-4 justify-end">
                <button type="button" onClick={() => setShowRetireAdvisorModal(false)} className="font-black uppercase p-4">Cancelar</button>
                <button type="submit" className="bg-rose-600 text-white px-8 py-4 rounded-2xl font-black uppercase">Confirmar Retiro</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Redistribución */}
      {showRedistributeModal && advisorToRetire && (() => {
        const advisorAccounts = getAdvisorAccounts(advisorToRetire.id);
        const advisorContacts = (allContacts || []).filter((c: any) => c.ownerId === advisorToRetire.id);
        const advisorQuotes = (listQuotes() || []).filter((q: any) => q.ownerId === advisorToRetire.id);
        const targetUsers = listUsers().filter((u) => u.activo && u.id !== advisorToRetire.id);
        const hasItems = advisorAccounts.length + advisorContacts.length + advisorQuotes.length > 0;

        return (
          <div className="fixed inset-0 z-[76] flex items-center justify-center bg-slate-900/70 p-6 backdrop-blur-sm">
            <div className="w-full max-w-xl rounded-[32px] bg-white p-8 flex flex-col max-h-[90vh]">
              <h3 className="text-2xl font-black mb-2">Redistribuir Cartera</h3>
              <p className="text-sm text-slate-500 mb-6">
                Transfiere una cuenta, un contacto o una cotización de {advisorToRetire.name} a otro asesor. El asesor sigue activo.
              </p>

              <form onSubmit={handleRedistributeAdvisor} className="flex flex-col gap-5">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Transferir a</label>
                  <select
                    value={transferTargetId}
                    onChange={(e) => setTransferTargetId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm font-bold bg-white outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Seleccionar asesor destino...</option>
                    {targetUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}{u.role === "director" ? " (Director)" : ""}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Elemento a transferir</label>
                  <select
                    value={transferItemKey}
                    onChange={(e) => setTransferItemKey(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm font-bold bg-white outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">{hasItems ? "Seleccionar elemento..." : "Este asesor no tiene elementos asignados"}</option>
                    {advisorAccounts.length > 0 && (
                      <optgroup label="Cuentas">
                        {advisorAccounts.map((acc: any) => (
                          <option key={acc.id} value={`account::${acc.id}`}>
                            {acc.nombreComercial || acc.razonSocial}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {advisorContacts.length > 0 && (
                      <optgroup label="Contactos">
                        {advisorContacts.map((c: any) => (
                          <option key={c.id} value={`contact::${c.id}`}>
                            {c.fullName || c.email || c.id}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {advisorQuotes.length > 0 && (
                      <optgroup label="Cotizaciones">
                        {advisorQuotes.map((q: any) => (
                          <option key={q.id} value={`quote::${q.id}`}>
                            {q.quoteNumber || q.id} — {accountNameById.get(q.accountId) || "Sin cuenta"}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {transferItemKey.startsWith("account::") && (
                    <p className="mt-2 text-[11px] font-bold text-slate-400">
                      Al transferir una cuenta se trasladan también sus contactos, oportunidades y cotizaciones.
                    </p>
                  )}
                </div>

                <div className="mt-2 pt-6 border-t flex justify-end gap-4">
                  <button type="button" onClick={() => setShowRedistributeModal(false)} className="font-black uppercase">Cancelar</button>
                  <button
                    type="submit"
                    disabled={!hasItems}
                    className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black uppercase disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Transferir
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}
    </div>
  );
}