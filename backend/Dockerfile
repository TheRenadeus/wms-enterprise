FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# Respaldos internos de la app (menú del superadministrador): van a un volumen
# para sobrevivir a las actualizaciones, y la API corre sin privilegios de root.
RUN mkdir -p /app/backups && chown node:node /app/backups
USER node
CMD ["node", "server.js"]
