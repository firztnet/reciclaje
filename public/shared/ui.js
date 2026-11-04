// Utilidades comunes del panel del superadministrador y del panel del titular.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const shortDate = (d) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES') : '—');
export const dateTime = (d) => (d ? new Date(d).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const fmtPhone = (d) => (d ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : '');

export function toast(text, kind = 'ok') {
  const el = Object.assign(document.createElement('div'), { className: `toast ${kind}`, textContent: text });
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500);
}

// Llamadas a la API: JSON o una foto (Blob JPEG). «onUnauthorized» vuelve a la pantalla de entrar.
export function makeApi(prefix, onUnauthorized) {
  return async function api(path, { method = 'GET', body, photo } = {}) {
    const res = await fetch(`${prefix}${path}`, {
      method,
      headers: photo ? { 'Content-Type': 'image/jpeg' } : body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: photo ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401 && path !== '/login') { onUnauthorized(); throw new Error('Tu sesión ha terminado. Vuelve a entrar.'); }
    if (!res.ok) throw new Error(data?.error || 'No se pudo completar la operación');
    return data;
  };
}

// Reduce la foto a 1600 px como mucho y la vuelve a guardar en JPEG. Al redibujarla se pierden los datos
// internos del móvil (ubicación GPS, modelo…), que no deben acabar publicados en la web.
export async function prepareJpeg(file, max = 1600, quality = 0.85) {
  if (!file.type.startsWith('image/')) throw new Error(`«${file.name}» no es una imagen`);
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { throw new Error(`No se pudo leer «${file.name}»`); }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo preparar la foto'))), 'image/jpeg', quality));
}
