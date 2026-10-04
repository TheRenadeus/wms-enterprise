// Helpers compartidos entre routers. Originalmente vivían inline en server.js.
const { randomUUID } = require('crypto');

const genLpnId = (prefix = 'LPN') => `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

// Registra un evento de almacenaje para cobro 3PL. No-op si client_id es propio.
// Use la conexión transaccional del caller (`dbClient`) para que el evento se
// haga rollback junto con el resto del movimiento si falla.
//
// event_type esperado: MOVIMIENTO_IN | MOVIMIENTO_OUT | ALMACENAJE_DIA
async function logStorageEvent(dbClient, { client_id, event_type, sku, lpn_id, qty, location_id, weight_kg = 0 }) {
  if (!client_id || client_id === 'PROPIO' || client_id === 'GENERAL') return;
  if (!event_type || !sku) return;
  // Dentro de una transacción, un error sin savepoint la dejaría abortada y el
  // COMMIT del movimiento terminaría en un ROLLBACK silencioso.
  const sp = dbClient.inTransaction ? 'storage_evt' : null;
  try {
    if (sp) await dbClient.query(`SAVEPOINT ${sp}`);
    const r = await dbClient.query(
      `SELECT unit_price FROM client_tariffs WHERE client_id=$1 AND tariff_type=$2 AND active=TRUE LIMIT 1`,
      [client_id, event_type]
    );
    const unitPrice = parseFloat(r.rows[0]?.unit_price) || 0;
    const q = parseFloat(qty) || 0;
    await dbClient.query(
      `INSERT INTO storage_events (client_id, event_type, sku, lpn_id, qty, weight_kg, location_id, unit_price, total_amount)
       VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, $8::numeric, ($5::numeric * $8::numeric))`,
      [client_id, event_type, sku, lpn_id || null, q, parseFloat(weight_kg) || 0, location_id || null, unitPrice]
    );
    if (sp) await dbClient.query(`RELEASE SAVEPOINT ${sp}`);
  } catch (e) {
    // No bloquear el movimiento si falla el log. Reportar y seguir.
    console.error('[storage_events]', e.message);
    if (sp) await dbClient.query(`ROLLBACK TO SAVEPOINT ${sp}`);
  }
}

// Historial del documento cerrado, en la misma transacción que el movimiento y con
// lo que el servidor aplicó realmente (la anulación y la facturación dependen de él).
async function registrarHistorial(db, { module, docNum, docType, glosa, username, items, clientId, docDate, docRef, enteredAt }) {
  const id = `${String(module).toUpperCase()}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const total = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const fecha = (v) => (v && !Number.isNaN(new Date(v).getTime()) ? v : null);
  await db.query(
    `INSERT INTO document_history (id,module,doc_num,doc_type,glosa,username,items_json,total_qty,doc_date,doc_ref,entered_at,client_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, module, docNum, docType || '', glosa || '', username, JSON.stringify(items), total,
     fecha(docDate), docRef ? String(docRef).slice(0, 200) : null, fecha(enteredAt), clientId || '']);
  return id;
}

// ── RUT chileno (módulo 11) ──────────────────────────────────────────────────
// normalizeRut: deja solo cuerpo+DV en mayúsculas, sin puntos ni guion.
function normalizeRut(rut) {
  return String(rut || '').replace(/[.\-\s]/g, '').toUpperCase();
}
// computeDv: dígito verificador (módulo 11) del cuerpo numérico. Devuelve '0'-'9' o 'K'.
function computeDv(body) {
  let sum = 0, mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const res = 11 - (sum % 11);
  if (res === 11) return '0';
  if (res === 10) return 'K';
  return String(res);
}
// isValidRut: valida formato y dígito verificador. Vacío/null → false (el caller
// decide si el RUT es obligatorio).
function isValidRut(rut) {
  const clean = normalizeRut(rut);
  if (clean.length < 2) return false;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  if (!/^\d+$/.test(body)) return false;
  return computeDv(body) === dv;
}
// formatRut: presentación canónica con puntos y guion (ej: 12.345.678-5).
function formatRut(rut) {
  const clean = normalizeRut(rut);
  if (clean.length < 2) return clean;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  const withDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${withDots}-${dv}`;
}

module.exports = { genLpnId, logStorageEvent, registrarHistorial, normalizeRut, computeDv, isValidRut, formatRut };
