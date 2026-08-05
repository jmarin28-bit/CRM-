// services/radar.ts
// Adaptador que consume exclusivamente métricas centralizadas de analytics.ts
// No duplica cálculos, solo formatea datos para la UI

import {
  getDirectorDashboard,
  getStalledOpportunities,
  getOpportunitiesByStage,
  getAccountHealthMetrics,
  BUSINESS_RULES
} from "./analytics";

import {
  listOpportunitiesByUser,
  listActivitiesByUser,
  listAccountsByUser
} from "./storage";

export function getCommercialRadar() {
  const analytics = getDirectorDashboard();

  // 🔥 OPORTUNIDADES CALIENTES (desde analytics centralizado)
  const hotDeals = analytics.hotDeals;

  // ⚠ OPORTUNIDADES EN RIESGO
  // Usa getStalledOpportunities con threshold más agresivo (10 días vs 14 por defecto)
  const riskDeals = getStalledOpportunities(10);

  // ❄ CUENTAS SIN ACTIVIDAD
  // Obtiene lista de oportunidades por cuenta desde analytics para identificar cuentas inactivas
  const opportunitiesByStage = analytics.opportunitiesByStage;

  // Importa actividades solo para detectar inactividad
  // (Este es el mínimo necesario que no puede venir de analytics aún)
  const activities = listActivitiesByUser();
  const accounts = listAccountsByUser();
  const now = Date.now();

  const coldAccounts = accounts.filter(acc => {
    // Busca la actividad más reciente de esta cuenta
    const lastActivity = activities
      .filter(a => a.accountId === acc.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!lastActivity) return true; // Sin actividades = cuenta fría

    const daysSinceActivity = (now - new Date(lastActivity.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceActivity > 30; // Más de 30 días sin actividad
  });

  // 📈 UPSELL - Cuentas con múltiples oportunidades abiertas
  // Consume oportunidades por etapa para identificar cuentas con potencial upsell
  const allOpportunities = listOpportunitiesByUser();
  const upsell = accounts.filter(acc => {
    // Cuenta cuántas oportunidades abiertas tiene esta cuenta
    const accountOpps = allOpportunities.filter(o =>
      o.accountId === acc.id &&
      o.etapa !== "Ganado" &&
      o.etapa !== "Perdido"
    );

    return accountOpps.length >= 2; // 2+ oportunidades = oportunidad de upsell
  });

  return {
    hotDeals,
    riskDeals,
    coldAccounts,
    upsell
  };
}