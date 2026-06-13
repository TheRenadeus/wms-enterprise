# REPORTE DE MEJORAS — WMS Enterprise
> Generado: 2026-04-01 | Archivos analizados: `backend/server.js` (~1440 líneas) · `frontend/src/App.js` (~4500+ líneas)

---

## RESUMEN EJECUTIVO

| Categoría   | CRÍTICO | ALTO | MEDIO | BAJO | Total |
|-------------|---------|------|-------|------|-------|
| Seguridad   | 4       | 3    | 2     | 1    | 10    |
| Rendimiento | 1       | 3    | 3     | 2    | 9     |
| Estabilidad | 2       | 4    | 3     | 2    | 11    |
| UX/UI       | 0       | 3    | 4     | 2    | 9     |
| Código      | 0       | 2    | 5     | 3    | 10    |
| **TOTAL**   | **7**   | **15** | **17** | **10** | **49** |

---

## 1. SEGURIDAD

---

### SEC-01 · Contraseñas en texto plano en la base de datos
**Archivo:** `backend/server.js` · Línea 43, 75, 96, 102, 1370
**Prioridad:** 🔴 CRÍTICO

**Problema:**
Las contraseñas se guardan y comparan en texto plano en la tabla `users`. El endpoint `/api/system/users/passwords` incluso las devuelve tal cual al SUPERADMIN.

```js
// Línea 43 — INSERT de usuario admin con contraseña 'admin123' sin hash
await pool.query(`INSERT INTO users (..., password, ...) VALUES (..., 'admin123', ...)`)

// Línea 75 — Login compara directamente
pool.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password])

// Línea 1370 — Endpoint que devuelve todas las contraseñas en texto plano
const users = await pool.query("SELECT username, full_name, role, password FROM users")
```

**Solución:**
Usar `bcrypt` para hashear contraseñas al crearlas/modificarlas y usar `bcrypt.compare()` en el login. Eliminar el endpoint de lectura de contraseñas (no tiene caso de uso legítimo).

```js
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 12;

// Al crear usuario:
const hashed = await bcrypt.hash(password, SALT_ROUNDS);

// Al hacer login:
const match = await bcrypt.compare(password, user.password);
```

---

### SEC-02 · Sin autenticación en la mayoría de endpoints
**Archivo:** `backend/server.js` · Todas las rutas
**Prioridad:** 🔴 CRÍTICO

**Problema:**
No existe ningún middleware de autenticación en el backend. Cualquier persona con acceso a la red puede llamar a **cualquier endpoint** sin credenciales:
- `GET /api/inventory` → Stock completo expuesto
- `POST /api/receive_batch` → Puede crear inventario falso
- `POST /api/dispatch_batch` → Puede vaciar el stock
- `DELETE /api/users/xxx` → Puede eliminar usuarios
- `GET /api/users` → Lista todos los usuarios con sus roles

Los endpoints SUPERADMIN (`/api/system/*`) solo validan el campo `requester` en el body, que cualquiera puede falsificar.

**Solución:**
Implementar JWT o tokens de sesión. Agregar middleware de autenticación global:

```js
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'cambiar-esto';

// Middleware de auth
const requireAuth = (req, res, next) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch(e) { res.status(401).json({ error: 'Token inválido' }); }
};

// En login, generar el token:
const token = jwt.sign({ username: u.username, role: u.role }, JWT_SECRET, { expiresIn: '8h' });
res.json({ success: true, token, user: { ... } });

// Aplicar a todas las rutas:
app.use('/api', requireAuth);
app.post('/api/login', /* sin requireAuth */ loginHandler);
```

---

### SEC-03 · CORS completamente abierto
**Archivo:** `backend/server.js` · Línea 7
**Prioridad:** 🔴 CRÍTICO

**Problema:**
`app.use(cors())` permite peticiones desde **cualquier origen** sin restricción. Esto significa que cualquier sitio web en internet puede hacer peticiones a la API con las credenciales del usuario si este ha iniciado sesión.

```js
app.use(cors()); // Acepta TODOS los orígenes
```

**Solución:**
Restringir a los orígenes conocidos (dominio propio o red local):

```js
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

---

### SEC-04 · Token de sesión inexistente — solo username en localStorage
**Archivo:** `frontend/src/App.js` · Línea 690, 831
**Prioridad:** 🔴 CRÍTICO

**Problema:**
El "login" solo guarda el objeto de usuario en `localStorage` con `useAutoSaveState`. No existe ningún token criptográfico. Cualquiera puede editar el `localStorage` en DevTools y cambiar su propio rol a `SUPERADMIN`:

```js
// Cualquiera puede hacer esto en la consola del navegador:
localStorage.setItem('wms_current_user', JSON.stringify({ username: 'hacker', role: 'SUPERADMIN' }))
```

**Solución:**
Al hacer login, el backend devuelve un JWT. El frontend lo almacena en `localStorage` (o mejor, en `httpOnly cookie`). Cada llamada a la API incluye el token en el header `Authorization`. El rol y permisos son validados en el backend, no en el frontend.

---

### SEC-05 · Inyección SQL posible en endpoint de historial de LPN
**Archivo:** `backend/server.js` · Línea 1034
**Prioridad:** 🔴 CRÍTICO

**Problema:**
El endpoint `GET /api/lpn/history/:lpnId` usa el parámetro directamente en un `ILIKE`. Si bien usa parámetro `$1`, el valor viene directamente de la URL sin ninguna validación de formato. Un LPN ID malicioso con caracteres especiales `%_` podría causar búsquedas extremadamente lentas (ReDoS en PostgreSQL).

Más grave: el endpoint no requiere autenticación (ver SEC-02), por lo que está completamente expuesto.

```js
pool.query(`SELECT * FROM audit_log WHERE glosa ILIKE $1`, [`%${req.params.lpnId}%`])
```

**Solución:**
Escapar los wildcards LIKE, validar el formato del LPN ID, y requerir autenticación:

```js
const safeLpnId = req.params.lpnId.replace(/[%_]/g, '\\$&');
pool.query(`SELECT * FROM audit_log WHERE glosa ILIKE $1 ESCAPE '\\'`, [`%${safeLpnId}%`])
```

---

### SEC-06 · Payload de importación sin límite de filas
**Archivo:** `backend/server.js` · Línea 449–565
**Prioridad:** 🟠 ALTO

**Problema:**
Los endpoints de importación `POST /api/import/*` aceptan archivos base64 de hasta 20MB (configuración de express.json). Un atacante puede subir un archivo con 1 millón de filas y saturar la base de datos o la memoria del servidor. Tampoco hay validación del tipo de archivo.

**Solución:**
Limitar el número de filas procesadas, validar que el archivo sea realmente XLSX/CSV, y añadir rate limiting:

```js
if (rows.length > 10000) return res.status(400).json({ error: 'Máximo 10.000 filas por importación' });
```

---

### SEC-07 · Endpoint de lectura de contraseñas en texto plano
**Archivo:** `backend/server.js` · Línea 1365–1373
**Prioridad:** 🟠 ALTO

**Problema:**
Existe un endpoint específico `/api/system/users/passwords` que devuelve todas las contraseñas en texto plano de todos los usuarios. Aunque requiere rol SUPERADMIN, la validación es por `requester` en el body (ver SEC-02).

```js
app.post('/api/system/users/passwords', async (req, res) => {
  // ...
  const users = await pool.query("SELECT username, full_name, role, password FROM users");
  res.json(users.rows); // ← contraseñas expuestas
})
```

**Solución:**
Eliminar este endpoint completamente. Si se necesita auditoría de usuarios, devolver solo metadatos sin contraseñas. Con bcrypt, este endpoint tampoco tendría sentido.

---

### SEC-08 · Validación de email/input ausente en creación de clientes y usuarios
**Archivo:** `backend/server.js` · Líneas 145–148, 86–108
**Prioridad:** 🟠 ALTO

**Problema:**
No se valida el formato del email al crear clientes, ni la complejidad mínima de contraseñas al crear usuarios. Se puede guardar `email: "no-es-un-email"` sin error.

**Solución:**
Agregar validación básica con regex o una librería como `validator`:
```js
if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  return res.status(400).json({ error: 'Email inválido' });
}
if (password && password.length < 8) {
  return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
}
```

---

### SEC-09 · Enumeración de usuarios en login
**Archivo:** `backend/server.js` · Línea 72–84
**Prioridad:** 🟡 MEDIO

**Problema:**
El endpoint de login devuelve errores distintos para "usuario no existe" vs "contraseña incorrecta" (implícitamente: `rows.length === 0` da el mismo error, pero el timing es diferente). Esto permite enumerar usuarios válidos midiendo tiempos de respuesta.

**Solución:**
Asegurarse de que el tiempo de respuesta sea constante independientemente de si el usuario existe o no. Con bcrypt, hacer `bcrypt.compare()` siempre (con un hash dummy si el usuario no existe) para equiparar tiempos.

---

### SEC-10 · Cuenta admin con contraseña hardcodeada en init
**Archivo:** `backend/server.js` · Línea 43 / `db-init/init.sql` · Línea 100–102
**Prioridad:** 🟡 MEDIO

**Problema:**
La contraseña `admin123` está hardcodeada en el código fuente. Si el repositorio es público o se hace visible, esta credencial queda expuesta.

**Solución:**
Leer la contraseña de una variable de entorno en init.sql/initDB:
```js
const adminPass = process.env.ADMIN_INITIAL_PASS || generateRandomPass();
```

---

## 2. RENDIMIENTO

---

### REN-01 · Polling cada 10 segundos trae TODOS los datos siempre
**Archivo:** `frontend/src/App.js` · Líneas 718–763
**Prioridad:** 🔴 CRÍTICO

**Problema:**
`fetchData()` se ejecuta cada 10 segundos e **instancia 11 peticiones HTTP simultáneas** que traen todo el inventario, SKUs, ubicaciones, auditlog, usuarios, kits, etc. Con 10.000 LPNs en inventario, esto descarga megabytes de datos cada 10 segundos de forma innecesaria en la mayoría de los casos.

```js
// Línea 762
useEffect(() => {
  fetchData();
  const interval = setInterval(fetchData, 10000); // 11 peticiones c/10s
  return () => clearInterval(interval);
}, [fetchData]);
```

**Solución (a elegir):**
1. **Inmediata:** Aumentar el intervalo a 30–60 segundos y solo refrescar cuando el tab activo lo necesite.
2. **Mejor:** Implementar WebSocket (socket.io) para push de cambios en tiempo real.
3. **Óptima:** Implementar invalidación selectiva por módulo — solo refrescar inventario cuando el tab de inventario esté activo.

```js
// Polling selectivo según tab activo
const REFRESH_INTERVAL = { inventory: 15000, dashboard: 30000, audit: 60000, default: 0 };
const interval = REFRESH_INTERVAL[activeTab] || REFRESH_INTERVAL.default;
```

---

### REN-02 · Query N+1 en creación de conteos cíclicos
**Archivo:** `backend/server.js` · Líneas 1155–1161
**Prioridad:** 🟠 ALTO

**Problema:**
Al crear un conteo cíclico, para cada ubicación se hace una query separada al inventario. Si hay 500 ubicaciones con stock, se ejecutan 500+ queries individuales en secuencia.

```js
for (const loc of locs.rows) {           // ← por cada ubicación
  const inv = await pool.query(          // ← query N+1
    `SELECT sku, SUM(qty)... WHERE location_id=$1`, [loc.location_id]
  );
  for (const item of inv.rows) {
    await pool.query(`INSERT INTO cycle_count_lines...`); // ← otro N+1
  }
}
```

**Solución:**
Usar una sola query con JOIN que traiga todo de una vez, y luego usar `INSERT ... VALUES` múltiple:

```sql
-- Una sola query
INSERT INTO cycle_count_lines (count_id, sku, location_id, expected_qty, status)
SELECT $1, sku, location_id, SUM(qty), 'PENDING'
FROM inventory_lpns
WHERE qty > 0 AND location_id ILIKE $2
GROUP BY sku, location_id
```

---

### REN-03 · Query N+1 en importación masiva (skus, clientes, inventario)
**Archivo:** `backend/server.js` · Líneas 453–480, 483–498, 500–518
**Prioridad:** 🟠 ALTO

**Problema:**
Los endpoints de importación procesan filas **una por una en un loop** con un `await pool.query()` por cada fila. Para 1.000 SKUs, esto ejecuta 1.000 queries secuenciales.

```js
for (let i = 0; i < rows.length; i++) {   // 1.000 iteraciones
  await pool.query(`INSERT INTO master_skus...`, [...]);  // 1.000 roundtrips a la DB
}
```

**Solución:**
Usar `INSERT ... VALUES ($1,$2), ($3,$4), ...` con múltiples filas por batch, o usar `COPY` para cargas masivas reales. Como mínimo, wrappear en una transacción para reducir el overhead de commit:

```js
const client = await pool.connect();
await client.query('BEGIN');
for (const r of rows) {
  await client.query(`INSERT...`, [...]);
}
await client.query('COMMIT');
```

---

### REN-04 · `GET /api/inventory` trae inventario completo sin paginación
**Archivo:** `backend/server.js` · Línea 54
**Prioridad:** 🟠 ALTO

**Problema:**
El inventario no tiene `LIMIT`. Con 50.000 LPNs en producción, esta query devuelve todo el inventario en cada petición (y se ejecuta cada 10 segundos por el polling).

```js
pool.query('SELECT i.*, s."desc"... FROM inventory_lpns i... WHERE i.qty > 0 ORDER BY...')
// Sin LIMIT ni paginación
```

**Solución:**
Agregar paginación en el backend (`LIMIT/OFFSET` o cursor) y filtros opcionales (`?sku=X&location=Y`). En el frontend, implementar tabla paginada en lugar de renderizar miles de filas.

---

### REN-05 · `handleGenerateLocs` hace N peticiones HTTP en loop
**Archivo:** `frontend/src/App.js` · Líneas 1089–1117
**Prioridad:** 🟡 MEDIO

**Problema:**
La generación de ubicaciones hace una petición HTTP individual por cada celda. Para una bodega de 3 pasillos × 10 columnas × 4 niveles = 120 peticiones HTTP consecutivas desde el frontend.

```js
for (let a = start; a <= end; a++) {
  for (let c = 1; c <= colCount; c++) {
    for (let l = 1; l <= levelCount; l++) {
      await fetch(`${host}/api/locations`, { method: 'POST', ... }); // N peticiones
    }
  }
}
```

**Solución:**
Crear un endpoint `POST /api/locations/bulk` que reciba un array de ubicaciones y las inserte en una sola transacción.

---

### REN-06 · Snapshot histórico hace múltiples queries pesadas en secuencia
**Archivo:** `backend/server.js` · Líneas 1086–1116
**Prioridad:** 🟡 MEDIO

**Problema:**
El endpoint `/api/inventory/snapshot` ejecuta 3 queries pesadas en secuencia (una sobre `inventory_lpns` y dos sobre `audit_log`) y luego procesa los resultados en JavaScript en memoria. Con muchos registros de auditoría, esto es muy lento.

**Solución:**
Consolidar las 3 queries en una sola query SQL con CTEs o calcular el snapshot directamente en SQL.

---

### REN-07 · DigitalTwinView filtra inventory en cada render con `.filter()` inline
**Archivo:** `frontend/src/App.js` · Línea 370–371
**Prioridad:** 🟡 MEDIO

**Problema:**
Dentro del render de cada celda del mapa 3D, se ejecuta `inventory.filter(...)`. Si hay 500 celdas y 5.000 items de inventario, esto son 2.5 millones de comparaciones en cada render del componente.

```js
// Dentro del render de cada celda:
let itemsInLoc = inventory.filter(inv => inv.location_id === locId); // O(n*m) por render
```

**Solución:**
Pre-calcular un `Map<locationId, items[]>` con `useMemo` que se recalcule solo cuando cambia el inventario:

```js
const inventoryByLocation = useMemo(() => {
  const map = new Map();
  inventory.forEach(inv => {
    if (!map.has(inv.location_id)) map.set(inv.location_id, []);
    map.get(inv.location_id).push(inv);
  });
  return map;
}, [inventory]);

// En el render: O(1)
let itemsInLoc = inventoryByLocation.get(locId) || [];
```

---

### REN-08 · `fetchData` se recrea en cada render por dependencias de `useCallback`
**Archivo:** `frontend/src/App.js` · Líneas 718–759
**Prioridad:** 🟡 MEDIO

**Problema:**
`fetchData` depende de `[host, currentUser]`. Pero dado que `currentUser` es un objeto almacenado en localStorage, si se reconstructye en cada ciclo (como objetos de React state), `fetchData` se invalidará y el intervalo del `useEffect` se reiniciará innecesariamente.

**Solución:**
Usar solo `currentUser?.username` como dependencia (string primitivo, no objeto) para minimizar re-creaciones:

```js
const fetchData = useCallback(async () => { ... }, [host, currentUser?.username]);
```

---

### REN-09 · `handleClearLocations` elimina ubicaciones una a una con N peticiones
**Archivo:** `frontend/src/App.js` · Líneas 1128–1142
**Prioridad:** 🟢 BAJO

**Problema:**
Al limpiar ubicaciones, se hace una petición DELETE por cada una. Con 1.000 ubicaciones, esto genera 1.000 peticiones HTTP.

**Solución:**
Crear un endpoint `DELETE /api/locations/bulk` que reciba un array de IDs o elimine todas las vacías en una sola query.

---

## 3. ESTABILIDAD

---

### EST-01 · Race condition en generación de LPN IDs basada en `Date.now()`
**Archivo:** `backend/server.js` · Líneas 178, 296, 509, 529
**Prioridad:** 🔴 CRÍTICO

**Problema:**
Los IDs de LPN se generan con `Date.now().toString().slice(-5)` más un número aleatorio. En operaciones concurrentes (múltiples recepciones simultáneas) o si dos LPNs se crean en el mismo milisegundo, existe probabilidad real de colisión de IDs, lo que causará un error de constraint PRIMARY KEY y rollback de la transacción.

```js
const lpnId = `LPN-${Date.now().toString().slice(-5)}-${Math.floor(Math.random()*1000)}`;
// Con .slice(-5) solo se usan los últimos 5 dígitos del timestamp
// Colisión posible en el mismo segundo con muchas operaciones
```

**Solución:**
Usar `gen_random_uuid()` de PostgreSQL o una librería como `uuid` en Node:

```js
const { v4: uuidv4 } = require('uuid');
const lpnId = `LPN-${uuidv4().slice(0,8).toUpperCase()}`;
// O directamente en SQL: gen_random_uuid()
```

---

### EST-02 · `import/dispatch` no usa transacción — stock puede quedar inconsistente
**Archivo:** `backend/server.js` · Líneas 540–565
**Prioridad:** 🔴 CRÍTICO

**Problema:**
El endpoint `POST /api/import/dispatch` procesa cada fila de forma independiente sin una transacción. Si falla en la fila 50 de 100, las primeras 49 ya están commiteadas y el stock quedará parcialmente deducido sin ninguna forma de rollback.

```js
app.post('/api/import/dispatch', async (req, res) => {
  // Sin BEGIN/COMMIT — cada query es autocommit
  for (let i = 0; i < rows.length; i++) {
    await pool.query(`UPDATE inventory_lpns SET qty=qty-$1...`);
    // Si esto falla en fila 50, las filas 1-49 ya se commitearon
  }
});
```

Lo mismo aplica a `POST /api/import/inventory` y `POST /api/import/receive`.

**Solución:**
Wrappear toda la operación en una transacción:

```js
const client = await pool.connect();
try {
  await client.query('BEGIN');
  for (const r of rows) { ... }
  await client.query('COMMIT');
} catch(e) {
  await client.query('ROLLBACK');
  throw e;
} finally { client.release(); }
```

---

### EST-03 · `initDB()` puede fallar silenciosamente sin reintentos
**Archivo:** `backend/server.js` · Líneas 17–52
**Prioridad:** 🟠 ALTO

**Problema:**
Si la base de datos no está lista cuando el backend inicia (lo cual es normal en Docker Compose), `initDB()` falla silenciosamente. El servidor arranca igual pero las tablas pueden no existir, causando errores en runtime.

```js
} catch (err) {
  console.error("❌ Error Crítico al iniciar DB:", err.message);
  // El servidor sigue arrancando aunque la DB no esté lista
}
```

**Solución:**
Implementar retry con backoff exponencial:

```js
const initDB = async (retries = 5, delay = 2000) => {
  try {
    await pool.query('SELECT 1'); // Verificar conectividad
    // ... crear tablas
  } catch(err) {
    if (retries > 0) {
      console.log(`⏳ DB no disponible, reintentando en ${delay/1000}s... (${retries} intentos)`);
      await new Promise(r => setTimeout(r, delay));
      return initDB(retries - 1, delay * 2);
    }
    console.error('❌ No se pudo conectar a la BD. Terminando.');
    process.exit(1);
  }
};
```

---

### EST-04 · Race condition en conteos cíclicos — `expected_qty` puede ser stale
**Archivo:** `backend/server.js` · Líneas 1155–1161
**Prioridad:** 🟠 ALTO

**Problema:**
Las líneas del conteo cíclico se crean con la cantidad "esperada" en el momento de creación. Si entre la creación del conteo y el momento en que el operario cuenta hay movimientos de stock (recepciones, despachos), la `expected_qty` ya no refleja la realidad y las diferencias serán incorrectas.

**Solución:**
Hacer el snapshot con `FOR SHARE` para leer cantidades consistentes, o documentar claramente que el conteo cíclico "congela" el stock al momento de creación (comportamiento esperado en WMS industriales).

---

### EST-05 · `canView` tiene dependencias faltantes en `useCallback`
**Archivo:** `frontend/src/App.js` · Línea 765
**Prioridad:** 🟠 ALTO

**Problema:**
La función `canView` usa `disabledModules` y `licenseModules` pero estas no están en el array de dependencias del `useCallback`, por lo que puede usar valores obsoletos cuando los módulos se actualizan.

```js
const canView = useCallback((tabId) => {
  // Usa disabledModules y licenseModules...
  if (disabledModules.includes(tabId)) return false;
  if (licenseModules.length > 0 && ...) return false;
}, [currentUser]); // ← falta disabledModules y licenseModules
```

**Solución:**
```js
}, [currentUser, disabledModules, licenseModules]);
```

---

### EST-06 · Workspaces en localStorage pueden corromperse con datos del servidor obsoletos
**Archivo:** `frontend/src/App.js` · Línea 843
**Prioridad:** 🟠 ALTO

**Problema:**
Los documentos "en proceso" (workspaces) se guardan en `localStorage` con referencias a LPN IDs y cantidades. Si un LPN fue consumido por otro usuario entre sesiones, el workspace queda con datos inconsistentes y al commitearlo generará un error de "condición de carrera".

Esto se mitiga parcialmente con `validateRealTimeStock()`, pero dicha validación solo se llama en algunos flujos, no en todos.

**Solución:**
Llamar `validateRealTimeStock()` siempre antes de permitir el commit de cualquier documento, no solo en el flujo de despacho. Mostrar advertencia visual cuando un LPN referenciado ya no está disponible.

---

### EST-07 · `POST /api/purchase-orders/:id/receive` no crea los LPNs en inventario
**Archivo:** `backend/server.js` · Líneas 882–905
**Prioridad:** 🟠 ALTO

**Problema:**
El endpoint de recepción contra OC solo actualiza el estado de las líneas de la OC (`purchase_order_lines`) pero **no crea registros en `inventory_lpns`**. La mercancía recibida no entra al stock físico.

**Solución:**
Agregar el `INSERT INTO inventory_lpns` correspondiente dentro de la transacción, similar a `receive_batch`.

---

### EST-08 · `ALTER TABLE` en cada request a endpoints críticos
**Archivo:** `backend/server.js` · Líneas 964–966, 1002–1003, 1012–1013
**Prioridad:** 🟡 MEDIO

**Problema:**
Varios endpoints ejecutan `ALTER TABLE ADD COLUMN IF NOT EXISTS` en cada llamada como mecanismo de migración lazy. Esto es una query DDL que toma un lock en la tabla y puede causar problemas de rendimiento en producción.

```js
// Se ejecuta en CADA llamada a GET /api/alerts/stock
app.get('/api/alerts/stock', async (req, res) => {
  await pool.query(`ALTER TABLE master_skus ADD COLUMN IF NOT EXISTS stock_min...`)
  await pool.query(`ALTER TABLE master_skus ADD COLUMN IF NOT EXISTS stock_max...`)
  // ...
```

**Solución:**
Mover todas las migraciones a `initDB()` o a scripts de migración dedicados. Los endpoints no deben ejecutar DDL.

---

### EST-09 · Sin manejo de errores en `handleCommitAPI` cuando el servidor devuelve un error no JSON
**Archivo:** `frontend/src/App.js` · Líneas 1038–1053
**Prioridad:** 🟡 MEDIO

**Problema:**
Si el servidor devuelve un error 502 (nginx down), el body no será JSON y `res.json()` lanzará una excepción que no está capturada en el `else { const error = await res.json() }`.

```js
else { const error = await res.json(); showMsg(`⛔ ${error.error}`, true); }
// Si el body no es JSON, esto lanza una excepción no capturada
```

**Solución:**
```js
else {
  let errorMsg = `Error ${res.status}`;
  try { const err = await res.json(); errorMsg = err.error || errorMsg; } catch(e) {}
  showMsg(`⛔ ${errorMsg}`, true);
}
```

---

### EST-10 · `billing report` usa `$1` para el `client_id` y como parámetro de ILIKE en misma query
**Archivo:** `backend/server.js` · Líneas 658–673
**Prioridad:** 🟡 MEDIO

**Problema:**
La query de billing usa `$1` ambiguamente — primero como parámetro ILIKE para la glosa, luego como `client_id` para el subquery de inventario. Esto es semánticamente confuso y potencialmente incorrecto:

```sql
WHERE a.username != 'SYSTEM'
  AND (a.glosa ILIKE $1            -- $1 = client_id usado como patrón ILIKE (?!)
    OR a.sku IN (
      SELECT DISTINCT sku FROM inventory_lpns WHERE client_id = $1  -- $1 = client_id OK
    ))
```

El `ILIKE $1` donde `$1` es un `client_id` como `"CLIENTE_ABC"` buscaría glosas que contengan "CLIENTE_ABC", lo cual es incorrecto para filtrar movimientos de un cliente.

**Solución:**
Corregir la lógica de filtrado de movimientos por cliente usando solo el subquery de inventory_lpns, y añadir un parámetro separado para el período.

---

### EST-11 · `canView` es llamado como función dentro de otro `useCallback` sin estar en las deps
**Archivo:** `frontend/src/App.js` · Líneas 787–792
**Prioridad:** 🟢 BAJO

**Problema:**
El `useEffect` que redirige tabs usa `canView` pero este no está en sus dependencias:
```js
useEffect(() => {
  if (!canView(activeTab) ...) { ... }
}, [activeTab, currentUser, canView]); // canView SÍ está aquí — OK
```
Este en particular está correcto, pero hay otros `useCallback` que usan `canView` sin declararlo como dependencia.

---

### EST-12 · Falta validación de `qty > 0` en importación masiva de inventario
**Archivo:** `backend/server.js` · Línea 507
**Prioridad:** 🟢 BAJO

**Problema:**
La importación de inventario valida que exista `r.qty` pero no que sea mayor a 0. Un archivo con `qty: -5` o `qty: 0` pasaría la validación y crearía registros inválidos (el constraint `CHECK (qty >= 0)` de la DB lo rechazaría pero el error sería confuso).

**Solución:**
```js
if (!r.sku || !r.qty || parseFloat(r.qty) <= 0) {
  results.errors.push(`Fila ${i+2}: SKU y cantidad > 0 son obligatorios`);
  continue;
}
```

---

## 4. UX/UI

---

### UX-01 · No hay confirmación al despachar — operación irreversible sin aviso
**Archivo:** `frontend/src/App.js` · Líneas 1055–1070
**Prioridad:** 🟠 ALTO

**Problema:**
El despacho parcial `handleCommitDispatchPartial` modifica el stock permanentemente. Aunque existe un modal de confirmación para cantidades, no hay un paso de "¿Está seguro?" explícito con resumen de lo que se va a despachar antes de ejecutarlo.

**Solución:**
Mostrar un resumen de "Va a despachar X items de Y SKUs por valor total de Z unidades. ¿Confirmar?" antes de ejecutar.

---

### UX-02 · Mensajes de error del servidor expuestos directamente al usuario
**Archivo:** `frontend/src/App.js` · Múltiples lugares
**Prioridad:** 🟠 ALTO

**Problema:**
Los mensajes de error técnicos de PostgreSQL se muestran directamente al usuario:
```js
showMsg(`⛔ ${err.error}`, true);
// Puede mostrar: "duplicate key value violates unique constraint 'master_skus_pkey'"
```

Estos mensajes son incomprensibles para usuarios no técnicos y pueden revelar información de la estructura interna de la BD.

**Solución:**
Mapear errores conocidos a mensajes amigables en el backend:
```js
if (err.code === '23505') return res.status(400).json({ error: 'Este registro ya existe.' });
if (err.code === '23503') return res.status(400).json({ error: 'Referencia inválida.' });
```

---

### UX-03 · Formulario de SKU no tiene validación visual en tiempo real
**Archivo:** `frontend/src/App.js` · Línea 1147
**Prioridad:** 🟠 ALTO

**Problema:**
El formulario del maestro SKU no muestra ningún indicador visual de error hasta que el servidor responde. Si el usuario deja campos obligatorios vacíos, solo se entera después del submit.

**Solución:**
Agregar validación en tiempo real (onBlur o onChange) con indicadores visuales:
```jsx
<input
  className={`... ${!skuForm.sku && submitted ? 'border-red-500' : 'border-slate-200'}`}
/>
{!skuForm.sku && submitted && <p className="text-red-500 text-xs mt-1">Campo obligatorio</p>}
```

---

### UX-04 · Operación "Limpiar todas las ubicaciones" solo tiene un `window.confirm`
**Archivo:** `frontend/src/App.js` · Línea 1128
**Prioridad:** 🟠 ALTO

**Problema:**
La operación destructiva de limpiar ubicaciones usa `window.confirm` nativo del navegador, que es inconsistente con el diseño del resto de la app y fácil de aceptar por accidente.

**Solución:**
Usar un modal de confirmación personalizado (similar al DispatchConfirm ya existente) con texto de advertencia prominente y un campo de confirmación escrita ("escribe BORRAR para confirmar").

---

### UX-05 · No hay indicador de "guardando" al hacer operaciones CRUD en maestros
**Archivo:** `frontend/src/App.js` · Múltiples handlers
**Prioridad:** 🟡 MEDIO

**Problema:**
Los botones de "Guardar" en formularios de SKU, cliente, estado, etc., no tienen estado loading. Si la operación tarda (latencia alta), el usuario puede hacer doble clic y enviar el formulario dos veces, creando duplicados.

**Solución:**
Agregar estado `isSaving` a cada formulario crítico y deshabilitar el botón durante la operación.

---

### UX-06 · Los workspaces "en proceso" no muestran antigüedad real
**Archivo:** `frontend/src/App.js` · Línea 153
**Prioridad:** 🟡 MEDIO

**Problema:**
Las tarjetas de documentos en proceso muestran `d.createdAt` como string formateado al crearlo, pero no hay indicación de si ese documento tiene horas o días de antigüedad. Un documento olvidado de hace 3 días se ve igual que uno recién creado.

**Solución:**
Mostrar el tiempo relativo ("hace 2 horas", "hace 3 días") y añadir color de advertencia para documentos de más de 24 horas.

---

### UX-07 · Tabla de inventario sin paginación — con muchos LPNs se vuelve inutilizable
**Archivo:** `frontend/src/App.js` · módulo inventory
**Prioridad:** 🟡 MEDIO

**Problema:**
La tabla de stock físico renderiza todos los LPNs disponibles sin paginación ni virtualización. Con 5.000+ LPNs, el DOM tiene miles de filas y el scroll se vuelve muy lento.

**Solución:**
Implementar paginación del lado del servidor (ver REN-04) y mostrar máximo 50-100 filas por página con controles de paginación.

---

### UX-08 · El input de barcode no tiene autofocus cuando se activa el modo scanner
**Archivo:** `frontend/src/App.js` · Líneas 1230–1247
**Prioridad:** 🟡 MEDIO

**Problema:**
Al activar el modo scanner (`isScanning = true`), el input de código de barras no recibe el foco automáticamente. El operario debe hacer clic en el input manualmente después de activar el scanner, lo que ralentiza el flujo de trabajo.

**Solución:**
```jsx
const barcodeRef = useRef(null);
useEffect(() => {
  if (isScanning) barcodeRef.current?.focus();
}, [isScanning]);
```

---

### UX-09 · Errores en importación masiva no exportables
**Archivo:** `frontend/src/App.js` · Líneas 673–678
**Prioridad:** 🟢 BAJO

**Problema:**
Cuando una importación masiva de 500 filas tiene 47 errores, estos se muestran en un panel scrollable limitado a `max-h-48`. No hay forma de exportar la lista de errores para corregir el archivo fuente.

**Solución:**
Agregar botón "Descargar errores como CSV" que genere un archivo con las filas con error y su motivo.

---

### UX-10 · Título del sistema fijo como "WMS Enterprise" aunque exista `system_name` en config
**Archivo:** `frontend/src/App.js` · UI en general
**Prioridad:** 🟢 BAJO

**Problema:**
La configuración del sistema tiene `system_name` pero el sidebar y la pantalla de login siempre muestran "WMS Enterprise" hardcodeado.

**Solución:**
Usar `systemConfig.system_name || 'WMS Enterprise'` en los textos del sidebar y login.

---

## 5. CÓDIGO

---

### COD-01 · `App.js` es un monolito de 4500+ líneas — imposible de mantener
**Archivo:** `frontend/src/App.js` · Todo el archivo
**Prioridad:** 🟠 ALTO

**Problema:**
Todo el frontend está en un único archivo de >4500 líneas. Esto hace que:
- Cada cambio requiere que el compilador reprocese el archivo completo
- Encontrar código es difícil incluso con búsqueda
- Los componentes no tienen tests unitarios posibles
- Git blame y diffs son casi ilegibles
- Cualquier error de sintaxis tumba toda la app

**Solución:**
Separar en componentes por módulo en archivos independientes:
```
src/
  components/
    inventory/InventoryTable.jsx
    inventory/InventoryFilters.jsx
    receive/DocTrayView.jsx
    receive/ReceiveLine.jsx
    skus/SkuForm.jsx
    ...
  hooks/
    useInventory.js
    useWorkspace.js
  App.js  ← solo routing y layout
```

---

### COD-02 · `server.js` tiene ~1440 líneas — debería separarse en routers
**Archivo:** `backend/server.js` · Todo el archivo
**Prioridad:** 🟠 ALTO

**Problema:**
Similar al frontend, todo el backend está en un único archivo. Agregar nuevas funcionalidades implica editar un archivo enorme con alto riesgo de conflictos.

**Solución:**
Separar en Express Routers por dominio:
```
backend/
  routes/
    auth.js
    inventory.js
    receive.js
    dispatch.js
    skus.js
    users.js
    system.js
  middleware/
    auth.js
  server.js  ← solo app.use(router)
```

---

### COD-03 · Lógica de generación de LPN ID duplicada en 6+ lugares
**Archivo:** `backend/server.js` · Líneas 178, 268, 296, 509, 529, 1204
**Prioridad:** 🟡 MEDIO

**Problema:**
El patrón de generación de IDs está copiado y pegado con variaciones:
```js
`LPN-${Date.now().toString().slice(-5)}-${Math.floor(Math.random()*1000)}`
`SPLIT-${Date.now().toString().slice(-5)}-${Math.floor(Math.random()*100)}`
`ADJ-${Date.now().toString().slice(-5)}-${Math.floor(Math.random()*1000)}`
`IMP-${Date.now().toString().slice(-5)}-${Math.floor(Math.random()*1000)}`
`REC-${Date.now().toString().slice(-6)}-${Math.floor(Math.random()*100)}`
`CC-ADJ-${Date.now()}-${Math.floor(Math.random()*1000)}`
```

**Solución:**
Centralizar en una función helper:
```js
const generateLpnId = (prefix = 'LPN') =>
  `${prefix}-${Date.now().toString(36).toUpperCase().slice(-6)}-${Math.random().toString(36).slice(-4).toUpperCase()}`;
```

---

### COD-04 · Patrón `CREATE TABLE IF NOT EXISTS` repetido en cada endpoint GET
**Archivo:** `backend/server.js` · Líneas 781, 844, 939, 1169, 1321
**Prioridad:** 🟡 MEDIO

**Problema:**
Múltiples endpoints GET ejecutan `CREATE TABLE IF NOT EXISTS` antes de su query principal. Esto es un anti-patrón: DDL no debería ejecutarse en endpoints de lectura, y genera confusión sobre cuándo se crean las tablas.

```js
app.get('/api/purchase-orders', async (req, res) => {
  await pool.query(`CREATE TABLE IF NOT EXISTS purchase_orders (...)`).catch(()=>null);
  // ... luego hace el SELECT
```

**Solución:**
Mover TODAS las creaciones de tablas a `initDB()` y eliminarlas de los endpoints.

---

### COD-05 · `switchTab` resetea estado que no siempre necesita resetearse
**Archivo:** `frontend/src/App.js` · Líneas 970–986
**Prioridad:** 🟡 MEDIO

**Problema:**
`switchTab` resetea 12+ estados (formularios, filtros, etc.) cada vez que el usuario cambia de tab. Esto significa que si el usuario está llenando un formulario de SKU, cambia de tab accidentalmente y vuelve, **pierde todo lo que escribió**.

**Solución:**
Solo resetear el estado del documento activo (`activeDocId`) y la selección de línea. Dejar los formularios y filtros con sus valores para que el usuario pueda retomar el trabajo.

---

### COD-06 · Los `useAutoSaveState` con arrays/objetos pueden causar re-renders infinitos
**Archivo:** `frontend/src/App.js` · Línea 33–40
**Prioridad:** 🟡 MEDIO

**Problema:**
El hook `useAutoSaveState` persiste cualquier cambio de estado en `localStorage`. Para el estado `workspaces` que contiene documentos completos, esto significa que en cada keystroke o cambio de línea se serializa y escribe en localStorage, lo cual es costoso.

```js
useEffect(() => {
  localStorage.setItem(key, JSON.stringify(state)); // Ejecuta en cada cambio de state
}, [key, state]);
```

**Solución:**
Usar debounce para la escritura en localStorage, especialmente para estados que cambian frecuentemente:
```js
useEffect(() => {
  const timer = setTimeout(() => localStorage.setItem(key, JSON.stringify(state)), 500);
  return () => clearTimeout(timer);
}, [key, state]);
```

---

### COD-07 · Importación de Lucide React con 60+ íconos desde el mismo paquete
**Archivo:** `frontend/src/App.js` · Líneas 2–7
**Prioridad:** 🟡 MEDIO

**Problema:**
Se importan más de 60 íconos de lucide-react en una sola línea. Si el bundler (Vite/CRA) no hace tree-shaking correctamente, se incluye todo el paquete en el bundle.

```js
import { LayoutDashboard, Package, Box, Map as MapIcon, ArrowDownRight,
  ArrowUpRight, Search, CheckCircle2, X, FileText, ... /* 60+ íconos */ }
```

**Solución:**
Verificar que el bundler esté haciendo tree-shaking. Si no, importar íconos individualmente desde sus sub-paths:
```js
import { LayoutDashboard } from 'lucide-react/dist/esm/icons/layout-dashboard';
```

---

### COD-08 · Tailwind CSS cargado via CDN en producción — no optimizado
**Archivo:** `frontend/src/App.js` · Líneas 9–18
**Prioridad:** 🟡 MEDIO

**Problema:**
Tailwind se carga desde CDN (`cdn.tailwindcss.com`) en cada carga de página. Esto:
1. Añade dependencia de red externa
2. Carga el runtime completo de Tailwind (~400KB sin minificar)
3. Genera estilos dinámicamente en el navegador en lugar de una hoja CSS optimizada

**Solución:**
Integrar Tailwind como dependencia de PostCSS durante el build. En el `package.json` del frontend:
```
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init
```

---

### COD-09 · `showMsg` no usa `useCallback` — se recrea en cada render
**Archivo:** `frontend/src/App.js` · Línea 794
**Prioridad:** 🟢 BAJO

**Problema:**
`showMsg` se define como función regular dentro del componente, no como `useCallback`. Se recrea en cada render y puede causar re-renders innecesarios en componentes hijo que la reciban como prop.

**Solución:**
```js
const showMsg = useCallback((text, isError = false) => {
  setMsg({ text, isError });
  setTimeout(() => setMsg(''), 5000);
}, []);
```

---

### COD-10 · `skuForm.traceability` es un campo derivado que diverge del modelo
**Archivo:** `frontend/src/App.js` · Líneas 42, 1148
**Prioridad:** 🟢 BAJO

**Problema:**
El formulario de SKU usa un campo `traceability: 'NONE'|'LOT'|'SERIAL'` que es un campo UI artificial. Al hacer submit, se convierte a `requires_lot/requires_serial`. Al editar un SKU existente, se hace la conversión inversa. Esta doble transformación puede tener bugs si se añaden nuevos tipos de trazabilidad.

**Solución:**
Usar directamente `requires_lot: false, requires_serial: false` en el `skuForm` y mostrar radios/checkboxes que mapeen a estos booleans directamente. Eliminar la capa de abstracción innecesaria.

---

## PLAN DE ACCIÓN SUGERIDO

### Fase 1 — CRÍTICO (implementar antes de ir a producción real)
1. **SEC-01** Hash de contraseñas con bcrypt
2. **SEC-02** Middleware de autenticación JWT
3. **SEC-03** Restringir CORS
4. **SEC-04** Tokens de sesión real (JWT en frontend)
5. **SEC-05** Escapar wildcards en LIKE
6. **EST-01** UUIDs para LPN IDs
7. **EST-02** Transacción en import/dispatch

### Fase 2 — ALTO (sprint siguiente)
8. **SEC-06** Rate limiting + límite de filas en imports
9. **SEC-07** Eliminar endpoint de contraseñas
10. **REN-01** Reducir polling / selectivizar fetches
11. **REN-04** Paginación en inventario
12. **EST-03** Retry con backoff en initDB
13. **EST-07** Crear LPNs al recibir contra OC

### Fase 3 — MEDIO (deuda técnica planificada)
14. **COD-01/02** Separar en módulos/routers
15. **REN-02/03** Eliminar N+1 queries
16. **EST-08** Mover DDL fuera de endpoints
17. **UX-02** Mapear errores de DB a mensajes amigables

---

*Reporte generado por análisis estático del código fuente. Prioridades basadas en impacto potencial y probabilidad de ocurrencia en un ambiente de producción WMS.*
