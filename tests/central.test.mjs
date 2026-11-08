import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { openControl } from '../src/db.mjs';
import { loadConfig } from '../src/config.mjs';
import { createTenant, findTenant } from '../src/tenants.mjs';
import { countDailyVisit, helpRequests, sendHelp, sendTenants, tenantSnapshot } from '../src/central.mjs';

// Firztnet Central: «Pedir ayuda», la ficha de cada cliente y las visitas de su web
const KEY = 'clave-de-prueba-de-reciclaje-0123456789';
const req = (headers, url = '/') => ({ url, headers: { host: 'chatarra.reciclar.test', ...headers } });

describe('Firztnet Central en reciclaje', () => {
  let central;
  let config;
  let control;
  let dir;
  const received = [];

  before(async () => {
    central = http.createServer((rq, rs) => {
      let raw = '';
      rq.on('data', (c) => { raw += c; });
      rq.on('end', () => {
        if (rq.headers['x-firztnet-clave'] !== KEY) { rs.writeHead(401).end('{"error":"Clave del sistema no válida"}'); return; }
        received.push({ path: rq.url, body: raw ? JSON.parse(raw) : null });
        rs.setHeader('Content-Type', 'application/json');
        if (rq.url === '/api/central/entrada/ayuda') { rs.writeHead(201).end('{"id":9,"referencia":"AY-00009"}'); return; }
        if (rq.url.startsWith('/api/central/entrada/mias')) { rs.end('{"peticiones":[{"referencia":"AY-00009","estado":"en_curso","respuesta":"Lo cambiamos hoy"}]}'); return; }
        rs.end('{"ok":true}');
      });
    });
    await new Promise((resolve) => central.listen(0, resolve));
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reciclaje-central-'));
    control = openControl(dir);
    config = loadConfig({ DATA_DIR: dir, PLATFORM_DOMAIN: 'reciclar.test', CENTRAL_URL: `http://127.0.0.1:${central.address().port}`, CENTRAL_CLAVE: KEY });
    createTenant(control, { slug: 'chatarra', name: 'Chatarra Pérez', contact_name: 'Luis', contact_email: 'luis@chatarra.test', telefono: '600222333', company_name: '', tax_id: '', notes: '', trial_days: 3 });
  });
  after(async () => {
    control.close();
    fs.rmSync(dir, { recursive: true, force: true });
    await new Promise((resolve) => central.close(resolve));
  });

  test('cuenta las visitas por aparato y origen, sin robots', () => {
    const t = findTenant(control, 'chatarra');
    countDailyVisit(control, t, req({ 'user-agent': 'Mozilla/5.0 (iPhone) Mobile', referer: 'https://www.google.es/' }));
    countDailyVisit(control, t, req({ 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' }, '/?qr'));
    countDailyVisit(control, t, req({ 'user-agent': 'Googlebot/2.1' }));
    const rows = control.prepare('SELECT device, source, n FROM web_visits_daily').all().map((r) => `${r.device}:${r.source}:${r.n}`).sort();
    assert.deepEqual(rows, ['movil:google:1', 'ordenador:qr:1']);
  });

  test('la ficha lleva estado, plazo, contacto y visitas', () => {
    const s = tenantSnapshot(control, config, findTenant(control, 'chatarra'));
    assert.equal(s.estado, 'prueba');
    assert.equal(s.dias, 3);
    assert.equal(s.contacto_telefono, '600222333');
    assert.equal(s.direccion_web, 'chatarra.reciclar.test');
    assert.equal(s.uso.visitas_mes, 2);
    assert.equal(s.visitas.length, 2);
  });

  test('manda la lista de clientes con la clave del sistema', async () => {
    assert.equal(await sendTenants(control, config), true);
    const sent = received.find((r) => r.path === '/api/central/entrada/locales');
    assert.equal(sent.body.locales[0].slug, 'chatarra');
  });

  test('pedir ayuda y ver la respuesta', async () => {
    const t = findTenant(control, 'chatarra');
    const res = await sendHelp(config, t, { name: 'Luis' }, { type: 'web', message: 'Cambiar el horario', urgent: true }, 'test');
    assert.equal(res.referencia, 'AY-00009');
    const sent = received.find((r) => r.path === '/api/central/entrada/ayuda');
    assert.equal(sent.body.negocio, 'Chatarra Pérez');
    assert.equal(sent.body.urgente, true);
    assert.match(sent.body.cliente_ref, /^chatarra\.reciclar\.test#\d+$/);
    assert.equal((await helpRequests(config, t)).requests[0].respuesta, 'Lo cambiamos hoy');
    await assert.rejects(() => sendHelp(config, t, { name: 'Luis' }, { type: 'web', message: '' }), /qué pasa/);
  });

  test('sin Central configurado no se activa', async () => {
    const off = loadConfig({ DATA_DIR: dir });
    assert.deepEqual(await helpRequests(off, findTenant(control, 'chatarra')), { enabled: false, requests: [] });
    assert.equal(await sendTenants(control, off), false);
  });
});
