// types.ts

// ==============================
// Tipos base (Legacy/Referencia)
// ==============================

export enum AccountStatus {
  PROSPECT = 'Prospecto',
  ACTIVE = 'Cliente Activo',
  COLD = 'Lead Frío',
  EX_CLIENT = 'Ex-cliente'
}

export type Account = {
  id: string;
  name: string;
  nit: string;
  sector: string;
  location: string;
  status: AccountStatus;
  createdAt: string;
  notes?: string;
  commercialName?: string;
  vendedor_asignado?: string;
  score?: number;
};

export type Contact = {
  id: string;
  accountId: string;
  fullName: string;
  role: string;
  email: string;
  phone: string;
  notes?: string;
};

export type Interaction = {
  id: string;
  accountId: string;
  type: string;
  date: string;
  description?: string;
  summary?: string;
  agreements?: string[];
  nextStep?: string;
};

export type PipelineStage = {
  id: string;
  name: string;
  color: string;
  order: number;
};

export type Deal = {
  id: string;
  title: string;
  value: number;
  currency: string;
  stageId: string;
  accountId: string;
  contactId?: string;
  expectedCloseDate: string;
  owner: string;
  aiScore?: number;
  aiJustification?: string;
  aiSuggestedAction?: string;
};

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  dataPreview?: {
    accounts: Account[];
    contacts: Contact[];
  };
}

export type AutomationConfig = {
  scriptUrl: string;
  templateId: string;
  enabled: boolean;
};

export type TaskStatus = "Pendiente" | "Por hacer" | "En progreso" | "Finalizado";
export type TaskPriority = "Baja" | "Media" | "Alta";

// ✅ CORRECCIÓN: Task actualizado con nuevas relaciones
export type Task = {
  id: string;
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  status: TaskStatus;
  startDate: string;
  endDate: string;
  assignedTo: string;
  estimatedTime?: number; // minutos
  createdAt: string;
  createdBy?: string;
  completedAt?: string;
  completedBy?: string;
  reopenedAt?: string;
  reopenedBy?: string;
};

export type TimeLog = {
  id: string;
  taskId: string;
  startTime: string;
  endTime?: string;
  durationSeconds: number;
};

// ==============================
// CRM v2 (Estructura Actualizada)
// ==============================

export type SectorOption = "Farma" | "Lab Terceros" | "Petróleo" | "Ambiental" | "Alimentos" | "Otros";

export type ClientClassificationOption = "AAA" | "AA" | "A" | "B" | "C";

export type AccountV2 = {
  id: string;
  ownerId: string; // ID del usuario dueño de la cuenta
  razonSocial: string;
  nombreComercial: string;
  nit: string;
  sector: SectorOption | "";
  clasificacion: ClientClassificationOption | "";
  sede?: string;
  ciudad: string;
  direccion: string;
  createdAt: string;
  updatedAt?: string;
};

export type ContactV2 = {
  id: string;
  ownerId: string; // ID del usuario dueño del contacto
  accountId: string;
  fullName: string;
  role: string;
  email: string;
  phone: string;
  whatsapp: string;
  createdAt: string;
  updatedAt?: string;
  name?: string; // legado: registros antiguos usaban "name" en lugar de "fullName"
};

// ✅ CAMBIO SOLICITADO: "Contactado" ahora es la primera etapa
export type OpportunityStage =
  | "Contactado"
  | "Prospecto"
  | "Calificado"
  | "Cotización"
  | "Negociación"
  | "Ganado"
  | "Perdido";

export type CurrencyOption = "COP" | "USD";

/**
 * Constantes de negocio que el director puede editar desde la UI.
 *
 * trmDefault es la TRM que se usa para:
 *   - convertir a COP en reportes (pipeline, forecast, metas)
 *   - prellenar la TRM al confirmar una OC
 *
 * NO reemplaza a `trmAplicada` de cada cotización: esa queda congelada al
 * momento de la OC y es el registro contable. Cambiar trmDefault mueve los
 * reportes de negocio abierto, pero no revalúa lo ya cerrado.
 */
export type BusinessSettings = {
  trmDefault: number;
};

export type OpportunityV2 = {
  id: string;
  accountId: string;
  contactId: string;
  ownerId: string; 
  titulo: string;
  etapa: OpportunityStage;
  valor: number;
  moneda: CurrencyOption;
  probabilidad: number;
  fechaEstimadaCierre: string;
  createdAt: string;
  updatedAt: string;
  quoteId?: string;

  // Cierre por pérdida. Se escriben desde el modal "Marcar como perdida"
  // (Pipeline.tsx) y no estaban declarados: como ahí el objeto se arma en una
  // variable antes de pasarlo, TypeScript no aplica el chequeo de propiedades
  // excedentes y los campos entraban sin que el tipo se enterara.
  perdidoMotivo?: string;
  perdidoNotas?: string;
};

// ==============================
// Usuarios y Asesores
// ==============================

export type AdvisorV2 = {
  id: string;
  nombre: string;
  activo: boolean;
  createdAt: string;
};

export type CRMUserRole = "director" | "asesor";

export type CRMUser = {
  id: string;
  name: string;
  email: string;
  password: string; // ✅ clave de acceso al CRM
  role: CRMUserRole;
  activo: boolean;
  createdAt: string;
};

// ==============================
// Seguimientos / Actividades
// ==============================

export type ActivityType = "Llamada" | "Reunión" | "Videollamada" | "Visita" | "Correo" | "Agenda" | "Nota" | string;

/**
 * Estados que realmente se escriben y se comparan en la app.
 * "realizado" y "completada" conviven porque el código las trata como
 * equivalentes en los filtros (Dashboard, Axis, storage); no unificarlas acá
 * para no romper datos ya guardados en localStorage.
 */
export type ActivityStatus = "pendiente" | "completada" | "realizado" | "cancelada" | "sent" | string;

export type ActivityV2 = {
  id: string;
  ownerId: string; // ID del usuario dueño del seguimiento
  accountId: string;
  contactId?: string;
  type: ActivityType;
  description: string;
  user: string; // nombre legible de quien registró
  createdAt: string;
  updatedAt?: string; // lo escribe updateActivity
  completedAt?: string | null; // fecha en que se marcó como realizada/completada
  completedBy?: string; // usuario que marcó como completado
  resultNote?: string; // nota o resultado de la gestión
  followUpAt?: string | null;
  status?: ActivityStatus;
  followUpActivityId?: string; // vínculo entre gestión y su seguimiento programado

  // Metadatos del correo cuando la actividad se generó al enviar por Gmail
  // (Contacts.tsx). Tampoco estaban declarados: createActivity recibía `any`,
  // así que cualquier campo pasaba sin chequeo.
  gmailMessageId?: string;
  threadId?: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  sentAt?: string;
};

/**
 * Lo que un llamador puede pasarle a createActivity.
 * id / ownerId / user / createdAt los genera el storage a partir del usuario
 * activo, así que no se aceptan desde afuera.
 */
export type ActivityInput = Omit<
  ActivityV2,
  "id" | "ownerId" | "user" | "createdAt"
>;

// ==============================
// ✅ Cotizaciones (NUEVO MÓDULO)
// ==============================

export type QuoteType = 'producto' | 'servicio';

export type QuoteCurrency = 'COP' | 'USD';

export type QuoteStatus =
  | 'borrador'
  | 'pendiente_costo_proveedor'
  | 'revisada'
  | 'enviada'
  | 'con_oc'
  | 'rechazada'
  | 'cancelada'
  | 'vencida';

export type QuoteItemType = 'producto' | 'servicio' | 'gasto';

export type QuoteUnit =
  | 'unidad'
  | 'producto'
  | 'hora'
  | 'dia'
  | 'servicio'
  | 'lote'
  | 'global'
  | 'otro';

export interface QuoteTerms {
  validityText: string;
  billingText: string;
  paymentTermsText: string;
  paymentMethodText: string;
  deliveryPlaceText: string;
  deliveryTimeText: string;
  warrantyText: string;
  cancellationText: string;
}

export interface QuoteNotes {
  publicNotes?: string;
  technicalObservations?: string;
  internalNotes?: string;
}

export interface QuoteItem {
  id: string;
  itemType: QuoteItemType;
  code?: string;
  name?: string;
  description: string;
  quantity: number;
  unit: QuoteUnit;
  currency: QuoteCurrency;
  taxRate?: number;

  unitPrice: number;
  total: number;

  groupTitle?: string;
  sortOrder?: number;

  // Producto
  supplierName?: string;
  supplierCost?: number;
  supplierCurrency?: QuoteCurrency;
  trm?: number;
  marginPercent?: number;
  salePrice?: number;
  availabilityNote?: string;
  supplierQuoteDate?: string;

  // Servicio
  serviceMode?: 'fijo' | 'variable';
  fixedRate?: boolean;
  isVariable?: boolean;
  requiresTravel?: boolean;
}

export interface QuoteV2 {
  id: string;
  quoteNumber: string;

  type: QuoteType;
  status: QuoteStatus;
  version: number;

  accountId: string;
  contactId?: string;
  opportunityId?: string;
  ownerId?: string;

  providerName?: string;
  deliveryAddress?: string;
  deliveryCity?: string;

  currency: QuoteCurrency;

  issueDate: string;
  validUntil: string;

  subtotal: number;
  tax: number;
  total: number;

  items: QuoteItem[];
  terms: QuoteTerms;
  notes?: QuoteNotes;

  sentAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  cancelledAt?: string;
  rejectionReason?: string;

  // Nuevos campos para conversión y OC
  numeroOC?: string;
  valorOC?: number;
  fechaOC?: string;
  trmAplicada?: number;
  valorConvertidoAMonedaMeta?: number;
  fechaTRM?: string;
  monedaMeta?: QuoteCurrency;
  valorOriginal?: number;
  monedaOriginal?: QuoteCurrency;

  createdAt: string;
  updatedAt: string;
}

export interface AdvisorBudgetV2 {
  id: string;
  advisorId: string;
  periodo: string; // e.g. "2026-07"
  tipoPeriodo: 'mensual' | 'trimestral' | 'anual';
  presupuestoCOP: number;
  presupuestoUSD: number;
  fechaInicio: string; // "YYYY-MM-DD"
  fechaFin: string; // "YYYY-MM-DD"

  // Nuevos campos obligatorios
  monedaMeta?: 'COP' | 'USD';
  presupuestoAsignado?: number;
}