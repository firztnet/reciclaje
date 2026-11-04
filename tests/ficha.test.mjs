import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { openControl } from '../src/db.mjs';
import { upsertSuperadmin } from '../src/admin.mjs';
import { backupNow } from '../src/backup.mjs';
import { loadConfig } from '../src/config.mjs';
import { createServer } from '../src/server.mjs';

const DOMAIN = 'reciclar.test';
const ADMIN = `admin.${DOMAIN}`;

describe('fichas, copias y puesta en marcha', () => {
  let dir, control, server, port, cookie = '';

  const request = (host, method, urlPath, body) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const headers = { Host: host, ...(cookie ? { Cookie: cookie } : {}) };
    if (method !== 'GET') headers.Origin = `http://${host}`;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        const set = res.headers['set-cookie']?.[0]?.split(';')[0];
        if (set) cookie = set;
        resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    req.end(data);
  });

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reciclar-ficha-'));
    control = openControl(dir);
    upsertSuperadmin(control, { name: 'Prueba', email: 'admin@prueba.test', password: 'clave-de-prueba-1' });
    server = createServer(control, { domain: DOMAIN, dataDir: dir, production: false, trustProxy: false });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    await request(ADMIN, 'POST', '/api/admin/login', { email: 'admin@prueba.test', password: 'clave-de-prueba-1' });
  });

  after(() => {
    server.close();
    control.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('exportar una ficha e importarla con otro subdominio deja la misma web', async () => {
    const t = (await request(ADMIN, 'POST', '/api/admin/tenants', { name: 'Chatarras Ana', slug: 'ana', barrio: 'Tetuán', telefono: '633445566', contact_name: 'Ana', contact_email: 'ana@ana.test', trial_days: 0 })).json();
    await request(ADMIN, 'PUT', `/api/admin/tenants/${t.id}/web`, { vaciados: true, opiniones: [{ nombre: 'Luis', texto: 'Muy bien', estrellas: 5 }] });
    const exp = await request(ADMIN, 'GET', `/api/admin/tenants/${t.id}/ficha`);
    assert.match(exp.headers['content-disposition'], /ficha-ana\.json/);
    const ficha = exp.json();
    // Una foto propia de la otra instalación no puede viajar: se quita al importar
    ficha.web.portada = 'fotos/0123456789abcdef01234567.jpg';

    assert.equal((await request(ADMIN, 'POST', '/api/admin/tenants/import', { ficha: { ...ficha, formato: 'otro' }, slug: 'ana2' })).status, 400);
    assert.equal((await request(ADMIN, 'POST', '/api/admin/tenants/import', { ficha })).status, 409);
    const imp = await request(ADMIN, 'POST', '/api/admin/tenants/import', { ficha, slug: 'ana2' });
    assert.equal(imp.status, 201, imp.text);
    const t2 = imp.json();
    assert.equal(t2.access.state, 'activo');
    assert.equal(t2.web.portada, '');
    assert.equal(t2.web.opiniones[0].texto, 'Muy bien');
    assert.equal(t2.owner_access.email, 'ana@ana.test');
    assert.match((await request(`ana2.${DOMAIN}`, 'GET', '/')).text, /id="vaciados"/);

    // Al importar se puede poner el correo real del titular en lugar del de la ficha
    const imp3 = (await request(ADMIN, 'POST', '/api/admin/tenants/import', { ficha, slug: 'ana3', contact_email: 'real@ana.test' })).json();
    assert.equal(imp3.owner_access.email, 'real@ana.test');
    assert.equal(imp3.contact_email, 'real@ana.test');
    // Y una clave nueva con otro correo cambia también el correo de contacto
    const again = (await request(ADMIN, 'POST', `/api/admin/tenants/${imp3.id}/owner`, { email: 'otro@ana.test' })).json();
    assert.equal(again.email, 'otro@ana.test');
    const fresh = (await request(ADMIN, 'GET', '/api/admin/tenants')).json().find((x) => x.id === imp3.id);
    assert.equal(fresh.contact_email, 'otro@ana.test');
    assert.equal(fresh.owner.email, 'otro@ana.test');
  });

  test('la copia de seguridad del día se hace una vez y se puede abrir', async () => {
    const file = await backupNow(control, dir, '2026-11-04');
    assert.ok(fs.existsSync(file));
    assert.equal(await backupNow(control, dir, '2026-11-04'), null);
    const { DatabaseSync } = await import('node:sqlite');
    const restored = new DatabaseSync(file, { readOnly: true });
    assert.ok(restored.prepare('SELECT COUNT(*) AS n FROM tenants').get().n >= 2);
    restored.close();
  });

  test('en Railway usa el volumen y avisa si no lo hay', () => {
    const withVolume = loadConfig({ RAILWAY_ENVIRONMENT: 'production', RAILWAY_VOLUME_MOUNT_PATH: '/data', DATA_DIR: '/otra' });
    assert.equal(withVolume.dataAtRisk, false);
    assert.equal(path.basename(withVolume.dataDir), 'data');
    assert.equal(loadConfig({ RAILWAY_ENVIRONMENT: 'production' }).dataAtRisk, true);
    assert.equal(loadConfig({}).dataAtRisk, false);
  });
});
