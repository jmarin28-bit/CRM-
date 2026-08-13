import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

import fs from 'fs';
import zlib from 'zlib';
import { createRequire } from 'module';
const requireCJS = createRequire(import.meta.url);

// Load environment variables and assign them to process.env
const loadedEnv = loadEnv(process.env.NODE_ENV || 'development', '.', '');

// Ojo: process.env convierte cualquier valor a string. Asignar undefined deja
// literalmente el texto "undefined", que es truthy y se colaba como valor real
// (así salía redirect_uri=undefined en la URL de Google). Por eso solo se
// asigna cuando hay un valor de verdad.
export function getFreshEnv(key: string): string {
  const currentEnv = loadEnv(process.env.NODE_ENV || 'development', '.', '');
  const val = (currentEnv[key] ?? process.env[key] ?? '').trim();
  if (val) {
    process.env[key] = val;
  }
  return val;
}

function setEnvIfPresent(key: string, value: string | undefined) {
  const resolved = getFreshEnv(key);
  if (!resolved && value) {
    process.env[key] = value.trim();
  }
}

setEnvIfPresent('GOOGLE_CLIENT_ID', loadedEnv.GOOGLE_CLIENT_ID);
setEnvIfPresent('GOOGLE_CLIENT_SECRET', loadedEnv.GOOGLE_CLIENT_SECRET);
setEnvIfPresent('GOOGLE_REDIRECT_URI', loadedEnv.GOOGLE_REDIRECT_URI);
setEnvIfPresent('MOCK_OAUTH', loadedEnv.MOCK_OAUTH);
setEnvIfPresent('GEMINI_API_KEY', loadedEnv.GEMINI_API_KEY);
setEnvIfPresent('VITE_GEMINI_API_KEY', loadedEnv.VITE_GEMINI_API_KEY);
setEnvIfPresent('OPENROUTER_API_KEY', loadedEnv.OPENROUTER_API_KEY);
setEnvIfPresent('VITE_OPENROUTER_API_KEY', loadedEnv.VITE_OPENROUTER_API_KEY);
setEnvIfPresent('API_KEY', loadedEnv.API_KEY);

console.log("─── Google OAuth Config ───────────────────────────");
console.log("CLIENT_ID:", getFreshEnv('GOOGLE_CLIENT_ID') || 'NO DEFINIDO');
console.log("CLIENT_SECRET:", getFreshEnv('GOOGLE_CLIENT_SECRET') ? getFreshEnv('GOOGLE_CLIENT_SECRET').substring(0, 8) + "..." : 'NO DEFINIDO');
console.log("REDIRECT_URI:", getFreshEnv('GOOGLE_REDIRECT_URI') || 'NO DEFINIDO (se calculará del host)');
console.log("MOCK_MODE:", isMockMode() ? 'ACTIVADO (Sandbox Mode)' : 'DESACTIVADO (Real Google OAuth)');
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
import { extractNitFromText, normalizeNit, nitDebugWindow } from './services/rutNit';

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
            client_id: getFreshEnv('GOOGLE_CLIENT_ID'),
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
            const rawClientId = getFreshEnv('GOOGLE_CLIENT_ID');
            const rawClientSecret = getFreshEnv('GOOGLE_CLIENT_SECRET');
            const secretMasked = rawClientSecret
              ? `${rawClientSecret.substring(0, 10)}...${rawClientSecret.slice(-4)} (Longitud: ${rawClientSecret.length} chars)`
              : 'NO DEFINIDO';

            console.log("─── Token Exchange Diagnóstico ─────────────────────");
            console.log("Client ID leído:", rawClientId || 'NO DEFINIDO');
            console.log("Client Secret leído:", secretMasked);
            console.log("Redirect URI:", redirectUri);
            console.log("Grant Type: authorization_code");
            console.log("───────────────────────────────────────────────────");

            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                code,
                client_id: rawClientId,
                client_secret: rawClientSecret,
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

              // invalid_client (Client Secret inválido) → instrucciones claras
              if (errDetail.includes('invalid_client') || errText.includes('invalid_client') || tokenResponse.status === 401) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(oauthErrorPage(
                  'GOOGLE_CLIENT_SECRET Inválido (HTTP 401)',
                  `El GOOGLE_CLIENT_SECRET configurado en .env no es el secreto activo para el Client ID: ${rawClientId}.`,
                  `Client ID leído: ${rawClientId}\nClient Secret leído: ${secretMasked}\n\nRespuesta de Google Cloud: ${errDetail}\n\nPASOS PARA CORREGIR:\n1. Ingresa a Google Cloud Console -> APIs & Services -> Credentials.\n2. Abre el cliente OAuth "CRM IONCORE" (${rawClientId}).\n3. Copia el nuevo "Secret de cliente" activo (creado el 11 de agosto de 2026).\n4. Actualiza en tu archivo .env: GOOGLE_CLIENT_SECRET=<NUEVO_CLIENT_SECRET>\n5. Reinicia el servidor dev (npm run dev).`
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
          const tokens = getUserTokens(userId);
          if (!tokens) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, connected: false, emails: [], message: 'Cuenta de Google no conectada' }));
            return;
          }
          try {
            const emails = await listGmailEmails(userId, contactEmail);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, connected: true, emails }));
          } catch (err: any) {
            console.error('[Emails Error]', err.message);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, connected: false, emails: [], error: err.message }));
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
              const tokens = getUserTokens(userId);
              if (!tokens) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, connected: false, error: 'La cuenta de Google no está conectada. Por favor autentícate primero.' }));
                return;
              }
              const result = await sendGmailEmail(userId, to, subject, emailBody);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, connected: true, id: result.id, threadId: result.threadId }));
            } catch (err: any) {
              console.error('[Send Email Error]', err.message);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, connected: false, error: err.message }));
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

              const openRouterKey = process.env.OPENROUTER_API_KEY || '';
              console.log('[RUT Backend] 📥 Solicitud recibida. Base64 length:', base64Data ? base64Data.length : 0);

              let rutResult: any = {};
              let pdfPages = 0;
              let fullText = '';
              let usedPdfParse = false;
              let usedOpenRouterFallback = false;

              try {
                const pdfParse = requireCJS('pdf-parse');
                const buf = Buffer.from(base64Data, 'base64');
                let pdfData: any = null;
                try {
                  pdfData = await pdfParse(buf, { password: "" });
                } catch (ePass) {
                  pdfData = await pdfParse(buf);
                }
                pdfPages = pdfData.numpages || 1;
                fullText = (pdfData.text || '').replace(/\s+/g, ' ').trim();

                if (fullText.length >= 50) {
                  const cleanExtracted = (value: string) => {
                    if (!value) return null;
                    let cleaned = value.trim();
                    if (cleaned.length < 3) return null;

                    // Remover prefijos de encabezado DIAN si quedaron pegados
                    cleaned = cleaned.replace(/^.*?(?:Persona\s+jur[ií]dica\s+\d+\s*)/i, "")
                                     .replace(/^.*?(?:35\.\s*Raz[oó]n\s*social\s*)/i, "")
                                     .replace(/^.*?(?:Impuestos\s+de\s+[^\d]+\d+\s*)/i, "")
                                     .trim();

                    const invalid = ['primer apellido','segundo apellido','otros nombres','sin perjuicio','tipo','casilla','exportadoresusuarios','firma autorizada','responsabilidades','establecimientos','parágrafo','decreto'];
                    const v = cleaned.toLowerCase();
                    if (invalid.some(i => v.includes(i))) return null;

                    // Cortar si encuentra encabezados de tabla siguientes (36., 37., 38., UBICACION, COLOMBIA, 169, 42. Correo)
                    cleaned = cleaned.split(/\s+(?:36\.|37\.|38\.|UBICACI[OÓ]N|COLOMBIA|169|42\.|42\s*Correo|Correo|email|[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i)[0];

                    return cleaned.replace(/\s{2,}/g, ' ').trim();
                  };

                  // 1. Razón Social (Casilla 35 explícita sin arrastrar 36/37/38/COLOMBIA)
                  const matchCasilla35 = fullText.match(/(?:35\.\s*(?:Raz[oó]n\s*social)?[:\s]*)([A-ZÁÉÍÓÚÑ0-9\s.\-&]{3,100}?)(?=\s+(?:36\.|37\.|38\.|UBICACI[OÓ]N|COLOMBIA|169|41\.))/i);
                  if (matchCasilla35) {
                    const cleaned = cleanExtracted(matchCasilla35[1]);
                    if (cleaned) rutResult.razon_social = cleaned;
                  }

                  // 1B. Nombre Comercial (Casilla 36)
                  // Solo se llena si existe un valor REAL entre la casilla 36 y la 37.
                  // Si la casilla 36 está vacía, se deja vacía.
                  // NO usar la casilla 37 (Sigla) como Nombre Comercial.
                  const matchCasilla36 = fullText.match(
                    /36\.\s*Nombre\s+comercial\s+(.{2,100}?)(?=\s+37\.)/i
                  );

                  if (matchCasilla36) {
                    const cleaned = cleanExtracted(matchCasilla36[1]);
                    if (cleaned) {
                      rutResult.nombre_comercial = cleaned;
                    }
                  }

                  if (!rutResult.razon_social) {
                    const rsMatch = fullText.match(/([A-ZÁÉÍÓÚÑ0-9\s.\-&]{3,70}\s+(?:S\.?A\.?S\.?|LTDA\.?|S\.?A\.?|E\.?U\.?|INC\.?|CORP\.?))/i);
                    if (rsMatch) {
                      const cleaned = cleanExtracted(rsMatch[1]);
                      if (cleaned) rutResult.razon_social = cleaned;
                    }
                  }

                  if (!rutResult.razon_social) {
                    const matchColombia = fullText.match(/([A-ZÁÉÍÓÚÑ0-9\s.\-&]{3,80}?)\s+\bCOLOMBIA\b\s+(?:1\s*6\s*9|169)/i);
                    if (matchColombia) {
                      const cleaned = cleanExtracted(matchColombia[1]);
                      if (cleaned) rutResult.razon_social = cleaned;
                    }
                  }

                  // 2. NIT (Casilla 5) y DV (Casilla 6), formato NIT-DV: 900745087-2.
                  // La lógica vive en services/rutNit.ts porque el parser local
                  // del navegador necesita exactamente la misma; ver ese archivo
                  // para el detalle de los formatos que soporta.
                  const nitFound = extractNitFromText(fullText);
                  if (nitFound.nit) {
                    rutResult.nit = nitFound.nit;
                    rutResult.dv = nitFound.dv;
                    console.log(`[RUT Backend] 🔢 NIT detectado: ${nitFound.nit} (score ${nitFound.score}, DV ${nitFound.dvSource})`);
                  } else {
                    // Sin esto no hay forma de saber por qué falló: se imprime el
                    // trozo de texto donde debería estar la casilla 5.
                    console.warn('[RUT Backend] ⚠️ No se pudo detectar el NIT. Texto alrededor de la casilla 5:');
                    console.warn(`[RUT Backend]    "${nitDebugWindow(fullText)}"`);
                  }

                  const sanitizeAddress = (addr: string) => {
                    if (!addr) return null;
                    let clean = addr.trim();
                    clean = clean.split(/\s+[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/i)[0];
                    clean = clean.split(/\s*@.*/)[0];
                    clean = clean.split(/\s+(?:42\.|42\s|43\.|44\.|45\.|46\.|Correo|Email|Tel[eé]fono|CLASE|INFORMACI[OÓ]N)/i)[0];
                    const validTokens = new Set(['sur', 'norte', 'este', 'oeste', 'bis', 'apto', 'of', 'oficina', 'piso', 'int', 'interior', 'mz', 'lt', 'km', 'local', 'bodega', 'torre', 'bloque']);
                    const parts = clean.split(/\s+/);
                    while (parts.length > 0) {
                      const lastWord = parts[parts.length - 1].toLowerCase();
                      if (/^[a-z]{4,}$/i.test(lastWord) && !validTokens.has(lastWord)) {
                        parts.pop();
                      } else {
                        break;
                      }
                    }
                    const res = parts.join(' ').trim();
                    return res.length >= 3 ? res : null;
                  };

                  // 3. Dirección (Casilla 41 - Captura limpia p. ej. "CL 33 CR 74 B 146" o "CR 81 B 51 52")
                  const cas41Match = fullText.match(/(?:41\.\s*(?:Direcci[oó]n\s*principal|Direcci[oó]n)?[:\s]*)([A-Z0-9ÁÉÍÓÚÑ\s#.\-/#]{5,80}?)(?=\s+(?:42\.|42\s|43\.|44\.|45\.|46\.|Correo|Email|Tel[eé]fono|CLASE|INFORMACI[OÓ]N))/i);
                  if (cas41Match) {
                    const cleaned = cleanExtracted(cas41Match[1]);
                    if (cleaned) {
                      const sanitized = sanitizeAddress(cleaned);
                      if (sanitized) rutResult.direccion = sanitized;
                    }
                  }

                  if (!rutResult.direccion) {
                    const dirPatterns = [
                      /\b((?:DG|CL|CR|CRA|AV|TV|CALLE|CARRERA|DIAGONAL|TRANSVERSAL|AVENIDA|AUTOPISTA|AK|AC|KR)\.?\s+[A-Z0-9\s#.\-/]{5,50})/i
                    ];
                    for (const p of dirPatterns) {
                      const m = fullText.match(p);
                      if (m && m[1]) {
                        const cleaned = cleanExtracted(m[1].trim());
                        if (cleaned) {
                          const sanitized = sanitizeAddress(cleaned);
                          if (sanitized && sanitized.length >= 5) { rutResult.direccion = sanitized; break; }
                        }
                      }
                    }
                  }

                  // 4. Ciudad / Municipio (Casilla 40)
                  const cas40Match = fullText.match(/(?:40\.\s*(?:Ciudad\s*\/\s*Municipio|Ciudad|Municipio)?[:\s]*)([A-ZÁÉÍÓÚÑ\s]{3,30}?)(?=\s+(?:41\.|41\s|Direcci[oó]n))/i);
                  if (cas40Match) {
                    const cleaned = cleanExtracted(cas40Match[1].replace(/^[0-9\s]+/, ""));
                    if (cleaned) rutResult.ciudad = cleaned;
                  }

                  if (!rutResult.ciudad) {
                    const ciudadKnown = fullText.match(/\b(Bogot[aá](?:\s*D\.?\s*C\.?)?|Medell[ií]n|Cali|Barranquilla|Cartagena|Bucaramanga|Pereira|Manizales|C[uú]cuta|Ibagu[eé]|Neiva|Santa\s+Marta|Villavicencio|Rionegro|Envigado|Itag[uü][eé]|Ch[ií]a|Soacha|Palmira|Bello|Pasto|Monter[ií]a|Valledupar|Floridablanca|Girardota|Sabaneta)\b/i);
                    if (ciudadKnown) {
                      rutResult.ciudad = ciudadKnown[1].trim();
                    }
                  }

                  if (rutResult.razon_social && rutResult.nit) {
                    usedPdfParse = true;
                  }
                }
              } catch (pdfErr: any) {
                console.error('[RUT Backend] ❌ Error en pdf-parse:', pdfErr.message);
              }

              const hasEnoughText = fullText.length >= 50;
              console.log(`[RUT Backend] 🔍 Using pdf-parse completado: ${usedPdfParse}`);
              console.log(`[RUT Backend] 🔍 Texto suficiente para IA (>= 50 chars): ${hasEnoughText}`);
              console.log('[RUT Backend] 📊 Datos extraídos por pdf-parse:', JSON.stringify(rutResult));

              // ── PASO 2: Enriquecimiento con OpenRouter API (SOLO SI TIENE TEXTO SUFICIENTE) ──
              let openRouterError: string | null = null;

              // La condición anterior sólo pedía ayuda a la IA cuando NO se había
              // extraído absolutamente nada. Como razón social, ciudad y dirección
              // casi siempre se leen bien, un NIT ausente nunca llegaba a tener
              // segunda oportunidad: el formulario se abría con el NIT vacío.
              // Ahora basta con que falte alguno de los dos campos obligatorios.
              const missingRequired = !rutResult.razon_social || !rutResult.nit;

              if (!hasEnoughText) {
                console.log('[RUT Backend] 🛑 El PDF no contiene texto digital seleccionable suficiente. Se omite llamada a OpenRouter.');
              } else if (missingRequired && openRouterKey) {
                usedOpenRouterFallback = true;
                console.log(`[RUT Backend] 🤖 Using OpenRouter fallback: ${usedOpenRouterFallback}`);

                const modelToUse = 'openrouter/free';
                console.log(`[RUT Backend] 🤖 Modelo OpenRouter: ${modelToUse}`);
                
                try {
                  const promptInstructions = `
Eres un sistema experto en extracción de datos del RUT (Registro Único Tributario) de la DIAN Colombia.
Analiza el siguiente texto de RUT DIAN y responde ÚNICAMENTE con un objeto JSON válido con esta estructura exacta:

{
  "razon_social": "Razón Social o Nombre Completo",
  "nombre_comercial": "Nombre Comercial",
  "nit": "NIT completo con DV formato XXXXXXXXX-X",
  "ciudad": "Ciudad o Municipio",
  "direccion": "Dirección Principal"
}

REGLAS ESTRUCTURADAS DE EXTRACCIÓN:
- Extrae los datos exclusivamente de los campos correspondientes del RUT.
- NIT: Extraer el número de identificación tributaria completo incluyendo el dígito de verificación (DV). El resultado debe tener este formato: XXXXXXXXX-X (Ejemplo: 900745087-2).
- RAZÓN SOCIAL: Extraer exclusivamente el valor del campo "35. Razón social" (o casillas 31-34 si es persona natural).
- NOMBRE COMERCIAL: Extraer exclusivamente el valor del campo "36. Nombre comercial".
- CIUDAD: Extraer exclusivamente el valor del campo "40. Ciudad/Municipio".
- DIRECCIÓN: Extraer exclusivamente el valor del campo "41. Dirección principal". No agregar información de otros campos. No agregar nombres de personas. No agregar correos electrónicos. No agregar teléfonos. No concatenar texto que aparezca después de la dirección.
- CORREO: Si se extrae correo electrónico, debe mantenerse como un dato independiente y nunca formar parte de la dirección.
- SECTOR: NO inferir ni seleccionar el sector. Devolver vacío "".
- CLASIFICACIÓN: NO inferir ni seleccionar la clasificación. Devolver vacío "".
- SEDE: NO inferir ni copiar datos del RUT. Devolver vacío "".
- NO devuelvas números de casilla ni texto legal.
- Si no encuentras un campo, pon "".

TEXTO DEL RUT:
${fullText.substring(0, 4000)}
`;

                  const openRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${openRouterKey}`,
                      'Content-Type': 'application/json',
                      'HTTP-Referer': 'http://localhost:3000',
                      'X-Title': 'Ioncore CRM'
                    },
                    body: JSON.stringify({
                      model: modelToUse,
                      messages: [{ role: 'user', content: promptInstructions }]
                    })
                  });

                  console.log(`[RUT Backend] 📡 OpenRouter HTTP Status: ${openRes.status} ${openRes.statusText}`);
                  console.log(`[RUT Backend] 📋 OpenRouter Content-Type: ${openRes.headers.get('content-type')}`);
                  
                  const rawText = await openRes.text();
                  console.log(`[RUT Backend] 📄 OpenRouter RAW Body (primeros 500 chars): ${rawText.substring(0, 500)}`);

                  if (!rawText || !rawText.trim()) {
                    openRouterError = `OpenRouter devolvió una respuesta vacía (0 bytes) con status HTTP ${openRes.status}`;
                    console.error('[RUT Backend] ❌ ' + openRouterError);
                  } else {
                    let openJson: any = null;
                    try {
                      openJson = JSON.parse(rawText.trim());
                    } catch (eParse: any) {
                      openRouterError = `Respuesta no-JSON de OpenRouter (HTTP ${openRes.status}): ${rawText.substring(0, 200)}`;
                      console.error('[RUT Backend] ❌ Error parseando respuesta de OpenRouter:', eParse.message);
                    }

                    if (openRes.ok && openJson) {
                      const txt = openJson.choices?.[0]?.message?.content || '';
                      console.log('[RUT Backend] 🤖 Contenido del mensaje de OpenRouter:', txt.substring(0, 300));
                      const jsonMatch = txt.match(/\{[\s\S]*\}/)?.[0];
                      if (jsonMatch) {
                        try {
                          const parsed = JSON.parse(jsonMatch);
                          if (parsed && typeof parsed === 'object') {
                            if (parsed.razon_social && !rutResult.razon_social) rutResult.razon_social = parsed.razon_social;
                            if (parsed.nit && !rutResult.nit) {
                              // El modelo suele devolver el NIT sin DV o con puntos
                              // de miles; se normaliza antes de guardarlo.
                              const normalized = normalizeNit(parsed.nit);
                              if (normalized) {
                                rutResult.nit = normalized;
                                rutResult.dv = normalized.split('-')[1] || '';
                              }
                            }
                            if (parsed.nombre_comercial && !rutResult.nombre_comercial) rutResult.nombre_comercial = parsed.nombre_comercial;
                            if (parsed.ciudad && !rutResult.ciudad) rutResult.ciudad = parsed.ciudad;
                            if (parsed.direccion && !rutResult.direccion) rutResult.direccion = parsed.direccion;
                            if (parsed.email && !rutResult.email) rutResult.email = parsed.email;
                            if (parsed.telefono && !rutResult.telefono) rutResult.telefono = parsed.telefono;
                          }
                        } catch (eContentJson: any) {
                          console.warn('[RUT Backend] ⚠️ El contenido devuelto por la IA no es un JSON válido:', eContentJson.message);
                        }
                      }
                    } else if (openJson) {
                      openRouterError = openJson?.error?.message || `HTTP ${openRes.status} desde OpenRouter`;
                      console.error('[RUT Backend] ❌ Error de OpenRouter:', JSON.stringify(openJson.error));
                    }
                  }
                } catch (orErr: any) {
                  openRouterError = `Excepción en la llamada a OpenRouter: ${orErr.message}`;
                  console.error('[RUT Backend] ❌ Excepción llamando OpenRouter:', orErr.message);
                }
              }







              function cleanValue(value: any) {
                if (!value || typeof value !== 'string') return null;
                const invalid = ['primer apellido','segundo apellido','otros nombres','sin perjuicio','tipo','31.','32.','33.','34.'];
                const v = value.toLowerCase();
                if (invalid.some(i => v.includes(i))) return null;
                if (value.trim().length < 3) return null;
                return value.trim();
              }

              const filteredData: Record<string, string | null> = {
                razon_social: cleanValue(rutResult.razon_social),
                nombre_comercial: cleanValue(rutResult.nombre_comercial) || null,
                nit: normalizeNit(rutResult.nit, rutResult.dv) || null,
                dv: rutResult.dv ? String(rutResult.dv).trim() : null,
                direccion: cleanValue(rutResult.direccion),
                ciudad: cleanValue(rutResult.ciudad),
              };

              // Retornar error HTTP si OpenRouter falló o respuesta exitosa (200) si se extrajeron datos
              const isDataEmpty =
                !filteredData.razon_social &&
                !filteredData.nit &&
                !filteredData.ciudad &&
                !filteredData.direccion;
              
              if (isDataEmpty && openRouterError) {
                console.error('[RUT Backend] ❌ Error en OpenRouter:', openRouterError);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  success: false,
                  error: `OpenRouter API Error: ${openRouterError}`
                }));
                return;
              }

              console.log('[RUT Backend] 📤 Respuesta enviada al cliente (200 OK):', { success: true, data: filteredData });

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                data: filteredData,
                warning: isDataEmpty ? 'No se encontraron campos legibles en el PDF subido. Por favor ingresa los datos manualmente.' : undefined
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
      'process.env.VITE_GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY || env.API_KEY || ''),
      'process.env.OPENROUTER_API_KEY': JSON.stringify(env.OPENROUTER_API_KEY || env.VITE_OPENROUTER_API_KEY || '')
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
