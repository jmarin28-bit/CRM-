// services/analytics.ts
// Motor centralizado de inteligencia comercial del CRM
// Todas las reglas de negocio, constantes y métricas se definen aquí

import {
  getTRM,
  TRM_FALLBACK,
  listOpportunitiesByUser,
  listUpcomingActivities,
  listOverdueActivities,
  getAdvisorMetrics,
  listQuotesByUser,
  listAccountsByUser,
  listContactsByUser
} from "./storage";

// AISLAMIENTO POR ASESOR: todas las métricas usan las funciones *ByUser de storage,
// que devuelven SOLO los registros del usuario autenticado (el director ve todo).
// Nunca usar listOpportunities()/listQuotes() globales aquí.

// ============================================================
// CONSTANTES DE NEGOCIO CENTRALIZADAS
// ============================================================
export const BUSINESS_RULES = {
  // Oportunidades
  HOT_OPPORTUNITY_MIN_PROBABILITY: 70,
  STALLED_DAYS_THRESHOLD: 14,

  // Cotizaciones
  QUOTE_CONVERSION_RATE_THRESHOLD: 0.25, // 25% de cotizaciones convertidas = bueno
  QUOTE_AVG_DAYS_THRESHOLD: 30, // promedio de días para convertir una cota

  // Moneda y conversión.
  // Solo el fallback: la TRM vigente la edita el director y se lee con
  // getTRM(). Usar toCOP() en vez de esta constante.
  TRM_DEFAULT: TRM_FALLBACK,

  // Actividades
  ACTIVITY_OVERDUE_DAYS: 0,

  // KPIs estándares
  DEFAULT_SALES_PROBABILITY_BY_STAGE: {
    "Prospecto": 10,
    "Calificado": 25,
    "Propuesta": 50,
    "Negociación": 75,
    "Ganado": 100,
    "Perdido": 0,
  } as Record<string, number>,

  // Multiplicadores de potencial
  ACCOUNT_ACTIVITY_MULTIPLIER: 1.2, // 20% más valor si tiene actividad reciente
};

// ============================================================
// HELPERS COMPARTIDOS DE MONEDA Y ETAPAS
// ============================================================

/**
 * Etapas cerradas: ya no forman parte del pipeline vivo.
 * El patrón `etapa !== "Ganado" && etapa !== "Perdido"` estaba repetido en
 * media docena de archivos; centralizarlo evita que un cambio de nombre de
 * etapa deje algunos cálculos desactualizados y otros no.
 */
export const CLOSED_STAGES = ["Ganado", "Perdido"] as const;

export function isOpenStage(stage: string): boolean {
  return !CLOSED_STAGES.includes(stage as (typeof CLOSED_STAGES)[number]);
}

/**
 * Convierte un valor a COP usando la TRM centralizada.
 *
 * Sumar `valor` sin mirar `moneda` produce totales sin sentido: 1.000 USD y
 * 1.000 COP no son la misma cifra, pero la UI formatea el resultado como COP.
 * Toda suma de dinero que se vaya a mostrar en pesos debe pasar por acá.
 */
export function toCOP(valor: number, moneda?: string): number {
  const base = Number.isFinite(valor) ? valor : 0;
  return moneda === "USD" ? base * getTRM() : base;
}

// ============================================================
// FUNCIONES EXISTENTES (BACKWARD COMPATIBLE)
// ============================================================

// 🔥 OPORTUNIDADES CALIENTES
export function getHotOpportunities() {
  const opps = listOpportunitiesByUser();

  return opps
    .filter(o =>
      o.probabilidad >= BUSINESS_RULES.HOT_OPPORTUNITY_MIN_PROBABILITY &&
      o.etapa !== "Ganado" &&
      o.etapa !== "Perdido"
    )
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 5);
}

// ⚠ OPORTUNIDADES ESTANCADAS
export function getStalledOpportunities(days = BUSINESS_RULES.STALLED_DAYS_THRESHOLD) {
  const opps = listOpportunitiesByUser();
  const now = Date.now();

  return opps.filter(o => {
    const updated = new Date(o.updatedAt).getTime();
    const diffDays = (now - updated) / (1000 * 60 * 60 * 24);

    return (
      diffDays > days &&
      o.etapa !== "Ganado" &&
      o.etapa !== "Perdido"
    );
  });
}

// 💰 FORECAST COMERCIAL
export function getSalesForecast() {
  const opps = listOpportunitiesByUser();

  return opps.reduce((sum, o) => {
    const valorCOP = toCOP(o.valor, o.moneda);
    const weightedValue = valorCOP * (o.probabilidad / 100);
    return sum + weightedValue;
  }, 0);
}

// ============================================================
// NUEVAS FUNCIONES: ANÁLISIS DE OPORTUNIDADES
// ============================================================

export interface OpportunitiesByStage {
  stage: string;
  count: number;
  totalValue: number;
  totalValueCOP: number;
  avgProbability: number;
  avgValue: number;
}

export function getOpportunitiesByStage(): OpportunitiesByStage[] {
  const opps = listOpportunitiesByUser();
  const byStage = new Map<string, typeof opps>();

  opps.forEach(o => {
    if (!byStage.has(o.etapa)) {
      byStage.set(o.etapa, []);
    }
    byStage.get(o.etapa)!.push(o);
  });

  return Array.from(byStage.entries()).map(([stage, stageOpps]) => {
    const totalValue = stageOpps.reduce((sum, o) => sum + o.valor, 0);
    const totalValueCOP = stageOpps.reduce((sum, o) => {
      return sum + toCOP(o.valor, o.moneda);
    }, 0);
    const avgProbability = stageOpps.length > 0
      ? stageOpps.reduce((sum, o) => sum + o.probabilidad, 0) / stageOpps.length
      : 0;

    return {
      stage,
      count: stageOpps.length,
      totalValue,
      totalValueCOP,
      avgProbability,
      avgValue: totalValue / stageOpps.length,
    };
  });
}

export interface OpportunityHealthMetrics {
  totalOpenOpportunities: number;
  totalValueCOP: number;
  weightedForecastCOP: number;
  avgDaysInCurrentStage: number;
  conversionRateLastQuarter: number; // porcentaje ganadas / total cerradas
}

export function getOpportunityHealthMetrics(): OpportunityHealthMetrics {
  const opps = listOpportunitiesByUser();
  const openOpps = opps.filter(o => o.etapa !== "Ganado" && o.etapa !== "Perdido");
  const closedOpps = opps.filter(o => o.etapa === "Ganado" || o.etapa === "Perdido");
  const wonOpps = opps.filter(o => o.etapa === "Ganado");

  const totalValueCOP = openOpps.reduce((sum, o) => {
    return sum + toCOP(o.valor, o.moneda);
  }, 0);

  const avgDaysInCurrentStage = openOpps.length > 0
    ? openOpps.reduce((sum, o) => {
        const created = new Date(o.createdAt).getTime();
        const now = Date.now();
        const days = (now - created) / (1000 * 60 * 60 * 24);
        return sum + days;
      }, 0) / openOpps.length
    : 0;

  const conversionRateLastQuarter = closedOpps.length > 0
    ? (wonOpps.length / closedOpps.length) * 100
    : 0;

  return {
    totalOpenOpportunities: openOpps.length,
    totalValueCOP,
    weightedForecastCOP: getSalesForecast(),
    avgDaysInCurrentStage,
    conversionRateLastQuarter,
  };
}

// ============================================================
// NUEVAS FUNCIONES: ANÁLISIS DE COTIZACIONES
// ============================================================

export interface QuoteMetrics {
  totalQuotes: number;
  quotedValue: number;
  quotedValueCOP: number;
  avgDaysToClose: number;
  conversionRate: number;
  conversionValue: number;
  conversionValueCOP: number;
}

export function getQuoteMetrics(): QuoteMetrics {
  const quotes = listQuotesByUser();

  // Campos reales de QuoteV2: status ('con_oc' = aceptada con orden de compra,
  // 'rechazada', 'vencida', 'cancelada') y currency ('COP' | 'USD').
  const closedQuotes = quotes.filter(q =>
    q.status === "con_oc" || q.status === "rechazada" || q.status === "vencida" || q.status === "cancelada"
  );
  const acceptedQuotes = quotes.filter(q => q.status === "con_oc");

  const totalQuotedValue = quotes.reduce((sum, q) => {
    const baseValue = q.items?.reduce((itemSum, item) =>
      itemSum + ((item.quantity || 0) * (item.unitPrice || 0)), 0) || 0;
    return sum + baseValue;
  }, 0);

  const totalQuotedValueCOP = quotes.reduce((sum, q) => {
    const baseValue = q.items?.reduce((itemSum, item) =>
      itemSum + ((item.quantity || 0) * (item.unitPrice || 0)), 0) || 0;
    const currency = q.currency || "COP";
    return sum + toCOP(baseValue, currency);
  }, 0);

  const avgDaysToClose = closedQuotes.length > 0
    ? closedQuotes.reduce((sum, q) => {
        const created = new Date(q.createdAt).getTime();
        const closed = new Date(q.updatedAt).getTime();
        const days = (closed - created) / (1000 * 60 * 60 * 24);
        return sum + days;
      }, 0) / closedQuotes.length
    : 0;

  const conversionRate = quotes.length > 0
    ? (acceptedQuotes.length / quotes.length) * 100
    : 0;

  const acceptedValue = acceptedQuotes.reduce((sum, q) => {
    const baseValue = q.items?.reduce((itemSum, item) =>
      itemSum + ((item.quantity || 0) * (item.unitPrice || 0)), 0) || 0;
    return sum + baseValue;
  }, 0);

  const acceptedValueCOP = acceptedQuotes.reduce((sum, q) => {
    const baseValue = q.items?.reduce((itemSum, item) =>
      itemSum + ((item.quantity || 0) * (item.unitPrice || 0)), 0) || 0;
    const currency = q.currency || "COP";
    return sum + toCOP(baseValue, currency);
  }, 0);

  return {
    totalQuotes: quotes.length,
    quotedValue: totalQuotedValue,
    quotedValueCOP: totalQuotedValueCOP,
    avgDaysToClose,
    conversionRate,
    conversionValue: acceptedValue,
    conversionValueCOP: acceptedValueCOP,
  };
}

// ============================================================
// NUEVAS FUNCIONES: ANÁLISIS DE CUENTAS
// ============================================================

export interface AccountHealthMetrics {
  totalAccounts: number;
  accountsWithActivity: number;
  accountsWithOpportunities: number;
  totalPotentialValueCOP: number;
  avgOpportunitiesPerAccount: number;
}

export function getAccountHealthMetrics(): AccountHealthMetrics {
  const accounts = listAccountsByUser();
  const opps = listOpportunitiesByUser();
  const activities = listUpcomingActivities();

  const accountsWithOpps = new Set(opps.map(o => o.accountId));
  const accountsWithActs = new Set(activities.map(a => a.accountId));

  const totalPotentialValueCOP = opps.reduce((sum, o) => {
    return sum + toCOP(o.valor, o.moneda);
  }, 0);

  const avgOpportunitiesPerAccount = accounts.length > 0
    ? opps.length / accounts.length
    : 0;

  return {
    totalAccounts: accounts.length,
    accountsWithActivity: accountsWithActs.size,
    accountsWithOpportunities: accountsWithOpps.size,
    totalPotentialValueCOP,
    avgOpportunitiesPerAccount,
  };
}

// ============================================================
// FUNCIONES CONSOLIDADAS
// ============================================================

export interface ConsolidatedMetrics {
  opportunities: OpportunityHealthMetrics;
  quotes: QuoteMetrics;
  accounts: AccountHealthMetrics;
  forecast: number;
  upcomingActivities: number;
  overdueActivities: number;
}

export function getConsolidatedMetrics(): ConsolidatedMetrics {
  return {
    opportunities: getOpportunityHealthMetrics(),
    quotes: getQuoteMetrics(),
    accounts: getAccountHealthMetrics(),
    forecast: getSalesForecast(),
    upcomingActivities: listUpcomingActivities().length,
    overdueActivities: listOverdueActivities().length,
  };
}

// 📊 DASHBOARD COMPLETO (MEJORADO)
export function getDirectorDashboard() {
  return {
    // Datos existentes (backward compatible)
    hotDeals: getHotOpportunities(),
    stalledDeals: getStalledOpportunities(),
    upcomingActivities: listUpcomingActivities(),
    overdueActivities: listOverdueActivities(),
    advisorMetrics: getAdvisorMetrics(),
    forecast: getSalesForecast(),

    // Nuevos datos consolidados
    metrics: getConsolidatedMetrics(),
    opportunitiesByStage: getOpportunitiesByStage(),
  };
}