// Instancia de demostración pública (DEMO_INSTANCE=true): datos ficticios, un
// usuario por rol, funciones peligrosas bloqueadas y reinicio nocturno.
//
// Es distinta del sandbox (DEMO_SANDBOX): aquí la app funciona de verdad contra su
// propia base, que solo contiene datos inventados y se recarga cada noche.
//
// Protección: el reinicio vacía TODA la base. Solo se ejecuta si la base tiene la
// marca de demo (system_config.demo_instance_marker), que pone la propia carga de
// datos. La carga inicial automática solo ocurre en una base sin clientes ni stock.
// Activar DEMO_INSTANCE por error en una instalación real no borra nada.
const bcrypt = require('bcryptjs');
const { genLpnId } = require('./helpers');

const DEMO_INSTANCE = process.env.DEMO_INSTANCE === 'true';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo-wms-2026';
const DEMO_RESET_HOUR = Number.isInteger(Number(process.env.DEMO_RESET_HOUR)) ? Number(process.env.DEMO_RESET_HOUR) : 4;
const MARKER_KEY = 'demo_instance_marker';

// Un usuario por rol real del WMS.
const DEMO_USERS = [
  { username: 'demo.admin', full_name: 'Administración (demo)', role: 'ADMIN' },
  { username: 'demo.jefe', full_name: 'Jefatura de bodega (demo)', role: 'JEFE_BODEGA' },
  { username: 'demo.ejecutivo', full_name: 'Ejecutivo de cuenta (demo)', role: 'EJECUTIVO_CUENTA', clientes: ['ANDES', 'NORTE'] },
  { username: 'demo.transporte', full_name: 'Coordinación de transporte (demo)', role: 'COORDINADOR_TRANSPORTE' },
  { username: 'demo.auditor', full_name: 'Auditoría (demo)', role: 'AUDITOR' },
  { username: 'demo.picker', full_name: 'Operario de picking (demo)', role: 'PICKER' },
  { username: 'demo.cliente', full_name: 'Cliente Comercial Andes (demo)', role: 'CLIENTE', clientes: ['ANDES'] },
];

// ── Bloqueo de funciones peligrosas ──────────────────────────────────────────
// Respaldos, gestión de usuarios y claves, configuración del sistema, borrados de
// maestros y masivos, y portal de clientes (contraseñas).
const BLOQUEOS = [
  { metodos: null, re: /^\/system\/backups?(\/|$)/ },
  { metodos: null, re: /^\/login-history$/ }, // IP de los visitantes
  { metodos: 'escritura', re: /^\/system\/(?!maintenance\/check$)/ },
  { metodos: 'escritura', re: /^\/users(\/|$)/ },
  { metodos: 'escritura', re: /^\/keys(\/|$)/ },
  { metodos: 'escritura', re: /^\/clients\/[^/]+\/portal$/ },
  { metodos: 'escritura', re: /^\/locations\/bulk-delete$/ },
  { metodos: ['DELETE'], re: /^\/locations\/bulk$/ },
  { metodos: ['DELETE'], re: /^\/(clients|statuses|document_types|manufacturers)\/[^/]+$/ },
];
const esEscritura = (m) => !['GET', 'HEAD', 'OPTIONS'].includes(m);

function demoInstanceGuard(req, res, next) {
  if (!DEMO_INSTANCE) return next();
  // Express enruta sin distinguir mayúsculas ni barras repetidas: se normaliza igual.
  const ruta = req.path.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  const bloqueado = BLOQUEOS.some(({ metodos, re }) => re.test(ruta) && (
    metodos === null || (metodos === 'escritura' ? esEscritura(req.method) : metodos.includes(req.method))
  ));
  if (!bloqueado) return next();
  return res.status(403).json({ error: 'Función deshabilitada en la demostración.', demo_instance: true });
}

// ── Datos ficticios ──────────────────────────────────────────────────────────
const CLIENTES = [
  { id: 'ANDES', name: 'Comercial Andes Ltda.', contact: 'María Soto', email: 'contacto@andes.example' },
  { id: 'NORTE', name: 'Distribuidora Norte SpA', contact: 'Jorge Rivas', email: 'bodega@norte.example' },
  { id: 'VERDE', name: 'Alimentos Verde S.A.', contact: 'Paula Fuentes', email: 'logistica@verde.example' },
];
const SKUS = [
  ['ANDES', 'AND-TV50', 'Televisor 50" 4K', 'Electrónica', 'UN', 14.5, false, true],
  ['ANDES', 'AND-NOTE14', 'Notebook 14" 16GB', 'Electrónica', 'UN', 1.6, false, true],
  ['ANDES', 'AND-AUDIF', 'Audífonos inalámbricos', 'Electrónica', 'UN', 0.3, false, false],
  ['ANDES', 'AND-CARG', 'Cargador USB-C 65W', 'Accesorios', 'UN', 0.2, false, false],
  ['NORTE', 'NOR-TALADRO', 'Taladro percutor 800W', 'Herramientas', 'UN', 2.4, false, false],
  ['NORTE', 'NOR-PINTURA', 'Pintura látex 1 galón', 'Construcción', 'UN', 4.2, true, false],
  ['NORTE', 'NOR-TORN', 'Caja tornillos 6x1" (500 u.)', 'Ferretería', 'CJ', 3.1, false, false],
  ['NORTE', 'NOR-GUANTE', 'Guantes de seguridad', 'Seguridad', 'PAR', 0.1, false, false],
  ['VERDE', 'VER-ACEITE', 'Aceite de oliva 1 L', 'Abarrotes', 'UN', 0.95, true, false],
  ['VERDE', 'VER-ARROZ', 'Arroz grado 1 5 kg', 'Abarrotes', 'UN', 5, true, false],
  ['VERDE', 'VER-CAFE', 'Café grano 1 kg', 'Abarrotes', 'UN', 1, true, false],
  ['VERDE', 'VER-JUGO', 'Jugo natural 1 L (caja 12)', 'Bebidas', 'CJ', 12.5, true, false],
];

const diasDesdeHoy = (d) => { const f = new Date(); f.setDate(f.getDate() + d); return f.toISOString().slice(0, 10); };

async function cargarDatos(db) {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await db.query(
    `INSERT INTO system_config (key, value, updated_by) VALUES ($1,'true','demo'), ('operation_mode','3PL','demo')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [MARKER_KEY]);

  for (const c of CLIENTES) {
    await db.query('INSERT INTO clients (id, name, contact, email) VALUES ($1,$2,$3,$4)', [c.id, c.name, c.contact, c.email]);
  }
  for (const u of DEMO_USERS) {
    await db.query(
      `INSERT INTO users (username, full_name, password, role, status, allowed_clients, allowed_modules, client_scope)
       VALUES ($1,$2,$3,$4,'ACTIVE','ALL','ALL',$5)`,
      [u.username, u.full_name, hash, u.role, u.clientes ? 'assigned' : 'all']);
    for (const c of u.clientes || []) {
      await db.query('INSERT INTO user_clients (username, client_id, assigned_by) VALUES ($1,$2,$3)', [u.username, c, 'demo']);
    }
  }

  // Ubicaciones: 3 pasillos × 4 módulos × 2 niveles, más recepción y despacho.
  const ubicaciones = ['PISO-RECEPCION'];
  await db.query(`INSERT INTO locations_master (location_id, zone_code, loc_type) VALUES ('ANDEN-DESPACHO','DESPACHO','PISO') ON CONFLICT DO NOTHING`);
  for (const pasillo of ['A', 'B', 'C']) {
    for (let modulo = 1; modulo <= 4; modulo++) {
      for (let nivel = 1; nivel <= 2; nivel++) {
        const id = `${pasillo}-${String(modulo).padStart(2, '0')}-${nivel}`;
        ubicaciones.push(id);
        await db.query(
          `INSERT INTO locations_master (location_id, zone_code, aisle, row_num, level, loc_type) VALUES ($1,$2,$3,$4,$5,'PALLET')
           ON CONFLICT (location_id) DO NOTHING`,
          [id, `ZONA-${pasillo}`, pasillo, modulo, nivel]);
      }
    }
  }

  for (const [cliente, sku, desc, cat, uom, peso, lote, serie] of SKUS) {
    await db.query(
      `INSERT INTO master_skus (sku, client_id, "desc", category, uom, weight, requires_lot, requires_serial, stock_min)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [sku, cliente, desc, cat, uom, peso, lote, serie, serie ? 0 : 20]);
  }

  // Stock inicial con su kardex. Los serializados entran de a una unidad por serie.
  let i = 0;
  for (const [cliente, sku, , , , , lote, serie] of SKUS) {
    const ubic = ubicaciones[1 + (i++ % (ubicaciones.length - 1))];
    const unidades = serie ? 4 : 30 + (i * 7) % 90;
    const lpns = serie
      ? Array.from({ length: unidades }, (_, n) => ({ qty: 1, serial: `${sku}-SN${1000 + n}` }))
      : [{ qty: unidades, serial: null }];
    for (const l of lpns) {
      const lpnId = genLpnId('LPN');
      const loteN = lote ? `L${diasDesdeHoy(-20).replace(/-/g, '')}` : null;
      // Algunos lotes vencen pronto para mostrar las alertas de vencimiento.
      const vence = lote ? diasDesdeHoy(i % 3 === 0 ? 12 : 180) : null;
      await db.query(
        `INSERT INTO inventory_lpns (id, sku, qty, client_id, status, batch_number, expiry_date, serial_number, location_id, glosa, created_at)
         VALUES ($1,$2,$3,$4,'DISPONIBLE',$5,$6,$7,$8,'Carga inicial demo', NOW() - ($9 || ' days')::interval)`,
        [lpnId, sku, l.qty, cliente, loteN, vence, l.serial, ubic, String(5 + i)]);
      await db.query(
        `INSERT INTO audit_log (type, sku, qty, glosa, username, client_id, created_at)
         VALUES ('INBOUND',$1,$2,$3,'demo.jefe',$4, NOW() - ($5 || ' days')::interval)`,
        [sku, l.qty, `Doc: [GUIA] DEMO-INI. LPN: ${lpnId}`, cliente, String(5 + i)]);
    }
  }

  // Una OC pendiente, un aviso de llegada y una devolución por inspeccionar.
  await db.query(
    `INSERT INTO purchase_orders (id, doc_num, supplier, client_id, status, created_by, expected_date, notes)
     VALUES ('OC-DEMO-1','OC-1001','Importadora Pacífico','ANDES','PENDING','demo.ejecutivo',$1,'Reposición mensual')`, [diasDesdeHoy(2)]);
  await db.query(
    `INSERT INTO purchase_order_lines (po_id, sku, expected_qty, status) VALUES ('OC-DEMO-1','AND-AUDIF',40,'PENDING'), ('OC-DEMO-1','AND-CARG',60,'PENDING')`);
  await db.query(
    `INSERT INTO suppliers (id, name, rut, contact_name, status) VALUES ('SUP-PAC','Importadora Pacífico','76.123.456-7','Luis Mena','ACTIVE')
     ON CONFLICT (id) DO NOTHING`);
  await db.query(
    `INSERT INTO asns (id, supplier_id, supplier_name, expected_date, reference, created_by, client_id)
     VALUES ('ASN-DEMO-1','SUP-PAC','Importadora Pacífico',$1,'ASN-2001','demo.jefe','NORTE')`, [diasDesdeHoy(1)]);
  await db.query(`INSERT INTO asn_lines (asn_id, sku, qty_expected) VALUES ('ASN-DEMO-1','NOR-TALADRO',25), ('ASN-DEMO-1','NOR-GUANTE',200)`);
  await db.query(
    `INSERT INTO carriers (id, name, rut, contact, phone, active) VALUES ('TR-SUR','Transportes del Sur','77.654.321-0','Pedro Lagos','+56 9 0000 0000',TRUE)
     ON CONFLICT (id) DO NOTHING`);
}

// Catálogos base y configuración: se conservan al reiniciar (como el formateo de fábrica).
const PRESERVAR = ['statuses', 'document_types', 'system_config'];

// Vacía la base y vuelve a cargar los datos ficticios, todo en una transacción.
async function resetDemo(pool, { force = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!force) {
      const marca = await client.query('SELECT 1 FROM system_config WHERE key=$1 AND value=$2', [MARKER_KEY, 'true']);
      if (!marca.rows.length) throw new Error('La base no tiene la marca de demo: no se reinicia (protección de datos reales).');
    }
    const conservado = {};
    for (const t of PRESERVAR) conservado[t] = (await client.query(`SELECT * FROM "${t}"`)).rows;
    const tablas = (await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('schema_migrations')`)).rows.map(r => `"${r.tablename}"`);
    await client.query(`TRUNCATE TABLE ${tablas.join(', ')} RESTART IDENTITY CASCADE`);
    for (const t of PRESERVAR) {
      for (const fila of conservado[t]) {
        const cols = Object.keys(fila);
        await client.query(
          `INSERT INTO "${t}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
          cols.map(c => fila[c]));
      }
    }
    await cargarDatos(client);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
  require('./scope').invalidateUser();
}

// Al arrancar: carga inicial si la base está vacía; y reinicio diario a la hora indicada.
async function iniciarDemo(pool) {
  if (!DEMO_INSTANCE) return;
  const marca = await pool.query('SELECT 1 FROM system_config WHERE key=$1', [MARKER_KEY]);
  if (!marca.rows.length) {
    // Base virgen: solo lo que siembran las migraciones (cliente PROPIO de ejemplo,
    // usuario inicial). Cualquier operación real deja kardex o documentos, y una
    // instalación en uso tiene más usuarios o clientes: en ese caso no se toca nada.
    const datos = await pool.query(`
      SELECT (SELECT COUNT(*) FROM clients WHERE id <> 'PROPIO')
           + (SELECT COUNT(*) FROM document_history)
           + (SELECT COUNT(*) FROM processed_docs)
           + (SELECT COUNT(*) FROM audit_log WHERE COALESCE(glosa,'') NOT LIKE '[DEMO]%') -- la migración 001 siembra kardex de ejemplo
           + (SELECT COUNT(*) FROM purchase_orders)
           + (SELECT COUNT(*) FROM asns)
           + (SELECT COUNT(*) FROM returns)
           + GREATEST((SELECT COUNT(*) FROM users) - 2, 0) AS n`);
    if (Number(datos.rows[0].n) > 0) {
      console.error('[DEMO] DEMO_INSTANCE=true sobre una base con datos y sin marca de demo: no se carga ni se reinicia nada.');
      return;
    }
    await resetDemo(pool, { force: true });
    console.log('[DEMO] Datos de demostración cargados.');
  }
  let ultimoDia = null;
  setInterval(async () => {
    const ahora = new Date();
    const dia = ahora.toISOString().slice(0, 10);
    if (ahora.getHours() !== DEMO_RESET_HOUR || ultimoDia === dia) return;
    ultimoDia = dia;
    try { await resetDemo(pool); console.log('[DEMO] Reinicio nocturno OK'); }
    catch (e) { console.error('[DEMO] Reinicio nocturno falló:', e.message); }
  }, 60 * 1000).unref();
  console.log(`[DEMO] Instancia de demostración activa — reinicio diario a las ${DEMO_RESET_HOUR}:00`);
}

module.exports = { DEMO_INSTANCE, DEMO_USERS, DEMO_PASSWORD, demoInstanceGuard, resetDemo, iniciarDemo, MARKER_KEY };
