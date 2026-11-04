// Panel del superadministrador: clientes de la plataforma, su estado, su web, sus fotos y el acceso de su titular.
import { $, $$, dateTime, esc, fmtPhone, makeApi, shortDate, toast } from '/shared/ui.js';
import { mountWebEditor } from '/shared/editor.js';

const STATE = { activo: 'Activo', prueba: 'En prueba', prueba_vencida: 'Prueba terminada', suspendido: 'Suspendido' };
const st = { me: null, tenants: [], filter: 'todos', search: '', tab: 'clientes', open: null };
const api = makeApi('/api/admin', () => showLogin());

const initials = (name) => name.split(/\s+/).filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚ]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '◆';
const slugify = (text) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const tenantUrl = (slug, p = '') => `${location.protocol}//${slug}.${st.me.domain}${location.port ? `:${location.port}` : ''}${p}`;

const stateLine = (t) => {
  const a = t.access;
  if (a.state === 'prueba') return a.days_left === null ? 'En prueba' : `Quedan ${a.days_left} día${a.days_left === 1 ? '' : 's'} de prueba`;
  if (a.state === 'prueba_vencida') return `Prueba terminada el ${shortDate(t.trial_ends)}`;
  if (a.state === 'suspendido') return t.suspended_reason || 'Suspendido';
  return t.renews_on ? `Renueva el ${shortDate(t.renews_on)}${a.renewal_due ? ' (vencida)' : ''}` : 'Sin fecha de renovación';
};

/* ---------- Entrar ---------- */

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#loginForm input[name=email]').focus();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const error = $('#loginError');
  error.hidden = true;
  try {
    await api('/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } });
    f.reset();
    await boot();
  } catch (err) { error.textContent = err.message; error.hidden = false; }
});

$('#logout').addEventListener('click', async () => { await api('/logout', { method: 'POST' }).catch(() => {}); showLogin(); });

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  st.tab = b.dataset.tab;
  st.open = null;
  $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  render();
});

async function boot() {
  try { st.me = await api('/me'); } catch { showLogin(); return; }
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#adminName').textContent = st.me.name;
  render();
}

function render() {
  window.scrollTo(0, 0);
  if (st.tab === 'clientes') return st.open ? renderFicha(st.open) : renderTenants();
  if (st.tab === 'comunicados') return renderNews();
  if (st.tab === 'actividad') return renderActivity();
  return renderAccount();
}

/* ---------- Clientes ---------- */

function alertsOf(list) {
  const out = [];
  for (const t of list) {
    const a = t.access;
    if (a.state === 'prueba' && a.days_left !== null && a.days_left <= 7) out.push(['warn', `La prueba de <strong>${esc(t.name)}</strong> termina ${a.days_left === 0 ? 'hoy' : `en ${a.days_left} día${a.days_left === 1 ? '' : 's'}`}.`, t]);
    if (a.state === 'prueba_vencida') out.push(['danger', `La prueba de <strong>${esc(t.name)}</strong> terminó el ${shortDate(t.trial_ends)}: su web está cerrada.`, t]);
    if (a.state === 'activo' && a.renewal_due) out.push(['danger', `La renovación de <strong>${esc(t.name)}</strong> venció el ${shortDate(t.renews_on)}.`, t]);
    else if (a.state === 'activo' && a.days_left !== null && a.days_left <= 7) out.push(['warn', `<strong>${esc(t.name)}</strong> renueva ${a.days_left === 0 ? 'hoy' : `en ${a.days_left} día${a.days_left === 1 ? '' : 's'}`}.`, t]);
    const idle = t.last_seen_at ? (Date.now() - Date.parse(t.last_seen_at)) / 86_400_000 : null;
    if (a.open && (idle === null ? (Date.now() - Date.parse(t.created_at)) / 86_400_000 > 7 : idle > 14)) {
      out.push(['warn', `La web de <strong>${esc(t.name)}</strong> no tiene visitas ${idle === null ? 'desde el alta' : `desde hace ${Math.floor(idle)} días`}.`, t]);
    }
  }
  return out;
}

async function renderTenants() {
  const view = $('#view');
  if (!st.tenants.length) view.innerHTML = '<p class="muted">Cargando…</p>';
  try { st.tenants = await api('/tenants'); } catch (err) { view.innerHTML = `<p class="empty-state">${esc(err.message)}</p>`; return; }
  paintTenants();
}

function paintTenants() {
  const view = $('#view');
  const list = st.tenants;
  const count = (s) => list.filter((t) => (s === 'cerrados' ? !t.access.open : t.access.state === s)).length;
  const visits = list.reduce((s, t) => s + (t.usage?.visits_month ?? 0), 0);
  const alerts = alertsOf(list);
  const q = st.search.toLowerCase();
  const shown = list.filter((t) => (st.filter === 'todos' || (st.filter === 'cerrados' ? !t.access.open : t.access.state === st.filter))
    && (!q || `${t.name} ${t.slug} ${t.contact_name} ${t.contact_email} ${t.web.telefono} ${t.web.barrio}`.toLowerCase().includes(q)));

  view.innerHTML = `
    <div class="pf-head"><h1>Clientes</h1><div class="head-actions">
      <label class="btn ghost">Importar ficha<input type="file" accept=".json,application/json" data-import hidden></label>
      <button class="btn primary" data-new>+ Nuevo cliente</button></div></div>
    <div class="stats">
      <div class="stat"><span>Activos</span><strong>${count('activo')}</strong><small class="muted">de ${list.length} clientes</small></div>
      <div class="stat"><span>En prueba</span><strong>${count('prueba')}</strong><small class="muted">${list.filter((t) => t.access.state === 'prueba' && t.access.days_left !== null && t.access.days_left <= 7).length} terminan esta semana</small></div>
      <div class="stat"><span>Cerrados</span><strong>${count('cerrados')}</strong><small class="muted">suspendidos o prueba terminada</small></div>
      <div class="stat"><span>Visitas este mes</span><strong>${visits}</strong><small class="muted">entre todas sus webs</small></div>
    </div>
    ${alerts.length ? `<div class="pf-alerts">${alerts.map(([k, text, t]) => `<div class="pf-alert ${k}"><span>${text}</span><button class="link" data-open="${t.id}">Ver</button></div>`).join('')}</div>` : ''}
    <div class="pf-filters">
      <input type="search" placeholder="Buscar por nombre, subdominio, teléfono o barrio" value="${esc(st.search)}" data-search aria-label="Buscar cliente">
      ${[['todos', 'Todos'], ['activo', 'Activos'], ['prueba', 'En prueba'], ['cerrados', 'Cerrados']].map(([k, l]) => `<button class="chip-btn ${st.filter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('')}
    </div>
    ${shown.length ? `<div class="tenants">${shown.map((t) => `<button class="tenant ${t.access.state}" data-open="${t.id}">
      <header><span class="ico">${esc(initials(t.web.marca || t.name))}</span><div><h3>${esc(t.name)}</h3><div class="url">${esc(t.slug)}.${esc(st.me.domain)}</div></div></header>
      <span><span class="st ${t.access.state}">${STATE[t.access.state]}</span> <small class="muted">${esc(stateLine(t))}</small></span>
      <div class="meta">
        <div><span>Visitas mes</span><strong>${t.usage.visits_month}</strong></div>
        <div><span>Opiniones</span><strong>${t.usage.reviews}</strong></div>
        <div><span>Fotos</span><strong>${t.photos.length}</strong></div>
      </div>
      <footer><span>${esc(t.contact_name || '—')} · ${esc(fmtPhone(t.web.telefono))}</span>
        <span>${t.owner ? (t.owner.pending ? '<span class="tag warn">clave sin estrenar</span>' : '<span class="tag ok">usa su panel</span>') : 'sin panel'}</span></footer>
    </button>`).join('')}</div>` : `<p class="empty-state">${list.length ? 'Ningún cliente coincide con el filtro.' : 'Todavía no hay clientes. Da de alta el primero con «+ Nuevo cliente».'}</p>`}`;

  $('[data-new]', view).addEventListener('click', newTenant);
  $('[data-import]', view).addEventListener('change', importFicha);
  const search = $('[data-search]', view);
  search.addEventListener('input', () => {
    st.search = search.value;
    paintTenants();
    const again = $('[data-search]');
    again.focus();
    again.setSelectionRange(again.value.length, again.value.length);
  });
  $$('[data-filter]', view).forEach((b) => b.addEventListener('click', () => { st.filter = b.dataset.filter; paintTenants(); }));
  $$('[data-open]', view).forEach((b) => b.addEventListener('click', () => { st.open = Number(b.dataset.open); render(); }));
}

/* ---------- Ventanas ---------- */

function openDialog(html) {
  const dlg = $('#modal');
  dlg.innerHTML = html;
  dlg.showModal();
  $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
  return dlg;
}

// Datos de acceso del titular: se ven una sola vez, con un botón para copiarlos
function showAccess(t, access, title) {
  const panel = tenantUrl(t.slug, '/panel/');
  const dlg = openDialog(`<form method="dialog">
    <div class="dlg-head"><h2>${esc(title)}</h2><button type="button" class="btn ghost small" data-close>Cerrar</button></div>
    <p>Pásale estos datos al titular. La clave es temporal: el panel le pedirá una suya al entrar.</p>
    <div class="access-box">
      <span>Su web: <code>${esc(tenantUrl(t.slug))}</code></span>
      <span>Su panel: <code>${esc(panel)}</code></span>
      <span>Correo: <code>${esc(access.email)}</code></span>
      <span>Clave temporal: <code>${esc(access.temp_password)}</code></span>
    </div>
    <p class="muted small">No se volverá a mostrar. Si la pierde, dale otra desde su ficha.</p>
    <div class="dlg-foot"><button type="button" class="btn primary" data-copy>Copiar los datos</button></div>
  </form>`);
  $('[data-copy]', dlg).addEventListener('click', async () => {
    const text = `${t.name}\nWeb: ${tenantUrl(t.slug)}\nPanel: ${panel}\nCorreo: ${access.email}\nClave temporal: ${access.temp_password}\n(La cambiarás al entrar la primera vez.)`;
    try { await navigator.clipboard.writeText(text); toast('Datos copiados'); } catch { toast('No se pudo copiar: selecciónalos a mano', 'error'); }
  });
}

// Alta desde una ficha exportada en otra instalación (por ejemplo, la demo de tu ordenador)
async function importFicha(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let ficha;
  try { ficha = JSON.parse(await file.text()); } catch { toast('Ese archivo no es una ficha válida', 'error'); return; }
  const slug = window.prompt(`Subdominio para «${ficha.name ?? 'el cliente'}» (su web quedará en <subdominio>.${st.me.domain}):`, ficha.slug ?? '');
  if (slug === null) return;
  // El correo de la ficha puede ser de otra instalación (la demo): se confirma aquí. Vacío = sin panel por ahora.
  const email = window.prompt(`Correo real del titular, para entrar en su panel (vacío = darle acceso más tarde):`, ficha.contact_email ?? '');
  if (email === null) return;
  try {
    const t = await api('/tenants/import', { method: 'POST', body: { ficha, slug: slugify(slug), contact_email: email.trim() } });
    toast(`${t.name} importado`);
    st.tenants = [t, ...st.tenants];
    st.open = t.id;
    render();
    if (t.owner_access) showAccess(t, t.owner_access, 'Cliente importado');
  } catch (err) { toast(err.message, 'error'); }
}

async function exportFicha(t) {
  try {
    const ficha = await api(`/tenants/${t.id}/ficha`);
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([JSON.stringify(ficha, null, 2)], { type: 'application/json' })),
      download: `ficha-${t.slug}.json`,
    });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Ficha descargada');
  } catch (err) { toast(err.message, 'error'); }
}

function newTenant() {
  const dlg = openDialog(`<form method="dialog" novalidate>
    <div class="dlg-head"><h2>Nuevo cliente</h2><button type="button" class="btn ghost small" data-close>Cerrar</button></div>
    <div class="form-grid">
      <label class="field full"><span>Nombre del negocio</span><input name="name" required maxlength="80" placeholder="Chatarrería Martínez" autofocus></label>
      <label class="field"><span>Subdominio</span><input name="slug" required maxlength="40" placeholder="chatarreriamartinez"></label>
      <label class="field"><span>Barrio o municipio</span><input name="barrio" required maxlength="40" placeholder="Vallecas"></label>
      <p class="muted small full" data-preview></p>
      <label class="field"><span>Teléfono principal (web y WhatsApp)</span><input name="telefono" type="tel" required maxlength="20"></label>
      <label class="field"><span>Segundo teléfono (opcional)</span><input name="telefono2" type="tel" maxlength="20"></label>
      <label class="field"><span>Nombre del titular</span><input name="contact_name" required maxlength="80"></label>
      <label class="field"><span>Correo del titular <small>(para entrar en su panel)</small></span><input name="contact_email" type="email" maxlength="120"></label>
      <label class="field"><span>Días de prueba <small>(0 = activo directamente)</small></span><input name="trial_days" type="number" min="0" max="365" value="30" required></label>
      <label class="field"><span>Razón social (opcional)</span><input name="company_name" maxlength="120"></label>
      <label class="field"><span>NIF (opcional)</span><input name="tax_id" maxlength="20"></label>
      <label class="field full"><span>Notas internas</span><textarea name="notes" maxlength="1000" rows="2"></textarea></label>
    </div>
    <p class="muted small">Con correo, el titular recibe ya su acceso al panel para editar su web. Sin correo, se lo puedes dar luego desde su ficha.</p>
    <p class="form-error" data-error hidden></p>
    <div class="dlg-foot"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary" value="ok">Dar de alta</button></div>
  </form>`);
  const form = $('form', dlg);
  let touched = false;
  const preview = () => { $('[data-preview]', form).innerHTML = form.slug.value ? `Su web: <strong>${esc(tenantUrl(form.slug.value))}</strong>` : ''; };
  form.name.addEventListener('input', () => { if (!touched) { form.slug.value = slugify(form.name.value); preview(); } });
  form.slug.addEventListener('input', () => { touched = true; form.slug.value = slugify(form.slug.value); preview(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('[data-error]', form);
    error.hidden = true;
    const button = $('button[value=ok]', form);
    button.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      body.trial_days = Number(body.trial_days);
      const t = await api('/tenants', { method: 'POST', body });
      dlg.close();
      toast(`${t.name} dado de alta`);
      st.tenants = [t, ...st.tenants];
      st.open = t.id;
      render();
      if (t.owner_access) showAccess(t, t.owner_access, 'Cliente dado de alta');
    } catch (err) { error.textContent = err.message; error.hidden = false; } finally { button.disabled = false; }
  });
}

/* ---------- Ficha de un cliente ---------- */

async function renderFicha(id) {
  const view = $('#view');
  let t = st.tenants.find((x) => x.id === id);
  if (!t) {
    st.tenants = await api('/tenants');
    t = st.tenants.find((x) => x.id === id);
    if (!t) { st.open = null; render(); return; }
  }
  const plus = (days) => { const d = new Date(`${st.me.today}T12:00:00`); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
  const owner = t.owner;

  view.innerHTML = `
    <button class="link back" data-back>← Todos los clientes</button>
    <div class="ficha-head">
      <div>
        <h1>${esc(t.name)}</h1>
        <div class="url">${esc(tenantUrl(t.slug))} · <span class="st ${t.access.state}">${STATE[t.access.state]}</span> <span class="muted small">${esc(stateLine(t))}</span></div>
      </div>
      <div class="actions">
        <a class="btn ghost small" href="${esc(tenantUrl(t.slug))}" target="_blank" rel="noopener">Abrir su web</a>
        <a class="btn ghost small" href="${esc(tenantUrl(t.slug, '/cartel.html'))}" target="_blank" rel="noopener">Su cartel</a>
        <button type="button" class="btn ghost small" data-export>Exportar ficha</button>
      </div>
    </div>

    <div class="ficha">
      <div data-editor></div>

      <div class="ficha-side">
        <section class="panel">
          <h2>Estado</h2>
          <div class="status-actions">
            <div class="row"><label class="field"><span>Activo, renueva el</span><input name="renews_on" type="date" value="${esc(t.renews_on ?? plus(365))}"></label>
              <button type="button" class="btn primary small" data-status="activo">${t.status === 'activo' ? 'Actualizar' : 'Activar'}</button></div>
            <div class="row"><label class="field"><span>En prueba hasta</span><input name="trial_ends" type="date" value="${esc(t.trial_ends ?? plus(30))}"></label>
              <button type="button" class="btn ghost small" data-status="prueba">${t.status === 'prueba' ? 'Cambiar fecha' : 'Poner en prueba'}</button></div>
            <div class="row"><label class="field"><span>Motivo de la suspensión</span><input name="suspended_reason" value="${esc(t.suspended_reason)}" maxlength="200" placeholder="Pago pendiente, baja…"></label>
              <button type="button" class="btn danger small" data-status="suspendido">Suspender</button></div>
            <p class="muted small">Suspendido o con la prueba terminada, su web y su panel muestran un aviso. Su ficha y sus fotos se conservan: al activarlo, todo vuelve como estaba.</p>
          </div>
        </section>

        <section class="panel">
          <h2>Panel del titular</h2>
          <div class="owner-line">
            ${owner ? `<span><strong>${esc(owner.name)}</strong> · ${esc(owner.email)}</span>
              <span>${owner.pending ? '<span class="tag warn">Clave temporal sin estrenar</span>' : `<span class="tag ok">Activo</span> <span class="muted small">Último acceso: ${dateTime(owner.last_login_at)}</span>`}</span>`
              : '<span class="muted">Todavía no tiene acceso a su panel.</span>'}
          </div>
          <div class="head-actions">
            <button type="button" class="btn ${owner ? 'ghost' : 'primary'} small" data-owner>${owner ? 'Clave nueva para el titular' : 'Dar acceso a su panel'}</button>
            <a class="btn ghost small" href="${esc(tenantUrl(t.slug, '/panel/'))}" target="_blank" rel="noopener">Abrir su panel</a>
          </div>
        </section>

        <section class="panel">
          <h2>Uso este mes</h2>
          <div class="usage">
            <div><span>Visitas</span><strong>${t.usage.visits_month}</strong></div>
            <div><span>Opiniones</span><strong>${t.usage.reviews}</strong></div>
            <div><span>Fotos</span><strong>${t.photos.length}</strong></div>
          </div>
          <p class="muted small mt">Alta: ${dateTime(t.created_at)} · Última visita: ${dateTime(t.last_seen_at)}</p>
        </section>

        <form class="panel" data-datos novalidate>
          <h2>Datos del cliente</h2>
          <div class="form-grid">
            <label class="field full"><span>Nombre del negocio</span><input name="name" value="${esc(t.name)}" maxlength="80" required></label>
            <label class="field"><span>Titular</span><input name="contact_name" value="${esc(t.contact_name)}" maxlength="80"></label>
            <label class="field"><span>Teléfono de contacto</span><input name="contact_phone" type="tel" value="${esc(fmtPhone(t.contact_phone))}" maxlength="20"></label>
            <label class="field full"><span>Correo</span><input name="contact_email" type="email" value="${esc(t.contact_email)}" maxlength="120"></label>
            <label class="field"><span>Razón social</span><input name="company_name" value="${esc(t.company_name)}" maxlength="120"></label>
            <label class="field"><span>NIF</span><input name="tax_id" value="${esc(t.tax_id)}" maxlength="20"></label>
            <label class="field full"><span>Notas internas</span><textarea name="notes" rows="3" maxlength="1000">${esc(t.notes)}</textarea></label>
          </div>
          <div class="save"><button class="btn primary small">Guardar datos</button></div>
        </form>

        ${t.status === 'suspendido' ? `<section class="panel danger-zone">
          <h2>Eliminar cliente</h2>
          <p class="muted small">Desaparece de tu lista y su dirección queda libre. Su ficha y sus fotos se guardan aparte por si hubiera que recuperarlas.</p>
          <button type="button" class="btn danger small" data-delete>Eliminar a ${esc(t.name)}</button>
        </section>` : ''}
      </div>
    </div>`;

  const replace = (updated) => { st.tenants = st.tenants.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)); };
  $('[data-back]', view).addEventListener('click', () => { st.open = null; render(); });
  $('[data-export]', view).addEventListener('click', () => exportFicha(t));

  mountWebEditor($('[data-editor]', view), {
    web: t.web,
    photos: t.photos,
    sharedPhotos: st.me.photos,
    photoUrl: (ref) => (ref.startsWith('fotos/') ? `/clientes/${t.slug}/${ref}` : `/web-${ref}`),
    save: async (body) => replace(await api(`/tenants/${t.id}/web`, { method: 'PUT', body })),
    upload: async (blob) => {
      const p = await api(`/tenants/${t.id}/photos`, { method: 'POST', photo: blob });
      replace({ id: t.id, photos: [p, ...(st.tenants.find((x) => x.id === t.id)?.photos ?? [])] });
      return p;
    },
    remove: async (p) => {
      await api(`/tenants/${t.id}/photos/${p.id}`, { method: 'DELETE' });
      replace({ id: t.id, photos: (st.tenants.find((x) => x.id === t.id)?.photos ?? []).filter((x) => x.id !== p.id) });
    },
  });

  // Estado
  $$('[data-status]', view).forEach((b) => b.addEventListener('click', async () => {
    const status = b.dataset.status;
    const body = { status };
    if (status === 'activo') body.renews_on = $('[name=renews_on]', view).value || null;
    if (status === 'prueba') body.trial_ends = $('[name=trial_ends]', view).value;
    if (status === 'suspendido') {
      body.suspended_reason = $('[name=suspended_reason]', view).value;
      if (!window.confirm(`¿Suspender a ${t.name}? Su web y su panel mostrarán «Servicio suspendido» hasta que lo actives.`)) return;
    }
    try {
      const updated = await api(`/tenants/${t.id}`, { method: 'PATCH', body });
      replace(updated);
      toast(`${t.name}: ${STATE[updated.access.state].toLowerCase()}`);
      renderFicha(t.id);
    } catch (err) { toast(err.message, 'error'); }
  }));

  // Acceso del titular
  $('[data-owner]', view).addEventListener('click', async () => {
    // El correo que esté escrito ahora en «Datos del cliente», aunque aún no se haya guardado
    let email = $('[data-datos]', view).contact_email.value.trim();
    if (!email) {
      email = window.prompt(`Correo del titular de ${t.name} (con él entrará en su panel):`, '');
      if (!email) return;
    } else if (!window.confirm(owner
      ? `¿Dar una clave nueva al titular de ${t.name} para entrar con ${email}? La anterior dejará de funcionar y se cerrarán sus sesiones.`
      : `¿Dar acceso a su panel a ${email}?`)) return;
    try {
      const access = await api(`/tenants/${t.id}/owner`, { method: 'POST', body: { email } });
      st.tenants = await api('/tenants');
      renderFicha(t.id);
      showAccess(t, access, owner ? 'Clave nueva para el titular' : 'Acceso a su panel');
    } catch (err) { toast(err.message, 'error'); }
  });

  // Datos del cliente
  const datos = $('[data-datos]', view);
  datos.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const updated = await api(`/tenants/${t.id}`, { method: 'PATCH', body: Object.fromEntries(new FormData(datos)) });
      replace(updated);
      toast('Datos guardados');
      $('.ficha-head h1', view).textContent = updated.name;
    } catch (err) { toast(err.message, 'error'); }
  });

  $('[data-delete]', view)?.addEventListener('click', async () => {
    const typed = window.prompt(`Vas a eliminar a «${t.name}». Para confirmar, escribe su subdominio: ${t.slug}`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== t.slug) { toast('No coincide con el subdominio: no se ha eliminado nada', 'error'); return; }
    try {
      await api(`/tenants/${t.id}`, { method: 'DELETE', body: { confirm: typed } });
      st.tenants = st.tenants.filter((x) => x.id !== t.id);
      st.open = null;
      toast(`${t.name} eliminado. Su ficha queda guardada aparte.`);
      render();
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ---------- Comunicados (por WhatsApp) ---------- */

const NEWS = { mantenimiento: ['🛠', 'Mantenimiento'], aviso: ['⚠', 'Aviso'], novedad: ['✨', 'Novedad'] };
const localInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function renderNews() {
  const view = $('#view');
  const list = await api('/announcements');
  const now = Date.now();
  const stateOf = (n) => (n.cancelled_at ? ['Retirado', 'off'] : Date.parse(n.ends_at) <= now ? ['Pasado', 'off'] : ['Vigente', 'on']);
  view.innerHTML = `<div class="pf-head"><h1>Comunicados</h1><button class="btn primary" data-new-news>+ Nuevo comunicado</button></div>
    <p class="muted">Los comunicados se mandan por WhatsApp. Cada uno tiene la lista de tus clientes: pulsa <strong>Enviar</strong>
      y se abre WhatsApp en su número con el mensaje ya escrito, con su nombre. Aquí queda apuntado a quién se lo has mandado.</p>
    ${list.length ? `<div class="pf-news">${list.map((n) => {
      const [label, cls] = stateOf(n);
      const sent = n.recipients.filter((r) => r.sent_at).length;
      return `<article class="panel pf-news-item ${cls}" data-news="${n.id}">
        <div><span class="st ${cls === 'on' ? 'activo' : 'suspendido'}">${label}</span> <strong>${NEWS[n.kind][0]} ${esc(n.title)}</strong>
          <span class="tag ${sent === n.recipients.length && sent ? 'ok' : 'warn'}">Enviado a ${sent} de ${n.recipients.length}</span>
          <p class="muted small">${n.kind === 'mantenimiento' ? `${esc(capital(n.when))} · ` : ''}preparado ${dateTime(n.created_at)}${n.admin_name ? ` por ${esc(n.admin_name)}` : ''}</p>
          ${n.body ? `<p>${esc(n.body)}</p>` : ''}</div>
        <div class="head-actions">
          <button class="btn ghost small" data-toggle-sends>${cls === 'on' ? 'Enviar por WhatsApp' : 'Ver envíos'}</button>
          ${cls === 'on' ? '<button class="btn danger small" data-cancel-news>Retirar</button>' : ''}
        </div>
        <div class="sends" data-sends hidden>
          <h4>Mensaje (lleva el nombre de cada cliente)</h4>
          <pre class="preview">${esc(n.recipients[0]?.message ?? '')}</pre>
          <h4>Clientes</h4>
          ${n.recipients.length ? n.recipients.map((r) => `<div class="send-row">
            <span class="who"><strong>${esc(r.name)}</strong><small>${esc(r.contact_name || '—')} · ${esc(fmtPhone(r.phone) || 'sin teléfono')} · ${STATE[r.state]}</small></span>
            ${r.sent_at ? `<span class="tag ok">✓ Enviado ${dateTime(r.sent_at)}</span>` : ''}
            ${r.whatsapp_url && cls === 'on'
              ? `<a class="btn ${r.sent_at ? 'ghost' : 'wa'} small" href="${esc(r.whatsapp_url)}" target="_blank" rel="noopener" data-send="${r.tenant_id}">${r.sent_at ? 'Enviar otra vez' : 'Enviar'}</a>`
              : ''}
          </div>`).join('') : '<p class="muted small">Todavía no tienes clientes.</p>'}
        </div>
      </article>`;
    }).join('')}</div>` : '<p class="empty-state">Todavía no has preparado ningún comunicado.</p>'}`;

  $('[data-new-news]', view).addEventListener('click', newNews);
  $$('[data-news]', view).forEach((card) => {
    const id = Number(card.dataset.news);
    $('[data-toggle-sends]', card).addEventListener('click', () => { const s = $('[data-sends]', card); s.hidden = !s.hidden; });
    $('[data-cancel-news]', card)?.addEventListener('click', async () => {
      if (!window.confirm('¿Retirar este comunicado? Ya no podrás enviarlo desde aquí.')) return;
      try { await api(`/announcements/${id}/cancel`, { method: 'POST' }); toast('Comunicado retirado'); renderNews(); } catch (err) { toast(err.message, 'error'); }
    });
    // El enlace abre WhatsApp (lo hace el navegador); a la vez se apunta como enviado
    $$('[data-send]', card).forEach((a) => a.addEventListener('click', () => {
      api(`/announcements/${id}/sent`, { method: 'POST', body: { tenant_id: Number(a.dataset.send) } })
        .then(() => {
          const row = a.closest('.send-row');
          if (!row.querySelector('.tag.ok')) a.insertAdjacentHTML('beforebegin', '<span class="tag ok">✓ Enviado ahora</span>');
          a.className = 'btn ghost small';
          a.textContent = 'Enviar otra vez';
        })
        .catch((err) => toast(err.message, 'error'));
    }));
  });
}

function newNews() {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(2, 0, 0, 0);
  const until = new Date(tomorrow); until.setHours(4);
  const month = new Date(); month.setDate(month.getDate() + 30); month.setHours(23, 59, 0, 0);
  const dlg = openDialog(`<form method="dialog" novalidate>
    <div class="dlg-head"><h2>Nuevo comunicado</h2><button type="button" class="btn ghost small" data-close>Cerrar</button></div>
    <div class="form-grid">
      <label class="field full"><span>Tipo</span><select name="kind">
        <option value="mantenimiento">🛠 Mantenimiento (con día y hora)</option><option value="aviso">⚠ Aviso</option><option value="novedad">✨ Novedad</option></select></label>
      <label class="field full"><span>Título</span><input name="title" value="Mantenimiento programado de tu web" required maxlength="120"></label>
      <label class="field full"><span>Mensaje</span><textarea name="body" rows="3" maxlength="1000">Durante ese rato tu web puede no estar disponible unos minutos. No tienes que hacer nada; si después ves algo raro, avísame.</textarea></label>
      <label class="field" data-when-maint><span>Empieza</span><input name="starts_at" type="datetime-local" value="${localInput(tomorrow)}"></label>
      <label class="field" data-when-maint><span>Termina</span><input name="ends_at_m" type="datetime-local" value="${localInput(until)}"></label>
      <label class="field full" data-when-other hidden><span>Se puede enviar hasta</span><input name="ends_at_o" type="datetime-local" value="${localInput(month)}"></label>
    </div>
    <p class="muted small">Al guardarlo, en su tarjeta tendrás la lista de clientes con el botón «Enviar» de cada uno.</p>
    <p class="form-error" data-error hidden></p>
    <div class="dlg-foot"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary" value="ok">Preparar el envío</button></div>
  </form>`);
  const form = $('form', dlg);
  const sync = () => {
    const maint = form.kind.value === 'mantenimiento';
    $$('[data-when-maint]', form).forEach((el) => { el.hidden = !maint; });
    $('[data-when-other]', form).hidden = maint;
  };
  form.kind.addEventListener('change', () => {
    sync();
    if (form.kind.value !== 'mantenimiento' && form.title.value === 'Mantenimiento programado de tu web') { form.title.value = ''; form.body.value = ''; }
  });
  sync();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('[data-error]', form);
    error.hidden = true;
    const maint = form.kind.value === 'mantenimiento';
    const iso = (value) => (value ? new Date(value).toISOString() : '');
    try {
      const created = await api('/announcements', { method: 'POST', body: {
        kind: form.kind.value, title: form.title.value, body: form.body.value,
        starts_at: maint ? iso(form.starts_at.value) : null,
        ends_at: iso(maint ? form.ends_at_m.value : form.ends_at_o.value),
      } });
      dlg.close();
      toast('Comunicado listo: ahora envíaselo a cada cliente');
      await renderNews();
      const card = $(`[data-news="${created.id}"]`);
      if (card) $('[data-sends]', card).hidden = false;
    } catch (err) { error.textContent = err.message; error.hidden = false; }
  });
}

/* ---------- Actividad y cuenta ---------- */

async function renderActivity() {
  const view = $('#view');
  const rows = await api('/activity');
  view.innerHTML = `<div class="pf-head"><h1>Actividad</h1></div>
    ${rows.length ? `<div class="panel pf-log">${rows.map((r) => `<div class="act"><time>${dateTime(r.at)}</time>
      <span>${esc(r.summary)}${r.admin_name ? ` <small class="muted">· ${esc(r.admin_name)}</small>` : ''}</span></div>`).join('')}</div>` : '<p class="empty-state">Sin actividad todavía.</p>'}`;
}

function renderAccount() {
  const view = $('#view');
  view.innerHTML = `<div class="pf-head"><h1>Mi cuenta</h1></div>
    <form class="panel account" data-pass>
      <h2>Cambiar contraseña</h2>
      <p class="muted small">${esc(st.me.name)} · ${esc(st.me.email)}</p>
      <label class="field"><span>Contraseña actual</span><input name="current" type="password" required autocomplete="current-password"></label>
      <label class="field"><span>Nueva contraseña (mínimo 10 caracteres)</span><input name="next" type="password" required minlength="10" autocomplete="new-password"></label>
      <div><button class="btn primary small">Guardar contraseña</button></div>
    </form>`;
  $('[data-pass]', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    try {
      await api('/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
      toast('Contraseña cambiada. Se han cerrado tus otras sesiones.');
      f.reset();
    } catch (err) { toast(err.message, 'error'); }
  });
}

boot();
