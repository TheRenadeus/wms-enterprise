// Constantes extraídas de App.js (split)

export const initialSkuForm = { sku: '', barcode: '', desc: '', category: 'General', uom: 'UN', weight: '', length: '', width: '', height: '', abc_class: '-', traceability: 'NONE', client_id: '', manufacturer_id: '', manufacturer_code: '', manufacturer_sku: '', brand: '', allow_substitutes: false, substitute_scope: 'any', substitute_threshold: '' };

// Módulos que el modo PROPIO oculta automáticamente
export const MODULES_3PL_ONLY = ['clients', '3pl-billing', 'billing'];

export const APP_MODULES = [
  // Menú principal
  { id: 'dashboard', label: 'Resumen del día' },
  { id: 'inventory', label: 'Productos en bodega' },
  { id: 'master-skus', label: 'Ficha de productos' },
  { id: 'clients', label: 'Mis clientes' },
  // Movimientos de mercancía
  { id: 'receive', label: 'Recibir mercancía' },
  { id: 'dispatch', label: 'Despachar pedidos' },
  { id: 'relocate', label: 'Cambiar de ubicación' },
  { id: 'adjust', label: 'Corregir cantidades' },
  { id: 'returns', label: 'Mercancía devuelta' },
  { id: 'change-status', label: 'Cambiar estado de producto' },
  // Operaciones del día
  { id: 'picking-monitor', label: 'Cola de picking' },
  { id: 'picker-queue', label: 'Mi cola de tareas' },
  { id: 'waves', label: 'Grupos de picking' },
  { id: 'packing', label: 'Empacar pedidos' },
  { id: 'dispatch-schedule', label: 'Despachos programados' },
  { id: 'cycle-count', label: 'Contar físicamente' },
  { id: 'docks', label: 'Agenda de muelles' },
  { id: 'kits', label: 'Armar kits' },
  // Compras y proveedores
  { id: 'suppliers', label: 'Proveedores' },
  { id: 'manufacturers', label: 'Fabricantes' },
  { id: 'purchase-orders', label: 'Órdenes de compra' },
  { id: 'transport', label: 'Seguimiento de envíos' },
  // Reportes y consultas
  { id: 'audit', label: 'Historial de movimientos' },
  { id: 'doc-history', label: 'Documentos procesados' },
  { id: 'lpn-history', label: 'Trazabilidad de bultos' },
  { id: 'advanced-reports', label: 'Reportes y análisis' },
  { id: 'sku-movement', label: 'Movimiento por SKU' },
  { id: 'kardex',       label: 'Kardex por SKU' },
  { id: 'rep-report', label: 'Uso de recursos' },
  { id: 'occupation', label: 'Ocupación de bodega' },
  { id: 'digital-twin', label: 'Vista 3D de bodega' },
  { id: 'warehouse', label: 'Diseño de bodega' },
  // Facturación
  { id: 'billing', label: 'Facturación' },
  { id: '3pl-billing', label: 'Cobros a clientes' },
  // Configuración / maestros menores
  { id: 'statuses', label: 'Estados disponibles' },
  { id: 'doc-types', label: 'Tipos de documento' },
  { id: 'access-log', label: 'Registro de accesos' },
];

export const colorMap = { slate: 'bg-slate-50 text-slate-600 border-slate-200', emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200', red: 'bg-red-50 text-red-600 border-red-200', amber: 'bg-amber-50 text-amber-600 border-amber-200', blue: 'bg-blue-50 text-blue-600 border-blue-200', purple: 'bg-purple-50 text-purple-600 border-purple-200', pink: 'bg-pink-50 text-pink-600 border-pink-200' };

// ── BADGES DE ESTADO ──────────────────────────────────────────────────────────
// Mapea el código en BD (que no cambia) al texto visible al usuario.
// Usado por audit_log.type, inventory_lpns.status, *_status de waves/picks/etc.
export const STATUS_LABELS = {
  // Movimientos del audit log
  INBOUND:        'Entrada',
  OUTBOUND:       'Salida',
  RELOCATE:       'Reubicado',
  ADJUST:         'Ajustado',
  ADJUST_IN:      'Ajuste +',
  ADJUST_OUT:     'Ajuste −',
  WRITE_OFF:      'Dado de baja',
  STATUS_CHANGE:  'Cambio de estado',
  // Estados de procesos
  IN_TRANSIT:     'En camino',
  PENDING:        'Pendiente',
  PENDIENTE:      'Pendiente',
  IN_PROGRESS:    'En proceso',
  EN_PROCESO:     'En proceso',
  EN_CURSO:       'En proceso',
  DONE:           'Listo',
  COMPLETADA:     'Completado',
  COMPLETADO:     'Completado',
  COMPLETED:      'Completado',
  CANCELLED:      'Cancelado',
  CANCELADO:      'Cancelado',
  CANCELADA:      'Cancelado',
  APPROVED:       'Aprobado',
  APROBADO:       'Aprobado',
  APROBADA:       'Aprobado',
  REJECTED:       'Rechazado',
  RECHAZADO:      'Rechazado',
  RECHAZADA:      'Rechazado',
  DISPATCHED:     'Despachado',
  DESPACHADO:     'Despachado',
  CONFIRMED:      'Confirmado',
  CONFIRMADO:     'Confirmado',
  SCHEDULED:      'Programado',
  PROGRAMADO:     'Programado',
  PROGRAMADA:     'Programado',
  RECEIVED:       'Recibido',
  RECIBIDO:       'Recibido',
  PARCIAL:        'Parcial',
  ESPERANDO:      'En espera',
  REVISION:       'En revisión',
  EN_REVISION:    'En revisión',
  NUEVO:          'Nuevo',
  RESUELTO:       'Resuelto',
  // Estados físicos del LPN
  DISPONIBLE:     'Disponible',
  CUARENTENA:     'En cuarentena',
  BLOQUEADO:      'Bloqueado',
  RETENIDO:       'Retenido',
  VENCIDO:        'Vencido',
  // Tipos de backup
  PRE_RESTORE:    'Respaldo previo',
  MANUAL:         'Manual',
  // SCHEDULED ya está mapeado arriba (Programado). En contexto backup el caller
  // puede mostrar 'Automático' directamente.
};

// Helper: devuelve la etiqueta visible para un código. Si no está mapeado,
// devuelve el código tal cual (con normalización de mayúsculas).
export const statusLabel = (code) => {
  if (code === null || code === undefined || code === '') return '—';
  return STATUS_LABELS[String(code).toUpperCase()] || code;
};

export const IMPORT_CONFIG = {
  skus:      { title: 'Importar productos desde Excel',    required: ['sku','desc'],         optional: ['client_id','category','uom','weight','abc_class','requires_lot','requires_serial','barcode','manufacturer_code','manufacturer_sku','brand','allow_substitutes','substitute_scope','substitute_threshold'] },
  clients:   { title: 'Importar clientes desde Excel',     required: ['id','name'],           optional: ['contact','email'] },
  inventory: { title: 'Importar inventario desde Excel',   required: ['sku','qty'],           optional: ['client_id','location_id','batch_number','expiry_date','serial_number','glosa'] },
  receive:   { title: 'Recibir mercancía desde Excel',     required: ['sku','qty'],           optional: ['location_id','batch_number','expiry_date','serial_number','glosa'] },
  dispatch:  { title: 'Despachar pedidos desde Excel',     required: ['sku','qty_to_pick'],   optional: ['lpn_id'] },
};

// Los objetos DEMO_GLOSA_OPTIONS y DEMO_HINTS se añaden vía require al final,
// pero los exportamos a continuación con su contenido original para mantener el
// mismo comportamiento.

// ── SANDBOX DEMO ──────────────────────────────────────────────────────────────
export const SANDBOX_SCENARIOS = {
  PROPIO: {
    id: 'PROPIO', label: 'Bodega Propia', icon: '🏭', color: 'emerald',
    desc: 'Gestionas tu propio inventario — sin clientes externos.',
    detail: 'Ideal para empresas que manejan su propia cadena de suministro.',
  },
  '3PL': {
    id: '3PL', label: 'Operador 3PL', icon: '🌐', color: 'blue',
    desc: 'Almacén multi-cliente con facturación por servicios.',
    detail: 'Gestiona inventario de múltiples empresas, cobra por almacenaje y movimientos.',
  },
  HYBRID: {
    id: 'HYBRID', label: 'Híbrido', icon: '🔀', color: 'violet',
    desc: 'Tu inventario + clientes externos, todo en uno.',
    detail: 'Combina operación propia con servicios de almacenaje para terceros.',
  },
};

export const SANDBOX_ROLES = {
  ADMIN:            { id: 'ADMIN', label: 'Administrador', icon: '🏢', color: 'red', desc: 'Control total del sistema', shortDesc: 'Ve y modifica todo' },
  JEFE_BODEGA:      { id: 'JEFE_BODEGA', label: 'Jefe de Bodega', icon: '📦', color: 'teal', desc: 'Supervisión y operaciones de almacén', shortDesc: 'Supervisa, aprueba, opera' },
  EJECUTIVO_CUENTA: { id: 'EJECUTIVO_CUENTA', label: 'Ejecutivo de Cuenta', icon: '📋', color: 'emerald', desc: 'Operario de piso: recibe, despacha, reubica', shortDesc: 'Operaciones de stock' },
  AUDITOR:          { id: 'AUDITOR', label: 'Auditor', icon: '🔎', color: 'blue', desc: 'Vista de solo lectura para control', shortDesc: 'Solo observa y audita' },
  PICKER:           { id: 'PICKER', label: 'Picker', icon: '📱', color: 'violet', desc: 'Tareas de picking en el piso', shortDesc: 'Cola de tareas móvil' },
  CLIENTE:          { id: 'CLIENTE', label: 'Cliente 3PL', icon: '🏪', color: 'cyan', desc: 'Portal de solo lectura para clientes', shortDesc: 'Ve su propio stock' },
};

export const SANDBOX_MISSIONS = {
  ADMIN: [
    { id: 'admin-1', label: 'Explorar el Dashboard', tab: 'dashboard', desc: 'Ve las métricas principales del almacén' },
    { id: 'admin-2', label: 'Revisar el inventario', tab: 'inventory', desc: 'Busca y filtra el stock físico' },
    { id: 'admin-3', label: 'Crear un SKU', tab: 'master-skus', desc: 'Agrega un producto al catálogo' },
    { id: 'admin-4', label: 'Recibir mercadería', tab: 'receive', desc: 'Simula el ingreso de un pedido' },
    { id: 'admin-5', label: 'Despachar un pedido', tab: 'dispatch', desc: 'Procesa una salida del almacén' },
    { id: 'admin-6', label: 'Explorar el Mapa 3D', tab: 'digital-twin', desc: 'Visualiza la bodega en 3D' },
  ],
  JEFE_BODEGA: [
    { id: 'jb-1', label: 'Ver el Dashboard', tab: 'dashboard', desc: 'Revisa los KPIs operativos' },
    { id: 'jb-2', label: 'Crear tarea de picking', tab: 'picking-monitor', desc: 'Asigna trabajo a los pickers' },
    { id: 'jb-3', label: 'Programar un despacho', tab: 'dispatch-schedule', desc: 'Agenda una salida futura' },
    { id: 'jb-4', label: 'Aprobar un conteo cíclico', tab: 'cycle-count', desc: 'Revisa y aprueba diferencias' },
    { id: 'jb-5', label: 'Gestionar clientes', tab: 'clients', desc: 'Da de alta una cuenta 3PL' },
  ],
  EJECUTIVO_CUENTA: [
    { id: 'ej-1', label: 'Ver el Dashboard', tab: 'dashboard', desc: 'Revisa los KPIs operativos' },
    { id: 'ej-2', label: 'Recibir mercadería', tab: 'receive', desc: 'Procesa una recepción (pide re-clave)' },
    { id: 'ej-3', label: 'Despachar un pedido', tab: 'dispatch', desc: 'Procesa una salida (pide re-clave)' },
    { id: 'ej-4', label: 'Reubicar stock', tab: 'relocate', desc: 'Mueve un LPN a otra ubicación' },
    { id: 'ej-5', label: 'Solicitar un ajuste', tab: 'adjust', desc: 'Crea una solicitud para que un jefe apruebe' },
  ],
  AUDITOR: [
    { id: 'aud-1', label: 'Ver inventario actual', tab: 'inventory', desc: 'Consulta el stock sin modificarlo' },
    { id: 'aud-2', label: 'Revisar historial', tab: 'doc-history', desc: 'Busca documentos procesados' },
    { id: 'aud-3', label: 'Consultar audit log', tab: 'audit', desc: 'Revisa cada movimiento del sistema' },
    { id: 'aud-4', label: 'Rastrear un LPN', tab: 'lpn-history', desc: 'Ve la vida completa de un pallet' },
  ],
  PICKER: [
    { id: 'pk-1', label: 'Ver tu cola de tareas', tab: 'picker-queue', desc: 'Revisa las líneas asignadas' },
    { id: 'pk-2', label: 'Consultar stock', tab: 'inventory', desc: 'Busca dónde está un producto' },
    { id: 'pk-3', label: 'Ver el mapa 3D', tab: 'digital-twin', desc: 'Ubica racks y pasillos' },
  ],
  CLIENTE: [
    { id: 'cl-1', label: 'Ver tu Dashboard', tab: 'dashboard', desc: 'Métricas de tu inventario' },
    { id: 'cl-2', label: 'Consultar tu stock', tab: 'inventory', desc: 'Ve qué tienes almacenado' },
    { id: 'cl-3', label: 'Revisar documentos', tab: 'doc-history', desc: 'Historial de recepciones y despachos' },
  ],
};

export const DEMO_GLOSA_OPTIONS = {
  receive: [
    'Recepción guía de despacho proveedor',
    'Compra local — ingreso bodega',
    'Devolución de cliente',
    'Transferencia entre bodegas',
    'Ingreso por reposición de stock',
    'Mercadería en consignación',
  ],
  dispatch: [
    'Venta cliente — despacho normal',
    'Devolución a proveedor',
    'Transferencia interna entre bodegas',
    'Muestra comercial',
    'Despacho urgente — cliente prioritario',
    'Exportación / envío internacional',
  ],
  adjust: [
    'Merma por daño físico',
    'Merma por vencimiento',
    'Error de conteo en recepción anterior',
    'Diferencia detectada en inventario cíclico',
    'Producto dañado en bodega',
    'Sobrante no registrado en guía',
  ],
};

export const DEMO_HINTS = {
  dashboard: {
    icon: '📊', color: 'indigo',
    title: 'Panel de Control',
    desc: 'Aquí ves el estado general de tu almacén en tiempo real.',
    steps: [
      'Observa las tarjetas superiores: unidades totales, LPNs activos y SKUs del catálogo.',
      'Más abajo verás los KPIs de despacho y el gráfico de actividad semanal.',
      'Las alertas críticas (rojo) indican situaciones que requieren atención inmediata.',
      'Prueba el ícono 🔔 en la barra superior para ver notificaciones automáticas.',
    ],
    tip: 'Navega por el menú lateral para explorar cada módulo.',
  },
  receive: {
    icon: '📥', color: 'emerald',
    title: 'Módulo de Recepción',
    desc: 'Registra el ingreso de mercadería al almacén con trazabilidad completa.',
    steps: [
      'Crea un nuevo documento: ingresa el N° de guía o factura y selecciona el tipo.',
      'Agrega líneas de ítem: selecciona el SKU, cantidad y asigna una ubicación.',
      'Opcionalmente agrega número de lote o fecha de vencimiento para trazabilidad.',
      'Confirma la recepción → el stock queda registrado con LPN único.',
    ],
    tip: 'Los LPNs (License Plate Numbers) identifican cada unidad de carga en el sistema.',
  },
  dispatch: {
    icon: '📤', color: 'blue',
    title: 'Módulo de Despacho',
    desc: 'Gestiona las salidas de mercadería con picking preciso por LPN.',
    steps: [
      'Crea un documento de despacho con el N° de guía y tipo de documento.',
      'Busca el SKU a despachar: el sistema muestra los LPNs disponibles con ubicación.',
      'Selecciona el LPN y cantidad a picar → se descuenta del stock en tiempo real.',
      'El historial de despachos queda registrado en el módulo de Historial.',
    ],
    tip: 'Puedes importar despachos masivos desde Excel/CSV usando el botón de importación.',
  },
  inventory: {
    icon: '📦', color: 'purple',
    title: 'Stock Físico',
    desc: 'Visualiza y gestiona el inventario completo por LPN, ubicación y estado.',
    steps: [
      'Usa los filtros superiores para buscar por SKU, cliente, ubicación o estado.',
      'Cada fila es un LPN: muestra cantidad, lote, vencimiento y ubicación actual.',
      'Puedes reubicar un LPN arrastrándolo a otra ubicación con el botón de reubicación.',
      'Cambia el estado de un LPN (Disponible, Retenido, etc.) desde la última columna.',
    ],
    tip: 'Haz clic en la columna "Acciones" para reubicar o cambiar estado de cualquier LPN.',
  },
  clients: {
    icon: '🏢', color: 'amber',
    title: 'Gestión de Clientes 3PL',
    desc: 'Registra los clientes cuya mercadería administra el almacén.',
    steps: [
      'Crea un cliente con su ID único (ej: CLI-001), razón social y datos de contacto.',
      'Cada cliente tiene su inventario aislado — los operadores solo ven lo que se les asigna.',
      'Activa el Portal 3PL por cliente para darles acceso de solo-lectura a su inventario.',
      'La URL del portal es: esta URL + ?portal=ID_CLIENTE',
    ],
    tip: 'En modo 3PL cada cliente es facturado por los servicios de almacenaje utilizados.',
  },
  'master-skus': {
    icon: '🏷️', color: 'rose',
    title: 'Catálogo de Artículos',
    desc: 'Define los productos que el almacén gestiona por cliente.',
    steps: [
      'Crea un artículo con SKU único, descripción, unidad de medida y categoría.',
      'Define si requiere lote o número de serie para trazabilidad.',
      'Configura stock mínimo y máximo para que el sistema genere alertas automáticas.',
      'El código de barras permite recepcionar con escáner en el módulo de recepción.',
    ],
    tip: 'El mismo SKU puede existir para distintos clientes — cada combinación es independiente.',
  },
  kits: {
    icon: '🧩', color: 'violet',
    title: 'Armado de Kits',
    desc: 'Define y ensambla productos compuestos a partir de componentes individuales.',
    steps: [
      'En "Definiciones": crea un Kit con su SKU y agrega los componentes con sus cantidades.',
      'En "Armar Kit": selecciona el kit y la cantidad a ensamblar.',
      'El sistema verifica si hay stock suficiente de cada componente antes de armar.',
      'Al confirmar, se consume el stock de componentes y se crea un LPN con el kit armado.',
    ],
    tip: 'Los kits armados quedan en "Órdenes" con el historial completo de cada armado.',
  },
  adjust: {
    icon: '✏️', color: 'orange',
    title: 'Hoja de Ajustes',
    desc: 'Corrige diferencias de inventario encontradas en conteos físicos.',
    steps: [
      'Busca el LPN o SKU a ajustar en el buscador superior.',
      'Ingresa la cantidad real contada — el sistema calcula la diferencia.',
      'Agrega una glosa explicando el motivo del ajuste (merma, daño, error de conteo, etc.).',
      'El ajuste queda registrado en el audit log para auditoría.',
    ],
    tip: 'Usa el módulo de Conteos Cíclicos para planificar y ejecutar inventarios por zona.',
  },
  transport: {
    icon: '🚛', color: 'cyan',
    title: 'Módulo de Transporte',
    desc: 'Gestiona transportistas y el seguimiento de envíos desde despacho hasta entrega.',
    steps: [
      'En "Transportistas": registra las empresas de transporte con sus datos de contacto.',
      'En "Envíos": crea un envío vinculando un transportista con un documento de despacho.',
      'Avanza el estado del envío: Pendiente → Asignado → En Tránsito → Entregado.',
      'Los envíos entregados contribuyen al KPI "Tasa On-Time" del dashboard.',
    ],
    tip: 'El estado "Devuelto" se usa cuando el destinatario rechaza o no recibe el envío.',
  },
  returns: {
    icon: '↩️', color: 'orange',
    title: 'Devoluciones',
    desc: 'Procesa la reingresa de mercadería devuelta por clientes o transportistas.',
    steps: [
      'Crea una devolución indicando el documento original y el motivo.',
      'Agrega los ítems devueltos: SKU, cantidad y condición (Buen Estado o Dañado).',
      'Buen Estado → el stock queda disponible; Dañado → queda en estado RETENIDO.',
      'Cada devolución genera un LPN nuevo en el almacén.',
    ],
    tip: 'Las devoluciones se contabilizan en el KPI "Tasa de Devoluciones" del dashboard.',
  },
  users: {
    icon: '👤', color: 'indigo',
    title: 'Usuarios y Permisos',
    desc: 'Gestiona los accesos al sistema con control granular por módulo y cliente.',
    steps: [
      'Crea un usuario con username, contraseña y rol base (Operario, Supervisor, Admin).',
      'En "Permisos de Visualización": elige qué módulos del menú puede ver cada usuario.',
      'En "Aislamiento por Cliente": restringe qué inventario puede ver y operar.',
      'Los Supervisores y Admins pueden crear usuarios; solo SUPERADMIN ve esta sección completa.',
    ],
    tip: 'Las API Keys permiten conectar sistemas ERP externos con acceso de solo lectura.',
  },
  warehouse: {
    icon: '🏭', color: 'slate',
    title: 'Diseño de Bodega',
    desc: 'Configura el mapa visual de la bodega con racks, pasillos y zonas.',
    steps: [
      'Usa el modo edición para agregar racks y definir zonas.',
      'Haz clic en una ubicación del mapa para ver el inventario en tiempo real.',
      'Los colores indican ocupación: verde=disponible, rojo=lleno, gris=bloqueado.',
      'Las ubicaciones creadas aquí aparecen como destino al reubicar stock.',
    ],
    tip: 'El Gemelo Digital 3D ofrece una vista tridimensional de la misma bodega.',
  },
  'digital-twin': {
    icon: '🧊', color: 'indigo',
    title: 'Mapa 3D de Bodega',
    desc: 'Visualización tridimensional interactiva del inventario en tiempo real.',
    steps: [
      'Cada bloque representa una ubicación física del almacén.',
      'Los colores indican el nivel de ocupación: verde=libre, amarillo=parcial, rojo=lleno.',
      'Haz clic en un rack para ver qué LPNs y SKUs están almacenados en esa posición.',
      'El mapa se actualiza automáticamente con cada recepción o despacho.',
    ],
    tip: 'Usa el mapa 3D como herramienta de supervisión en pantalla grande o TV de bodega.',
  },
  statuses: {
    icon: '🚦', color: 'teal',
    title: 'Estados Físicos',
    desc: 'Define los estados posibles para los LPNs (ej: Disponible, Bloqueado, Cuarentena).',
    steps: [
      'Cada estado tiene un color de badge para identificarlo visualmente en inventario.',
      'El flag "Bloquea Despacho" impide que un LPN con ese estado sea despachado.',
      'Puedes crear estados personalizados según las necesidades del almacén.',
      'Los estados se asignan a los LPNs desde el módulo "Cambiar Estado LPN".',
    ],
    tip: 'El estado CUARENTENA es útil para aislar mercadería pendiente de inspección de calidad.',
  },
  'doc-types': {
    icon: '📋', color: 'slate',
    title: 'Tipos de Documento',
    desc: 'Configura los tipos de documento usados en recepciones y despachos.',
    steps: [
      'Cada tipo de documento tiene un ID único y una descripción (ej: GUIA_DESPACHO, FACTURA).',
      'El campo "Flujo" define si aplica a entradas (INBOUND), salidas (OUTBOUND) o ambos.',
      'Los tipos aparecen como opciones en los módulos de Recepción y Despacho.',
      'Agrega tipos propios si tu operación usa documentos especiales.',
    ],
    tip: 'Para Chile: los tipos más comunes son Guía de Despacho y Factura Electrónica.',
  },
  audit: {
    icon: '📜', color: 'slate',
    title: 'Historial Logs',
    desc: 'Trazabilidad completa de cada movimiento de inventario en el sistema.',
    steps: [
      'Cada fila es un evento: INBOUND (entrada), OUTBOUND (salida), ADJUST (ajuste) o RELOC (reubicación).',
      'Filtra por fecha, tipo o usuario para auditar operaciones específicas.',
      'La columna "Glosa" registra el número de documento y contexto del movimiento.',
      'Este log es inmutable — ningún usuario puede borrar o modificar registros de auditoría.',
    ],
    tip: 'Usa el Historial LPN para ver todos los eventos de un LPN específico en orden cronológico.',
  },
  occupation: {
    icon: '📊', color: 'blue',
    title: 'Ocupación de Bodega',
    desc: 'Visualiza el uso del espacio físico por zona y ubicación en tiempo real.',
    steps: [
      'La tabla muestra cada ubicación con la cantidad de LPNs y unidades almacenadas.',
      'La barra de porcentaje indica el nivel de ocupación respecto a la capacidad configurada.',
      'Usa los filtros de zona para analizar sectores específicos del almacén.',
      'Exporta el reporte para presentaciones de capacidad o planificación de espacio.',
    ],
    tip: 'Una ocupación mayor al 85% indica que es momento de planificar expansión o reasignación.',
  },
  'rep-report': {
    icon: '🔧', color: 'amber',
    title: 'Materiales y HH',
    desc: 'Define los recursos (materiales y horas hombre) que consume cada SKU al despacharse.',
    steps: [
      'En "Configurar SKUs": selecciona un SKU y agrega los materiales que usa (ej: caja, cinta, relleno).',
      'Para cada material indica la cantidad por unidad despachada y la unidad de medida.',
      'Agrega recursos tipo HH: define el rol, el tiempo por unidad (en horas o minutos) y el N° de personas.',
      'En "Reporte Consumo": filtra por período y cliente para ver el total de materiales y HH utilizados.',
    ],
    tip: 'El reporte muestra totales en horas y minutos para facilitar la planificación de personal.',
  },
  '3pl-billing': {
    icon: '💰', color: 'emerald',
    title: 'Cobros 3PL',
    desc: 'Genera y gestiona las facturas de servicios de almacenaje para cada cliente.',
    steps: [
      'Configura las tarifas por cliente: almacenaje por pallet, recepciones, despachos, maquila, etc.',
      'El sistema registra eventos de almacenaje automáticamente según los movimientos de stock.',
      'Genera el cierre de período: calcula el total facturado por cada tipo de servicio.',
      'Exporta el informe para enviarlo al cliente o cargarlo en el sistema de facturación.',
    ],
    tip: 'Activa el "Modo 3PL" en la configuración del sistema para habilitar este módulo.',
  },
  'lpn-history': {
    icon: '🔍', color: 'indigo',
    title: 'Historial LPN',
    desc: 'Trazabilidad completa de la vida útil de un LPN específico.',
    steps: [
      'Ingresa el ID del LPN en el buscador (ej: LPN-12345-678).',
      'El sistema muestra el estado actual: SKU, cantidad, ubicación y estado físico.',
      'La línea de tiempo lista todos los eventos del LPN en orden cronológico.',
      'Si el LPN fue consumido (qty=0), igual se muestra su historial completo.',
    ],
    tip: 'Usa este módulo cuando necesites responder preguntas como "¿dónde está este pallet?".',
  },
  relocate: {
    icon: '🔄', color: 'purple',
    title: 'Reubicación de Stock',
    desc: 'Mueve LPNs de una ubicación física a otra dentro del almacén.',
    steps: [
      'Busca el LPN a reubicar por su ID o filtra por ubicación de origen.',
      'Selecciona la ubicación destino disponible en el mapa de bodega.',
      'Opcionalmente ingresa el motivo de la reubicación para el log de auditoría.',
      'El movimiento queda registrado como evento RELOC en el historial.',
    ],
    tip: 'Las reubicaciones también pueden solicitarse desde el inventario usando el botón de flecha.',
  },
  'purchase-orders': {
    icon: '🛒', color: 'indigo',
    title: 'Órdenes de Compra',
    desc: 'Gestiona las OC enviadas a proveedores y controla la recepción contra lo esperado.',
    steps: [
      'Crea una OC indicando el proveedor, cliente, fecha esperada y los SKUs con sus cantidades.',
      'Cuando llega la mercadería, recíbela desde el módulo de Recepción vinculando la OC.',
      'El sistema calcula automáticamente la diferencia entre lo pedido y lo recibido.',
      'Una OC pasa a "Cerrada" cuando todos los ítems han sido recibidos.',
    ],
    tip: 'Vincula una OC al recibir para trazabilidad completa entre proveedor y stock en almacén.',
  },
  'doc-history': {
    icon: '🗂️', color: 'slate',
    title: 'Historial de Documentos',
    desc: 'Registro de todos los documentos procesados: recepciones, despachos y ajustes.',
    steps: [
      'Busca por número de documento, tipo o fecha para encontrar cualquier operación pasada.',
      'Cada fila muestra el documento, el módulo, el usuario que lo procesó y la cantidad total.',
      'Despliega un documento para ver el detalle de todos los ítems incluidos.',
      'Usa los filtros de fecha para generar reportes de actividad mensual o diaria.',
    ],
    tip: 'Este historial complementa al Audit Log — aquí ves documentos completos, allá eventos individuales.',
  },
  'cycle-count': {
    icon: '🔢', color: 'cyan',
    title: 'Conteos Cíclicos',
    desc: 'Planifica y ejecuta inventarios físicos por zona sin detener la operación.',
    steps: [
      'Crea un conteo seleccionando la zona a contar (ej: Rack A, Bodega Fría).',
      'El sistema genera las líneas del conteo con el stock esperado por ubicación.',
      'Los operadores ingresan las cantidades contadas físicamente.',
      'Al cerrar el conteo, el sistema muestra las diferencias y permite ajustar automáticamente.',
    ],
    tip: 'Los conteos cíclicos son más eficientes que el inventario general anual — se hacen por secciones.',
  },
  'change-status': {
    icon: '🏷️', color: 'pink',
    title: 'Cambiar Estado LPN',
    desc: 'Cambia el estado físico de un LPN (Disponible, Bloqueado, Cuarentena, etc.).',
    steps: [
      'Busca el LPN por su ID o usa los filtros para encontrarlo en la lista.',
      'Selecciona el nuevo estado desde el menú desplegable de la fila.',
      'Los estados que bloquean despacho impedirán que ese LPN salga hasta ser liberado.',
      'El cambio queda registrado en el historial de auditoría con usuario y timestamp.',
    ],
    tip: 'Usa Cuarentena para aislar lotes con problemas de calidad sin eliminar el stock.',
  },
  'dispatch-schedule': {
    icon: '📅', color: 'teal',
    title: 'Agenda de Despachos',
    desc: 'Programa y visualiza los despachos planificados por cliente y transportista.',
    steps: [
      'Crea una cita de despacho indicando el cliente, transportista, fecha y ventana horaria.',
      'El calendario muestra todos los despachos del día o semana de un vistazo.',
      'Avanza el estado: Pendiente → Confirmado → En preparación → Listo para retirar.',
      'Vincula la cita con el documento de despacho cuando se procese la salida real.',
    ],
    tip: 'La agenda ayuda a coordinar con transportistas y evitar colisiones en los muelles de carga.',
  },
  'picking-monitor': {
    icon: '🎯', color: 'violet',
    title: 'Monitor de Picking',
    desc: 'Crea y supervisa las tareas de picking asignadas a los operadores.',
    steps: [
      'Crea una tarea de picking desde un despacho pendiente: el sistema genera las líneas por SKU/LPN.',
      'Asigna prioridad a cada tarea (1=urgente, 10=normal) para ordenar la cola de los pickers.',
      'El monitor muestra en tiempo real qué líneas están pendientes, en curso y completadas.',
      'Una vez pickeadas todas las líneas, el supervisor confirma el despacho.',
    ],
    tip: 'El picking por líneas permite que varios operadores trabajen en paralelo en el mismo pedido.',
  },
  'picker-queue': {
    icon: '📱', color: 'violet',
    title: 'Cola de Picking',
    desc: 'Vista del operador picker — muestra las tareas asignadas para ejecutar en almacén.',
    steps: [
      'El picker ve solo las líneas asignadas a él, ordenadas por prioridad.',
      'Inicia una línea para reservarla — evita que otro picker trabaje sobre el mismo LPN.',
      'Confirma la línea indicando el lote o número de serie físico encontrado.',
      'Si no puede completar una línea (LPN vacío, no encontrado), usa "Saltar" con motivo.',
    ],
    tip: 'Esta pantalla está optimizada para uso en celular o tablet en el piso de bodega.',
  },
  superadmin: {
    icon: '⚙️', color: 'red',
    title: 'Panel SUPERADMIN',
    desc: 'Configuración avanzada del sistema — acceso exclusivo para el administrador principal.',
    steps: [
      'Configura el Modo 3PL para habilitar cobros y portales de clientes.',
      'Ajusta parámetros globales: nombre del almacén, logo, zona horaria.',
      'Administra las API Keys para integración con sistemas ERP externos.',
      'Revisa el historial de accesos y auditoría de seguridad del sistema.',
    ],
    tip: 'Este panel solo es visible para el usuario con rol SUPERADMIN.',
  },
};
