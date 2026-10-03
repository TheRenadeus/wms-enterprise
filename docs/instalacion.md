# Instalación de WMS Enterprise en el servidor del cliente

Guía para instalar, asegurar, respaldar y actualizar WMS Enterprise en un servidor
propio del cliente o en la nube. Todo corre con Docker Compose.

## 1. Requisitos

**Servidor**

| | Mínimo | Recomendado |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 2 GB | 4 GB |
| Disco | 20 GB SSD | 40 GB SSD más espacio para respaldos |
| Sistema | Ubuntu Server 22.04 o 24.04 LTS (u otro Linux con Docker) | |

Como referencia, una bodega con 10 a 30 usuarios simultáneos funciona bien con la
configuración recomendada.

**Software**

- Docker Engine 24 o superior.
- Docker Compose 2.24 o superior (`docker compose version`).
- Git.

**Red**

- Para acceso desde internet: un dominio o subdominio (por ejemplo
  `wms.cliente.cl`) apuntando con un registro A a la IP pública del servidor, y
  los puertos **80 y 443** abiertos.
- Para uso solo en la red local, ver la opción C de HTTPS.
- **No** abras al exterior los puertos 3000 (API) ni 5432 (base de datos).

## 2. Instalación

```bash
sudo mkdir -p /opt/wms-enterprise && sudo chown "$USER" /opt/wms-enterprise
git clone <url-del-repositorio> /opt/wms-enterprise
cd /opt/wms-enterprise
git checkout <versión>        # una etiqueta de versión, por ejemplo v1.2.0
cp .env.example .env
chmod 600 .env
```

Edita `.env`:

| Variable | Valor |
|---|---|
| `DB_PASS` | Contraseña larga y aleatoria: `openssl rand -base64 24` |
| `JWT_SECRET` | `openssl rand -hex 32`. **Obligatorio y único por cliente** |
| `PORTAL_SECRET` | `openssl rand -hex 32` (recomendado, separado del anterior) |
| `SEED_ADMIN_PASSWORD` | Contraseña inicial de `admin`. Si la dejas vacía, se genera una aleatoria y aparece una sola vez en el log |
| `ALLOWED_ORIGIN` | La URL pública, por ejemplo `https://wms.cliente.cl` |
| `WMS_DOMAIN` | Solo con HTTPS de la opción A: `wms.cliente.cl` |
| `ACME_EMAIL` | Solo con la opción A: correo para avisos del certificado |

Guarda una copia de `.env` en un lugar seguro, fuera del servidor (gestor de
contraseñas del proyecto). Sin `JWT_SECRET` y `DB_PASS` no se puede recuperar
la instalación desde un respaldo.

Levanta los servicios (con HTTPS, ver la sección 3):

```bash
docker compose up -d --build
docker compose ps
```

Al primer arranque el backend crea el esquema con las migraciones. Para el primer
ingreso:

```bash
docker compose logs wms-api | grep "Usuario inicial"
```

Entra con `admin`, **cambia la contraseña** y crea los usuarios nominativos del
cliente. No compartas la cuenta `admin`.

## 3. HTTPS

HTTPS es obligatorio en producción: las contraseñas y los datos viajan cifrados,
y la app móvil (cámara, instalación como app) solo funciona con HTTPS.

**Opción A: dominio público con Caddy (recomendada).** Caddy obtiene y renueva
el certificado solo, y deja expuestos únicamente los puertos 80 y 443.

```bash
# .env: WMS_DOMAIN=wms.cliente.cl y ACME_EMAIL=ti@cliente.cl
docker compose -f docker-compose.yml -f deploy/docker-compose.https.yml up -d --build
```

Este archivo también deja la API y el frontend accesibles solo a través de
Caddy, y ajusta `TRUST_PROXY` para que la API vea la IP real de cada usuario.

Con esta opción, usa **siempre** los dos `-f` en todos los comandos de
`docker compose`. Para no repetirlos, agrega al `.env`:

```bash
COMPOSE_FILE=docker-compose.yml:deploy/docker-compose.https.yml
```

**Opción B: Cloudflare Tunnel.** Sirve cuando no se pueden abrir puertos en el
firewall del cliente. Se instala `cloudflared` en el servidor y el túnel apunta a
`http://localhost:80`. No requiere IP pública. Exige una cuenta de Cloudflare con
el dominio del cliente.

**Opción C: solo red local.** Usa Caddy con certificado interno (`tls internal`
en el `Caddyfile`) e instala el certificado raíz de Caddy en los equipos y
celulares de la bodega. Sin eso, el navegador mostrará la conexión como no
segura.

## 4. Respaldos automáticos de PostgreSQL

`deploy/backup.sh` hace un `pg_dump`, verifica que el archivo se pueda leer,
borra los respaldos más antiguos que `KEEP_DAYS` y, opcionalmente, envía una
copia fuera del servidor con `rclone`.

```bash
chmod +x deploy/*.sh
sudo mkdir -p /var/backups/wms && sudo chown "$USER" /var/backups/wms
deploy/backup.sh                      # primera prueba manual
```

Programa el respaldo diario con `crontab -e`:

```
30 2 * * * cd /opt/wms-enterprise && BACKUP_DIR=/var/backups/wms KEEP_DAYS=14 deploy/backup.sh >> /var/log/wms-backup.log 2>&1
```

**Copia externa (muy recomendada):** un respaldo que vive solo en el mismo
servidor se pierde junto con el servidor. Configura un destino con
`rclone config` (otro servidor, S3, Backblaze B2, Google Drive) y agrega
`RCLONE_REMOTE=destino:carpeta` en la línea del cron.

**Prueba la restauración** al instalar y luego una vez al mes, en un servidor de
prueba. Un respaldo que nunca se restauró no está comprobado.

La app también tiene respaldos internos (menú del superadministrador). Son útiles
para deshacer errores puntuales, pero **no reemplazan** el `pg_dump`.

## 5. Restauración

```bash
deploy/restore.sh /var/backups/wms/wms_wms_db_AAAA-MM-DD_HHMM.dump --yes
```

El script:

1. Verifica que el archivo sea un respaldo válido.
2. Respalda el estado actual por si hay que volver atrás.
3. Detiene la API.
4. Reemplaza la base y vuelve a iniciar la API.

**Restaurar en un servidor nuevo:** instala según la sección 2 usando el **mismo
`.env`** (en particular `DB_PASS`, `DB_USER`, `DB_NAME` y `JWT_SECRET`), levanta
los servicios y luego ejecuta `restore.sh`.

## 6. Actualización a una nueva versión

1. Avisa a los usuarios: la API se reinicia, normalmente por menos de un minuto.
2. Respalda: `deploy/backup.sh`.
3. Descarga y cambia de versión:

   ```bash
   cd /opt/wms-enterprise
   git fetch --tags
   git checkout <nueva-versión>
   ```

4. Revisa si `.env.example` trae variables nuevas y agrégalas a `.env`.
5. Reconstruye y levanta:

   ```bash
   docker compose up -d --build
   docker compose logs --tail 100 wms-api
   ```

   Las migraciones nuevas se aplican solas al arrancar.

6. Comprueba que `https://<dominio>/health` responda `"status":"ok"` y prueba un
   ingreso.

**Volver atrás:** `git checkout <versión-anterior>`, `docker compose up -d --build`
y, si la nueva versión alcanzó a migrar la base, `deploy/restore.sh` con el
respaldo del paso 2.

## 7. Monitoreo básico

- Estado: `https://<dominio>/health` responde `status`, `db` y la latencia de la
  base. Conéctalo a un monitor externo (por ejemplo UptimeRobot) para recibir
  alertas.
- Logs: `docker compose logs -f wms-api`.
- Espacio en disco: `df -h` y `du -sh /var/backups/wms`.
- Revisa el log de respaldos una vez por semana: `tail /var/log/wms-backup.log`.

## 8. Seguridad del servidor

- Actualizaciones automáticas del sistema operativo (`unattended-upgrades` en
  Ubuntu).
- Firewall con solo 22, 80 y 443 abiertos (`ufw`). Restringe el 22 a las IP de
  soporte si es posible.
- Acceso SSH solo con llave, sin contraseña ni ingreso directo como `root`.
- `.env` con permisos `600` y fuera de cualquier repositorio.
- Un `JWT_SECRET` distinto en cada cliente. Nunca reutilices secretos entre
  instalaciones.
