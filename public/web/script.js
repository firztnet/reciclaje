// Pinta opiniones y trabajos desde datos.js; cada sección sigue oculta si su lista está vacía.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const VISIBLES = 6; // opiniones a la vista antes de pulsar "ver más"

function pintarOpiniones(opiniones) {
  if (!opiniones.length) return;
  const lista = document.getElementById('lista-opiniones');
  for (const o of opiniones) {
    const card = el('figure', 'review');
    const n = Math.max(1, Math.min(5, o.estrellas || 5));
    const stars = el('div', 'stars', '★'.repeat(n) + '☆'.repeat(5 - n));
    stars.setAttribute('aria-label', `${n} de 5 estrellas`);
    const leer = el('button', 'leer-mas', 'Leer más');
    leer.type = 'button';
    leer.disabled = true; // se activa en marcarLargas() si el texto no cabe
    leer.addEventListener('click', () => {
      leer.textContent = card.classList.toggle('abierta') ? 'Leer menos' : 'Leer más';
    });
    card.append(stars, el('blockquote', '', o.texto), leer, el('figcaption', '', [o.nombre, o.zona].filter(Boolean).join(' · ')));
    if (lista.children.length >= VISIBLES) card.hidden = true;
    lista.append(card);
  }

  // Resumen de la ficha de Google, si el cliente la tiene
  if (GOOGLE) {
    const resumen = document.getElementById('resumen-google');
    const nota = el('p', 'google-score');
    nota.append(el('b', '', GOOGLE.nota), el('span', 'stars', '★★★★★'), el('span', '', `${GOOGLE.total} reseñas en Google`));
    resumen.append(nota);
    if (GOOGLE.url) {
      const enlace = el('a', 'btn btn-copper', 'Ver todas en Google');
      enlace.href = GOOGLE.url;
      enlace.target = '_blank';
      enlace.rel = 'noopener';
      resumen.append(enlace);
    }
  }

  if (opiniones.length > VISIBLES) {
    const mas = el('button', 'btn btn-outline', `Ver ${opiniones.length - VISIBLES} opiniones más`);
    mas.type = 'button';
    mas.addEventListener('click', () => {
      for (const card of lista.children) card.hidden = false;
      mas.remove();
      marcarLargas();
      revelar();
    });
    lista.after(mas);
  }
  document.getElementById('opiniones').hidden = false;
}

// Activa "Leer más" solo en las reseñas a la vista cuyo texto no cabe en las 4 líneas.
function marcarLargas() {
  for (const card of document.querySelectorAll('.review:not(.abierta)')) {
    if (card.hidden) continue;
    const texto = card.querySelector('blockquote');
    card.querySelector('.leer-mas').disabled = texto.scrollHeight <= texto.clientHeight + 1;
  }
}

function pintarTrabajos(trabajos) {
  if (!trabajos.length) return;
  const lista = document.getElementById('lista-trabajos');
  for (const t of trabajos) {
    const card = el('article', 'job');
    const img = el('img');
    img.src = t.foto;
    img.alt = t.titulo;
    img.loading = 'lazy';
    const body = el('div', 'job-body');
    if (t.zona) body.append(el('p', 'job-zone', t.zona));
    body.append(el('h3', '', t.titulo));
    if (t.texto) body.append(el('p', '', t.texto));
    card.append(img, body);
    lista.append(card);
  }
  document.getElementById('trabajos').hidden = false;
}

pintarOpiniones(OPINIONES);
pintarTrabajos(TRABAJOS);
marcarLargas();
addEventListener('resize', marcarLargas);
addEventListener('load', marcarLargas);

// Mientras los trabajos sean de ejemplo, lo avisa en la sección.
if (DEMO_TRABAJOS) {
  document.getElementById('lista-trabajos').before(el('p', 'demo-note', 'Ejemplo: contenido de muestra, pendiente de sustituir por el real.'));
}

// Entrada suave de tarjetas, fotos y reseñas al llegar a ellas con el scroll.
const pendientes = new Set(document.querySelectorAll('.card, .job, .review, .gallery figure, .steps li, .value, details, .phones a, .clear-quote, .call-card'));
for (const node of pendientes) node.classList.add('reveal');

function revelar() {
  let turno = 0;
  for (const node of pendientes) {
    const caja = node.getBoundingClientRect();
    if (!caja.height || caja.top > innerHeight * 0.92) continue; // oculto o aún por debajo de la pantalla
    pendientes.delete(node);
    setTimeout(() => node.classList.add('visible'), caja.bottom > 0 ? turno++ * 80 : 0);
  }
}

addEventListener('scroll', revelar, { passive: true });
addEventListener('resize', revelar);
addEventListener('load', revelar);
revelar();

// Convierte el formulario de recogida en un mensaje de WhatsApp ya escrito.
const WHATSAPP = NEGOCIO.whatsapp; // lo pone la plataforma en datos.js
const form = document.getElementById('pedido');
const error = document.getElementById('pedido-error');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData(form);
  const nombre = data.get('nombre').trim();
  const zona = data.get('zona').trim();

  if (!nombre || !zona) {
    error.hidden = false;
    form.elements[nombre ? 'zona' : 'nombre'].focus();
    return;
  }
  error.hidden = true;

  const materiales = data.getAll('material');
  const detalles = data.get('detalles').trim();

  const lineas = [
    'Hola, vengo de la web.',
    '',
    `Necesito: ${data.get('servicio')}`,
    `Nombre: ${nombre}`,
    `Zona: ${zona}`,
    `Sitio: ${data.get('lugar')}`,
    `Material: ${materiales.length ? materiales.join(', ') : 'Sin especificar'}`,
    `Cantidad: ${data.get('cantidad')}`,
    `Cuándo: ${data.get('cuando')}`,
  ];
  if (detalles) lineas.push(`Detalles: ${detalles}`);

  const url = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(lineas.join('\n'))}`;
  window.open(url, '_blank', 'noopener');
});
