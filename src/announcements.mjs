// Comunicados del superadministrador a sus clientes (mantenimientos con día y hora, avisos y novedades).
// Se mandan por WhatsApp, cliente a cliente, con el mensaje ya escrito; aquí se guarda a quién se ha enviado.
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
  const ends = instant(body.ends_at, kind === 'mantenimiento' ? 'La hora de fin' : 'La fecha hasta la que vale');
  if (starts && ends <= starts) throw badRequest('El fin tiene que ser después del inicio');
  if (ends <= now.toISOString()) throw badRequest('Esa fecha ya ha pasado');
  const id = Number(control.prepare('INSERT INTO announcements (kind, title, body, starts_at, ends_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(kind, title, text, starts, ends, adminId).lastInsertRowid);
  return control.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
}

export function cancelAnnouncement(control, id) {
  const a = control.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
  if (!a) throw notFound('Ese comunicado no existe');
  control.prepare('UPDATE announcements SET cancelled_at = ? WHERE id = ? AND cancelled_at IS NULL').run(new Date().toISOString(), id);
  return a;
}

export function markSent(control, announcementId, tenantId) {
  if (!control.prepare('SELECT 1 FROM announcements WHERE id = ?').get(announcementId)) throw notFound('Ese comunicado no existe');
  if (!control.prepare('SELECT 1 FROM tenants WHERE id = ?').get(tenantId)) throw notFound('Ese cliente no existe');
  control.prepare('INSERT OR IGNORE INTO announcement_sends (announcement_id, tenant_id) VALUES (?, ?)').run(announcementId, tenantId);
}

// «martes, 10 de noviembre, de 2:00 a 4:00» en hora de Madrid
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

// Mensaje de WhatsApp para un cliente, con su nombre. Los avisos y novedades no llevan fecha: solo sirve para dejar de mostrarlos.
export function whatsappMessage(a, contactName) {
  const first = String(contactName ?? '').trim().split(/\s+/)[0];
  const when = whenText(a);
  return [
    first ? `Hola ${first}:` : 'Hola:',
    '',
    `*${a.title}*`,
    a.kind === 'mantenimiento' ? `${when.charAt(0).toUpperCase()}${when.slice(1)}.` : null,
    a.body ? `\n${a.body}` : null,
    '',
    'Un saludo,',
    'Firztnet',
  ].filter((line) => line !== null).join('\n');
}
