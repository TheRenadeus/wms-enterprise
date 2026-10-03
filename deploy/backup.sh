#!/usr/bin/env bash
# Respaldo de PostgreSQL del WMS: pg_dump en formato custom, verificación y rotación.
#
# Uso (desde la carpeta del WMS o con ruta absoluta):
#   deploy/backup.sh
#
# Variables opcionales:
#   BACKUP_DIR     carpeta de destino            (por defecto /var/backups/wms)
#   KEEP_DAYS      días de respaldos a conservar (por defecto 14)
#   RCLONE_REMOTE  destino externo para rclone, ej. "b2:mi-bucket/wms" (vacío = solo local)
#
# Cron sugerido (todos los días a las 02:30):
#   30 2 * * * /opt/wms-enterprise/deploy/backup.sh >> /var/log/wms-backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-/var/backups/wms}"
KEEP_DAYS="${KEEP_DAYS:-14}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

env_value() {
  # Lee una variable del .env sin ejecutarlo (puede contener caracteres especiales).
  grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

DB_USER="$(env_value DB_USER)"; DB_USER="${DB_USER:-admin}"
DB_NAME="$(env_value DB_NAME)"; DB_NAME="${DB_NAME:-wms_db}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date +%Y-%m-%d_%H%M)"
FILE="$BACKUP_DIR/wms_${DB_NAME}_${STAMP}.dump"
TMP="$FILE.partial"

echo "[$(date -Is)] Respaldando $DB_NAME en $FILE"
# Si el volcado falla no debe quedar un archivo a medias que parezca válido.
trap 'rm -f "$TMP"' EXIT
docker compose exec -T wms-db pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$TMP"

# Verificación: el archivo debe poder leerse con pg_restore.
docker compose exec -T wms-db pg_restore --list < "$TMP" > /dev/null
mv "$TMP" "$FILE"
trap - EXIT
chmod 600 "$FILE"
echo "[$(date -Is)] OK: $(du -h "$FILE" | cut -f1)"

# Rotación local.
find "$BACKUP_DIR" -name 'wms_*.dump' -type f -mtime +"$KEEP_DAYS" -print -delete

# Copia externa opcional (otro servidor o almacenamiento en la nube).
if [ -n "$RCLONE_REMOTE" ]; then
  rclone copy "$FILE" "$RCLONE_REMOTE" --quiet
  echo "[$(date -Is)] Copia externa enviada a $RCLONE_REMOTE"
fi
