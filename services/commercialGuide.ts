type CRMUserLite = {
  id: string;
  role?: string;
};

type AccountV2 = {
  id: string;
  ownerId?: string;
  razonSocial?: string;
  nombreComercial?: string;
  createdAt?: string;
};

type ContactV2 = {
  id: string;
  ownerId?: string;
  accountId?: string;
  fullName?: string;
  createdAt?: string;
};

type ActivityV2 = {
  id: string;
  ownerId?: string;
  accountId?: string;
  contactId?: string;
  description?: string;
  followUpAt?: string | null;
  status?: string;
  createdAt?: string;
};

type OpportunityV2 = {
  id: string;
  ownerId?: string;
  accountId?: string;
  contactId?: string;
  titulo?: string;
  etapa?: string;
  updatedAt?: string;
  createdAt?: string;
};

type AgentMemoryItem = {
  id: string;
  title: string;
  detail?: string;
  type?: string;
  status?: string;
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  quoteId?: string;
  activityId?: string;
  dueAt?: string;
  createdAt?: string;
};

const ACTIVE_USER_KEY = "crm_active_user_v2";
const ACCOUNTS_V2_KEY = "crm_accounts_v2";
const CONTACTS_V2_KEY = "crm_contacts_v2";
const OPPORTUNITIES_V2_KEY = "crm_opportunities_v2";
const ACTIVITIES_KEY = "crm_activities_v2";
const AGENT_MEMORY_KEY = "ioncore_agent_memory_v1";

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

function getActiveUserLite(): CRMUserLite | null {
  return readJSON<CRMUserLite | null>(ACTIVE_USER_KEY, null);
}

function listAccountsByUser(): AccountV2[] {
  const user = getActiveUserLite();
  const accounts = readJSON<AccountV2[]>(ACCOUNTS_V2_KEY, []).filter(
    (account) => account && account.id
  );

  if (!user) return [];
  if (user.role === "director") return accounts;

  return accounts.filter((account) => account.ownerId === user.id);
}

function listContactsByUser(): ContactV2[] {
  const user = getActiveUserLite();
  const contacts = readJSON<ContactV2[]>(CONTACTS_V2_KEY, []).filter(
    (contact) => contact && contact.id
  );

  if (!user) return [];
  if (user.role === "director") return contacts;

  const accountIds = listAccountsByUser().map((account) => account.id);

  return contacts.filter(
    (contact) =>
      contact.ownerId === user.id ||
      Boolean(contact.accountId && accountIds.includes(contact.accountId))
  );
}

function listActivitiesByUser(): ActivityV2[] {
  const user = getActiveUserLite();
  const activities = readJSON<ActivityV2[]>(ACTIVITIES_KEY, []).filter(
    (activity) => activity && activity.id
  );

  if (!user) return [];
  if (user.role === "director") return activities;

  return activities.filter((activity) => activity.ownerId === user.id);
}

function listOpportunitiesByUser(): OpportunityV2[] {
  const user = getActiveUserLite();
  const opportunities = readJSON<OpportunityV2[]>(
    OPPORTUNITIES_V2_KEY,
    []
  ).filter((opportunity) => opportunity && opportunity.id);

  if (!user) return [];
  if (user.role === "director") return opportunities;

  return opportunities.filter((opportunity) => opportunity.ownerId === user.id);
}

function listQuotesByUser(): any[] {
  const user = getActiveUserLite();
  const quotes = readJSON<any[]>("crm_quotes_v2", []).filter(
    (q) => q && q.id && q.accountId
  );

  if (!user) return [];
  if (user.role === "director") return quotes;

  const userAccountIds = new Set(listAccountsByUser().map((a) => a.id));
  return quotes.filter(
    (q) => q.ownerId === user.id || (q.accountId && userAccountIds.has(q.accountId))
  );
}

function listOpenAgentMemory(): AgentMemoryItem[] {
  const user = getActiveUserLite();
  const memory = readJSON<AgentMemoryItem[]>(AGENT_MEMORY_KEY, []).filter(
    (item) => item && item.id && item.status === "open"
  );

  if (!user) return [];
  if (user.role === "director") {
    return memory.sort((a, b) => ((a.createdAt || "") < (b.createdAt || "") ? 1 : -1));
  }

  const userAccountIds = new Set(listAccountsByUser().map((a) => a.id));
  return memory
    .filter((item) => !item.accountId || userAccountIds.has(item.accountId))
    .sort((a, b) => ((a.createdAt || "") < (b.createdAt || "") ? 1 : -1));
}

function getAIRecommendations(): string[] {
  return [
    "Revisar primero los seguimientos vencidos.",
    "Priorizar oportunidades en riesgo antes de crear nuevas tareas.",
    "Reactivar cuentas frías con una gestión corta y fecha de seguimiento.",
  ];
}

function normalizeText(text?: string) {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function isActivityDone(activity: any): boolean {
  if (!activity) return false;
  const s = (activity.status || "").toLowerCase().trim();
  return (
    s === "completada" ||
    s === "completado" ||
    s === "realizado" ||
    s === "realizada" ||
    s === "cancelada" ||
    s === "cancelado"
  );
}

function getAccountName(account?: AccountV2) {
  if (!account) return "Empresa no encontrada en cuentas activas";
  return account.nombreComercial || account.razonSocial || "Empresa sin nombre";
}

function getContactName(contact?: ContactV2) {
  if (!contact) return "";
  return contact.fullName || "";
}

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";

  const date = new Date(value);
  if (isNaN(date.getTime())) return "Sin fecha";

  return date.toLocaleDateString("es-CO", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

export type CommercialGuideItem = {
  id: string;
  title: string;
  detail: string;
  type: "overdue" | "today" | "upcoming" | "risk" | "cold" | "recommendation";
  priority: "alta" | "media" | "baja";
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  activityId?: string;
  date?: string;
};

export type CommercialGuideBriefing = {
  summary: string;
  memoryAlerts: CommercialGuideItem[];
  overdueFollowUps: CommercialGuideItem[];
  todayFollowUps: CommercialGuideItem[];
  tomorrowFollowUps: CommercialGuideItem[];
  upcomingFollowUps: CommercialGuideItem[];
  riskOpportunities: CommercialGuideItem[];
  coldAccounts: CommercialGuideItem[];
  recommendations: string[];
  totalPending: number;
  pendingQuotes?: any[];
  todayTasks?: any[];
};

export function getTodayCommercialBriefing(): CommercialGuideBriefing {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  const accounts = listAccountsByUser();
  const contacts = listContactsByUser();
  const activities = listActivitiesByUser();
  const opportunities = listOpportunitiesByUser();
  const openMemory = listOpenAgentMemory();

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));

  const resolveContact = (contactId?: string) => {
    if (!contactId) return undefined;
    return contactById.get(contactId);
  };

  const resolveAccount = (accountId?: string, contactId?: string, opportunity?: any) => {
    if (accountId) {
      const directAccount = accountById.get(accountId);
      if (directAccount) return directAccount;
    }

    const contact = resolveContact(contactId) as any;

    if (contact?.accountId) {
      const contactAccount = accountById.get(contact.accountId);
      if (contactAccount) return contactAccount;
    }

    // Buscar por coincidencia normalizada de nombres
    const possibleNames: string[] = [];
    if (accountId && !accountId.startsWith("acc_")) {
      possibleNames.push(accountId);
    }
    if (opportunity) {
      if (opportunity.companyName) possibleNames.push(opportunity.companyName);
      if (opportunity.accountName) possibleNames.push(opportunity.accountName);
      if (opportunity.cliente) possibleNames.push(opportunity.cliente);
    }

    for (const rawName of possibleNames) {
      const normSearch = normalizeText(rawName);
      if (!normSearch || normSearch.length < 3) continue;

      // Coincidencia exacta
      let found = accounts.find((acc) => {
        return (
          normalizeText(acc.nombreComercial) === normSearch ||
          normalizeText(acc.razonSocial) === normSearch
        );
      });
      if (found) return found;

      // Coincidencia parcial
      found = accounts.find((acc) => {
        const normComm = normalizeText(acc.nombreComercial);
        const normSocial = normalizeText(acc.razonSocial);
        return (
          (normComm && (normComm.includes(normSearch) || normSearch.includes(normComm))) ||
          (normSocial && (normSocial.includes(normSearch) || normSearch.includes(normSocial)))
        );
      });
      if (found) return found;
    }

    return undefined;
  };

  const buildFollowUpTitle = (
    prefix: string,
    account?: AccountV2,
    contact?: ContactV2
  ) => {
    if (account) return `${prefix}: ${getAccountName(account)}`;
    if (contact) return `${prefix}: ${getContactName(contact)}`;

    return `${prefix}: Empresa no encontrada en cuentas activas`;
  };

  const buildFollowUpDetail = (
    activity: ActivityV2,
    account?: AccountV2,
    contact?: ContactV2
  ) => {
    const parts = [];

    if (contact) {
      parts.push(getContactName(contact));
    }

    if (!account) {
      parts.push("Empresa no encontrada en cuentas activas");
    }

    if (activity.description) {
      parts.push(activity.description);
    }

    return parts.filter(Boolean).join(" · ");
  };

  const followUps = activities
    .filter((activity) => activity.followUpAt)
    .filter((activity) => !isActivityDone(activity));

  const overdueFollowUps: CommercialGuideItem[] = followUps
    .filter((activity) => new Date(activity.followUpAt as string) < todayStart)
    .sort(
      (a, b) =>
        new Date(a.followUpAt as string).getTime() -
        new Date(b.followUpAt as string).getTime()
    )
    .map((activity) => {
      const contact = resolveContact(activity.contactId);
      const account = resolveAccount(activity.accountId, activity.contactId);

      return {
        id: activity.id,
        activityId: activity.id,
        accountId: account?.id || activity.accountId,
        contactId: activity.contactId,
        title: buildFollowUpTitle("Seguimiento vencido", account, contact),
        detail: buildFollowUpDetail(activity, account, contact),
        type: "overdue",
        priority: "alta",
        date: activity.followUpAt || undefined,
      };
    });

  const todayFollowUps: CommercialGuideItem[] = followUps
    .filter((activity) => {
      const date = new Date(activity.followUpAt as string);
      return date >= todayStart && date <= todayEnd;
    })
    .sort(
      (a, b) =>
        new Date(a.followUpAt as string).getTime() -
        new Date(b.followUpAt as string).getTime()
    )
    .map((activity) => {
      const contact = resolveContact(activity.contactId);
      const account = resolveAccount(activity.accountId, activity.contactId);

      return {
        id: activity.id,
        activityId: activity.id,
        accountId: account?.id || activity.accountId,
        contactId: activity.contactId,
        title: buildFollowUpTitle("Seguimiento para hoy", account, contact),
        detail: buildFollowUpDetail(activity, account, contact),
        type: "today",
        priority: "alta",
        date: activity.followUpAt || undefined,
      };
    });

  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const tomorrowEnd = new Date(todayEnd);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

  const tomorrowFollowUps: CommercialGuideItem[] = followUps
    .filter((activity) => {
      const date = new Date(activity.followUpAt as string);
      return date >= tomorrowStart && date <= tomorrowEnd;
    })
    .sort(
      (a, b) =>
        new Date(a.followUpAt as string).getTime() -
        new Date(b.followUpAt as string).getTime()
    )
    .map((activity) => {
      const contact = resolveContact(activity.contactId);
      const account = resolveAccount(activity.accountId, activity.contactId);

      return {
        id: activity.id,
        activityId: activity.id,
        accountId: account?.id || activity.accountId,
        contactId: activity.contactId,
        title: buildFollowUpTitle("Seguimiento para mañana", account, contact),
        detail: buildFollowUpDetail(activity, account, contact),
        type: "upcoming",
        priority: "media",
        date: activity.followUpAt || undefined,
      };
    });

  const upcomingFollowUps: CommercialGuideItem[] = followUps
    .filter((activity) => new Date(activity.followUpAt as string) > todayEnd)
    .sort(
      (a, b) =>
        new Date(a.followUpAt as string).getTime() -
        new Date(b.followUpAt as string).getTime()
    )
    .slice(0, 5)
    .map((activity) => {
      const contact = resolveContact(activity.contactId);
      const account = resolveAccount(activity.accountId, activity.contactId);

      return {
        id: activity.id,
        activityId: activity.id,
        accountId: account?.id || activity.accountId,
        contactId: activity.contactId,
        title: buildFollowUpTitle("Próximo seguimiento", account, contact),
        detail: `${formatDate(activity.followUpAt)} · ${buildFollowUpDetail(
          activity,
          account,
          contact
        )}`.trim(),
        type: "upcoming",
        priority: "media",
        date: activity.followUpAt || undefined,
      };
    });

  const riskOpportunities: CommercialGuideItem[] = opportunities
    .filter((opportunity) => {
      if (opportunity.etapa === "Ganado" || opportunity.etapa === "Perdido") {
        return false;
      }

      const updatedAt = new Date(opportunity.updatedAt).getTime();
      if (isNaN(updatedAt)) return false;

      const diffDays = (Date.now() - updatedAt) / (1000 * 60 * 60 * 24);
      return diffDays > 10;
    })
    .slice(0, 5)
    .map((opportunity) => {
      const contact = resolveContact(opportunity.contactId);
      const account = resolveAccount(opportunity.accountId, opportunity.contactId, opportunity);
      const accountName = account ? getAccountName(account) : "oportunidad sin cuenta vinculada";

      return {
        id: opportunity.id,
        opportunityId: opportunity.id,
        accountId: account?.id || opportunity.accountId,
        contactId: opportunity.contactId,
        title: `Oportunidad en riesgo: ${opportunity.titulo}`,
        detail: `${accountName}${
          contact ? ` · ${getContactName(contact)}` : ""
        } · Etapa: ${opportunity.etapa}`,
        type: "risk",
        priority: "alta",
      };
    });

  const coldAccounts: CommercialGuideItem[] = accounts
    .filter((account) => {
      const accountActivities = activities
        .filter((activity) => activity.accountId === account.id)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

      const lastActivity = accountActivities[0];

      if (!lastActivity) return true;

      const diffDays =
        (Date.now() - new Date(lastActivity.createdAt).getTime()) /
        (1000 * 60 * 60 * 24);

      return diffDays > 30;
    })
    .slice(0, 5)
    .map((account) => ({
      id: account.id,
      accountId: account.id,
      title: `Cuenta fría: ${getAccountName(account)}`,
      detail: "Sin actividad comercial reciente.",
      type: "cold" as const,
      priority: "media" as const,
    }));

  const memoryAlerts: CommercialGuideItem[] = openMemory.slice(0, 5).map((memory) => {
    const priority: CommercialGuideItem["priority"] =
      memory.type === "risk_detected" || memory.type === "quote_pending_review"
        ? "alta"
        : "media";

    return {
      id: memory.id,
      activityId: memory.activityId,
      accountId: memory.accountId,
      contactId: memory.contactId,
      opportunityId: memory.opportunityId,
      title: `Memoria pendiente: ${memory.title}`,
      detail: memory.detail || "Pendiente registrado por Director Comercial IA o AXIS.",
      type: "recommendation",
      priority,
      date: memory.dueAt,
    };
  });

  const recommendations = getAIRecommendations();

  const quotes = listQuotesByUser();
  const tasks = readJSON<any[]>("ioncore_tasks", []).filter(t => t && t.id);

  const pendingQuotes = quotes
    .filter((q) => q.status === "enviada" || q.status === "borrador" || q.status === "revisada")
    .map((q) => {
      const account = resolveAccount(q.accountId, q.contactId);
      if (!account) return null;
      const accountName = getAccountName(account);
      let suffix = "pendiente interno";
      if (q.status === "enviada") {
        suffix = "enviada sin OC";
      }
      return {
        id: q.id,
        detail: `Cotización ${q.quoteNumber || q.id} para ${accountName} - ${suffix}`,
      };
    })
    .filter((item): item is { id: string; detail: string } => item !== null);

  const todayTasks = tasks
    .filter((t) => t.status !== "Completada" && t.status !== "Realizada")
    .map((t) => ({
      id: t.id,
      title: t.title,
      detail: t.description || "Sin descripción",
    }));

  const totalPending =
    overdueFollowUps.length +
    todayFollowUps.length +
    riskOpportunities.length +
    memoryAlerts.length +
    pendingQuotes.length;

  const summary =
    totalPending === 0
      ? "Tu día comercial está tranquilo. No tienes vencidos, riesgos críticos ni memorias pendientes visibles."
      : `Tienes ${totalPending} pendientes importantes: ${overdueFollowUps.length} vencidos, ${todayFollowUps.length} para hoy, ${riskOpportunities.length} oportunidades en riesgo, ${pendingQuotes.length} cotizaciones pendientes y ${memoryAlerts.length} memorias abiertas.`;

  return {
    summary,
    memoryAlerts,
    overdueFollowUps,
    todayFollowUps,
    tomorrowFollowUps,
    upcomingFollowUps,
    riskOpportunities,
    coldAccounts,
    recommendations,
    totalPending,
    pendingQuotes,
    todayTasks,
  };
}