#!/usr/bin/env bash
# Restaura un respaldo de deploy/backup.sh. REEMPLAZA todos los datos actuales.
#
# Uso:
#   deploy/restore.sh /var/backups/wms/wms_wms_db_2026-01-31_0230.dump --yes
#
# Antes de restaurar se toma un respaldo de seguridad del estado actual.
set -euo pipefail

cd "$(dirname "$0")/.."

FILE="${1:-}"
CONFIRM="${2:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Uso: deploy/restore.sh <archivo.dump> --yes" >&2
  exit 1
fi
if [ "$CONFIRM" != "--yes" ]; then
  echo "Esto reemplaza TODOS los datos del WMS por los de $FILE." >&2
  echo "Si estás seguro, repite el comando agregando --yes al final." >&2
  exit 1
fi

env_value() {
  grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}
DB_USER="$(env_value DB_USER)"; DB_USER="${DB_USER:-admin}"
DB_NAME="$(env_value DB_NAME)"; DB_NAME="${DB_NAME:-wms_db}"

# El archivo debe ser un volcado válido antes de tocar nada.
docker compose exec -T wms-db pg_restore --list < "$FILE" > /dev/null

echo "Respaldo de seguridad del estado actual…"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/wms}" KEEP_DAYS=36500 RCLONE_REMOTE="" deploy/backup.sh

echo "Deteniendo la API…"
docker compose stop wms-api

echo "Restaurando $FILE en $DB_NAME…"
docker compose exec -T wms-db dropdb -U "$DB_USER" --if-exists "$DB_NAME"
docker compose exec -T wms-db createdb -U "$DB_USER" "$DB_NAME"
docker compose exec -T wms-db pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --exit-on-error < "$FILE"

echo "Iniciando la API (aplica migraciones pendientes al arrancar)…"
docker compose start wms-api
echo "Restauración terminada. Revisa: docker compose logs --tail 50 wms-api"
