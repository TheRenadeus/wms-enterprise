#!/bin/bash
cd "$(dirname "$0")"
echo "  Deteniendo WMS Enterprise..."
pkill -f "ngrok" 2>/dev/null
docker-compose down
echo "  Listo."
