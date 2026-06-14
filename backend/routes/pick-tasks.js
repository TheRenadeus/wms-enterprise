// Pick-tasks + picker router.
// Modelo: una tarea por línea (no por documento) — permite múltiples pickers en paralelo.
// Estados de línea: PENDIENTE → EN_PROCESO → COMPLETADA | DIFERENCIA | SALTADA.
// El picker NO descuenta stock al confirmar — eso lo hace el supervisor al cerrar el doc.
// FOR UPDATE en /start previene que dos pickers tomen la misma línea simultáneamente.

const express = require('express');

const { pool, mapDbError, sendDbError } = require('../db');
const { requireJefeOrAbove, requirePickerOrAbove, requireStockWrite } = require('../middleware');
const { genLpnId } = require('../helpers');

const router = express.Router();

// ── Crear tarea (supervisor crea una tarea por línea) ──────────────────────
router.post('/pick-tasks', requireStockWrite, async (req, res) => {
  const { doc_id, doc_num, doc_type, module, client_id, lines, notes } = req.body;
  if (!doc_num || !module || !Array.isArray(lines) || lines.length === 0)
    return res.status(400).json({ error: 'doc_num, module y lines son requeridos.' });
  if (!['receive','dispatch','relocate'].includes(module))
    return res.status(400).json({ error: 'module debe ser receive, dispatch o relocate.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const activeTask = await client.query(
      `SELECT id FROM pick_tasks WHERE doc_num=$1 AND module=$2 AND client_id=$3 AND status NOT IN ('COMPLETADA','CANCELADA') LIMIT 1`,
      [doc_num.toUpperCase(), module, client_id || '']
    );
    if (activeTask.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Ya existe una tarea de picking activa para el documento '${doc_num}' (módulo: ${module}). ID: ${activeTask.rows[0].id}` });
    }
    const skus = [...new Set(lines.map(l => l.sku).filter(Boolean))];
    if (skus.length > 0) {
      const skuCheck = await client.query(`SELECT sku FROM master_skus WHERE sku = ANY($1)`, [skus]);
      const foundSkus = new Set(skuCheck.rows.map(r => r.sku));
      const missing = skus.filter(s => !foundSkus.has(s));
      if (missing.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `SKU(s) no encontrado(s) en maestro: ${missing.join(', ')}` });
      }
    }
    const createdTasks = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const qtyReq = parseFloat(line.qty_requested);
      if (isNaN(qtyReq) || qtyReq <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Línea ${i + 1}: qty_requested debe ser un número mayor a 0.` });
      }
      if (module === 'dispatch' && line.lpn_id) {
        const stockCheck = await client.query(`SELECT qty FROM inventory_lpns WHERE id=$1 AND qty > 0`, [line.lpn_id]);
        if (stockCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Línea ${i + 1}: LPN ${line.lpn_id} no existe o tiene stock cero.` });
        }
        const availQty = parseFloat(stockCheck.rows[0].qty);
        if (qtyReq > availQty) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Línea ${i + 1}: qty_requested (${qtyReq}) supera el stock disponible en LPN ${line.lpn_id} (${availQty}).` });
        }
      }
      const taskId = genLpnId('TASK');
      await client.query(
        `INSERT INTO pick_tasks (id, doc_id, doc_num, doc_type, module, client_id, status, priority, created_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6,'PENDIENTE',$7,$8,$9)`,
        [taskId, doc_id||doc_num, doc_num.toUpperCase(), doc_type||module.toUpperCase(),
         module, client_id||null, line.priority||5, req.user.username, notes||null]
      );
      await client.query(
        `INSERT INTO pick_task_lines (task_id, line_index, sku, sku_desc, lpn_id, location_from, location_to, qty_requested, assigned_to, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDIENTE')`,
        [taskId, i, line.sku, line.sku_desc||null, line.lpn_id||null,
         line.location_from||null, line.location_to||null, qtyReq, line.assigned_to||null]
      );
      createdTasks.push(taskId);
    }
    await client.query('COMMIT');
    res.json({ success: true, task_ids: createdTasks, count: createdTasks.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: mapDbError(err) });
  } finally { client.release(); }
});

// ── Listar tareas ─────────────────────────────────────────────────────────
router.get('/pick-tasks', requirePickerOrAbove, async (req, res) => {
  try {
    const { status, module, doc_num, assigned_to } = req.query;
    const isPicker = req.user.role === 'PICKER';
    if (isPicker && assigned_to && assigned_to !== req.user.username)
      return res.status(403).json({ error: 'No puede consultar tareas de otro picker.' });
    const conditions = [];
    const params = [];
    if (isPicker) { conditions.push(`ptl.assigned_to=$${params.length+1}`); params.push(req.user.username); }
    else if (assigned_to) { conditions.push(`ptl.assigned_to=$${params.length+1}`); params.push(assigned_to); }
    if (status) { conditions.push(`ptl.status=$${params.length+1}`); params.push(status); }
    if (module) { conditions.push(`pt.module=$${params.length+1}`); params.push(module); }
    if (doc_num) { conditions.push(`pt.doc_num ILIKE $${params.length+1}`); params.push(`%${doc_num}%`); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await pool.query(
      `SELECT pt.id as task_id, pt.doc_num, pt.doc_type, pt.module, pt.client_id, pt.status as task_status,
              pt.priority, pt.created_by, pt.created_at, pt.notes,
              ptl.id as line_id, ptl.line_index, ptl.sku, ptl.sku_desc, ptl.lpn_id,
              ptl.location_from, ptl.location_to, ptl.qty_requested, ptl.qty_confirmed,
              ptl.batch_confirmed, ptl.serial_confirmed, ptl.status as line_status,
              ptl.assigned_to, ptl.started_at, ptl.confirmed_at, ptl.diff_reason
       FROM pick_task_lines ptl
       JOIN pick_tasks pt ON pt.id = ptl.task_id
       ${where}
       ORDER BY ptl.status ASC, pt.priority ASC, pt.created_at ASC`,
      params
    );
    res.json(rows.rows);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.put('/pick-tasks/lines/:lineId/assign', requireStockWrite, async (req, res) => {
  try {
    const { assigned_to } = req.body;
    if (!assigned_to) return res.status(400).json({ error: 'assigned_to es requerido.' });
    const userCheck = await pool.query(
      `SELECT username FROM users WHERE username=$1 AND role='PICKER' LIMIT 1`,
      [assigned_to]
    );
    if (userCheck.rowCount === 0)
      return res.status(400).json({ error: `El usuario '${assigned_to}' no existe o no tiene rol PICKER.` });
    const result = await pool.query(
      `UPDATE pick_task_lines SET assigned_to=$1, updated_by=$2, updated_at=NOW()
       WHERE id=$3 AND status='PENDIENTE' RETURNING id`,
      [assigned_to, req.user.username, req.params.lineId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Línea no encontrada o ya en proceso.' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.put('/pick-tasks/:taskId/cancel', requireStockWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE pick_tasks SET status='CANCELADA' WHERE id=$1 AND status IN ('PENDIENTE','EN_PROCESO') RETURNING id`,
      [req.params.taskId]
    );
    if (r.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Tarea no encontrada o ya finalizada.' });
    }
    await client.query(
      `UPDATE pick_task_lines SET status='SALTADA', diff_reason='Tarea cancelada por supervisor',
       updated_by=$1, updated_at=NOW()
       WHERE task_id=$2 AND status IN ('PENDIENTE','EN_PROCESO')`,
      [req.user.username, req.params.taskId]
    );
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: mapDbError(err) });
  } finally { client.release(); }
});

router.get('/pick-tasks/by-doc/:docNum', requireJefeOrAbove, async (req, res) => {
  try {
    const { module } = req.query;
    if (module && !['receive','dispatch','relocate'].includes(module))
      return res.status(400).json({ error: 'module debe ser receive, dispatch o relocate.' });
    const params = [req.params.docNum.toUpperCase()];
    const moduleFilter = module ? `AND pt.module = $${params.push(module)}` : '';
    const rows = await pool.query(
      `SELECT pt.id as task_id, pt.doc_num, pt.module, pt.status as task_status, pt.priority,
              ptl.id as line_id, ptl.sku, ptl.sku_desc, ptl.lpn_id, ptl.location_from,
              ptl.qty_requested, ptl.qty_confirmed, ptl.batch_confirmed, ptl.serial_confirmed,
              ptl.status as line_status, ptl.assigned_to, ptl.diff_reason, ptl.confirmed_at
       FROM pick_task_lines ptl
       JOIN pick_tasks pt ON pt.id = ptl.task_id
       WHERE pt.doc_num = $1 ${moduleFilter}
       ORDER BY ptl.status ASC, pt.priority ASC`,
      params
    );
    res.json(rows.rows);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.get('/pick-tasks/stats', requireJefeOrAbove, async (req, res) => {
  try {
    const [byStatus, byPicker, diffRate] = await Promise.all([
      pool.query(`SELECT status, COUNT(*) as count FROM pick_task_lines GROUP BY status ORDER BY status`),
      pool.query(`SELECT assigned_to, status, COUNT(*) as count FROM pick_task_lines WHERE assigned_to IS NOT NULL GROUP BY assigned_to, status ORDER BY assigned_to`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE status='DIFERENCIA') as diffs, COUNT(*) as total FROM pick_task_lines WHERE status IN ('COMPLETADA','DIFERENCIA')`)
    ]);
    res.json({ by_status: byStatus.rows, by_picker: byPicker.rows, diff_rate: diffRate.rows[0] });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// ── PICKER (cola personal) ────────────────────────────────────────────────
router.get('/picker/queue', requirePickerOrAbove, async (req, res) => {
  try {
    const rows = await pool.query(
      `SELECT pt.id as task_id, pt.doc_num, pt.doc_type, pt.module, pt.client_id, pt.notes,
              ptl.id as line_id, ptl.line_index, ptl.sku, ptl.sku_desc, ptl.lpn_id,
              ptl.location_from, ptl.location_to, ptl.qty_requested, ptl.status as line_status,
              ptl.started_at, pt.priority, pt.created_at,
              i.batch_number, i.serial_number, i.expiry_date, i.qty as lpn_qty_actual
       FROM pick_task_lines ptl
       JOIN pick_tasks pt ON pt.id = ptl.task_id
       LEFT JOIN inventory_lpns i ON i.id = ptl.lpn_id
       WHERE ptl.assigned_to=$1 AND ptl.status IN ('PENDIENTE','EN_PROCESO')
       ORDER BY pt.priority ASC, ptl.status DESC, pt.created_at ASC`,
      [req.user.username]
    );
    res.json(rows.rows);
  } catch (err) { sendDbError(res, err); }
});

router.post('/picker/lines/:lineId/start', requirePickerOrAbove, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const check = await client.query(
      `SELECT id, assigned_to, status, task_id FROM pick_task_lines WHERE id=$1 FOR UPDATE`,
      [req.params.lineId]
    );
    if (!check.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Línea no encontrada.' });
    }
    const line = check.rows[0];
    if (line.assigned_to && line.assigned_to !== req.user.username) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Esta línea está asignada a otro picker.' });
    }
    if (line.status !== 'PENDIENTE') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La línea ya fue tomada o está finalizada.' });
    }
    await client.query(
      `UPDATE pick_task_lines SET status='EN_PROCESO', assigned_to=$1, started_at=NOW(), updated_by=$1, updated_at=NOW() WHERE id=$2`,
      [req.user.username, req.params.lineId]
    );
    await client.query(`UPDATE pick_tasks SET status='EN_PROCESO' WHERE id=$1 AND status='PENDIENTE'`, [line.task_id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: mapDbError(err) });
  } finally { client.release(); }
});

router.post('/picker/lines/:lineId/confirm', requirePickerOrAbove, async (req, res) => {
  const { qty_confirmed, batch_confirmed, serial_confirmed, diff_reason } = req.body;
  if (qty_confirmed === undefined || qty_confirmed === null)
    return res.status(400).json({ error: 'qty_confirmed es requerido.' });
  const qtyConf = parseFloat(qty_confirmed);
  if (isNaN(qtyConf) || qtyConf < 0) return res.status(400).json({ error: 'Cantidad confirmada inválida.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lineRes = await client.query(
      `SELECT ptl.*, pt.doc_num, pt.module FROM pick_task_lines ptl
       JOIN pick_tasks pt ON pt.id = ptl.task_id
       WHERE ptl.id=$1 AND ptl.assigned_to=$2 FOR UPDATE`,
      [req.params.lineId, req.user.username]
    );
    if (!lineRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Línea no encontrada o no asignada a usted.' });
    }
    const line = lineRes.rows[0];
    if (!['EN_PROCESO','PENDIENTE'].includes(line.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La línea ya fue confirmada.' });
    }

    if (line.lpn_id) {
      const lpn = await client.query('SELECT batch_number, serial_number FROM inventory_lpns WHERE id=$1', [line.lpn_id]);
      if (lpn.rows.length) {
        const { batch_number, serial_number } = lpn.rows[0];
        if (batch_number && !batch_confirmed)
          return res.status(400).json({ error: `El LPN ${line.lpn_id} tiene lote ${batch_number}. Debe confirmar el número de lote.` });
        if (serial_number && !serial_confirmed)
          return res.status(400).json({ error: `El LPN ${line.lpn_id} tiene número de serie. Debe confirmarlo.` });
      }
    }

    const hasDiff = qtyConf !== parseFloat(line.qty_requested);
    const newStatus = hasDiff ? 'DIFERENCIA' : 'COMPLETADA';
    if (hasDiff && !diff_reason)
      return res.status(400).json({ error: 'diff_reason es requerido cuando la cantidad confirmada difiere de la solicitada.' });

    await client.query(
      `UPDATE pick_task_lines SET status=$1, qty_confirmed=$2, batch_confirmed=$3, serial_confirmed=$4,
       diff_reason=$5, confirmed_at=NOW(), updated_by=$6, updated_at=NOW() WHERE id=$7`,
      [newStatus, qtyConf, batch_confirmed||null, serial_confirmed||null, diff_reason||null, req.user.username, req.params.lineId]
    );

    if (hasDiff) {
      await client.query(
        `INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('PICK_DIFF', $1, $2, $3, $4)`,
        [line.sku, parseFloat(line.qty_requested) - qtyConf,
         `DIFERENCIA en línea ${req.params.lineId} doc ${line.doc_num}. Razón: ${diff_reason}`, req.user.username]
      );
    }

    const pending = await client.query(
      `SELECT COUNT(*) as cnt FROM pick_task_lines WHERE task_id=$1 AND status IN ('PENDIENTE','EN_PROCESO')`,
      [line.task_id]
    );
    if (parseInt(pending.rows[0].cnt) === 0) {
      const hasDiffs = await client.query(
        `SELECT COUNT(*) as cnt FROM pick_task_lines WHERE task_id=$1 AND status='DIFERENCIA'`,
        [line.task_id]
      );
      const finalStatus = parseInt(hasDiffs.rows[0].cnt) > 0 ? 'DIFERENCIA' : 'COMPLETADA';
      await client.query(`UPDATE pick_tasks SET status=$1 WHERE id=$2`, [finalStatus, line.task_id]);
    }
    await client.query('COMMIT');
    res.json({ success: true, status: newStatus, has_diff: hasDiff });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: mapDbError(err) });
  } finally { client.release(); }
});

router.post('/picker/lines/:lineId/skip', requirePickerOrAbove, async (req, res) => {
  const { diff_reason } = req.body;
  if (!diff_reason) return res.status(400).json({ error: 'diff_reason es requerido para saltar una línea.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE pick_task_lines SET status='SALTADA', diff_reason=$1, confirmed_at=NOW(), updated_by=$2, updated_at=NOW()
       WHERE id=$3 AND assigned_to=$4 AND status IN ('PENDIENTE','EN_PROCESO') RETURNING task_id`,
      [diff_reason, req.user.username, req.params.lineId, req.user.username]
    );
    if (!r.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Línea no encontrada o no asignada a usted.' });
    }
    const taskId = r.rows[0].task_id;
    const pending = await client.query(
      `SELECT COUNT(*) as cnt FROM pick_task_lines WHERE task_id=$1 AND status IN ('PENDIENTE','EN_PROCESO')`,
      [taskId]
    );
    if (parseInt(pending.rows[0].cnt) === 0) {
      await client.query(`UPDATE pick_tasks SET status='DIFERENCIA' WHERE id=$1`, [taskId]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: mapDbError(err) });
  } finally { client.release(); }
});

module.exports = router;
