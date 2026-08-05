import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

import fs from 'fs';
import zlib from 'zlib';

// Load environment variables and assign them to process.env
const loadedEnv = loadEnv(process.env.NODE_ENV || 'development', '.', '');

// Ojo: process.env convierte cualquier valor a string. Asignar undefined deja
// literalmente el texto "undefined", que es truthy y se colaba como valor real
// (así salía redirect_uri=undefined en la URL de Google). Por eso solo se
// asigna cuando hay un valor de verdad.
function setEnvIfPresent(key: string, value: string | undefined) {
  const resolved = (value ?? process.env[key] ?? '').trim();
  if (resolved) {
    process.env[key] = resolved;
  } else {
    delete process.env[key];
  }
}

setEnvIfPresent('GOOGLE_CLIENT_ID', loadedEnv.GOOGLE_CLIENT_ID);
setEnvIfPresent('GOOGLE_CLIENT_SECRET', loadedEnv.GOOGLE_CLIENT_SECRET);
setEnvIfPresent('GOOGLE_REDIRECT_URI', loadedEnv.GOOGLE_REDIRECT_URI);
setEnvIfPresent('GEMINI_API_KEY', loadedEnv.GEMINI_API_KEY);

console.log("─── Google OAuth Config ───────────────────────────");
console.log("CLIENT_ID:", process.env.GOOGLE_CLIENT_ID || 'NO DEFINIDO');
console.log("CLIENT_SECRET:", process.env.GOOGLE_CLIENT_SECRET ? process.env.GOOGLE_CLIENT_SECRET.substring(0, 8) + "..." : 'NO DEFINIDO');
console.log("REDIRECT_URI:", process.env.GOOGLE_REDIRECT_URI || 'NO DEFINIDO (se calculará del host)');
console.log("───────────────────────────────────────────────────");

// Fallback for online IDEs that block dotfiles (like .env)
const fallbacks = ['./env', './env.txt', './config.env'];
for (const filepath of fallbacks) {
  if (fs.existsSync(filepath)) {
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const parts = trimmed.split('=');
        if (parts.length >= 2) {
          const key = parts[0].trim();
          const val = parts.slice(1).join('=').trim();
          process.env[key] = val;
        }
      }
    } catch (e) { }
  }
}

import {
  isMockMode,
  getUserTokens,
  saveUserTokens,
  deleteUserTokens,
  fetchGoogleEmail,
  listGmailEmails,
  sendGmailEmail,
  createGoogleCalendarEvent,
  writeAuditLog
} from './server/google_api';

// ─── CORS: lista de orígenes permitidos ─────────────────────────────────────
// Antes se respondía `Access-Control-Allow-Origin: *` a todo, lo que permitía
// que el JavaScript de CUALQUIER sitio web que el usuario visitara llamara a
// estos endpoints y leyera la respuesta (por ejemplo, listar su Gmail).
//
// Ojo con el alcance de esta mitigación: CORS lo aplica el navegador, no el
// servidor. Esto NO impide que un proceso de la red golpee el endpoint con
// curl. Para eso hace falta autenticación real (ver #3 del informe).
//
// Se permite por defecto localhost y las redes privadas, para no romper el
// acceso desde otras máquinas de la LAN o desde puertos distintos. Cualquier
// origen adicional (un dominio propio, un túnel tipo ngrok) se declara en
// CORS_ALLOWED_ORIGINS, separado por comas.
const EXTRA_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (EXTRA_ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ''))) return true;

  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }

  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  if (hostname.endsWith('.localhost')) return true;
  if (hostname.endsWith('.run.app')) return true;


  // Redes privadas (RFC 1918) y link-local
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;

  return false;
}

// ─── Helper: CORS headers for all API responses ─────────────────────────────
function setCorsHeaders(req: any, res: any) {
  const origin = (req?.headers?.origin as string) || '';

  if (isAllowedOrigin(origin)) {
    // Se refleja el origen concreto (no "*") y se marca Vary para que ningún
    // proxy cachee la respuesta de un origen y se la sirva a otro.
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (!origin) {
    // Sin cabecera Origin: request del mismo sitio, curl, o navegación directa.
    // No hace falta cabecera CORS.
  } else {
    console.warn(`[CORS] Origen bloqueado: ${origin} — agregalo a CORS_ALLOWED_ORIGINS si es legítimo.`);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ─── Helper: build the redirect URI ──────────────────────────────────────────
// 1) Si GOOGLE_REDIRECT_URI está definido en el entorno, se usa tal cual
//    (necesario en producción o detrás de un proxy con dominio propio).
// 2) Si no, se deriva del request real, respetando cabeceras de proxy
//    (x-forwarded-host / x-forwarded-proto).
function getRedirectUri(req: any): string {
  const override = (process.env.GOOGLE_REDIRECT_URI || '').trim();
  if (override && override !== 'undefined' && override !== 'null') return override;
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000';
  const protocol = (req.headers['x-forwarded-proto'] as string) || 'http';
  return `${protocol}://${host}/api/google-oauth/callback`;
}

// ─── Helper: escapar texto antes de interpolarlo en HTML ────────────────────
// Las páginas de OAuth se construyen con template strings y reciben datos que
// vienen de la URL (email, state, error), de cabeceras de proxy (redirect_uri)
// y de respuestas de Google. Sin escapar, un enlace manipulado como
//   /api/google-oauth/callback?code=mock_x&state=1&email=<img src=x onerror=...>
// ejecuta JavaScript en el origen de la app, que tiene todo el CRM en
// localStorage. Se escapa dentro de las funciones de página (y no en cada
// llamador) para que ningún caso nuevo pueda olvidarse de hacerlo.
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── HTML helper: error page for OAuth failures ──────────────────────────────
function oauthErrorPage(title: string, message: string, detail: string = ''): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Error de conexión - Ioncore CRM</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
    .card { background: white; border-radius: 24px; padding: 48px 40px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); max-width: 500px; width: 100%; text-align: center; }
    .icon { font-size: 48px; margin-bottom: 20px; }
    h1 { font-size: 22px; font-weight: 800; color: #0f172a; margin-bottom: 12px; }
    .subtitle { font-size: 14px; color: #64748b; line-height: 1.6; margin-bottom: 24px; }
    .detail { background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px; font-size: 12px; color: #b91c1c; text-align: left; font-family: monospace; margin-bottom: 28px; word-break: break-all; }
    .instruction { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 16px; font-size: 13px; color: #1d4ed8; text-align: left; margin-bottom: 28px; line-height: 1.6; }
    .instruction strong { display: block; margin-bottom: 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    .btn { display: inline-block; background: #2563eb; color: white; padding: 12px 28px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 14px; }
    .btn:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="subtitle">${escapeHtml(message)}</p>
    ${detail ? `<div class="detail">${escapeHtml(detail)}</div>` : ''}
    <div class="instruction">
      <strong>¿Qué hacer?</strong>
      Para que el flujo OAuth funcione correctamente, asegúrate de que la siguiente URI esté registrada en tu Google Cloud Console como <strong>Redirect URI autorizado</strong>:<br><br>
      <code>${escapeHtml((process.env.GOOGLE_REDIRECT_URI || '').trim() || 'http://localhost:3000/api/google-oauth/callback')}</code>
    </div>
    <a href="/" class="btn">Volver al CRM</a>
  </div>
</body>
</html>`;
}

// ─── HTML: OAuth success page ────────────────────────────────────────────────
function oauthSuccessPage(email: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Cuenta conectada - Ioncore CRM</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f0fdf4; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: white; border-radius: 24px; padding: 48px 40px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); max-width: 440px; width: 100%; text-align: center; border: 1px solid #bbf7d0; }
    .icon { font-size: 56px; margin-bottom: 20px; }
    h1 { font-size: 22px; font-weight: 800; color: #0f172a; margin-bottom: 10px; }
    .email { font-size: 14px; font-weight: 700; color: #16a34a; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 10px 20px; border-radius: 99px; display: inline-block; margin: 12px 0 28px; }
    p { font-size: 13px; color: #64748b; margin-bottom: 28px; line-height: 1.6; }
    .btn { display: inline-block; background: #2563eb; color: white; padding: 13px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 14px; border: none; cursor: pointer; }
  </style>
  <script>
    (function () {
      var email = ${JSON.stringify(email)};

      // 1. Escribir en localStorage para que el CRM detecte la conexión
      //    (funciona incluso si window.opener es null por COOP de Google).
      try {
        localStorage.setItem('crm_google_status', JSON.stringify({ connected: true, email: email, ts: Date.now() }));
        localStorage.setItem('google_connected', JSON.stringify({ connected: true, email: email, ts: Date.now() }));
      } catch(e) {}

      // 2. Avisar al opener si existe (ventana normal con popup)
      var opener = null;
      try { opener = window.opener; } catch (e) {}
      if (opener && !opener.closed) {
        try { opener.postMessage({ type: 'google-oauth-success', email: email }, '*'); } catch (e) {}
      }

      // 3. Intentar cerrar la pestaña después de 1.5s
      setTimeout(function () {
        try { window.close(); } catch (e) {}
      }, 1500);
    })();
  </script>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>¡Cuenta conectada!</h1>
    <div class="email">${escapeHtml(email)}</div>
    <p>Tu cuenta de Google Workspace fue vinculada correctamente.<br>Ya puedes cerrar esta pestaña y volver al CRM.</p>
    <button onclick="window.close()" class="btn">Cerrar esta pestaña</button>
  </div>
</body>
</html>`;
}

function googleOAuthPlugin() {
  return {
    name: 'google-oauth-plugin',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = new URL(req.url || '', `http://${req.headers.host || 'localhost:3000'}`);
        const method = (req.method || 'GET').toUpperCase();

        // ── Handle OPTIONS preflight (CORS) ────────────────────────────────
        if (method === 'OPTIONS' && url.pathname.startsWith('/api/google-oauth/')) {
          setCorsHeaders(req, res);
          res.writeHead(204);
          res.end();
          return;
        }

        // ── 1. GET /api/google-oauth/url  →  devuelve la URL de autorización ──
        if (url.pathname === '/api/google-oauth/url' || url.pathname.startsWith('/api/google-oauth/url?')) {
          setCorsHeaders(req, res);
          const userId = url.searchParams.get('userId') || '';
          const email = url.searchParams.get('email') || '';

          if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'userId requerido' }));
            return;
          }

          if (isMockMode()) {
            // Sin credenciales reales → simulador sandbox
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              url: `/api/google-oauth/mock-login?state=${encodeURIComponent(userId)}&email=${encodeURIComponent(email)}`
            }));
            return;
          }

          // Credenciales reales → OAuth real de Google
          const redirectUri = getRedirectUri(req);
          console.log("========== GOOGLE OAUTH ==========");
          console.log("Origin:", req.headers.origin);
          console.log("Host:", req.headers.host);
          console.log("X-Forwarded-Host:", req.headers["x-forwarded-host"]);
          console.log("Redirect URI:", redirectUri);
          console.log("==================================");
          const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID || '',
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: [
              'https://www.googleapis.com/auth/gmail.readonly',
              'https://www.googleapis.com/auth/gmail.send',
              'https://www.googleapis.com/auth/gmail.compose',
              'https://www.googleapis.com/auth/calendar',
              'https://www.googleapis.com/auth/calendar.events',
              'https://www.googleapis.com/auth/userinfo.email',
              'https://www.googleapis.com/auth/userinfo.profile',
              'openid'
            ].join(' '),
            access_type: 'offline',
            prompt: 'select_account consent',
            state: userId,
            // login_hint: email para pre-seleccionar la cuenta corporativa
            ...(email ? { login_hint: email } : {})
          }).toString();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ url: authUrl, redirectUri }));
          return;
        }

        // ── 2. GET /api/google-oauth/mock-login  →  simulador sandbox ─────────
        if (url.pathname.startsWith('/api/google-oauth/mock-login')) {
          const userId = url.searchParams.get('state') || '';
          const email = url.searchParams.get('email') || '';
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Simulador Google OAuth 2.0</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: white; border: 1px solid #e2e8f0; border-radius: 24px; padding: 40px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); max-width: 420px; width: 100%; text-align: center; }
    .google-logo { font-size: 28px; margin-bottom: 8px; }
    .badge { background: #fef9c3; color: #854d0e; font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 99px; display: inline-block; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 0.05em; }
    h1 { font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 10px; }
    p { font-size: 13px; color: #64748b; line-height: 1.6; margin-bottom: 28px; }
    .scopes { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; text-align: left; margin-bottom: 24px; }
    .scope { font-size: 12px; color: #475569; padding: 3px 0; }
    .scope::before { content: "✓ "; color: #16a34a; font-weight: 700; }
    .btn { display: block; width: 100%; padding: 13px; background: #2563eb; color: white; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 14px; margin-bottom: 10px; }
    .btn:hover { background: #1d4ed8; }
    .btn-cancel { display: block; width: 100%; padding: 12px; background: #f1f5f9; color: #475569; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 13px; }
    .btn-cancel:hover { background: #e2e8f0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="google-logo">G</div>
    <div class="badge">Modo Sandbox</div>
    <h1>Conectar con Ioncore CRM</h1>
    <p>Simulación del flujo OAuth 2.0. Al aceptar, se habilitarán las funciones de Gmail, Calendario y Google Meet en modo sandbox.</p>
    <div class="scopes">
      <div class="scope">Leer correos de Gmail</div>
      <div class="scope">Enviar correos por Gmail</div>
      <div class="scope">Gestionar eventos de Calendario</div>
      <div class="scope">Crear enlaces de Google Meet</div>
    </div>
    <a class="btn" href="/api/google-oauth/callback?code=mock_code_123&state=${encodeURIComponent(userId)}&email=${encodeURIComponent(email)}">
      Aceptar y Conectar
    </a>
    <a class="btn-cancel" href="/">Cancelar</a>
  </div>
</body>
</html>`);
          return;
        }

        // ── 3. GET /api/google-oauth/callback  →  recibe el código de Google ──
        if (url.pathname.startsWith('/api/google-oauth/callback')) {
          console.log("===== CALLBACK EJECUTADO =====");
          console.log("HOST:", req.headers.host);
          console.log("URL:", req.url);
          const code = url.searchParams.get('code') || '';
          const userId = url.searchParams.get('state') || '';
          const emailParam = url.searchParams.get('email') || '';
          const errorParam = url.searchParams.get('error') || '';
          console.log("state (userId):", userId);

          // Google rechazó la autorización (ej: usuario canceló)
          if (errorParam) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(oauthErrorPage(
              'Autorización cancelada',
              'El flujo de autorización fue cancelado o rechazado por Google.',
              `Error: ${errorParam}`
            ));
            return;
          }

          if (!userId) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(oauthErrorPage(
              'Parámetro faltante',
              'El parámetro "state" (userId) no fue recibido en el callback.',
              'Falta el parámetro state en la URL de retorno.'
            ));
            return;
          }

          // ── Sandbox mock ────────────────────────────────────────────────
          // Solo se acepta la rama mock si el servidor está realmente en modo
          // sandbox (sin credenciales de Google). Antes bastaba con enviar
          // "code=mock_algo" para escribir tokens falsos sobre cualquier
          // userId aunque hubiera credenciales reales configuradas.
          if (code.startsWith('mock_')) {
            if (!isMockMode()) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(oauthErrorPage(
                'Código de autorización inválido',
                'Se recibió un código de sandbox pero el servidor está configurado con credenciales reales de Google.',
                'La conexión sandbox solo está disponible cuando no hay GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET configurados.'
              ));
              return;
            }
            const mockEmail = emailParam || 'sandbox@ioncore-sas.com';
            const mockTokens = {
              access_token: 'mock_access_token_' + Date.now(),
              refresh_token: 'mock_refresh_token_XYZ',
              expiry_date: Date.now() + 3600 * 1000,
              email: mockEmail
            };
            saveUserTokens(userId, mockTokens);
            writeAuditLog(userId, 'google_connect_success', `Cuenta sandbox (${mockEmail}) conectada.`);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(oauthSuccessPage(mockEmail));
            return;
          }

          // ── OAuth real: intercambio de código por tokens ────────────────
          try {
            const redirectUri = getRedirectUri(req);
            console.log("Callback Redirect URI:", redirectUri);
            console.log("─── Token Exchange ────────────────────────────────");
            console.log("client_id:", process.env.GOOGLE_CLIENT_ID || 'NO DEFINIDO');
            console.log("redirect_uri:", redirectUri);
            console.log("grant_type: authorization_code");
            console.log("CLIENT_SECRET cargado correctamente:", process.env.GOOGLE_CLIENT_SECRET ? 'SI' : 'NO');
            console.log("───────────────────────────────────────────────────");
            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                code,
                client_id: process.env.GOOGLE_CLIENT_ID || '',
                client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
              })
            });

            if (!tokenResponse.ok) {
              const errText = await tokenResponse.text();
              let errDetail = errText;
              try {
                const errJson = JSON.parse(errText);
                errDetail = errJson.error_description || errJson.error || errText;
              } catch { }

              console.error('[Token Exchange ERROR] HTTP:', tokenResponse.status, '| Google dice:', errDetail);

              // redirect_uri_mismatch → instrucciones claras
              if (errDetail.includes('redirect_uri_mismatch') || errText.includes('redirect_uri_mismatch')) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(oauthErrorPage(
                  'redirect_uri no autorizado',
                  'Google rechazó la conexión porque el redirect_uri no está registrado en Google Cloud Console.',
                  `redirect_uri usado: ${redirectUri}\n\nRespuesta de Google: ${errDetail}`
                ));
                return;
              }

              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(oauthErrorPage(
                'Error al intercambiar el token',
                `Google devolvió un error durante el intercambio del código de autorización.`,
                `HTTP ${tokenResponse.status}: ${errDetail}`
              ));
              return;
            }

            const data = await tokenResponse.json();

            if (!data.access_token) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(oauthErrorPage(
                'Token no recibido',
                'Google respondió correctamente pero no envió el access_token.',
                JSON.stringify(data, null, 2)
              ));
              return;
            }

            const googleEmail = await fetchGoogleEmail(data.access_token);

            const tokens: any = {
              access_token: data.access_token,
              refresh_token: data.refresh_token,
              expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
              email: googleEmail
            };

            // Conservar el refresh_token anterior si Google no envió uno nuevo
            if (!tokens.refresh_token) {
              const oldTokens = getUserTokens(userId);
              if (oldTokens?.refresh_token) {
                tokens.refresh_token = oldTokens.refresh_token;
              }
            }

            saveUserTokens(userId, tokens);
            writeAuditLog(userId, 'google_connect_success', `Cuenta corporativa (${googleEmail}) conectada.`);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(oauthSuccessPage(googleEmail));
          } catch (err: any) {
            console.error('[OAuth Callback Error]', err);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(oauthErrorPage(
              'Error interno del servidor',
              'Ocurrió un error inesperado durante el proceso de autenticación.',
              err.message || String(err)
            ));
          }
          return;
        }

        // ── 4. GET /api/google-oauth/status ───────────────────────────────────
        if (url.pathname.startsWith('/api/google-oauth/status')) {
          setCorsHeaders(req, res);
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
          const userId = url.searchParams.get('userId') || '';
          const tokens = getUserTokens(userId);
          console.log("[STATUS] userId:", userId, tokens ? "CONECTADO (" + tokens.email + ")" : "NO CONECTADO");
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(
            tokens
              ? { connected: true, email: tokens.email }
              : { connected: false }
          ));
          return;
        }

        // ── 5. POST /api/google-oauth/disconnect ──────────────────────────────
        if (url.pathname.startsWith('/api/google-oauth/disconnect')) {
          setCorsHeaders(req, res);
          if (method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            return;
          }
          let bodyStr = '';
          req.on('data', (chunk: any) => { bodyStr += chunk; });
          req.on('end', () => {
            try {
              const body = JSON.parse(bodyStr || '{}');
              const userId = body.userId || '';
              const tokens = getUserTokens(userId);
              if (tokens) {
                deleteUserTokens(userId);
                writeAuditLog(userId, 'google_disconnect', `Conexión de Google (${tokens.email}) revocada.`);
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
          return;
        }

        // ── 6. GET /api/google-oauth/emails ───────────────────────────────────
        if (url.pathname.startsWith('/api/google-oauth/emails')) {
          setCorsHeaders(req, res);
          const userId = url.searchParams.get('userId') || '';
          const contactEmail = url.searchParams.get('contactEmail') || '';
          try {
            const emails = await listGmailEmails(userId, contactEmail);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, emails }));
          } catch (err: any) {
            console.error('[Emails Error]', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
          return;
        }

        // ── 7. POST /api/google-oauth/send-email ──────────────────────────────
        if (url.pathname.startsWith('/api/google-oauth/send-email')) {
          setCorsHeaders(req, res);
          if (method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            return;
          }
          let bodyStr = '';
          req.on('data', (chunk: any) => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              const body = JSON.parse(bodyStr || '{}');
              const { userId, to, subject, emailBody } = body;
              if (!userId || !to || !subject || !emailBody) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Faltan campos requeridos: userId, to, subject, emailBody.' }));
                return;
              }
              const result = await sendGmailEmail(userId, to, subject, emailBody);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, id: result.id, threadId: result.threadId }));
            } catch (err: any) {
              console.error('[Send Email Error]', err.message);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
          return;
        }

        // ── 8. POST /api/google-oauth/calendar-event ──────────────────────────
        if (url.pathname.startsWith('/api/google-oauth/calendar-event')) {
          setCorsHeaders(req, res);
          if (method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            return;
          }
          let bodyStr = '';
          req.on('data', (chunk: any) => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              const body = JSON.parse(bodyStr || '{}');
              const { userId, title, description, location, dateTime, durationMinutes, contactEmail, createMeet } = body;
              if (!userId || !title || !dateTime) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Faltan campos requeridos: userId, title, dateTime.' }));
                return;
              }
              const result = await createGoogleCalendarEvent(
                userId, title, description, location, dateTime,
                durationMinutes, contactEmail, createMeet
              );
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, hangoutLink: result.hangoutLink }));
            } catch (err: any) {
              console.error('[Calendar Event Error]', err.message);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
          return;
        }

        // ── 9. POST /api/extract-rut ──────────────────────────────────────────
        if (url.pathname.startsWith('/api/extract-rut')) {
          setCorsHeaders(req, res);
          if (method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            return;
          }
          let bodyStr = '';
          req.on('data', (chunk: any) => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              const body = JSON.parse(bodyStr || '{}');
              const { mimeType, data: base64Data } = body;
              if (!base64Data) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Falta información del archivo.' }));
                return;
              }

              const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.API_KEY || '';
              let rutResult: any = {};
              let lastErr: any = null;

              if (apiKey) {
                const models = ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-2.5-flash-preview', 'gemini-2.0-flash-lite-preview'];
                const prompt = `Eres un extractor de datos especializado en el RUT (Registro Único Tributario) de la DIAN, Colombia. Extrae en formato JSON exacto: razon_social (Casilla 35), nombre_comercial (Casilla 36), nit (Casilla 5), ciudad (Casilla 40), direccion (Casilla 41). Solo responde el JSON.`;

                for (const m of models) {
                  try {
                    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`;
                    const headers: Record<string, string> = {
                      'Content-Type': 'application/json',
                      'x-goog-api-key': apiKey,
                    };

                    const gRes = await fetch(apiUrl, {
                      method: 'POST',
                      headers,
                      body: JSON.stringify({
                        contents: [{
                          parts: [
                            { text: prompt },
                            { inlineData: { mimeType: mimeType || 'application/pdf', data: base64Data } }
                          ]
                        }],
                        generationConfig: { responseMimeType: 'application/json' }
                      })
                    });

                    if (gRes.ok) {
                      const gJson = await gRes.json();
                      const txt = gJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                      const cleaned = txt.match(/\{[\s\S]*\}/)?.[0] || txt;
                      const parsed = JSON.parse(cleaned);
                      if (parsed && (parsed.razon_social || parsed.nit)) {
                        rutResult = parsed;
                        break;
                      }
                    } else {
                      const errObj = await gRes.json().catch(() => ({}));
                      lastErr = errObj?.error?.message || `HTTP ${gRes.status}`;
                    }
                  } catch (e: any) {
                    lastErr = e.message;
                  }
                }
              }

              // Extracción local de patrones con descompresión zlib como respaldo
              if (!rutResult.razon_social && !rutResult.nit) {
                try {
                  const buf = Buffer.from(base64Data, 'base64');
                  let rawText = buf.toString('utf-8') + '\n' + buf.toString('binary');

                  // Decompress PDF FlateDecode streams
                  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
                  let match: RegExpExecArray | null;
                  while ((match = streamRegex.exec(buf.toString('binary'))) !== null) {
                    try {
                      const streamBytes = Buffer.from(match[1], 'binary');
                      let decompressed: Buffer;
                      try {
                        decompressed = zlib.inflateSync(streamBytes);
                      } catch {
                        decompressed = zlib.inflateRawSync(streamBytes);
                      }
                      rawText += '\n' + decompressed.toString('utf-8') + '\n' + decompressed.toString('binary');
                    } catch (e) {}
                  }

                  // Extraer bloques de texto entre paréntesis y bloques hexadecimales <HEX>
                  const textBlocks: string[] = [];
                  const pRegex = /\(([^()]{2,120})\)/g;
                  let pm: RegExpExecArray | null;
                  while ((pm = pRegex.exec(rawText)) !== null) {
                    const t = pm[1].trim();
                    if (t && !t.includes('00000 65536') && !t.startsWith('/') && !/^\d{10}\s+\d{5}/.test(t)) {
                      textBlocks.push(t);
                    }
                  }

                  // De-hex PDF hex text strings <HEX...>
                  const hexRegex = /<([0-9A-Fa-f]{6,500})>/g;
                  let hMatch: RegExpExecArray | null;
                  while ((hMatch = hexRegex.exec(rawText)) !== null) {
                    try {
                      const hexStr = hMatch[1];
                      const decoded = Buffer.from(hexStr, 'hex').toString('utf-8');
                      if (decoded && /[A-Z0-9]{3,}/i.test(decoded) && !decoded.includes('00000 65536')) {
                        textBlocks.push(decoded);
                      }
                    } catch (e) {}
                  }

                  const cleanText = textBlocks.join(' ') + '\n' + rawText.replace(/[\(\)<>\[\]\/]/g, ' ');

                  // Helper sanitizador para descartar basura de metadatos PDF (ej. xref tables)
                  const isRealText = (val?: string): boolean => {
                    if (!val) return false;
                    const v = val.trim();
                    if (v.includes('00000') || v.includes('65536') || v.includes('xref') || v.includes('endobj') || v.includes('trailer') || v.includes('stream')) return false;
                    if (/^\d{8,15}\s+00000/.test(v)) return false;
                    return v.length >= 3;
                  };

                  // 1. NIT (Casilla 5)
                  const nitMatch = cleanText.match(/\b5\s+(\d{8,11})\b/i) ||
                                   cleanText.match(/(?:NIT|Casilla\s*5|Identificaci[oó]n)[:\s]*([\d.\-]{8,15})/i) ||
                                   cleanText.match(/\b(\d{9,10}-\d|\d{3}\.\d{3}\.\d{3}-\d|\d{9})\b/);
                  if (nitMatch) {
                    const candidateNit = nitMatch[1].replace(/[^\d\-]/g, '');
                    if (isRealText(candidateNit)) rutResult.nit = candidateNit;
                  }

                  // 2. Razón Social (Casilla 35)
                  const razonMatch = cleanText.match(/\b35\s+([A-Z0-9\s.\-&]{3,60}\s+(?:S\.?A\.?S\.?|LTDA|S\.?A\.?|E\.?U\.?|INC|CORP))\b/i) ||
                                     cleanText.match(/(?:Razon\s*Social|Razón\s*Social|Casilla\s*35)[:\s]*([^\r\n]{3,60})/i) ||
                                     cleanText.match(/([A-Z0-9\s.\-&]{4,60}\s+(?:S\.?A\.?S\.?|LTDA|S\.?A\.?|E\.?U\.?))/i);
                  if (razonMatch) {
                    const candidateRazon = razonMatch[1].trim();
                    if (isRealText(candidateRazon)) rutResult.razon_social = candidateRazon;
                  }

                  // 3. Dirección (Casilla 41)
                  const dirMatch = cleanText.match(/\b41\s+((?:Calle|Carrera|Cra|Cl|Av|Avenida|Transversal|Tv|Diagonal|Dg|Autopista|Kmr|Km)[^\r\n]{5,50})/i) ||
                                   cleanText.match(/(?:Direcci[oó]n|Casilla\s*41)[:\s]*([^\r\n]{5,60})/i);
                  if (dirMatch) {
                    const candidateDir = (dirMatch[1] || dirMatch[0]).replace(/^41\s+/, '').trim();
                    if (isRealText(candidateDir)) rutResult.direccion = candidateDir;
                  }

                  // 4. Ciudad (Casilla 40)
                  const ciudadMatch = cleanText.match(/\b40\s+([A-Z\s]{3,25})\b/i) ||
                                      cleanText.match(/\b(Bogot[aá]|Medell[ií]n|Cali|Barranquilla|Cartagena|Bucaramanga|Pereira|Manizales|Cúcuta|Ibagué|Neiva|Santa Marta|Villavicencio|Rionegro|Envigado|Itagüí|Chía|Soacha)\b/i);
                  if (ciudadMatch) {
                    const candidateCiudad = ciudadMatch[1] || ciudadMatch[0];
                    if (isRealText(candidateCiudad)) rutResult.ciudad = candidateCiudad;
                  }
                } catch (e) {}
              }

              // Retornar respuesta exitosa (HTTP 200) siempre para no bloquear la interfaz
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                data: rutResult,
                warning: (!rutResult.razon_social && !rutResult.nit)
                  ? 'No se pudieron extraer los datos automáticamente. Por favor diligencie los campos manualmente.'
                  : undefined
              }));
              return;
            } catch (err: any) {
              console.error('[Extract RUT Error]', err.message);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
          return;
        }

        // ── Cualquier otra ruta → continuar con Vite ─────────────────────────
        next();
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      strictPort: true, // fail loudly if 3000 is busy instead of silently switching ports (would break the Google OAuth redirect URI)
      host: '0.0.0.0',
    },
    plugins: [react(), googleOAuthPlugin()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY || env.API_KEY || ''),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY || env.API_KEY || ''),
      'process.env.VITE_GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY || env.API_KEY || '')
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
