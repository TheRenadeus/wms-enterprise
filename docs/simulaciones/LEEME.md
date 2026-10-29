# Simulaciones

Maquetas interactivas para revisar una idea antes de construirla en el WMS. No se conectan a la API ni
a la base de datos: usan datos de ejemplo y guardan los cambios solo en el navegador.

## costos-prefacturacion.html

Simulación de la sección **Comercial**. Ábrela con doble clic en cualquier navegador.

Hay dos tipos de cliente, y cada uno se cobra distinto:

| Tipo | Qué es | Qué se le cobra | De dónde sale la prefactura |
|---|---|---|---|
| **Almacenaje** | Guarda su propia mercadería en la bodega (3PL) | Almacenaje, operación (recepción, picking, despacho), insumos y transporte | Movimientos del mes registrados en el WMS |
| **Venta** | Compra productos propios | Productos vendidos y, si corresponde, el flete | Guías de despacho pendientes de cobro |

- **Clientes:** resumen por tipo con lo que falta prefacturar y lo que está en prefacturas abiertas. La
  ficha cambia según el tipo: los de almacenaje muestran los cobros del mes y sus tarifas especiales;
  los de venta, sus guías de despacho (con flete o "retira el cliente") y sus precios especiales.
- **Costos y precios:** costo, precio y margen de los productos para venta, los insumos y los servicios
  (almacenaje, operación y transporte), con margen mínimo y cálculo de precio por margen objetivo.
- **Prefacturación:** borrador con descuentos, líneas exentas, IVA, margen interno y el flujo
  borrador → revisión → aprobada → facturada. Las líneas que se pueden agregar dependen del tipo de
  cliente.

### Fletes de venta

El flete de cada guía de venta se calcula con el método asignado al cliente (se elige en su ficha),
según la zona de destino y lo que lleva la guía:

| Método | Cómo se calcula |
|---|---|
| Por viaje | Precio fijo por zona, camión dedicado |
| Por kilo cobrable | Kilos × tarifa de la zona; se cobra el mayor entre el peso real y el volumétrico (m³ × 250) |
| Por bulto | Bultos × tarifa de la zona |
| Por pallet | Pallets (1,44 m³ cada uno) × tarifa de la zona |
| % del valor | Porcentaje del valor neto de la mercadería |
| Incluido sobre un monto | Sin cobro si la compra supera el monto; si no, se cobra con otro método |

**Zona de destino:** cada cliente de venta tiene direcciones de despacho con comuna, y cada comuna
pertenece a una zona (tabla editable en Fletes de venta). La guía toma la zona de la comuna; si la
comuna no tiene zona, la guía no se puede cobrar hasta asignarla, o se elige la zona a mano en la guía.

**Peso y volumen:** salen de la ficha de cada SKU, con los mismos campos que ya tiene el WMS (peso en kg;
largo, ancho y alto en cm). Se ven y editan en Productos para venta → Peso y medidas. Un producto sin
medidas no suma volumen y la simulación lo advierte.

Kilo, bulto y % del valor tienen un cobro mínimo por envío. En **Costos y precios → Fletes de venta** se
editan las tarifas, el costo interno y se comparan los seis métodos sobre una misma guía o un envío
ingresado a mano.

Cada listado tiene filtros: búsqueda por texto, tipo de cliente, cliente, período, estado, categoría,
margen y rango de fechas, según corresponda.

## prompt-integracion-comercial.md

Prompt para que una sesión nueva de Claude Code integre el módulo Comercial al WMS completo, por fases:
lo que se reutiliza del WMS, reglas de negocio, modelo de datos, API, permisos, pruebas y decisiones abiertas.
