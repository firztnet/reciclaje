// Configuración por variables de entorno. Sin nada, arranca en local con *.reciclar.localhost:3500.
import path from 'node:path';

export const ROOT = path.join(import.meta.dirname, '..');

export function loadConfig(env = process.env) {
  // En Railway, el disco permanente manda: así los datos nunca acaban en el disco que se borra al actualizar
  const volume = env.RAILWAY_VOLUME_MOUNT_PATH || '';
  const dataDir = path.resolve(ROOT, volume || env.DATA_DIR || 'data');
  return {
    port: Number(env.PORT || 3500),
    domain: String(env.PLATFORM_DOMAIN || 'reciclar.localhost').toLowerCase(),
    dataDir,
    // En Railway sin volumen, los datos se perderían en la siguiente actualización
    dataAtRisk: Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID) && !volume,
    production: env.NODE_ENV === 'production',
    trustProxy: env.TRUST_PROXY === '1',
    // Firztnet Central (reparaciones): adónde va «Pedir ayuda» y la lista de clientes. Vacío = desactivado.
    centralUrl: String(env.CENTRAL_URL || '').trim(),
    centralKey: String(env.CENTRAL_CLAVE || '').trim(),
    admin: {
      name: env.PLATFORM_ADMIN_NAME || '',
      email: env.PLATFORM_ADMIN_EMAIL || '',
      password: env.PLATFORM_ADMIN_PASSWORD || '',
    },
  };
}
