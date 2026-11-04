// Web pública de cada chatarrería, montada con los datos de su ficha. Es la misma web que la de
// José y Manuel: lo que cambia (nombre, teléfonos, zonas, servicios, opiniones…) sale de «web».
import { webOf } from './tenants.mjs';
import { qrSvg } from './qr.mjs';

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtPhone = (d) => (d ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : '');
const tel = (d) => `tel:+34${d}`;
const wa = (d, text) => `https://wa.me/34${d}?text=${encodeURIComponent(text)}`;
const paragraphs = (s) => esc(s).split('\n\n').map((p) => p.replace(/\n/g, '<br>'));

const ICON_PHONE = '<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/>';
const ICON_WA = '<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 20zm4.4-6c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1-.6.8-.8 1-.3.2-.5 0a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.6-1.2.1-.2 0-.3 0-.4l-.7-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1 4.9 4.9 0 0 0 1 2.6 11.1 11.1 0 0 0 4.3 3.8c1.6.7 2.2.7 3 .6a2.6 2.6 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .1-1.2c0-.1-.2-.2-.5-.3z"/>';
const svg = (paths, cls = '') => `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

export const SITE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// «notices»: comunicados de la plataforma marcados para verse en las webs (con su «when» ya en texto)
export function renderSite(t, notices = []) {
  const w = webOf(t);
  const p1 = w.telefono;
  const p2 = w.telefono2;
  const msg = wa(w.whatsapp, 'Hola, vengo de la web. Tengo chatarra para recoger. ¿Cuándo podéis pasar?');
  const brand = `${esc(w.marca)}${w.lema ? `<small>${esc(w.lema)}</small>` : ''}`;
  const services = w.compra ? 'Recogida y compra de chatarra a domicilio' : 'Recogida de chatarra a domicilio';
  const description = `Chatarrero a domicilio en ${w.ciudad} y ${w.barrio}. ${w.compra ? 'Recogemos y compramos chatarra' : 'Recogemos chatarra'}${w.vaciados ? ' y hacemos vaciados de pisos, locales y fincas' : ''}. ${w.abierto24h ? '24 horas, de lunes a domingo y festivos. ' : ''}Llama al ${fmtPhone(p1)}.`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'LocalBusiness', name: t.name, description,
    telephone: [p1, p2].filter(Boolean).map((d) => `+34${d}`), image: w.portada || 'img/hero.jpg',
    address: { '@type': 'PostalAddress', addressLocality: w.ciudad, addressRegion: w.region, addressCountry: 'ES' },
    areaServed: [w.barrio, w.ciudad, w.region],
    ...(w.abierto24h ? { openingHoursSpecification: { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '00:00', closes: '23:59' } } : {}),
  };
  const topbar = w.abierto24h ? ['Abierto 24 horas', 'Lunes a domingo y festivos'] : [w.horario];
  const facts = [
    w.abierto24h ? '<li><b>24 h</b>todos los días</li>' : (w.horario ? `<li><b>Horario</b>${esc(w.horario)}</li>` : ''),
    w.compra ? '<li><b>Compramos</b>por mayor y por menor</li>' : '',
    w.portes ? '<li><b>Portes</b>económicos</li>' : '<li><b>A domicilio</b>cargamos nosotros</li>',
  ].join('');
  const faqs = [
    ['¿Cuánto cuesta la recogida?', `Depende del material y de la cantidad.${w.compra ? ' Si tiene valor te lo compramos; si es poco o hay que desplazarse lejos, puede haber un porte.' : ''} Siempre te lo decimos antes de ir.`],
    w.compra && ['¿Compráis la chatarra?', 'Sí, por mayor y por menor. Cobre, latón, aluminio, inoxidable y hierro. Mándanos una foto y te orientamos.'],
    w.vaciados && ['¿Hacéis vaciados completos?', 'Sí. Vaciamos pisos, trasteros, locales, naves y fincas, no solo la chatarra: muebles, electrodomésticos y enseres. Mándanos fotos y te damos precio antes de empezar.'],
    w.abierto24h && ['¿Trabajáis fines de semana y festivos?', 'Sí. Atendemos las 24 horas, de lunes a domingo y festivos.'],
    ['¿Tengo que bajarlo a la calle?', 'No hace falta. Subimos, lo desmontamos si es necesario y lo cargamos nosotros. Avísanos si no hay ascensor o el acceso es complicado.'],
    ['¿Recogéis poca cantidad?', 'Sí. Desde un radiador o una lavadora hasta grandes cantidades.'],
    ['¿Cómo preparo la chatarra para que valga más?', 'Separa los metales si puedes (cobre por un lado, aluminio por otro), quita plásticos y maderas grandes y junta todo en un mismo sitio. Si no puedes, no pasa nada: lo clasificamos nosotros.'],
    w.fuera_region && [`¿Salís de la ${w.region}?`, 'Sí, para cantidades que lo justifiquen. Llámanos y lo vemos.'],
  ].filter(Boolean);
  const phonesBig = [[p1, 'Llámanos'], [p2, 'O también']].filter(([d]) => d);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(t.name)} · Recogida de chatarra a domicilio${w.abierto24h ? ' 24 h' : ''}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="theme-color" content="#14171a">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="es_ES">
  <meta property="og:title" content="${esc(t.name)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${esc(w.portada || 'img/hero.jpg')}">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="styles.css">
  ${w.portada ? '<link rel="stylesheet" href="tema.css">' : ''}
  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
</head>
<body>
${notices.map((a) => `  <div class="site-notice" role="status"><strong>${esc(a.title)}</strong> · ${esc(a.when.charAt(0).toUpperCase() + a.when.slice(1))}${a.body ? ` · ${esc(a.body)}` : ''}</div>\n`).join('')}
  <div class="topbar">${[...topbar, `Toda la ${w.region}`].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}</div>

  <header class="header">
    <a class="brand" href="#inicio" aria-label="${esc(t.name)}, inicio">
      <img src="favicon.svg" alt="" width="40" height="40">
      <span>${brand}</span>
    </a>
    <nav class="nav" aria-label="Principal">
      <a href="#recogemos">Qué recogemos</a>
      ${w.vaciados ? '<a href="#vaciados">Vaciados</a>' : ''}
      <a href="#como">Cómo funciona</a>
      <a href="#zonas">Zonas</a>
      <a href="#preguntas">Preguntas</a>
    </nav>
    <a class="btn btn-copper header-call" href="${tel(p1)}">${svg(ICON_PHONE, 'ico')} ${fmtPhone(p1)}</a>
  </header>

  <main>

    <section class="hero" id="inicio">
      <div class="hero-inner">
        <p class="eyebrow">Chatarrero a domicilio · ${esc(w.ciudad)}</p>
        <h1>Recogemos tu chatarra <em>donde esté</em></h1>
        <p class="lead">Vamos a tu piso, chalet, nave, colegio o urbanización, cargamos nosotros y nos lo llevamos.${w.compra ? ' Y si el material tiene valor, <strong>te lo compramos</strong>.' : ''}${w.vaciados ? ' También hacemos <strong>vaciados completos</strong> de pisos, locales y fincas.' : ''}</p>
        <div class="cta">
          <a class="btn btn-copper btn-lg" href="${tel(p1)}">${svg(ICON_PHONE, 'ico')} Llamar ahora</a>
          <a class="btn btn-wa btn-lg" href="${esc(msg)}" target="_blank" rel="noopener">${svg(ICON_WA, 'ico')} WhatsApp</a>
        </div>
        <ul class="hero-facts">${facts}</ul>
      </div>
    </section>

    <section class="section" id="sitios">
      <div class="wrap">
        <p class="eyebrow">Dónde trabajamos</p>
        <h2>Nos desplazamos a toda clase de sitios</h2>
        <div class="cards">
          <article class="card"><h3>Pisos y trasteros</h3><p>Radiadores, calderas, somieres, bañeras, ventanas viejas. Lo bajamos nosotros.</p></article>
          <article class="card"><h3>Chalets y urbanizaciones</h3><p>Vallas, puertas de garaje, barbacoas, depósitos y restos de jardín metálicos.</p></article>
          <article class="card"><h3>Naves e industrias</h3><p>Maquinaria, estanterías, recortes, vigas y grandes cantidades al por mayor.</p></article>
          <article class="card"><h3>Colegios y centros</h3><p>Pupitres, taquillas, porterías, mobiliario metálico y equipos en desuso.</p></article>
          <article class="card"><h3>Obras y reformas</h3><p>Tuberías, perfiles de aluminio, cableado, ferralla y carpintería metálica.</p></article>
          <article class="card"><h3>Talleres y locales</h3><p>Persianas, cámaras, cocinas industriales, motores y piezas sueltas.</p></article>
        </div>
      </div>
    </section>

    <section class="section section-dark" id="recogemos">
      <div class="wrap">
        <p class="eyebrow">Qué recogemos</p>
        <h2>Toda clase de chatarra, poca o mucha</h2>
        <ul class="chips">${['Hierro y acero', 'Cobre', 'Latón', 'Aluminio', 'Acero inoxidable', 'Plomo y zinc', 'Cable eléctrico', 'Radiadores', 'Calderas y termos', 'Motores', 'Electrodomésticos', 'Maquinaria', 'Puertas y ventanas', 'Estanterías y vallas'].map((m) => `<li>${m}</li>`).join('')}</ul>

        ${w.galeria.length ? `<div class="gallery gallery-own">${w.galeria.map((g) => `
          <figure><img src="${esc(g.foto)}" alt="${esc(g.texto || 'Foto de un trabajo')}" loading="lazy">${g.texto ? `<figcaption>${esc(g.texto)}</figcaption>` : ''}</figure>`).join('')}
        </div>` : `<div class="gallery">
          <figure class="g-tall"><img src="img/cobre.jpg" alt="Tubería y codos de cobre clasificados en una caja" loading="lazy"><figcaption>Cobre</figcaption></figure>
          <figure><img src="img/aluminio.jpg" alt="Montón de perfiles de aluminio" loading="lazy"><figcaption>Aluminio</figcaption></figure>
          <figure><img src="img/radiadores.jpg" alt="Radiadores de aire acondicionado apilados" loading="lazy"><figcaption>Radiadores</figcaption></figure>
          <figure class="g-tall"><img src="img/electrodomesticos.jpg" alt="Restos de electrodomésticos y ventiladores" loading="lazy"><figcaption>Electrodomésticos</figcaption></figure>
          <figure class="g-wide"><img src="img/perfiles.jpg" alt="Perfiles y carpintería metálica de obra" loading="lazy"><figcaption>Carpintería metálica</figcaption></figure>
        </div>`}
        ${w.compra ? `
        <div class="value">
          <h3>¿Qué material vale más?</h3>
          <p>El precio depende del metal y del peso. De más a menos valor, por norma general:</p>
          <ol class="ladder">
            <li><b>Cobre</b><span>tubería, cable pelado, bobinados</span></li>
            <li><b>Latón</b><span>grifos, llaves, racores</span></li>
            <li><b>Aluminio</b><span>perfiles, ventanas, llantas</span></li>
            <li><b>Acero inoxidable</b><span>fregaderos, cocinas industriales</span></li>
            <li><b>Hierro</b><span>vigas, radiadores, maquinaria</span></li>
          </ol>
          <p class="note">Te decimos el precio antes de cargar, sin compromiso.</p>
        </div>` : ''}
      </div>
    </section>
    ${w.vaciados ? `
    <section class="section" id="vaciados">
      <div class="wrap clear-wrap">
        <div class="clear-text">
          <p class="eyebrow">Vaciados completos</p>
          <h2>Vaciamos pisos, locales y fincas</h2>
          <p class="lead-dark">No solo chatarra: nos llevamos todo lo que sobra y te dejamos el espacio libre para vender, alquilar, reformar o estrenar.</p>
          <ul class="ticks">
            <li>Muebles, electrodomésticos, enseres y trastos</li>
            <li>Desmontamos y bajamos todo nosotros</li>
            <li>Los viajes de furgoneta que hagan falta</li>
            <li>Te decimos el precio antes de empezar</li>
          </ul>
          <div class="cta">
            <a class="btn btn-wa btn-lg" href="${esc(wa(w.whatsapp, 'Hola, vengo de la web. Necesito un vaciado. ¿Podéis darme precio? Os mando fotos.'))}" target="_blank" rel="noopener">${svg(ICON_WA, 'ico')} Pedir precio por WhatsApp</a>
            <a class="btn btn-copper btn-lg" href="${tel(p1)}">${svg(ICON_PHONE, 'ico')} Llamar</a>
          </div>
        </div>
        <div class="clear-side">
          <article class="card card-icon">${svg('<path d="M4 21V3h10v4h6v14h-7v-4h-2v4zm3-13h2V6H7zm0 4h2v-2H7zm0 4h2v-2H7zm4-8h2V6h-2zm0 4h2v-2h-2zm5 0h2v-2h-2zm0 4h2v-2h-2z"/>')}
            <div><h3>Pisos y trasteros</h3><p>Herencias, mudanzas, fin de alquiler o antes de una reforma.</p></div></article>
          <article class="card card-icon">${svg('<path d="M3 4h18l1 6a3 3 0 0 1-2 2.8V21H4v-8.2A3 3 0 0 1 2 10zm3 9v6h5v-6zm7 0v6h5v-6z"/>')}
            <div><h3>Locales y oficinas</h3><p>Cierres y traspasos: mostradores, estanterías, cámaras y mobiliario.</p></div></article>
          <article class="card card-icon">${svg('<path d="M12 3l9 8h-3v10h-5v-6h-2v6H6V11H3z"/>')}
            <div><h3>Fincas, chalets y naves</h3><p>Casetas, aperos, vallados, depósitos y todo lo acumulado con los años.</p></div></article>
          ${w.cita ? `<figure class="clear-quote"><blockquote>«${esc(w.cita.texto)}»</blockquote>${w.cita.autor ? `<figcaption>${esc(w.cita.autor)}</figcaption>` : ''}</figure>` : ''}
        </div>
      </div>
    </section>` : ''}

    <section class="section section-soft" id="trabajos" hidden>
      <div class="wrap">
        <p class="eyebrow">Trabajos realizados</p>
        <h2>Algunas recogidas que hemos hecho</h2>
        <div class="jobs" id="lista-trabajos"></div>
      </div>
    </section>

    <section class="section" id="como">
      <div class="wrap">
        <p class="eyebrow">Cómo funciona</p>
        <h2>Tres pasos y te olvidas</h2>
        <ol class="steps">
          <li><h3>Nos avisas</h3><p>Llama o escribe por WhatsApp. Si mandas una foto del material, mejor: te respondemos más rápido.</p></li>
          <li><h3>Quedamos</h3><p>Te decimos cuándo podemos pasar${w.compra ? ' y si te compramos el material o hay algún porte' : ' y el precio, si lo hay'}.</p></li>
          <li><h3>Cargamos y listo</h3><p>Vamos con la furgoneta, lo desmontamos si hace falta, lo cargamos y lo dejamos recogido.</p></li>
        </ol>
      </div>
    </section>

    <section class="section section-copper" id="pedir">
      <div class="wrap form-wrap">
        <div>
          <p class="eyebrow">Pide tu recogida</p>
          <h2>Cuéntanos qué tienes</h2>
          <p>Rellena lo que sepas y pulsa el botón: se abre WhatsApp con el mensaje ya escrito. Después puedes añadir fotos en el chat.</p>
          <p class="form-alt">¿Prefieres hablar?</p>
          <div class="call-cards">${phonesBig.map(([d, label]) => `
            <a class="call-card" href="${tel(d)}">${svg(ICON_PHONE)}<span><small>${label}</small>${fmtPhone(d)}</span></a>`).join('')}
          </div>
        </div>

        <form id="pedido" class="form" novalidate>
          <label>Tu nombre
            <input type="text" name="nombre" autocomplete="given-name" required>
          </label>
          <label>Barrio o municipio
            <input type="text" name="zona" placeholder="${esc(w.barrio)}…" required>
          </label>
          <label class="full">Qué necesitas
            <select name="servicio">
              <option>Recogida de chatarra</option>
              ${w.vaciados ? '<option>Vaciado completo</option>' : ''}
            </select>
          </label>
          <label>Tipo de sitio
            <select name="lugar">${['Piso', 'Chalet', 'Finca', 'Trastero o garaje', 'Nave o industria', 'Colegio o centro', 'Obra o reforma', 'Taller o local', 'Otro'].map((x) => `<option>${x}</option>`).join('')}</select>
          </label>
          <label>Cantidad aproximada
            <select name="cantidad">${['Unas pocas piezas', 'Un maletero de coche', 'Una furgoneta', 'Más de una furgoneta', 'No lo sé'].map((x) => `<option>${x}</option>`).join('')}</select>
          </label>
          <fieldset class="full">
            <legend>Qué material es</legend>
            <div class="checks">${[['Hierro', 'Hierro'], ['Cobre', 'Cobre'], ['Aluminio', 'Aluminio'], ['Latón', 'Latón'], ['Acero inoxidable', 'Inoxidable'], ['Cable', 'Cable'], ['Electrodomésticos', 'Electrodomésticos'], ['Maquinaria', 'Maquinaria'], ['Mezclado / no lo sé', 'Mezclado']].map(([value, label]) => `
              <label><input type="checkbox" name="material" value="${value}"> ${label}</label>`).join('')}
            </div>
          </fieldset>
          <label class="full">Cuándo te viene bien
            <select name="cuando">${['Lo antes posible', 'Hoy', 'Mañana', 'Esta semana', 'Fin de semana', 'Sin prisa'].map((x) => `<option>${x}</option>`).join('')}</select>
          </label>
          <label class="full">Detalles (piso sin ascensor, hay que desmontar…)
            <textarea name="detalles" rows="3"></textarea>
          </label>
          <p class="form-error full" id="pedido-error" role="alert" hidden>Pon al menos tu nombre y la zona.</p>
          <button class="btn btn-wa btn-lg full" type="submit">Enviar por WhatsApp</button>
        </form>
      </div>
    </section>

    <section class="section" id="zonas">
      <div class="wrap">
        <p class="eyebrow">Zonas</p>
        <h2>De ${esc(w.barrio)} a toda la ${esc(w.region)}</h2>
        <p class="lead-dark">${esc(w.zonas_texto || `Somos de ${w.barrio} y nos movemos por toda la ${w.region}.`)}</p>
        ${w.zonas.length ? `<div class="zones">${w.zonas.map((g) => `
          <div><h3>${esc(g.titulo)}</h3><ul class="taglist">${g.lista.map((z) => `<li>${esc(z)}</li>`).join('')}</ul></div>`).join('')}
        </div>` : ''}
        <p class="note-dark">¿No ves tu zona? Pregunta igualmente: vamos donde sea.</p>
      </div>
    </section>

    <section class="section section-dark" id="opiniones" hidden>
      <div class="wrap">
        <p class="eyebrow">Clientes satisfechos</p>
        <h2>Lo que dicen de nosotros</h2>
        <div class="google-summary" id="resumen-google"></div>
        <div class="reviews" id="lista-opiniones"></div>
      </div>
    </section>

    <section class="section section-soft" id="preguntas">
      <div class="wrap narrow">
        <p class="eyebrow">Preguntas frecuentes</p>
        <h2>Lo que nos suelen preguntar</h2>
        ${faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n        ')}
      </div>
    </section>

    <section class="section section-dark about" id="nosotros">
      <div class="wrap about-wrap">
        <div>
          <p class="eyebrow">Quiénes somos</p>
          <h2>${w.personas ? `${esc(w.personas)}, tu` : 'Tu'} chatarrero de confianza</h2>
          ${paragraphs(w.quienes || `Somos de ${w.barrio} y trabajamos a domicilio: sin intermediarios, hablas siempre con quien va a ir a tu casa. Seriedad, puntualidad y el sitio recogido cuando nos vamos.`).map((x) => `<p>${x}</p>`).join('')}
        </div>
        <div class="phones">${phonesBig.map(([d, label]) => `<a href="${tel(d)}"><small>${label}</small>${fmtPhone(d)}</a>`).join('')}</div>
      </div>
    </section>

  </main>

  <footer class="footer">
    <div class="wrap footer-wrap">
      <p><strong>${esc(t.name)}</strong><br>${esc(services)}${w.abierto24h ? ' · 24 h' : ''}</p>
      <a class="print-card" href="cartel.html">
        ${svg('<path d="M7 3h10v5H7zM5 9h14a3 3 0 0 1 3 3v6h-4v3H6v-3H2v-6a3 3 0 0 1 3-3zm3 7v3h8v-3zm10-4a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>')}
        <span><b>Cartel para imprimir</b><small>A4 con tiras recortables del teléfono</small></span>
        <i aria-hidden="true">→</i>
      </a>
    </div>
  </footer>

  <a class="wa-float" href="${esc(msg)}" target="_blank" rel="noopener" aria-label="Escríbenos por WhatsApp">${svg(ICON_WA)}<span>WhatsApp</span></a>

  <div class="mobilebar">
    <a class="btn btn-copper" href="${tel(p1)}">Llamar</a>
    <a class="btn btn-wa" href="${esc(msg)}" target="_blank" rel="noopener">WhatsApp</a>
  </div>

  <script src="datos.js"></script>
  <script src="script.js"></script>
</body>
</html>
`;
}

// Datos que pinta script.js (opiniones, trabajos, nota de Google y el WhatsApp del formulario)
export function renderDatos(t) {
  const w = webOf(t);
  const js = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `// Datos de ${t.name.replace(/[\r\n]/g, ' ')}, generados por la plataforma.
const NEGOCIO = ${js({ whatsapp: `34${w.whatsapp}` })};
const GOOGLE = ${js(w.google)};
const OPINIONES = ${js(w.opiniones)};
const DEMO_TRABAJOS = false;
const TRABAJOS = ${js(w.trabajos)};
`;
}

// Portada propia: la foto va en una hoja de estilos aparte porque la web no admite estilos en línea
export function renderTema(t) {
  const w = webOf(t);
  return w.portada ? `.hero { background: linear-gradient(100deg, rgba(20, 23, 26, .94) 30%, rgba(20, 23, 26, .55)), url("${w.portada}") center / cover no-repeat; }\n` : '';
}

// «siteUrl»: la dirección de su web, que va en el QR (la pone el servidor según el dominio de la plataforma)
export function renderCartel(t, siteUrl) {
  const w = webOf(t);
  const shown = siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const lines = [
    'Hierro · Cobre · Aluminio · Latón · Inoxidable',
    'Radiadores, calderas, electrodomésticos, maquinaria',
    'Pisos, trasteros, chalets, naves, colegios y obras',
    w.vaciados && 'Vaciado de pisos, locales y fincas',
    w.compra ? 'La cargamos nosotros · También la compramos' : 'La cargamos nosotros',
  ].filter(Boolean);
  const strip = `<div><span>Chatarrero ${fmtPhone(w.telefono)}<br><small>Recogida a domicilio${w.abierto24h ? ' 24 h' : ''}</small></span></div>`;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Cartel para imprimir · ${esc(t.name)}</title>
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="cartel.css">
</head>
<body>
  <div class="toolbar">
    <a href="./">← Volver a la web</a>
    <button type="button" id="imprimir">Imprimir cartel (A4)</button>
  </div>
  <div class="sheet">
    <div class="top">
      <h1>Recogemos <span>chatarra</span></h1>
      <p>A domicilio${w.abierto24h ? ' · 24 horas · Todos los días' : w.horario ? ` · ${esc(w.horario)}` : ''}</p>
    </div>
    <div class="mid">
      <ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <div class="contact">
        <div class="phones-box">
          <div class="tel"><small>Llama o escribe por WhatsApp</small>${fmtPhone(w.telefono)}</div>
          ${w.telefono2 ? `<div class="tel2">${fmtPhone(w.telefono2)}</div>` : ''}
          <p class="firma">${esc(t.name)}</p>
        </div>
        <figure class="qr-box">
          ${qrSvg(siteUrl, { label: `Código QR de la web de ${t.name}` })}
          <figcaption><b>Escanea y mira nuestra web</b><span>${esc(shown)}</span></figcaption>
        </figure>
      </div>
    </div>
    <div class="strips">${strip.repeat(10)}</div>
  </div>
  <script src="cartel.js"></script>
</body>
</html>
`;
}

// Página sencilla: cliente que no existe, suspendido, prueba terminada o la portada del dominio
export function renderNotice(title, html) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<link rel="stylesheet" href="/_aviso/aviso.css"></head>
<body><main class="notice"><span class="mark">◆</span><h1>${esc(title)}</h1><p>${html}</p></main></body></html>`;
}
