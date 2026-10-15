# Lista de verificación: puesta en marcha de un cliente nuevo

Copia esta lista para cada implementación y marca cada punto al completarlo.

**Cliente:** ____________________ **Fecha de inicio:** __________
**Responsable:** ____________________ **Versión del WMS:** __________

## 1. Antes de instalar

- [ ] Contrato y alcance firmados: módulos, cantidad de usuarios, soporte y
      condiciones de respaldo.
- [ ] Servidor según los requisitos (`docs/instalacion.md`, sección 1).
- [ ] Dominio o subdominio definido y registro DNS apuntando al servidor.
- [ ] Acceso SSH con llave para el equipo de soporte.
- [ ] Decidido el modo de HTTPS: dominio con Caddy, Cloudflare Tunnel o red local.
- [ ] Destino de los respaldos externos definido (otro servidor o nube).
- [ ] Contacto técnico del cliente (TI) y responsable de operación (jefe de
      bodega).

## 2. Instalación

- [ ] Sistema operativo actualizado, firewall con solo 22, 80 y 443,
      actualizaciones automáticas activas.
- [ ] Docker y Docker Compose instalados (Compose 2.24 o superior).
- [ ] Repositorio clonado en `/opt/wms-enterprise` con una **etiqueta de
      versión**, no una rama.
- [ ] `.env` creado con secretos **nuevos y únicos** para este cliente
      (`DB_PASS`, `JWT_SECRET`, `PORTAL_SECRET`), con permisos `600`.
- [ ] Copia de `.env` guardada en el gestor de contraseñas del proyecto.
- [ ] `ALLOWED_ORIGIN` con la URL real (no `*`).
- [ ] Servicios arriba: `docker compose ps` muestra todo en estado `running`.
- [ ] HTTPS funcionando, certificado válido en el navegador.
- [ ] `https://<dominio>/health` responde `"status":"ok"` y `"db":"ok"`.
- [ ] Monitor externo configurado sobre `/health`, con alertas al equipo de
      soporte.

## 3. Seguridad y cuentas

- [ ] Contraseña inicial de `admin` cambiada por una fuerte.
- [ ] Usuarios nominativos creados, uno por persona, sin cuentas compartidas.
- [ ] Cada usuario con el rol mínimo que necesita (picker, ejecutivo, jefe de
      bodega, auditor…).
- [ ] Usuarios con perfil de cliente asociados **solo** a su propio cliente.
- [ ] La cuenta `admin` queda guardada para soporte y no se usa en la operación
      diaria.
- [ ] Las funciones de demostración están desactivadas en esta instalación.

## 4. Respaldos

- [ ] `deploy/backup.sh` ejecutado a mano con éxito.
- [ ] Cron diario configurado y revisado al día siguiente en
      `/var/log/wms-backup.log`.
- [ ] Copia externa (`RCLONE_REMOTE`) funcionando y verificada en el destino.
- [ ] **Restauración probada** en un servidor de prueba con un respaldo real.
- [ ] Política acordada con el cliente: días de retención y quién puede pedir
      una restauración.

## 5. Datos

Según `docs/carga-inicial.md`:

- [ ] Clientes cargados.
- [ ] Fabricantes cargados (si aplica).
- [ ] Productos cargados, con lote y serie bien definidos.
- [ ] Ubicaciones generadas según el plano real, incluidas las de piso y andén.
- [ ] Ubicaciones etiquetadas físicamente con código de barras.
- [ ] Inventario inicial cargado.
- [ ] **Cuadratura firmada** por el jefe de bodega: totales del sistema
      iguales al conteo físico.
- [ ] Respaldo de puesta en marcha tomado y registrado.

## 6. Equipos y app móvil

- [ ] Navegadores de los PC de bodega actualizados (Chrome o Edge).
- [ ] Pistolas lectoras configuradas para enviar Enter después de cada lectura.
- [ ] Si se contrató la app móvil: instalada en celulares o tablets desde
      `https://<dominio>/app`.
- [ ] Prueba de escaneo de una ubicación, un LPN y un código de barras de
      producto.

## 7. Capacitación y salida a producción

- [ ] Capacitación por rol: jefe de bodega, ejecutivos y pickers.
- [ ] Prueba completa en presencia del cliente: recepción → ubicación →
      picking → despacho → consulta del stock resultante.
- [ ] Prueba de un conteo cíclico con ajuste.
- [ ] Canal de soporte acordado: correo, WhatsApp o mesa de ayuda, horario y
      tiempos de respuesta.
- [ ] Fecha de salida a producción acordada, con acompañamiento en sitio o
      remoto el primer día.

## 8. Primera semana

- [ ] Día 1: revisión de logs y de errores reportados por los usuarios.
- [ ] Día 2: respaldo nocturno verificado.
- [ ] Día 7: reunión de cierre de implementación; pendientes y mejoras
      registrados.
- [ ] Acta de entrega firmada.
