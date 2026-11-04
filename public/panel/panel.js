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
  const a = st.me.tenant.access;
  view.innerHTML = `${a.state === 'prueba' && a.days_left !== null
    ? `<div class="banner">Estás en el periodo de prueba: ${a.days_left === 0 ? 'termina hoy' : `quedan ${a.days_left} día${a.days_left === 1 ? '' : 's'}`}. Para seguir después, habla con quien te hizo la web.</div>` : ''}
    <div class="news" data-news></div>
    <div data-editor></div>`;
  // Comunicados de la plataforma (mantenimientos, avisos), arriba del todo
  api('/announcements').then((list) => {
    const box = $('[data-news]', view);
    if (!box) return;
    const icon = { mantenimiento: '🛠', aviso: '⚠', novedad: '✨' };
    box.innerHTML = list.map((n) => `<div class="banner"><strong>${icon[n.kind]} ${esc(n.title)}</strong> · ${esc(n.when.charAt(0).toUpperCase() + n.when.slice(1))}
      ${n.body ? `<p>${esc(n.body)}</p>` : ''}</div>`).join('');
  }).catch(() => {});
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

(async () => {
  try { st.me = await api('/me'); enter(); } catch { show('login'); }
})();
