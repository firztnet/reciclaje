// Editor de la web de una chatarrería, el mismo en el panel del superadministrador y en el del titular:
// fotos propias, portada y galería, datos, servicios, zonas, Google, opiniones y trabajos.
import { $, $$, esc, fmtPhone, prepareJpeg, toast } from './ui.js';

const chk = (name, label, on) => `<label class="check"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}> ${label}</label>`;
const zonesText = (zonas) => zonas.map((g) => `${g.titulo}: ${g.lista.join(', ')}`).join('\n');

/**
 * @param {HTMLElement} container
 * @param {{ web, photos, sharedPhotos, photoUrl: (ref) => string, save: (body) => Promise, upload: (blob) => Promise, remove: (photo) => Promise, intro?: string }} o
 */
export function mountWebEditor(container, o) {
  const w = o.web;
  let own = [...o.photos].sort((a, b) => a.id - b.id);
  const ownLabel = (p) => `Foto propia ${own.indexOf(p) + 1}`;
  const sharedLabel = (ref) => `Muestra · ${ref.replace('img/', '').replace('.jpg', '')}`;
  const options = (selected, allowEmpty) => `${allowEmpty ? `<option value="">${esc(allowEmpty)}</option>` : ''}
    ${own.length ? `<optgroup label="Fotos propias">${own.map((p) => `<option value="${esc(p.ref)}" ${p.ref === selected ? 'selected' : ''}>${esc(ownLabel(p))}</option>`).join('')}</optgroup>` : ''}
    <optgroup label="Fotos de muestra">${o.sharedPhotos.map((r) => `<option value="${esc(r)}" ${r === selected ? 'selected' : ''}>${esc(sharedLabel(r))}</option>`).join('')}</optgroup>`;
  const picker = (k, value, allowEmpty = '') => `<div class="picker"><img class="thumb" alt="" ${value ? `src="${esc(o.photoUrl(value))}"` : 'hidden'}>
    <select data-k="${k}" data-photo data-empty="${esc(allowEmpty)}">${options(value, allowEmpty)}</select></div>`;

  const reviewRow = (r = { nombre: '', estrellas: 5, texto: '' }) => `<div class="row-item review" data-row>
    <div class="row-top">
      <label class="field"><span>Nombre</span><input data-k="nombre" value="${esc(r.nombre)}" maxlength="60" placeholder="Ana G."></label>
      <label class="field"><span>Estrellas</span><select data-k="estrellas">${[5, 4, 3, 2, 1].map((n) => `<option ${n === r.estrellas ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <button type="button" class="btn danger small remove" data-remove>Quitar</button>
    </div>
    <label class="field"><span>Lo que dijo</span><textarea data-k="texto" rows="2" maxlength="1200">${esc(r.texto)}</textarea></label>
  </div>`;
  const jobRow = (j = { foto: own.at(-1)?.ref ?? o.sharedPhotos[0], titulo: '', zona: '', texto: '' }) => `<div class="row-item job" data-row>
    <div class="row-top">
      <label class="field"><span>Foto</span>${picker('foto', j.foto)}</label>
      <label class="field"><span>Qué se hizo</span><input data-k="titulo" value="${esc(j.titulo)}" maxlength="80"></label>
      <label class="field"><span>Zona</span><input data-k="zona" value="${esc(j.zona)}" maxlength="40"></label>
      <button type="button" class="btn danger small remove" data-remove>Quitar</button>
    </div>
    <label class="field"><span>Descripción (opcional)</span><input data-k="texto" value="${esc(j.texto)}" maxlength="200"></label>
  </div>`;
  const galleryRow = (g = { foto: own.at(-1)?.ref ?? o.sharedPhotos[0], texto: '' }) => `<div class="row-item gal" data-row>
    <div class="row-top">
      <label class="field"><span>Foto</span>${picker('foto', g.foto)}</label>
      <label class="field"><span>Pie de foto (opcional)</span><input data-k="texto" value="${esc(g.texto)}" maxlength="40" placeholder="Cobre"></label>
      <button type="button" class="btn danger small remove" data-remove>Quitar</button>
    </div>
  </div>`;
  const ROWS = { opiniones: reviewRow, trabajos: jobRow, galeria: galleryRow };
  const LIMIT = { opiniones: 40, trabajos: 20, galeria: 6 };

  container.innerHTML = `<form class="panel" data-web novalidate>
    <h2>Su web</h2>
    ${o.intro ? `<p class="muted small">${o.intro}</p>` : ''}

    <h3>Fotos propias <span class="count" data-photo-count></span></h3>
    <p class="muted small">Se reducen y se limpian en el propio navegador antes de subir (sin la ubicación del móvil). Úsalas abajo en la portada, la galería o los trabajos.</p>
    <div class="photo-grid" data-photo-grid></div>
    <p class="muted small" data-upload-state hidden></p>

    <h3>Portada y galería</h3>
    <div class="form-grid">
      <label class="field full"><span>Foto de portada</span>${picker('portada', w.portada, 'La de muestra (grúa y camión)')}</label>
    </div>
    <p class="muted small mt">Galería de «Qué recogemos» <span class="count" data-count="galeria"></span>: sin fotos aquí se ven las de muestra.</p>
    <div class="rows" data-rows="galeria">${w.galeria.map(galleryRow).join('')}</div>
    <button type="button" class="btn ghost small mt" data-add="galeria">+ Añadir foto a la galería</button>

    <h3>Nombre y zona</h3>
    <div class="form-grid">
      <label class="field"><span>Nombre corto (cabecera)</span><input name="marca" value="${esc(w.marca)}" maxlength="40" required></label>
      <label class="field"><span>Segunda línea (opcional)</span><input name="lema" value="${esc(w.lema)}" maxlength="60" placeholder="de Madrid y de Hortaleza"></label>
      <label class="field"><span>Barrio o municipio</span><input name="barrio" value="${esc(w.barrio)}" maxlength="40" required></label>
      <label class="field"><span>Ciudad</span><input name="ciudad" value="${esc(w.ciudad)}" maxlength="40" required></label>
      <label class="field"><span>Región</span><input name="region" value="${esc(w.region)}" maxlength="60" required></label>
    </div>

    <h3>Teléfonos</h3>
    <div class="form-grid">
      <label class="field"><span>Principal</span><input name="telefono" type="tel" value="${esc(fmtPhone(w.telefono))}" maxlength="20" required></label>
      <label class="field"><span>Segundo (opcional)</span><input name="telefono2" type="tel" value="${esc(fmtPhone(w.telefono2))}" maxlength="20"></label>
      <label class="field"><span>WhatsApp <small>(vacío = el principal)</small></span><input name="whatsapp" type="tel" value="${esc(fmtPhone(w.whatsapp))}" maxlength="20"></label>
    </div>

    <h3>Servicios y horario</h3>
    <div class="checks">
      ${chk('abierto24h', 'Abierto 24 h, todos los días', w.abierto24h)}
      ${chk('compra', 'Compra chatarra', w.compra)}
      ${chk('vaciados', 'Hace vaciados', w.vaciados)}
      ${chk('portes', 'Portes económicos', w.portes)}
      ${chk('fuera_region', 'Sale de la región', w.fuera_region)}
    </div>
    <div class="form-grid mt">
      <label class="field full" data-horario><span>Horario (si no es 24 h)</span><input name="horario" value="${esc(w.horario)}" maxlength="80" placeholder="Lunes a sábado, de 8 a 20 h"></label>
    </div>

    <h3>Quiénes son</h3>
    <div class="form-grid">
      <label class="field"><span>Nombres (opcional)</span><input name="personas" value="${esc(w.personas)}" maxlength="60" placeholder="José y Manuel"></label>
      <label class="field full"><span>Texto de «Quiénes somos» <small>(vacío = uno estándar)</small></span><textarea name="quienes" rows="3" maxlength="600">${esc(w.quienes)}</textarea></label>
    </div>

    <h3>Zonas</h3>
    <div class="form-grid">
      <label class="field full"><span>Frase de zonas <small>(vacío = «Somos de… y nos movemos por toda la…»)</small></span><input name="zonas_texto" value="${esc(w.zonas_texto)}" maxlength="300"></label>
      <label class="field full"><span>Grupos de zonas <small>(una línea por grupo: «Título: zona, zona, zona»)</small></span><textarea name="zonas" rows="4">${esc(zonesText(w.zonas))}</textarea></label>
    </div>

    <h3>Ficha de Google y frase destacada</h3>
    <div class="form-grid">
      <label class="field full"><span>Enlace a la ficha de Google (opcional)</span><input name="g_url" value="${esc(w.google?.url ?? '')}" maxlength="300" placeholder="https://www.google.com/maps?cid=…"></label>
      <label class="field"><span>Nota</span><input name="g_nota" value="${esc(w.google?.nota ?? '')}" maxlength="3" placeholder="4,9"></label>
      <label class="field"><span>Nº de reseñas</span><input name="g_total" type="number" min="0" value="${esc(w.google?.total ?? '')}"></label>
      <label class="field full"><span>Frase destacada en «Vaciados» (opcional, real)</span><input name="c_texto" value="${esc(w.cita?.texto ?? '')}" maxlength="200"></label>
      <label class="field"><span>Autor de la frase</span><input name="c_autor" value="${esc(w.cita?.autor ?? '')}" maxlength="60" placeholder="Jorge G. · reseña en Google"></label>
    </div>

    <h3>Opiniones <span class="count" data-count="opiniones"></span></h3>
    <p class="muted small">Solo opiniones reales de clientes, con su permiso o publicadas en la ficha de Google.</p>
    <div class="rows" data-rows="opiniones">${w.opiniones.map(reviewRow).join('')}</div>
    <button type="button" class="btn ghost small mt" data-add="opiniones">+ Añadir opinión</button>

    <h3>Trabajos realizados <span class="count" data-count="trabajos"></span></h3>
    <div class="rows" data-rows="trabajos">${w.trabajos.map(jobRow).join('')}</div>
    <button type="button" class="btn ghost small mt" data-add="trabajos">+ Añadir trabajo</button>

    <p class="form-error" data-error hidden></p>
    <div class="save"><button class="btn primary" data-save>Guardar la web</button><span class="muted small">Los cambios se ven en la web al momento.</span></div>
  </form>`;

  const form = $('[data-web]', container);

  // Fotos propias: cuadrícula con borrar y la casilla de subir
  const paintPhotos = () => {
    $('[data-photo-count]', form).textContent = `(${own.length})`;
    $('[data-photo-grid]', form).innerHTML = `${own.map((p) => `<figure class="photo">
        <img src="${esc(o.photoUrl(p.ref))}" alt="${esc(ownLabel(p))}" loading="lazy">
        <figcaption><span>${esc(ownLabel(p))}</span><button type="button" class="link danger-link" data-del-photo="${p.id}">Borrar</button></figcaption>
      </figure>`).join('')}
      <label class="photo upload"><input type="file" accept="image/*" multiple data-upload><span>＋</span><small>Subir fotos</small></label>`;
  };
  // Al cambiar las fotos, los selectores se rehacen sin perder lo elegido
  const refreshPickers = () => {
    $$('select[data-photo]', form).forEach((s) => {
      const keep = s.value;
      s.innerHTML = options(keep, s.dataset.empty);
      if (![...s.options].some((x) => x.value === keep)) s.selectedIndex = 0;
      syncThumb(s);
    });
  };
  const syncThumb = (s) => {
    const img = s.parentElement.querySelector('.thumb');
    if (!img) return;
    img.hidden = !s.value;
    if (s.value) img.src = o.photoUrl(s.value);
  };
  const counts = () => Object.keys(ROWS).forEach((k) => {
    const n = $$('[data-row]', $(`[data-rows=${k}]`, form)).length;
    $(`[data-count=${k}]`, form).textContent = `(${n})`;
    $(`[data-add=${k}]`, form).hidden = n >= LIMIT[k];
  });
  const sync24 = () => { $('[data-horario]', form).hidden = form.abierto24h.checked; };

  paintPhotos();
  counts();
  sync24();
  form.abierto24h.addEventListener('change', sync24);
  form.addEventListener('change', (e) => { if (e.target.matches('select[data-photo]')) syncThumb(e.target); });

  form.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-upload]')) return;
    const files = [...e.target.files];
    e.target.value = '';
    const state = $('[data-upload-state]', form);
    state.hidden = false;
    let done = 0;
    for (const file of files) {
      state.textContent = `Subiendo ${done + 1} de ${files.length}…`;
      try {
        const blob = await prepareJpeg(file);
        const p = await o.upload(blob);
        own.push(p);
        done++;
      } catch (err) { toast(err.message, 'error'); }
    }
    state.hidden = true;
    if (done) toast(done === 1 ? 'Foto subida' : `${done} fotos subidas`);
    paintPhotos();
    refreshPickers();
  });

  form.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const box = $(`[data-rows=${add.dataset.add}]`, form);
      box.insertAdjacentHTML('beforeend', ROWS[add.dataset.add]());
      box.lastElementChild.querySelector('input, textarea')?.focus();
      counts();
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) { rm.closest('[data-row]').remove(); counts(); }
    const del = e.target.closest('[data-del-photo]');
    if (del) {
      const p = own.find((x) => x.id === Number(del.dataset.delPhoto));
      if (!p || !window.confirm(`¿Borrar ${ownLabel(p).toLowerCase()}? No se puede deshacer.`)) return;
      try {
        await o.remove(p);
        own = own.filter((x) => x !== p);
        paintPhotos();
        refreshPickers();
        toast('Foto borrada');
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  const rows = (k) => $$('[data-row]', $(`[data-rows=${k}]`, form)).map((row) => Object.fromEntries($$('[data-k]', row).map((i) => [i.dataset.k, i.dataset.k === 'estrellas' ? Number(i.value) : i.value])));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('[data-error]', form);
    error.hidden = true;
    const f = form.elements;
    const body = {
      marca: f.marca.value, lema: f.lema.value, barrio: f.barrio.value, ciudad: f.ciudad.value, region: f.region.value,
      telefono: f.telefono.value, telefono2: f.telefono2.value, whatsapp: f.whatsapp.value,
      abierto24h: f.abierto24h.checked, compra: f.compra.checked, vaciados: f.vaciados.checked, portes: f.portes.checked, fuera_region: f.fuera_region.checked,
      horario: f.horario.value, personas: f.personas.value, quienes: f.quienes.value, zonas_texto: f.zonas_texto.value, zonas: f.zonas.value,
      google: f.g_url.value || f.g_nota.value ? { url: f.g_url.value, nota: f.g_nota.value, total: Number(f.g_total.value || 0) } : null,
      cita: f.c_texto.value ? { texto: f.c_texto.value, autor: f.c_autor.value } : null,
      portada: $('select[data-k=portada]', form).value,
      galeria: rows('galeria'),
      opiniones: rows('opiniones').filter((r) => r.nombre || r.texto),
      trabajos: rows('trabajos').filter((j) => j.titulo || j.texto),
    };
    const button = $('[data-save]', form);
    button.disabled = true;
    try {
      await o.save(body);
      toast('Web guardada');
    } catch (err) { error.textContent = err.message; error.hidden = false; toast(err.message, 'error'); } finally { button.disabled = false; }
  });

  return form;
}
