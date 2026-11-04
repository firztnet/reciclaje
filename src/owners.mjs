// Cuenta del titular de cada cliente (una por chatarrería) para entrar en <subdominio>/panel/.
import crypto from 'node:crypto';
import { badRequest, hashSecret } from './security.mjs';
import * as v from './validate.mjs';

// Clave temporal fácil de dictar por teléfono: sin letras que se confunden (0/O, 1/l/I)
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function tempPassword() {
  const bytes = crypto.randomBytes(12);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export const ownerOf = (control, t) => control.prepare('SELECT * FROM owners WHERE tenant_id = ?').get(t.id);

// Crea la cuenta del titular o le da una clave temporal nueva. Cierra sus sesiones abiertas.
export function grantOwner(control, t, { name, email }) {
  const mail = v.email(email, { required: true });
  const who = v.text(name || t.contact_name || t.name, { max: 80, required: true, name: 'El nombre del titular' });
  if (!mail) throw badRequest('Pon el correo del titular para darle acceso a su panel');
  const password = tempPassword();
  const existing = ownerOf(control, t);
  if (existing) {
    control.prepare('UPDATE owners SET name = ?, email = ?, password_hash = ?, must_change = 1 WHERE id = ?').run(who, mail, hashSecret(password), existing.id);
    control.prepare('DELETE FROM owner_sessions WHERE owner_id = ?').run(existing.id);
  } else {
    control.prepare('INSERT INTO owners (tenant_id, name, email, password_hash) VALUES (?, ?, ?, ?)').run(t.id, who, mail, hashSecret(password));
  }
  return { email: mail, temp_password: password };
}

export function ownerSummary(control, t) {
  const o = ownerOf(control, t);
  return o ? { email: o.email, name: o.name, pending: Boolean(o.must_change), last_login_at: o.last_login_at } : null;
}
