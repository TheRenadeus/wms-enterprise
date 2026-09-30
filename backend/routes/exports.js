// Export de datos a XLSX/CSV. Extraído de server.js (COD-02).
const express = require('express');
const XLSX = require('xlsx');
const { pool, mapDbError } = require('../db');
const { requireAuth } = require('../middleware');
const { applyRowStyles, xlsxHeaderStyle, xlsxDescStyle } = require('../import-export-helpers');

const router = express.Router();

router.get('/export/skus', requireAuth, async (req, res) => {
  try {
    // Columnas explícitas que coinciden con la plantilla de importación (round-trip):
    // export → editar → import. Se excluyen los SKU borrados (soft-delete) y columnas internas.
    const result = await pool.query(`
      SELECT sku, client_id, "desc", category, uom, weight, length, width, height, abc_class,
             requires_lot, requires_serial, barcode, manufacturer_code, manufacturer_sku, brand
        FROM master_skus
       WHERE deleted_at IS NULL
       ORDER BY client_id, sku ASC
    `);
    const rows = result.rows;
    if (rows.length === 0) return res.status(404).json({ error: 'Sin datos' });
    const headers = Object.keys(rows[0]);
    const dataRows = rows.map(r => headers.map(h => {
      const v = r[h];
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      return v ?? '';
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws['!cols'] = headers.map(() => ({ wch: 18 }));
    applyRowStyles(ws, 0, headers, xlsxHeaderStyle);
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, ws, 'SKUs');
    const date = new Date().toISOString().slice(0, 10);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=skus_${date}.xlsx`);
    res.send(buf);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.get('/export/clients', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, contact, email FROM clients ORDER BY name ASC');
    const rows = result.rows;
    if (rows.length === 0) return res.status(404).json({ error: 'Sin datos' });
    const headers = Object.keys(rows[0]).join(',');
    const csv = rows.map(r => Object.values(r).map(v => `"${v ?? ''}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=clientes.csv');
    res.send(headers + '\n' + csv);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.get('/export/inventory', requireAuth, async (req, res) => {
  try {
    const { client_id, sku, status } = req.query;
    let sql = `
      SELECT i.id AS "LPN ID", i.sku AS "SKU", s.desc AS "Descripción",
             i.client_id AS "Cliente", i.qty AS "Cantidad",
             i.status AS "Estado", i.location_id AS "Ubicación",
             i.batch_number AS "N° Lote", i.expiry_date AS "Vencimiento",
             i.serial_number AS "N° Serie", i.glosa AS "Glosa/Nota",
             i.created_at AS "Fecha Creación"
      FROM inventory_lpns i
      LEFT JOIN master_skus s ON i.sku = s.sku AND i.client_id = s.client_id
      WHERE i.qty > 0
    `;
    const params = [];
    if (client_id) { params.push(client_id); sql += ` AND i.client_id = $${params.length}`; }
    if (sku) { params.push(`%${sku}%`); sql += ` AND i.sku ILIKE $${params.length}`; }
    if (status) { params.push(status); sql += ` AND i.status = $${params.length}`; }
    sql += ' ORDER BY i.client_id, i.sku, i.created_at DESC';
    const result = await pool.query(sql, params);
    const rows = result.rows;
    if (rows.length === 0) return res.status(404).json({ error: 'Sin datos para exportar' });
    const headers = Object.keys(rows[0]);
    const descMap = {
      'LPN ID': 'Identificador único del pallet o caja (License Plate Number)',
      'SKU': 'Código del producto',
      'Descripción': 'Nombre o descripción del producto',
      'Cliente': 'Código del cliente dueño del stock',
      'Cantidad': 'Unidades actualmente en stock',
      'Estado': 'DISPONIBLE = libre para despacho | BLOQUEADO = no se puede despachar | CUARENTENA = en revisión',
      'Ubicación': 'Posición física en la bodega',
      'N° Lote': 'Número de lote o batch del proveedor',
      'Vencimiento': 'Fecha de vencimiento del lote (YYYY-MM-DD)',
      'N° Serie': 'Número de serie único del ítem',
      'Glosa/Nota': 'Observación o referencia interna',
      'Fecha Creación': 'Fecha y hora en que se ingresó el LPN al sistema',
    };
    const descriptions = headers.map(h => descMap[h] || '');
    const dataRows = rows.map(r => headers.map(h => {
      const v = r[h];
      if (v instanceof Date) return v.toISOString().split('T')[0];
      return v ?? '';
    }));
    const wb = XLSX.utils.book_new();
    const aoa = [headers, descriptions, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = headers.map(() => ({ wch: 22 }));
    applyRowStyles(ws, 0, headers, xlsxHeaderStyle);
    applyRowStyles(ws, 1, headers, xlsxDescStyle);
    // Freeze top 2 rows
    ws['!freeze'] = { xSplit: 0, ySplit: 2 };
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    const date = new Date().toISOString().slice(0, 10);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=inventario_${date}.xlsx`);
    res.send(buf);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

module.exports = router;
