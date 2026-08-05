import { jsPDF } from "jspdf";
import { AccountV2, OpportunityV2, ActivityV2, OpportunityStage } from "../types";
import { 
  createActivity, 
  listOpportunities, 
  saveOpportunities, 
  getAutomationConfig, 
  listUsers
} from "./storage";
import { triggerGoogleScript } from "./googleScript";

// --- 1. ROUND ROBIN ASSIGNMENT (CRM USERS) ---
// Movido a storage.ts para evitar dependencia circular

// --- 2. LOCAL PDF GENERATION (FALLBACK) ---
export const generateQuotePDF = (opp: OpportunityV2, account: AccountV2): Blob => {
  const doc = new jsPDF();
  
  // Header
  doc.setFontSize(22);
  doc.setTextColor(37, 99, 235); // Blue
  doc.text("IONCORE SAS", 20, 20);
  
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text("Nit: 900.000.000-1", 20, 26);
  doc.text("Bogotá, Colombia", 20, 31);
  doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 150, 20);
  
  // Title
  doc.setFontSize(16);
  doc.setTextColor(0);
  doc.text("COTIZACIÓN FORMAL", 20, 50);
  
  // Client Info
  doc.setFontSize(12);
  doc.text(`Cliente: ${account.nombreComercial || account.razonSocial}`, 20, 65);
  doc.text(`NIT: ${account.nit}`, 20, 72);
  doc.text(`Atención: ${opp.ownerId}`, 20, 79);
  
  // Deal Details
  doc.setLineWidth(0.5);
  doc.line(20, 90, 190, 90);
  
  doc.setFontSize(14);
  doc.text(`Concepto: ${opp.titulo}`, 20, 105);
  
  doc.setFontSize(16);
  doc.setTextColor(37, 99, 235);
  doc.text(`Total: $ ${opp.valor.toLocaleString('es-CO')}`, 140, 105);
  
  doc.setTextColor(0);
  doc.setFontSize(10);
  doc.text("Esta oferta es válida por 30 días calendario.", 20, 130);
  
  return doc.output('blob');
};

// --- 3. WORKFLOW AUTOMATION ENGINE ---
export const checkAutomationRules = async (
  oppId: string, 
  newStageId: string, 
  accounts: AccountV2[],
  onUpdateOpp: (o: OpportunityV2[]) => void
) => {
  
  // RULE: "Cotizado" (Proposal) -> Automation
  if (newStageId === 'Cotizado') {
    const opps = listOpportunities();
    const opp = opps.find(o => o.id === oppId);
    if (!opp) return;
    
    const account = accounts.find(a => a.id === opp.accountId);
    if (!account) return;

    // Check configuration
    const config = getAutomationConfig();

    if (config.enabled && config.scriptUrl && config.templateId) {
      // --- A. USE GOOGLE APPS SCRIPT (REAL CLOUD) ---
      try {
        await triggerGoogleScript(config.scriptUrl, config.templateId, opp, account);
        
        alert(`☁️ GOOGLE CLOUD AUTOMATION EXECUTED:\n1. Doc created from template in Drive.\n2. PDF sent via your Gmail.\n3. Task created in Google Tasks.`);
        
        // Move Stage & Update UI
        const updatedOpps = opps.map(o => 
          o.id === oppId ? { ...o, etapa: 'Negociación' as OpportunityStage, updatedAt: new Date().toISOString() } : o
        );
        saveOpportunities(updatedOpps);
        onUpdateOpp(updatedOpps);

      } catch (error) {
        alert("Error connecting to Google Script. Check console.");
        console.error(error);
      }

    } else {
      // --- B. USE LOCAL SIMULATION (FALLBACK) ---
      
      // 1. Generate Local PDF
      const pdfBlob = generateQuotePDF(opp, account);
      
      // 2. Simulate Download
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Cotizacion_${opp.titulo}.pdf`;
      a.click();
      
      alert(`🤖 LOCAL SIMULATION (Configure Google Script in Settings for Real Integration):\n1. PDF Generated locally.\n2. Deal moved to Negotiation.\n3. Local Task created.`);
      
      // 3. Update State
      const updatedOpps = opps.map(o => 
        o.id === oppId ? { ...o, etapa: 'Negociación' as OpportunityStage, updatedAt: new Date().toISOString() } : o
      );
      saveOpportunities(updatedOpps);
      onUpdateOpp(updatedOpps);
      
      // 4. Create Local Follow-up
      const followUpDate = new Date();
      followUpDate.setDate(followUpDate.getDate() + 2);
      
      createActivity({
        accountId: opp.accountId,
        type: 'Llamada',
        description: '🤖 TAREA AUTOMÁTICA: Seguimiento a cotización enviada.',
        followUpAt: followUpDate.toISOString(),
      });
    }
  }
};
