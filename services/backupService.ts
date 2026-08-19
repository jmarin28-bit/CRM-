// services/backupService.ts

/**
 * Lista de claves conocidas de localStorage utilizadas por el CRM Ioncore
 */
export const CRM_LOCAL_STORAGE_KEYS = [
  "crm_users_v2",
  "crm_active_user_v2",
  "ioncore_rr_index",
  "crm_accounts_v2",
  "crm_contacts_v2",
  "crm_opportunities_v2",
  "crm_activities_v2",
  "ioncore_tasks",
  "ioncore_automation_config",
  "ioncore_business_settings",
  "ioncore_time_logs",
  "crm_quotes_v2",
  "crm_advisor_budgets_v2",
  "ioncore_agent_memory_v1",
  "ioncore_assistant_draft_v1",
  "theme",
  "crm_google_status",
  "google_connected"
] as const;

export interface BackupPayload {
  version: string;
  appName: string;
  exportedAt: string;
  keysCount: number;
  data: Record<string, any>;
}

/**
 * Junta TODAS las claves de localStorage usadas por el CRM en un solo objeto JSON,
 * con fecha y versión, y dispara la descarga de un archivo .json (ej: crm-backup-2026-08-18.json).
 */
export function exportBackup(): void {
  const data: Record<string, any> = {};
  const keysSet = new Set<string>(CRM_LOCAL_STORAGE_KEYS);

  // También incluir dinámicamente cualquier otra clave que empiece por crm_, ioncore_ o axis_
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("crm_") || key.startsWith("ioncore_") || key.startsWith("axis_"))) {
        keysSet.add(key);
      }
    }
  } catch (err) {
    console.warn("No se pudieron enumerar todas las claves de localStorage:", err);
  }

  // Leer valores de localStorage
  keysSet.forEach((key) => {
    try {
      const rawVal = localStorage.getItem(key);
      if (rawVal !== null) {
        try {
          data[key] = JSON.parse(rawVal);
        } catch {
          data[key] = rawVal;
        }
      }
    } catch (err) {
      console.warn(`Error al leer clave ${key} de localStorage:`, err);
    }
  });

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const fileName = `crm-backup-${dateStr}.json`;

  const backupObject: BackupPayload = {
    version: "1.0.0",
    appName: "Ioncore CRM",
    exportedAt: now.toISOString(),
    keysCount: Object.keys(data).length,
    data
  };

  const jsonStr = JSON.stringify(backupObject, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();

  // No revocar la URL ni remover el nodo de inmediato para permitir que el
  // navegador complete el proceso de descarga sin cancelar el Blob.
  setTimeout(() => {
    try {
      if (document.body.contains(link)) {
        document.body.removeChild(link);
      }
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn("Cleanup backup URL:", e);
    }
  }, 10000);
}

/**
 * Lee un .json subido por el usuario, valida su estructura básica, y si es válido,
 * restaura esas claves en localStorage (con confirmación antes de sobrescribir).
 */
export function importBackup(file: File): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    if (!file) {
      const msg = "No se proporcionó ningún archivo de respaldo.";
      alert(msg);
      return resolve({ success: false, message: msg });
    }

    if (!file.name.toLowerCase().endsWith(".json") && file.type !== "application/json") {
      const msg = "El archivo debe ser un documento JSON (.json).";
      alert(msg);
      return resolve({ success: false, message: msg });
    }

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text || !text.trim()) {
          throw new Error("El archivo seleccionado está vacío.");
        }

        const parsed = JSON.parse(text);

        // Extraer datos: formato estándar con payload o formato plano directo
        let dataToRestore: Record<string, any> | null = null;
        let backupDate = "Fecha no especificada";

        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          if (parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)) {
            dataToRestore = parsed.data;
            if (parsed.exportedAt) {
              try {
                backupDate = new Date(parsed.exportedAt).toLocaleString("es-CO");
              } catch {
                backupDate = String(parsed.exportedAt);
              }
            }
          } else if (parsed.crm_accounts_v2 || parsed.crm_users_v2 || parsed.crm_contacts_v2 || parsed.ioncore_tasks) {
            dataToRestore = parsed;
          }
        }

        if (!dataToRestore || Object.keys(dataToRestore).length === 0) {
          throw new Error("El archivo no tiene una estructura de respaldo válida de Ioncore CRM.");
        }

        const restoredKeyNames = Object.keys(dataToRestore);
        const confirmText = 
          `¿Confirmas la restauración del respaldo?\n\n` +
          `• Fecha de respaldo: ${backupDate}\n` +
          `• Total de claves detectadas: ${restoredKeyNames.length}\n` +
          `• Claves principales: ${restoredKeyNames.slice(0, 5).join(", ")}${restoredKeyNames.length > 5 ? "..." : ""}\n\n` +
          `⚠️ ADVERTENCIA: Esta acción sobrescribirá la información actual en el CRM.`;

        const userConfirmed = window.confirm(confirmText);
        if (!userConfirmed) {
          return resolve({ success: false, message: "Restauración cancelada por el usuario." });
        }

        // Restaurar claves en localStorage
        let writeCount = 0;
        for (const [key, value] of Object.entries(dataToRestore)) {
          try {
            if (value === null || value === undefined) {
              localStorage.removeItem(key);
            } else if (typeof value === "string") {
              localStorage.setItem(key, value);
            } else {
              localStorage.setItem(key, JSON.stringify(value));
            }
            writeCount++;
          } catch (err) {
            console.error(`Error al escribir clave ${key}:`, err);
          }
        }

        alert(`¡Restauración exitosa!\nSe restauraron ${writeCount} módulos y configuraciones del CRM.\nLa aplicación se recargará ahora.`);
        window.location.reload();
        resolve({ success: true, message: `Se restauraron ${writeCount} claves exitosamente.` });
      } catch (err: any) {
        const errorMsg = `Error al procesar el respaldo: ${err?.message || err}`;
        alert(errorMsg);
        resolve({ success: false, message: errorMsg });
      }
    };

    reader.onerror = () => {
      const errorMsg = "Error al leer el archivo desde el dispositivo.";
      alert(errorMsg);
      resolve({ success: false, message: errorMsg });
    };

    reader.readAsText(file);
  });
}
