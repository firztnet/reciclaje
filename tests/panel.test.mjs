import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { openControl } from '../src/db.mjs';
import { upsertSuperadmin } from '../src/admin.mjs';
import { createServer } from '../src/server.mjs';

const DOMAIN = 'reciclar.test';
const ADMIN = `admin.${DOMAIN}`;
const A = `hierros.${DOMAIN}`;
const B = `metales.${DOMAIN}`;
// JPEG mínimo de prueba: cabecera FF D8 FF, relleno y cierre FF D9
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7), Buffer.from([0xff, 0xd9])]);

describe('panel del titular y fotos', () => {
  let dir, control, server, port;
  const jar = {};

  const request = (host, method, urlPath, body, { raw, type, who = host } = {}) => new Promise((resolve, reject) => {
    const data = raw ?? (body === undefined ? undefined : Buffer.from(JSON.stringify(body)));
    const headers = { Host: host, ...(jar[who] ? { Cookie: jar[who] } : {}) };
    if (method !== 'GET') headers.Origin = `http://${host}`;
    if (data) { headers['Content-Type'] = type ?? (raw ? 'image/jpeg' : 'application/json'); headers['Content-Length'] = data.length; }
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const cookie = res.headers['set-cookie']?.[0]?.split(';')[0];
        if (cookie) jar[who] = cookie;
        resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString('utf8'), json: () => JSON.parse(buf.toString('utf8')) });
      });
    });
    req.on('error', reject);
    req.end(data);
  });

  let tenant, temp;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reciclar-panel-'));
    control = openControl(dir);
    upsertSuperadmin(control, { name: 'Prueba', email: 'admin@prueba.test', password: 'clave-de-prueba-1' });
    server = createServer(control, { domain: DOMAIN, dataDir: dir, production: false, trustProxy: false });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    await request(ADMIN, 'POST', '/api/admin/login', { email: 'admin@prueba.test', password: 'clave-de-prueba-1' });
    const created = await request(ADMIN, 'POST', '/api/admin/tenants', {
      name: 'Hierros Pérez', slug: 'hierros', barrio: 'Usera', telefono: '611223344', contact_name: 'Pilar', contact_email: 'pilar@hierros.test', trial_days: 0,
    });
    tenant = created.json();
    temp = tenant.owner_access.temp_password;
    await request(ADMIN, 'POST', '/api/admin/tenants', { name: 'Metales Sur', slug: 'metales', barrio: 'Getafe', telefono: '622334455', contact_name: 'Luis', trial_days: 0 });
  });

  after(() => {
    server.close();
    control.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('con correo, el alta da una clave temporal; sin sesión el panel no responde', async () => {
    assert.match(temp, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    assert.equal(tenant.owner.pending, true);
    assert.equal((await request(A, 'GET', '/api/panel/me')).status, 401);
    assert.equal((await request(A, 'GET', '/panel/')).status, 200);
  });

  test('la primera vez obliga a cambiar la clave temporal', async () => {
    assert.equal((await request(A, 'POST', '/api/panel/login', { email: 'pilar@hierros.test', password: 'mal' })).status, 401);
    const login = await request(A, 'POST', '/api/panel/login', { email: 'PILAR@hierros.test', password: temp });
    assert.equal(login.status, 200);
    assert.equal(login.json().must_change, true);
    assert.equal((await request(A, 'PUT', '/api/panel/web', { horario: 'Todo el día' })).status, 403);
    assert.equal((await request(A, 'POST', '/api/panel/password', { current: temp, next: 'corta' })).status, 400);
    assert.equal((await request(A, 'POST', '/api/panel/password', { current: temp, next: 'mi-clave-nueva-1' })).status, 200);
    const saved = await request(A, 'PUT', '/api/panel/web', { horario: 'Lunes a viernes' });
    assert.equal(saved.status, 200);
    assert.match((await request(A, 'GET', '/')).text, /Lunes a viernes/);
  });

  test('su sesión no sirve en el panel de otro cliente', async () => {
    const r = await request(B, 'GET', '/api/panel/me', undefined, { who: A });
    assert.equal(r.status, 401);
  });

  test('sube una foto, se usa de portada y no se puede borrar mientras se usa', async () => {
    assert.equal((await request(A, 'POST', '/api/panel/photos', undefined, { raw: Buffer.from('no soy una foto'.repeat(20)) })).status, 400);
    assert.equal((await request(A, 'POST', '/api/panel/photos', { x: 1 })).status, 415);
    const up = await request(A, 'POST', '/api/panel/photos', undefined, { raw: JPEG });
    assert.equal(up.status, 201, up.text);
    const photo = up.json();
    assert.match(photo.ref, /^fotos\/[a-f0-9]{24}\.jpg$/);

    const img = await request(A, 'GET', `/${photo.ref}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/jpeg');
    assert.equal(img.buf.length, JPEG.length);
    assert.equal((await request(B, 'GET', `/${photo.ref}`)).status, 404);

    // Otro cliente no puede usar fotos ajenas
    const [, other] = (await request(ADMIN, 'GET', '/api/admin/tenants')).json().sort((x, y) => x.id - y.id);
    assert.equal((await request(ADMIN, 'PUT', `/api/admin/tenants/${other.id}/web`, { portada: photo.ref })).status, 400);

    assert.equal((await request(A, 'PUT', '/api/panel/web', { portada: photo.ref, galeria: [{ foto: photo.ref, texto: 'Cobre' }] })).status, 200);
    const site = await request(A, 'GET', '/');
    assert.match(site.text, /href="tema\.css"/);
    assert.match(site.text, /gallery-own/);
    assert.match((await request(A, 'GET', '/tema.css')).text, new RegExp(photo.file));

    assert.equal((await request(A, 'DELETE', `/api/panel/photos/${photo.id}`)).status, 409);
    assert.equal((await request(A, 'PUT', '/api/panel/web', { portada: '', galeria: [] })).status, 200);
    assert.equal((await request(A, 'DELETE', `/api/panel/photos/${photo.id}`)).status, 200);
    assert.equal((await request(A, 'GET', `/${photo.ref}`)).status, 404);
  });

  test('el superadministrador ve sus fotos y le da una clave nueva', async () => {
    const up = await request(ADMIN, 'POST', `/api/admin/tenants/${tenant.id}/photos`, undefined, { raw: JPEG });
    assert.equal(up.status, 201);
    assert.equal((await request(ADMIN, 'GET', `/api/admin/tenants/${tenant.id}/photos`)).json().length, 1);
    assert.equal((await request(ADMIN, 'GET', `/clientes/hierros/${up.json().ref}`)).status, 200);

    const reset = (await request(ADMIN, 'POST', `/api/admin/tenants/${tenant.id}/owner`, {})).json();
    assert.equal(reset.email, 'pilar@hierros.test');
    // La sesión anterior del titular se cierra y la clave vieja deja de valer
    assert.equal((await request(A, 'GET', '/api/panel/me')).status, 401);
    assert.equal((await request(A, 'POST', '/api/panel/login', { email: 'pilar@hierros.test', password: 'mi-clave-nueva-1' })).status, 401);
    assert.equal((await request(A, 'POST', '/api/panel/login', { email: 'pilar@hierros.test', password: reset.temp_password })).status, 200);
  });

  test('suspendido, su panel tampoco funciona; al eliminarlo sus fotos se guardan aparte', async () => {
    await request(ADMIN, 'PATCH', `/api/admin/tenants/${tenant.id}`, { status: 'suspendido' });
    assert.equal((await request(A, 'GET', '/api/panel/me')).status, 403);
    assert.equal((await request(A, 'GET', '/panel/')).status, 403);
    assert.equal((await request(ADMIN, 'DELETE', `/api/admin/tenants/${tenant.id}`, { confirm: 'hierros' })).status, 200);
    const kept = fs.readdirSync(path.join(dir, 'eliminados'));
    assert.equal(kept.length, 1);
    assert.equal(fs.readdirSync(path.join(dir, 'eliminados', kept[0], 'fotos')).length, 1);
    assert.equal(fs.existsSync(path.join(dir, 'clientes', 'hierros')), false);
  });
});
