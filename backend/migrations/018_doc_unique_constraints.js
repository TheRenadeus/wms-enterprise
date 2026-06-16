// Anti-duplicados de documentos: índices UNIQUE por (cliente, [tipo], número).
//
// Regla de negocio: el mismo número de documento NO puede repetirse para el
// mismo cliente y tipo; pero dos clientes distintos SÍ pueden usar el mismo
// número (por eso nunca un UNIQUE global del número).
//
// Implementado como CREATE UNIQUE INDEX IF NOT EXISTS (idempotente). Usa
// NULLS NOT DISTINCT (PG15+) para que filas con client_id/doc_type NULL e igual
// número también se consideren duplicadas. Para tablas de "solicitud/agenda" el
// índice es PARCIAL (solo bloquea mientras el documento está vigente/pendiente).
//
// ⚠️ Si alguna tabla tuviera duplicados, el CREATE UNIQUE INDEX fallará: hay que
// limpiarlos antes (ver auditoría, Paso 3). Al momento de crear esta migración
// todas las tablas estaban vacías.
module.exports = {
  id: '018_doc_unique_constraints',
  async run(pool) {
    // Correlativo de factura por cliente (numeración secuencial atómica).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoice_counters (
        client_id VARCHAR(100) PRIMARY KEY,
        last_num  INTEGER NOT NULL DEFAULT 0
      )
    `);

    const stmts = [
      // (cliente, tipo, número)
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_returns_client_type_doc
         ON returns (client_id, doc_type, doc_num) NULLS NOT DISTINCT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_dispatch_schedules_client_type_doc
         ON dispatch_schedules (client_id, doc_type, doc_num) NULLS NOT DISTINCT`,
      // (cliente, número)
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_client_num
         ON invoices (client_id, invoice_num) NULLS NOT DISTINCT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_shipments_client_doc
         ON shipments (client_id, doc_num) NULLS NOT DISTINCT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_packing_client_doc
         ON packing_orders (client_id, dispatch_doc_num) NULLS NOT DISTINCT`,
      // facturación por cliente + período (no tiene "número", el período es la clave)
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_client_period
         ON billing_invoices (client_id, year, month) NULLS NOT DISTINCT`,
      // ASN: por proveedor + referencia (no tiene client_id)
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_asns_supplier_ref
         ON asns (supplier_id, reference) NULLS NOT DISTINCT`,
      // Agenda de muelle: un doc no se agenda dos veces (por módulo) mientras esté vigente
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_dock_appt_doc_active
         ON dock_appointments (doc_num, COALESCE(module,''))
         WHERE status NOT IN ('CANCELADA','CANCELLED','COMPLETADA','COMPLETED')`,
      // Solicitudes: solo una PENDIENTE por documento
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_adjustment_req_pending
         ON adjustment_requests (doc_num) WHERE status = 'PENDIENTE'`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_anulation_req_pending
         ON anulation_requests (doc_num) WHERE status = 'PENDIENTE'`,
    ];
    for (const sql of stmts) {
      await pool.query(sql);
    }
    console.log('[migr-018] índices anti-duplicados de documentos creados');
  },
};
