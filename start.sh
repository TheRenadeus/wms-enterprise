#!/bin/bash
echo "Iniciando WMS Enterprise..."
cd ~/wms-enterprise/backend
pm2 start server.js --name wms 2>/dev/null || pm2 restart wms --update-env
pm2 start "ngrok http 3000" --name ngrok 2>/dev/null || pm2 restart ngrok
pm2 save
sleep 3
URL=$(curl -s http://localhost:4040/api/tunnels \
  | python3 -c "import sys,json;
    d=json.load(sys.stdin);
    print(d['tunnels'][0]['public_url'])" 2>/dev/null)
echo "WMS corriendo en: http://localhost:3000"
echo "Acceso externo:   ${URL:-ngrok no activo}"
pm2 list
