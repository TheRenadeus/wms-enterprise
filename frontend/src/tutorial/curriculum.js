// Guion del curso tutorial guiado — 7 misiones + cierre.
// Cada misión define: contenido educativo, tab destino, selector del elemento
// a resaltar, y función de validación que recibe el estado de la app.

export const TOTAL_MISIONES = 7; // M0-M6, sin contar el CIERRE

export const MISIONES = [
  {
    id: 'M0',
    indice: 0,
    icono: '🏭',
    titulo: '¿Qué es un WMS?',
    subtitulo: 'Conceptos clave antes de empezar',
    concepto: (
      `Un WMS (Warehouse Management System) es el "cerebro" de una bodega. Como una biblioteca perfectamente organizada: siempre sabes QUÉ tienes, CUÁNTO y DÓNDE está.`
    ),
    glosario: [
      { termino: 'SKU',        emoji: '🏷',  def: 'El TIPO de producto. Ej: "Laptop 15 Pro" — no importa cuántas haya.' },
      { termino: 'LPN',        emoji: '📦',  def: 'La CAJA o pallet físico con un código único. Es la unidad que mueves.' },
      { termino: 'Ubicación',  emoji: '📍',  def: 'El LUGAR exacto en la bodega. Ej: 1-a-01-1 = bodega 1, pasillo a, columna 01, fila 1.' },
      { termino: 'Stock',      emoji: '🔢',  def: 'Cuántas unidades hay de un SKU en este momento.' },
    ],
    ciclo: ['📥 Recibir', '📦 Guardar', '🔍 Preparar', '🚚 Despachar', '📊 Controlar'],
    objetivo: 'Lee los conceptos y cuando estés listo, presiona "Siguiente".',
    targetTab: 'dashboard',
    targetSelector: null,
    tieneAccion: false,
    validar: () => true,
    mensajeExito: '¡Perfecto! Ya conoces el vocabulario básico del WMS.',
  },
  {
    id: 'M1',
    indice: 1,
    icono: '🔍',
    titulo: 'Explora el inventario',
    subtitulo: 'Misión 1 de 7',
    concepto: 'El inventario muestra todos los LPNs (cajas/pallets) que hay en la bodega ahora mismo, con su SKU, cantidad, ubicación y estado. Es la foto en tiempo real de tu stock.',
    objetivo: 'Haz clic en "Stock Físico" en el menú izquierdo. Encuentra un LPN y observa su ubicación y cantidad.',
    targetTab: 'inventory',
    targetSelector: '[data-tutorial-target="inventory-tab"]',
    tieneAccion: true,
    validar: ({ activeTab }) => activeTab === 'inventory',
    mensajeExito: '¡Excelente! Ya sabes cómo ver el inventario en tiempo real.',
  },
  {
    id: 'M2',
    indice: 2,
    icono: '📥',
    titulo: 'Recibe mercadería',
    subtitulo: 'Misión 2 de 7 — Inbound',
    concepto: 'Cuando llega mercadería a la bodega, debemos registrarla. Este proceso se llama "recepción" o Inbound. Al recibirla, el sistema crea un LPN nuevo con la ubicación de llegada (generalmente PISO-RECEPCION).',
    objetivo: 'Ve a "Recepciones (In)" en el menú. Registra una recepción de prueba: elige cualquier SKU, ingresa una cantidad y confirma.',
    targetTab: 'receive',
    targetSelector: '[data-tutorial-target="receive-tab"]',
    tieneAccion: true,
    validar: ({ inventoryCountRef, permittedInventory }) =>
      permittedInventory.length > (inventoryCountRef.current || 0),
    mensajeExito: '¡Muy bien! Recibiste mercadería. El sistema creó un LPN nuevo en PISO-RECEPCION.',
    hint: 'Si ya registraste la recepción, presiona "Ya lo hice ✓".',
  },
  {
    id: 'M3',
    indice: 3,
    icono: '📦',
    titulo: 'Guarda en una ubicación',
    subtitulo: 'Misión 3 de 7 — Putaway',
    concepto: 'Después de recibir, debemos "guardar" cada LPN en su ubicación definitiva dentro de la bodega. Esto se llama Putaway (ubicar). El sistema registra el movimiento y actualiza el mapa de la bodega.',
    objetivo: 'Ve a "Reubicaciones" en el menú. Toma el LPN que acabas de recibir y asígnale una ubicación de almacenamiento (ej: 1-a-01-1).',
    targetTab: 'relocate',
    targetSelector: '[data-tutorial-target="relocate-tab"]',
    tieneAccion: true,
    // Detecta que al menos un LPN cambió de location_id respecto al snapshot inicial.
    validar: ({ permittedInventory, locationMapRef }) => {
      const snap = locationMapRef?.current ?? {};
      return permittedInventory.some(i => {
        const prev = snap[i.id];
        return prev !== undefined && prev !== i.location_id;
      });
    },
    mensajeExito: '¡Perfecto! El LPN quedó guardado en su ubicación. Ya no está en el piso.',
    hint: 'Busca el LPN recibido en la lista, elige "Reubicar" y escribe la ubicación destino.',
  },
  {
    id: 'M4',
    indice: 4,
    icono: '🔍',
    titulo: 'Prepara un pedido',
    subtitulo: 'Misión 4 de 7 — Picking',
    concepto: 'Cuando un cliente hace un pedido, necesitamos "pickear" (recoger) los productos desde sus ubicaciones. El sistema crea una tarea de picking que indica qué producto tomar, desde dónde y cuánto.',
    objetivo: 'Ve a "Cola de Picking" o "Despachos" en el menú. Inicia o confirma una tarea de picking existente.',
    targetTab: 'picking-monitor',
    targetSelector: '[data-tutorial-target="picking-tab"]',
    tieneAccion: true,
    validar: ({ pickTasks, pickCountRef }) =>
      pickTasks.length > (pickCountRef.current || 0),
    mensajeExito: '¡Excelente! Confirmaste una tarea de picking. El pedido está listo para despachar.',
    hint: 'Si ya confirmaste una tarea, presiona "Ya lo hice ✓".',
  },
  {
    id: 'M5',
    indice: 5,
    icono: '🚚',
    titulo: 'Despacha el pedido',
    subtitulo: 'Misión 5 de 7 — Outbound',
    concepto: 'Despachar es sacar los productos de la bodega hacia el cliente. Al registrar el despacho, el sistema descuenta el stock automáticamente. Esto cierra el ciclo de salida (Outbound).',
    objetivo: 'Ve a "Despachos" en el menú. Completa un despacho y observa cómo baja el stock en el inventario.',
    targetTab: 'dispatch',
    targetSelector: '[data-tutorial-target="dispatch-tab"]',
    tieneAccion: true,
    // Detecta despacho total (menos LPNs) O despacho parcial (qty total bajó).
    validar: ({ permittedInventory, inventoryCountRef, stockTotalRef }) => {
      const qtyActual = permittedInventory.reduce((s, i) => s + parseFloat(i.qty || 0), 0);
      const snapQty   = stockTotalRef?.current ?? 0;
      const snapCount = inventoryCountRef?.current ?? 0;
      return qtyActual < snapQty || permittedInventory.length < snapCount;
    },
    mensajeExito: '¡Fantástico! Despachaste. El stock bajó y el ciclo de salida está completo.',
    hint: 'Si ya completaste el despacho, presiona "Ya lo hice ✓".',
  },
  {
    id: 'M6',
    indice: 6,
    icono: '📊',
    titulo: 'Controla el inventario',
    subtitulo: 'Misión 6 de 7 — Control',
    concepto: 'Un buen WMS no solo mueve mercadería: también te avisa cuando algo sale mal. Las alertas te informan de stock bajo, vencimientos o diferencias. El "conteo cíclico" es una revisión periódica para confirmar que lo que dice el sistema coincide con lo físico.',
    objetivo: 'Vuelve al Dashboard y revisa el panel de alertas. Luego ve a "Inventario" y observa los estados de los LPNs.',
    targetTab: 'dashboard',
    targetSelector: '[data-tutorial-target="dashboard-tab"]',
    tieneAccion: true,
    validar: ({ activeTab }) => activeTab === 'dashboard' || activeTab === 'inventory',
    mensajeExito: '¡Muy bien! Revisaste el control de inventario. Eres un experto en WMS.',
  },
];

export const CIERRE = {
  id: 'CIERRE',
  icono: '🎓',
  titulo: '¡Ciclo completo!',
  ciclo: [
    { emoji: '📥', label: 'Recibir',    desc: 'Registraste la entrada de mercadería.' },
    { emoji: '📦', label: 'Guardar',    desc: 'Ubicaste los LPNs en la bodega.' },
    { emoji: '🔍', label: 'Preparar',   desc: 'Confirmaste tareas de picking.' },
    { emoji: '🚚', label: 'Despachar',  desc: 'Completaste la salida al cliente.' },
    { emoji: '📊', label: 'Controlar',  desc: 'Revisaste alertas y estado del stock.' },
  ],
  mensaje: 'Completaste el ciclo completo de un WMS. Ahora puedes explorar todas las funciones con confianza. ¡Recuerda que el sandbox no guarda cambios reales — puedes experimentar sin miedo!',
};
