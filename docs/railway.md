# Publicar en Railway · Firztnet · Plataforma de reciclaje

La plataforma va en **Railway**, en la cuenta de Firztnet, con el dominio `reciclar.firztnet.es`.
Cada cliente queda en `<su-subdominio>.reciclar.firztnet.es` y tú en `admin.reciclar.firztnet.es`.
La web `www.firztnet.es` y el correo siguen en Hostinger: no se tocan.

## 0. Subir el código a GitHub

1. En github.com → **New repository** → nombre `reciclaje`, **Private**, sin README.
2. En esta carpeta (`plataforma`), desde la terminal:
   ```
   git init -b main
   git add .
   git commit -m "Plataforma de reciclaje"
   git remote add origin https://github.com/firztnet/reciclaje.git
   git push -u origin main
   ```
   No se suben los datos (`data/`, `data-demo/`) ni los `.env`: lo impide `.gitignore`.

## 1. Crear el servicio

1. Railway → tu proyecto (el de hostelería vale, o **New Project**) → **New** → **GitHub Repo** → `firztnet/reciclaje`.
2. En el servicio, **Settings**:
   - **Region**: Europa (EU West, Ámsterdam).
   - **Build**: Railpack (el que viene). Instala Node 24, el indicado en `package.json`. No hay dependencias que instalar.
   - **Start command**: `npm start`
   - **Healthcheck path**: `/api/health`
   - **Replicas**: **1**. La base está en el disco; no se puede repartir en varias copias.
3. **Volumen (disco permanente)**: en el lienzo del proyecto, clic derecho sobre el servicio → **Attach volume** →
   ruta de montaje **`/data`**. Sin volumen, los datos y las fotos se pierden en cada actualización. El sistema usa
   siempre el disco de Railway, aunque la ruta sea otra.

## 2. Variables (Settings → Variables → Raw Editor)

```
PLATFORM_DOMAIN=reciclar.firztnet.es
PLATFORM_ADMIN_NAME=Firztnet
PLATFORM_ADMIN_EMAIL=contacto@firztnet.es
PLATFORM_ADMIN_PASSWORD=(elige una clave larga; solo la sabes tú)
DATA_DIR=/data
NODE_ENV=production
TRUST_PROXY=1
TZ=Europe/Madrid
```

- `PORT` no se pone: lo da Railway.
- Al arrancar la primera vez se crea tu cuenta de superadministrador. **Después, borra `PLATFORM_ADMIN_PASSWORD`**
  de las variables; la clave se cambia en tu panel, en «Mi cuenta».
- Comprobación: en **Deployments → View logs** debe salir «Datos en: /data» y
  «Plataforma de reciclaje en marcha … superadministrador: https://admin.reciclar.firztnet.es».
  Si sale «¡CUIDADO! Los datos NO están en un disco permanente», falta el volumen.

## 3. Dominios

En el servicio → **Settings → Networking → Custom Domain**, añadir dos:

1. `reciclar.firztnet.es` (la presentación de la plataforma)
2. `*.reciclar.firztnet.es` (tu panel `admin.` y todos los clientes, sin añadir nada más por cada uno)

Railway enseña, para cada uno, los registros que hay que poner en el DNS. En **Hostinger → Dominios →
firztnet.es → DNS**, **añadir** exactamente esos (normalmente):

| Tipo | Nombre | Valor |
|---|---|---|
| CNAME | `reciclar` | el que diga Railway (`…up.railway.app`) |
| CNAME | `*.reciclar` | el que diga Railway |
| CNAME | `_acme-challenge.reciclar` | el que diga Railway (para el certificado https) |
| TXT | el que diga Railway | el que diga Railway (verificación) |

**No borrar ni cambiar nada que ya exista**: los registros MX, TXT y `mail` son del correo, `@` y `www` son la web,
y los de `hosteleria` son de la otra plataforma. Antes de tocar, haz una captura de la lista.

El certificado https puede tardar desde unos minutos hasta unas horas. Si se queda atascado, revisa `_acme-challenge.reciclar`.

## 4. Pasar a José y Manuel desde la demo

1. En la demo de tu ordenador (`1 - Superadministrador`) → su ficha → **Exportar ficha** → se descarga `ficha-elchatarrerodemadrid.json`.
2. En `https://admin.reciclar.firztnet.es` → **Importar ficha** → elige ese archivo → subdominio `elchatarrerodemadrid`.
3. En su ficha, en «Datos del cliente», pon su **correo real** y pulsa **Dar acceso a su panel**: le sale su clave temporal.
4. Las fotos propias no viajan en la ficha: si las tuviera, súbelas desde su ficha.

## 5. Comprobar

- `https://admin.reciclar.firztnet.es` → entrar con tu correo y tu clave.
- `https://elchatarrerodemadrid.reciclar.firztnet.es` desde un móvil: botones **Llamar** y **WhatsApp**, y el formulario.
- Su panel: `https://elchatarrerodemadrid.reciclar.firztnet.es/panel/`.
- Su cartel: **escanear el QR con el móvil** antes de imprimir.

## 6. Copias de seguridad

- La plataforma guarda sola una copia diaria de su base en `/data/backups-plataforma` (las 30 últimas).
  Las fotos de los clientes están en `/data/clientes/<subdominio>/fotos`.
- Además, en Railway: servicio → volumen → **Backups** → programar copias del volumen (incluye las fotos).
- De vez en cuando, descargar una copia fuera de Railway.

## 7. Actualizar

Cada cambio que se sube a GitHub (rama `main`) se publica solo. Los datos están en el volumen `/data` y no se tocan
al actualizar; los cambios de la base se aplican solos al arrancar.

## 8. Coste

Railway cobra por uso por encima de lo incluido en el plan. En **Workspace → Usage** se ve el gasto y se puede poner
un **límite** para que no haya sorpresas.
