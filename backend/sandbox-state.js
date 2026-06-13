// Estado mutable en memoria para sesiones sandbox.
// Cada usuario demo (username = `sandbox_<role>`) tiene su propio overlay sobre los
// datos hardcoded de sandbox-data.js. Esto permite que reubicar, cambiar estado,
// recibir y despachar se vean reflejados en los GETs subsiguientes.
//
// El estado vive en process memory y expira a los 4 h sin actividad — suficiente
// para una sesión de demo. NO persiste reinicios (intencional: cada nueva sesión
// arranca limpia).

const TTL_MS = 4 * 60 * 60 * 1000; // 4 h
const sessions = new Map();        // username → { state, lastActivity }

function makeEmptyState() {
  return {
    inventoryOverrides: new Map(),  // lpn_id → { location_id?, status?, qty?, deleted? }
    newLpns: [],                    // LPNs creados (recepción, ajuste sobrante, split)
    relocateRequests: [],
    pickTasks: [],
    audit: [],                      // movimientos extra (INBOUND/OUTBOUND/RELOCATE/...)
    adjustRequests: [],
    statusChanges: [],
    dispatchSchedules: [],
    docks: [],
    dockAppointments: [],
    cycleCount: [],
  };
}

function getState(user) {
  if (!user || !user.is_demo) return null;
  const key = user.username;
  let session = sessions.get(key);
  if (!session || (Date.now() - session.lastActivity) > TTL_MS) {
    session = { state: makeEmptyState(), lastActivity: Date.now() };
    sessions.set(key, session);
  } else {
    session.lastActivity = Date.now();
  }
  return session.state;
}

function resetState(user) {
  if (!user) return;
  sessions.delete(user.username);
}

// Aplica el overlay sobre un array de LPNs demo y devuelve la versión efectiva.
function applyInventoryOverlay(state, baseLpns) {
  if (!state) return baseLpns;
  const out = [];
  for (const lpn of baseLpns) {
    const ov = state.inventoryOverrides.get(lpn.id);
    if (!ov) { out.push(lpn); continue; }
    if (ov.deleted) continue;
    out.push({ ...lpn, ...ov });
  }
  for (const newLpn of state.newLpns) out.push(newLpn);
  return out;
}

// Genera un ID predecible para LPNs creados en demo.
let counter = 1000;
function genDemoLpnId(prefix = 'DEMO') {
  counter++;
  return `${prefix}-${counter}-${Date.now().toString().slice(-5)}`;
}

function nowIso() { return new Date().toISOString(); }

// ── HANDLERS DE WRITES ───────────────────────────────────────────────────────
// Cada handler recibe (state, body, params) y devuelve la respuesta JSON al cliente.
// Si devuelve null, el middleware genérico aplica el success default.

const writeHandlers = {
  // POST /api/relocate { id, new_location_id, qty, glosa, username }
  'POST:/api/relocate': (state, body) => {
    const { id, new_location_id, qty, glosa } = body || {};
    if (!id || !new_location_id) return { error: 'id y new_location_id requeridos' };
    // Buscar el LPN en el overlay o como nuevo
    const newId = genDemoLpnId('REL');
    state.inventoryOverrides.set(id, { location_id: new_location_id });
    state.audit.unshift({
      id: Date.now(), type: 'RELOCATE', sku: id, qty: qty || 0,
      glosa: `Reubicación ${id} → ${new_location_id}. ${glosa || ''}`.trim(),
      username: 'sandbox', created_at: nowIso(), lpn_id: id,
    });
    return { success: true, demo: true, id: newId, message: 'Reubicación simulada.' };
  },

  // POST /api/relocate-requests { lpn_id, location_to, qty, glosa }
  'POST:/api/relocate-requests': (state, body) => {
    const id = genDemoLpnId('RRQ');
    const req = {
      id, lpn_id: body.lpn_id, location_from: body.location_from || null,
      location_to: body.location_to, qty: body.qty || 0,
      glosa: body.glosa || '', status: 'PENDIENTE',
      requested_by: 'sandbox', requested_at: nowIso(),
    };
    state.relocateRequests.unshift(req);
    return { success: true, demo: true, id, request: req };
  },

  // POST /api/relocate-requests/:id/approve
  'POST:/api/relocate-requests/:id/approve': (state, body, params) => {
    const r = state.relocateRequests.find(x => x.id === params.id);
    if (r) {
      r.status = 'APROBADA'; r.resolved_at = nowIso(); r.resolved_by = 'sandbox';
      if (r.lpn_id && r.location_to) {
        state.inventoryOverrides.set(r.lpn_id, { location_id: r.location_to });
      }
    }
    return { success: true, demo: true };
  },

  // POST /api/relocate-requests/:id/reject
  'POST:/api/relocate-requests/:id/reject': (state, body, params) => {
    const r = state.relocateRequests.find(x => x.id === params.id);
    if (r) { r.status = 'RECHAZADA'; r.resolved_at = nowIso(); r.reject_reason = body?.reason || ''; }
    return { success: true, demo: true };
  },

  // POST /api/change-status { id, new_status, glosa, ... }
  'POST:/api/change-status': (state, body) => {
    const id = body.id || body.lpn_id;
    if (id) {
      state.inventoryOverrides.set(id, { ...(state.inventoryOverrides.get(id) || {}), status: body.new_status });
      state.audit.unshift({
        id: Date.now(), type: 'STATUS_CHANGE', sku: id, qty: body.qty || 0,
        glosa: `Cambio estado ${id} → ${body.new_status}. ${body.glosa || ''}`.trim(),
        username: 'sandbox', created_at: nowIso(), lpn_id: id,
      });
    }
    return { success: true, demo: true };
  },

  // POST /api/inventory_batch | /api/receive_batch
  'POST:/api/receive_batch': (state, body) => {
    const items = body.items || [];
    const created = [];
    for (const it of items) {
      const lpnId = genDemoLpnId('REC');
      const lpn = {
        id: lpnId, sku: it.sku, client_id: it.client_id || 'GENERAL',
        qty: parseFloat(it.qty) || 0, location_id: it.location_id || 'PISO-RECEPCION',
        status: 'DISPONIBLE',
        batch_number: it.batch || null, serial_number: it.serial || null,
        expiry_date: it.expDate || null, created_at: nowIso(),
      };
      state.newLpns.push(lpn);
      state.audit.unshift({
        id: Date.now() + created.length, type: 'INBOUND', sku: it.sku, qty: lpn.qty,
        glosa: `Recepción demo LPN ${lpnId}`, username: 'sandbox', created_at: nowIso(), lpn_id: lpnId,
      });
      created.push(lpn);
    }
    return { success: true, demo: true, created };
  },
  'POST:/api/inventory_batch': (state, body) => writeHandlers['POST:/api/receive_batch'](state, body),

  // POST /api/dispatch — reduce qty / marca deleted
  'POST:/api/dispatch': (state, body) => {
    const items = body.items || [];
    for (const it of items) {
      const lpnId = it.lpnId || it.lpn_id;
      if (!lpnId) continue;
      const ov = state.inventoryOverrides.get(lpnId) || {};
      const take = parseFloat(it.qtyToPick || it.qty) || 0;
      // marcar como deleted si se lleva todo (heurística simple)
      state.inventoryOverrides.set(lpnId, { ...ov, deleted: take >= 1 });
      state.audit.unshift({
        id: Date.now(), type: 'OUTBOUND', sku: it.sku || lpnId, qty: take,
        glosa: `Despacho demo LPN ${lpnId}`, username: 'sandbox', created_at: nowIso(), lpn_id: lpnId,
      });
    }
    return { success: true, demo: true };
  },

  // POST /api/adjust_batch — sobrantes y mermas
  'POST:/api/adjust_batch': (state, body) => {
    const items = body.items || [];
    for (const it of items) {
      if (it.action === 'ADD') {
        const lpnId = genDemoLpnId('ADJ');
        state.newLpns.push({
          id: lpnId, sku: it.sku, client_id: it.client_id || 'GENERAL',
          qty: parseFloat(it.qty) || 0, location_id: it.location_id || 'PISO-RECEPCION',
          status: 'DISPONIBLE', batch_number: it.batch || null,
          serial_number: it.serial || null, expiry_date: it.expDate || null,
          created_at: nowIso(),
        });
        state.audit.unshift({
          id: Date.now(), type: 'ADJUST_IN', sku: it.sku, qty: parseFloat(it.qty) || 0,
          glosa: `Sobrante demo LPN ${lpnId}`, username: 'sandbox', created_at: nowIso(), lpn_id: lpnId,
        });
      } else if (it.action === 'SUBTRACT' && it.lpnId) {
        state.inventoryOverrides.set(it.lpnId, { ...(state.inventoryOverrides.get(it.lpnId) || {}), deleted: true });
        state.audit.unshift({
          id: Date.now(), type: 'ADJUST_OUT', sku: it.sku, qty: parseFloat(it.qty) || 0,
          glosa: `Merma demo LPN ${it.lpnId}`, username: 'sandbox', created_at: nowIso(), lpn_id: it.lpnId,
        });
      }
    }
    return { success: true, demo: true };
  },

  // POST /api/pick-tasks (creación)
  'POST:/api/pick-tasks': (state, body) => {
    const id = genDemoLpnId('TASK');
    const task = {
      id, doc_num: body.doc_num || 'DEMO-DOC', doc_type: body.doc_type || 'GUIA',
      module: body.module || 'dispatch', client_id: body.client_id || 'ACME',
      status: 'EN_CURSO', created_by: 'sandbox', created_at: nowIso(),
      lines: body.lines || [],
    };
    state.pickTasks.unshift(task);
    return { success: true, demo: true, id, task };
  },

  // POST /api/dispatch-schedules
  'POST:/api/dispatch-schedules': (state, body) => {
    const id = genDemoLpnId('DSP');
    const ds = { id, ...body, status: 'PROGRAMADO', created_by: 'sandbox', created_at: nowIso() };
    state.dispatchSchedules.unshift(ds);
    return { success: true, demo: true, id, schedule: ds };
  },
  'PATCH:/api/dispatch-schedules/:id': (state, body, params) => {
    const ds = state.dispatchSchedules.find(x => x.id === params.id);
    if (ds && body.status) ds.status = body.status;
    return { success: true, demo: true };
  },
  'DELETE:/api/dispatch-schedules/:id': (state, body, params) => {
    state.dispatchSchedules = state.dispatchSchedules.filter(x => x.id !== params.id);
    return { success: true, demo: true };
  },

  // POST /api/dock-appointments
  'POST:/api/dock-appointments': (state, body) => {
    const id = genDemoLpnId('DOCK');
    const apt = { id, ...body, status: 'PROGRAMADA', created_by: 'sandbox', created_at: nowIso() };
    state.dockAppointments.unshift(apt);
    return { success: true, demo: true, id };
  },

  // POST /api/cycle-count
  'POST:/api/cycle-count': (state, body) => {
    const id = genDemoLpnId('CC');
    state.cycleCount.unshift({ id, ...body, status: 'EN_PROGRESO', created_by: 'sandbox', created_at: nowIso() });
    return { success: true, demo: true, id };
  },

  // POST /api/adjust-request
  'POST:/api/adjust-request': (state, body) => {
    const id = genDemoLpnId('ADJ');
    state.adjustRequests.unshift({ id, ...body, status: 'PENDIENTE', requested_by: 'sandbox', requested_at: nowIso() });
    return { success: true, demo: true, id };
  },
};

// Resuelve un handler de write. Soporta paths con `:id` simples.
function findWriteHandler(method, path) {
  const exact = `${method}:${path}`;
  if (writeHandlers[exact]) return { fn: writeHandlers[exact], params: {} };
  // intentar match con :id al final
  const m = path.match(/^(.+\/)([^/]+)(\/[^/]+)?$/);
  if (!m) return null;
  const tryPaths = [
    `${method}:${m[1]}:id${m[3] || ''}`,
  ];
  for (const tp of tryPaths) {
    if (writeHandlers[tp]) return { fn: writeHandlers[tp], params: { id: m[2] } };
  }
  return null;
}

module.exports = {
  getState, resetState, applyInventoryOverlay, findWriteHandler,
};
