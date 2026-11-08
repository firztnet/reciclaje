# Plataforma de reciclaje

Igual que la plataforma de hostelería, pero para chatarreros: tú, como **superadministrador**, das de alta a
cada chatarrería y la plataforma le sirve **su propia web en su subdominio**, con la misma web que la de José y
Manuel (cabecera, recogida, vaciados, formulario a WhatsApp, zonas, opiniones, trabajos y cartel para imprimir).

| Dirección | Qué es |
| --- | --- |
| `admin.reciclar.firztnet.es` | Tu panel de superadministrador |
| `cliente.reciclar.firztnet.es` | La web de ese cliente |
| `cliente.reciclar.firztnet.es/panel/` | El panel de su titular, para editar su web y sus fotos |
| `cliente.reciclar.firztnet.es/cartel.html` | Su cartel A4 con sus teléfonos |
| `reciclar.firztnet.es` | Presentación sencilla |

## Qué hace el superadministrador

- **Dar de alta un cliente** (`+ Nuevo cliente`): nombre, subdominio, barrio, teléfonos, titular, días de
  prueba (0 = activo directamente) y, opcionalmente, correo, razón social, NIF y notas. Su web queda publicada al momento.
- **Editar su web** desde su ficha: nombre y zona, teléfonos y WhatsApp, servicios (24 h, compra, vaciados,
  portes, fuera de la región), horario, «Quiénes somos», zonas, ficha de Google, frase destacada, opiniones y
  trabajos realizados. Los cambios se ven en su web en cuanto guardas.
- **Fotos propias** de cada cliente: se suben desde su ficha (o desde su panel) y se usan en la portada, la
  galería y los trabajos. El navegador las reduce a 1600 px y las vuelve a guardar en JPEG antes de subirlas, así
  que no se publica la ubicación del móvil ni otros datos internos. Hasta 40 por cliente, 4 MB cada una. Una foto
  en uso no se puede borrar hasta quitarla de la web.
- **Panel del titular**: con su correo, el alta le da una clave temporal (se ve una sola vez, con botón para
  copiarla). Al entrar la primera vez elige la suya. Desde la ficha puedes darle una clave nueva si la olvida
  (se cierran sus sesiones). Lo que cambia el titular queda en la actividad.
- **Comunicados** a los clientes (mantenimiento con día y hora, aviso o novedad), **solo por WhatsApp**: cada
  comunicado tiene la lista de clientes con un botón «Enviar» que abre WhatsApp en su número con el mensaje ya
  escrito y su nombre. Queda apuntado a quién se ha enviado («Enviado a 3 de 5»).
- **Cuota y cobros** en la ficha de cada cliente: importe y si paga al mes, al trimestre o al año, y hasta cuándo
  está pagado. «Apuntar pago» lo adelanta un periodo (y saca al cliente de la prueba); el último pago se puede anular.
  Arriba salen los **ingresos al mes** de los clientes activos y avisos de a quién le toca pagar o lo tiene vencido,
  con «Recordar por WhatsApp» para mandarle el recordatorio ya escrito. Si no paga, la web sigue abierta: tú decides
  cuándo suspenderlo.
- **Estados**: en prueba hasta una fecha, activo con renovación opcional, o suspendido con motivo. Suspendido o
  con la prueba terminada, su web muestra un aviso; su ficha se conserva y al activarlo todo vuelve como estaba.
- **Eliminar**: solo si está suspendido y escribiendo su subdominio. La ficha se guarda aparte (`deleted_tenants`).
- **Avisos** arriba: pruebas que terminan esta semana o han terminado, renovaciones próximas o vencidas y webs sin visitas.
- **Uso**: visitas de su web este mes, opiniones y nota de Google.
- **Actividad**: registro de todo lo que haces (altas, cambios, suspensiones, accesos fallidos…).

## Probarlo en el ordenador

Carpeta **«Pantallas del sistema»** (doble clic): `1 - Superadministrador`, `2 - Web de Jose y Manuel` y
`3 - Panel del titular (Jose)`. La primera vez crea los datos de ejemplo.
Superadministrador de la demo: `admin@firztnet.test` / `Admin-2027-demo`. Titular: `jose@firztnet.test` / `Demo-2027-panel`.

Desde la terminal: `npm run demo` (datos limpios) y `npm run start:demo`. Pruebas: `npm test`.

No necesita `npm install`: usa solo Node 24 (servidor y base de datos SQLite incluidos en Node).

## Ponerlo en marcha de verdad

Paso a paso en Railway, con GitHub, dominios y cómo pasar a José y Manuel desde la demo: [docs/railway.md](docs/railway.md).
Resumen:

1. Un registro DNS **comodín** (`*.reciclar.firztnet.es`) apuntando al servidor y un certificado https comodín
   (o el https automático del alojamiento, si admite comodines).
2. Variables de entorno:
   ```
   PLATFORM_DOMAIN=reciclar.firztnet.es
   PLATFORM_ADMIN_NAME=Tu nombre
   PLATFORM_ADMIN_EMAIL=tu@correo.es
   PLATFORM_ADMIN_PASSWORD=una-clave-larga
   DATA_DIR=/ruta/del/disco/permanente
   NODE_ENV=production
   TRUST_PROXY=1
   PORT=3500
   ```
   Al arrancar se crea tu cuenta; después borra `PLATFORM_ADMIN_PASSWORD`.
3. `npm start`. Todo vive en `DATA_DIR`: `plataforma.db` (clientes, webs y cuentas) y `clientes/<subdominio>/fotos/`.
   Copia la carpeta entera fuera del servidor a diario. Al eliminar un cliente, sus fotos pasan a `eliminados/`.

## Seguridad

- Claves con scrypt y sal; sesión en cookie `HttpOnly` + `SameSite=Strict` (y `Secure` en producción), 12 h.
- Bloqueo tras 8 intentos fallidos en 15 minutos, y cada acceso fallido queda en la actividad.
- La API solo acepta JSON del mismo origen (contra peticiones falsificadas desde otra web).
- Cabeceras de seguridad y política de contenido estricta en el panel y en cada web; todo lo que escribe el
  superadministrador se escapa al pintarse.
- Las webs de los clientes no tienen login ni datos personales: no hay nada que robar en ellas.

- El panel de cada titular solo vale en su subdominio: la cookie es de ese subdominio y además el servidor
  comprueba en cada petición que la sesión es de ese cliente. Las fotos se comprueban (tienen que ser JPEG de verdad)
  y se guardan con un nombre al azar.

## Pendiente (siguientes pasos)

- Dominio propio por cliente, además del subdominio.
- Recuperar la clave por correo (ahora la da el superadministrador), que necesita un servicio de envío de correo.
