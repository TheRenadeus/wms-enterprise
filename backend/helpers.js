// Helpers compartidos entre routers. Originalmente vivían inline en server.js.
const { v4: uuidv4 } = require('uuid');

const genLpnId = (prefix = 'LPN') => `${prefix}-${uuidv4().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

// Registra un evento de almacenaje para cobro 3PL. No-op si client_id es propio.
// Use la conexión transaccional del caller (`dbClient`) para que el evento se
// haga rollback junto con el resto del movimiento si falla.
//
// event_type esperado: MOVIMIENTO_IN | MOVIMIENTO_OUT | ALMACENAJE_DIA
async function logStorageEvent(dbClient, { client_id, event_type, sku, lpn_id, qty, location_id, weight_kg = 0 }) {
  if (!client_id || client_id === 'PROPIO' || client_id === 'GENERAL') return;
  if (!event_type || !sku) return;
  try {
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
  } catch (e) {
    // No bloquear el movimiento si falla el log. Reportar y seguir.
    console.error('[storage_events]', e.message);
  }
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

module.exports = { genLpnId, logStorageEvent, normalizeRut, computeDv, isValidRut, formatRut };
