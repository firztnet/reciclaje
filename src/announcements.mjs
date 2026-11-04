// Comunicados del superadministrador a todos sus clientes: mantenimientos con día y hora, avisos y novedades.
// Se ven en el panel de cada titular y, si se marca, también como franja en las webs públicas.
import { badRequest, notFound } from './security.mjs';
import * as v from './validate.mjs';

export const ANNOUNCEMENT_KINDS = ['mantenimiento', 'aviso', 'novedad'];

const instant = (value, name) => {
  const ms = Date.parse(String(value ?? ''));
  if (!Number.isFinite(ms)) throw badRequest(`${name} no es válida`);
  return new Date(ms).toISOString();
};

export function createAnnouncement(control, adminId, body, now = new Date()) {
  const kind = v.oneOf(body.kind, ANNOUNCEMENT_KINDS, 'El tipo');
  const title = v.text(body.title, { max: 120, required: true, name: 'El título' });
  const text = v.longText(body.body, { max: 1000, name: 'El mensaje' });
  const starts = kind === 'mantenimiento' ? instant(body.starts_at, 'La hora de inicio') : null;
  const ends = instant(body.ends_at, kind === 'mantenimiento' ? 'La hora de fin' : 'La fecha hasta la que se ve');
  if (starts && ends <= starts) throw badRequest('El fin tiene que ser después del inicio');
  if (ends <= now.toISOString()) throw badRequest('Esa fecha ya ha pasado');
  const id = Number(control.prepare(`INSERT INTO announcements (kind, title, body, starts_at, ends_at, show_on_web, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(kind, title, text, starts, ends, v.bool(body.show_on_web) ? 1 : 0, adminId).lastInsertRowid);
  return control.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
}

export function cancelAnnouncement(control, id) {
  const a = control.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
  if (!a) throw notFound('Ese comunicado no existe');
  control.prepare('UPDATE announcements SET cancelled_at = ? WHERE id = ? AND cancelled_at IS NULL').run(new Date().toISOString(), id);
  return a;
}

// Los que siguen vigentes (no retirados y sin pasar la fecha de fin)
export function activeAnnouncements(control, { webOnly = false } = {}, now = new Date()) {
  return control.prepare(`SELECT id, kind, title, body, starts_at, ends_at, show_on_web FROM announcements
    WHERE cancelled_at IS NULL AND ends_at > ? ${webOnly ? 'AND show_on_web = 1' : ''} ORDER BY COALESCE(starts_at, created_at)`).all(now.toISOString());
}

// «martes 10 de noviembre, de 2:00 a 4:00» en hora de Madrid
const day = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' });
const hour = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: 'numeric', minute: '2-digit' });
export function whenText(a) {
  const end = new Date(a.ends_at);
  if (!a.starts_at) return `hasta el ${day.format(end)}`;
  const start = new Date(a.starts_at);
  return day.format(start) === day.format(end)
    ? `el ${day.format(start)}, de ${hour.format(start)} a ${hour.format(end)}`
    : `desde el ${day.format(start)} a las ${hour.format(start)} hasta el ${day.format(end)} a las ${hour.format(end)}`;
}
