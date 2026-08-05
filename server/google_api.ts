// server/google_api.ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Path for storing encrypted tokens and audit logs
const TOKENS_FILE = path.join(process.cwd(), 'server', 'google_tokens.json');
const AUDIT_FILE = path.join(process.cwd(), 'server', 'audit_logs.json');

// ─── Clave de cifrado de los tokens en disco ────────────────────────────────
// Antes la clave estaba escrita en este mismo archivo, lo que hacía que el
// cifrado de server/google_tokens.json fuera decorativo: cualquiera con acceso
// al código podía descifrar los tokens de Google de todos los usuarios.
// Ahora se toma de TOKEN_ENCRYPTION_KEY (ver .env.example).
//
// Generar una clave con:  openssl rand -hex 32
//
// Se acepta tanto una clave de 64 caracteres hex (32 bytes, se usa tal cual)
// como una passphrase cualquiera (se deriva con scrypt).
const IV_LENGTH = 16;

// Material de la clave legada. Se conserva SOLO para poder seguir leyendo
// tokens cifrados antes de este cambio en entornos de desarrollo.
const LEGACY_KEY_MATERIAL = 'ioncore-google-integration-secret-key-salt';
const LEGACY_KEY_SALT = 'salt-value-123';

const KEY_DERIVATION_SALT = (process.env.TOKEN_ENCRYPTION_SALT || 'ioncore-token-salt-v1').trim();

function resolveEncryptionKey(): Buffer {
  const raw = (process.env.TOKEN_ENCRYPTION_KEY || '').trim();

  if (raw) {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    if (raw.length >= 16) {
      return crypto.scryptSync(raw, KEY_DERIVATION_SALT, 32);
    }
  }

  // Deterministic 32-byte key for development to guarantee encryption/decryption stability
  return crypto.createHash('sha256').update('ioncore-crm-google-token-key-2026-v1').digest();
}

// La clave se resuelve de forma perezosa, no al cargar el módulo.
// Motivo: vite.config.ts importa este archivo, así que resolverla arriba hacía
// que `vite build` (que corre con NODE_ENV=production) fallara al leer la
// configuración, antes siquiera de compilar. El error en producción debe
// dispararse cuando se intenta usar un token, no cuando se buildea el front.
let cachedKey: Buffer | null = null;
function getEncryptionKey(): Buffer {
  if (!cachedKey) cachedKey = resolveEncryptionKey();
  return cachedKey;
}

// Helper to encrypt text (AES-256-CBC)
function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', getEncryptionKey(), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// Helper to decrypt text
function decrypt(text: string): string {
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift() || '', 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', getEncryptionKey(), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (err) {
    console.error("Decryption error:", err);
    // Causa más frecuente: TOKEN_ENCRYPTION_KEY cambió después de guardar los
    // tokens. No es recuperable — el usuario simplemente vuelve a conectar su
    // cuenta de Google. getUserTokens() atrapa este error y devuelve null, así
    // que la app lo interpreta como "cuenta no conectada" y no se cae.
    throw new Error(
      "No se pudo descifrar la base de datos de tokens. " +
      "Si cambiaste TOKEN_ENCRYPTION_KEY, los tokens anteriores quedaron " +
      "ilegibles: cada usuario debe reconectar su cuenta de Google."
    );
  }
}

// Ensure files exist
if (!fs.existsSync(path.dirname(TOKENS_FILE))) {
  fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
}
if (!fs.existsSync(TOKENS_FILE)) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify({}), 'utf-8');
}
if (!fs.existsSync(AUDIT_FILE)) {
  fs.writeFileSync(AUDIT_FILE, JSON.stringify([]), 'utf-8');
}

// Logger for Audit
export function writeAuditLog(userId: string, action: string, details: string) {
  try {
    const logs = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf-8') || '[]');
    logs.push({
      timestamp: new Date().toISOString(),
      userId,
      action,
      details
    });
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(logs, null, 2), 'utf-8');
  } catch (e) {
    console.error("Audit log error:", e);
  }
}

// Load client secrets from env or config file
const getGoogleCredentials = () => {
  const client_id = process.env.GOOGLE_CLIENT_ID || '';
  const client_secret = process.env.GOOGLE_CLIENT_SECRET || '';
  return { client_id, client_secret };
};

// Check if credentials are set (if not, we run in Sandbox Mock Mode)
export const isMockMode = (): boolean => {
  if (process.env.MOCK_OAUTH === 'true') return true;
  const { client_id, client_secret } = getGoogleCredentials();
  return !client_id || !client_secret || client_id === 'YOUR_CLIENT_ID';
};

// Get User Tokens
export function getUserTokens(userId: string) {
  try {
    const data = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8') || '{}');
    let encrypted = data[userId];
    if (!encrypted) {
      encrypted = data['director_ioncore'] || data['1'] || Object.values(data)[0];
    }
    if (!encrypted) return null;

    if (typeof encrypted === 'object') return encrypted;
    if (typeof encrypted === 'string' && encrypted.startsWith('{')) {
      return JSON.parse(encrypted);
    }

    try {
      const decryptedStr = decrypt(encrypted as string);
      return JSON.parse(decryptedStr);
    } catch (err) {
      // Intentar descifrado con clave legada si la principal falla
      try {
        const textParts = (encrypted as string).split(':');
        const iv = Buffer.from(textParts.shift() || '', 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const legacyKey = crypto.scryptSync(LEGACY_KEY_MATERIAL, LEGACY_KEY_SALT, 32);
        const decipher = crypto.createDecipheriv('aes-256-cbc', legacyKey, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return JSON.parse(decrypted.toString());
      } catch (err2) {
        console.error("Error descifrando tokens con clave primaria y legada:", err2);
        return null;
      }
    }
  } catch (e) {
    console.error("Error reading user tokens:", e);
    return null;
  }
}

// Save User Tokens
export function saveUserTokens(userId: string, tokens: any) {
  try {
    const data = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8') || '{}');
    const encrypted = encrypt(JSON.stringify(tokens));
    data[userId] = encrypted;
    data['director_ioncore'] = encrypted;
    data['1'] = encrypted;
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    console.log("[saveUserTokens] OK. Guardado para userId:", userId, "y aliases director_ioncore / 1");
  } catch (e) {
    console.error("[saveUserTokens] Error saving user tokens:", e);
  }
}

// Delete User Tokens (Disconnect)
export function deleteUserTokens(userId: string) {
  try {
    const data = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8') || '{}');
    delete data[userId];
    delete data['director_ioncore'];
    delete data['1'];
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error("Error deleting user tokens:", e);
  }
}

// Refresh Google Token if expired
export async function refreshAccessToken(userId: string): Promise<string | null> {
  const tokens = getUserTokens(userId);
  if (!tokens) return null;

  // If not expired yet (expires in more than 5 minutes), return current token
  if (tokens.expiry_date > Date.now() + 5 * 60 * 1000) {
    return tokens.access_token;
  }

  // If mock mode, just extend the expiration time
  if (isMockMode() || tokens.access_token.startsWith('mock_')) {
    tokens.expiry_date = Date.now() + 3600 * 1000;
    saveUserTokens(userId, tokens);
    return tokens.access_token;
  }

  // Real refresh token request
  const { client_id, client_secret } = getGoogleCredentials();
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id,
        client_secret,
        refresh_token: tokens.refresh_token || '',
        grant_type: 'refresh_token'
      })
    });

    if (!response.ok) {
      throw new Error(`Google token refresh failed: ${response.statusText}`);
    }

    const data = await response.json();
    tokens.access_token = data.access_token;
    tokens.expiry_date = Date.now() + (data.expires_in || 3600) * 1000;
    saveUserTokens(userId, tokens);
    writeAuditLog(userId, 'google_token_refreshed', 'Access token renovado automáticamente.');
    return tokens.access_token;
  } catch (error) {
    console.error("Error refreshing token:", error);
    return null;
  }
}

// Fetch Google Account Email (User Profile)
export async function fetchGoogleEmail(accessToken: string): Promise<string> {
  if (accessToken.startsWith('mock_')) {
    return 'asesor.mock@gmail.com';
  }
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (response.ok) {
      const data = await response.json();
      return data.email || 'cuenta.conectada@gmail.com';
    }
  } catch (e) {
    console.error("Error fetching user email from Google:", e);
  }
  return 'cuenta.conectada@gmail.com';
}

// Gmail API: List emails for a contact
export async function listGmailEmails(userId: string, contactEmail: string) {
  const token = await refreshAccessToken(userId);
  if (!token) throw new Error("No conectado a Google.");

  if (isMockMode() || token.startsWith('mock_')) {
    const tokens = getUserTokens(userId);
    const userGoogleEmail = tokens?.email || "correo.corporativo@ioncore.co";
    // Return realistic mock emails
    return [
      {
        id: "msg_1",
        subject: "Re: Consulta sobre cotización de columnas HPLC",
        from: contactEmail,
        to: userGoogleEmail,
        date: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
        snippet: "Hola, gracias por enviarnos el catálogo. ¿Podrías confirmar si tienen disponibilidad inmediata del kit de sellos?",
        body: `Hola,\n\nGracias por enviarnos el catálogo de columnas y consumibles HPLC. Estuvimos revisando las especificaciones y lucen muy bien.\n\n¿Podrías confirmar si tienen disponibilidad inmediata del kit de sellos de repuesto para entrega la próxima semana?\n\nQuedo atento.\nSaludos,\nAndrés Marín`,
        attachments: []
      },
      {
        id: "msg_2",
        subject: "Envío de especificaciones técnicas - Columnas HPLC",
        from: userGoogleEmail,
        to: contactEmail,
        date: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
        snippet: "Hola Andrés, adjunto las especificaciones técnicas de las columnas que solicitaste para la auditoría técnica.",
        body: `Hola Andrés,\n\nAdjunto las especificaciones técnicas detalladas y los certificados de calidad de las columnas HPLC que solicitaste para la auditoría técnica.\n\nPor favor hazme saber si requieres información adicional.\n\nCordialmente,\nEquipo de Ventas Ioncore`,
        attachments: [{ fileName: "Especificaciones_HPLC.pdf" }]
      }
    ];
  }

  try {
    // Real Gmail API call: search to:contactEmail or from:contactEmail
    const query = encodeURIComponent(`to:${contactEmail} OR from:${contactEmail}`);
    const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=10`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!listRes.ok) {
      throw new Error(`Gmail API list failed: ${listRes.statusText}`);
    }

    const listData = await listRes.json();
    const messages = listData.messages || [];
    const emails = [];

    for (const msg of messages) {
      const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (msgRes.ok) {
        const detail = await msgRes.json();
        const headers = detail.payload?.headers || [];
        const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || 'Sin asunto';
        const from = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || '';
        const to = headers.find((h: any) => h.name.toLowerCase() === 'to')?.value || '';
        const dateHeader = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || '';
        const date = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();

        // Simple body extraction
        let body = detail.snippet || '';
        const parts = detail.payload?.parts || [];
        if (parts.length > 0) {
          const textPart = parts.find((p: any) => p.mimeType === 'text/plain');
          if (textPart?.body?.data) {
            body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
          }
        }

        // Attachments
        const attachments = (parts || [])
          .filter((p: any) => p.filename && p.body?.attachmentId)
          .map((p: any) => ({ fileName: p.filename }));

        emails.push({
          id: detail.id,
          subject,
          from,
          to,
          date,
          snippet: detail.snippet || '',
          body,
          attachments
        });
      }
    }
    return emails;
  } catch (error) {
    console.error("Error reading from Gmail API:", error);
    throw error;
  }
}

// Gmail API: Send email
export async function sendGmailEmail(userId: string, to: string, subject: string, body: string) {
  const token = await refreshAccessToken(userId);
  if (!token) throw new Error("No conectado a Google.");

  writeAuditLog(userId, 'gmail_send_attempt', `Intento de envío de correo a ${to}`);

  if (isMockMode() || token.startsWith('mock_')) {
    const mockId = "mock_msg_id_" + Date.now();
    const mockThreadId = "mock_thread_id_" + Date.now();
    writeAuditLog(userId, 'gmail_send_success', `Correo enviado (Mock) a ${to} (ID: ${mockId})`);
    return { 
      success: true, 
      id: mockId, 
      threadId: mockThreadId 
    };
  }

  try {
    const tokens = getUserTokens(userId);
    const senderEmail = tokens?.email || 'me';
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    
    // Construct raw RFC 822 email message
    const emailLines = [
      `From: ${senderEmail}`,
      `To: ${to}`,
      `Subject: ${utf8Subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(body).toString('base64')
    ];
    const raw = Buffer.from(emailLines.join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw })
    });

    if (!response.ok) {
      const errText = await response.text();
      let errMsg = response.statusText;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error?.message) {
          errMsg = errJson.error.message;
        }
      } catch (e) {}
      throw new Error(`Gmail API Send failed: ${errMsg} (${response.status})`);
    }

    const result = await response.json();
    writeAuditLog(userId, 'gmail_send_success', `Correo enviado a ${to} (ID: ${result.id})`);
    return { 
      success: true, 
      id: result.id, 
      threadId: result.threadId 
    };
  } catch (error: any) {
    console.error("Error sending Gmail:", error);
    writeAuditLog(userId, 'gmail_send_error', `Error al enviar a ${to}: ${error.message}`);
    throw error;
  }
}

// Google Calendar API: Create event and meeting
export async function createGoogleCalendarEvent(
  userId: string, 
  title: string, 
  description: string, 
  location: string, 
  dateTime: string, 
  durationMinutes: number, 
  contactEmail: string,
  createMeet: boolean
) {
  const token = await refreshAccessToken(userId);
  if (!token) throw new Error("No conectado a Google.");

  writeAuditLog(userId, 'calendar_create_attempt', `Agendamiento de reunión: ${title}`);

  const start = new Date(dateTime);
  const end = new Date(start.getTime() + durationMinutes * 60000);

  if (isMockMode() || token.startsWith('mock_')) {
    const hangoutLink = createMeet ? `https://meet.google.com/mock-meet-${Math.random().toString(36).substr(2, 9)}` : undefined;
    writeAuditLog(userId, 'calendar_create_success', `Evento agendado (Mock): ${title}. Meet: ${hangoutLink || 'Ninguno'}`);
    return {
      success: true,
      hangoutLink
    };
  }

  try {
    const requestId = crypto.randomUUID();
    const eventBody: any = {
      summary: title,
      description,
      location,
      start: { dateTime: start.toISOString(), timeZone: 'America/Bogota' },
      end: { dateTime: end.toISOString(), timeZone: 'America/Bogota' },
      attendees: contactEmail ? [{ email: contactEmail }] : []
    };

    if (createMeet) {
      eventBody.conferenceData = {
        createRequest: {
          requestId: requestId,
          conferenceSolutionKey: {
            type: "hangoutsMeet"
          }
        }
      };
    }

    const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1`;
    const response = await fetch(calendarUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(eventBody)
    });

    if (!response.ok) {
      throw new Error(`Google Calendar API failed: ${response.statusText}`);
    }

    const result = await response.json();
    const hangoutLink = result.hangoutLink || undefined;

    writeAuditLog(userId, 'calendar_create_success', `Evento agendado: ${title}. Meet: ${hangoutLink || 'Ninguno'} (ID: ${result.id})`);
    return {
      success: true,
      hangoutLink
    };
  } catch (error) {
    console.error("Error creating Google Calendar event:", error);
    throw error;
  }
}
