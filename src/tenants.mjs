// Clientes de la plataforma: alta, estado (prueba, activo, suspendido) y el contenido de su web.
import fs from 'node:fs';
import path from 'node:path';
import { conflict, notFound, badRequest } from './security.mjs';
import { transaction } from './db.mjs';
import * as v from './validate.mjs';

// Subdominios que no puede usar un cliente
const RESERVED = new Set(['admin', 'www', 'api', 'app', 'mail', 'smtp', 'ftp', 'panel', 'ayuda', 'static', 'demo', 'test', 'soporte']);
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

// Fotos que puede usar un trabajo realizado (las de la carpeta compartida de la web)
export const SHARED_PHOTOS = ['img/cobre.jpg', 'img/aluminio.jpg', 'img/radiadores.jpg', 'img/electrodomesticos.jpg', 'img/perfiles.jpg', 'img/hero.jpg'];

export const todayStr = (d = new Date()) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  return `${p.find((x) => x.type === 'year').value}-${p.find((x) => x.type === 'month').value}-${p.find((x) => x.type === 'day').value}`;
};
export const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function findTenant(control, slug) {
  return control.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);
}

export function getTenant(control, id) {
  const t = control.prepare('SELECT * FROM tenants WHERE id = ?').get(id);
  if (!t) throw notFound('Ese cliente no existe');
  return t;
}

export const webOf = (t) => ({ ...defaultWeb({ name: t.name }), ...JSON.parse(t.web || '{}') });

// Estado real hoy: una prueba vencida cierra la web igual que una suspensión
export function accessOf(t, today = todayStr()) {
  const days = (date) => (date ? Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null);
  const renewal = days(t.renews_on);
  const renewalDue = renewal !== null && renewal < 0;
  if (t.status === 'suspendido') return { open: false, state: 'suspendido', days_left: null, renewal_due: renewalDue };
  if (t.status === 'prueba') {
    const left = days(t.trial_ends);
    if (left !== null && left < 0) return { open: false, state: 'prueba_vencida', days_left: left, renewal_due: false };
    return { open: true, state: 'prueba', days_left: left, renewal_due: false };
  }
  return { open: true, state: 'activo', days_left: renewal, renewal_due: renewalDue };
}

export function defaultWeb({ name = '', barrio = '', telefono = '', telefono2 = '' } = {}) {
  return {
    marca: name, lema: '', ciudad: 'Madrid', barrio, region: 'Comunidad de Madrid',
    telefono, telefono2, whatsapp: telefono,
    abierto24h: false, horario: 'Lunes a sábado', compra: true, vaciados: false, portes: false, fuera_region: false,
    personas: '', quienes: '', zonas_texto: '', zonas: [],
    google: null, opiniones: [], trabajos: [], cita: null,
    portada: '', galeria: [],
  };
}

// «Título: zona, zona» por línea → [{ titulo, lista }]
export function parseZones(value) {
  if (Array.isArray(value)) return value;
  const groups = [];
  for (const line of String(value ?? '').split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    const titulo = i > 0 ? line.slice(0, i) : 'Zonas';
    const lista = (i > 0 ? line.slice(i + 1) : line).split(',').map((z) => z.trim()).filter(Boolean);
    groups.push({ titulo, lista });
  }
  return groups;
}

// «ownRefs»: las fotos propias del cliente (fotos/<archivo>), que se pueden usar además de las compartidas
export function readWeb(body, current, ownRefs = []) {
  const b = body ?? {};
  const allowed = [...SHARED_PHOTOS, ...ownRefs];
  const photo = (value, name) => v.oneOf(value, allowed, name);
  const galeria = (b.galeria === undefined ? current.galeria : b.galeria) ?? [];
  if (!Array.isArray(galeria) || galeria.length > 6) throw badRequest('Como mucho 6 fotos en la galería');
  const portada = b.portada === undefined ? current.portada : b.portada;
  const pick = (key) => (b[key] === undefined ? current[key] : b[key]);
  const telefono = v.phone(pick('telefono'), { required: true, name: 'El teléfono principal' });
  const zonas = parseZones(pick('zonas'));
  if (zonas.length > 6) throw badRequest('Como mucho 6 grupos de zonas');
  const google = pick('google');
  const opiniones = pick('opiniones') ?? [];
  const trabajos = pick('trabajos') ?? [];
  const cita = pick('cita');
  if (!Array.isArray(opiniones) || opiniones.length > 40) throw badRequest('Como mucho 40 opiniones');
  if (!Array.isArray(trabajos) || trabajos.length > 20) throw badRequest('Como mucho 20 trabajos');
  return {
    marca: v.text(pick('marca'), { max: 40, required: true, name: 'El nombre corto' }),
    lema: v.text(pick('lema'), { max: 60, name: 'La segunda línea' }),
    ciudad: v.text(pick('ciudad'), { max: 40, required: true, name: 'La ciudad' }),
    barrio: v.text(pick('barrio'), { max: 40, required: true, name: 'El barrio o municipio' }),
    region: v.text(pick('region'), { max: 60, required: true, name: 'La región' }),
    telefono,
    telefono2: v.phone(pick('telefono2'), { name: 'El segundo teléfono' }),
    whatsapp: v.phone(pick('whatsapp'), { name: 'El WhatsApp' }) || telefono,
    abierto24h: v.bool(pick('abierto24h')),
    horario: v.text(pick('horario'), { max: 80, name: 'El horario' }),
    compra: v.bool(pick('compra')),
    vaciados: v.bool(pick('vaciados')),
    portes: v.bool(pick('portes')),
    fuera_region: v.bool(pick('fuera_region')),
    personas: v.text(pick('personas'), { max: 60, name: 'Quiénes sois' }),
    quienes: v.longText(pick('quienes'), { max: 600, name: 'El texto de «Quiénes somos»' }),
    zonas_texto: v.longText(pick('zonas_texto'), { max: 300, name: 'El texto de zonas' }),
    zonas: zonas.map((g) => ({
      titulo: v.text(g.titulo, { max: 50, required: true, name: 'El título del grupo de zonas' }),
      lista: (g.lista ?? []).slice(0, 30).map((z) => v.text(z, { max: 40, required: true, name: 'La zona' })),
    })),
    google: google && (google.url || google.nota) ? {
      url: v.url(google.url, { name: 'El enlace de Google' }),
      nota: (() => {
        const n = v.text(google.nota, { max: 3, name: 'La nota de Google' }).replace('.', ',');
        if (!/^[1-5](,\d)?$/.test(n)) throw badRequest('La nota de Google debe ser como 4,9');
        return n;
      })(),
      total: v.integer(google.total ?? 0, { min: 0, max: 100000, name: 'El número de reseñas' }),
    } : null,
    opiniones: opiniones.map((o) => ({
      nombre: v.text(o.nombre, { max: 60, required: true, name: 'El nombre de la opinión' }),
      texto: v.longText(o.texto, { max: 1200, name: 'El texto de la opinión' }) || (() => { throw badRequest('Cada opinión necesita su texto'); })(),
      estrellas: v.integer(o.estrellas ?? 5, { min: 1, max: 5, name: 'Las estrellas' }),
    })),
    portada: portada ? photo(portada, 'La foto de portada') : '',
    galeria: galeria.map((g) => ({
      foto: photo(g.foto, 'La foto de la galería'),
      texto: v.text(g.texto, { max: 40, name: 'El pie de foto' }),
    })),
    trabajos: trabajos.map((t) => ({
      foto: photo(t.foto, 'La foto del trabajo'),
      titulo: v.text(t.titulo, { max: 80, required: true, name: 'El título del trabajo' }),
      zona: v.text(t.zona, { max: 40, name: 'La zona del trabajo' }),
      texto: v.text(t.texto, { max: 200, name: 'La descripción del trabajo' }),
    })),
    cita: cita && cita.texto ? {
      texto: v.text(cita.texto, { max: 200, name: 'La frase destacada' }),
      autor: v.text(cita.autor, { max: 60, name: 'El autor de la frase' }),
    } : null,
  };
}

export function readNewTenant(body) {
  const b = body ?? {};
  const slug = v.text(b.slug, { max: 40, required: true, name: 'El subdominio' }).toLowerCase();
  if (!SLUG.test(slug)) throw badRequest('El subdominio solo puede tener letras minúsculas, números y guiones (sin espacios ni tildes)');
  if (RESERVED.has(slug)) throw badRequest(`«${slug}» está reservado; elige otro subdominio`);
  return {
    slug,
    name: v.text(b.name, { max: 80, required: true, name: 'El nombre del negocio' }),
    barrio: v.text(b.barrio, { max: 40, required: true, name: 'El barrio o municipio' }),
    telefono: v.phone(b.telefono, { required: true, name: 'El teléfono principal' }),
    telefono2: v.phone(b.telefono2, { name: 'El segundo teléfono' }),
    contact_name: v.text(b.contact_name, { max: 80, required: true, name: 'El nombre del titular' }),
    contact_email: v.email(b.contact_email),
    trial_days: v.integer(b.trial_days ?? 30, { min: 0, max: 365, name: 'Los días de prueba' }),
    company_name: v.text(b.company_name, { max: 120, name: 'La razón social' }),
    tax_id: v.text(b.tax_id, { max: 20, name: 'El NIF' }).toUpperCase(),
    notes: v.longText(b.notes, { max: 1000, name: 'Las notas' }),
  };
}

export function createTenant(control, input, web = defaultWeb(input)) {
  if (findTenant(control, input.slug)) throw conflict(`El subdominio «${input.slug}» ya está en uso`);
  const status = input.trial_days ? 'prueba' : 'activo';
  const id = Number(control.prepare(`INSERT INTO tenants (slug, name, status, trial_ends, contact_name, contact_email, contact_phone,
      company_name, tax_id, notes, web) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(input.slug, input.name, status, input.trial_days ? addDays(todayStr(), input.trial_days) : null, input.contact_name,
      input.contact_email, input.telefono, input.company_name, input.tax_id, input.notes, JSON.stringify(web)).lastInsertRowid);
  return getTenant(control, id);
}

// Se guarda la ficha entera aparte antes de borrarla (y sus fotos se mueven a «eliminados»), para poder recuperarla
export function deleteTenant(control, t, dataDir) {
  const photos = control.prepare('SELECT file, bytes, created_at FROM photos WHERE tenant_id = ?').all(t.id);
  const owner = control.prepare('SELECT name, email FROM owners WHERE tenant_id = ?').get(t.id) ?? null;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  const from = path.join(dataDir, 'clientes', t.slug);
  const kept = path.join(dataDir, 'eliminados', `${t.slug}-${stamp}`);
  transaction(control, () => {
    control.prepare('INSERT INTO deleted_tenants (slug, name, data) VALUES (?, ?, ?)')
      .run(t.slug, t.name, JSON.stringify({ ...t, photos, owner, files: fs.existsSync(from) ? path.relative(dataDir, kept) : null }));
    control.prepare('DELETE FROM tenants WHERE id = ?').run(t.id);
  });
  if (fs.existsSync(from)) {
    fs.mkdirSync(path.dirname(kept), { recursive: true });
    fs.renameSync(from, kept);
  }
}

export function countVisit(control, t) {
  const month = todayStr().slice(0, 7);
  control.prepare(`INSERT INTO web_visits (tenant_id, month, n) VALUES (?, ?, 1)
    ON CONFLICT (tenant_id, month) DO UPDATE SET n = n + 1`).run(t.id, month);
}

export function usageOf(control, t) {
  const month = todayStr().slice(0, 7);
  const web = webOf(t);
  return {
    visits_month: control.prepare('SELECT n FROM web_visits WHERE tenant_id = ? AND month = ?').get(t.id, month)?.n ?? 0,
    reviews: web.opiniones.length,
    google: web.google ? `${web.google.nota} (${web.google.total})` : null,
  };
}
