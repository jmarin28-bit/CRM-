// services/storage.ts
import type {
  AccountV2,
  ContactV2,
  OpportunityV2,
  OpportunityStage,
  CurrencyOption,
  ActivityV2,
  ActivityInput,
  CRMUser,
  Task,
  TaskStatus,
  TaskPriority,
  PipelineStage,
  AutomationConfig,
  BusinessSettings,
  TimeLog,
  QuoteV2,
  QuoteType,
  AdvisorBudgetV2
} from "../types";
import { todayLocal, currentPeriod, periodBounds } from "./dates";

// =====================================================
// 1) CONFIGURACIÓN Y LLAVES (KEYS)
// =====================================================
const USERS_V2_KEY = "crm_users_v2";
const ACTIVE_USER_KEY = "crm_active_user_v2";
const RR_KEY = "ioncore_rr_index";
const ACCOUNTS_V2_KEY = "crm_accounts_v2";
const CONTACTS_V2_KEY = "crm_contacts_v2";
const OPPORTUNITIES_V2_KEY = "crm_opportunities_v2";
const ACTIVITIES_KEY = "crm_activities_v2";
const TASKS_KEY = "ioncore_tasks";
const AUTOMATION_KEY = "ioncore_automation_config";
const BUSINESS_SETTINGS_KEY = "ioncore_business_settings";
const TIME_LOGS_KEY = "ioncore_time_logs";
const QUOTES_V2_KEY = "crm_quotes_v2"; 

const defaultUsers: CRMUser[] = [
  {
    id: "director_ioncore",
    name: "Andrés Marín",
    email: "mgs.comercial@ioncore-sas.com",
    password: "123456",
    role: "director",
    activo: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "juan_sierra",
    name: "Juan Sierra",
    email: "juan.sierra@ioncore.co",
    password: "123456",
    role: "asesor",
    activo: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "andres_asesor",
    name: "Andres",
    email: "andres@ioncore.co",
    password: "123456",
    role: "asesor",
    activo: true,
    createdAt: new Date().toISOString(),
  },
];

// --- Helpers Base ---
export function uid(prefix: string) { return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`; }

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return (parsed === null || parsed === undefined) ? fallback : parsed as T;
  } catch { return fallback; }
}

export function writeJSON<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

// =====================================================
// 2) GESTIÓN DE USUARIOS
// =====================================================

export function listUsers(): CRMUser[] {
  const users = readJSON<any[] | null>(USERS_V2_KEY, null);

  if (!users || !Array.isArray(users) || users.length === 0) {
    writeJSON(USERS_V2_KEY, defaultUsers);
    return [...defaultUsers].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  let changed = false;

  const migratedUsers: CRMUser[] = users.map((u: any) => {
    const isDirector = u.id === "director_ioncore";

    const migrated: CRMUser = {
      id: u.id,
      name: isDirector ? "Andrés Marín" : (u.name || "Usuario"),
      email: isDirector ? "mgs.comercial@ioncore-sas.com" : (u.email || ""),
      password: u.password || "123456",
      role: u.role || "asesor",
      activo: typeof u.activo === "boolean" ? u.activo : true,
      createdAt: u.createdAt || new Date().toISOString(),
    };

    if (!u.password) changed = true;
    if (isDirector && (u.email !== "mgs.comercial@ioncore-sas.com" || u.name !== "Andrés Marín")) {
      changed = true;
    }

    return migrated;
  });

  const hasDirector = migratedUsers.some((u) => u.id === "director_ioncore");

  if (!hasDirector) {
    migratedUsers.unshift({
      id: "director_ioncore",
      name: "Andrés Marín",
      email: "mgs.comercial@ioncore-sas.com",
      password: "123456",
      role: "director",
      activo: true,
      createdAt: new Date().toISOString(),
    });
    changed = true;
  }

  if (changed) {
    writeJSON(USERS_V2_KEY, migratedUsers);
  }

  return migratedUsers.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getActiveUser(): CRMUser | null {
  try {
    const raw = localStorage.getItem(ACTIVE_USER_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CRMUser;
    if (!parsed || !parsed.id) return null;

    return parsed;
  } catch {
    return null;
  }
}

export function setActiveUser(user: CRMUser) {
  localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(user));
}

export function clearActiveUser() {
  localStorage.removeItem(ACTIVE_USER_KEY);
}

export function authenticateUser(email: string, password: string): CRMUser | null {
  const users = listUsers();

  const foundUser = users.find(
    (u) =>
      u.activo &&
      u.email.toLowerCase().trim() === email.toLowerCase().trim() &&
      u.password === password
  );

  if (!foundUser) return null;

  setActiveUser(foundUser);
  return foundUser;
}

export function createUser(
  input: Omit<CRMUser, "id" | "createdAt" | "activo">
): CRMUser {
  const users = listUsers();
  const newUser: CRMUser = {
    id: uid("usr"),
    createdAt: new Date().toISOString(),
    activo: true,
    ...input,
  };
  writeJSON(USERS_V2_KEY, [newUser, ...users]);
  return newUser;
}

export function updateUser(user: CRMUser) {
  const users = listUsers();
  const index = users.findIndex((u) => u.id === user.id);

  if (index === -1) return;

  users[index] = { ...user };
  writeJSON(USERS_V2_KEY, users);
}

export function reactivateUser(userId: string) {
  const users = listUsers();
  const index = users.findIndex((u) => u.id === userId);

  if (index === -1) {
    throw new Error("Usuario no encontrado.");
  }

  users[index] = {
    ...users[index],
    activo: true,
  };

  writeJSON(USERS_V2_KEY, users);
}

export function deleteUser(userId: string) {
  const users = listUsers();
  const userToDelete = users.find((u) => u.id === userId);

  if (!userToDelete) {
    throw new Error("Usuario no encontrado.");
  }

  if (userToDelete.role !== "asesor") {
    throw new Error("Solo se pueden eliminar asesores.");
  }

  const accounts = readJSON<AccountV2[]>(ACCOUNTS_V2_KEY, []);
  const hasAccounts = accounts.some((account) => account.ownerId === userId);

  if (hasAccounts) {
    throw new Error("No puedes eliminar un asesor que todavía tiene cuentas asignadas.");
  }

  const filteredUsers = users.filter((u) => u.id !== userId);
  writeJSON(USERS_V2_KEY, filteredUsers);
}

export function retireAdvisorAndReassign(advisorId: string, newOwnerId: string) {
  if (!advisorId || !newOwnerId || advisorId === newOwnerId) {
    throw new Error("Reasignación inválida.");
  }

  const users = listUsers();
  const advisor = users.find((u) => u.id === advisorId);

  if (!advisor) {
    throw new Error("No encontré el asesor.");
  }

  if (advisor.role !== "asesor") {
    throw new Error("Solo se pueden retirar asesores.");
  }

  const updatedUsers = users.map((user) =>
    user.id === advisorId ? { ...user, activo: false } : user
  );
  writeJSON(USERS_V2_KEY, updatedUsers);

  const accounts = readJSON<AccountV2[]>(ACCOUNTS_V2_KEY, []).map((account) =>
    account.ownerId === advisorId ? { ...account, ownerId: newOwnerId } : account
  );
  writeJSON(ACCOUNTS_V2_KEY, accounts);

  const contacts = readJSON<ContactV2[]>(CONTACTS_V2_KEY, []).map((contact) =>
    contact.ownerId === advisorId ? { ...contact, ownerId: newOwnerId } : contact
  );
  writeJSON(CONTACTS_V2_KEY, contacts);

  const opportunities = readJSON<OpportunityV2[]>(OPPORTUNITIES_V2_KEY, []).map((opp) =>
    opp.ownerId === advisorId ? { ...opp, ownerId: newOwnerId, updatedAt: new Date().toISOString() } : opp
  );
  writeJSON(OPPORTUNITIES_V2_KEY, opportunities);

  const activities = readJSON<ActivityV2[]>(ACTIVITIES_KEY, []).map((activity) =>
    activity.ownerId === advisorId ? { ...activity, ownerId: newOwnerId } : activity
  );
  writeJSON(ACTIVITIES_KEY, activities);

  const quotes = readJSON<QuoteV2[]>(QUOTES_V2_KEY, []).map((quote) =>
    quote.ownerId === advisorId
      ? { ...quote, ownerId: newOwnerId, updatedAt: new Date().toISOString() }
      : quote
  );
  writeJSON(QUOTES_V2_KEY, quotes);

  const tasks = readJSON<Task[]>(TASKS_KEY, []).map((task) => {
    const nextTask = { ...task };

    if (nextTask.assignedTo === advisorId) {
      nextTask.assignedTo = newOwnerId;
    }

    if (nextTask.createdBy === advisorId) {
      nextTask.createdBy = newOwnerId;
    }

    return nextTask;
  });
  writeJSON(TASKS_KEY, tasks);
}

/**
 * Transfiere un elemento específico de la cartera de un asesor a otro usuario,
 * sin retirar al asesor. Para cuentas, arrastra también sus contactos,
 * oportunidades y cotizaciones que pertenecían al asesor origen.
 */
export function transferAdvisorItem(
  kind: "account" | "contact" | "quote",
  itemId: string,
  fromAdvisorId: string,
  newOwnerId: string
): void {
  if (!itemId || !newOwnerId) throw new Error("Datos incompletos para la transferencia.");
  if (newOwnerId === fromAdvisorId) throw new Error("Escoge un responsable diferente.");

  const targetUser = listUsers().find((u) => u.id === newOwnerId && u.activo);
  if (!targetUser) throw new Error("El usuario destino no existe o está inactivo.");

  if (kind === "account") {
    const accounts = readJSON<AccountV2[]>(ACCOUNTS_V2_KEY, []);
    const account = accounts.find((a) => a.id === itemId);
    if (!account) throw new Error("No encontré la cuenta.");

    writeJSON(
      ACCOUNTS_V2_KEY,
      accounts.map((a) => (a.id === itemId ? { ...a, ownerId: newOwnerId } : a))
    );

    // Arrastrar los elementos vinculados a la cuenta.
    const contacts = readJSON<ContactV2[]>(CONTACTS_V2_KEY, []);
    writeJSON(
      CONTACTS_V2_KEY,
      contacts.map((c) => (c.accountId === itemId ? { ...c, ownerId: newOwnerId } : c))
    );

    const opps = readJSON<OpportunityV2[]>(OPPORTUNITIES_V2_KEY, []);
    writeJSON(
      OPPORTUNITIES_V2_KEY,
      opps.map((o) =>
        o.accountId === itemId && o.ownerId === fromAdvisorId ? { ...o, ownerId: newOwnerId } : o
      )
    );

    const quotes = readJSON<QuoteV2[]>(QUOTES_V2_KEY, []);
    writeJSON(
      QUOTES_V2_KEY,
      quotes.map((q) =>
        q.accountId === itemId && q.ownerId === fromAdvisorId ? { ...q, ownerId: newOwnerId } : q
      )
    );
    return;
  }

  if (kind === "contact") {
    const contacts = readJSON<ContactV2[]>(CONTACTS_V2_KEY, []);
    if (!contacts.some((c) => c.id === itemId)) throw new Error("No encontré el contacto.");
    writeJSON(
      CONTACTS_V2_KEY,
      contacts.map((c) => (c.id === itemId ? { ...c, ownerId: newOwnerId } : c))
    );
    return;
  }

  // kind === "quote"
  const quotes = readJSON<QuoteV2[]>(QUOTES_V2_KEY, []);
  if (!quotes.some((q) => q.id === itemId)) throw new Error("No encontré la cotización.");
  writeJSON(
    QUOTES_V2_KEY,
    quotes.map((q) => (q.id === itemId ? { ...q, ownerId: newOwnerId } : q))
  );
}

export function retireAdvisorWithAccountRedistribution(
  advisorId: string,
  accountAssignments: Record<string, string>
) {
  if (!advisorId) {
    throw new Error("No encontré el asesor.");
  }

  const users = listUsers();
  const advisor = users.find((u) => u.id === advisorId);

  if (!advisor) {
    throw new Error("No encontré el asesor.");
  }

  if (advisor.role !== "asesor") {
    throw new Error("Solo se pueden retirar asesores.");
  }

  const accounts = readJSON<AccountV2[]>(ACCOUNTS_V2_KEY, []);
  const advisorAccounts = accounts.filter((account) => account.ownerId === advisorId);

  if (!advisorAccounts.length) {
    const updatedUsers = users.map((user) =>
      user.id === advisorId ? { ...user, activo: false } : user
    );
    writeJSON(USERS_V2_KEY, updatedUsers);
    return;
  }

  for (const account of advisorAccounts) {
    const newOwnerId = accountAssignments[account.id];

    if (!newOwnerId || newOwnerId === advisorId) {
      throw new Error(`Debes asignar un nuevo responsable para ${account.nombreComercial || account.razonSocial}.`);
    }
  }

  const updatedUsers = users.map((user) =>
    user.id === advisorId ? { ...user, activo: false } : user
  );
  writeJSON(USERS_V2_KEY, updatedUsers);

  const reassignedAccounts = accounts.map((account) => {
    if (account.ownerId !== advisorId) return account;

    return {
      ...account,
      ownerId: accountAssignments[account.id],
    };
  });
  writeJSON(ACCOUNTS_V2_KEY, reassignedAccounts);

  const contacts = readJSON<ContactV2[]>(CONTACTS_V2_KEY, []).map((contact) => {
    if (contact.ownerId !== advisorId) return contact;

    const accountOwnerId = accountAssignments[contact.accountId];
    if (!accountOwnerId) return contact;

    return {
      ...contact,
      ownerId: accountOwnerId,
    };
  });
  writeJSON(CONTACTS_V2_KEY, contacts);

  const opportunities = readJSON<OpportunityV2[]>(OPPORTUNITIES_V2_KEY, []).map((opp) => {
    if (opp.ownerId !== advisorId) return opp;

    const accountOwnerId = accountAssignments[opp.accountId];
    if (!accountOwnerId) return opp;

    return {
      ...opp,
      ownerId: accountOwnerId,
      updatedAt: new Date().toISOString(),
    };
  });
  writeJSON(OPPORTUNITIES_V2_KEY, opportunities);

  const activities = readJSON<ActivityV2[]>(ACTIVITIES_KEY, []).map((activity) => {
    if (activity.ownerId !== advisorId) return activity;

    const accountOwnerId = accountAssignments[activity.accountId];
    if (!accountOwnerId) return activity;

    return {
      ...activity,
      ownerId: accountOwnerId,
    };
  });
  writeJSON(ACTIVITIES_KEY, activities);

  const quotes = readJSON<QuoteV2[]>(QUOTES_V2_KEY, []).map((quote) => {
    if (quote.ownerId !== advisorId) return quote;

    const accountOwnerId = accountAssignments[quote.accountId];
    if (!accountOwnerId) return quote;

    return {
      ...quote,
      ownerId: accountOwnerId,
      updatedAt: new Date().toISOString(),
    };
  });
  writeJSON(QUOTES_V2_KEY, quotes);

  const tasks = readJSON<Task[]>(TASKS_KEY, []).map((task) => {
    const nextTask = { ...task };

    if (task.accountId && accountAssignments[task.accountId]) {
      if (nextTask.assignedTo === advisorId) {
        nextTask.assignedTo = accountAssignments[task.accountId];
      }

      if (nextTask.createdBy === advisorId) {
        nextTask.createdBy = accountAssignments[task.accountId];
      }
    }

    return nextTask;
  });
  writeJSON(TASKS_KEY, tasks);
}

export function assignRoundRobin(): string | null {
  const users = listUsers().filter((u) => u.role === "asesor" && u.activo);
  if (!users.length) return null;

  // El contador vive en localStorage, así que puede venir corrupto (editado a
  // mano, escrito por una versión anterior, o simplemente basura). La guarda
  // anterior `if (currentIndex >= users.length)` no cubría dos casos:
  //   - NaN  (ej. "abc"): NaN >= n es false, así que no se reseteaba y
  //     users[NaN] daba undefined → assignedUser.id lanzaba TypeError.
  //   - negativos (ej. "-5"): -5 >= n es false → users[-5] undefined → igual.
  // Se normaliza a un entero dentro de rango con módulo, que además reubica
  // el contador solo si la lista de asesores se achicó.
  const parsed = parseInt(localStorage.getItem(RR_KEY) || "0", 10);
  const currentIndex = Number.isFinite(parsed) && parsed >= 0
    ? parsed % users.length
    : 0;

  const assignedUser = users[currentIndex];
  const nextIndex = (currentIndex + 1) % users.length;
  localStorage.setItem(RR_KEY, nextIndex.toString());

  return assignedUser.id;
}

// =====================================================
// 3) CUENTAS V2 (CON FILTRO ANTI-FANTASMA)
// =====================================================
export function listAccounts(): AccountV2[] {
  rescueGhostAccounts();
  const accounts = readJSON<AccountV2[]>(ACCOUNTS_V2_KEY, []) || [];
  return accounts
    .filter(a => a && a.id && a.id.startsWith("acc_") && (a.razonSocial || a.nombreComercial))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function listAccountsByUser(user?: CRMUser): AccountV2[] {
  const activeUser = user || getActiveUser();
  if (!activeUser) return [];
  const accounts = listAccounts();
  if (activeUser.role === "director") return accounts;
  return accounts.filter(a => a.ownerId === activeUser.id);
}

export function createAccount(input: Omit<AccountV2, "id" | "createdAt" | "ownerId">): AccountV2 {
  const accounts = readJSON<AccountV2[]>(ACCOUNTS_V2_KEY, []);
  const user = getActiveUser();
  if (!user) throw new Error("Debes iniciar sesión primero");
  const now = new Date().toISOString();
  // El spread de input va PRIMERO: si el input trae id/ownerId propios (p. ej. importación
  // masiva o asistente), no deben sobrescribir los valores generados. Un id que no empiece
  // por "acc_" dejaría la cuenta oculta por el filtro anti-fantasma de listAccounts().
  const account: AccountV2 = {
    ...(input as AccountV2),
    id: uid("acc"),
    createdAt: now,
    updatedAt: now,
    ownerId: user.id,
  };
  writeJSON(ACCOUNTS_V2_KEY, [account, ...accounts]);
  return account;
}

/**
 * Qué se llevaría por delante el borrado de una cuenta.
 *
 * Se expone aparte de deleteAccount para que la UI pueda avisar ANTES de borrar.
 * Sin esto el usuario no tiene forma de saber que eliminar una empresa también
 * elimina sus cotizaciones, que son registros con valor comercial.
 */
export type AccountCascade = {
  contacts: number;
  opportunities: number;
  quotes: number;
  activities: number;
  tasks: number;
};

export function countAccountRelations(accountId: string): AccountCascade {
  const byAccount = <T extends { accountId?: string }>(key: string) =>
    (readJSON<T[]>(key, []) || []).filter((x) => x && x.accountId === accountId).length;

  return {
    contacts: byAccount<ContactV2>(CONTACTS_V2_KEY),
    opportunities: byAccount<OpportunityV2>(OPPORTUNITIES_V2_KEY),
    quotes: byAccount<QuoteV2>(QUOTES_V2_KEY),
    activities: byAccount<ActivityV2>(ACTIVITIES_KEY),
    tasks: byAccount<Task>(TASKS_KEY),
  };
}

/**
 * Borra la cuenta y todo lo que colgaba de ella.
 *
 * Antes solo se eliminaba la fila de la cuenta. Los hijos quedaban en
 * localStorage apuntando a un accountId inexistente, y como ni listQuotes ni
 * listOpportunities validan que la cuenta exista, esos huérfanos seguían
 * sumando al valor del pipeline y al cumplimiento de metas. Es decir: borrar
 * una empresa no bajaba los números, solo la hacía invisible.
 *
 * También se limpian los TimeLogs de las tareas eliminadas, porque cuelgan de
 * taskId y de otro modo se acumulan sin dueño para siempre.
 */
export function deleteAccount(accountId: string): AccountCascade {
  const removed = countAccountRelations(accountId);

  const accounts = readJSON<AccountV2[]>(ACCOUNTS_V2_KEY, []) || [];
  writeJSON(ACCOUNTS_V2_KEY, accounts.filter((a) => a && a.id !== accountId));

  const purge = <T extends { accountId?: string }>(key: string) => {
    const items = readJSON<T[]>(key, []) || [];
    writeJSON(key, items.filter((x) => !x || x.accountId !== accountId));
  };

  // Las tareas se recogen antes de purgarlas para poder borrar sus TimeLogs.
  const doomedTaskIds = new Set(
    (readJSON<Task[]>(TASKS_KEY, []) || [])
      .filter((t) => t && t.accountId === accountId)
      .map((t) => t.id)
  );

  purge<ContactV2>(CONTACTS_V2_KEY);
  purge<OpportunityV2>(OPPORTUNITIES_V2_KEY);
  purge<QuoteV2>(QUOTES_V2_KEY);
  purge<ActivityV2>(ACTIVITIES_KEY);
  purge<Task>(TASKS_KEY);

  if (doomedTaskIds.size) {
    const logs = readJSON<TimeLog[]>(TIME_LOGS_KEY, []) || [];
    writeJSON(TIME_LOGS_KEY, logs.filter((l) => !l || !doomedTaskIds.has(l.taskId)));
  }

  return removed;
}

// =====================================================
// 4) CONTACTOS V2
// =====================================================
export function listContacts(): ContactV2[] {
  const contacts = readJSON<ContactV2[]>(CONTACTS_V2_KEY, []) || [];
  return contacts.filter(c => c && c.id && c.accountId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function listContactsByUser(user?: CRMUser): ContactV2[] {
  const activeUser = user || getActiveUser();
  if (!activeUser) return [];
  const contacts = listContacts();
  if (activeUser.role === "director") return contacts;
  
  const myAccountIds = listAccountsByUser(activeUser).map(a => a.id);
  // Un contacto con dueño explícito pertenece SOLO a su dueño (permite transferirlo
  // a otro asesor sin que siga visible para el dueño de la cuenta). Los contactos
  // sin dueño se muestran por pertenencia de la cuenta.
  return contacts.filter(c =>
    c.ownerId ? c.ownerId === activeUser.id : myAccountIds.includes(c.accountId)
  );
}

export function listContactsByAccountId(accountId: string): ContactV2[] {
  return listContacts().filter((c) => c.accountId === accountId);
}

export function createContact(input: Omit<ContactV2, "id" | "createdAt" | "ownerId"> & { ownerId?: string }): ContactV2 {
  const contacts = readJSON<ContactV2[]>(CONTACTS_V2_KEY, []);
  const user = getActiveUser();
  if (!user) throw new Error("Debes iniciar sesión primero");
  const now = new Date().toISOString();
  // El dueño por defecto es el dueño de la cuenta (no quien lo crea): así un contacto
  // creado por el director sobre la cuenta de un asesor le pertenece al asesor, y la
  // visibilidad estricta por ownerId de listContactsByUser sigue funcionando.
  const accountOwner = input.accountId
    ? readJSON<AccountV2[]>(ACCOUNTS_V2_KEY, []).find((a) => a.id === input.accountId)?.ownerId
    : undefined;

  // Spread primero para que id/createdAt/ownerId generados no sean sobrescritos por el input.
  const contact: ContactV2 = {
    ...(input as ContactV2),
    id: uid("con"),
    createdAt: now,
    updatedAt: now,
    ownerId: input.ownerId || accountOwner || user.id,
  };
  writeJSON(CONTACTS_V2_KEY, [contact, ...contacts]);
  return contact;
}

export function updateContact(contact: ContactV2) {
  const contacts = readJSON<ContactV2[]>(CONTACTS_V2_KEY, []);
  const idx = contacts.findIndex(c => c.id === contact.id);
  if (idx !== -1) {
    contacts[idx] = { ...contact };
    writeJSON(CONTACTS_V2_KEY, contacts);
  }
}

/**
 * Borra un contacto y desvincula lo que lo referenciaba.
 *
 * A diferencia de deleteAccount, acá NO se hace cascada destructiva: una
 * oportunidad, una cotización o una actividad pertenecen a la empresa, no a la
 * persona. Si se va el contacto (renunció, cambió de empresa) el negocio sigue
 * existiendo. Lo que sí hay que hacer es limpiar el contactId, porque si queda
 * apuntando a un contacto borrado la UI busca un nombre que ya no está y
 * muestra vacío sin explicar por qué.
 */
export function deleteContact(contactId: string) {
  const contacts = readJSON<ContactV2[]>(CONTACTS_V2_KEY, []) || [];
  writeJSON(CONTACTS_V2_KEY, contacts.filter((c) => c && c.id !== contactId));

  const unlink = <T extends { contactId?: string }>(key: string) => {
    const items = readJSON<T[]>(key, []) || [];
    let changed = false;
    const next = items.map((item) => {
      if (item && item.contactId === contactId) {
        changed = true;
        return { ...item, contactId: "" };
      }
      return item;
    });
    if (changed) writeJSON(key, next);
  };

  unlink<OpportunityV2>(OPPORTUNITIES_V2_KEY);
  unlink<QuoteV2>(QUOTES_V2_KEY);
  unlink<ActivityV2>(ACTIVITIES_KEY);
  unlink<Task>(TASKS_KEY);
}

// =====================================================
// 5) OPORTUNIDADES (NEGOCIACIONES)
// =====================================================

function probabilityByStage(stage: OpportunityStage): number {
  const probs: Record<string, number> = {
    "Contactado": 10,
    "Prospecto": 20,
    "Calificado": 40,
    "Cotización": 60,
    "Negociación": 80,
    "Ganado": 100,
    "Perdido": 0
  };
  return probs[stage] !== undefined ? probs[stage] : 10;
}

/**
 * Rescata cuentas "fantasma": cuentas guardadas con un id que no empieza por "acc_"
 * (creadas por importaciones o el asistente antes del arreglo en createAccount) que el
 * filtro de listAccounts() ocultaba. Les asigna un id válido y re-vincula contactos,
 * oportunidades, cotizaciones y actividades que apuntaban al id antiguo.
 */
function rescueGhostAccounts(): void {
  const accounts = readJSON<AccountV2[]>(ACCOUNTS_V2_KEY, []) || [];
  const ghosts = accounts.filter(
    (a) => a && a.id && !a.id.startsWith("acc_") && (a.razonSocial || a.nombreComercial)
  );
  if (!ghosts.length) return;

  const idMap = new Map<string, string>();
  const activeUser = getActiveUser();

  const fixedAccounts = accounts.map((a) => {
    if (!a || !a.id || a.id.startsWith("acc_") || !(a.razonSocial || a.nombreComercial)) return a;
    const newId = uid("acc");
    idMap.set(a.id, newId);
    return {
      ...a,
      id: newId,
      ownerId: a.ownerId || activeUser?.id || "",
      createdAt: a.createdAt || new Date().toISOString(),
    };
  });
  writeJSON(ACCOUNTS_V2_KEY, fixedAccounts);

  const remap = <T extends { accountId?: string }>(key: string) => {
    const items = readJSON<T[]>(key, []) || [];
    let changed = false;
    const fixed = items.map((item) => {
      if (item && item.accountId && idMap.has(item.accountId)) {
        changed = true;
        return { ...item, accountId: idMap.get(item.accountId)! };
      }
      return item;
    });
    if (changed) writeJSON(key, fixed);
  };

  remap<ContactV2>(CONTACTS_V2_KEY);
  remap<OpportunityV2>(OPPORTUNITIES_V2_KEY);
  remap<QuoteV2>(QUOTES_V2_KEY);
  remap<ActivityV2>(ACTIVITIES_KEY);
}

/**
 * repairRelations es una migración de datos, no una consulta.
 *
 * Estaba invocada desde listOpportunities() y listQuotes(), o sea que corría
 * en CADA lectura: cada render, cada useMemo, cada filtro. Y no es barata —
 * recorre 5 claves de localStorage y hace un find() de cotizaciones dentro de
 * un map() de oportunidades, que es O(n×m). Con unos cientos de registros eso
 * es medio millón de comparaciones por render, y encima puede escribir en
 * localStorage en mitad de un render.
 *
 * La solución es tratarla como lo que es: algo que corre una vez por sesión.
 * Si algo reemplaza datos en bloque (importar, sembrar, resetear) llama a
 * invalidateRelationRepair() para que la próxima lectura la vuelva a correr.
 */
let relationsRepaired = false;

export function invalidateRelationRepair(): void {
  relationsRepaired = false;
}

function ensureRelationsRepaired(): void {
  if (relationsRepaired) return;
  relationsRepaired = true;
  repairRelations();
}

export function repairRelations(): void {
  relationsRepaired = true;
  rescueGhostAccounts();
  const opps = readJSON<OpportunityV2[]>(OPPORTUNITIES_V2_KEY, []) || [];
  const quotes = readJSON<QuoteV2[]>(QUOTES_V2_KEY, []) || [];
  const accounts = readJSON<AccountV2[]>(ACCOUNTS_V2_KEY, []) || [];

  let oppsChanged = false;
  let quotesChanged = false;

  const validAccountIds = new Set(accounts.filter(a => a && a.id).map(a => a.id));

  // 1. Repair Opportunities
  const repairedOpps = opps.map(o => {
    if (!o || !o.id) return o;
    let modified = false;

    // Find associated quote
    const associatedQuote = quotes.find(q => q && (q.id === o.quoteId || (q.opportunityId && q.opportunityId === o.id)));

    // Rule 3: If opportunity has no accountId or has an invalid one, but associated quote has a valid account
    const hasNoValidAccount = !o.accountId || !validAccountIds.has(o.accountId);
    if (hasNoValidAccount && associatedQuote) {
      if (associatedQuote.accountId && validAccountIds.has(associatedQuote.accountId)) {
        o.accountId = associatedQuote.accountId;
        o.contactId = associatedQuote.contactId || "";
        modified = true;
      }
    }

    // Sync quoteId to opportunity if it's missing but there's a link
    if (associatedQuote && o.quoteId !== associatedQuote.id) {
      o.quoteId = associatedQuote.id;
      modified = true;
    }

    if (modified) {
      oppsChanged = true;
      o.updatedAt = new Date().toISOString();
    }
    return o;
  });

  // 2. Repair Quotes
  const repairedQuotes = quotes.map(q => {
    if (!q || !q.id) return q;
    let modified = false;

    // Find associated opportunity
    const associatedOpp = opps.find(o => o && (o.id === q.opportunityId || o.quoteId === q.id));

    // If the quote points to an opportunity, but does not have opportunityId set
    if (associatedOpp && q.opportunityId !== associatedOpp.id) {
      q.opportunityId = associatedOpp.id;
      modified = true;
    }

    if (modified) {
      quotesChanged = true;
      q.updatedAt = new Date().toISOString();
    }
    return q;
  });

  if (oppsChanged) {
    writeJSON(OPPORTUNITIES_V2_KEY, repairedOpps);
  }
  if (quotesChanged) {
    writeJSON(QUOTES_V2_KEY, repairedQuotes);
  }
}

export function listOpportunities(): OpportunityV2[] {
  ensureRelationsRepaired();
  return readJSON<OpportunityV2[]>(OPPORTUNITIES_V2_KEY, [])
    .filter(o => o && o.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function listOpportunitiesByUser(user?: CRMUser): OpportunityV2[] {
  const activeUser = user || getActiveUser();
  if (!activeUser) return [];
  const all = listOpportunities();
  if (activeUser.role === "director") return all;
  return all.filter((o) => o.ownerId === activeUser.id);
}

export function createOpportunity(
  input: Partial<OpportunityV2> & { accountId: string }
): OpportunityV2 {
  const opps = readJSON<OpportunityV2[]>(OPPORTUNITIES_V2_KEY, []);
  const user = getActiveUser();
  const etapa: OpportunityStage = input.etapa || "Contactado";
  const now = new Date().toISOString();

  // Igual que en createContact: el dueño por defecto es el dueño de la cuenta,
  // no quien la crea. Así una oportunidad que el director abre sobre la cuenta
  // de un asesor le pertenece al asesor y sigue visible en sus vistas.
  const accountOwner = input.accountId
    ? readJSON<AccountV2[]>(ACCOUNTS_V2_KEY, []).find((a) => a.id === input.accountId)?.ownerId
    : undefined;
  const ownerId = input.ownerId || accountOwner || user?.id || "";
  if (!ownerId) {
    // Sin dueño la oportunidad queda invisible en toda vista filtrada por
    // asesor (listOpportunitiesByUser), es decir: se guarda y desaparece.
    throw new Error(
      "No se puede crear una oportunidad sin dueño. Iniciá sesión o indicá un ownerId."
    );
  }

  const opp: OpportunityV2 = {
    // El spread va PRIMERO para que un input con id/createdAt propios no pise
    // los valores generados — mismo bug que se corrigió en createAccount y
    // createContact (#10 del informe).
    ...(input as OpportunityV2),

    // Campos generados: siempre mandan sobre el input.
    id: uid("opp"),
    createdAt: now,
    updatedAt: now,
    etapa,
    ownerId,
    moneda: input.moneda || "COP",

    // La probabilidad explícita del input tiene prioridad (el Asistente la
    // calcula según interés y urgencia); si no viene, se deriva de la etapa.
    probabilidad:
      typeof input.probabilidad === "number"
        ? input.probabilidad
        : probabilityByStage(etapa),
  };

  writeJSON(OPPORTUNITIES_V2_KEY, [opp, ...opps]);
  return opp;
}

export function updateOpportunity(opp: OpportunityV2): void {
  const opps = readJSON<OpportunityV2[]>(OPPORTUNITIES_V2_KEY, []);
  const index = opps.findIndex((o) => o.id === opp.id);
  if (index !== -1) {
    opps[index] = { ...opp, updatedAt: new Date().toISOString() };
    writeJSON(OPPORTUNITIES_V2_KEY, opps);
  }
}

export function updateOpportunityStage(id: string, stage: OpportunityStage): void {
  const opps = listOpportunities();
  const idx = opps.findIndex(o => o.id === id);
  if (idx !== -1) {
    opps[idx] = { ...opps[idx], etapa: stage, probabilidad: probabilityByStage(stage), updatedAt: new Date().toISOString() };
    writeJSON(OPPORTUNITIES_V2_KEY, opps);
  }
}

function syncOpportunityStageFromQuote(
  quote: Pick<QuoteV2, "accountId" | "opportunityId">,
  stage: OpportunityStage
) {
  if (quote.opportunityId) {
    updateOpportunityStage(quote.opportunityId, stage);
    return;
  }

  const openOpps = listOpportunities().filter(
    (o) =>
      o.accountId === quote.accountId &&
      o.etapa !== "Ganado" &&
      o.etapa !== "Perdido"
  );

  if (openOpps.length === 1) {
    updateOpportunityStage(openOpps[0].id, stage);
  }
}

export function saveOpportunities(list: OpportunityV2[]) {
  writeJSON(OPPORTUNITIES_V2_KEY, list);
  // Escritura en bloque: puede traer registros sin vincular (importaciones,
  // el asistente), así que hay que revisar las relaciones otra vez.
  invalidateRelationRepair();
}

export function deleteOpportunity(opportunityId: string): boolean {
  console.log("Iniciando deleteOpportunity con ID:", opportunityId);
  const opps = readJSON<OpportunityV2[]>(OPPORTUNITIES_V2_KEY, []);
  console.log("Oportunidades en storage antes de eliminar:", opps.map(o => o.id));

  const filtered = opps.filter((o) => o.id !== opportunityId);

  if (filtered.length === opps.length) {
    console.warn("La oportunidad no se encontró en el embudo.");
  } else {
    console.log(`Oportunidad encontrada. Eliminando... (Total antes: ${opps.length}, después: ${filtered.length})`);
    writeJSON(OPPORTUNITIES_V2_KEY, filtered);
  }

  // Clean up any quotes pointing to this opportunity
  const quotes = readJSON<QuoteV2[]>(QUOTES_V2_KEY, []);
  let quotesChanged = false;
  const updatedQuotes = quotes.map((q) => {
    if (q.opportunityId === opportunityId) {
      quotesChanged = true;
      console.log(`Limpiando relación de oportunidad en la cotización: ${q.quoteNumber || q.id}`);
      return { ...q, opportunityId: "" };
    }
    return q;
  });

  if (quotesChanged) {
    writeJSON(QUOTES_V2_KEY, updatedQuotes);
  }

  const deleted = filtered.length !== opps.length;
  return deleted || quotesChanged;
}

// =====================================================
// 6) ACTIVIDADES Y SEGUIMIENTOS
// =====================================================
export function listActivities(filter?: { accountId?: string; contactId?: string }): ActivityV2[] {
  const all = readJSON<ActivityV2[]>(ACTIVITIES_KEY, []);
  if (!filter) return all;
  return all.filter(a => {
    if (filter.accountId && a.accountId !== filter.accountId) return false;
    if (filter.contactId && a.contactId !== filter.contactId) return false;
    return true;
  });
}

export function listActivitiesByUser(user?: CRMUser): ActivityV2[] {
  try {
    migrateLegacyActivities();
  } catch (e) {
    console.error("Migration error:", e);
  }
  const activeUser = user || getActiveUser();
  if (!activeUser) return [];
  const activities = readJSON<ActivityV2[]>(ACTIVITIES_KEY, []);
  if (activeUser.role === "director") return activities;
  return activities.filter(a => a.ownerId === activeUser.id);
}

export function createActivity(data: ActivityInput): ActivityV2 {
  const list = readJSON<ActivityV2[]>(ACTIVITIES_KEY, []);
  const user = getActiveUser();
  if (!user) throw new Error("Debes iniciar sesión primero");

  // Sin accountId la actividad queda huérfana: no aparece en el timeline de
  // ninguna cuenta ni en los conteos, pero igual ocupa lugar en localStorage.
  if (!data.accountId) {
    throw new Error("No se puede registrar una actividad sin cuenta asociada.");
  }

  // El spread va primero para que el input no pueda pisar los campos generados
  // (mismo criterio que createAccount / createContact / createOpportunity).
  const newAct: ActivityV2 = {
    ...data,
    id: crypto.randomUUID(),
    ownerId: user.id,
    user: user.name,
    createdAt: new Date().toISOString(),
  };
  writeJSON(ACTIVITIES_KEY, [newAct, ...list]);
  return newAct;
}

export const updateActivity = (activityId: string, updates: any) => {
  const activities = readJSON<ActivityV2[]>(ACTIVITIES_KEY, []);

  const updatedActivities = activities.map((activity: any) => {
    if (activity.id !== activityId) return activity;

    return {
      ...activity,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
  });

  writeJSON(ACTIVITIES_KEY, updatedActivities);
  return updatedActivities.find((activity: any) => activity.id === activityId);
};

export function migrateLegacyActivities() {
  const activities = readJSON<ActivityV2[]>(ACTIVITIES_KEY, []);
  const contacts = readJSON<ContactV2[]>("crm_contacts_v2", []);
  let changed = false;

  const updated = activities.map(act => {
    if (act.contactId && contacts.some(c => c.id === act.contactId)) {
      return act;
    }

    const desc = (act.description || "").toLowerCase();
    const matches = contacts.filter(c => {
      const name = (c.fullName || "").toLowerCase().trim();
      return name.length > 2 && desc.includes(name);
    });

    if (matches.length === 1) {
      changed = true;
      return {
        ...act,
        contactId: matches[0].id,
        accountId: act.accountId || matches[0].accountId
      };
    }

    return act;
  });

  if (changed) {
    writeJSON(ACTIVITIES_KEY, updated);
  }
}

export function deleteActivity(activityId: string) {
  const activities = readJSON<ActivityV2[]>(ACTIVITIES_KEY, []);
  const activityToDelete = activities.find(a => a.id === activityId);
  let linkedId: string | undefined = undefined;

  if (activityToDelete) {
    if (activityToDelete.followUpActivityId) {
      linkedId = activityToDelete.followUpActivityId;
    } else {
      const historyAct = activities.find(a => a.followUpActivityId === activityId);
      if (historyAct) {
        linkedId = historyAct.id;
      }
    }
  }

  const updated = activities.filter(
    a => a.id !== activityId && (!linkedId || a.id !== linkedId)
  );
  writeJSON(ACTIVITIES_KEY, updated);
}

export function clearAllPendingFollowUps(userId: string) {
  const activities = readJSON<ActivityV2[]>(ACTIVITIES_KEY, []);
  const toDeleteIds = new Set<string>();

  activities.forEach(a => {
    const isPendingFollowUp = a.ownerId === userId && a.followUpAt && a.status !== "completada" && a.status !== "realizado";
    if (isPendingFollowUp) {
      toDeleteIds.add(a.id);
      const historyAct = activities.find(h => h.followUpActivityId === a.id);
      if (historyAct) {
        toDeleteIds.add(historyAct.id);
      }
    }
    if (a.followUpActivityId) {
      const pendingFollowUp = activities.find(p => p.id === a.followUpActivityId);
      if (pendingFollowUp && pendingFollowUp.ownerId === userId && pendingFollowUp.followUpAt && pendingFollowUp.status !== "completada" && pendingFollowUp.status !== "realizado") {
        toDeleteIds.add(a.id);
        toDeleteIds.add(pendingFollowUp.id);
      }
    }
  });

  const updated = activities.filter(a => !toDeleteIds.has(a.id));
  writeJSON(ACTIVITIES_KEY, updated);
}

export function listUpcomingActivities(): ActivityV2[] {
  // Aislamiento por asesor: solo actividades del usuario autenticado (director ve todas)
  const all = listActivitiesByUser();
  const now = new Date();

  return all
    .filter((a: any) => a.followUpAt && a.status !== "realizado")
    .filter((a) => new Date(a.followUpAt!) > now)
    .sort((a, b) => new Date(a.followUpAt!).getTime() - new Date(b.followUpAt!).getTime());
}

export function listOverdueActivities(): ActivityV2[] {
  // Aislamiento por asesor: solo actividades del usuario autenticado (director ve todas)
  const all = listActivitiesByUser();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  return all
    .filter((a: any) => a.followUpAt && a.status !== "realizado")
    .filter((a) => new Date(a.followUpAt!) < startOfToday)
    .sort((a, b) => new Date(b.followUpAt!).getTime() - new Date(a.followUpAt!).getTime());
}

// =====================================================
// 7) PROYECTOS (TAREAS)
// =====================================================
export function getTasks(): Task[] { 
  return readJSON<Task[]>(TASKS_KEY, []).filter(t => t && t.id); 
}

export function getTasksByUser(): Task[] {
  const user = getActiveUser();
  if (!user) return [];
  const all = getTasks();
  if (user.role === "director") return all;
  return all.filter((t) => t.assignedTo === user.id);
}

export function addTask(task: Task) {
  const tasks = getTasks();
  writeJSON(TASKS_KEY, [...tasks, task]);
}

export function createTask(input: {
  title: string;
  description?: string;
  assignedTo?: string;
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  dueDate?: string | null;
  createdBy?: string;
  priority?: TaskPriority;
  estimatedTime?: number;
}) {
  const user = getActiveUser();
  if (!user) throw new Error("Debes iniciar sesión primero");

  const now = new Date().toISOString();

  const task: Task = {
    id: uid("tsk"),
    title: input.title,
    description: input.description || "",
    priority: input.priority || "Media",
    status: "Pendiente",
    startDate: now,
    endDate: input.dueDate || now,
    assignedTo: input.assignedTo || user.id,
    estimatedTime: input.estimatedTime,
    createdAt: now,
    createdBy: input.createdBy || user.id,
    accountId: input.accountId,
    contactId: input.contactId,
    opportunityId: input.opportunityId,
  };

  addTask(task);
  return task;
}

export function saveTasks(tasks: Task[]) {
  writeJSON(TASKS_KEY, tasks);
}

export function updateTaskStatus(taskId: string, status: TaskStatus) {
  const tasks = getTasks();
  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx !== -1) {
    tasks[idx].status = status;
    if (status === "Finalizado") {
      const activeUser = getActiveUser();
      tasks[idx].completedAt = new Date().toISOString();
      tasks[idx].completedBy = activeUser?.id || "unknown";
    }
    writeJSON(TASKS_KEY, tasks);
  }
}

export function reopenTask(taskId: string) {
  const tasks = getTasks();
  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx !== -1) {
    const activeUser = getActiveUser();
    tasks[idx].status = "Por hacer";
    delete tasks[idx].completedAt;
    delete tasks[idx].completedBy;
    tasks[idx].reopenedAt = new Date().toISOString();
    tasks[idx].reopenedBy = activeUser?.id || "unknown";
    writeJSON(TASKS_KEY, tasks);
  }
}

// =====================================================
// 8) PIPELINE CONFIG
// =====================================================

export function getStages(): PipelineStage[] {
  return [
    { id: "contactado", name: "Contactado", color: "bg-blue-100", order: 0 },
    { id: "prospecto", name: "Prospecto", color: "bg-slate-100", order: 1 },
    { id: "calificado", name: "Calificado", color: "bg-indigo-100", order: 2 },
    { id: "cotizacion", name: "Cotización", color: "bg-amber-100", order: 3 },
    { id: "negociacion", name: "Negociación", color: "bg-orange-100", order: 4 },
    { id: "ganado", name: "Ganado", color: "bg-emerald-100", order: 5 },
    { id: "perdido", name: "Perdido", color: "bg-rose-100", order: 6 },
  ];
}

export function getAutomationConfig(): AutomationConfig {
  return readJSON<AutomationConfig>(AUTOMATION_KEY, {
    scriptUrl: "",
    templateId: "",
    enabled: true
  });
}

export function saveAutomationConfig(config: AutomationConfig) {
  writeJSON(AUTOMATION_KEY, config);
}

// =====================================================
// 8.b) CONFIGURACIÓN DE NEGOCIO (TRM)
// =====================================================

/**
 * Valor de arranque de la TRM. Es solo el fallback para instalaciones nuevas
 * o para un valor guardado corrupto: la fuente de verdad es getTRM().
 *
 * Antes este 4000 estaba repetido como literal en siete lugares (storage,
 * analytics y cinco puntos de Quotes), así que actualizarlo implicaba
 * acordarse de todos. Ahora hay un único lugar.
 */
export const TRM_FALLBACK = 4000;

export function getBusinessSettings(): BusinessSettings {
  const stored = readJSON<Partial<BusinessSettings>>(BUSINESS_SETTINGS_KEY, {});
  return { trmDefault: normalizeTRM(stored?.trmDefault) };
}

/**
 * La TRM vive en localStorage, así que puede venir como string, NaN, 0 o
 * negativa. Cualquiera de esas rompe las conversiones (dividir por 0 da
 * Infinity y se propaga a los reportes), así que se sanea al leer.
 */
function normalizeTRM(value: unknown): number {
  const n = typeof value === "string" ? parseFloat(value) : (value as number);
  return Number.isFinite(n) && n > 0 ? n : TRM_FALLBACK;
}

/** TRM vigente para reportes y para prellenar OCs nuevas. */
export function getTRM(): number {
  return getBusinessSettings().trmDefault;
}

export function saveTRM(value: number): BusinessSettings {
  const next: BusinessSettings = { trmDefault: normalizeTRM(value) };
  writeJSON(BUSINESS_SETTINGS_KEY, next);
  return next;
}

// =====================================================
// 9) TIME LOGS
// =====================================================
export function getTimeLogs(): TimeLog[] {
  return readJSON<TimeLog[]>(TIME_LOGS_KEY, []);
}

export function saveTimeLogs(logs: TimeLog[]) {
  writeJSON(TIME_LOGS_KEY, logs);
}

export function startTimeLog(taskId: string) {
  const logs = getTimeLogs();
  const newLog: TimeLog = { id: uid("log"), taskId, startTime: new Date().toISOString(), durationSeconds: 0 };
  saveTimeLogs([...logs, newLog]);
  return newLog;
}

export function stopTimeLog(logId: string) {
  const logs = getTimeLogs();
  const idx = logs.findIndex(l => l.id === logId);
  if (idx !== -1) {
    const now = new Date();
    logs[idx].endTime = now.toISOString();
    const start = new Date(logs[idx].startTime);
    logs[idx].durationSeconds = Math.floor((now.getTime() - start.getTime()) / 1000);
    saveTimeLogs(logs);
  }
}

// =====================================================
// 10) MÉTRICAS Y LIMPIEZA
// =====================================================
export function getAdvisorMetrics() {
  const users = listUsers();
  const accounts = listAccounts();
  const opportunities = listOpportunities();
  const activities = readJSON<ActivityV2[]>(ACTIVITIES_KEY, []);
  
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  return users
    .filter(u => u.role === "asesor" && u.activo)
    .map(user => {
      const userAccounts = accounts.filter(a => a.ownerId === user.id);
      const userOpps = opportunities.filter(o => o.ownerId === user.id);
      const userExpired = activities.filter((a: any) => 
        a.ownerId === user.id &&
        a.followUpAt &&
        a.status !== "realizado" &&
        new Date(a.followUpAt).getTime() < startOfToday.getTime()
      );
      return {
        userId: user.id,
        name: user.name,
        cuentas: userAccounts.length,
        oportunidades: userOpps.length,
        vencidos: userExpired.length
      };
    });
}

export function resetCRMData() {
  localStorage.removeItem(ACCOUNTS_V2_KEY);
  localStorage.removeItem(CONTACTS_V2_KEY);
  localStorage.removeItem(OPPORTUNITIES_V2_KEY);
  localStorage.removeItem(ACTIVITIES_KEY);
  localStorage.removeItem(TASKS_KEY);
  localStorage.removeItem(QUOTES_V2_KEY); 
  localStorage.removeItem("ioncore_tasks");
  localStorage.removeItem("crm_accounts");
  // Los datos cambiaron por completo: la reparación de relaciones tiene que
  // volver a correr sobre lo que se cargue después.
  invalidateRelationRepair();
}

export function clearAllCRM() {
  resetCRMData();
  localStorage.removeItem(USERS_V2_KEY);
}

// =====================================================
// 11) COTIZACIONES (QUOTES V2)
// =====================================================

function generateQuoteNumber(type: QuoteType): string {
  const quotes = listQuotes();
  const prefix = type === "servicio" ? "IC-ST" : "IC-PD";
  const sameTypeQuotes = quotes.filter((q) => q.type === type);

  if (sameTypeQuotes.length === 0) {
    return `${prefix}-0001`;
  }

  let maxNum = 0;

  sameTypeQuotes.forEach((q) => {
    const parts = q.quoteNumber.split("-");
    const lastPart = parts[parts.length - 1];
    const num = parseInt(lastPart, 10);
    if (!isNaN(num) && num > maxNum) maxNum = num;
  });

  const nextNum = String(maxNum + 1).padStart(4, "0");
  return `${prefix}-${nextNum}`;
}

export function listQuotes(): QuoteV2[] {
  ensureRelationsRepaired();
  let quotes = readJSON<QuoteV2[]>(QUOTES_V2_KEY, []);
  let changed = false;

  quotes = quotes.map((q) => {
    if (!q) return q;
    let newStatus = q.status;
    const oldStatus = q.status as string;

    if (oldStatus === "costeada") {
      newStatus = "revisada";
      changed = true;
    } else if (oldStatus === "aprobada" || oldStatus === "ganada") {
      newStatus = "con_oc";
      changed = true;
    } else if (oldStatus === "perdida") {
      newStatus = "rechazada";
      changed = true;
    }

    if (newStatus !== q.status) {
      return { ...q, status: newStatus };
    }
    return q;
  });

  if (changed) {
    writeJSON(QUOTES_V2_KEY, quotes);
  }

  return quotes
    .filter((q) => q && q.id && q.accountId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function listQuotesByUser(user?: CRMUser): QuoteV2[] {
  const activeUser = user || getActiveUser();
  const allQuotes = listQuotes();
  if (activeUser?.role === "director") return allQuotes;
  return allQuotes.filter((q) => q.ownerId === activeUser?.id);
}

export function getQuote(id: string): QuoteV2 | undefined {
  return listQuotes().find((q) => q.id === id);
}

export function createQuote(
  input: Omit<
    QuoteV2,
    | "id"
    | "quoteNumber"
    | "version"
    | "createdAt"
    | "updatedAt"
    | "ownerId"
  > & { id?: string; quoteNumber?: string; ownerId?: string }
): QuoteV2 {
  const quotes = listQuotes();
  const user = getActiveUser();
  const now = new Date().toISOString();

  const quote: QuoteV2 = {
    id: input.id || uid("qt"),
    quoteNumber: input.quoteNumber || generateQuoteNumber(input.type),
    version: 1,
    ownerId: input.ownerId || user?.id || "system",
    createdAt: now,
    updatedAt: now,
    ...input,
  } as QuoteV2;

  writeJSON(QUOTES_V2_KEY, [quote, ...quotes]);
  syncOpportunityStageFromQuote(quote, "Cotización");

  return quote;
}

export function updateQuote(quote: QuoteV2): void {
  const quotes = listQuotes();
  const index = quotes.findIndex((q) => q.id === quote.id);
  if (index !== -1) {
    quotes[index] = {
      ...quote,
      updatedAt: new Date().toISOString(),
    };
    writeJSON(QUOTES_V2_KEY, quotes);
  }
}

export function patchQuote(
  quoteId: string,
  patch: Partial<Omit<QuoteV2, "id" | "createdAt" | "quoteNumber">>
): void {
  const quotes = listQuotes();
  const index = quotes.findIndex((q) => q.id === quoteId);
  if (index !== -1) {
    quotes[index] = {
      ...quotes[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    writeJSON(QUOTES_V2_KEY, quotes);
  }
}

export function updateQuoteStatus(
  quoteId: string,
  status: QuoteV2["status"],
  rejectionReason?: string,
  closeOpp?: boolean,
  fechaOC?: string,
  trmAplicada?: number,
  numeroOC?: string,
  valorOC?: number
): void {
  const quotes = listQuotes();
  const index = quotes.findIndex((q) => q.id === quoteId);
  if (index !== -1) {
    const now = new Date().toISOString();
    const q = quotes[index];

    let finalFechaOC = fechaOC || q.fechaOC || todayLocal();
    let finalTrm = trmAplicada || q.trmAplicada || getTRM();

    const period = finalFechaOC.slice(0, 7);
    const budget = getBudgetForAdvisor(q.ownerId || "system", period, "mensual");
    const metaCurrency = budget?.monedaMeta || 'COP';

    let valorConvertido = q.total;
    if (status === "con_oc") {
      if (q.currency !== metaCurrency) {
        if (q.currency === "USD" && metaCurrency === "COP") {
          valorConvertido = q.total * finalTrm;
        } else if (q.currency === "COP" && metaCurrency === "USD") {
          valorConvertido = q.total / finalTrm;
        }
      }
    }

    quotes[index] = {
      ...q,
      status,
      updatedAt: now,
      sentAt: (status === "enviada" || (status === "con_oc" && !q.sentAt)) ? (q.sentAt || now) : q.sentAt,
      approvedAt: status === "con_oc" ? (q.approvedAt || now) : q.approvedAt,
      rejectedAt: status === "rechazada" ? now : q.rejectedAt,
      cancelledAt: status === "cancelada" ? now : q.cancelledAt,
      rejectionReason: rejectionReason !== undefined ? rejectionReason : q.rejectionReason,
      // Guardar campos de conversión y OC
      numeroOC: status === "con_oc" ? (numeroOC !== undefined ? numeroOC : q.numeroOC) : q.numeroOC,
      valorOC: status === "con_oc" ? (valorOC !== undefined ? valorOC : (q.valorOC || q.total)) : q.valorOC,
      fechaOC: status === "con_oc" ? finalFechaOC : q.fechaOC,
      trmAplicada: status === "con_oc" ? finalTrm : q.trmAplicada,
      fechaTRM: status === "con_oc" ? finalFechaOC : q.fechaTRM,
      valorConvertidoAMonedaMeta: status === "con_oc" ? valorConvertido : q.valorConvertidoAMonedaMeta,
      monedaMeta: status === "con_oc" ? metaCurrency : q.monedaMeta,
      valorOriginal: status === "con_oc" ? q.total : q.valorOriginal,
      monedaOriginal: status === "con_oc" ? q.currency : q.monedaOriginal,
    };

    writeJSON(QUOTES_V2_KEY, quotes);

    if (
      status === "borrador" ||
      status === "pendiente_costo_proveedor" ||
      status === "revisada" ||
      status === "enviada"
    ) {
      syncOpportunityStageFromQuote(quotes[index], "Cotización");
    }

    if (status === "con_oc") {
      syncOpportunityStageFromQuote(quotes[index], "Ganado");
    }

    if (status === "rechazada" && closeOpp) {
      syncOpportunityStageFromQuote(quotes[index], "Perdido");
    }
  }
}

export function duplicateQuote(quoteId: string): QuoteV2 | null {
  const original = getQuote(quoteId);
  if (!original) return null;

  const now = new Date().toISOString();
  const duplicated: QuoteV2 = {
    ...original,
    id: uid("qt"),
    quoteNumber: generateQuoteNumber(original.type),
    version: (original.version || 1) + 1,
    status: "borrador",
    sentAt: undefined,
    approvedAt: undefined,
    rejectedAt: undefined,
    cancelledAt: undefined,
    createdAt: now,
    updatedAt: now,
  };

  const quotes = listQuotes();
  writeJSON(QUOTES_V2_KEY, [duplicated, ...quotes]);
  return duplicated;
}

export function deleteQuote(quoteId: string): void {
  const quotes = listQuotes();
  const filtered = quotes.filter((q) => q.id !== quoteId);
  writeJSON(QUOTES_V2_KEY, filtered);
}

export const ADVISOR_BUDGETS_V2_KEY = "crm_advisor_budgets_v2";

export function listBudgets(): AdvisorBudgetV2[] {
  const budgets = readJSON<AdvisorBudgetV2[] | null>(ADVISOR_BUDGETS_V2_KEY, null);
  if (!budgets) {
    // Las metas semilla se anclan al mes en curso, no a julio de 2026. Con la
    // fecha fija, cualquiera que abriera el CRM después de julio arrancaba sin
    // meta para el periodo actual y todos los avances se veían en 0%.
    const periodo = currentPeriod("mensual");
    const bounds = periodBounds(periodo, "mensual")!;
    const seed = (advisorId: string, cop: number, usd: number): AdvisorBudgetV2 => ({
      id: `bd_${advisorId}_${periodo.replace("-", "_")}`,
      advisorId,
      periodo,
      tipoPeriodo: "mensual",
      presupuestoCOP: cop,
      presupuestoUSD: usd,
      fechaInicio: bounds.fechaInicio,
      fechaFin: bounds.fechaFin,
      monedaMeta: "COP",
      presupuestoAsignado: cop
    });

    const defaultBudgets: AdvisorBudgetV2[] = [
      seed("juan_sierra", 1000000, 500),
      seed("andres_asesor", 800000, 400)
    ];
    writeJSON(ADVISOR_BUDGETS_V2_KEY, defaultBudgets);
    return defaultBudgets;
  }
  return budgets;
}

export function saveBudget(budget: AdvisorBudgetV2): void {
  const user = getActiveUser();
  if (user?.role !== "director") {
    throw new Error("Solo el Director Comercial puede gestionar metas");
  }
  const budgets = listBudgets();
  const index = budgets.findIndex(b => b.id === budget.id);
  if (index !== -1) {
    budgets[index] = budget;
  } else {
    budgets.push(budget);
  }
  writeJSON(ADVISOR_BUDGETS_V2_KEY, budgets);
}

export function getBudgetForAdvisor(
  advisorId: string,
  periodo: string,
  tipoPeriodo: 'mensual' | 'trimestral' | 'anual'
): AdvisorBudgetV2 | undefined {
  const budgets = listBudgets();
  return budgets.find(
    (b) =>
      b.advisorId === advisorId &&
      b.periodo === periodo &&
      b.tipoPeriodo === tipoPeriodo
  );
}