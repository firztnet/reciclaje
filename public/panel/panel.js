// Panel del titular: entra con su correo, elige su clave la primera vez y edita su propia web y sus fotos.
import { $, $$, esc, makeApi, shortDate, toast } from '/shared/ui.js';
import { mountWebEditor } from '/shared/editor.js';

const st = { me: null, tab: 'web' };
const api = makeApi('/api/panel', () => show('login'));

function show(screen) {
  for (const id of ['login', 'first', 'app']) $(`#${id}`).hidden = id !== screen;
  const focus = { login: '#loginForm input[name=email]', first: '#firstForm input[name=current]' }[screen];
  if (focus) $(focus).focus();
}

const setBusiness = (name) => {
  $$('[data-business]').forEach((el) => { el.textContent = name; });
  document.title = `Mi panel · ${name}`;
};

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const error = $('#loginError');
  error.hidden = true;
  try {
    st.me = await api('/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } });
    f.reset();
    enter();
  } catch (err) { error.textContent = err.message; error.hidden = false; }
});

$('#firstForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const error = $('#firstError');
  error.hidden = true;
  if (f.next.value !== f.again.value) { error.textContent = 'Las dos contraseñas nuevas no coinciden'; error.hidden = false; return; }
  try {
    await api('/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
    f.reset();
    st.me = await api('/me');
    toast('Contraseña guardada. ¡Bienvenido a tu panel!');
    enter();
  } catch (err) { error.textContent = err.message; error.hidden = false; }
});

$('#logout').addEventListener('click', async () => { await api('/logout', { method: 'POST' }).catch(() => {}); show('login'); });

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  st.tab = b.dataset.tab;
  $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  render();
});

function enter() {
  setBusiness(st.me.tenant.name);
  if (st.me.must_change) { show('first'); return; }
  show('app');
  render();
}

function render() {
  window.scrollTo(0, 0);
  const view = $('#view');
  if (st.tab === 'cuenta') return renderAccount(view);
  if (st.tab === 'ayuda') return renderHelp(view);
  const a = st.me.tenant.access;
  view.innerHTML = `${a.state === 'prueba' && a.days_left !== null
    ? `<div class="banner">Estás en el periodo de prueba: ${a.days_left === 0 ? 'termina hoy' : `quedan ${a.days_left} día${a.days_left === 1 ? '' : 's'}`}. Para seguir después, habla con quien te hizo la web.</div>` : ''}
    <div data-editor></div>`;
  mountWebEditor($('[data-editor]', view), {
    web: st.me.web,
    photos: st.me.photos,
    sharedPhotos: st.me.shared_photos,
    intro: 'Cambia lo que quieras y pulsa «Guardar la web» abajo del todo. Puedes subir fotos desde el móvil.',
    photoUrl: (ref) => `/${ref}`,
    save: async (body) => { st.me.web = (await api('/web', { method: 'PUT', body })).web; },
    upload: async (blob) => {
      const p = await api('/photos', { method: 'POST', photo: blob });
      st.me.photos = [p, ...st.me.photos];
      return p;
    },
    remove: async (p) => {
      await api(`/photos/${p.id}`, { method: 'DELETE' });
      st.me.photos = st.me.photos.filter((x) => x.id !== p.id);
    },
  });
}

function renderAccount(view) {
  const a = st.me.tenant.access;
  view.innerHTML = `<div class="pf-head"><h1>Mi cuenta</h1></div>
    <form class="panel account" data-pass>
      <h2>Cambiar contraseña</h2>
      <p class="muted small">${esc(st.me.name)} · ${esc(st.me.email)}</p>
      <label class="field"><span>Contraseña actual</span><input name="current" type="password" required autocomplete="current-password"></label>
      <label class="field"><span>Nueva contraseña (mínimo 10 caracteres)</span><input name="next" type="password" required minlength="10" autocomplete="new-password"></label>
      <div><button class="btn primary small">Guardar contraseña</button></div>
    </form>
    <p class="muted small mt">Tu servicio: ${a.state === 'prueba' ? `en prueba hasta el ${shortDate(st.me.tenant.trial_ends)}` : 'activo'}.</p>`;
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

/* ---------- Pedir ayuda a Firztnet ---------- */

const HELP_TYPES = [['web', '🌐', 'Mi web'], ['fotos', '📷', 'Fotos'], ['acceso', '🔑', 'No puedo entrar'], ['datos', '✏️', 'Cambiar datos'], ['otro', '💬', 'Otra cosa']];
const HELP_STATE = { nueva: ['Recibida', 'new'], en_curso: ['En marcha', 'doing'], resuelta: ['Resuelta', 'done'] };
const when = (iso) => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function renderHelp(view) {
  view.innerHTML = '<p class="muted">Cargando…</p>';
  let data = { enabled: false, requests: [] };
  try { data = await api('/ayuda'); } catch (err) { view.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; return; }
  if (!data.enabled) {
    view.innerHTML = '<div class="pf-head"><h1>Pedir ayuda</h1></div><div class="panel"><p>La ayuda desde el panel todavía no está activada. Llama o escribe a quien te hizo la web y te atendemos.</p></div>';
    return;
  }
  view.innerHTML = `<div class="pf-head"><h1>Pedir ayuda</h1></div>
    <form class="panel help-form" data-help>
      <p class="muted small">Cuéntanos qué necesitas y te contestamos lo antes posible. La respuesta te aparece aquí mismo.</p>
      ${data.offline ? '<p class="banner">Ahora no se pueden ver tus peticiones anteriores, pero puedes enviar una nueva.</p>' : ''}
      <div class="help-types">${HELP_TYPES.map(([id, ico, label], i) => `<label class="help-type"><input type="radio" name="type" value="${id}" ${i === 0 ? 'checked' : ''}><span><b>${ico}</b>${label}</span></label>`).join('')}</div>
      <label class="field"><span>Cuéntanos qué pasa</span><textarea name="message" rows="3" maxlength="1000" required placeholder="Por ejemplo: quiero cambiar el teléfono de la web y añadir una foto nueva"></textarea></label>
      <label class="field"><span>Teléfono para llamarte</span><input name="phone" type="tel" maxlength="30"></label>
      <label class="help-urgent"><input type="checkbox" name="urgent"> <span><strong>Es urgente</strong> · la web no funciona o no puedo trabajar</span></label>
      <div><button class="btn primary">Enviar a Firztnet</button></div>
    </form>
    ${data.requests.length ? `<div class="panel help-history"><h2>Tus peticiones</h2>${data.requests.map((r) => {
      const [label, cls] = HELP_STATE[r.estado] ?? HELP_STATE.nueva;
      return `<article class="help-item"><div class="help-item-top"><strong>${esc(r.referencia)}</strong><span class="help-state ${cls}">${label}</span></div>
        <p>${esc(r.mensaje)}</p><small class="muted">${when(r.fecha)}</small>
        ${r.respuesta ? `<div class="help-answer"><span>Firztnet responde</span>${esc(r.respuesta)}</div>` : ''}</article>`;
    }).join('')}</div>` : ''}`;
  $('[data-help]', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const button = $('button.primary', f);
    button.disabled = true;
    try {
      const res = await api('/ayuda', { method: 'POST', body: { type: f.type.value, message: f.message.value, phone: f.phone.value, urgent: f.urgent.checked } });
      toast(`Firztnet ya tiene tu petición ${res.referencia}. Te contestaremos lo antes posible.`);
      renderHelp(view);
    } catch (err) { toast(err.message, 'error'); button.disabled = false; }
  });
}

(async () => {
  try { st.me = await api('/me'); enter(); } catch { show('login'); }
})();
