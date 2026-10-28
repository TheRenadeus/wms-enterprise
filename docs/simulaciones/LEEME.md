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

Cada listado tiene filtros: búsqueda por texto, tipo de cliente, cliente, período, estado, categoría,
margen y rango de fechas, según corresponda.
