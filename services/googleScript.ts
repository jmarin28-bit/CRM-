import { OpportunityV2, AccountV2 } from '../types';

// The Code the user needs to paste into Google Apps Script
export const GAS_SERVER_CODE = `
/* 
 * -------------------------------------------------------------
 * SCRIPT DE AUTOMATIZACIÓN CRM IONCORE
 * -------------------------------------------------------------
 * INSTRUCCIONES:
 * 1. Pega este código en script.google.com
 * 2. En la izquierda, ve a "Servicios" (+) y agrega "Google Tasks API".
 * 3. Guarda y haz clic en "Implementar" > "Nueva implementación".
 * 4. Tipo: "Aplicación web".
 * 5. Acceso: "Cualquier usuario" (para que el CRM pueda invocarlo sin login complejo).
 * 6. Copia la URL generada y pégala en Ioncore CRM.
 */

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const templateId = data.templateId; // ID de tu Doc plantilla
    
    if(!templateId) throw new Error("Falta templateId");

    // 1. GENERAR DOCUMENTO (Drive API)
    // Copiar plantilla
    const templateFile = DriveApp.getFileById(templateId);
    const newFile = templateFile.makeCopy('Cotización - ' + data.dealTitle);
    const newDoc = DocumentApp.openById(newFile.getId());
    const body = newDoc.getBody();
    
    // Reemplazar etiquetas {{Texto}}
    const replacements = {
      '{{Cliente}}': data.clientName,
      '{{Nit}}': data.clientNit,
      '{{Producto}}': data.dealTitle,
      '{{Valor}}': data.dealValue,
      '{{Fecha}}': new Date().toLocaleDateString()
    };
    
    for (const key in replacements) {
      body.replaceText(key, replacements[key]);
    }
    newDoc.saveAndClose();
    
    // Convertir a PDF
    const pdfBlob = newFile.getAs('application/pdf');
    
    // 2. ENVIAR CORREO (Gmail API)
    // Nota: data.recipientEmail debe ser un email real, si es vacío usa el tuyo
    const recipient = data.recipientEmail || Session.getActiveUser().getEmail();
    const subject = 'Propuesta Comercial: ' + data.dealTitle;
    const emailBody = 'Estimado cliente,\\n\\nAdjunto encontrará la propuesta solicitada.\\n\\nAtentamente,\\nIoncore SAS';
    
    GmailApp.sendEmail(recipient, subject, emailBody, {
      attachments: [pdfBlob],
      name: 'Ventas Ioncore'
    });
    
    // Limpieza (Opcional): Borrar el doc temporal para no llenar Drive
    newFile.setTrashed(true);
    
    // 3. CREAR TAREA (Tasks API)
    // Requiere agregar el servicio "Tasks" en el editor
    const taskListId = '@default';
    const twoDaysLater = new Date();
    twoDaysLater.setDate(twoDaysLater.getDate() + 2);
    
    const task = {
      title: 'Seguimiento: ' + data.dealTitle,
      notes: 'Verificar si ' + data.clientName + ' recibió la cotización PDF.',
      due: twoDaysLater.toISOString()
    };
    
    try {
      Tasks.Tasks.insert(task, taskListId);
    } catch(err) {
      // Si falla Tasks (por no activar servicio), no rompemos todo el flujo
      console.log("Error en Tasks: " + err);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success', 
      message: 'Flujo ejecutado: PDF Creado, Email Enviado, Tarea Agendada.'
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', 
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
`;

export const triggerGoogleScript = async (
  scriptUrl: string, 
  templateId: string, 
  opp: OpportunityV2, 
  account: AccountV2,
  contactEmail?: string
) => {
  // Map data to the format expected by the GAS script
  const payload = {
    templateId: templateId,
    dealTitle: opp.titulo,
    dealValue: new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(opp.valor),
    clientName: account.nombreComercial || account.razonSocial,
    clientNit: account.nit,
    recipientEmail: contactEmail || ''
  };

  try {
    // Note: 'no-cors' mode is often required for GAS Web Apps called from client-side JS
    // However, no-cors means we can't read the response. 
    // We assume success if no network error.
    await fetch(scriptUrl, {
      method: 'POST',
      mode: 'no-cors', 
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    return { success: true };
  } catch (error) {
    console.error("Google Script Error:", error);
    throw error;
  }
};