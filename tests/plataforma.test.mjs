import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { openControl } from '../src/db.mjs';
import { upsertSuperadmin } from '../src/admin.mjs';
import { createServer } from '../src/server.mjs';
import { accessOf, readNewTenant, readWeb, defaultWeb } from '../src/tenants.mjs';

const DOMAIN = 'reciclar.test';
const ADMIN = `admin.${DOMAIN}`;

describe('estado de un cliente', () => {
  test('prueba vigente, vencida, activo con renovación vencida y suspendido', () => {
    const today = '2026-11-04';
    assert.deepEqual(accessOf({ status: 'prueba', trial_ends: '2026-11-10' }, today), { open: true, state: 'prueba', days_left: 6, renewal_due: false });
    assert.equal(accessOf({ status: 'prueba', trial_ends: '2026-11-03' }, today).state, 'prueba_vencida');
    assert.equal(accessOf({ status: 'prueba', trial_ends: '2026-11-03' }, today).open, false);
    assert.equal(accessOf({ status: 'activo', renews_on: '2026-11-01' }, today).renewal_due, true);
    assert.equal(accessOf({ status: 'suspendido' }, today).open, false);
  });
});

describe('validación del alta', () => {
  const base = { name: 'Chatarras Pérez', slug: 'chatarrasperez', barrio: 'Vallecas', telefono: '600 11 22 33', contact_name: 'Luis' };
  test('acepta un alta correcta y limpia el teléfono', () => {
    const t = readNewTenant(base);
    assert.equal(t.telefono, '600112233');
    assert.equal(t.trial_days, 30);
  });
  test('rechaza subdominios raros o reservados y teléfonos que no son españoles', () => {
    assert.throws(() => readNewTenant({ ...base, slug: 'Con Espacios' }), /subdominio/);
    assert.throws(() => readNewTenant({ ...base, slug: 'admin' }), /reservado/);
    assert.throws(() => readNewTenant({ ...base, telefono: '12345' }), /9 cifras/);
  });
  test('la web solo admite fotos de la carpeta compartida y enlaces https', () => {
    const current = defaultWeb({ name: 'X', barrio: 'Y', telefono: '600112233' });
    assert.throws(() => readWeb({ trabajos: [{ foto: '../../secreto', titulo: 'x' }] }, current), /foto/);
    assert.throws(() => readWeb({ google: { url: 'javascript:alert(1)', nota: '4,9' } }, current), /https/);
    assert.equal(readWeb({ zonas: 'Norte: A, B\nSur: C' }, current).zonas.length, 2);
  });
});

describe('servidor', () => {
  let dir, control, server, port, cookie = '';

  const request = (host, method, urlPath, body, extra = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const headers = { Host: host, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: `http://${host}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra };
    if (method !== 'GET' && !data) headers.Origin ??= `http://${host}`;
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(data);
  });

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reciclar-'));
    control = openControl(dir);
    upsertSuperadmin(control, { name: 'Prueba', email: 'admin@prueba.test', password: 'clave-de-prueba-1' });
    server = createServer(control, { domain: DOMAIN, dataDir: dir, production: false, trustProxy: false });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });

  after(() => {
    server.close();
    control.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('sin sesión no se ven los clientes', async () => {
    assert.equal((await request(ADMIN, 'GET', '/api/admin/tenants')).status, 401);
  });

  test('una clave mal escrita no entra', async () => {
    assert.equal((await request(ADMIN, 'POST', '/api/admin/login', { email: 'admin@prueba.test', password: 'mal' })).status, 401);
  });

  test('entrar, dar de alta y ver su web', async () => {
    const login = await request(ADMIN, 'POST', '/api/admin/login', { email: 'admin@prueba.test', password: 'clave-de-prueba-1' });
    assert.equal(login.status, 200);
    cookie = login.headers['set-cookie'][0].split(';')[0];
    assert.match(login.headers['set-cookie'][0], /HttpOnly/);

    const created = await request(ADMIN, 'POST', '/api/admin/tenants', {
      name: 'Chatarras <script>alert(1)</script>', slug: 'chatarras', barrio: 'Vallecas', telefono: '600112233', contact_name: 'Luis', trial_days: 15,
    });
    assert.equal(created.status, 201);
    const t = created.json();
    assert.equal(t.access.state, 'prueba');

    const site = await request(`chatarras.${DOMAIN}`, 'GET', '/');
    assert.equal(site.status, 200);
    assert.match(site.text, /tel:\+34600112233/);
    assert.doesNotMatch(site.text, /<script>alert/);
    assert.match(site.headers['content-security-policy'], /script-src 'self'/);
    const datos = await request(`chatarras.${DOMAIN}`, 'GET', '/datos.js');
    assert.match(datos.text, /"whatsapp":"34600112233"/);
    assert.equal((await request(`chatarras.${DOMAIN}`, 'GET', '/styles.css')).status, 200);
    const cartel = await request(`chatarras.${DOMAIN}`, 'GET', '/cartel.html');
    assert.match(cartel.text, /<svg class="qr-code"/);
    assert.match(cartel.text, new RegExp(`chatarras\\.${DOMAIN.replace('.', '\\.')}`));
    assert.equal((await request(`chatarras.${DOMAIN}`, 'GET', '/..%2f..%2fsrc%2fdb.mjs')).status, 404);

    const list = (await request(ADMIN, 'GET', '/api/admin/tenants')).json();
    assert.equal(list[0].usage.visits_month, 1);
  });

  test('editar su web cambia la página al momento', async () => {
    const [t] = (await request(ADMIN, 'GET', '/api/admin/tenants')).json();
    const saved = await request(ADMIN, 'PUT', `/api/admin/tenants/${t.id}/web`, { vaciados: true, opiniones: [{ nombre: 'Ana', texto: 'Muy rápidos', estrellas: 5 }] });
    assert.equal(saved.status, 200);
    const site = await request(`chatarras.${DOMAIN}`, 'GET', '/');
    assert.match(site.text, /id="vaciados"/);
    assert.match((await request(`chatarras.${DOMAIN}`, 'GET', '/datos.js')).text, /Muy rápidos/);
  });

  test('una petición desde otra web se rechaza', async () => {
    const r = await request(ADMIN, 'POST', '/api/admin/tenants', { name: 'X' }, { Origin: 'https://otra-web.example' });
    assert.equal(r.status, 403);
  });

  test('suspendido: su web muestra el aviso; solo así se puede eliminar', async () => {
    const [t] = (await request(ADMIN, 'GET', '/api/admin/tenants')).json();
    const early = await request(ADMIN, 'DELETE', `/api/admin/tenants/${t.id}`, { confirm: 'chatarras' });
    assert.equal(early.status, 409, early.text);
    const s = await request(ADMIN, 'PATCH', `/api/admin/tenants/${t.id}`, { status: 'suspendido', suspended_reason: 'Pago pendiente' });
    assert.equal(s.json().access.state, 'suspendido');
    const site = await request(`chatarras.${DOMAIN}`, 'GET', '/');
    assert.equal(site.status, 403);
    assert.match(site.text, /Servicio suspendido/);
    assert.equal((await request(ADMIN, 'DELETE', `/api/admin/tenants/${t.id}`, { confirm: 'otro' })).status, 400);
    assert.equal((await request(ADMIN, 'DELETE', `/api/admin/tenants/${t.id}`, { confirm: 'chatarras' })).status, 200);
    assert.equal((await request(`chatarras.${DOMAIN}`, 'GET', '/')).status, 404);
    assert.equal(control.prepare('SELECT COUNT(*) AS n FROM deleted_tenants').get().n, 1);
  });

  test('una dirección que no existe da 404', async () => {
    assert.equal((await request(`nadie.${DOMAIN}`, 'GET', '/')).status, 404);
  });
});
