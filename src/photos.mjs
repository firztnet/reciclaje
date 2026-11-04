// Fotos propias de cada cliente. Llegan ya reducidas a JPEG desde el navegador (sin datos de ubicación del móvil);
// aquí se comprueba que de verdad son JPEG, se limita el tamaño y se guardan con un nombre al azar.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { badRequest, conflict, notFound } from './security.mjs';
import { webOf } from './tenants.mjs';

export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const MAX_PHOTOS = 40;
export const PHOTO_FILE = /^[a-f0-9]{24}\.jpg$/;

export const tenantDir = (dataDir, slug) => path.join(dataDir, 'clientes', slug);
export const photosDir = (dataDir, slug) => path.join(tenantDir(dataDir, slug), 'fotos');
export const refOf = (file) => `fotos/${file}`;

export function listPhotos(control, t) {
  return control.prepare('SELECT id, file, bytes, uploaded_by, created_at FROM photos WHERE tenant_id = ? ORDER BY id DESC').all(t.id)
    .map((p) => ({ ...p, ref: refOf(p.file) }));
}

export const photoRefs = (control, t) => listPhotos(control, t).map((p) => p.ref);

// JPEG: empieza por FF D8 FF y termina en FF D9
const isJpeg = (buf) => buf.length > 100 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;

export function savePhoto(control, dataDir, t, buffer, who) {
  if (!Buffer.isBuffer(buffer) || !isJpeg(buffer)) throw badRequest('La foto no es una imagen JPEG válida');
  if (buffer.length > MAX_PHOTO_BYTES) throw badRequest('La foto es demasiado grande (máximo 4 MB)');
  const count = control.prepare('SELECT COUNT(*) AS n FROM photos WHERE tenant_id = ?').get(t.id).n;
  if (count >= MAX_PHOTOS) throw conflict(`Como mucho ${MAX_PHOTOS} fotos por cliente: borra alguna antes de subir más`);
  const file = `${crypto.randomBytes(12).toString('hex')}.jpg`;
  const dir = photosDir(dataDir, t.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), buffer, { flag: 'wx' });
  const id = Number(control.prepare('INSERT INTO photos (tenant_id, file, bytes, uploaded_by) VALUES (?, ?, ?, ?)')
    .run(t.id, file, buffer.length, who).lastInsertRowid);
  return { id, file, bytes: buffer.length, ref: refOf(file) };
}

// Dónde se usa una foto en la web (para no dejar huecos al borrarla)
export function photoUses(t, ref) {
  const w = webOf(t);
  return [
    w.portada === ref && 'la portada',
    ...w.galeria.filter((g) => g.foto === ref).map(() => 'la galería'),
    ...w.trabajos.filter((j) => j.foto === ref).map((j) => `el trabajo «${j.titulo}»`),
  ].filter(Boolean);
}

export function deletePhoto(control, dataDir, t, id) {
  const p = control.prepare('SELECT * FROM photos WHERE id = ? AND tenant_id = ?').get(id, t.id);
  if (!p) throw notFound('Esa foto no existe');
  const uses = [...new Set(photoUses(t, refOf(p.file)))];
  if (uses.length) throw conflict(`Esta foto se usa en ${uses.join(', ')}. Quítala de ahí y guarda la web antes de borrarla.`);
  control.prepare('DELETE FROM photos WHERE id = ?').run(p.id);
  fs.rmSync(path.join(photosDir(dataDir, t.slug), p.file), { force: true });
  return p;
}

export function photoPath(dataDir, slug, file) {
  return PHOTO_FILE.test(file) ? path.join(photosDir(dataDir, slug), file) : null;
}
