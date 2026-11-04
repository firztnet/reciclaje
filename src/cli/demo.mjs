// Datos de ejemplo para probar la plataforma en el ordenador: borra la carpeta de la demo y la vuelve a crear con
// el superadministrador de pruebas y José y Manuel como primer cliente, con su web completa.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.mjs';
import { openControl } from '../db.mjs';
import { upsertSuperadmin } from '../admin.mjs';
import { addDays, createTenant, getTenant, readWeb, defaultWeb, todayStr } from '../tenants.mjs';
import { grantOwner } from '../owners.mjs';
import { hashSecret } from '../security.mjs';

const dir = path.join(ROOT, 'data-demo');
fs.rmSync(dir, { recursive: true, force: true });
const control = openControl(dir);

// Solo para la demo local: cámbiala (o no la uses) en la instalación real
upsertSuperadmin(control, { name: 'Firztnet', email: 'admin@firztnet.test', password: 'Admin-2027-demo' });

const input = {
  slug: 'elchatarrerodemadrid', name: 'El Chatarrero de Madrid y de Hortaleza', barrio: 'Hortaleza',
  telefono: '603582259', telefono2: '677198414', contact_name: 'José', contact_email: '',
  trial_days: 0, company_name: '', tax_id: '', notes: 'Primer cliente. Ficha de Google: Chatarrero 24Hr.',
};
const web = readWeb({
  marca: 'El Chatarrero', lema: 'de Madrid y de Hortaleza', ciudad: 'Madrid', barrio: 'Hortaleza', region: 'Comunidad de Madrid',
  telefono: '603582259', telefono2: '677198414', whatsapp: '603582259',
  abierto24h: true, horario: '', compra: true, vaciados: true, portes: true, fuera_region: true,
  personas: 'José y Manuel',
  quienes: 'Somos padre e hijo, de Hortaleza, y trabajamos a domicilio: sin intermediarios, hablas siempre con quien va a ir a tu casa. Seriedad, puntualidad y el sitio recogido cuando nos vamos.',
  zonas_texto: 'Somos de Hortaleza y nos movemos por toda la comunidad, y fuera de ella cuando hace falta.',
  zonas: [
    'Hortaleza y alrededores: Canillas, Pinar del Rey, Sanchinarro, Valdefuentes, Las Tablas, Barajas, Ciudad Lineal, San Blas, Chamartín',
    'Madrid capital: Centro, Tetuán, Salamanca, Fuencarral, Moratalaz, Vallecas, Carabanchel, Villaverde, Vicálvaro',
    'Comunidad de Madrid: Alcobendas, San Sebastián de los Reyes, Coslada, Torrejón de Ardoz, Alcalá de Henares, Getafe, Leganés, Móstoles, Las Rozas, Tres Cantos',
  ].join('\n'),
  google: { url: 'https://www.google.com/maps?cid=7482023067549604524', nota: '4,9', total: 36 },
  cita: { texto: 'En un día dejaron la finca impoluta y eso que tuvieron que hacer tres viajes con la furgoneta llena.', autor: 'Jorge G. · reseña en Google' },
  // Reseñas reales de su ficha de Google (las mismas que su web)
  opiniones: [
    ['Anderson G.', 'Excelente trabajo, muy puntual, rápidos los llames un sábado y el domingo ya estaban a primera hora. Gracias!'],
    ['RugbyJGN Madrid', 'Trabajan con rapidez y eficacia. Las instrucciones que les di las cumplieron a la perfección. Acabado el trabajo dejan el local limpio. El trato es exquisito. Si surgiese otra ocasión volveré a contar con ellos. Sin duda, recomendable.'],
    ['Emiliano A.', 'excelente lo llamé y a los10 min llego con la mejor disposición, con mucho orden y limpieza. Sin trabas y con mucha buena actitud. 100% recomendado'],
    ['Mario P.', 'Vinieron en el mismo día a hacer la recogida a domicilio. Buen trato y buen servicio.'],
    ['Montaña Alta', 'José y Manuel (padre e hijo) personas súper amables y respetuosas que he tenido la oportunidad de conocer, al enterarme por un vecino que hacían el servicio de chatarrería. Los recomiendo al 100%'],
    ['Mathias R.', 'Excelente profesional. Es una persona responsable, puntual y muy trabajadora. Se nota que tiene experiencia en el oficio de chatarrero: clasifica los materiales con cuidado, cumple con lo que promete y ofrece un trato respetuoso y honesto. Su servicio es rápido, eficiente y de confianza. Totalmente recomendable.'],
    ['David G.', 'Vinieron a mi casa y la verdad que muy contento trabajadores super amables y rápidos vinieron a mi casa a recoger los electrodomésticos y en un momento se lo llevaron todo lo recomiendo; excelentes personas los conozco desde hace años'],
    ['Jorge G.', 'Conozco a José y a Manuel desde hace muchos años, somos vecinos, ellos viven en el portal de al lado, nunca había necesitado de sus servicios hasta hace dos días, vinieron a limpiarme la finca que alquile hace un par de semanas y sin duda volveré a contratar sus servicios si los necesito en un futuro, son puntuales, trabajan rápido, y en un día dejaron la finca impoluta y eso que tuvieron que hacer tres viajes con la furgoneta llena, son muy trabajadores y buena gente, los recomiendo sin duda.'],
    ['Samantha G.', 'Muy rápidos y profesionales,de trato muy amables y respetuosos. Recomendable 100%'],
    ['Gabriel', 'Hoy me recomendaron a Jose para un traslado de enseres del trastero a mi piso, he quedado gratamente complacido con él y su hijo Manuel, son personas cooperativas, eficientes y responsables, les recomiendo y de seguro les contactaremos para futuras necesidades.'],
    ['Limcalo SL', 'Ver cómo trabaja este Señor y su hijo tan dedicados al oficio, me hizo ver lo que es el trabajo en equipo, en armonía y sentir una admiración por la profesión de este Señor ( José), al cual recomiendo para la promoción de su empresa. Hombre afable, confiable, sencillo y como no,hombre de negocios. Saludos de parte del conserje.'],
    ['Lucia M.', 'Le llame para un traslado de muebles , puntuales , muy amables. Han realizado un buen trabajo.'],
    ['Eduardo M.', 'Manuel y su tío, unos profesionales, les llamas y al poco están donde les necesites. Buenos chatarreros.'],
    ['Karen L.', 'Me atendió José y desde el principio fue respetuoso y serio con todo lo acordado. Lo recomendó para trabajos de mudanzas.'],
    ['Jose B.', 'Excelente servicio responsable y buen precio...'],
    ['Juan Antonio M.', 'Es amigo mío le conozco hace años en su trabajo formal rápido y barato lo he necesitado tres veces a el y a su hijo y en el dia hemos solucionado todo si necesitáis alguien que os limpieza un local un piso lo que sea contad con el no os vais,a,arrepentir'],
  ].map(([nombre, texto]) => ({ nombre, texto, estrellas: 5 })),
  trabajos: [
    { foto: 'img/cobre.jpg', titulo: 'Retirada de tubería de cobre', zona: 'Hortaleza', texto: 'Desmontaje de una instalación de climatización en un local.' },
    { foto: 'img/aluminio.jpg', titulo: 'Perfiles de aluminio de una reforma', zona: 'Barajas', texto: 'Recogida de la carpintería antigua tras cambiar las ventanas de un edificio.' },
    { foto: 'img/radiadores.jpg', titulo: 'Equipos de aire acondicionado', zona: 'Canillejas', texto: 'Retirada de las baterías de varios equipos en una nave.' },
    { foto: 'img/electrodomesticos.jpg', titulo: 'Vaciado de un taller', zona: 'Coslada', texto: 'Ventiladores, motores y electrodomésticos en desuso.' },
  ],
}, defaultWeb(input));

const t = createTenant(control, input, web);
control.prepare('UPDATE tenants SET renews_on = ?, contact_email = ? WHERE id = ?').run(addDays(todayStr(), 365), 'jose@firztnet.test', t.id);
// Titular de la demo con una clave ya elegida, para entrar directamente en su panel
grantOwner(control, getTenant(control, t.id), { name: 'José', email: 'jose@firztnet.test' });
control.prepare('UPDATE owners SET password_hash = ?, must_change = 0 WHERE tenant_id = ?').run(hashSecret('Demo-2027-panel'), t.id);
control.close();

console.log('Datos de ejemplo creados en data-demo/');
console.log('  Superadministrador: http://admin.reciclar.localhost:3500  (admin@firztnet.test / Admin-2027-demo)');
console.log('  Web de José y Manuel: http://elchatarrerodemadrid.reciclar.localhost:3500');
console.log('  Panel del titular: http://elchatarrerodemadrid.reciclar.localhost:3500/panel/  (jose@firztnet.test / Demo-2027-panel)');
