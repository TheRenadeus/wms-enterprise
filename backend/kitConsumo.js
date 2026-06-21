// Helper COMPARTIDO de consumo de componentes de kit, dentro de una transacción ya
// abierta. Lo usan el armado de órdenes (routes/kitting.js, Modo B) y la explosión
// de kit al vuelo en el despacho (server.js, Modo A) — antes había una copia en cada
// uno.
//
// FEFO automático si no viene `picks`; si vienen, consume EXACTAMENTE de esos LPN
// (el operador eligió ubicación/lote/serie, que el LPN ya lleva). Bloquea con
// FOR UPDATE, nunca deja negativo, exige serie/lote si el SKU lo requiere, y
// devuelve { touched:[ids en 0], consumed:[{lpn_id,cantidad,ubicacion,lote,serie}] }.
// Lanza Error con .status si la selección/stock es inválida.
async function consumeComponentTracked(client, { compSku, needed, clientId, picks, requiresSerial, requiresLot }) {
  const touched = [];
  const consumed = [];
  const record = (row, take) => consumed.push({ lpn_id: row.id, cantidad: take, ubicacion: row.location_id || null, lote: row.batch_number || null, serie: row.serial_number || null });

  if (Array.isArray(picks) && picks.length) {
    const sumSel = picks.reduce((s, x) => s + (parseFloat(x.qty) || 0), 0);
    if (Math.abs(sumSel - needed) > 1e-6) { const e = new Error(`Origen inválido para ${compSku}: debe sumar exactamente ${needed} (registraste ${sumSel}).`); e.status = 400; throw e; }
    for (const p of picks) {
      const take = parseFloat(p.qty);
      if (!(take > 0)) continue;
      const lock = await client.query(
        `SELECT i.id, i.qty, i.sku, i.client_id, i.location_id, i.batch_number, i.serial_number,
                COALESCE(st.blocks_outbound, FALSE) AS blocked
           FROM inventory_lpns i LEFT JOIN statuses st ON i.status = st.id
          WHERE i.id=$1 FOR UPDATE OF i`, [p.lpn_id]);
      if (!lock.rows.length) { const e = new Error(`LPN ${p.lpn_id} no encontrado.`); e.status = 404; throw e; }
      const row = lock.rows[0];
      if (row.sku !== compSku || (row.client_id || '') !== clientId) { const e = new Error(`LPN ${p.lpn_id} no corresponde a ${compSku} de este cliente.`); e.status = 400; throw e; }
      if (row.blocked) { const e = new Error(`LPN ${p.lpn_id} está en un estado que bloquea la salida.`); e.status = 400; throw e; }
      if (requiresSerial && !row.serial_number) { const e = new Error(`${compSku} requiere serie y el LPN ${p.lpn_id} no la tiene.`); e.status = 400; throw e; }
      if (requiresLot && !row.batch_number) { const e = new Error(`${compSku} requiere lote y el LPN ${p.lpn_id} no lo tiene.`); e.status = 400; throw e; }
      if (parseFloat(row.qty) < take) { const e = new Error(`LPN ${p.lpn_id}: stock insuficiente (${row.qty} < ${take}).`); e.status = 400; throw e; }
      const upd = await client.query('UPDATE inventory_lpns SET qty=qty-$1 WHERE id=$2 RETURNING qty', [take, p.lpn_id]);
      if (parseFloat(upd.rows[0].qty) <= 0) touched.push(p.lpn_id);
      record(row, take);
    }
    return { touched, consumed };
  }

  // FEFO automático
  let remaining = needed;
  const lpns = (await client.query(
    `SELECT i.id, i.qty, i.location_id, i.batch_number, i.serial_number
       FROM inventory_lpns i LEFT JOIN statuses st ON i.status = st.id
      WHERE i.sku=$1 AND i.client_id=$2 AND i.qty>0 AND COALESCE(st.blocks_outbound, FALSE) = FALSE
      ORDER BY i.expiry_date ASC NULLS LAST, i.created_at ASC
      FOR UPDATE OF i`, [compSku, clientId])).rows;
  for (const row of lpns) {
    if (remaining <= 0) break;
    const take = Math.min(parseFloat(row.qty), remaining);
    const upd = await client.query('UPDATE inventory_lpns SET qty=qty-$1 WHERE id=$2 RETURNING qty', [take, row.id]);
    if (parseFloat(upd.rows[0].qty) <= 0) touched.push(row.id);
    record(row, take);
    remaining -= take;
  }
  if (remaining > 0) { const e = new Error(`Stock insuficiente para ${compSku} (faltan ${remaining}).`); e.status = 409; throw e; }
  return { touched, consumed };
}

module.exports = { consumeComponentTracked };
