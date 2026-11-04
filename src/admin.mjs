// API del superadministrador (admin.<dominio>/api/admin): entrar, ver los clientes con su uso,
// darlos de alta, editar su web, activarlos, ponerlos en prueba, suspenderlos y eliminarlos.
import {
  FailureLimiter, HttpError, MIN_PASSWORD, badRequest, conflict, cookieHeader, forbidden, hashSecret, hashToken,
  isValidPassword, randomToken, readCookie, unauthorized, verifySecret,
} from './security.mjs';
import {
  SHARED_PHOTOS, accessOf, createTenant, defaultWeb, deleteTenant, getTenant, readNewTenant, readWeb, todayStr, usageOf, webOf,
} from './tenants.mjs';
import * as v from './validate.mjs';
import { grantOwner, ownerSummary } from './owners.mjs';
import { cancelAnnouncement, createAnnouncement, markSent, whatsappMessage, whenText } from './announcements.mjs';
import { deletePhoto, listPhotos, photoRefs, savePhoto } from './photos.mjs';

export const ADMIN_COOKIE = 'chsid';
const FICHA_FORMAT = 'reciclaje-cliente';
const SESSION_MS = 12 * 60 * 60 * 1000;
const loginLimiter = new FailureLimiter({ maxFails: 8, windowMs: 15 * 60 * 1000 });

// Crea (o actualiza la clave de) un superadministrador. Lo usan la puesta en marcha y la demo.
export function upsertSuperadmin(control, { name, email, password }) {
  if (!isValidPassword(password)) throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
  const mail = v.email(email, { required: true });
  const existing = control.prepare('SELECT id FROM superadmins WHERE email = ?').get(mail);
  if (existing) {
    control.prepare('UPDATE superadmins SET name = ?, password_hash = ?, active = 1 WHERE id = ?').run(name, hashSecret(password), existing.id);
    return existing.id;
  }
  return Number(control.prepare('INSERT INTO superadmins (name, email, password_hash) VALUES (?, ?, ?)').run(name, mail, hashSecret(password)).lastInsertRowid);
}

export function createAdminApi(control, config) {
  const log = (adminId, tenantId, summary) =>
    control.prepare('INSERT INTO admin_activity (admin_id, tenant_id, summary) VALUES (?, ?, ?)').run(adminId, tenantId, summary.slice(0, 300));
  const present = (t) => ({ ...t, web: webOf(t), access: accessOf(t), usage: usageOf(control, t), owner: ownerSummary(control, t), photos: listPhotos(control, t) });
  const idOf = (raw) => v.integer(raw, { min: 1, max: Number.MAX_SAFE_INTEGER, name: 'El cliente' });

  const sessionAdmin = (req) => {
    const token = readCookie(req, ADMIN_COOKIE);
    if (!token) return null;
    return control.prepare(`SELECT a.* FROM admin_sessions s JOIN superadmins a ON a.id = s.admin_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND a.active = 1`).get(hashToken(token), new Date().toISOString()) ?? null;
  };

  // Cada ruta: [método, patrón, manejador(req, ctx) → { status?, body, headers? }]
  const routes = [
    ['POST', '/login', (req, { body, ip }) => {
      const wait = loginLimiter.blockedMinutes(ip);
      if (wait) throw new HttpError(429, `Demasiados intentos. Espera ${wait} min.`);
      const email = String(body.email ?? '').trim().toLowerCase();
      const admin = control.prepare('SELECT * FROM superadmins WHERE email = ? AND active = 1').get(email);
      if (!admin || !verifySecret(String(body.password ?? ''), admin.password_hash)) {
        loginLimiter.fail(ip);
        log(null, null, `Acceso fallido con «${email.slice(0, 60)}»`);
        throw unauthorized('Correo o contraseña incorrectos');
      }
      loginLimiter.succeed(ip);
      const token = randomToken();
      control.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(new Date().toISOString());
      control.prepare('INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)')
        .run(hashToken(token), admin.id, new Date(Date.now() + SESSION_MS).toISOString());
      log(admin.id, null, 'Entró en el panel de superadministrador');
      return { body: { name: admin.name }, headers: { 'Set-Cookie': cookieHeader(ADMIN_COOKIE, token, { maxAgeSeconds: SESSION_MS / 1000, secure: config.production }) } };
    }, { public: true }],

    ['POST', '/logout', (req) => {
      const token = readCookie(req, ADMIN_COOKIE);
      if (token) control.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hashToken(token));
      return { body: { ok: true }, headers: { 'Set-Cookie': cookieHeader(ADMIN_COOKIE, '', { maxAgeSeconds: 0, secure: config.production }) } };
    }, { public: true }],

    ['GET', '/me', (req, { admin }) => ({ body: { name: admin.name, email: admin.email, domain: config.domain, today: todayStr(), photos: SHARED_PHOTOS } })],

    ['GET', '/tenants', () => ({ body: control.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all().map(present) })],

    ['POST', '/tenants', (req, { body, admin }) => {
      const input = readNewTenant(body);
      const t = createTenant(control, input, defaultWeb(input));
      log(admin.id, t.id, `Dio de alta a «${t.name}» (${t.slug}) ${t.status === 'prueba' ? `en prueba hasta ${t.trial_ends}` : 'activo'}`);
      // Con correo, el titular recibe ya su acceso al panel (la clave temporal se muestra una sola vez)
      const owner_access = input.contact_email ? grantOwner(control, t, { name: input.contact_name, email: input.contact_email }) : null;
      return { status: 201, body: { ...present(t), owner_access } };
    }],

    // Ficha completa de un cliente en un archivo, para llevarla a otra instalación (por ejemplo, de la demo al servidor)
    ['GET', '/tenants/:id/ficha', (req, { admin, params }) => {
      const t = getTenant(control, idOf(params.id));
      log(admin.id, t.id, `Exportó la ficha de «${t.name}»`);
      return {
        body: {
          formato: FICHA_FORMAT, version: 1, exportada: new Date().toISOString(),
          slug: t.slug, name: t.name, contact_name: t.contact_name, contact_email: t.contact_email, contact_phone: t.contact_phone,
          company_name: t.company_name, tax_id: t.tax_id, notes: t.notes, web: webOf(t),
        },
        headers: { 'Content-Disposition': `attachment; filename="ficha-${t.slug}.json"` },
      };
    }],

    // Alta a partir de una ficha exportada. Las fotos propias no viajan en el archivo: se quitan de la web y se suben aparte.
    ['POST', '/tenants/import', (req, { body, admin }) => {
      const f = body.ficha ?? {};
      if (f.formato !== FICHA_FORMAT) throw badRequest('Ese archivo no es una ficha de cliente de esta plataforma');
      const w = f.web ?? {};
      const own = (ref) => typeof ref === 'string' && ref.startsWith('fotos/');
      const input = readNewTenant({
        slug: body.slug || f.slug, name: f.name, barrio: w.barrio, telefono: w.telefono, telefono2: w.telefono2,
        contact_name: f.contact_name || f.name, contact_email: body.contact_email ?? f.contact_email, trial_days: body.trial_days ?? 0,
        company_name: f.company_name, tax_id: f.tax_id, notes: f.notes,
      });
      const web = readWeb({
        ...w,
        portada: own(w.portada) ? '' : w.portada,
        galeria: (w.galeria ?? []).filter((g) => !own(g.foto)),
        trabajos: (w.trabajos ?? []).filter((j) => !own(j.foto)),
      }, defaultWeb(input));
      const t = createTenant(control, input, web);
      if (f.contact_phone) control.prepare('UPDATE tenants SET contact_phone = ? WHERE id = ?').run(v.phone(f.contact_phone), t.id);
      log(admin.id, t.id, `Dio de alta a «${t.name}» (${t.slug}) desde una ficha exportada`);
      const owner_access = input.contact_email ? grantOwner(control, t, { name: input.contact_name, email: input.contact_email }) : null;
      return { status: 201, body: { ...present(getTenant(control, t.id)), owner_access } };
    }],

    // Estado, fechas y datos de contacto o fiscales
    ['PATCH', '/tenants/:id', (req, { body, admin, params }) => {
      const t = getTenant(control, idOf(params.id));
      const status = body.status === undefined ? t.status : v.oneOf(body.status, ['prueba', 'activo', 'suspendido'], 'El estado');
      const optDate = (value, current, name) => (value === undefined ? current : value === null || value === '' ? null : v.date(value, name));
      const keep = (key, read) => (body[key] === undefined ? t[key] : read(body[key]));
      const next = {
        status,
        name: keep('name', (x) => v.text(x, { max: 80, required: true, name: 'El nombre' })),
        trial_ends: optDate(body.trial_ends, t.trial_ends, 'El fin de la prueba'),
        renews_on: optDate(body.renews_on, t.renews_on, 'La renovación'),
        suspended_reason: status === 'suspendido' ? v.text(body.suspended_reason ?? t.suspended_reason, { max: 200, name: 'El motivo' }) : '',
        contact_name: keep('contact_name', (x) => v.text(x, { max: 80, name: 'El titular' })),
        contact_email: keep('contact_email', (x) => v.email(x)),
        contact_phone: keep('contact_phone', (x) => v.phone(x, { name: 'El teléfono de contacto' })),
        company_name: keep('company_name', (x) => v.text(x, { max: 120, name: 'La razón social' })),
        tax_id: keep('tax_id', (x) => v.text(x, { max: 20, name: 'El NIF' }).toUpperCase()),
        notes: keep('notes', (x) => v.longText(x, { max: 1000, name: 'Las notas' })),
      };
      if (next.status === 'prueba' && !next.trial_ends) throw badRequest('Indica hasta qué día dura la prueba');
      control.prepare(`UPDATE tenants SET status = ?, name = ?, trial_ends = ?, renews_on = ?, suspended_reason = ?, contact_name = ?,
        contact_email = ?, contact_phone = ?, company_name = ?, tax_id = ?, notes = ? WHERE id = ?`).run(next.status, next.name, next.trial_ends,
        next.renews_on, next.suspended_reason, next.contact_name, next.contact_email, next.contact_phone, next.company_name, next.tax_id, next.notes, t.id);
      const what = { prueba: `en prueba hasta ${next.trial_ends}`, activo: `activo${next.renews_on ? ` (renueva el ${next.renews_on})` : ''}`, suspendido: `suspendido${next.suspended_reason ? `: ${next.suspended_reason}` : ''}` }[next.status];
      log(admin.id, t.id, t.status !== next.status ? `Puso a «${next.name}» ${what}` : `Modificó los datos de «${next.name}»`);
      return { body: present(getTenant(control, t.id)) };
    }],

    // Contenido de su web: teléfonos, servicios, zonas, opiniones, trabajos…
    ['PUT', '/tenants/:id/web', (req, { body, admin, params }) => {
      const t = getTenant(control, idOf(params.id));
      const web = readWeb(body, webOf(t), photoRefs(control, t));
      control.prepare('UPDATE tenants SET web = ? WHERE id = ?').run(JSON.stringify(web), t.id);
      log(admin.id, t.id, `Actualizó la web de «${t.name}»`);
      return { body: present(getTenant(control, t.id)) };
    }],

    // Solo si está suspendido y escribiendo su subdominio. La ficha se guarda aparte por si hubiera que recuperarla.
    ['DELETE', '/tenants/:id', (req, { body, admin, params }) => {
      const t = getTenant(control, idOf(params.id));
      if (t.status !== 'suspendido') throw conflict('Para eliminar un cliente, primero hay que suspenderlo');
      if (String(body.confirm ?? '').trim().toLowerCase() !== t.slug) throw badRequest(`Para confirmar, escribe exactamente su subdominio: «${t.slug}»`);
      deleteTenant(control, t, config.dataDir);
      log(admin.id, null, `Eliminó al cliente «${t.name}» (${t.slug}). Su ficha queda guardada aparte`);
      return { body: { ok: true } };
    }],

    // Acceso del titular a su panel: lo crea o le da una clave temporal nueva
    ['POST', '/tenants/:id/owner', (req, { body, admin, params }) => {
      const t = getTenant(control, idOf(params.id));
      const access = grantOwner(control, t, { name: body.name || t.contact_name, email: body.email || t.contact_email });
      // El correo de contacto queda igual que el del acceso, para que la ficha no muestre uno distinto
      control.prepare('UPDATE tenants SET contact_email = ? WHERE id = ?').run(access.email, t.id);
      log(admin.id, t.id, `Dio una clave temporal del panel al titular de «${t.name}»`);
      return { body: access };
    }],

    /* Fotos propias del cliente */
    ['GET', '/tenants/:id/photos', (req, { params }) => ({ body: listPhotos(control, getTenant(control, idOf(params.id))) })],
    ['POST', '/tenants/:id/photos', (req, { body, admin, params }) => {
      const t = getTenant(control, idOf(params.id));
      const p = savePhoto(control, config.dataDir, t, body, `Superadministrador (${admin.name})`);
      log(admin.id, t.id, `Subió una foto a «${t.name}»`);
      return { status: 201, body: p };
    }, { raw: true }],
    ['DELETE', '/tenants/:id/photos/:pid', (req, { admin, params }) => {
      const t = getTenant(control, idOf(params.id));
      deletePhoto(control, config.dataDir, t, v.integer(params.pid, { min: 1, max: Number.MAX_SAFE_INTEGER, name: 'La foto' }));
      log(admin.id, t.id, `Borró una foto de «${t.name}»`);
      return { body: { ok: true } };
    }],

    /* Comunicados a los clientes, por WhatsApp: cada uno con su lista de clientes, su mensaje y a quién se ha enviado */
    ['GET', '/announcements', () => {
      const tenants = control.prepare('SELECT * FROM tenants ORDER BY name COLLATE NOCASE').all();
      const sends = control.prepare('SELECT tenant_id, sent_at FROM announcement_sends WHERE announcement_id = ?');
      return {
        body: control.prepare(`SELECT a.*, s.name AS admin_name FROM announcements a LEFT JOIN superadmins s ON s.id = a.created_by
          ORDER BY a.id DESC LIMIT 100`).all().map((a) => {
          const sent = new Map(sends.all(a.id).map((x) => [x.tenant_id, x.sent_at]));
          return {
            ...a,
            when: whenText(a),
            recipients: tenants.map((t) => {
              const phone = t.contact_phone || webOf(t).telefono;
              const message = whatsappMessage(a, t.contact_name);
              return {
                tenant_id: t.id, name: t.name, contact_name: t.contact_name, phone, state: accessOf(t).state,
                sent_at: sent.get(t.id) ?? null, message,
                whatsapp_url: phone ? `https://wa.me/34${phone}?text=${encodeURIComponent(message)}` : null,
              };
            }),
          };
        }),
      };
    }],
    ['POST', '/announcements', (req, { body, admin }) => {
      const a = createAnnouncement(control, admin.id, body);
      log(admin.id, null, `Preparó el comunicado «${a.title}»`);
      return { status: 201, body: { ...a, when: whenText(a) } };
    }],
    // Al pulsar «Enviar» de un cliente se apunta como enviado (el envío lo hace WhatsApp)
    ['POST', '/announcements/:id/sent', (req, { body, admin, params }) => {
      const id = v.integer(params.id, { min: 1, max: Number.MAX_SAFE_INTEGER, name: 'El comunicado' });
      const t = getTenant(control, idOf(body.tenant_id));
      markSent(control, id, t.id);
      log(admin.id, t.id, `Mandó por WhatsApp un comunicado a «${t.name}»`);
      return { body: { ok: true } };
    }],
    ['POST', '/announcements/:id/cancel', (req, { admin, params }) => {
      const a = cancelAnnouncement(control, v.integer(params.id, { min: 1, max: Number.MAX_SAFE_INTEGER, name: 'El comunicado' }));
      log(admin.id, null, `Retiró el comunicado «${a.title}»`);
      return { body: { ok: true } };
    }],

    ['GET', '/activity', () => ({
      body: control.prepare(`SELECT a.at, a.summary, COALESCE(s.name, CASE WHEN a.tenant_id IS NOT NULL THEN 'Titular' END) AS admin_name FROM admin_activity a
        LEFT JOIN superadmins s ON s.id = a.admin_id ORDER BY a.id DESC LIMIT 300`).all(),
    })],

    ['POST', '/password', (req, { body, admin }) => {
      if (!verifySecret(String(body.current ?? ''), admin.password_hash)) throw forbidden('La contraseña actual no es correcta');
      const next = String(body.next ?? '');
      if (!isValidPassword(next)) throw badRequest(`La nueva contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
      control.prepare('UPDATE superadmins SET password_hash = ? WHERE id = ?').run(hashSecret(next), admin.id);
      control.prepare('DELETE FROM admin_sessions WHERE admin_id = ? AND token_hash != ?').run(admin.id, hashToken(readCookie(req, ADMIN_COOKIE)));
      log(admin.id, null, 'Cambió su contraseña');
      return { body: { ok: true } };
    }],
  ];

  const compiled = routes.map(([method, pattern, handler, opts = {}]) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    return { method, re, keys, handler, opts };
  });

  // ¿Esta ruta recibe el cuerpo tal cual (una foto) en vez de JSON?
  handle.wantsRaw = (method, subpath) => compiled.some((r) => r.opts.raw && r.method === method && r.re.test(subpath));
  return handle;

  function handle(req, subpath, body, ip) {
    for (const r of compiled) {
      const m = r.re.exec(subpath);
      if (!m || r.method !== req.method) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const admin = sessionAdmin(req);
      if (!r.opts.public && !admin) throw unauthorized();
      if (Boolean(r.opts.raw) !== Buffer.isBuffer(body)) throw new HttpError(415, r.opts.raw ? 'Se esperaba una foto JPEG' : 'Se esperaba JSON');
      return r.handler(req, { body: body ?? {}, admin, params, ip });
    }
    throw new HttpError(404, 'No encontrado');
  }
}
