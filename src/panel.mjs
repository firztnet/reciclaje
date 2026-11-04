// API del panel del titular (<subdominio>/api/panel): entra con su correo y su clave y edita su propia web y sus fotos.
// Cada sesión vale solo para su cliente: la cookie es de su subdominio y además se comprueba en cada petición.
import { FailureLimiter, HttpError, MIN_PASSWORD, badRequest, cookieHeader, forbidden, hashSecret, hashToken, isValidPassword, randomToken, readCookie, unauthorized, verifySecret } from './security.mjs';
import { accessOf, readWeb, webOf, SHARED_PHOTOS } from './tenants.mjs';
import { deletePhoto, listPhotos, photoRefs, savePhoto } from './photos.mjs';
import * as v from './validate.mjs';

export const OWNER_COOKIE = 'chpanel';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const loginLimiter = new FailureLimiter({ maxFails: 8, windowMs: 15 * 60 * 1000 });

export function createPanelApi(control, config) {
  const log = (t, summary) => control.prepare('INSERT INTO admin_activity (admin_id, tenant_id, summary) VALUES (NULL, ?, ?)').run(t.id, summary.slice(0, 300));
  const cookie = (token, maxAgeSeconds) => cookieHeader(OWNER_COOKIE, token, { maxAgeSeconds, secure: config.production });

  const sessionOwner = (req, t) => {
    const token = readCookie(req, OWNER_COOKIE);
    if (!token) return null;
    return control.prepare(`SELECT o.* FROM owner_sessions s JOIN owners o ON o.id = s.owner_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND o.tenant_id = ?`).get(hashToken(token), new Date().toISOString(), t.id) ?? null;
  };

  const me = (t, o) => ({
    name: o.name, email: o.email, must_change: Boolean(o.must_change),
    tenant: { id: t.id, name: t.name, slug: t.slug, status: t.status, trial_ends: t.trial_ends, access: accessOf(t) },
    web: webOf(t), photos: listPhotos(control, t), shared_photos: SHARED_PHOTOS,
  });

  // [método, ruta, manejador, opciones]; «free» = sin sesión; «first» = permitida antes de cambiar la clave temporal
  const routes = [
    ['POST', '/login', (req, { t, body, ip }) => {
      const key = `${t.id}:${ip}`;
      const wait = loginLimiter.blockedMinutes(key);
      if (wait) throw new HttpError(429, `Demasiados intentos. Espera ${wait} min.`);
      const o = control.prepare('SELECT * FROM owners WHERE tenant_id = ? AND email = ?').get(t.id, String(body.email ?? '').trim().toLowerCase());
      if (!o || !verifySecret(String(body.password ?? ''), o.password_hash)) {
        loginLimiter.fail(key);
        throw unauthorized('Correo o contraseña incorrectos');
      }
      loginLimiter.succeed(key);
      const token = randomToken();
      control.prepare('DELETE FROM owner_sessions WHERE expires_at < ?').run(new Date().toISOString());
      control.prepare('INSERT INTO owner_sessions (token_hash, owner_id, expires_at) VALUES (?, ?, ?)')
        .run(hashToken(token), o.id, new Date(Date.now() + SESSION_MS).toISOString());
      control.prepare('UPDATE owners SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), o.id);
      return { body: me(t, o), headers: { 'Set-Cookie': cookie(token, SESSION_MS / 1000) } };
    }, { free: true }],

    ['POST', '/logout', (req) => {
      const token = readCookie(req, OWNER_COOKIE);
      if (token) control.prepare('DELETE FROM owner_sessions WHERE token_hash = ?').run(hashToken(token));
      return { body: { ok: true }, headers: { 'Set-Cookie': cookie('', 0) } };
    }, { free: true }],

    ['GET', '/me', (req, { t, owner }) => ({ body: me(t, owner) }), { first: true }],
    ['POST', '/password', (req, { t, body, owner }) => {
      if (!verifySecret(String(body.current ?? ''), owner.password_hash)) throw forbidden('La contraseña actual no es correcta');
      const next = String(body.next ?? '');
      if (!isValidPassword(next)) throw badRequest(`La nueva contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
      if (next === String(body.current)) throw badRequest('La nueva contraseña tiene que ser distinta de la anterior');
      control.prepare('UPDATE owners SET password_hash = ?, must_change = 0 WHERE id = ?').run(hashSecret(next), owner.id);
      control.prepare('DELETE FROM owner_sessions WHERE owner_id = ? AND token_hash != ?').run(owner.id, hashToken(readCookie(req, OWNER_COOKIE)));
      log(t, `El titular de «${t.name}» cambió su contraseña del panel`);
      return { body: { ok: true } };
    }, { first: true }],

    ['PUT', '/web', (req, { t, body }) => {
      const web = readWeb(body, webOf(t), photoRefs(control, t));
      control.prepare('UPDATE tenants SET web = ? WHERE id = ?').run(JSON.stringify(web), t.id);
      log(t, `El titular de «${t.name}» actualizó su web`);
      return { body: { web } };
    }],

    ['GET', '/photos', (req, { t }) => ({ body: listPhotos(control, t) })],
    ['POST', '/photos', (req, { t, body, owner }) => {
      const p = savePhoto(control, config.dataDir, t, body, `Titular (${owner.name})`);
      log(t, `El titular de «${t.name}» subió una foto`);
      return { status: 201, body: p };
    }, { raw: true }],
    ['DELETE', '/photos/:pid', (req, { t, params }) => {
      deletePhoto(control, config.dataDir, t, v.integer(params.pid, { min: 1, max: Number.MAX_SAFE_INTEGER, name: 'La foto' }));
      log(t, `El titular de «${t.name}» borró una foto`);
      return { body: { ok: true } };
    }],
  ];

  const compiled = routes.map(([method, pattern, handler, opts = {}]) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    return { method, re, keys, handler, opts };
  });

  function handle(req, t, subpath, body, ip) {
    for (const r of compiled) {
      const m = r.re.exec(subpath);
      if (!m || r.method !== req.method) continue;
      if (Boolean(r.opts.raw) !== Buffer.isBuffer(body)) throw new HttpError(415, r.opts.raw ? 'Se esperaba una foto JPEG' : 'Se esperaba JSON');
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const owner = sessionOwner(req, t);
      if (!r.opts.free && !owner) throw unauthorized();
      if (owner && owner.must_change && !r.opts.free && !r.opts.first) throw new HttpError(403, 'Antes de seguir, cambia la clave temporal por una tuya');
      return r.handler(req, { t, body: body ?? {}, owner, params, ip });
    }
    throw new HttpError(404, 'No encontrado');
  }
  handle.wantsRaw = (method, subpath) => compiled.some((r) => r.opts.raw && r.method === method && r.re.test(subpath));
  return handle;
}
