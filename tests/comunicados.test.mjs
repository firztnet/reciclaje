import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { openControl } from '../src/db.mjs';
import { upsertSuperadmin } from '../src/admin.mjs';
import { whatsappMessage, whenText } from '../src/announcements.mjs';
import { createServer } from '../src/server.mjs';

const DOMAIN = 'reciclar.test';
const ADMIN = `admin.${DOMAIN}`;

describe('comunicados por WhatsApp', () => {
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
        resolve({ status: res.statusCode, text, json: () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    req.end(data);
  });

  let tenant;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reciclar-news-'));
    control = openControl(dir);
    upsertSuperadmin(control, { name: 'Prueba', email: 'admin@prueba.test', password: 'clave-de-prueba-1' });
    server = createServer(control, { domain: DOMAIN, dataDir: dir, production: false, trustProxy: false });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    await request(ADMIN, 'POST', '/api/admin/login', { email: 'admin@prueba.test', password: 'clave-de-prueba-1' });
    tenant = (await request(ADMIN, 'POST', '/api/admin/tenants', { name: 'Hierros', slug: 'hierros', barrio: 'Usera', telefono: '611223344', contact_name: 'Pilar Gómez', trial_days: 0 })).json();
  });

  after(() => {
    server.close();
    control.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('las fechas salen en hora de Madrid y el mensaje lleva el nombre', () => {
    const a = { kind: 'mantenimiento', title: 'Mantenimiento', body: 'Unos minutos.', starts_at: '2026-11-10T01:00:00.000Z', ends_at: '2026-11-10T03:00:00.000Z' };
    assert.equal(whenText(a), 'el martes, 10 de noviembre, de 2:00 a 4:00');
    assert.equal(whatsappMessage(a, 'Pilar Gómez'), 'Hola Pilar:\n\n*Mantenimiento*\nEl martes, 10 de noviembre, de 2:00 a 4:00.\n\nUnos minutos.\n\nUn saludo,\nFirztnet');
    // Un aviso no lleva fecha: la de fin solo sirve para dejar de ofrecerlo
    assert.doesNotMatch(whatsappMessage({ kind: 'aviso', title: 'Nuevo horario', body: '', ends_at: '2026-12-01T00:00:00.000Z' }, ''), /hasta/);
  });

  test('se prepara, cada cliente tiene su enlace de WhatsApp y queda apuntado a quién se envió', async () => {
    const soon = Date.now() + 86_400_000;
    const iso = (ms) => new Date(ms).toISOString();
    assert.equal((await request(ADMIN, 'POST', '/api/admin/announcements', { kind: 'mantenimiento', title: 'X', starts_at: iso(soon), ends_at: iso(soon - 1000) })).status, 400);
    const a = (await request(ADMIN, 'POST', '/api/admin/announcements', { kind: 'mantenimiento', title: 'Mantenimiento', body: 'Unos minutos.', starts_at: iso(soon), ends_at: iso(soon + 7200_000) })).json();

    let [item] = (await request(ADMIN, 'GET', '/api/admin/announcements')).json();
    const [r] = item.recipients;
    assert.equal(r.tenant_id, tenant.id);
    assert.equal(r.sent_at, null);
    assert.match(r.whatsapp_url, /^https:\/\/wa\.me\/34611223344\?text=Hola%20Pilar%3A/);

    assert.equal((await request(ADMIN, 'POST', `/api/admin/announcements/${a.id}/sent`, { tenant_id: tenant.id })).status, 200);
    assert.equal((await request(ADMIN, 'POST', `/api/admin/announcements/${a.id}/sent`, { tenant_id: tenant.id })).status, 200);
    [item] = (await request(ADMIN, 'GET', '/api/admin/announcements')).json();
    assert.ok(item.recipients[0].sent_at);
    assert.equal((await request(ADMIN, 'POST', `/api/admin/announcements/${a.id}/sent`, { tenant_id: 9999 })).status, 404);

    // No sale en la web pública
    assert.doesNotMatch((await request(`hierros.${DOMAIN}`, 'GET', '/')).text, /Mantenimiento/);
    assert.equal((await request(ADMIN, 'POST', `/api/admin/announcements/${a.id}/cancel`)).status, 200);
  });
});
