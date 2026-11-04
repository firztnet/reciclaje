// Arranque de la plataforma de reciclaje.
import { loadConfig } from './config.mjs';
import { openControl } from './db.mjs';
import { upsertSuperadmin } from './admin.mjs';
import { scheduleBackups } from './backup.mjs';
import { createServer } from './server.mjs';

const config = loadConfig();
if (config.dataAtRisk) {
  console.warn('¡CUIDADO! Los datos NO están en un disco permanente: añade un volumen al servicio o se perderán al actualizar.');
} else {
  console.log(`Datos en: ${config.dataDir}`);
}
const control = openControl(config.dataDir);

// Primera puesta en marcha: crea el superadministrador con las variables PLATFORM_ADMIN_*
if (config.admin.email && config.admin.password) {
  upsertSuperadmin(control, { name: config.admin.name || 'Superadministrador', email: config.admin.email, password: config.admin.password });
  console.log(`Superadministrador listo: ${config.admin.email}. Ya puedes quitar PLATFORM_ADMIN_PASSWORD.`);
}
if (!control.prepare('SELECT 1 FROM superadmins LIMIT 1').get()) {
  console.warn('Aún no hay superadministrador: arranca con PLATFORM_ADMIN_EMAIL y PLATFORM_ADMIN_PASSWORD, o ejecuta «npm run demo».');
}

const stopBackups = scheduleBackups(control, config.dataDir);
const server = createServer(control, config);
server.listen(config.port, () => {
  const url = config.production ? `https://admin.${config.domain}` : `http://admin.${config.domain}:${config.port}`;
  console.log(`Plataforma de reciclaje en marcha (puerto ${config.port}) · superadministrador: ${url}`);
});

const stop = () => { stopBackups(); server.close(); control.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
