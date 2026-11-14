import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { openControl } from '../src/db.mjs';
import { upsertSuperadmin } from '../src/admin.mjs';
import { addMonths, euros, monthlyCents } from '../src/billing.mjs';
import { createServer } from '../src/server.mjs';

const DOMAIN = 'reciclar.test';
const ADMIN = `admin.${DOMAIN}`;

describe('cálculos de la cuota', () => {
  test('sumar meses respeta el fin de mes', () => {
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
    assert.equal(addMonths('2026-11-08', 3), '2027-02-08');
    assert.equal(addMonths('2026-12-15', 12), '2027-12-15');
  });
  test('los importes se leen como se escriben', () => {
    assert.equal(euros('25'), 2500);
    assert.equal(euros('25,5'), 2550);
    assert.equal(euros('25.50 €'), 2550);
    assert.throws(() => euros('veinte'), /no es válido/);
    assert.throws(() => euros('-5'), /no es válido/);
  });
  test('lo que aporta cada cliente al mes', () => {
    assert.equal(monthlyCents({ fee_cents: 3000, billing_period: 'mensual' }), 3000);
    assert.equal(monthlyCents({ fee_cents: 9000, billing_period: 'trimestral' }), 3000);
    assert.equal(monthlyCents({ fee_cents: 36000, billing_period: 'anual' }), 3000);
  });
});

describe('cobros en el panel', () => {
  let dir, control, server, port, cookie = '';

  const request = (method, urlPath, body) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const headers = { Host: ADMIN, ...(cookie ? { Cookie: cookie } : {}) };
    if (method !== 'GET') headers.Origin = `http://${ADMIN}`;
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

  let t;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reciclar-cobros-'));
    control = openControl(dir);
    upsertSuperadmin(control, { name: 'Prueba', email: 'admin@prueba.test', password: 'clave-de-prueba-1' });
    server = createServer(control, { domain: DOMAIN, dataDir: dir, production: false, trustProxy: false });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    await request('POST', '/api/admin/login', { email: 'admin@prueba.test', password: 'clave-de-prueba-1' });
    t = (await request('POST', '/api/admin/tenants', { name: 'Hierros', slug: 'hierros', barrio: 'Usera', telefono: '611223344', contact_name: 'Pilar', trial_days: 15 })).json();
  });

  after(() => {
    server.close();
    control.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('se pone la cuota y aparece en los ingresos del mes', async () => {
    assert.equal((await request('PATCH', `/api/admin/tenants/${t.id}`, { fee: '30', billing_period: 'semanal' })).status, 400);
    const r = (await request('PATCH', `/api/admin/tenants/${t.id}`, { fee: '30', billing_period: 'mensual', renews_on: '2026-11-10' })).json();
    assert.equal(r.fee_cents, 3000);
    assert.equal(r.billing.monthly_cents, 3000);
    assert.match(r.billing.reminder_url, /^https:\/\/wa\.me\/34611223344\?text=Hola%20Pilar/);
  });

  test('cada pago adelanta un periodo desde lo pagado y saca de la prueba', async () => {
    const p1 = (await request('POST', `/api/admin/tenants/${t.id}/payments`, { method: 'bizum', paid_on: '2026-11-08' })).json();
    assert.equal(p1.payment.amount_cents, 3000);
    assert.equal(p1.payment.covers_until, '2026-12-10');
    assert.equal(p1.tenant.status, 'activo');
    const p2 = (await request('POST', `/api/admin/tenants/${t.id}/payments`, { amount: '30,00', method: 'efectivo' })).json();
    assert.equal(p2.payment.covers_until, '2027-01-10');
    assert.equal((await request('POST', `/api/admin/tenants/${t.id}/payments`, { method: 'cheque' })).status, 400);

    // Solo se anula el último, y la fecha vuelve a la de antes
    assert.equal((await request('POST', `/api/admin/tenants/${t.id}/payments/${p1.payment.id}/undo`)).status, 409);
    const undone = (await request('POST', `/api/admin/tenants/${t.id}/payments/${p2.payment.id}/undo`)).json();
    assert.equal(undone.tenant.renews_on, '2026-12-10');
    const list = (await request('GET', `/api/admin/tenants/${t.id}/payments`)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].method, 'bizum');
  });
});

describe('cobro apuntado desde Firztnet Central', () => {
  let dir, control, server, port, cookie = '';
  const CLAVE = 'clave-de-central-de-prueba-123456';
  const request = (method, urlPath, body, extra = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const headers = { Host: ADMIN, ...(cookie ? { Cookie: cookie } : {}), ...extra };
    if (method !== 'GET') headers.Origin = `http://${ADMIN}`;
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

  let t;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reciclar-central-pago-'));
    control = openControl(dir);
    upsertSuperadmin(control, { name: 'Prueba', email: 'admin@prueba.test', password: 'clave-de-prueba-1' });
    server = createServer(control, { domain: DOMAIN, dataDir: dir, production: false, trustProxy: false, centralKey: CLAVE });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    await request('POST', '/api/admin/login', { email: 'admin@prueba.test', password: 'clave-de-prueba-1' });
    t = (await request('POST', '/api/admin/tenants', { name: 'Metales Sur', slug: 'metales-sur', barrio: 'Vallecas', telefono: '611000111', contact_name: 'Rafa', trial_days: 15 })).json();
    await request('PATCH', `/api/admin/tenants/${t.id}`, { fee: '30', billing_period: 'mensual', renews_on: '2026-11-10' });
  });
  after(() => { server.close(); control.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  test('sin la clave de este sistema no entra', async () => {
    assert.equal((await request('POST', '/api/central/pago', { slug: 'metales-sur' })).status, 401);
    assert.equal((await request('POST', '/api/central/pago', { slug: 'metales-sur' }, { 'X-Firztnet-Clave': 'otra-clave' })).status, 401);
  });
  test('dos cuotas adelantan dos meses y sacan de la prueba', async () => {
    const r = await request('POST', '/api/central/pago', { slug: 'metales-sur', cuotas: 2, importe: 60, metodo: 'Bizum' }, { 'X-Firztnet-Clave': CLAVE });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json().renueva, '2027-01-10');
    const lista = (await request('GET', `/api/admin/tenants/${t.id}/payments`)).json();
    assert.equal(lista[0].amount_cents, 6000);
    assert.equal(lista[0].method, 'bizum');
    assert.equal(control.prepare('SELECT status FROM tenants WHERE id = ?').get(t.id).status, 'activo');
  });
  test('un cliente que no existe', async () => {
    assert.equal((await request('POST', '/api/central/pago', { slug: 'no-existe' }, { 'X-Firztnet-Clave': CLAVE })).status, 404);
  });
});
