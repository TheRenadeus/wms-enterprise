# Prompt: integrar el módulo Comercial al WMS

> Copia todo lo que está bajo la línea en una sesión nueva de Claude Code sobre el repositorio
> `TheRenadeus/wms-enterprise`. Está escrito para que la sesión trabaje por fases, con un PR por fase.

---

## Objetivo

Construir en el WMS la sección **Comercial**, que hoy existe solo como maqueta aprobada. Tiene tres
pantallas: **Clientes** (ficha comercial), **Costos y precios** y **Prefacturación**. Permite cobrar a cada
cliente lo que corresponde según su tipo, armar una prefactura revisable y aprobarla antes de facturar.

La especificación visual y de reglas es la maqueta `docs/simulaciones/costos-prefacturacion.html` (ábrela en
un navegador y recórrela entera antes de empezar) y su `docs/simulaciones/LEEME.md`. No copies el HTML:
reimplementa con el stack del proyecto (React 18 + Tailwind + lucide-react en el frontend; Express +
PostgreSQL con migraciones versionadas en el backend). Los textos, nombres de pantallas, estados y avisos de
la maqueta son los que el usuario ya aprobó: úsalos tal cual.

Antes de escribir código, lee lo que ya existe (sección siguiente), confirma con el usuario las
**decisiones abiertas** del final y propón el plan de la fase 1.

## Lo que ya existe en el WMS y se reutiliza

Verificado en el código; revisa los detalles antes de usarlo.

- **Clientes:** tabla `clients` (`id`, `name`, `contact`, `email`, `active`, `portal_*`). Hoy son los
  dueños del inventario (depositantes 3PL). Rutas en `backend/routes/clients.js`, pestaña `ClientsTab.jsx`.
- **Modo de operación:** `operationMode` en `frontend/src/App.js` (`PROPIO`, `3PL`, `HYBRID`) y
  `MODULES_3PL_ONLY` en `frontend/src/constants.js`. El inventario propio usa un cliente propio (en el modo
  de prueba es `client_id = 'PROPIO'`, ver `backend/sandbox-data.js`). Confirma cómo se identifica el cliente
  propio en producción.
- **Productos:** `master_skus` (PK `sku, client_id`) ya tiene `weight` (kg) y `length`, `width`, `height`
  (cm); la ficha de SKU del frontend los muestra con esas unidades. **El flete usa estos campos**: no crees
  otros.
- **Insumos:** `insumos.costo_unitario` (migración `019_insumos.js`) y el consumo de insumos por documento
  (`insumo_movimientos`, endpoint `/api/documentos/:module/:id/insumos` en `routes/insumos.js`).
- **Despachos:** `POST /api/dispatch_batch` en `backend/routes/inventory-ops.js` registra el documento en
  `processed_docs (doc_num, doc_type, client_id)`. `dispatch_schedules` tiene `destination` (texto libre) y el
  cierre por POD (migración 030). También existen `document_history`, `shipments` y el módulo de transporte
  (`routes/transporte.js`, migraciones 027–029).
- **Facturación actual ("Cobros a clientes", pestaña `3pl-billing`):** `routes/billing.js`, tablas
  `billing_invoices`, `client_tariffs`, `invoices`, `invoice_lines`, `storage_events` y claves
  `system_config` (`3pl_pallet_day_price`, `3pl_movement_in_price`, `3pl_movement_out_price`,
  `3pl_currency`, `3pl_tax_rate`). El IVA por defecto es 19.
- **Permisos:** `backend/middleware.js` (`requireAuth`, `requireStockWrite` = EJECUTIVO_CUENTA+,
  `requireJefe` = JEFE_BODEGA+, `requireAdmin` = ADMIN+, `checkClientAccess`). En el frontend, `canView` en
  `App.js` y `APP_MODULES` en `constants.js`.
- **Migraciones:** `backend/migrations/list.js`; la última es `037_conteo_cliente`. Las nuevas parten en
  **038**, son idempotentes (`IF NOT EXISTS`) y se agregan al final de la lista.
- **Validación:** Joi en `backend/schemas.js`. **Pruebas:** `npm test` en `backend/`
  (`node --test test/*.test.js`), con helpers en `backend/test/helpers`.
- **Frontend:** `App.js` es muy grande; las pestañas nuevas van como componentes en `frontend/src/tabs/`
  cargados de forma diferida, como `KardexTab.jsx`. Formato chileno: `Intl.NumberFormat('es-CL')`, pesos sin
  decimales.

## Reglas de negocio

### 1. Dos tipos de cliente

| Tipo | Qué es | Qué se le cobra | De dónde sale la prefactura |
|---|---|---|---|
| **Almacenaje** | Guarda su propia mercadería en la bodega (3PL) | Servicios (almacenaje y operación), insumos, transporte y otros cargos | Movimientos del período registrados en el WMS |
| **Venta** | Compra productos propios | Productos, flete y otros cargos | Guías de despacho de venta pendientes de cobro |

- El tipo define qué tipos de línea se pueden agregar a la prefactura:
  - Almacenaje: `servicio`, `insumo`, `transporte`, `otro`.
  - Venta: `producto`, `transporte`, `otro`.
- El tipo también define qué botón de importación aparece en el editor: "Traer movimientos del período" o
  "Traer guías de despacho".
- En una prefactura, el selector de cliente solo ofrece clientes del mismo tipo.
- La ficha de un cliente de almacenaje muestra: posiciones ocupadas, SKU y unidades en bodega; las
  pestañas "Cobros del mes", "Tarifas del cliente" y "Prefacturas".
- La ficha de un cliente de venta muestra el selector "Cobro de flete" y las pestañas "Guías de despacho",
  "Direcciones de despacho", "Precios del cliente" y "Prefacturas".
- Ambos tipos tienen RUT, giro, dirección de facturación, contacto y condición de pago (Contado, 15, 30, 45 o
  60 días).
- El listado de clientes muestra una tarjeta por tipo y una tabla con filtros (búsqueda, tipo, "Solo con
  cobros pendientes").
  - Las tarjetas muestran "Sin prefacturar" (guías sin cobrar o meses sin prefactura) y "En prefacturas
    abiertas" (neto de las que están en borrador, revisión o aprobadas).

### 2. Costos y precios

Pestañas: **Productos para venta**, **Insumos**, **Servicios y transporte**, **Fletes de venta**.

- **Productos para venta:** los SKU del cliente propio, con costo unitario y precio de venta neto.
  - Una segunda vista, **Peso y medidas**, edita `weight`, `length`, `width` y `height` del SKU. Muestra
    el volumen (m³ = largo × ancho × alto / 1.000.000, con cuatro decimales), el peso volumétrico y cuál
    peso se cobra.
  - Un SKU sin medidas se marca "Faltan medidas".
- **Insumos:** usa el costo existente (`insumos.costo_unitario`) y agrega el precio de cobro.
- **Servicios y transporte:** catálogo con código, grupo (Almacenaje, Operación, Transporte), descripción,
  unidad de cobro, costo y tarifa. Valores iniciales de la maqueta:
  - `ALM-PAL-DIA` pallet-día y `ALM-M3-MES` m³-mes.
  - `REC-PAL`, `PICK-LIN`, `DES-PED`, `ETQ-UN`, `KIT-UN` y `DEV-UN`.
  - `TR-RM-URB`, `TR-RM-RUR`, `TR-V-REG`, `TR-KG` y `TR-PEON`.
- **Margen** = (precio − costo) / precio. Hay un margen mínimo configurable (15 % por defecto).
  - Chip rojo bajo el mínimo, ámbar hasta 10 puntos sobre el mínimo y verde sobre eso.
  - "Sin precio" cuando el precio es 0.
  - Se muestran también los KPI: con precio, margen promedio, bajo el mínimo y sin precio.
- **Calcular precio con margen:** precio = costo / (1 − margen), redondeado hacia arriba a la decena. Se
  aplica a una de tres opciones:
  - Los que no tienen precio.
  - Los que están bajo el mínimo.
  - Todos los de la vista filtrada.
- **Precio especial por cliente:** reemplaza al de lista para ese cliente.
  - Venta: por SKU.
  - Almacenaje: por servicio, flete o insumo.
  - Se aplica a las líneas nuevas; las prefacturas ya armadas conservan su precio.
- Filtros: búsqueda, categoría o grupo y estado de margen.

### 3. Fletes de venta

El flete de una guía de venta se calcula con el **método asignado al cliente**, según la **zona de destino**
y lo que lleva la guía.

**Zonas** (editables): Santiago urbano (`URB`), RM rural (`RUR`), V Región (`V`), VI a VIII Región (`SUR`).

**Zona de la guía**
- Cada cliente de venta tiene direcciones de despacho (nombre, calle y número, comuna). Cada comuna
  pertenece a una zona (tabla editable "Comunas por zona").
- La guía toma la zona de la comuna de su dirección. Se puede elegir la zona a mano en una guía pendiente;
  la línea de flete lo anota.
- Si la comuna no tiene zona, la línea de flete queda sin precio y la prefactura **no puede pasar a
  revisión** hasta resolverlo.
- La pantalla de fletes avisa qué direcciones usan comunas sin zona.
- La comuna se reconoce sin importar mayúsculas ni tildes.
- "Retira el cliente" (guía sin dirección) no lleva flete.

**Medidas de la guía** (desde la ficha de cada SKU × cantidad)
- Peso real (kg).
- Volumen (m³).
- Peso volumétrico = volumen × factor (250 kg/m³, configurable).
- **Kilos cobrables** = el mayor entre el peso real y el volumétrico, redondeado hacia arriba.
- Bultos = suma de cantidades.
- Pallets = máximo(1, ⌈volumen / 1,44⌉).
- Valor neto = Σ cantidad × precio del cliente.
- Si un SKU no tiene medidas, se avisa que no suma volumen.

**Métodos**, con tarifa por zona (valores iniciales de la maqueta):

| Método | Cálculo | URB | RUR | V | SUR |
|---|---|---|---|---|---|
| Por viaje | 1 × tarifa (camión 3/4 dedicado) | 55.000 | 75.000 | 140.000 | 260.000 |
| Por kilo cobrable | kilos cobrables × tarifa | 180 | 240 | 320 | 420 |
| Por bulto | bultos × tarifa | 1.900 | 2.600 | 3.500 | 4.800 |
| Por pallet | pallets × tarifa | 22.000 | 30.000 | 52.000 | 85.000 |
| % del valor | valor neto × % | 3 % | 4 % | 5 % | 7 % |
| Incluido sobre un monto | 0 si valor neto ≥ umbral (300.000); si no, el método base (por kilo) | | | | |

- **Cobro mínimo por envío** para kilo, bulto y % del valor (9.000 / 12.000 / 18.000 / 25.000). Si el
  cálculo queda bajo el mínimo, la línea se cobra como 1 × mínimo con la unidad `MÍN` y el detalle lo dice.
- **Costo interno:**
  - Por viaje: costo de camión dedicado por zona (38.000 / 52.000 / 98.000 / 185.000).
  - Los demás métodos: kilos cobrables × costo por kg consolidado (95 / 130 / 190 / 260).
  - "Incluido" usa el costo de su método base. La prefactura lo muestra como observación ámbar ("flete
    incluido, sin cobro (costo $X)"), que **no** bloquea la revisión.
- La **línea de flete** queda así:
  - Tipo `transporte` y descripción "Flete a {comuna} ({zona}) · guía {N}".
  - Cantidad, unidad y precio según el método: `VIAJE`, `KG`, `BULTO`, `PALLET`, `GL` o `MÍN`.
  - Costo unitario = costo total / cantidad.
  - Origen con el cálculo legible, por ejemplo "Por kilo cobrable: 306 kg cobrables (peso volumétrico) ×
    $180".
  - Guarda los datos del cálculo (método, zona, kilos, bultos, pallets, valor) para auditoría.
- **Comparador** (pestaña Fletes de venta):
  - Se elige una guía o un envío ingresado a mano (zona, peso, volumen, bultos, valor). Muestra las
    medidas y una tabla con los seis métodos: cálculo, cobro, costo, margen y una barra comparativa.
  - Marca el método del cliente, el más barato para el cliente y el de mejor margen.
  - Las tarifas son editables en la misma pantalla y el comparador se actualiza al momento.

### 4. Guías de despacho de venta

- Al despachar productos propios a un cliente de venta, el despacho debe registrar el comprador y la
  dirección de despacho (o "retira el cliente"). Así nace la "guía de venta" pendiente de cobro.
- Estados de cobro de una guía: **Pendiente de cobro** → **En PF-XXXX** (en una prefactura no anulada) →
  **Facturada N° X**.
- Una guía pertenece como máximo a una prefactura activa:
  - Anular la prefactura la libera.
  - Quitar todas sus líneas de una prefactura en borrador la libera.
  - Cambiar el cliente de una prefactura en borrador quita las líneas de guías del cliente anterior y
    las libera.
- Prefacturar una guía crea una línea por SKU (precio del cliente) más la línea de flete. Se pueden
  prefacturar varias guías juntas desde la ficha del cliente o desde el editor.
- Filtros de guías: búsqueda (N°, destino, producto), estado de cobro y rango de fechas. "Seleccionar
  pendientes" marca solo las de la vista.

### 5. Movimientos del período (clientes de almacenaje)

- La pestaña "Cobros del mes" y el botón "Traer movimientos del período" listan los conceptos cobrables del
  mes, cada uno con su origen en el WMS. Ejemplos: "14 posiciones ocupadas × 31 días", "38 despachos
  cerrados en octubre", "Consumo registrado en 38 documentos".
- Precio: tarifa del cliente o de lista.
- "Prefacturar {mes}" crea la prefactura con todos los conceptos. Si ya hay una prefactura activa para ese
  cliente y período, se muestra en su lugar.
- **En la maqueta estos datos eran fijos.** Construye las consultas reales y valídalas con el usuario. Las
  fuentes candidatas son:
  - Ocupación (`storage_events` / inventario por ubicación).
  - Recepciones (`processed_docs` de entrada).
  - Despachos cerrados.
  - Líneas de picking (`pick_task_lines`).
  - Devoluciones (`returns`).
  - Insumos consumidos (`insumo_movimientos`).
  - Viajes (`shipments` / transporte).

### 6. Prefacturación

- **Número** `PF-AAAA-NNNN`, correlativo por año.
- **Encabezado:** cliente, período (mes), fecha, OC o referencia del cliente, condición de pago (por
  defecto la del cliente), observaciones que salen en el documento, descuento global (%) e IVA (%) (por
  defecto 19).
- **Línea:**
  - Datos: tipo, ítem del catálogo (salvo "otro" y flete), descripción, cantidad, unidad, precio unitario,
    descuento %, afecto o exento de IVA.
  - Snapshot del costo unitario. Origen (texto) y referencia de fuente: guía, movimiento o manual.
- **Cálculo** (pesos enteros; siempre en el servidor, nunca confiar en totales del navegador):
  - neto de línea = round(cantidad × precio × (1 − desc/100)).
  - Subtotal afecto y subtotal exento: suma de las líneas afectas y de las exentas.
  - Descuento global: neto afecto = round(afecto × (1 − g)) y neto exento = round(exento × (1 − g)).
    El descuento mostrado es la diferencia.
  - IVA = round(neto afecto × tasa / 100).
  - Total = neto afecto + neto exento + IVA.
  - Interno: costo = Σ cantidad × costo unitario; margen = neto − costo, también en %.
- **Estados:** `BORRADOR` → `EN_REVISION` → `APROBADA` → `FACTURADA`, más `ANULADA`.
  - Solo el borrador es editable.
  - Desde revisión se puede devolver a borrador; desde aprobada, volver a revisión.
  - Anular pide confirmación en la misma pantalla y libera las guías.
  - Una facturada o anulada se puede "Duplicar" como borrador nuevo; si estaba facturada, para el mes
    siguiente. La copia lleva solo las líneas que no vienen de guías.
- **Revisión automática:**
  - Bloquean el envío a revisión (rojo): sin líneas, línea sin precio, cantidad 0, descripción vacía,
    cobro bajo el costo, flete sin zona.
  - No bloquean (ámbar): margen bajo el mínimo, flete incluido.
- **Emitir factura:** DTE 33, o DTE 34 si todo es exento. En la maqueta el número era simulado; ver la
  decisión 3.
- **Vista previa para el cliente:**
  - Documento con emisor, "PREFACTURA N° … DOCUMENTO SIN VALOR TRIBUTARIO" y datos del cliente.
  - Detalle sin costos ni márgenes, y totales: monto neto, exento, IVA, total.
  - Pie: "Una vez aprobada se emite la factura electrónica correspondiente (DTE 33, o DTE 34 si todo el
    cobro es exento)".
- **Editor:**
  - Botones para agregar las líneas permitidas al tipo de cliente y el botón de importación que
    corresponda.
  - Filtro de líneas por tipo (los totales siempre suman todas).
  - "Ver costo y margen (interno)".
  - Panel lateral con totales, composición por tipo, revisión y acciones según el estado.
- **Listado:**
  - KPI: listas para facturar, en revisión, en borrador, facturado del mes.
  - Chips de estado con conteo.
  - Filtros: búsqueda (N°, cliente, RUT, OC, factura), tipo de cliente, cliente, período y "Solo con
    observaciones".
  - Columna de tipo de cliente.
- Toda transición queda registrada: quién, cuándo, desde qué estado y hacia cuál.

## Modelo de datos propuesto

Ajusta nombres a las convenciones del repositorio. Una migración por bloque, desde la 038.

- **038 Clientes comerciales:** `clients` + `tipo_comercial` (`almacenaje` | `venta`, por defecto
  `almacenaje`), `rut`, `giro`, `billing_address`, `payment_terms_days` (por defecto 30) y
  `freight_method` (`viaje`, `kilo`, `bulto`, `pallet`, `valor`, `gratis`).
  `client_addresses` (`id`, `client_id`, `label`, `address`, `comuna`, `active`).
- **039 Precios:**
  - `master_skus` + `cost`, `sale_price`.
  - `insumos` + `precio_cobro`.
  - `commercial_services` (`code` PK, `grupo`, `descripcion`, `unidad`, `costo`, `precio`, `activo`), con
    los valores iniciales de la maqueta.
  - `client_prices` (`client_id`, `item_type` producto/insumo/servicio, `item_key`, `price`, único por
    los tres primeros).
  - `system_config.commercial_min_margin` = 15.
- **040 Fletes:**
  - `freight_zones` (`id`, `nombre`, `orden`, `min_charge`, `cost_trip`, `cost_kg`).
  - `freight_rates` (`method`, `zone_id`, `rate`, PK compuesta).
  - `freight_comunas` (`nombre`, `zone_id`), con las 23 comunas de la maqueta.
  - `system_config`: `freight_volumetric_factor` = 250, `freight_free_threshold` = 300000 y
    `freight_free_base` = `kilo`.
- **041 Guías de venta:** `sales_dispatches` (`id`, `doc_num`, `doc_type`, `owner_client_id` (el
  propio), `customer_id`, `address_id` (null = retira), `zone_override`, `prefactura_id`, `created_at`) y
  `sales_dispatch_lines` (`sku`, `qty`). Se escriben dentro de la transacción del despacho.
- **042 Prefacturas:**
  - `prefacturas`: encabezado, estado, `discount_pct`, `iva_rate`, `invoice_num`, `invoice_dte`,
    auditoría de creación, aprobación, facturación y anulación.
  - `prefactura_lines`: tipo, ítem, descripción, `qty` NUMERIC(14,3), unidad, `unit_price`, `unit_cost`,
    `disc_pct`, `afecto`, `origin`, `source_type`, `source_id`, `freight_meta` JSONB, `position`.
  - `prefactura_events`: historial de transiciones.

Para vincular guías con prefacturas usa `SELECT … FOR UPDATE`, así dos usuarios no meten la misma guía en
dos prefacturas.

## API propuesta (`backend/routes/comercial.js`, montada en `/api/comercial`)

- Clientes:
  - `GET/PUT /clientes/:id` (datos comerciales).
  - `GET/POST/DELETE /clientes/:id/direcciones`. Una dirección con guías no se puede borrar, solo
    desactivar.
- Precios:
  - `GET/PUT /precios/productos`, `/precios/insumos`, `/precios/servicios` (CRUD).
  - `PUT/DELETE /clientes/:id/precios`.
  - `POST /precios/calcular-margen` (masivo).
- Fletes:
  - `GET/PUT /fletes/config` (zonas, tarifas, mínimos, costos, factor, umbral).
  - `GET/POST/DELETE /fletes/comunas`.
  - `POST /fletes/cotizar` (guía o envío manual → los seis métodos con cálculo, cobro y costo).
- Guías:
  - `GET /guias` (filtros: cliente, estado de cobro, desde, hasta, texto).
  - `PATCH /guias/:id` (zona a mano).
- Movimientos: `GET /movimientos?client_id&period`.
- Prefacturas:
  - `GET /prefacturas` (filtros del listado) y `GET /prefacturas/:id` (con totales calculados y
    revisión).
  - `POST /prefacturas`: vacía, desde guías (`guide_ids`) o desde período (`period`).
  - `PUT /prefacturas/:id` (encabezado) y `POST/PUT/DELETE /prefacturas/:id/lineas`.
  - `POST /prefacturas/:id/transicion` (`to`).
  - `POST /prefacturas/:id/duplicar`.

Valida todo con Joi y respeta `checkClientAccess` y el alcance de clientes del usuario.

## Permisos propuestos (confirmar)

- Ver Comercial: EJECUTIVO_CUENTA+.
- Crear y editar borradores, enviar a revisión: EJECUTIVO_CUENTA+.
- Aprobar, emitir factura y anular: JEFE_BODEGA+.
- Editar costos, tarifas, fletes y comunas: ADMIN+.
- Los costos y márgenes no se envían nunca a roles sin permiso ni al portal de clientes (rol `CLIENTE`).
- Almacenaje requiere modo `3PL` o `HYBRID`; venta requiere `PROPIO` o `HYBRID`. Integra con `canView` y
  `MODULES_3PL_ONLY`.

## Frontend

- Sección de menú **Comercial** con Clientes, Costos y precios y Prefacturación, con el estilo de las demás
  secciones del menú lateral (color de sección esmeralda, como la maqueta).
- Componentes nuevos en `frontend/src/tabs/` (por ejemplo `ComercialClientesTab.jsx`,
  `CostosPreciosTab.jsx`, `PrefacturacionTab.jsx`), cargados de forma diferida.
- Registra los ids en `APP_MODULES`.
- Los filtros, búsquedas, estados vacíos ("Ningún resultado con estos filtros" + "Limpiar filtros") y
  avisos siguen la maqueta.
- La búsqueda conserva el foco y el cursor al filtrar.
- Los selectores de cliente para inventario (dueños de stock) no deberían ofrecer clientes de venta;
  revisa dónde se listan `clients`.

## Fases (un PR por fase, cada una con pruebas)

1. **Clientes y precios:** tipos de cliente, datos comerciales, costos y precios de productos, insumos y
   servicios, precios por cliente, margen mínimo y cálculo por margen. Pantallas Costos y precios (sin
   fletes) y ficha comercial.
2. **Fletes:** zonas, tarifas, mínimos, costos, comunas, direcciones de despacho, peso y medidas, motor de
   cálculo y comparador.
3. **Guías de venta:** registrar comprador y dirección en el despacho y mostrar las guías con su estado de
   cobro y flete.
4. **Prefacturación:** modelo, cálculo en servidor, estados, importación desde guías y desde movimientos,
   revisión, vista previa, listado con filtros.
5. **Cierre con la facturación existente:** según la decisión 2.

**Pruebas mínimas:**
- Motor de flete: los seis métodos, mínimo, volumétrico contra real, incluido sobre el umbral y bajo el
  umbral, comuna sin zona, zona a mano.
- Cálculo de totales: descuentos, exentos, redondeo de IVA.
- Transiciones y permisos por rol.
- Una guía no puede quedar en dos prefacturas activas.
- Anular libera guías.
- Aislamiento por cliente, como en `test/aislamiento.test.js`.

Antes de cada PR corre `npm test` en `backend/` y la compilación del frontend.

## Decisiones abiertas (pregúntalas antes de la fase 1)

1. **¿Un cliente puede ser de los dos tipos?** Por ejemplo, que guarde mercadería y además compre. La maqueta
   asume uno solo.
2. **¿La prefacturación reemplaza a "Cobros a clientes" o convive?** Las tarifas de servicios reemplazarían
   las de `system_config 3pl_*` y `client_tariffs`.
3. **Emisión de la factura:** ¿se emite desde el WMS integrándose con un proveedor de facturación
   electrónica (SII), o el WMS solo registra el número de la factura emitida en otro sistema y exporta el
   detalle?
4. **Compradores:** ¿los clientes de venta van en `clients` con `tipo_comercial = 'venta'` (lo propuesto)
   o en una tabla aparte, porque no son dueños de inventario?
5. **Movimientos del período:** de qué tablas sale cada concepto (en especial "posiciones ocupadas × días")
   y en qué momento del mes se corta.
6. **Vigencia de precios:** ¿se guarda historial con fecha desde, o basta el precio vigente y el snapshot de
   la línea?
7. **Permisos:** confirmar la propuesta de la sección anterior.

## Criterios de aceptación

- Con datos reales se pueden recorrer los flujos de la maqueta:
  - Prefacturar el mes de un cliente de almacenaje.
  - Prefacturar varias guías de un cliente de venta con su flete.
  - Cambiar el método de flete de un cliente y ver recalculadas sus guías pendientes.
  - Resolver una comuna sin zona.
  - Llevar una prefactura de borrador a facturada.
  - Anular y ver liberadas sus guías.
- Los totales del servidor coinciden con las fórmulas de este documento.
- Ningún costo ni margen llega a usuarios sin permiso.
- Las migraciones corren dos veces sin error y no alteran "Cobros a clientes" mientras no se decida lo
  contrario.
