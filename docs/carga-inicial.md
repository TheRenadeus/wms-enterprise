# Carga inicial de datos

Cómo preparar y cargar los datos de un cliente nuevo: clientes, productos,
ubicaciones e inventario inicial.

## Orden de carga

Cada paso depende del anterior. Respeta el orden:

1. **Clientes**: los dueños de la mercancía. En una bodega propia basta uno solo.
2. **Fabricantes** (opcional): solo si los productos usan `manufacturer_code`.
3. **Productos (SKU)**: cada producto pertenece a un cliente.
4. **Ubicaciones**: se generan en pantalla, no por Excel.
5. **Inventario inicial**: stock por producto, cliente y ubicación.

Antes de empezar, toma un respaldo (`deploy/backup.sh`) para poder volver al
punto de partida si la carga sale mal.

## Cómo funciona una importación

Todas las cargas por Excel usan el mismo asistente:

1. En la pantalla correspondiente, botón de importación → **Descargar
   plantilla**. Trae una hoja **Datos** y una hoja **Instrucciones**.
2. En la hoja **Datos**:
   - La fila 1 tiene los nombres de columna. **No los cambies.**
   - La fila 2 (gris) describe cada columna y la fila 3 (verde) es un ejemplo.
     **Borra ambas filas antes de subir el archivo.**
   - Tus datos van desde la fila 2 en adelante, una fila por registro.
3. Guarda como `.xlsx` (o `.csv`) y súbelo en el asistente.
4. El asistente muestra una vista previa editable y marca en rojo las filas con
   errores (campo vacío, producto inexistente, número inválido, serie repetida).
   Corrige en la vista previa o en el Excel y vuelve a subirlo.
5. Confirma la importación y revisa el resumen final (importadas y con error).

**Límite:** 10.000 filas por archivo. Para volúmenes mayores, divide el archivo
(por ejemplo, por cliente o por familia de productos).

**Recomendaciones para el Excel**

- Códigos (cliente, SKU, ubicación) en **mayúsculas, sin espacios al inicio o al
  final**. Úsalos siempre igual en todos los archivos.
- Formatea como **Texto** las columnas de códigos de barras y de SKU con ceros a
  la izquierda. Si no, Excel los convierte en números y pierde los ceros o los
  muestra en notación científica.
- Fechas en formato `AAAA-MM-DD` (por ejemplo `2026-12-31`).
- Decimales con punto (`1.5`), sin separador de miles.
- Valores verdadero/falso como `TRUE` o `FALSE`.

## 1. Clientes

Pantalla **Mis clientes** → importar. Requiere rol Jefe de bodega o superior.

| Columna | Obligatoria | Descripción | Ejemplo |
|---|---|---|---|
| `id` | Sí | Código único del cliente | `CLI-001` |
| `name` | Sí | Razón social | `Comercial Andes SpA` |
| `contact` | No | Nombre del contacto | `María Soto` |
| `email` | No | Correo del contacto | `msoto@andes.cl` |

Elige un formato de código y no lo cambies después: el código del cliente se usa
en productos, inventario, facturación y portal.

## 2. Fabricantes (opcional)

Pantalla **Fabricantes**. Se crean a mano y solo hacen falta si vas a completar
la columna `manufacturer_code` de los productos.

## 3. Productos (SKU)

Pantalla **Ficha de productos** → importar.

| Columna | Obligatoria | Descripción | Ejemplo |
|---|---|---|---|
| `sku` | Sí | Código del producto | `PROD-001` |
| `client_id` | Recomendada | Cliente dueño (debe existir). Si se deja vacío, queda en `GENERAL` | `CLI-001` |
| `desc` | Sí | Descripción | `Aceite vegetal 1 L` |
| `category` | No | Categoría | `Abarrotes` |
| `uom` | No | Unidad: `UN`, `KG`, `LT`… | `UN` |
| `weight` | No | Peso en kg | `1.05` |
| `length`, `width`, `height` | No | Dimensiones en cm | `8`, `8`, `28` |
| `abc_class` | No | Rotación: `A`, `B` o `C` | `A` |
| `requires_lot` | No | ¿Se controla por lote? | `TRUE` |
| `requires_serial` | No | ¿Se controla por número de serie? | `FALSE` |
| `barcode` | No | Código de barras (único en todo el sistema) | `7801234567890` |
| `manufacturer_code` | No | Código del fabricante (debe existir) | `MFR-001` |
| `manufacturer_sku` | No | Número de parte del fabricante | `AV-1000` |
| `brand` | No | Marca | `Andes` |

- El mismo `sku` puede existir en distintos clientes.
- Define bien `requires_lot` y `requires_serial` **antes** de cargar el
  inventario: de eso depende qué se exige al recibir y despachar.
- Un código de barras solo puede pertenecer a un producto.

## 4. Ubicaciones

Las ubicaciones **no se cargan por Excel**. Se generan en la pantalla **Diseño
de bodega**:

1. Elige la bodega y la zona.
2. Indica el rango de pasillos (letras o números), la cantidad de columnas y la
   cantidad de filas o niveles.
3. Revisa la vista previa, excluye las posiciones que no existen físicamente y
   genera.

El código de cada ubicación sigue el formato **bodega-pasillo-columna-fila**, con
la columna en dos dígitos: por ejemplo `1-A-01-1` es bodega 1, pasillo A,
columna 01, nivel 1. Las zonas (Secos, Refrigerados, Químicos…) se asignan como
atributo y no van dentro del código.

Además de los racks, crea las ubicaciones de piso que use la operación, como
`PISO-RECEPCION` o los andenes de despacho. Son de tipo piso o andén y usan
código libre.

**Antes de la carga:** recorre la bodega con un plano y confirma pasillos,
columnas y niveles reales. Etiquetar físicamente cada ubicación con su código y
código de barras facilita el escaneo desde la app móvil.

## 5. Inventario inicial

Pantalla **Productos en bodega** → importar. Requiere rol Ejecutivo de cuenta o
superior.

| Columna | Obligatoria | Descripción | Ejemplo |
|---|---|---|---|
| `sku` | Sí | Producto (debe existir para ese cliente) | `PROD-001` |
| `client_id` | Recomendada | Cliente dueño. Si se deja vacío, queda en `GENERAL` | `CLI-001` |
| `qty` | Sí | Cantidad, mayor que 0 | `120` |
| `location_id` | Recomendada | Ubicación (debe existir). Si se deja vacía, queda en `PISO-RECEPCION` | `1-A-01-1` |
| `batch_number` | Si el SKU exige lote | Lote | `L2401` |
| `expiry_date` | No | Vencimiento `AAAA-MM-DD` | `2027-03-31` |
| `serial_number` | Si el SKU exige serie | Una serie por fila, con cantidad 1 | `SN-000123` |
| `glosa` | No | Nota o referencia | `Inventario inicial` |

- Cada fila crea un **LPN** (un bulto o pallet identificado) con su propio código.
- Si un mismo producto está en varias ubicaciones, o en varios lotes, usa una
  fila por cada combinación.
- Los productos con número de serie llevan una fila por unidad.

**Cuadratura:** después de cargar, compara los totales por SKU de la pantalla
**Productos en bodega** (o su exportación a Excel) con el conteo físico o el
sistema anterior. Cualquier diferencia se corrige antes de empezar a operar,
idealmente con un conteo cíclico de las ubicaciones afectadas.

## Después de la carga

- Exporta el inventario a Excel y guárdalo como foto del día de inicio.
- Toma un respaldo (`deploy/backup.sh`) y anótalo como "respaldo de puesta en
  marcha".
- Recibe y despacha con documentos reales solo después de cuadrar el stock.
