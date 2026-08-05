// services/insights.ts

import { listOpportunities, listAccounts, listActivities } from "./storage";

export function getHotDeals() {
  const opps = listOpportunities();

  return opps
    .filter(o => o.probabilidad >= 70 && o.etapa !== "Ganado" && o.etapa !== "Perdido")
    .sort((a,b)=> b.valor - a.valor)
    .slice(0,5);
}

export function getRiskDeals(days = 14) {

  const opps = listOpportunities();
  const now = Date.now();

  return opps.filter(o => {

    const updated = new Date(o.updatedAt).getTime();
    const diff = (now - updated) / (1000*60*60*24);

    return diff > days && o.etapa !== "Ganado" && o.etapa !== "Perdido";

  });
}

export function getColdAccounts(days = 30) {

  const accounts = listAccounts();
  const activities = listActivities({});
  const now = Date.now();

  return accounts.filter(acc => {

    const lastActivity = activities
      .filter(a => a.accountId === acc.id)
      .sort((a,b)=> new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!lastActivity) return true;

    const diff = (now - new Date(lastActivity.createdAt).getTime()) / (1000*60*60*24);

    return diff > days;

  });
}

export function getUpsellOpportunities() {

  const accounts = listAccounts();
  const opps = listOpportunities();

  return accounts.filter(acc => {

    const accountOpps = opps.filter(o => o.accountId === acc.id);

    return accountOpps.length >= 2;

  });
}