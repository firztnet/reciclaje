// Cuota de cada cliente y sus pagos. La fecha «renews_on» del cliente es hasta cuándo está pagado:
// cada pago la adelanta un periodo (un mes, tres o un año), y si pasa sin pagar sale el aviso de cobro vencido.
import { badRequest, conflict, notFound } from './security.mjs';
import { todayStr, webOf } from './tenants.mjs';
import * as v from './validate.mjs';

export const PERIODS = { mensual: 1, trimestral: 3, anual: 12 };
export const PERIOD_LABEL = { mensual: 'al mes', trimestral: 'al trimestre', anual: 'al año' };
export const METHODS = ['bizum', 'transferencia', 'efectivo', 'tarjeta', 'otro'];

// «25», «25,5», «25.50», «25 €» → céntimos
export function euros(value, name = 'El importe') {
  const s = String(value ?? '').replace(/€/g, '').replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) throw badRequest(`${name} no es válido (por ejemplo 25 o 25,50)`);
  return Math.round(Number(s) * 100);
}

export const money = (cents) => `${(cents / 100).toLocaleString('es-ES', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;

// Suma meses respetando el fin de mes (31 de enero + 1 mes = 28 o 29 de febrero)
export function addMonths(day, months) {
  const [y, m, d] = day.split('-').map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

// Lo que aporta cada mes, para el total de ingresos
export const monthlyCents = (t) => Math.round((t.fee_cents ?? 0) / PERIODS[t.billing_period ?? 'mensual']);

export function readBilling(body, t) {
  return {
    fee_cents: body.fee === undefined ? t.fee_cents : euros(body.fee, 'La cuota'),
    billing_period: body.billing_period === undefined ? t.billing_period : v.oneOf(body.billing_period, Object.keys(PERIODS), 'La periodicidad'),
  };
}

export function listPayments(control, t) {
  return control.prepare(`SELECT p.*, s.name AS admin_name FROM payments p LEFT JOIN superadmins s ON s.id = p.created_by
    WHERE p.tenant_id = ? ORDER BY p.id DESC LIMIT 50`).all(t.id);
}

// Apunta un pago y adelanta el «pagado hasta» un periodo. Si estaba en prueba, pasa a activo.
export function recordPayment(control, t, body, adminId) {
  const amount = body.amount === undefined || body.amount === '' ? t.fee_cents : euros(body.amount);
  if (!amount) throw badRequest('Pon el importe del pago (o la cuota del cliente)');
  const paidOn = body.paid_on ? v.date(body.paid_on, 'La fecha del pago') : todayStr();
  const method = body.method ? v.oneOf(body.method, METHODS, 'La forma de pago') : '';
  const note = v.text(body.note, { max: 200, name: 'La nota' });
  // Se cuenta desde lo que ya estaba pagado; si no había fecha, desde el día del pago
  const from = t.renews_on || paidOn;
  const coversUntil = addMonths(from, PERIODS[t.billing_period]);
  const id = Number(control.prepare(`INSERT INTO payments (tenant_id, amount_cents, paid_on, method, note, covers_until, prev_renews_on, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(t.id, amount, paidOn, method, note, coversUntil, t.renews_on, adminId).lastInsertRowid);
  control.prepare(`UPDATE tenants SET renews_on = ?, status = CASE WHEN status = 'prueba' THEN 'activo' ELSE status END WHERE id = ?`).run(coversUntil, t.id);
  return control.prepare('SELECT * FROM payments WHERE id = ?').get(id);
}

// Solo se puede anular el último pago (así la fecha vuelve exactamente a como estaba)
export function undoPayment(control, t, paymentId) {
  const last = control.prepare('SELECT * FROM payments WHERE tenant_id = ? ORDER BY id DESC LIMIT 1').get(t.id);
  if (!last || last.id !== paymentId) {
    if (!control.prepare('SELECT 1 FROM payments WHERE id = ? AND tenant_id = ?').get(paymentId, t.id)) throw notFound('Ese pago no existe');
    throw conflict('Solo se puede anular el último pago apuntado');
  }
  control.prepare('DELETE FROM payments WHERE id = ?').run(last.id);
  control.prepare('UPDATE tenants SET renews_on = ? WHERE id = ?').run(last.prev_renews_on, t.id);
  return last;
}

// Recordatorio de cobro por WhatsApp, con el nombre del titular
export function reminderUrl(t) {
  const phone = t.contact_phone || webOf(t).telefono;
  if (!phone || !t.fee_cents) return null;
  const first = String(t.contact_name ?? '').trim().split(/\s+/)[0];
  const [y, m, d] = String(t.renews_on ?? '').split('-');
  const when = t.renews_on ? `${d}/${m}/${y}` : '';
  const due = t.renews_on && t.renews_on < todayStr();
  const text = [
    first ? `Hola ${first}:` : 'Hola:',
    '',
    due
      ? `Te recuerdo que la cuota de tu web (${money(t.fee_cents)}) venció el ${when} y está pendiente de pago.`
      : `Te recuerdo que la cuota de tu web (${money(t.fee_cents)}) vence el ${when}.`,
    'Puedes pagarla por Bizum o transferencia. Cuando lo hagas, avísame y lo apunto.',
    '',
    'Gracias,',
    'Firztnet',
  ].join('\n');
  return `https://wa.me/34${phone}?text=${encodeURIComponent(text)}`;
}
