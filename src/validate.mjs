// Validación de lo que llega del panel. Cada función devuelve el valor limpio o lanza un error legible.
import { badRequest } from './security.mjs';

export function text(value, { max = 200, required = false, name = 'El campo' } = {}) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (required && !s) throw badRequest(`${name} es obligatorio`);
  if (s.length > max) throw badRequest(`${name} no puede tener más de ${max} caracteres`);
  return s;
}

// Texto con saltos de línea (párrafos, listas)
export function longText(value, { max = 2000, name = 'El texto' } = {}) {
  const s = String(value ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (s.length > max) throw badRequest(`${name} no puede tener más de ${max} caracteres`);
  return s;
}

export function email(value, { required = false } = {}) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s && !required) return '';
  if (s.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw badRequest('El correo no es válido');
  return s;
}

// Teléfono español: se guardan los 9 dígitos
export function phone(value, { required = false, name = 'El teléfono' } = {}) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('0034')) digits = digits.slice(4);
  else if (digits.length === 11 && digits.startsWith('34')) digits = digits.slice(2);
  if (!digits && !required) return '';
  if (!/^[6789]\d{8}$/.test(digits)) throw badRequest(`${name} debe ser un número español de 9 cifras`);
  return digits;
}

export function date(value, name = 'La fecha') {
  const s = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw badRequest(`${name} no es válida`);
  return s;
}

export function integer(value, { min, max, name = 'El número' }) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${name} debe estar entre ${min} y ${max}`);
  return n;
}

export function oneOf(value, allowed, name = 'El valor') {
  if (!allowed.includes(value)) throw badRequest(`${name} no es válido`);
  return value;
}

export function url(value, { name = 'El enlace' } = {}) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch { throw badRequest(`${name} no es válido`); }
  if (u.protocol !== 'https:' || s.length > 300) throw badRequest(`${name} debe empezar por https://`);
  return u.toString();
}

export const bool = (value) => value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
