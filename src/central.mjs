// Firztnet Central (el sistema de reparaciones): la plataforma de reciclaje le manda
//  · las peticiones de «Pedir ayuda» de cada titular (fase 1),
//  · la lista de clientes con su estado, cuota, contacto y uso, cada 10 minutos (fase 3),
//  · las visitas de la web de cada cliente por día, aparato y origen (fase 4).
// Todo de servidor a servidor con la clave propia de este sistema (CENTRAL_CLAVE): el navegador nunca la ve.
// Solo datos del negocio (el cliente de Firztnet), nunca de las personas que visitan su web.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, badRequest } from './security.mjs';
import { accessOf } from './tenants.mjs';
import { todayStr } from './tenants.mjs';

const TIMEOUT_MS = 10_000;
const EVERY_MS = 10 * 60 * 1000;
export const HELP_TYPES = ['web', 'fotos', 'acceso', 'datos', 'otro'];
const BOTS = /bot|crawl|spider|slurp|preview|monitor|facebookexternalhit|whatsapp|telegram|curl|wget|python|headless|lighthouse|firztnetcentral/i;

export const centralEnabled = (config) => Boolean(config.centralUrl && config.centralKey);
const clientRef = (t, config) => `${t.slug}.${config.domain}#${t.id}`;

async function call(config, path, init = {}) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${config.centralUrl.replace(/\/+$/, '')}/api/central/entrada${path}`, {
      ...init, signal: stop.signal,
      headers: { 'Content-Type': 'application/json', 'X-Firztnet-Clave': config.centralKey },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new HttpError(502, data?.error ? `Firztnet: ${data.error}` : 'Firztnet no ha podido recibirlo ahora mismo');
    return data;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(503, 'No se ha podido contactar con Firztnet. Si es urgente, llama por teléfono.');
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Fase 1: Pedir ayuda ---------- */

export async function helpRequests(config, t) {
  if (!centralEnabled(config)) return { enabled: false, requests: [] };
  try {
    const data = await call(config, `/mias?ref=${encodeURIComponent(clientRef(t, config))}`);
    return { enabled: true, requests: data?.peticiones ?? [] };
  } catch {
    return { enabled: true, requests: [], offline: true };
  }
}

export async function sendHelp(config, t, owner, body, userAgent) {
  if (!centralEnabled(config)) throw badRequest('La ayuda a distancia no está activada en este sistema');
  const type = HELP_TYPES.includes(body.type) ? body.type : null;
  if (!type) throw badRequest('Elige qué te pasa');
  const message = String(body.message ?? '').trim().slice(0, 1000);
  if (!message) throw badRequest('Cuéntanos qué pasa');
  return call(config, '/ayuda', {
    method: 'POST',
    body: JSON.stringify({
      cliente_ref: clientRef(t, config),
      negocio: t.name,
      empresa: t.company_name || '',
      direccion_web: `${t.slug}.${config.domain}`,
      persona: owner.name,
      rol: 'titular',
      puesto: 'Panel del titular',
      telefono: String(body.phone ?? '').trim().slice(0, 30) || t.contact_phone || '',
      tipo: type === 'acceso' ? 'acceso' : 'otro',
      mensaje: `[${{ web: 'Mi web', fotos: 'Fotos', acceso: 'No puedo entrar', datos: 'Cambiar datos', otro: 'Otra cosa' }[type]}] ${message}`,
      urgente: body.urgent === true,
      pagina: 'panel',
      navegador: String(userAgent ?? '').slice(0, 200),
    }),
  });
}

/* ---------- Fase 4: visitas de la web por día, aparato y origen ---------- */

function sourceOf(req, host) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.searchParams.has('qr')) return 'qr';
  const referer = String(req.headers.referer ?? '');
  if (!referer) return 'directo';
  let from = '';
  try { from = new URL(referer).hostname.toLowerCase(); } catch { return 'otros'; }
  if (from === host) return 'directo';
  if (/(^|\.)google\./.test(from) || /(^|\.)goo\.gl$/.test(from)) return 'google';
  if (/(^|\.)instagram\.com$/.test(from)) return 'instagram';
  if (/(^|\.)(facebook\.com|fb\.com)$/.test(from)) return 'facebook';
  if (/(^|\.)tiktok\.com$/.test(from)) return 'tiktok';
  if (/(^|\.)(bing\.com|duckduckgo\.com|yahoo\.com|ecosia\.org)$/.test(from)) return 'buscadores';
  if (/(^|\.)(wa\.me|whatsapp\.com)$/.test(from)) return 'whatsapp';
  return 'otros';
}

export function countDailyVisit(control, t, req) {
  try {
    const ua = String(req.headers['user-agent'] ?? '');
    if (!ua || BOTS.test(ua)) return;
    const host = String(req.headers.host ?? '').split(':')[0].toLowerCase();
    const device = /mobi|android|iphone|ipad/i.test(ua) ? 'movil' : 'ordenador';
    control.prepare(`INSERT INTO web_visits_daily (tenant_id, date, device, source, n) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT (tenant_id, date, device, source) DO UPDATE SET n = n + 1`).run(t.id, todayStr(), device, sourceOf(req, host));
  } catch { /* contar visitas nunca debe impedir ver la web */ }
}

/* ---------- Fase 3: la lista de clientes ---------- */

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function tenantSnapshot(control, config, t) {
  const access = accessOf(t);
  const owner = control.prepare('SELECT name, email, must_change, last_login_at FROM owners WHERE tenant_id = ?').get(t.id);
  const month = todayStr().slice(0, 7);
  // Visitas de este mes sin contar robots (el mismo contador que el informe)
  const visitsMonth = control.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM web_visits_daily WHERE tenant_id = ? AND date >= ?').get(t.id, `${month}-01`).n;
  const lastPayment = control.prepare('SELECT amount_cents, paid_on FROM payments WHERE tenant_id = ? ORDER BY paid_on DESC, id DESC LIMIT 1').get(t.id);
  const visitas = control.prepare(`SELECT date, device, source, n AS visits FROM web_visits_daily WHERE tenant_id = ? AND date >= ? ORDER BY date`)
    .all(t.id, addDays(todayStr(), -95)).map((r) => ({ ...r }));
  return {
    slug: t.slug,
    nombre: t.name,
    tipo: 'reciclaje',
    estado: access.state,
    dias: access.days_left,
    prueba_hasta: t.trial_ends,
    renueva: t.renews_on,
    renovacion_vencida: access.renewal_due,
    motivo_suspension: t.suspended_reason,
    contacto_nombre: t.contact_name || owner?.name || '',
    contacto_email: t.contact_email || owner?.email || '',
    contacto_telefono: t.contact_phone,
    direccion_web: `${t.slug}.${config.domain}`,
    alta: t.created_at,
    ultimo_uso: owner?.last_login_at ?? t.last_seen_at,
    uso: {
      visitas_mes: visitsMonth,
      cuota_cents: t.fee_cents ?? 0,
      periodo: t.billing_period ?? 'mensual',
      ultimo_pago: lastPayment ? { importe_cents: lastPayment.amount_cents, fecha: lastPayment.paid_on } : null,
      titular_sin_estrenar: owner ? Boolean(owner.must_change) : null,
    },
    negocios: [{ nombre: t.name, tipo: 'reciclaje' }],
    aparatos: [],
    visitas,
    reservas_web: [],
  };
}

// Última copia de seguridad de la plataforma (todos los clientes están en la misma base)
export function lastBackup(config) {
  try {
    const dir = path.join(config.dataDir, 'backups-plataforma');
    const times = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).map((f) => fs.statSync(path.join(dir, f)).mtimeMs);
    return times.length ? new Date(Math.max(...times)).toISOString() : null;
  } catch { return null; }
}

export async function sendTenants(control, config) {
  if (!centralEnabled(config)) return false;
  const tenants = control.prepare('SELECT * FROM tenants ORDER BY id').all();
  const copia = lastBackup(config);
  try {
    await call(config, '/locales', { method: 'POST', body: JSON.stringify({ locales: tenants.map((t) => ({ ...tenantSnapshot(control, config, t), ultima_copia: copia })), copia_sistema: { ultima: copia, detalle: 'Copia diaria de la base de la plataforma' } }) });
    return true;
  } catch (err) {
    console.error('No se pudo mandar la lista de clientes a Firztnet Central:', err.message);
    return false;
  }
}

export function startCentralSync(control, config) {
  if (!centralEnabled(config)) return () => {};
  const run = () => { void sendTenants(control, config); };
  const first = setTimeout(run, 20_000);
  const every = setInterval(run, EVERY_MS);
  first.unref?.();
  every.unref?.();
  return () => { clearTimeout(first); clearInterval(every); };
}
