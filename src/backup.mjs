// Copias de seguridad diarias de la base de la plataforma, en <datos>/backups-plataforma (se guardan las 30 últimas).
// Las fotos de los clientes son archivos en <datos>/clientes y se copian con el volumen entero.
import fs from 'node:fs';
import path from 'node:path';
import { backup } from 'node:sqlite';
import { todayStr } from './tenants.mjs';

const KEEP = 30;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export async function backupNow(control, dataDir, day = todayStr()) {
  const dir = path.join(dataDir, 'backups-plataforma');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `plataforma-${day}.db`);
  if (fs.existsSync(file)) return null;
  // Se escribe con otro nombre y se renombra al acabar: nunca queda una copia a medias con el nombre bueno
  const tmp = `${file}.tmp`;
  await backup(control, tmp);
  fs.renameSync(tmp, file);
  const old = fs.readdirSync(dir).filter((f) => /^plataforma-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(KEEP);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}

// Una al arrancar (si hoy no hay) y luego se comprueba cada 6 horas
export function scheduleBackups(control, dataDir) {
  const run = () => backupNow(control, dataDir)
    .then((file) => { if (file) console.log(`Copia de seguridad: ${path.relative(dataDir, file)}`); })
    .catch((err) => console.error('No se pudo hacer la copia de seguridad:', err));
  run();
  const timer = setInterval(run, CHECK_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
