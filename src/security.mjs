// Claves, sesiones, cookies, límite de intentos y errores HTTP.
import crypto from 'node:crypto';

export const MIN_PASSWORD = 10;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const badRequest = (m) => new HttpError(400, m);
export const unauthorized = (m = 'Tienes que entrar de nuevo') => new HttpError(401, m);
export const forbidden = (m) => new HttpError(403, m);
export const notFound = (m = 'No encontrado') => new HttpError(404, m);
export const conflict = (m) => new HttpError(409, m);

// Claves guardadas con scrypt y sal propia: «scrypt$sal$hash»
export function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(secret, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifySecret(secret, stored) {
  const [kind, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(String(secret), Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export const isValidPassword = (p) => typeof p === 'string' && p.length >= MIN_PASSWORD && p.length <= 200;
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export function readCookie(req, name) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

export function cookieHeader(name, value, { maxAgeSeconds, secure }) {
  return [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`, secure ? 'Secure' : ''].filter(Boolean).join('; ');
}

// Bloquea una IP tras demasiados fallos seguidos durante un rato
export class FailureLimiter {
  constructor({ maxFails, windowMs }) {
    this.maxFails = maxFails;
    this.windowMs = windowMs;
    this.fails = new Map();
  }
  blockedMinutes(key) {
    const f = this.fails.get(key);
    if (!f || f.count < this.maxFails) return 0;
    const left = f.first + this.windowMs - Date.now();
    if (left <= 0) { this.fails.delete(key); return 0; }
    return Math.ceil(left / 60000);
  }
  fail(key) {
    const now = Date.now();
    const f = this.fails.get(key);
    if (!f || f.first + this.windowMs < now) this.fails.set(key, { count: 1, first: now });
    else f.count++;
  }
  succeed(key) { this.fails.delete(key); }
}
