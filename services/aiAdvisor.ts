// services/aiAdvisor.ts

import { listAccounts, listActivitiesByUser, listOpportunities } from "./storage";
import { getCommercialRadar } from "./radar";

export function getAIRecommendations() {

  const radar = getCommercialRadar();
  const opportunities = listOpportunities();
  const activities = listActivitiesByUser();
  const accounts = listAccounts();

  const recommendations: string[] = [];

  // 🔥 cerrar oportunidades calientes
  radar.hotDeals.forEach(deal => {
    recommendations.push(`🔥 Intentar cerrar "${deal.titulo}" (alta probabilidad).`);
  });

  // ⚠ oportunidades en riesgo
  radar.riskDeals.forEach(deal => {
    recommendations.push(`⚠ Reactivar negociación "${deal.titulo}" antes de perderla.`);
  });

  // ❄ cuentas frías
  radar.coldAccounts.slice(0,3).forEach(acc => {
    const name = acc.nombreComercial || acc.razonSocial;
    recommendations.push(`📞 Contactar nuevamente la cuenta "${name}" (sin actividad reciente).`);
  });

  // 📈 upsell
  radar.upsell.slice(0,3).forEach(acc => {
    const name = acc.nombreComercial || acc.razonSocial;
    recommendations.push(`📈 Explorar venta adicional con "${name}" (cliente activo).`);
  });

  if (recommendations.length === 0) {
    recommendations.push("Todo el pipeline está saludable. Continúa generando nuevas oportunidades.");
  }

  return recommendations.slice(0,6);
}