# Demostración pública del WMS

Instancia para que un prospecto pruebe el sistema por su cuenta, con datos
inventados. Funciona igual que una instalación real, pero:

- **Todos los datos son ficticios.** Tres empresas inventadas (Comercial Andes,
  Distribuidora Norte y Alimentos Verde), con productos, ubicaciones y stock.
- **Se reinicia sola cada noche.** Todo lo que se haga durante el día se borra.
- **Las funciones de riesgo están bloqueadas:** respaldos, gestión de usuarios y
  contraseñas, claves de API, configuración del sistema, portal de clientes y
  borrado de maestros (clientes, estados, tipos de documento, fabricantes) y de
  ubicaciones en lote.

> **URL:** `https://demo.TU-DOMINIO` *(por definir: todavía no hay hosting
> contratado; ver «Dónde publicarla» al final).*

## Usuarios de prueba

Un usuario por cada rol del sistema. Todos usan la misma contraseña:
**`demo-wms-2026`** (o la que se defina en `DEMO_PASSWORD` al instalar la demo).

| Usuario | Rol | Qué puede hacer |
|---|---|---|
| `demo.admin` | Administrador | Todo, salvo lo bloqueado en la demo. |
| `demo.jefe` | Jefe de bodega | Operación completa, aprobaciones, conteos, facturación. |
| `demo.ejecutivo` | Ejecutivo de cuenta | Recibir, despachar y ajustar, solo para Comercial Andes y Distribuidora Norte. |
| `demo.transporte` | Coordinador de transporte | Solicitudes, envíos y transportistas; no toca stock. |
| `demo.auditor` | Auditor | Consulta todo, no modifica nada. |
| `demo.picker` | Operario de picking | Su cola de tareas, reubicaciones y la vista 3D. |
| `demo.cliente` | Cliente | Portal de solo lectura con el stock y documentos de Comercial Andes. |

## Recorrido sugerido (15 minutos)

1. **Panorama (2 min) — `demo.jefe`.** *Resumen del día*, luego *Productos en
   bodega* (filtrar por cliente) y *Vista 3D de bodega*. Hay lotes por vencer
   para ver las alertas.
2. **Recepción contra orden de compra (3 min).** En *Órdenes de compra*, abrir
   `OC-1001` de Comercial Andes y recibir solo una parte (por ejemplo, 20 de los
   40 audífonos). Volver a abrirla: muestra lo ya recibido y permite completar
   el resto. Una línea completa no se puede recibir de nuevo.
3. **Aviso de llegada (2 min).** En *Proveedores & ASN*, recibir el `ASN-2001` de
   Distribuidora Norte. El sistema no deja recibir más de lo esperado.
4. **Despacho con picking (3 min).** En *Despachar pedidos*, crear un documento
   para Distribuidora Norte, agregar productos y enviarlo a picking. Entrar como
   `demo.picker` en otra ventana (o incógnito) y confirmar la tarea en *Mi cola
   de tareas*. Volver como `demo.jefe` y cerrar el despacho.
5. **Conteo cíclico (2 min).** En *Contar físicamente*, crear un conteo de una
   ubicación, registrar una cantidad distinta y aprobar el ajuste.
6. **Mirada del cliente (2 min) — `demo.cliente`.** Solo ve el stock y los
   documentos de Comercial Andes; no puede modificar nada.
7. **Trazabilidad (1 min) — `demo.auditor`.** *Documentos procesados* y *Reportes
   y análisis*: todo lo hecho en el recorrido queda registrado con usuario y hora.

## Instalar la demo

La demo va en **su propio servidor y su propia base de datos**. Nunca se apunta a
la base de un cliente.

1. Instalar igual que una instalación normal (ver `docs/instalacion.md`).
2. En el `.env`, agregar:

   ```
   DEMO_INSTANCE=true
   DEMO_PASSWORD=demo-wms-2026
   DEMO_RESET_HOUR=7
   ```

   `DEMO_RESET_HOUR` es la hora del reinicio diario en la hora del contenedor
   (UTC): `7` equivale a las 03:00 o 04:00 de Chile continental, según el
   horario de verano.
3. Levantar el sistema. En el primer arranque, sobre una base recién creada,
   carga los datos ficticios por sí solo. En los registros se ve `[DEMO] Datos
   de demostración cargados`.

Para reiniciarla a mano, desde `backend/` dentro del contenedor:

```
node demo-reset.js --yes
```

**Protección de datos reales:** el reinicio solo funciona sobre una base marcada
como demo, y esa marca la pone la propia carga de datos ficticios. Si alguien
activa `DEMO_INSTANCE=true` por error en una instalación con datos reales, no se
carga ni se borra nada; el sistema lo informa en sus registros.

> Esta demo no tiene relación con el *sandbox* (`DEMO_SANDBOX`), que simula
> respuestas en memoria y que está apagado por defecto.

## Dónde publicarla

Opciones con costo aproximado. Son precios de referencia: confirmar en el sitio
de cada proveedor antes de contratar.

| Opción | Costo aprox. | A favor | En contra |
|---|---|---|---|
| VM actual + Cloudflare Tunnel | US$0 + dominio | Sin servidor nuevo; HTTPS incluido | Depende de que el PC esté encendido y de la conexión de la casa |
| VPS pequeño (Hetzner, Contabo; 2 vCPU, 4 GB) | US$5–7/mes | Barato y estable; sirve el `docker compose` + Caddy ya documentado | Datacenters en Europa o EE. UU. (más latencia desde Chile) |
| VPS en EE. UU. (DigitalOcean, Vultr, Linode; 2 GB) | US$12–18/mes | Buena latencia a Chile, panel simple | Más caro por lo mismo |
| Oracle Cloud Always Free (región Santiago) | US$0 | Gratis y con datacenter en Chile | Cupo de máquinas gratuitas a veces agotado; pide tarjeta para verificar |
| Plataformas administradas (Render, Railway) | US$15–25/mes con base de datos | Sin administrar servidor | Hay que adaptar el despliegue; costo crece con el uso |
| Dominio | .cl ≈ CLP 10.000/año · .com ≈ US$10–12/año | — | — |

**Recomendación:** para las primeras presentaciones, la VM actual con Cloudflare
Tunnel (costo cero). Cuando haya prospectos probando por su cuenta, un VPS pequeño
dedicado a la demo, separado de cualquier instalación de clientes.
