import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { openControl } from '../src/db.mjs';
import { upsertSuperadmin } from '../src/admin.mjs';
import { whenText } from '../src/announcements.mjs';
import { createServer } from '../src/server.mjs';

const DOMAIN = 'reciclar.test';
const ADMIN = `admin.${DOMAIN}`;
const WEB = `hierros.${DOMAIN}`;

describe('comunicados', () => {
  let dir, control, server, port;
  const jar = {};

  const request = (host, method, urlPath, body) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const headers = { Host: host, ...(jar[host] ? { Cookie: jar[host] } : {}) };
    if (method !== 'GET') headers.Origin = `http://${host}`;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        const set = res.headers['set-cookie']?.[0]?.split(';')[0];
        if (set) jar[host] = set;
        resolve({ status: res.statusCode, text, json: () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    req.end(data);
  });

  let temp;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reciclar-news-'));
    control = openControl(dir);
    upsertSuperadmin(control, { name: 'Prueba', email: 'admin@prueba.test', password: 'clave-de-prueba-1' });
    server = createServer(control, { domain: DOMAIN, dataDir: dir, production: false, trustProxy: false });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    await request(ADMIN, 'POST', '/api/admin/login', { email: 'admin@prueba.test', password: 'clave-de-prueba-1' });
    const t = (await request(ADMIN, 'POST', '/api/admin/tenants', { name: 'Hierros', slug: 'hierros', barrio: 'Usera', telefono: '611223344', contact_name: 'Pilar', contact_email: 'pilar@h.test', trial_days: 0 })).json();
    temp = t.owner_access.temp_password;
  });

  after(() => {
    server.close();
    control.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('las fechas salen en hora de Madrid', () => {
    // 10 de noviembre de 2026 (invierno, UTC+1): de 02:00 a 04:00 en Madrid
    assert.equal(whenText({ starts_at: '2026-11-10T01:00:00.000Z', ends_at: '2026-11-10T03:00:00.000Z' }), 'el martes, 10 de noviembre, de 2:00 a 4:00');
    assert.equal(whenText({ starts_at: null, ends_at: '2026-11-20T22:59:00.000Z' }), 'hasta el viernes, 20 de noviembre');
  });

  test('un mantenimiento se valida, se ve en la web si se marca y se puede retirar', async () => {
    const soon = Date.now() + 86_400_000;
    const iso = (ms) => new Date(ms).toISOString();
    assert.equal((await request(ADMIN, 'POST', '/api/admin/announcements', { kind: 'mantenimiento', title: 'X', starts_at: iso(soon), ends_at: iso(soon - 1000) })).status, 400);
    assert.equal((await request(ADMIN, 'POST', '/api/admin/announcements', { kind: 'aviso', title: 'X', ends_at: iso(Date.now() - 1000) })).status, 400);

    const solo = (await request(ADMIN, 'POST', '/api/admin/announcements', { kind: 'novedad', title: 'Ya podéis subir fotos', ends_at: iso(soon) })).json();
    const maint = await request(ADMIN, 'POST', '/api/admin/announcements', {
      kind: 'mantenimiento', title: 'Mantenimiento <programado>', body: 'La web puede fallar unos minutos.', show_on_web: true,
      starts_at: iso(soon), ends_at: iso(soon + 2 * 3600_000),
    });
    assert.equal(maint.status, 201, maint.text);
    assert.match(maint.json().when, /^el \w+/);

    // Web pública: solo el marcado, escapado
    const site = (await request(WEB, 'GET', '/')).text;
    assert.match(site, /class="site-notice"/);
    assert.match(site, /Mantenimiento &lt;programado&gt;/);
    assert.doesNotMatch(site, /Ya podéis subir fotos/);

    // Panel del titular: los dos (también antes de cambiar la clave temporal)
    await request(WEB, 'POST', '/api/panel/login', { email: 'pilar@h.test', password: temp });
    assert.equal((await request(WEB, 'GET', '/api/panel/announcements')).json().length, 2);

    assert.equal((await request(ADMIN, 'POST', `/api/admin/announcements/${maint.json().id}/cancel`)).status, 200);
    assert.doesNotMatch((await request(WEB, 'GET', '/')).text, /site-notice/);
    assert.equal((await request(WEB, 'GET', '/api/panel/announcements')).json().length, 1);
    assert.equal((await request(ADMIN, 'GET', '/api/admin/announcements')).json().find((a) => a.id === solo.id).title, 'Ya podéis subir fotos');
  });
});
