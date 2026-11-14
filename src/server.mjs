// Servidor de la plataforma: reparte cada petición según el subdominio.
//   admin.<dominio>            → panel del superadministrador
//   <cliente>.<dominio>        → la web de ese cliente (si está activo o en prueba)
//   <cliente>.<dominio>/panel/ → el panel de su titular, para editar su web y sus fotos
//   <dominio>                  → presentación sencilla
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { createAdminApi } from './admin.mjs';
import { createPanelApi } from './panel.mjs';
import { photoPath } from './photos.mjs';
import { timingSafeEqual } from 'node:crypto';
import { HttpError } from './security.mjs';
import { METHODS, money, recordPayment } from './billing.mjs';
import { accessOf, countVisit, findTenant } from './tenants.mjs';
import { countDailyVisit } from './central.mjs';
import { SITE_CSP, esc, renderCartel, renderDatos, renderNotice, renderSite, renderTema } from './web.mjs';

const PUBLIC = path.join(ROOT, 'public');
const SEEN_EVERY_MS = 5 * 60 * 1000;
const MAX_JSON = 256 * 1024;
const MAX_RAW = 4 * 1024 * 1024 + 1;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8',
};

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};
// Paneles (superadministrador y titular): las vistas previas de fotos usan blob:
const PANEL_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const NOTICE_CSP = "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function createServer(control, config) {
  const domain = config.domain;
  const adminApi = createAdminApi(control, config);
  const panelApi = createPanelApi(control, config);
  const lastSeen = new Map();

  const headers = (csp, extra = {}) => ({
    ...BASE_HEADERS, 'Content-Security-Policy': csp,
    ...(config.production ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
    ...extra,
  });

  const send = (res, status, body, hdrs) => {
    res.writeHead(status, hdrs);
    res.end(res.req.method === 'HEAD' ? undefined : body);
  };

  const notice = (res, status, title, html) =>
    send(res, status, renderNotice(title, html), headers(NOTICE_CSP, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' }));

  // Archivo dentro de «dir», sin salirse de la carpeta ni servir ocultos
  const serveFile = (res, dir, rel, csp, cache = 'public, max-age=3600') => {
    let decoded;
    try { decoded = decodeURIComponent(rel); } catch { return false; }
    const file = path.normalize(path.join(dir, decoded));
    if (!file.startsWith(dir + path.sep) || decoded.split('/').some((p) => p.startsWith('.'))) return false;
    let stat;
    try { stat = fs.statSync(file); } catch { return false; }
    if (!stat.isFile()) return false;
    const ext = path.extname(file).toLowerCase();
    send(res, 200, fs.readFileSync(file), headers(csp, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      // Código y estilos se revalidan siempre, para que una actualización se vea al momento
      'Cache-Control': ['.html', '.js', '.mjs', '.css'].includes(ext) ? 'no-cache' : cache,
    }));
    return true;
  };

  const servePhoto = (res, slug, file, csp) => {
    const p = photoPath(config.dataDir, slug, file);
    if (!p || !fs.existsSync(p)) return false;
    // El nombre es único y nunca cambia: se puede guardar en caché mucho tiempo
    send(res, 200, fs.readFileSync(p), headers(csp, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' }));
    return true;
  };

  const readBody = (req, raw) => new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') { resolve({}); return; }
    const limit = raw ? MAX_RAW : MAX_JSON;
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, raw ? 'La foto es demasiado grande (máximo 4 MB)' : 'Demasiados datos')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (raw) { resolve(buf); return; }
      if (!buf.length) { resolve({}); return; }
      try { resolve(JSON.parse(buf.toString('utf8'))); } catch { reject(new HttpError(400, 'Petición mal formada')); }
    });
    req.on('error', reject);
  });

  const clientIp = (req) => (config.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || '';

  // Las dos API: mismo origen obligatorio al cambiar algo (contra peticiones falsificadas desde otra web)
  async function runApi(req, res, call, wantsRaw) {
    const jsonHeaders = headers(PANEL_CSP, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
    try {
      let raw = false;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.origin;
        let host = '';
        try { host = origin ? new URL(origin).host : ''; } catch { /* origen ilegible */ }
        if (!origin || host !== req.headers.host) throw new HttpError(403, 'Origen no permitido');
        const type = String(req.headers['content-type'] ?? '');
        raw = wantsRaw && type.startsWith('image/jpeg');
        if (!raw && !type.startsWith('application/json') && Number(req.headers['content-length'] ?? 0) > 0) throw new HttpError(415, 'Se esperaba JSON');
      }
      const body = await readBody(req, raw);
      const out = await call(body, clientIp(req));
      send(res, out.status ?? 200, JSON.stringify(out.body), { ...jsonHeaders, ...(out.headers ?? {}) });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error(err);
      if (!res.headersSent) send(res, status, JSON.stringify({ error: status >= 500 ? 'Error interno del servidor' : err.message }), jsonHeaders);
    }
  }

  async function adminHost(req, res, url) {
    const p = url.pathname;
    if (p.startsWith('/api/admin/')) {
      const sub = p.slice('/api/admin'.length);
      await runApi(req, res, (body, ip) => adminApi(req, sub, body, ip), adminApi.wantsRaw(req.method, sub));
      return;
    }
    if (p === '/' || p === '/plataforma') {
      res.writeHead(302, { ...BASE_HEADERS, Location: '/plataforma/' });
      res.end();
      return;
    }
    if (p.startsWith('/plataforma/') && serveFile(res, path.join(PUBLIC, 'plataforma'), p === '/plataforma/' ? 'index.html' : p.slice('/plataforma/'.length), PANEL_CSP)) return;
    if (p.startsWith('/shared/') && serveFile(res, path.join(PUBLIC, 'shared'), p.slice('/shared/'.length), PANEL_CSP)) return;
    // Miniaturas en la ficha: fotos compartidas y fotos propias de cada cliente
    if (p.startsWith('/web-img/') && serveFile(res, path.join(PUBLIC, 'web', 'img'), p.slice('/web-img/'.length), PANEL_CSP)) return;
    const m = /^\/clientes\/([a-z0-9-]+)\/fotos\/([^/]+)$/.exec(p);
    if (m && servePhoto(res, m[1], m[2], PANEL_CSP)) return;
    notice(res, 404, 'No encontrado', 'Esta página no existe.');
  }

  async function tenantHost(req, res, url, slug) {
    const t = findTenant(control, slug);
    if (!t) { notice(res, 404, 'Esta dirección no existe', 'Revisa que la dirección esté bien escrita.'); return; }
    const access = accessOf(t);
    if (!access.open) {
      const expired = access.state === 'prueba_vencida';
      if (url.pathname.startsWith('/api/')) {
        send(res, 403, JSON.stringify({ error: `${expired ? 'Periodo de prueba terminado' : 'Servicio suspendido'}. Contacta con tu proveedor.` }),
          headers(PANEL_CSP, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' }));
        return;
      }
      notice(res, 403, expired ? 'Periodo de prueba terminado' : 'Servicio suspendido',
        expired
          ? `El periodo de prueba de <strong>${esc(t.name)}</strong> ha terminado. En cuanto se active el servicio, su web volverá a estar disponible.`
          : `La web de <strong>${esc(t.name)}</strong> no está disponible temporalmente.`);
      return;
    }
    const p = url.pathname;

    // Panel del titular
    if (p.startsWith('/api/panel/')) {
      const sub = p.slice('/api/panel'.length);
      await runApi(req, res, (body, ip) => panelApi(req, t, sub, body, ip), panelApi.wantsRaw(req.method, sub));
      return;
    }
    if (p === '/panel') { res.writeHead(302, { ...BASE_HEADERS, Location: '/panel/' }); res.end(); return; }
    if (p.startsWith('/panel/') && serveFile(res, path.join(PUBLIC, 'panel'), p === '/panel/' ? 'index.html' : p.slice('/panel/'.length), PANEL_CSP)) return;
    if (p.startsWith('/shared/') && serveFile(res, path.join(PUBLIC, 'shared'), p.slice('/shared/'.length), PANEL_CSP)) return;

    // Web pública
    const now = Date.now();
    if ((lastSeen.get(slug) ?? 0) + SEEN_EVERY_MS < now) {
      lastSeen.set(slug, now);
      control.prepare('UPDATE tenants SET last_seen_at = ? WHERE id = ?').run(new Date(now).toISOString(), t.id);
    }
    const page = (body, type) => send(res, 200, body, headers(SITE_CSP, { 'Content-Type': type, 'Cache-Control': 'no-cache' }));
    if (p === '/' || p === '/index.html') {
      if (req.method === 'GET') { countVisit(control, t); countDailyVisit(control, t, req); }
      page(renderSite(t), TYPES['.html']);
      return;
    }
    if (p === '/datos.js') { page(renderDatos(t), TYPES['.js']); return; }
    if (p === '/tema.css') { page(renderTema(t), TYPES['.css']); return; }
    // El QR lleva a su web: en producción siempre por https, con la dirección por la que se ha entrado
    if (p === '/cartel.html') { page(renderCartel(t, `${config.production ? 'https' : 'http'}://${String(req.headers.host).toLowerCase()}/`), TYPES['.html']); return; }
    const photo = /^\/fotos\/([^/]+)$/.exec(p);
    if (photo && servePhoto(res, slug, photo[1], SITE_CSP)) return;
    if (serveFile(res, path.join(PUBLIC, 'web'), p.slice(1), SITE_CSP)) return;
    notice(res, 404, 'No encontrado', 'Esta página no existe.');
  }

  const centralPayment = async (req, res) => {
    const json = (status, data) => send(res, status, JSON.stringify(data), { ...BASE_HEADERS, 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
    const key = String(req.headers['x-firztnet-clave'] ?? '');
    if (!config.centralKey || key.length !== config.centralKey.length || !timingSafeEqual(Buffer.from(key), Buffer.from(config.centralKey))) {
      json(401, { error: 'Clave no válida' }); return;
    }
    try {
      const body = await readBody(req, false);
      const t = findTenant(control, String(body.slug ?? ''));
      if (!t) { json(404, { error: 'Ese cliente no existe en Reciclaje' }); return; }
      const metodo = String(body.metodo ?? '').toLowerCase();
      const p = recordPayment(control, t, {
        cuotas: body.cuotas, amount: body.importe === undefined || body.importe === null ? undefined : String(body.importe).replace('.', ','),
        method: METHODS.find((m) => metodo.includes(m)) ?? (metodo ? 'otro' : ''), note: String(body.nota ?? 'Apuntado desde Firztnet Central').slice(0, 200),
      }, null);
      control.prepare('INSERT INTO admin_activity (admin_id, tenant_id, summary) VALUES (NULL, ?, ?)')
        .run(t.id, `Firztnet Central apuntó un pago de ${money(p.amount_cents)} de «${t.name}»: pagado hasta el ${p.covers_until}`.slice(0, 300));
      json(200, { ok: true, renueva: p.covers_until });
    } catch (err) {
      json(err instanceof HttpError ? err.status : 500, { error: err instanceof HttpError ? err.message : 'Error al apuntar el pago' });
    }
  };

  return http.createServer(async (req, res) => {
    try {
      if (!['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) { send(res, 405, '', BASE_HEADERS); return; }
      const host = String(req.headers.host ?? '').split(':')[0].toLowerCase();
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/api/health') {
        control.prepare('SELECT 1').get();
        send(res, 200, '{"ok":true}', { ...BASE_HEADERS, 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
        return;
      }
      // Firztnet Central apunta el cobro de una cuota (con la clave de este sistema): igual que desde el panel
      if (url.pathname === '/api/central/pago' && req.method === 'POST') { await centralPayment(req, res); return; }
      if (url.pathname.startsWith('/_aviso/') && serveFile(res, path.join(PUBLIC, '_aviso'), url.pathname.slice('/_aviso/'.length), NOTICE_CSP)) return;
      if (host === `admin.${domain}`) { await adminHost(req, res, url); return; }
      if (host.endsWith(`.${domain}`)) {
        const slug = host.slice(0, -(domain.length + 1));
        if (!slug.includes('.')) { await tenantHost(req, res, url, slug); return; }
      }
      notice(res, 200, 'Plataforma de reciclaje', 'Recogida de chatarra a domicilio, vaciados y compra de metales. Si ya eres cliente, entra en la dirección de tu web.');
    } catch (err) {
      console.error(err);
      if (!res.headersSent) notice(res, 500, 'Error', 'Algo ha fallado. Inténtalo de nuevo en un momento.');
      else res.end();
    }
  });
}
