import React from "react";
import CommercialGuidePanel from "../components/agent/CommercialGuidePanel";

export default function CommercialGuide() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-900 dark:text-white">
          Director Comercial IA · voz automática v2
        </h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Analiza prioridades, riesgos, memoria comercial y próximos pasos del CRM mediante comandos de voz automáticos.
        </p>
      </div>

      <CommercialGuidePanel />
    </div>
  );
}