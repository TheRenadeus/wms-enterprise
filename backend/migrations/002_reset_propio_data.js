// Purga datos de SKU y clientes existentes y los reemplaza con datos PROPIO.
//
// Ejecuta una sola vez (tracked en schema_migrations). Elimina inventario,
// maestro de SKUs y clientes, y re-siembra el catálogo de Modo Propio.

module.exports = {
  id: '002_reset_propio_data',
  run: async (pool) => {
    const log = (msg) => console.log('[seed-002]', msg);

    // ── Purgar datos existentes (orden respeta dependencias) ────────────
    await pool.query(`DELETE FROM inventory_lpns`);
    log('inventory_lpns purgado');

    await pool.query(`DELETE FROM master_skus`);
    log('master_skus purgado');

    // Mantener PROPIO si existe; eliminar el resto
    await pool.query(`DELETE FROM clients WHERE id <> 'PROPIO'`);
    log('clients 3PL purgados');

    // Limpiar referencias huérfanas de módulos relacionados (si existen)
    await pool.query(`DELETE FROM purchase_orders WHERE client_id <> 'PROPIO'`).catch(() => {});
    await pool.query(`DELETE FROM returns WHERE client_id <> 'PROPIO'`).catch(() => {});
    await pool.query(`DELETE FROM processed_docs WHERE client_id <> 'PROPIO'`).catch(() => {});
    await pool.query(`DELETE FROM document_history`).catch(() => {});

    // ── Cliente PROPIO ──────────────────────────────────────────────────
    await pool.query(`INSERT INTO clients (id,name,contact,email) VALUES
      ('PROPIO','Bodega Propia','Administrador','admin@empresa.cl')
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, contact=EXCLUDED.contact, email=EXCLUDED.email`);
    log('cliente PROPIO asegurado');

    // ── Catálogo de SKUs PROPIO ─────────────────────────────────────────
    await pool.query(`INSERT INTO master_skus (sku,client_id,"desc",category,uom,stock_min,stock_max,weight,requires_lot,requires_serial) VALUES
      ('ELEC-TV-55','PROPIO','Smart TV 55" 4K UHD','Electrónica','UN',5,50,18.5,false,true),
      ('ELEC-LAPTOP-15','PROPIO','Laptop 15" Core i7 16GB','Electrónica','UN',3,30,2.1,false,true),
      ('ELEC-MOUSE-WL','PROPIO','Mouse inalámbrico ergonómico','Electrónica','UN',20,200,0.15,false,false),
      ('ELEC-TECLADO-MEC','PROPIO','Teclado mecánico RGB','Electrónica','UN',10,100,1.2,false,false),
      ('HERR-TALADRO-18V','PROPIO','Taladro inalámbrico 18V','Herramientas','UN',2,20,2.5,true,false),
      ('HERR-LLAVE-SET','PROPIO','Set llaves combinadas 12 pzs','Herramientas','UN',5,50,3.8,false,false),
      ('HERR-SIERRA-CIRC','PROPIO','Sierra circular 7-1/4"','Herramientas','UN',2,15,4.2,true,false),
      ('HERR-CASCO-SEG','PROPIO','Casco de seguridad industrial','Herramientas','UN',10,80,0.45,false,false),
      ('OFIC-PAPEL-A4','PROPIO','Papel bond A4 resma 500 hojas','Oficina','UN',20,200,2.5,false,false),
      ('OFIC-TONER-HP','PROPIO','Tóner HP LaserJet negro','Oficina','UN',3,30,0.9,true,false),
      ('OFIC-CARPETA','PROPIO','Carpeta archivador lomo ancho','Oficina','UN',30,300,0.35,false,false),
      ('CONS-AGUA-2L','PROPIO','Agua mineral 2L pack x6','Consumo','PACK',10,100,12.0,true,false),
      ('CONS-CAFE-1K','PROPIO','Café tostado molido 1kg','Consumo','UN',5,50,1.0,true,false)
      ON CONFLICT (sku,client_id) DO UPDATE SET "desc"=EXCLUDED."desc", category=EXCLUDED.category, stock_min=EXCLUDED.stock_min, stock_max=EXCLUDED.stock_max`);
    log('13 SKUs PROPIO insertados');

    // ── Ubicaciones PROPIO ──────────────────────────────────────────────
    await pool.query(`INSERT INTO locations_master (location_id,zone_code) VALUES
      ('RACK-A-01','ZONA-A'),('RACK-A-02','ZONA-A'),('RACK-A-03','ZONA-A'),
      ('RACK-B-01','ZONA-B'),('RACK-B-02','ZONA-B'),('RACK-B-03','ZONA-B'),
      ('RACK-C-01','ZONA-C'),('RACK-C-02','ZONA-C'),
      ('PICKING-01','PICKING'),('PICKING-02','PICKING'),
      ('CAMARA-FRIA-01','CAMARA'),('CUARENTENA-01','CUARENTENA')
      ON CONFLICT (location_id) DO NOTHING`);

    // ── Inventario inicial PROPIO ───────────────────────────────────────
    await pool.query(`INSERT INTO inventory_lpns (id,client_id,sku,qty,status,location_id,batch_number,serial_number,expiry_date,glosa,created_at) VALUES
      ('LPN-PROPIO-0001','PROPIO','ELEC-TV-55',1,'DISPONIBLE','RACK-A-01','LOTE-2026-01','SN-TV55-001',NULL,'[PROPIO] Stock inicial',NOW()-INTERVAL '10 days'),
      ('LPN-PROPIO-0002','PROPIO','ELEC-TV-55',1,'DISPONIBLE','RACK-A-01','LOTE-2026-01','SN-TV55-002',NULL,'[PROPIO] Stock inicial',NOW()-INTERVAL '10 days'),
      ('LPN-PROPIO-0003','PROPIO','ELEC-TV-55',1,'DISPONIBLE','RACK-A-01','LOTE-2026-01','SN-TV55-003',NULL,'[PROPIO] Stock inicial',NOW()-INTERVAL '10 days'),
      ('LPN-PROPIO-0004','PROPIO','ELEC-LAPTOP-15',1,'DISPONIBLE','RACK-A-02','LOTE-2026-01','SN-LAP15-001',NULL,'[PROPIO]',NOW()-INTERVAL '8 days'),
      ('LPN-PROPIO-0005','PROPIO','ELEC-LAPTOP-15',1,'DISPONIBLE','RACK-A-02','LOTE-2026-01','SN-LAP15-002',NULL,'[PROPIO]',NOW()-INTERVAL '8 days'),
      ('LPN-PROPIO-0006','PROPIO','ELEC-MOUSE-WL',80,'DISPONIBLE','RACK-A-03','LOTE-2026-02',NULL,NULL,'[PROPIO]',NOW()-INTERVAL '7 days'),
      ('LPN-PROPIO-0007','PROPIO','ELEC-TECLADO-MEC',25,'DISPONIBLE','RACK-A-03','LOTE-2026-02',NULL,NULL,'[PROPIO]',NOW()-INTERVAL '7 days'),
      ('LPN-PROPIO-0008','PROPIO','HERR-TALADRO-18V',12,'DISPONIBLE','RACK-B-01','LOTE-H-2026-A',NULL,NULL,'[PROPIO]',NOW()-INTERVAL '6 days'),
      ('LPN-PROPIO-0009','PROPIO','HERR-LLAVE-SET',30,'DISPONIBLE','RACK-B-02','LOTE-H-2026-B',NULL,NULL,'[PROPIO]',NOW()-INTERVAL '6 days'),
      ('LPN-PROPIO-0010','PROPIO','HERR-SIERRA-CIRC',6,'DISPONIBLE','RACK-B-03','LOTE-H-2026-C',NULL,NULL,'[PROPIO]',NOW()-INTERVAL '6 days'),
      ('LPN-PROPIO-0011','PROPIO','HERR-CASCO-SEG',45,'DISPONIBLE','RACK-B-03','LOTE-H-2026-D',NULL,NULL,'[PROPIO]',NOW()-INTERVAL '6 days'),
      ('LPN-PROPIO-0012','PROPIO','OFIC-PAPEL-A4',120,'DISPONIBLE','RACK-C-01','LOTE-O-2026-A',NULL,NULL,'[PROPIO]',NOW()-INTERVAL '5 days'),
      ('LPN-PROPIO-0013','PROPIO','OFIC-PAPEL-A4',80,'DISPONIBLE','PICKING-01','LOTE-O-2026-A',NULL,NULL,'[PROPIO] Reposición picking',NOW()-INTERVAL '2 days'),
      ('LPN-PROPIO-0014','PROPIO','OFIC-TONER-HP',18,'DISPONIBLE','RACK-C-01','LOTE-O-2026-B',NULL,NULL,'[PROPIO]',NOW()-INTERVAL '5 days'),
      ('LPN-PROPIO-0015','PROPIO','OFIC-CARPETA',150,'DISPONIBLE','RACK-C-02','LOTE-O-2026-C',NULL,NULL,'[PROPIO]',NOW()-INTERVAL '5 days'),
      ('LPN-PROPIO-0016','PROPIO','CONS-AGUA-2L',40,'DISPONIBLE','CAMARA-FRIA-01','LOTE-C-2026-A',NULL,(NOW() + INTERVAL '180 days')::date,'[PROPIO]',NOW()-INTERVAL '3 days'),
      ('LPN-PROPIO-0017','PROPIO','CONS-CAFE-1K',22,'DISPONIBLE','RACK-C-02','LOTE-C-2026-B',NULL,(NOW() + INTERVAL '365 days')::date,'[PROPIO]',NOW()-INTERVAL '3 days'),
      ('LPN-PROPIO-0018','PROPIO','HERR-TALADRO-18V',2,'CUARENTENA','CUARENTENA-01','LOTE-H-2026-A',NULL,NULL,'[PROPIO] Daño en embalaje',NOW()-INTERVAL '1 day'),
      ('LPN-PROPIO-0019','PROPIO','ELEC-MOUSE-WL',5,'BLOQUEADO','CUARENTENA-01','LOTE-2026-02',NULL,NULL,'[PROPIO] Revisión calidad',NOW()-INTERVAL '1 day'),
      ('LPN-PROPIO-0020','PROPIO','CONS-AGUA-2L',8,'CUARENTENA','CUARENTENA-01','LOTE-C-2026-A',NULL,(NOW() + INTERVAL '180 days')::date,'[PROPIO] Pendiente inspección',NOW()-INTERVAL '1 day')
      ON CONFLICT (id) DO NOTHING`);
    log('20 LPNs inventario PROPIO insertados');

    await pool.query(`UPDATE inventory_lpns SET serial_number = NULL WHERE serial_number = ''`);

    log('reset PROPIO completo');
  },
};
