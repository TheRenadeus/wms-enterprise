import React, { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import {
  LayoutDashboard, Package, Box, Map as MapIcon, ArrowDownRight,
  ArrowUpRight, Search, CheckCircle2, X, FileText,
  Calendar, Tag, Sliders, MessageSquare, ArrowRightLeft, History, ClipboardCheck,
  Trash2, Plus, ListPlus, MinusCircle, FolderOpen, ArrowLeft, Pause, PlaySquare, Database, Warehouse, ShieldCheck, Truck, Loader2, Users, Building2, Pencil, Activity, RefreshCcw, ShieldAlert, FileType, UserCog, ArrowDownUp, LogOut, Eye, EyeOff, Settings2, Globe, Combine, Split, Edit, Layers, Scan, XCircle, PieChart, ChevronRight, BarChart3, Printer, Download, Upload, Menu, Bell, Key, Info, Lightbulb, ChevronDown, ChevronUp, Play,
  ClipboardList, UserCheck, AlertTriangle, SkipForward, CheckCheck, ListTodo, CalendarClock, Clock, Send,
  HardHat, Wrench, Timer, Moon, Sun, BookOpen
} from 'lucide-react';
import { useAutoSaveState, apiFetch, setDemoMode, timeAgo, exportToExcel } from './utils';
import { useConfirm } from './useConfirm';
import {
  initialSkuForm, MODULES_3PL_ONLY, APP_MODULES, colorMap, statusLabel,
  IMPORT_CONFIG, DEMO_GLOSA_OPTIONS, DEMO_HINTS, SANDBOX_SCENARIOS, SANDBOX_ROLES
} from './constants';
import {
  GlobalStyles, SimpleDonut, DocTrayView, LocPicker,
  DigitalTwinView, BulkImportModal, ConfirmModal, DemoHint,
  SandboxWelcome, SandboxLauncher, SandboxSwitcher
} from './components';
import VirtualizedScrollList from './VirtualizedScrollList';
import GuidedTour from './tutorial/GuidedTour';
import { useTutorial } from './tutorial/tutorialState';

// P15: tabs piloto cargadas lazy. Cada una es un chunk separado en el bundle.
// El JSX inline de estas tabs en App.js fue reemplazado por <LazyXTab {...props}/>.
const OccupationTab = lazy(() => import('./tabs/OccupationTab'));
const LpnHistoryTab = lazy(() => import('./tabs/LpnHistoryTab'));
const ChangeStatusTab = lazy(() => import('./tabs/ChangeStatusTab'));
const DigitalTwinTab = lazy(() => import('./tabs/DigitalTwinTab'));
const SkuMovementTab = lazy(() => import('./tabs/SkuMovementTab'));
const KardexTab      = lazy(() => import('./tabs/KardexTab'));

// Fallback compartido mientras carga el chunk. Mantiene el layout calmo (sin saltos).
const TabLoader = () => (
  <div className="flex items-center justify-center py-16">
    <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-200 border-t-indigo-600"></div>
  </div>
);

export default function App() {
  // P12: hook imperativo que reemplaza window.confirm/window.prompt.
  const { confirm, prompt } = useConfirm();
  const [currentUser, setCurrentUser] = useAutoSaveState('wms_current_user', null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  // Estado de mantenimiento detectado antes del login (banner en la pantalla de login).
  const [preLoginMaintenance, setPreLoginMaintenance] = useState({ active: false, message: '' });
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const [customHost, setCustomHost] = useAutoSaveState('wms_custom_host', '');
  const [showNetworkSettings, setShowNetworkSettings] = useState(false);

  // Auto-limpiar customHost si apunta a localhost pero se accede desde otra IP
  useEffect(() => {
    if (!customHost) return;
    try {
      const u = new URL(customHost);
      const isLocal = ['localhost', '127.0.0.1'].includes(u.hostname);
      const accessingFromLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
      if (isLocal && !accessingFromLocal) setCustomHost('');
    } catch { setCustomHost(''); }
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useAutoSaveState('wms_dark_mode', false);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);
  // Notificaciones
  const [notifications, setNotifications] = useState([]);
  const [notifCount, setNotifCount] = useState(0);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  // Transporte
  const [carriers, setCarriers] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [carrierForm, setCarrierForm] = useState({ id:'', name:'', rut:'', contact:'', phone:'', email:'' });
  const [shipmentForm, setShipmentForm] = useState({ carrier_id:'', doc_num:'', client_id:'', destination:'', notes:'' });
  const [transportTab, setTransportTab] = useState('carriers');
  // API Keys
  const [apiKeys, setApiKeys] = useState([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyClient, setNewKeyClient] = useState('');
  const [newKeyPerms, setNewKeyPerms] = useState('read');
  const [generatedKey, setGeneratedKey] = useState(null);
  const [loginHistory, setLoginHistory] = useState([]);
  const [showLoginHistory, setShowLoginHistory] = useState(false);
  // Kit orders y build
  const [kitOrders, setKitOrders] = useState([]);
  const [kitBuildForm, setKitBuildForm] = useState({ kit_sku:'', client_id:'', qty:1, location:'PISO-RECEPCION' });
  const [kitAvailability, setKitAvailability] = useState(null);
  const [kitDispatchForm, setKitDispatchForm] = useState({ kit_sku:'', client_id:'', qty:1, doc_num:'', glosa:'' });
  const [kitDispatchAvail, setKitDispatchAvail] = useState(null);
  const [kittingTab, setKittingTab] = useState('definitions');
  // Portal de clientes
  const [portalUser, setPortalUser] = useState(() => { try { return JSON.parse(localStorage.getItem('wms_portal_user')||'null'); } catch{return null;} });
  const [portalToken] = useState(() => localStorage.getItem('wms_portal_token')||'');
  const [portalInv, setPortalInv] = useState([]);
  const [portalStats, setPortalStats] = useState(null);
  const [portalMovements, setPortalMovements] = useState([]);
  const [portalReports, setPortalReports] = useState(null);
  const [portalTab, setPortalTab] = useState('inventory');
  const [portalSkuFilter, setPortalSkuFilter] = useState('');
  const [portalLoginForm, setPortalLoginForm] = useState({ client_id: (()=>{try{return new URLSearchParams(window.location.search).get('portal')||'';}catch{return '';}})(), password:'' });
  const [portalLoginError, setPortalLoginError] = useState('');
  const [isPortalMode] = useState(() => { try { return window.location.hash === '#portal' || !!new URLSearchParams(window.location.search).get('portal'); } catch { return false; } });
  // Config portal por cliente
  const [portalConfigClient, setPortalConfigClient] = useState(null);
  const [portalConfigForm, setPortalConfigForm] = useState({ portal_enabled: false, portal_password:'', portal_email:'' });
  // Dispatch KPIs
  const [dispatchKpis, setDispatchKpis] = useState(null);
  const [weeklyDispatch, setWeeklyDispatch] = useState([]);
  // Sistema de Pickeadores
  const [pickTasks, setPickTasks] = useState([]);
  const [pickQueue, setPickQueue] = useState([]);
  const [pickStats, setPickStats] = useState(null);
  const [pickMonitorTab, setPickMonitorTab] = useState('board');
  const [pickBoardModuleFilter, setPickBoardModuleFilter] = useState('');
  const [pickBoardStatusFilter, setPickBoardStatusFilter] = useState('');
  const [pickCreateForm, setPickCreateForm] = useState({ doc_num:'', doc_type:'GUIA_DESPACHO', module:'dispatch', client_id:'', notes:'', lines:[] });
  const [pickLineForm, setPickLineForm] = useState({ sku:'', sku_desc:'', lpn_id:'', location_from:'', location_to:'', qty_requested:'', assigned_to:'', priority:5 });
  const [activePickLine, setActivePickLine] = useState(null);
  const [pickerConfirmForm, setPickerConfirmForm] = useState({ qty_confirmed:'', batch_confirmed:'', serial_confirmed:'', diff_reason:'' });
  const [pickerView, setPickerView] = useState('queue'); // 'queue' | 'confirm'
  // Solicitudes de ajuste de stock
  const [adjustRequests, setAdjustRequests] = useState([]);
  // Solicitudes de reubicación
  const [relocRequests, setRelocRequests] = useState([]);
  const [rejectReason, setRejectReason] = useState('');
  // Picking integrado con despacho
  const [docPickLines, setDocPickLines] = useState([]); // líneas de picking del doc activo
  const [usePickConf, setUsePickConf] = useState(false); // usar cantidades confirmadas por picker
  // Programación de Salidas
  const [dispatchSchedules, setDispatchSchedules] = useState([]);
  const [dsForm, setDsForm] = useState({ doc_num: '', client_id: '', doc_type: '', glosa: '', scheduled_date: '', scheduled_time: '', carrier: '', destination: '', notes: '' });
  const [dsEditId, setDsEditId] = useState(null);
  const [dsStatusFilter, setDsStatusFilter] = useState('');
  const [dsDateFilter, setDsDateFilter] = useState('');
  // Paginación inventario (UX-07)
  const [invPage, setInvPage] = useState(0);
  const INV_PAGE_SIZE = 100;
  // Paginación auditoría, SKUs y ubicaciones
  const [auditPage, setAuditPage] = useState(0);
  const [skuPage, setSkuPage] = useState(0);
  const [locPage, setLocPage] = useState(0);
  const PAGE_SIZE = 100;
  // ── Proveedores & ASN ─────────────────────────────────────────────
  const [suppliers, setSuppliers] = useState([]);
  const [supplierForm, setSupplierForm] = useState({ name: '', rut: '', contact: '', email: '', phone: '', country: 'CL', notes: '' });
  const [supplierEditId, setSupplierEditId] = useState(null);
  const [asns, setAsns] = useState([]);
  const [asnForm, setAsnForm] = useState({ supplier_id: '', expected_date: '', reference: '', notes: '', lines: [] });
  const [asnLineForm, setAsnLineForm] = useState({ sku: '', qty_expected: '' });
  const [asnView, setAsnView] = useState('list'); // 'list' | 'new' | 'receive'
  const [activeAsn, setActiveAsn] = useState(null);
  const [asnReceiveQtys, setAsnReceiveQtys] = useState({});
  // ── Olas de Picking ───────────────────────────────────────────────
  const [waves, setWaves] = useState([]);
  const [waveAvailLines, setWaveAvailLines] = useState([]);
  const [waveForm, setWaveForm] = useState({ name: '', strategy: 'FIFO', notes: '', line_ids: [] });
  const [waveView, setWaveView] = useState('list'); // 'list' | 'new'
  const [waveLineSelection, setWaveLineSelection] = useState(new Set());
  // ── Empaque ───────────────────────────────────────────────────────
  const [packingOrders, setPackingOrders] = useState([]);
  const [activePackingOrder, setActivePackingOrder] = useState(null);
  const [packingLineQtys, setPackingLineQtys] = useState({});
  const [packingCartons, setPackingCartons] = useState({});
  // ── Devoluciones ──────────────────────────────────────────────────
  const [returns, setReturns] = useState([]);
  const [returnInspectId, setReturnInspectId] = useState(null);
  const [returnInspectForm, setReturnInspectForm] = useState({ disposition: 'RESTOCK', condition_notes: '', qty_accepted: '', location_to: '' });
  // ── Muelles / Dock ────────────────────────────────────────────────
  const [docks, setDocks] = useState([]);
  const [dockForm, setDockForm] = useState({ dock_code: '', name: '', dock_type: 'INBOUND', capacity: 1, notes: '' });
  const [dockEditId, setDockEditId] = useState(null);
  const [dockAppointments, setDockAppointments] = useState([]);
  const [apptForm, setApptForm] = useState({ dock_id: '', carrier: '', doc_reference: '', appt_date: '', appt_time: '', direction: 'INBOUND', notes: '' });
  const [apptEditId, setApptEditId] = useState(null);
  const [dockView, setDockView] = useState('appointments'); // 'appointments' | 'docks'
  // ── Facturación 3PL ───────────────────────────────────────────────
  const [invoices, setInvoices] = useState([]);
  const [invoiceGenForm, setInvoiceGenForm] = useState({ client_id: '', period_start: '', period_end: '' });
  const [invoiceView, setInvoiceView] = useState('list'); // 'list' | 'new'
  // ── Reportería Avanzada ───────────────────────────────────────────
  const [advReport, setAdvReport] = useState(null); // { type, data }
  const [advReportLoading, setAdvReportLoading] = useState(false);
  const [advReportType, setAdvReportType] = useState('inventory-aging');

  const [activeTab, setActiveTab] = useState('dashboard');
  const [data, setData] = useState([]);
  const [skus, setSkus] = useState([]);
  const [locations, setLocations] = useState([]);
  const [clients, setClients] = useState([]);
  // Módulo de fabricantes
  const [manufacturers, setManufacturers] = useState([]);
  const [manufacturerForm, setManufacturerForm] = useState({ code:'', name:'', country:'', contact:'', email:'', phone:'', website:'', notes:'' });
  const [editingMfrId, setEditingMfrId] = useState(null);
  const [mfrSearchTerm, setMfrSearchTerm] = useState('');
  const [showMfrQuickForm, setShowMfrQuickForm] = useState(false);
  const [skuMfrFilter, setSkuMfrFilter] = useState('');
  const [mfrDetail, setMfrDetail] = useState(null);
  // Versionado de SKUs
  const [skuVersionsModal, setSkuVersionsModal] = useState(null); // { sku, versions: [] }
  const [editingSkuOriginal, setEditingSkuOriginal] = useState(null); // snapshot al abrir el form
  // Sustitutos: modal cuando el dispatch responde 422
  const [substituteModal, setSubstituteModal] = useState(null); // { items_con_deficit, doc, substitutesBySku, loading, selection }
  // Tab "Sustitutos" del panel de detalle de SKU
  const [skuSubstTab, setSkuSubstTab] = useState(null); // { sku, manuals, autoSuggestions }
  // Auditoría de sincronización 3D
  const [locAudit, setLocAudit] = useState(null);
  const [locAuditModalOpen, setLocAuditModalOpen] = useState(false);
  // Form individual de ubicación con campos 3D
  const [singleLocForm, setSingleLocForm] = useState({
    location_id: '', zone_code: '', loc_type: 'RACK', max_kg: '', max_pallets: '',
    enable_3d: false, aisle: '', row_num: '', level: '',
    x: '', y: '', z: '', width: '1.2', depth: '0.8', height: '2.0', color_hex: '',
    coordsMode: 'auto', // 'auto' (calc desde aisle/row/level) | 'manual' (x/y/z directo)
  });
  const [statuses, setStatuses] = useState([]);
  const [documentTypes, setDocumentTypes] = useState([]);
  const [users, setUsers] = useState([]);
  const [kits, setKits] = useState([]);
  
  const [stats, setStats] = useState({ lpns: 0, units: 0, skus: 0 });
  const [auditLogs, setAuditLogs] = useState([]);
  const [msg, setMsg] = useState('');
  const [apiStatus, setApiStatus] = useState('conectando');
  const [isFetchingData,    setIsFetchingData]    = useState(false);
  const [refreshingStatic, setRefreshingStatic] = useState(false);
  const [printLabelData, setPrintLabelData] = useState(null);
  
  const [isValidating, setIsValidating] = useState(false);
  const [disabledModules, setDisabledModules] = useState([]);
  const [licenseModules, setLicenseModules] = useState([]);

  const host = customHost || '';

  // Datos que cambian frecuentemente — se refresca cada 30 s
  const fetchCore = useCallback(async () => {
    if (!currentUser) return;
    setIsFetchingData(true);
    try {
      const logFetchErr = (name) => (e) => { console.error(`[fetchCore] ${name}:`, e?.message || e); return null; };
      const [resInv, resStats, resAudit] = await Promise.all([
        apiFetch(`${host}/api/inventory`).catch(logFetchErr('inventory')),
        apiFetch(`${host}/api/stats`).catch(logFetchErr('stats')),
        apiFetch(`${host}/api/audit`).catch(logFetchErr('audit')),
      ]);
      if (resInv && resStats) { setApiStatus('online'); } else { setApiStatus('offline'); }
      if (resInv?.ok) setData(await resInv.json());
      if (resStats?.ok) setStats(await resStats.json());
      if (resAudit?.ok) setAuditLogs(await resAudit.json());
      try { const resAlerts = await apiFetch(`${host}/api/alerts/stock`).catch(()=>null); if (resAlerts?.ok) setStockAlerts(await resAlerts.json()); } catch(e) {}
      try {
        const [rN, rKpi, rWd] = await Promise.all([
          apiFetch(`${host}/api/notifications`).catch(()=>null),
          apiFetch(`${host}/api/stats/dispatch-kpis`).catch(()=>null),
          apiFetch(`${host}/api/stats/weekly-dispatch`).catch(()=>null),
        ]);
        if (rN?.ok) { const n = await rN.json(); if (Array.isArray(n)) { setNotifications(n); setNotifCount(n.filter(x=>!x.read).length); } }
        if (rKpi?.ok) setDispatchKpis(await rKpi.json());
        if (rWd?.ok) { const wd = await rWd.json(); if (Array.isArray(wd)) setWeeklyDispatch(wd); }
      } catch(e) {}
      try {
        const rRR = await apiFetch(`${host}/api/relocate-requests`).catch(()=>null);
        if (rRR?.ok) setRelocRequests(await rRR.json());
      } catch(e) {}
      // Picking (role-based — sin cambios)
      try {
        const isPicker = currentUser?.role === 'PICKER';
        const isSup = ['JEFE_BODEGA','ADMIN','SUPERADMIN'].includes(currentUser?.role);
        const [rPT, rPQ, rPS] = await Promise.all([
          isSup ? apiFetch(`${host}/api/pick-tasks`).catch(()=>null) : Promise.resolve(null),
          (isPicker || isSup) ? apiFetch(`${host}/api/picker/queue`).catch(()=>null) : Promise.resolve(null),
          isSup ? apiFetch(`${host}/api/pick-tasks/stats`).catch(()=>null) : Promise.resolve(null),
        ]);
        if (rPT?.ok) setPickTasks(await rPT.json());
        if (rPQ?.ok) setPickQueue(await rPQ.json());
        if (rPS?.ok) setPickStats(await rPS.json());
      } catch(e) {}
      try {
        const isSup = ['JEFE_BODEGA','ADMIN','SUPERADMIN'].includes(currentUser?.role);
        if (isSup) {
          const rDS = await apiFetch(`${host}/api/dispatch-schedules`).catch(()=>null);
          if (rDS?.ok) setDispatchSchedules(await rDS.json());
        }
      } catch(e) {}
      try {
        const isAdmin = ['ADMIN','SUPERADMIN'].includes(currentUser?.role);
        const isEjec = currentUser?.role === 'EJECUTIVO_CUENTA';
        if (isAdmin || isEjec) {
          const rAR = await apiFetch(`${host}/api/adjust-requests${isAdmin ? '?status=PENDIENTE' : ''}`).catch(()=>null);
          if (rAR?.ok) setAdjustRequests(await rAR.json());
        }
      } catch(e) {}
    } catch (e) { setApiStatus('offline'); }
    finally { setIsFetchingData(false); }
  }, [host, currentUser?.username]);

  // Datos estáticos/pesados — se carga una vez al login y bajo demanda
  const fetchStatic = useCallback(async () => {
    if (!currentUser) return;
    try {
      const logFetchErr = (name) => (e) => { console.error(`[fetchStatic] ${name}:`, e?.message || e); return null; };
      const [resSku, resLoc, resClients, resStatuses, resDocTypes, resUsers, resKits] = await Promise.all([
        apiFetch(`${host}/api/skus?limit=10000`).catch(logFetchErr('skus')),
        apiFetch(`${host}/api/locations`).catch(logFetchErr('locations')),
        apiFetch(`${host}/api/clients?limit=5000`).catch(logFetchErr('clients')),
        apiFetch(`${host}/api/statuses`).catch(logFetchErr('statuses')),
        apiFetch(`${host}/api/document_types`).catch(logFetchErr('document_types')),
        apiFetch(`${host}/api/users`).catch(logFetchErr('users')),
        apiFetch(`${host}/api/kits`).catch(logFetchErr('kits')),
      ]);
      if (resSku?.ok) {
        const arr = await resSku.json();
        setSkus(arr);
        if (arr.length >= 10000) console.warn('[skus] limit alcanzado (10000). Catálogo posiblemente truncado.');
      }
      if (resLoc?.ok) setLocations(await resLoc.json());
      if (resClients?.ok) {
        const arr = await resClients.json();
        setClients(arr);
        if (arr.length >= 5000) console.warn('[clients] limit alcanzado (5000). Lista posiblemente truncada.');
      }
      if (resStatuses?.ok) setStatuses(await resStatuses.json());
      if (resDocTypes?.ok) setDocumentTypes(await resDocTypes.json());
      if (resUsers?.ok) setUsers(await resUsers.json());
      if (resKits?.ok) setKits(await resKits.json());
      // Cargar config global
      try {
        const resCfg = await apiFetch(`${host}/api/system/config`).catch(()=>null);
        if (resCfg?.ok) {
          const cfg = await resCfg.json();
          setSystemConfig(cfg);
          setMaintenanceMode(cfg.maintenance_mode === 'true');
          setOperationMode(cfg.operation_mode || 'HYBRID');
          setMaintenanceMessage(cfg.maintenance_message || '');
          try { setDisabledModules(JSON.parse(cfg.disabled_modules || '[]')); } catch(e) { setDisabledModules([]); }
          try { setLicenseModules(JSON.parse(cfg.license_modules || '[]')); } catch(e) { setLicenseModules([]); }
        }
      } catch(e) {}
      try { const resMfr = await apiFetch(`${host}/api/manufacturers`).catch(()=>null); if (resMfr?.ok) setManufacturers(await resMfr.json()); } catch(e) {}
      try {
        const [rC, rS, rK, rKO] = await Promise.all([
          apiFetch(`${host}/api/carriers`).catch(()=>null),
          apiFetch(`${host}/api/shipments`).catch(()=>null),
          apiFetch(`${host}/api/keys`).catch(()=>null),
          apiFetch(`${host}/api/kit-orders`).catch(()=>null),
        ]);
        if (rC?.ok) setCarriers(await rC.json());
        if (rS?.ok) setShipments(await rS.json());
        if (rK?.ok) setApiKeys(await rK.json());
        if (rKO?.ok) setKitOrders(await rKO.json());
      } catch(e) {}
      // Sistemas avanzados (solo supervisores+)
      try {
        const isSup = ['JEFE_BODEGA','ADMIN','SUPERADMIN'].includes(currentUser?.role);
        if (isSup) {
          const [rSup, rAsn, rWave, rPack, rRet, rDocks, rAppts, rInv2] = await Promise.all([
            apiFetch(`${host}/api/suppliers`).catch(()=>null),
            apiFetch(`${host}/api/asns`).catch(()=>null),
            apiFetch(`${host}/api/pick-waves`).catch(()=>null),
            apiFetch(`${host}/api/packing-orders`).catch(()=>null),
            apiFetch(`${host}/api/returns`).catch(()=>null),
            apiFetch(`${host}/api/docks`).catch(()=>null),
            apiFetch(`${host}/api/dock-appointments`).catch(()=>null),
            apiFetch(`${host}/api/invoices`).catch(()=>null),
          ]);
          if (rSup?.ok) setSuppliers(await rSup.json());
          if (rAsn?.ok) setAsns(await rAsn.json());
          if (rWave?.ok) setWaves(await rWave.json());
          if (rPack?.ok) setPackingOrders(await rPack.json());
          if (rRet?.ok) setReturns(await rRet.json());
          if (rDocks?.ok) setDocks(await rDocks.json());
          if (rAppts?.ok) setDockAppointments(await rAppts.json());
          if (rInv2?.ok) setInvoices(await rInv2.json());
        }
      } catch(e) {}
    } catch (e) { /* errores individuales ya capturados en cada bloque */ }
  }, [host, currentUser?.username]);

  // REN-08: wrapper fino — los ~25 handlers que llaman fetchData() siguen funcionando sin cambios.
  const fetchData = useCallback(() => Promise.all([fetchCore(), fetchStatic()]), [fetchCore, fetchStatic]);

  useEffect(() => {
    fetchData(); const interval = setInterval(fetchCore, 30000); return () => clearInterval(interval);
  }, [fetchData, fetchCore]);

  // Pre-login: chequear si el sistema está en modo mantenimiento y mostrar banner
  // en la pantalla de login. Solo corre cuando no hay sesión.
  useEffect(() => {
    if (currentUser) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${host}/api/system/maintenance/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        });
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setPreLoginMaintenance({ active: !!d.maintenance, message: d.message || 'Sistema en mantenimiento.' });
      } catch (e) { /* sin red — el login mostrará su propio error */ }
    })();
    return () => { cancelled = true; };
  }, [host, currentUser]);

  // Sincronizar flag de demo mode con el módulo apiFetch
  useEffect(() => { setDemoMode(currentUser?.role === 'DEMO' || currentUser?.is_demo === true); }, [currentUser]);

  // En sandbox, forzar el operationMode según el escenario elegido
  useEffect(() => {
    if (currentUser?.is_demo && currentUser?.sandbox_mode) {
      setOperationMode(currentUser.sandbox_mode);
    }
  }, [currentUser?.sandbox_mode]);

  const [operationMode, setOperationMode] = useState('HYBRID');

  const canView = useCallback((tabId) => {
    if (!currentUser) return false;
    // SUPERADMIN siempre puede ver todo
    if (currentUser.role === 'SUPERADMIN') return true;
    // El tab superadmin es exclusivo de SUPERADMIN — invisible para todos los demás
    if (tabId === 'superadmin') return false;
    // Módulos 3PL — bloqueados automáticamente en modo PROPIO
    if (MODULES_3PL_ONLY.includes(tabId) && operationMode !== '3PL' && operationMode !== 'HYBRID') return false;
    // PICKER: su cola, el mapa 3D y el módulo de reubicación
    if (currentUser.role === 'PICKER') return ['picker-queue','digital-twin','relocate','inventory'].includes(tabId);
    // CLIENTE: portal de solo lectura — ve su inventario, documentos y facturación
    if (currentUser.role === 'CLIENTE') return ['dashboard','inventory','doc-history','returns','shipments','purchase-orders','master-skus'].includes(tabId);
    // JEFE_BODEGA: operaciones + supervisión completa de bodega (sin users/superadmin/audit).
    if (currentUser.role === 'JEFE_BODEGA') {
      if (disabledModules.includes(tabId)) return false;
      if (licenseModules.length > 0 && !licenseModules.includes(tabId) && tabId !== 'dashboard') return false;
      return ['dashboard','inventory','master-skus','receive','dispatch','picking-monitor','picker-queue','relocate','change-status','adjust','doc-history','transport','dispatch-schedule','purchase-orders','cycle-count','suppliers','waves','packing','returns','docks','billing','3pl-billing','advanced-reports','occupation','rep-report','lpn-history','clients','statuses','doc-types','manufacturers'].includes(tabId);
    }
    // EJECUTIVO_CUENTA (operario de piso): operaciones de stock y SKUs; sin gestión 3PL
    // (clientes, facturación, proveedores, docks) ni supervisión avanzada.
    if (currentUser.role === 'EJECUTIVO_CUENTA') {
      if (disabledModules.includes(tabId)) return false;
      if (licenseModules.length > 0 && !licenseModules.includes(tabId) && tabId !== 'dashboard') return false;
      return ['dashboard','inventory','master-skus','receive','dispatch','picking-monitor','picker-queue','relocate','change-status','adjust','doc-history','cycle-count','waves','packing','returns','occupation','lpn-history'].includes(tabId);
    }
    // DEMO role legado ve todo excepto superadmin y users
    if (currentUser.role === 'DEMO') return tabId !== 'users' && tabId !== 'superadmin';
    // Persona demo (is_demo=true): respeta sus módulos configurados
    if (currentUser.is_demo) {
      if (tabId === 'superadmin' || tabId === 'users') return false;
      if (currentUser.allowed_modules === 'ALL') return true;
      try { const mods = JSON.parse(currentUser.allowed_modules); return mods.includes(tabId); } catch { return false; }
    }
    // Verificar módulos deshabilitados globalmente
    if (disabledModules.includes(tabId)) return false;
    // Verificar licencia de módulos
    if (licenseModules.length > 0 && !licenseModules.includes(tabId) && tabId !== 'dashboard') return false;
    if (currentUser.role === 'ADMIN') return true;
    if (currentUser.allowed_modules === 'ALL' || !currentUser.allowed_modules) {
       if (tabId === 'users') return false;
       if (tabId === 'picking-monitor') return ['JEFE_BODEGA','ADMIN','SUPERADMIN'].includes(currentUser.role);
       if (tabId === 'audit') return ['AUDITOR','ADMIN','SUPERADMIN'].includes(currentUser.role);
       if (['clients', 'master-skus', 'conversions', 'warehouse', 'digital-twin', 'statuses', 'doc-types', 'occupation', 'rep-report', 'lpn-history', '3pl-billing'].includes(tabId)) {
          return ['JEFE_BODEGA','ADMIN','SUPERADMIN'].includes(currentUser.role);
       }
       return true;
    }
    try {
      const mods = JSON.parse(currentUser.allowed_modules);
      return mods.includes(tabId);
    } catch(e) { return false; }
  }, [currentUser, disabledModules, licenseModules, operationMode]);

  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.role === 'PICKER' && !canView(activeTab)) {
      setActiveTab('picker-queue');
      return;
    }
    if (currentUser.role === 'CLIENTE' && !canView(activeTab)) {
      setActiveTab('inventory');
      return;
    }
    if (!canView(activeTab) && activeTab !== 'dashboard') {
      setActiveTab(canView('dashboard') ? 'dashboard' : 'inventory');
    }
  }, [activeTab, currentUser, canView]);

  // COD-09: useCallback para evitar re-renders en hijos que reciben showMsg como prop
  const showMsg = useCallback((text, isError = false) => { setMsg({ text, isError }); setTimeout(() => setMsg(''), 5000); }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('wms_token');
    setCurrentUser(null);
    setActiveTab('dashboard');
  }, [setCurrentUser]);

  useEffect(() => {
    if (!currentUser) return;
    let timeoutId;
    const INACTIVITY_TIME = 15 * 60 * 1000; 

    const resetTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        handleLogout();
        showMsg('⏳ Sesión cerrada automáticamente por inactividad de 15 minutos.', true);
      }, INACTIVITY_TIME);
    };

    resetTimer();
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(event => window.addEventListener(event, resetTimer));

    return () => {
      clearTimeout(timeoutId);
      events.forEach(event => window.removeEventListener(event, resetTimer));
    };
  }, [currentUser, handleLogout]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      const res = await apiFetch(`${host}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loginForm) });
      if (res.ok) {
        const d = await res.json();
        if (d.token) localStorage.setItem('wms_token', d.token);
        setCurrentUser(d.user);
        setLoginForm({ username: '', password: '' });
        setShowPassword(false);
      } else {
        const err = await res.json();
        showMsg(`⛔ ${err.error}`, true);
      }
    } catch (err) {
      showMsg('⛔ Error de conexión al servidor.', true);
    } finally { setIsLoggingIn(false); }
  };

  // Sandbox demo — se muestra como pantalla completa
  const [showSandbox, setShowSandbox] = useState(false);
  const [showSandboxWelcome, setShowSandboxWelcome] = useState(false);
  const tutorial = useTutorial({ apiFetch, host, isDemo: currentUser?.is_demo === true });
  // Feedback / sugerencias del staff
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState({ category: 'MEJORA', message: '' });
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackList, setFeedbackList] = useState([]);
  const [feedbackFilter, setFeedbackFilter] = useState({ status: '', category: '' });

  const [workspaces, setWorkspaces] = useAutoSaveState('wms_workspaces_v8', { receive: [], dispatch: [], adjust: [] });
  const [activeDocId, setActiveDocId] = useState(null);
  // UX-05: estados de carga para formularios CRUD
  const [isSavingSku, setIsSavingSku] = useState(false);
  const [isSavingClient, setIsSavingClient] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  // PASO 4 — re-autenticación (step-up): antes de confirmar recepción/despacho se pide
  // la contraseña del usuario. promptReauth abre el modal y resuelve con la clave (o null).
  const [reauthPrompt, setReauthPrompt] = useState(null); // { resolve, label } | null
  const promptReauth = (label) => new Promise((resolve) => setReauthPrompt({ resolve, label }));

  const [newDocNum, setNewDocNum] = useState('');
  const [newDocGlosa, setNewDocGlosa] = useState('');
  const [newDocType, setNewDocType] = useState('');
  // Cliente del movimiento: se elige al CREAR el documento (recepción/despacho/ajuste).
  const [newDocClient, setNewDocClient] = useState('');
  const [newDocDate, setNewDocDate] = useState('');
  const [newDocRef, setNewDocRef] = useState('');
  const [newDocEnteredAt, setNewDocEnteredAt] = useState(() => new Date().toISOString().slice(0,16));
  const [lineItem, setLineItem] = useState({ sku: '', qty: '', batch: '', expDate: '', serial: '', location_id: 'PISO-RECEPCION', action: 'ADD', selectedLpns: {} });
  const [outboundMethod, setOutboundMethod] = useState('AUTO'); 
  const [outboundAutoQty, setOutboundAutoQty] = useState('');

  const [warehouses, setWarehouses] = useAutoSaveState('wms_warehouses_list', [{ id: 'B1', name: 'Bodega Principal' }]);
  const [zones, setZones] = useAutoSaveState('wms_zones_list', [{ id: 'RES', name: 'Reserva' }, { id: 'PCK', name: 'Picking' }, { id: 'STG', name: 'Playa Tránsito' }]);
  const [draftLoc, setDraftLoc] = useAutoSaveState('wms_draft_loc_cfg', { activeWarehouse: '1', activeZone: '', aisleType: 'LETTERS', aisleStart: 'a', aisleEnd: 'c', colCount: 10, levelCount: 4 });
  const [isSavingLoc, setIsSavingLoc] = useState(false);
  const [isClearingLocs, setIsClearingLocs] = useState(false);
  const [newWh, setNewWh] = useState('');
  const [newWhGlosa, setNewWhGlosa] = useState('');
  const [newZone, setNewZone] = useState('');
  // Warehouse mejoras
  const [whShowPreview, setWhShowPreview] = useState(false);
  const [whExcluded, setWhExcluded] = useState(new Set());
  const [whOverwrite, setWhOverwrite] = useState(false);
  const [whSelected, setWhSelected] = useState(new Set());
  const [whZoneFilter, setWhZoneFilter] = useState('');
  const [whBodegaFilter, setWhBodegaFilter] = useState('');
  const [whBulkAction, setWhBulkAction] = useState('');
  const [whBulkZone, setWhBulkZone] = useState('');

  const [showDispatchConfirm, setShowDispatchConfirm] = useState(false);
  const [shipQtys, setShipQtys] = useState({});
  const [importModal, setImportModal] = useState(null); // null | { type, extraParams } → BulkImportModal
  const [confirmDialog, setConfirmDialog] = useState(null); // null | { title, message, confirmText, danger, onConfirm }
  const openConfirm = (opts) => setConfirmDialog(opts);
  const closeConfirm = () => setConfirmDialog(null);

  const [relSearchTerm, setRelSearchTerm] = useState('');
  const [destinations, setDestinations] = useState({});
  const [glosas, setGlosas] = useState({});
  const [relocateQtys, setRelocateQtys] = useState({});
  const [relSelectedId, setRelSelectedId] = useState(null);
  const [relDestParts, setRelDestParts] = useState({ bodega:'', zona:'', pasillo:'', columna:'', fila:'' });
  const [relMassMode, setRelMassMode] = useState('individual');
  const [massSelected, setMassSelected] = useState([]);
  const [massSingleDest, setMassSingleDest] = useState('');
  const [massDestMap, setMassDestMap] = useState({});

  const [skuForm, setSkuForm] = useState(initialSkuForm);
  const [skuSearchTerm, setSkuSearchTerm] = useState('');
  const [isEditingSku, setIsEditingSku] = useState(false);
  const [locSearchTerm, setLocSearchTerm] = useState('');

  const [clientForm, setClientForm] = useState({ id: '', name: '', contact: '', email: '' });
  const [clientSearchTerm, setClientSearchTerm] = useState('');

  const [invSearchTerm, setInvSearchTerm] = useState('');
  const [invStatusFilter, setInvStatusFilter] = useState('');
  const [invClientFilter, setInvClientFilter] = useState('');
  const [invSkuFilter, setInvSkuFilter] = useState('');
  const [invLocFilter, setInvLocFilter] = useState('');
  const [invView, setInvView] = useState('lpn'); // 'lpn' | 'consolidado'
  const [invDateFrom, setInvDateFrom] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [snapshotDate, setSnapshotDate] = useState('');
  const [snapshotData, setSnapshotData] = useState([]);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);
  const [stockAlerts, setStockAlerts] = useState([]);
  const [cycleCountData, setCycleCountData] = useState([]);
  const [activeCycleCount, setActiveCycleCount] = useState(null);
  const [ccBlind, setCcBlind] = useState(false);
  const [ccAddLineForm, setCcAddLineForm] = useState(null);
  const [cycleLines, setCycleLines] = useState([]);
  const [cycleCountedQtys, setCycleCountedQtys] = useState({});
  const [ccFilter, setCcFilter] = useState({ zone:'', client_id:'', sku:'', location_id:'' });
  const [ccPreview, setCcPreview] = useState(null); // { lines, total_units, scopeLabel }
  const [ccPreviewLoading, setCcPreviewLoading] = useState(false);
  const [ccRejectModal, setCcRejectModal] = useState(null); // count_id to reject
  const [ccRejectReason, setCcRejectReason] = useState('');
  const [occupationData, setOccupationData] = useState([]);
  const [returnsData, setReturnsData] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [activePO, setActivePO] = useState(null);
  const [poLines, setPoLines] = useState([]);
  const [poReceivedQtys, setPoReceivedQtys] = useState({});
  const [newPO, setNewPO] = useState({ doc_num:'', supplier:'', client_id:'', expected_date:'', notes:'', items:[] });
  const [newPOLine, setNewPOLine] = useState({ sku:'', expected_qty:'' });
  const [showPOForm, setShowPOForm] = useState(false);
  const [docHistory, setDocHistory] = useState([]);
  const [docHistoryPage, setDocHistoryPage] = useState(0);
  const [docHistorySearch, setDocHistorySearch] = useState('');
  const [docHistoryModule, setDocHistoryModule] = useState('');
  const [docHistoryDateFrom, setDocHistoryDateFrom] = useState('');
  const [docHistoryDateTo, setDocHistoryDateTo] = useState('');
  const [expandedHistoryDoc, setExpandedHistoryDoc] = useState(null);
  const [voidModal, setVoidModal] = useState(null); // { doc }
  const [voidReason, setVoidReason] = useState('');
  const [anulationRequests, setAnulationRequests] = useState([]);
  const [anulHistoryTab, setAnulHistoryTab] = useState('docs'); // 'docs' | 'requests'
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const barcodeInputRef = useRef(null);
  // UX-08: enfocar al activar scanner Y tras completar cada scan
  useEffect(() => { if (barcodeInputRef.current) barcodeInputRef.current.focus(); }, [isScanning]);
  const [newReturn, setNewReturn] = useState({ doc_num:'', doc_type:'DEVOLUCION', client_id:'', reason:'', glosa:'', items:[] });
  const [returnLineItem, setReturnLineItem] = useState({ sku:'', qty:'', original_lpn:'', condition:'BUENO', location_id:'PISO-RECEPCION', notes:'' });
  const [lpnHistoryId, setLpnHistoryId] = useState('');
  const [lpnHistoryData, setLpnHistoryData] = useState(null);
  const [resTab, setResTab] = useState('config');
  const [resSku, setResSku] = useState('');
  const [resSkuFilter, setResSkuFilter] = useState('');
  const [resClientId, setResClientId] = useState('');
  const [resResources, setResResources] = useState([]);
  const [resForm, setResForm] = useState({ resource_type:'MATERIAL', resource_name:'', qty_per_unit:'1', unit:'UN', hours_per_unit:'0', time_unit:'HORAS', personnel_count:'1', notes:'' });
  const [resDateFrom, setResDateFrom] = useState(() => { const d=new Date(); d.setDate(1); return d.toISOString().slice(0,10); });
  const [resDateTo, setResDateTo] = useState(() => new Date().toISOString().slice(0,10));
  const [resReportClient, setResReportClient] = useState('');
  const [resReportData, setResReportData] = useState([]);
  const [alertForm, setAlertForm] = useState({ sku:'', client_id:'', stock_min:'', stock_max:'' });
  const [historyData, setHistoryData] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [invDateTo, setInvDateTo] = useState('');

  const [auditTypeFilter, setAuditTypeFilter] = useState('');
  const [auditUserFilter, setAuditUserFilter] = useState('');
  const [auditDateFrom, setAuditDateFrom] = useState('');
  const [auditDateTo, setAuditDateTo] = useState('');

  const [skuClientFilter, setSkuClientFilter] = useState('');
  const [skuCategoryFilter, setSkuCategoryFilter] = useState('');
  const [skuAbcFilter, setSkuAbcFilter] = useState('');

  const [docTraySearch, setDocTraySearch] = useState('');

  const [statusForm, setStatusForm] = useState({ id: '', description: '', color: 'slate', blocks_outbound: false });
  const [lpnStatuses, setLpnStatuses] = useState({});

  const [docTypeForm, setDocTypeForm] = useState({ id: '', description: '', flow_type: 'BOTH' });

  const [userForm, setUserForm] = useState({ username: '', full_name: '', password: '', role: 'EJECUTIVO_CUENTA', status: 'ACTIVE', allowed_clients: 'ALL', clientSelection: [], allowed_modules_type: 'ROLE', moduleSelection: [], client_scope: 'all', assigned_clients: [] });
  const [isEditingUser, setIsEditingUser] = useState(false);
  const [kitForm, setKitForm] = useState({ kit_sku: '', client_id: '', description: '', components: [] });
  const [kitComponentLine, setKitComponentLine] = useState({ sku: '', qty: '' });
  const [systemMetrics, setSystemMetrics] = useState(null);
  const [systemConfig, setSystemConfig] = useState({});
  // Cargar config pública antes del login (para mostrar nombre de empresa)
  useEffect(() => {
    const h = customHost || '';
    fetch(`${h}/api/system/config`).then(r => r.ok ? r.json() : {}).then(cfg => setSystemConfig(prev => ({...cfg, ...prev}))).catch(() => {});
  }, [customHost]);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [editingConfig, setEditingConfig] = useState({});
  const [superAdminTab, setSuperAdminTab] = useState('metrics');
  const [backupsList, setBackupsList] = useState([]);
  // Registro de accesos (panel ADMIN/SUPERADMIN)
  const [accessLogData, setAccessLogData] = useState({ rows: [], total: 0, stats: {} });
  const [accessLogFilter, setAccessLogFilter] = useState({ username: '', ip: '', success: '', from: '', to: '' });
  const [accessLogPage, setAccessLogPage] = useState(0);
  const [accessLogBusy, setAccessLogBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupRestoring, setBackupRestoring] = useState(false);
  const [backupError, setBackupError] = useState('');
  const [billingReport, setBillingReport] = useState(null);
  const [billingClientId, setBillingClientId] = useState('');
  const [billingMonth, setBillingMonth] = useState(String(new Date().getMonth()+1).padStart(2,'0'));
  const [billingYear, setBillingYear] = useState(String(new Date().getFullYear()));
  const [billingTab, setBillingTab] = useState('generate');
  const [billingInvoices, setBillingInvoices] = useState([]);
  const [billingSummary, setBillingSummary] = useState([]);
  const [billingSummaryLoading, setBillingSummaryLoading] = useState(false);
  const [billingNotes, setBillingNotes] = useState('');
  const [billingDueDate, setBillingDueDate] = useState('');
  const [clientTariffs, setClientTariffs] = useState([]);
  const [newTariff, setNewTariff] = useState({ tariff_type:'', unit_price:'', description:'' });
  const [tariffClientId, setTariffClientId] = useState('');
  const [systemPasswords, setSystemPasswords] = useState([]);
  const [showPasswords, setShowPasswords] = useState(false);
  const [demoFeedbackList, setDemoFeedbackList] = useState([]);
  const [resetPwTarget, setResetPwTarget] = useState(null); // username
  const [resetPwValue, setResetPwValue] = useState('');
  const [editingAuditLog, setEditingAuditLog] = useState(null);
  const [editingAuditGlosa, setEditingAuditGlosa] = useState('');

  const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'SUPERADMIN';
  const is3PLMode = operationMode === '3PL' || operationMode === 'HYBRID';
  const isPropioMode = operationMode === 'PROPIO' || operationMode === 'HYBRID';
  const isHybridMode = operationMode === 'HYBRID';
  // En HYBRID los selectores de cliente se muestran (como 3PL) pero si el usuario
  // no elige uno, los handlers auto-inyectan el cliente PROPIO como default.
  // En 3PL puro el cliente debe elegirse explícitamente; en PROPIO se fuerza siempre.
  const isSuperAdmin = currentUser?.role === 'SUPERADMIN';
  const isDemo = currentUser?.role === 'DEMO' || currentUser?.is_demo === true;
  const canManageMasters = isAdmin || currentUser?.role === 'EJECUTIVO_CUENTA' || isDemo;

  // COD-05: solo resetear selección activa y sidebar — preservar formularios para que el
  // usuario no pierda datos al cambiar de tab accidentalmente
  const switchTab = (tabName) => {
    setActiveTab(tabName); setActiveDocId(null); setSidebarOpen(false);
    setShowDispatchConfirm(false);
    // Cargar registro de accesos al entrar (ADMIN/SUPERADMIN)
    if (tabName === 'access-log' && ['ADMIN','SUPERADMIN'].includes(currentUser?.role)) {
      apiFetch(`${host}/api/login-history?limit=100&offset=0`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setAccessLogData(d); })
        .catch(() => {});
    }
    // Cargar auditoría 3D al entrar al módulo de bodega
    if (tabName === 'warehouse') {
      apiFetch(`${host}/api/locations/audit-3d`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setLocAudit(d); })
        .catch(() => {});
    }
  };

  const loadSnapshot = async () => {
    if (!snapshotDate) return showMsg('⚠️ Selecciona una fecha exacta', true);
    setIsLoadingSnapshot(true);
    try {
      const params = new URLSearchParams({ date: snapshotDate });
      if (invSkuFilter) params.append('sku', invSkuFilter);
      if (invClientFilter) params.append('client_id', invClientFilter);
      const res = await apiFetch(`${host}/api/inventory/snapshot?${params}`);
      const data = await res.json();
      setSnapshotData(Array.isArray(data) ? data : []);
      setShowHistory(true);
    } catch(e) { showMsg('⛔ Error al cargar snapshot', true); }
    finally { setIsLoadingSnapshot(false); }
  };

  const loadHistory = async () => {
    if (!invDateFrom && !invDateTo) return showMsg('⚠️ Selecciona al menos una fecha para buscar historial', true);
    setIsLoadingHistory(true);
    setShowHistory(true);
    try {
      const params = new URLSearchParams();
      if (invDateFrom) params.append('date_from', invDateFrom);
      if (invDateTo) params.append('date_to', invDateTo);
      if (invSkuFilter) params.append('sku', invSkuFilter);
      if (invClientFilter) params.append('client_id', invClientFilter);
      if (invLocFilter) params.append('location_id', invLocFilter);
      const res = await apiFetch(`${host}/api/inventory/history?${params.toString()}`);
      const data = await res.json();
      setHistoryData(Array.isArray(data) ? data : []);
    } catch(e) { showMsg('⛔ Error al cargar historial', true); }
    finally { setIsLoadingHistory(false); }
  };

  const getStatusBadge = (statusId) => { if (!statusId || statusId === 'DISPONIBLE') return colorMap.emerald; const st = statuses.find(s => s.id === statusId); return colorMap[st?.color] || colorMap.slate; };

  const handleCreateDoc = async (e, module) => {
    e.preventDefault(); if (!newDocNum) return showMsg("Ingrese un número de documento", true);
    if (module !== 'adjust' && !newDocType) return showMsg("Seleccione un Tipo de Documento", true);
    // En 3PL/HYBRID el cliente del movimiento es obligatorio y se elige aquí.
    if (is3PLMode && !newDocClient) return showMsg("Seleccione el cliente del movimiento", true);
    if (newDocClient && !canOperateClient(newDocClient)) return showMsg("No tiene permiso para operar con ese cliente", true);
    const docClient = is3PLMode ? newDocClient : (systemConfig.own_client_id || 'PROPIO');
    // Un documento ya cerrado no se puede reutilizar ni reabrir para agregar movimientos.
    if (module === 'receive' || module === 'dispatch' || module === 'adjust') {
      try {
        const checkType = module === 'adjust' ? 'ADJ' : (newDocType || '');
        const qs = new URLSearchParams({ doc_num: newDocNum, doc_type: checkType, client_id: docClient || '' });
        const r = await apiFetch(`${host}/api/processed-docs/exists?${qs.toString()}`);
        if (r.ok) { const d = await r.json(); if (d.exists) return showMsg(`⛔ El documento ${newDocNum} ya fue cerrado para este cliente; no se puede reutilizar.`, true); }
      } catch (err) { /* si falla la verificación, el backend igualmente bloquea el cierre (409) */ }
    }
    const id = `${module.toUpperCase()}-${Date.now()}`;
    const newDoc = { id, docNum: newDocNum, docType: newDocType, client: docClient, glosa: newDocGlosa, docDate: newDocDate, docRef: newDocRef, docEnteredAt: newDocEnteredAt || new Date().toISOString().slice(0,16), items: [], createdAt: new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) };
    setWorkspaces(prev => ({ ...prev, [module]: [newDoc, ...prev[module]] }));
    setNewDocNum(''); setNewDocType(''); setNewDocClient(''); setNewDocGlosa(''); setNewDocDate(''); setNewDocRef(''); setNewDocEnteredAt(new Date().toISOString().slice(0,16)); setActiveDocId(id);
    showMsg('📄 Documento iniciado y autoguardado.');
  };

  const activeDoc = workspaces[activeTab]?.find(d => d.id === activeDocId) || null;
  const removeDoc = (module, id) => setWorkspaces(prev => ({ ...prev, [module]: prev[module].filter(d => d.id !== id) }));
  const addLineToDoc = (newItem) => { setWorkspaces(prev => ({ ...prev, [activeTab]: prev[activeTab].map(d => d.id === activeDocId ? { ...d, items: [...d.items, newItem] } : d) })); setLineItem({ sku: '', qty: '', batch: '', expDate: '', serial: '', location_id: 'PISO-RECEPCION', action: 'ADD', selectedLpns: {} }); };
  const removeLineFromDoc = (indexToRemove) => { setWorkspaces(prev => ({ ...prev, [activeTab]: prev[activeTab].map(d => d.id === activeDocId ? { ...d, items: d.items.filter((_, i) => i !== indexToRemove) } : d) })); };

  const handleCommitAPI = async (endpoint, module) => {
    if (!activeDoc || activeDoc.items.length === 0) return;
    if (isCommitting) return; // evitar doble submit
    // El cierre de recepción/despacho ya NO pide re-clave (step-up desactivado).
    const reauthPw = '';
    setIsCommitting(true);
    try {
      const res = await apiFetch(`${host}/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...activeDoc, client_id: activeDoc.client, username: currentUser.username, ...(reauthPw ? { reauth_password: reauthPw } : {}) }) });
      if (res.ok) {
        const moduleMsg = {
          receive: 'Mercancía recibida en bodega',
          dispatch: 'Pedido despachado correctamente',
          adjust: 'Cantidad corregida correctamente',
          relocate: 'Producto movido correctamente',
        };
        showMsg(`✅ ${moduleMsg[module] || 'Operación completada'}`);
        // Guardar en historial
        try {
          const firstSku = activeDoc.items[0]?.sku;
          const docClientId = activeDoc.items[0]?.clientId || (Array.isArray(skus) && skus.find(s => s.sku === firstSku)?.client_id) || '';
          await apiFetch(`${host}/api/document-history`, { method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ id: activeDoc.id, module, doc_num: activeDoc.docNum, doc_type: activeDoc.docType, glosa: activeDoc.glosa, doc_date: activeDoc.docDate||null, doc_ref: activeDoc.docRef||null, entered_at: activeDoc.docEnteredAt||null, username: currentUser.username, items: activeDoc.items, client_id: docClientId }) });
        } catch(e) {}
        removeDoc(module, activeDocId); setActiveDocId(null); fetchData();
      } else {
        // M3: stock insuficiente con sustitutos disponibles → abrir modal
        let errBody = null;
        try { errBody = await res.json(); } catch(e) {}
        if (module === 'dispatch' && res.status === 422 && errBody?.error === 'stock_insuficiente' && Array.isArray(errBody?.items_con_deficit)) {
          const substitutesBySku = {};
          for (const it of errBody.items_con_deficit) {
            try {
              const r = await apiFetch(`${host}/api/skus/${encodeURIComponent(it.sku)}/substitutes?qty=${it.deficit}`);
              if (r.ok) substitutesBySku[it.sku] = await r.json();
            } catch (e) {}
          }
          setSubstituteModal({
            doc: activeDoc, items_con_deficit: errBody.items_con_deficit,
            substitutesBySku, selection: {},
          });
          setIsCommitting(false);
          return;
        }
        showMsg(`⛔ ${errBody?.error || `Error ${res.status}`}`, true);
        // Documento ya cerrado/procesado: descartar el borrador (no se reabre).
        if (res.status === 409) { removeDoc(module, activeDocId); setActiveDocId(null); fetchData(); }
      }
    } catch(err) { showMsg(`⛔ Error de red`, true); }
    finally { setIsCommitting(false); }
  };

  const handleAdjustRequest = async () => {
    if (!activeDoc || activeDoc.items.length === 0) return;
    try {
      const res = await apiFetch(`${host}/api/adjust-request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: activeDoc.items, docNum: activeDoc.docNum, glosa: activeDoc.glosa || '' }) });
      if (res.ok) {
        showMsg('📋 Solicitud enviada — pendiente de aprobación por un administrador.');
        removeDoc('adjust', activeDocId); setActiveDocId(null); fetchData();
      } else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
    } catch(e) { showMsg('⛔ Error de red', true); }
  };

  const openDispatchConfirm = () => {
    if (!activeDoc || activeDoc.items.length === 0) return;
    const initialQtys = {};
    activeDoc.items.forEach((it, idx) => { initialQtys[idx] = it.qtyToPick; });
    setShipQtys(initialQtys);
    // Pre-llenar con cantidades del picker si están disponibles
    if (docPickLines.length > 0) {
      const confMap = {};
      docPickLines.forEach(pl => { if (pl.lpn_id) confMap[pl.lpn_id] = pl.qty_confirmed; });
      activeDoc.items.forEach((it, idx) => {
        if (confMap[it.lpnId] !== undefined && confMap[it.lpnId] !== null) initialQtys[idx] = parseFloat(confMap[it.lpnId]);
      });
      setShipQtys({...initialQtys});
      const allConfirmed = docPickLines.length > 0 && docPickLines.every(pl => ['COMPLETADA','DIFERENCIA'].includes(pl.line_status));
      setUsePickConf(allConfirmed);
    }
    setShowDispatchConfirm(true);
  };

  const loadDocPickLines = useCallback(async (docNum) => {
    if (!docNum) return;
    const res = await apiFetch(`${host}/api/pick-tasks/by-doc/${encodeURIComponent(docNum)}`).catch(()=>null);
    if (res?.ok) setDocPickLines(await res.json());
    else setDocPickLines([]);
  }, [host]);

  // Cargar pick lines cuando cambia el documento activo en despacho
  useEffect(() => {
    if (activeTab === 'dispatch' && activeDocId) {
      const doc = workspaces['dispatch']?.find(d => d.id === activeDocId);
      if (doc?.docNum) loadDocPickLines(doc.docNum);
      else setDocPickLines([]);
    } else {
      setDocPickLines([]);
    }
  }, [activeDocId, activeTab, loadDocPickLines, workspaces]);

  const handleSendToPicking = async () => {
    if (!activeDoc || activeDoc.items.length === 0) return;
    const lines = activeDoc.items.map((it, i) => ({
      sku: it.sku, sku_desc: it.desc, lpn_id: it.lpnId,
      location_from: it.location, qty_requested: it.qtyToPick, priority: i + 1
    }));
    const res = await apiFetch(`${host}/api/pick-tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc_id: activeDoc.id, doc_num: activeDoc.docNum, doc_type: activeDoc.docType, module: 'dispatch', lines })
    });
    if (res.ok) { showMsg('✅ Tareas de picking creadas. Asígnalas desde la Cola de picking.'); fetchData(); loadDocPickLines(activeDoc.docNum); }
    else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
  };

  const validateRealTimeStock = async (itemsToValidate) => {
    setIsValidating(true);
    try {
      const res = await apiFetch(`${host}/api/inventory`);
      if (!res.ok) throw new Error('Error de conexión');
      const latestInventory = await res.json();
      for (const item of itemsToValidate) {
        const currentLpn = latestInventory.find(i => i.id === item.lpnId);
        if (!currentLpn) { showMsg(`❌ Error: El LPN ${item.lpnId} ya no existe.`, true); return false; }
        const inThisCart = activeDoc?.items.filter(it => it.lpnId === item.lpnId).reduce((sum, it) => sum + parseFloat(it.qtyToPick || it.qty), 0) || 0;
        const effectiveAvailable = parseFloat(currentLpn.qty) - inThisCart;
        if (effectiveAvailable < item.qtyToPick) { showMsg(`❌ Stock Insuficiente: LPN ${item.lpnId} solo tiene ${effectiveAvailable}.`, true); return false; }
      }
      return true;
    } catch (error) { showMsg(`⛔ Error al validar stock`, true); return false; } finally { setIsValidating(false); }
  };

  const handleCommitDispatchPartial = async () => {
    if (!activeDoc || activeDoc.items.length === 0) return;
    const itemsToShip = activeDoc.items.map((it, idx) => ({ ...it, qtyToPick: shipQtys[idx] || 0 })).filter(it => it.qtyToPick > 0);
    if (itemsToShip.length === 0) return showMsg('⚠️ Ingrese cantidad mayor a 0', true);
    if (isCommitting) return;
    const reauthPw = ''; // cierre de despacho sin re-clave
    const isValid = await validateRealTimeStock(itemsToShip);
    if (!isValid) { fetchData(); return; }
    setIsCommitting(true);
    try {
      const res = await apiFetch(`${host}/api/dispatch_batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docNum: activeDoc.docNum, docType: activeDoc.docType, client_id: activeDoc.client, glosa: activeDoc.glosa, items: itemsToShip, username: currentUser.username, usePickConfirmations: usePickConf, reauth_password: reauthPw }) });
      if (res.ok) {
        // Guardar en historial de documentos con client_id del primer LPN
        try {
          const firstLpn = (Array.isArray(data) ? data : []).find(i => i.id === itemsToShip[0]?.lpnId);
          const dispClientId = firstLpn?.client_id || '';
          await apiFetch(`${host}/api/document-history`, { method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ id: activeDoc.id, module: 'dispatch', doc_num: activeDoc.docNum, doc_type: activeDoc.docType, glosa: activeDoc.glosa, username: currentUser.username, items: itemsToShip, client_id: dispClientId }) });
        } catch(e) {}
        let remainingItems = [];
        activeDoc.items.forEach((it, idx) => { const shipped = shipQtys[idx] || 0; const remaining = parseFloat(it.qtyToPick) - parseFloat(shipped); if (remaining > 0) remainingItems.push({ ...it, qtyToPick: remaining }); });
        if (remainingItems.length === 0) { showMsg('✅ Pedido despachado completo'); removeDoc('dispatch', activeDocId); setActiveDocId(null); }
        else { showMsg('⚠️ Despacho Parcial completado.'); setWorkspaces(prev => ({ ...prev, dispatch: prev.dispatch.map(d => d.id === activeDocId ? { ...d, items: remainingItems } : d) })); }
        setShowDispatchConfirm(false); fetchData();
      } else {
        let errorMsg = `Error ${res.status}`;
        try { const err = await res.json(); errorMsg = err.error || errorMsg; } catch(e) {}
        showMsg(`⛔ ${errorMsg}`, true);
      }
    } catch (e) { showMsg(`⛔ Error de red`, true); }
    finally { setIsCommitting(false); }
  };

  // Helper: genera array de ubicaciones según config actual
  const buildLocsList = () => {
    // Nuevo formato 4 segmentos: {bodega}-{pasillo}-{columna_padded}-{fila}
    // El pasillo preserva el case (sin toUpperCase).
    const isLetters = draftLoc.aisleType === 'LETTERS';
    const start = isLetters ? draftLoc.aisleStart.charCodeAt(0) : parseInt(draftLoc.aisleStart);
    const end   = isLetters ? draftLoc.aisleEnd.charCodeAt(0)   : parseInt(draftLoc.aisleEnd);
    const locs = [];
    for (let a = start; a <= end; a++) {
      const aisleStr = isLetters ? String.fromCharCode(a) : String(a);
      for (let c = 1; c <= parseInt(draftLoc.colCount); c++) {
        for (let l = 1; l <= parseInt(draftLoc.levelCount); l++) {
          locs.push({
            location_id: `${draftLoc.activeWarehouse}-${aisleStr}-${String(c).padStart(2,'0')}-${l}`,
            warehouse: draftLoc.activeWarehouse,
            zone_code: draftLoc.activeZone,
            aisle: aisleStr,
            row_num: c,
            level: l,
          });
        }
      }
    }
    return locs;
  };

  const handleGenerateLocs = async () => {
    setIsSavingLoc(true);
    const allLocs = buildLocsList();
    const locsToCreate = allLocs.filter(l => !whExcluded.has(l.location_id));
    try {
      const res = await apiFetch(`${host}/api/locations/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locations: locsToCreate, overwrite: whOverwrite })
      });
      const d = await res.json();
      fetchData();
      showMsg(`✅ Se generaron ${d.generated || 0} ubicaciones${d.skipped ? ` (${d.skipped} omitidas por duplicado)` : ''}.`);
      setWhShowPreview(false); setWhExcluded(new Set());
    } catch(e) {
      showMsg('⛔ Error al generar ubicaciones', true);
    }
    setIsSavingLoc(false);
  };

  const handleDeleteLocation = async (locId) => {
    if(!(await confirm({ message: `¿Eliminar la ubicación ${locId}? Asegúrese de que no tenga stock.`, danger: true }))) return;
    try {
      const res = await apiFetch(`${host}/api/locations/${locId}`, { method: 'DELETE' });
      if (res.ok) { showMsg(`✅ Ubicación ${locId} eliminada.`); fetchData(); }
      else { const err = await res.json(); showMsg(`⛔ Error: ${err.error}`, true); }
    } catch(e) { showMsg('⛔ Error de red al eliminar', true); }
  };

  const handleClearLocations = () => {
    openConfirm({
      title: 'Eliminar todas las ubicaciones',
      message: `Se eliminarán TODAS las ubicaciones vacías (${locations.filter(l => l.location_id !== 'PISO-RECEPCION').length} registradas). Las que tienen stock activo NO se borrarán. Esta acción no se puede deshacer.`,
      confirmText: 'Sí, eliminar todo',
      danger: true,
      onConfirm: async () => {
        setIsClearingLocs(true);
        try {
          const res = await apiFetch(`${host}/api/locations/bulk`, { method: 'DELETE' });
          const d = await res.json();
          fetchData();
          showMsg(`✅ Se eliminaron ${d.deleted || 0} ubicaciones vacías.`);
        } catch(e) {
          showMsg('⛔ Error al eliminar ubicaciones', true);
        }
        setIsClearingLocs(false);
      }
    });
  };

  // MEJORA 2: Exportar layout CSV
  const handleExportLocsCsv = () => {
    const rows = [['location_id','zone_code','loc_type','max_kg','max_pallets']];
    safeLocs.forEach(l => rows.push([l.location_id, l.zone_code||'', l.loc_type||'PALLET', l.max_kg||0, l.max_pallets||0]));
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'layout_bodega.csv'; a.click();
  };

  // MEJORA 2: Importar layout CSV
  const handleImportLocsCsv = async (file) => {
    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    const header = lines[0].toLowerCase().split(',').map(h => h.trim());
    const idIdx = header.indexOf('location_id');
    const zoneIdx = header.indexOf('zone_code');
    const typeIdx = header.indexOf('loc_type');
    const kgIdx = header.indexOf('max_kg');
    const palIdx = header.indexOf('max_pallets');
    if (idIdx < 0) return showMsg('⛔ CSV debe tener columna location_id', true);
    const locs = lines.slice(1).map(line => {
      const cols = line.split(',').map(c => c.trim());
      return { location_id: cols[idIdx]?.toUpperCase(), zone_code: cols[zoneIdx]||null, loc_type: cols[typeIdx]||'PALLET', max_kg: parseFloat(cols[kgIdx])||0, max_pallets: parseInt(cols[palIdx])||0 };
    }).filter(l => l.location_id);
    if (locs.length === 0) return showMsg('⛔ No se encontraron ubicaciones en el CSV', true);
    try {
      const res = await apiFetch(`${host}/api/locations/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locations: locs, overwrite: true }) });
      const d = await res.json();
      fetchData();
      showMsg(`✅ Importadas ${d.generated} ubicaciones desde CSV.`);
    } catch(e) { showMsg('⛔ Error al importar CSV', true); }
  };

  // MEJORA 3: Acciones masivas
  const handleBulkLocAction = async () => {
    if (whSelected.size === 0) return showMsg('⚠️ Selecciona ubicaciones primero', true);
    const ids = [...whSelected];
    if (whBulkAction === 'delete') {
      const res = await apiFetch(`${host}/api/locations/bulk-delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location_ids: ids }) });
      if (res.ok) { const d = await res.json(); showMsg(`✅ ${d.deleted} ubicaciones eliminadas.`); setWhSelected(new Set()); fetchData(); }
      else { const e = await res.json(); showMsg(`⛔ ${e.error}`, true); }
    } else if (whBulkAction === 'zone' && whBulkZone) {
      const res = await apiFetch(`${host}/api/locations/bulk`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location_ids: ids, zone_code: whBulkZone }) });
      if (res.ok) { showMsg(`✅ ${ids.length} ubicaciones actualizadas.`); setWhSelected(new Set()); fetchData(); }
      else { const e = await res.json(); showMsg(`⛔ ${e.error}`, true); }
    }
  };

  const handleSaveClient = async (e) => { e.preventDefault(); if (isSavingClient) return; setIsSavingClient(true); try { const res = await apiFetch(`${host}/api/clients`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clientForm) }); if (res.ok) { showMsg('✅ Cliente guardado'); const saved = { id: clientForm.id.trim(), name: clientForm.name.trim(), contact: clientForm.contact || '', email: clientForm.email || '' }; setClients(prev => { const exists = prev.find(c => c.id === saved.id); return exists ? prev.map(c => c.id === saved.id ? saved : c) : [...prev, saved].sort((a,b) => a.name.localeCompare(b.name)); }); setClientForm({ id: '', name: '', contact: '', email: '' }); } else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); } } catch (e) { showMsg('⛔ Error de red', true); } finally { setIsSavingClient(false); } };
  const handleDeleteClient = async (id) => { if(!(await confirm({ message: `¿Eliminar cliente ${id}?`, danger: true }))) return; try { const res = await apiFetch(`${host}/api/clients/${id}`, { method: 'DELETE' }); if (res.ok) { showMsg('✅ Cliente eliminado'); setClients(prev => prev.filter(c => c.id !== id)); } else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); } } catch(e) { showMsg('⛔ Error de red', true); } };

  const handleSaveSku = async (e) => {
    e.preventDefault();
    if (isSavingSku) return;
    setIsSavingSku(true);
    const payload = { ...skuForm, requires_lot: skuForm.traceability === 'LOT', requires_serial: skuForm.traceability === 'SERIAL', username: currentUser?.username };
    if ((!is3PLMode || isHybridMode) && !payload.client_id) payload.client_id = systemConfig.own_client_id || 'PROPIO';
    try {
      // En edición → PUT (puede versionar). En creación → POST.
      const url = isEditingSku ? `${host}/api/skus/${encodeURIComponent(skuForm.sku)}` : `${host}/api/skus`;
      const method = isEditingSku ? 'PUT' : 'POST';
      const res = await apiFetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      const data = await res.json().catch(()=>({}));
      if (res.ok) {
        if (data.versioned) {
          showMsg(`✅ ${data.sku}: ahora en versión ${data.new_version}. El stock anterior (v${data.previous_version}) se despacha normalmente.`);
        } else {
          showMsg(isEditingSku ? '✅ Artículo actualizado' : '✅ Artículo guardado');
        }
        setSkuForm(initialSkuForm); setIsEditingSku(false); setEditingSkuOriginal(null); fetchData();
      } else {
        showMsg(`⛔ ${data.error || 'Error al guardar'}`, true);
      }
    } catch (e) { showMsg('⛔ Error de red', true); }
    finally { setIsSavingSku(false); }
  };
  const handleOpenVersions = async (sku) => {
    const res = await apiFetch(`${host}/api/skus/${encodeURIComponent(sku)}/versions`);
    if (res.ok) setSkuVersionsModal({ sku, versions: await res.json() });
  };
  const handleEditSku = (s) => {
    const snapshot = { sku: s.sku, requires_lot: !!s.requires_lot, requires_serial: !!s.requires_serial, stock_total: parseFloat(s.stock_total) || 0 };
    setEditingSkuOriginal(snapshot);
    setSkuForm({ sku: s.sku, barcode: s.barcode || '', desc: s.desc || '', category: s.category || 'General', uom: s.uom || 'UN', weight: s.weight || '', length: s.length || '', width: s.width || '', height: s.height || '', abc_class: s.abc_class || '-', traceability: s.requires_serial ? 'SERIAL' : (s.requires_lot ? 'LOT' : 'NONE'), client_id: s.client_id || '', manufacturer_id: s.manufacturer?.id || s.manufacturer_id || '', manufacturer_code: s.manufacturer?.code || s.manufacturer_code || '', manufacturer_sku: s.manufacturer_sku || '', brand: s.brand || '', allow_substitutes: !!s.allow_substitutes, substitute_scope: s.substitute_scope || 'any', substitute_threshold: s.substitute_threshold !== null && s.substitute_threshold !== undefined && s.substitute_threshold !== '' ? Math.round(parseFloat(s.substitute_threshold) * 100) : '' });
    setIsEditingSku(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Handlers fabricantes
  const handleSaveManufacturer = async (e) => {
    if (e) e.preventDefault();
    try {
      const method = editingMfrId ? 'PUT' : 'POST';
      const url = editingMfrId ? `${host}/api/manufacturers/${editingMfrId}` : `${host}/api/manufacturers`;
      const res = await apiFetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(manufacturerForm) });
      const d = await res.json().catch(()=>({}));
      if (res.ok) {
        showMsg(editingMfrId ? '✅ Fabricante actualizado' : '✅ Fabricante creado');
        setManufacturerForm({ code:'', name:'', country:'', contact:'', email:'', phone:'', website:'', notes:'' });
        setEditingMfrId(null);
        const r2 = await apiFetch(`${host}/api/manufacturers`);
        if (r2.ok) setManufacturers(await r2.json());
        return d.manufacturer || null;
      } else {
        showMsg(`⛔ ${d.error || 'Error al guardar'}`, true);
        return null;
      }
    } catch (e) { showMsg('⛔ Error de red', true); return null; }
  };
  const handleDeleteManufacturer = async (id) => {
    if (!(await confirm({ message: '¿Desactivar este fabricante? Si no tiene stock vinculado se ocultará de la lista activa.', danger: true }))) return;
    const res = await apiFetch(`${host}/api/manufacturers/${id}`, { method: 'DELETE' });
    const d = await res.json().catch(()=>({}));
    if (res.ok) { showMsg('✅ Fabricante desactivado'); const r2 = await apiFetch(`${host}/api/manufacturers`); if (r2.ok) setManufacturers(await r2.json()); }
    else showMsg(`⛔ ${d.error || 'Error'}`, true);
  };
  const handleEditMfr = (m) => {
    setManufacturerForm({ code: m.code, name: m.name, country: m.country||'', contact: m.contact||'', email: m.email||'', phone: m.phone||'', website: m.website||'', notes: m.notes||'' });
    setEditingMfrId(m.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const handleOpenMfrDetail = async (id) => {
    const res = await apiFetch(`${host}/api/manufacturers/${id}`);
    if (res.ok) setMfrDetail(await res.json());
  };
  const handleDeleteSku = async (skuId, clientId) => { if(!(await confirm({ message: `¿Eliminar SKU ${skuId}?`, danger: true }))) return; try { const res = await apiFetch(`${host}/api/skus/${encodeURIComponent(skuId)}?client_id=${encodeURIComponent(clientId || '')}`, { method: 'DELETE' }); if (res.ok) { showMsg('✅ SKU eliminado'); fetchData(); } else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); } } catch(e) { showMsg('⛔ Error de red', true); } };
  const handleSaveAlert = async (e) => { e.preventDefault(); try { const res = await apiFetch(`${host}/api/skus/alerts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(alertForm)}); if(res.ok){showMsg('✅ Límites de stock guardados');setAlertForm({sku:'',client_id:'',stock_min:'',stock_max:''});fetchData();}else{const err=await res.json();showMsg(`⛔ ${err.error}`,true);}}catch(e){showMsg('⛔ Error de red',true);}};

  const handleRelocate = async (id, currentLoc, maxQty) => {
    const newLoc = destinations[id];
    const moveQty = relocateQtys[id] ? parseFloat(relocateQtys[id]) : parseFloat(maxQty);
    if (!newLoc || newLoc === currentLoc) return;
    if (isNaN(moveQty) || moveQty <= 0 || moveQty > parseFloat(maxQty)) return showMsg('⛔ Cantidad inválida para reubicar', true);
    const isPicker = currentUser?.role === 'PICKER';
    try {
      if (isPicker) {
        // PICKER: genera solicitud de reubicación — pendiente de autorización
        const res = await apiFetch(`${host}/api/relocate-requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lpn_id: id, location_to: newLoc, qty: moveQty, glosa: glosas[id] || '' }) });
        if (res.ok) { showMsg('📋 Solicitud enviada — pendiente de autorización'); setDestinations(prev => ({...prev, [id]: ''})); setGlosas(prev => ({...prev, [id]: ''})); setRelocateQtys(prev => ({...prev, [id]: ''})); fetchData(); }
        else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
      } else {
        // JEFE_BODEGA/ADMIN: mueve directamente
        const res = await apiFetch(`${host}/api/relocate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, new_location_id: newLoc, qty: moveQty, glosa: glosas[id] || '', username: currentUser.username }) });
        if (res.ok) { showMsg(moveQty < parseFloat(maxQty) ? '✅ Parte del producto fue movida correctamente' : '✅ Producto movido correctamente'); setDestinations(prev => ({...prev, [id]: ''})); setGlosas(prev => ({...prev, [id]: ''})); setRelocateQtys(prev => ({...prev, [id]: ''})); fetchData(); }
        else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
      }
    } catch (e) { showMsg(`⛔ Error de red: ${e.message}`, true); }
  };

  const handleSaveStatus = async (e) => { e.preventDefault(); if(!statusForm.id) return; try { const res = await apiFetch(`${host}/api/statuses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(statusForm) }); if (res.ok) { showMsg('✅ Estado guardado'); const saved = { id: statusForm.id.toUpperCase().replace(/\s/g,'_'), description: statusForm.description, color: statusForm.color || 'slate', blocks_outbound: statusForm.blocks_outbound || false }; setStatuses(prev => { const exists = prev.find(s => s.id === saved.id); return exists ? prev.map(s => s.id === saved.id ? saved : s) : [...prev, saved]; }); setStatusForm({ id: '', description: '', color: 'slate', blocks_outbound: false }); } else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); } } catch (e) { showMsg('⛔ Error de red', true); } };
  const handleDeleteStatus = async (id) => { if(!(await confirm({ message: `¿Eliminar estado ${id}?`, danger: true }))) return; try { const res = await apiFetch(`${host}/api/statuses/${id}`, { method: 'DELETE' }); if (res.ok) { showMsg('✅ Estado eliminado'); setStatuses(prev => prev.filter(s => s.id !== id)); } else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); } } catch(e) { showMsg('⛔ Error', true); } };
  const handleChangeStatus = async (id, currentStatus) => { const newStatus = lpnStatuses[id]; if (!newStatus || newStatus === currentStatus) return; try { const res = await apiFetch(`${host}/api/inventory/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, new_status: newStatus, glosa: glosas[id] || '', username: currentUser.username }) }); if (res.ok) { showMsg('✅ Estado actualizado'); setData(prev => prev.map(i => i.id === id ? {...i, status: newStatus} : i)); setLpnStatuses(prev => ({...prev, [id]: ''})); setGlosas(prev => ({...prev, [id]: ''})); } else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); } } catch (e) { showMsg('⛔ Error de red', true); } };

  const handleSaveDocType = async (e) => { e.preventDefault(); if(!docTypeForm.id) return; try { const res = await apiFetch(`${host}/api/document_types`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(docTypeForm) }); if (res.ok) { showMsg('✅ Documento guardado'); const saved = { id: docTypeForm.id.toUpperCase().replace(/\s/g,'_'), description: docTypeForm.description, flow_type: docTypeForm.flow_type || 'BOTH' }; setDocumentTypes(prev => { const exists = prev.find(d => d.id === saved.id); return exists ? prev.map(d => d.id === saved.id ? saved : d) : [...prev, saved]; }); setDocTypeForm({ id: '', description: '', flow_type: 'BOTH' }); } else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); } } catch (e) { showMsg('⛔ Error de red', true); } };
  const handleDeleteDocType = async (id) => { if(!(await confirm({ message: `¿Eliminar ${id}?`, danger: true }))) return; try { const res = await apiFetch(`${host}/api/document_types/${id}`, { method: 'DELETE' }); if (res.ok) { showMsg('✅ Documento eliminado'); setDocumentTypes(prev => prev.filter(d => d.id !== id)); } else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); } } catch(e) { showMsg('⛔ Error de red', true); } };

  const handleSaveUser = async (e) => {
    e.preventDefault();
    if (isSavingUser) return;
    setIsSavingUser(true);
    const payload = { ...userForm, allowed_clients: userForm.allowed_clients === 'ALL' ? 'ALL' : JSON.stringify(userForm.clientSelection), allowed_modules: userForm.allowed_modules_type === 'ROLE' ? 'ALL' : JSON.stringify(userForm.moduleSelection) };
    try {
      const res = await apiFetch(`${host}/api/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) {
        // UC: persistir client_scope + assigned_clients (no aplica si rol es ADMIN/SUPERADMIN)
        const isAdminRole = ['ADMIN','SUPERADMIN'].includes(userForm.role);
        const desiredScope = isAdminRole ? 'all' : (userForm.client_scope || 'all');
        if (!isAdminRole && userForm.username !== currentUser?.username) {
          await apiFetch(`${host}/api/users/${encodeURIComponent(userForm.username)}/client-scope`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ client_scope: desiredScope }) }).catch(()=>{});
          if (desiredScope === 'assigned') {
            await apiFetch(`${host}/api/users/${encodeURIComponent(userForm.username)}/clients`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ client_ids: userForm.assigned_clients || [] }) }).catch(()=>{});
          }
        }
        showMsg(isEditingUser ? '✅ Usuario actualizado' : '✅ Usuario creado');
        setUserForm({ username: '', full_name: '', password: '', role: 'EJECUTIVO_CUENTA', status: 'ACTIVE', allowed_clients: 'ALL', clientSelection: [], allowed_modules_type: 'ROLE', moduleSelection: [], client_scope: 'all', assigned_clients: [] });
        setIsEditingUser(false); fetchData();
      }
      else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
    } catch (e) { showMsg('⛔ Error de red', true); }
    finally { setIsSavingUser(false); }
  };
  const handleEditUser = (u) => { const isAllCl = u.allowed_clients === 'ALL'; const isAllMod = u.allowed_modules === 'ALL' || !u.allowed_modules; setUserForm({ username: u.username, full_name: u.full_name, password: '', role: u.role, status: u.status || 'ACTIVE', allowed_clients: isAllCl ? 'ALL' : 'RESTRICTED', clientSelection: isAllCl ? [] : JSON.parse(u.allowed_clients || '[]'), allowed_modules_type: isAllMod ? 'ROLE' : 'CUSTOM', moduleSelection: isAllMod ? [] : JSON.parse(u.allowed_modules || '[]'), client_scope: u.client_scope || 'all', assigned_clients: Array.isArray(u.assigned_clients) ? u.assigned_clients : [] }); setIsEditingUser(true); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const handleDeleteUser = async (id) => { if(!(await confirm({ message: `¿Eliminar al usuario ${id}?`, danger: true }))) return; try { const res = await apiFetch(`${host}/api/users/${id}`, { method: 'DELETE' }); if (res.ok) { showMsg('✅ Usuario eliminado'); fetchData(); } else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); } } catch(e) { showMsg('⛔ Error de red', true); } };

  const addKitComponent = () => {
    if (!kitComponentLine.sku || !kitComponentLine.qty || parseFloat(kitComponentLine.qty) <= 0) return;
    if (kitForm.components.find(c => c.sku === kitComponentLine.sku)) return showMsg('⚠️ Componente ya agregado', true);
    setKitForm(prev => ({ ...prev, components: [...prev.components, { sku: kitComponentLine.sku, qty: kitComponentLine.qty }] }));
    setKitComponentLine({ sku: '', qty: '' });
  };
  const removeKitComponent = (sku) => setKitForm(prev => ({ ...prev, components: prev.components.filter(c => c.sku !== sku) }));
  const handleSaveKit = async (e) => {
    e.preventDefault();
    if (kitForm.components.length === 0) return showMsg('⚠️ Agrega al menos un componente', true);
    try {
      const kitPayload = { ...kitForm };
      if ((!is3PLMode || isHybridMode) && !kitPayload.client_id) kitPayload.client_id = systemConfig.own_client_id || 'PROPIO';
      const res = await apiFetch(`${host}/api/kits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kitPayload) });
      if (res.ok) { showMsg('✅ Kit guardado'); setKitForm({ kit_sku: '', client_id: '', description: '', components: [] }); setKitComponentLine({ sku: '', qty: '' }); fetchData(); }
      else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
    } catch (e) { showMsg('⛔ Error de red', true); }
  };
  const handleDeleteKit = async (kit_sku, client_id) => {
    if (!(await confirm({ message: `¿Eliminar kit ${kit_sku}?`, danger: true }))) return;
    try {
      const res = await apiFetch(`${host}/api/kits/${encodeURIComponent(kit_sku)}/${encodeURIComponent(client_id)}`, { method: 'DELETE' });
      if (res.ok) { showMsg('✅ Kit eliminado'); fetchData(); }
      else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
    } catch (e) { showMsg('⛔ Error de red', true); }
  };

  const safeData = Array.isArray(data) ? data : [];
  const safeSkus = Array.isArray(skus) ? skus : [];
  const safeLocs = Array.isArray(locations) ? locations : [];

  const isAllClients = currentUser?.allowed_clients === 'ALL' || !currentUser?.allowed_clients;
  const userClientsArray = isAllClients ? [] : JSON.parse(currentUser?.allowed_clients || '[]');

  const permittedClients = isAllClients ? clients : clients.filter(c => userClientsArray.includes(c.id));
  // En modo PROPIO solo se muestra el cliente propio en selectores/UI; en 3PL/HYBRID todos los permitidos
  const displayClients = is3PLMode ? permittedClients : permittedClients.filter(c => c.id === (systemConfig.own_client_id || 'PROPIO'));

  // ── Modo 3PL: scope de operaciones por usuario ──────────────────────────────
  // currentUser.client_scope: 'all' | 'assigned' | 'none'
  // currentUser.assigned_clients: array de { id, name } o IDs.
  const opsClientScope = ['ADMIN','SUPERADMIN'].includes(currentUser?.role) ? 'all' : (currentUser?.client_scope || 'all');
  const opsAssignedIds = Array.isArray(currentUser?.assigned_clients)
    ? currentUser.assigned_clients.map(c => typeof c === 'string' ? c : c.id)
    : [];
  // Lista de clientes para dropdowns de OPERACIÓN (recibir/despachar/etc)
  const opsClients = opsClientScope === 'all'
    ? permittedClients
    : opsClientScope === 'assigned'
      ? permittedClients.filter(c => opsAssignedIds.includes(c.id))
      : []; // 'none'
  // Helper: ¿el usuario puede crear operaciones para este client_id?
  const canOperateClient = (cid) => {
    if (opsClientScope === 'all') return true;
    if (opsClientScope === 'none') return false;
    return opsAssignedIds.includes(cid);
  };
  // Banner informativo para módulos operativos.
  const opsScopeBanner = (() => {
    if (opsClientScope === 'all') return null;
    if (opsClientScope === 'none') {
      return (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-[11px] font-bold text-red-700 max-w-4xl mx-auto">
          <ShieldAlert size={14}/>
          <span>Sin clientes asignados. Contactá al administrador para poder crear operaciones.</span>
        </div>
      );
    }
    const items = (currentUser?.assigned_clients || []).map(c => typeof c === 'string' ? { id: c, name: c } : c);
    return (
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-[11px] font-bold text-indigo-700 max-w-4xl mx-auto">
        <Info size={14}/>
        <span>Operando sobre: </span>
        <div className="flex flex-wrap gap-1.5">
          {items.length === 0 ? <span className="italic text-indigo-500">(ninguno asignado)</span> : items.slice(0,5).map(c => (
            <span key={c.id} className="bg-white border border-indigo-200 rounded px-1.5 py-0.5 font-mono">{c.id}{c.name && ` · ${c.name}`}</span>
          ))}
          {items.length > 5 && <span className="text-indigo-500">+{items.length-5} más</span>}
        </div>
      </div>
    );
  })();
  const permittedSkus = isAllClients ? safeSkus : safeSkus.filter(s => userClientsArray.includes(s.client_id) || !s.client_id || s.client_id === 'GENERAL');
  const permittedInventory = isAllClients ? safeData : safeData.filter(i => userClientsArray.includes(i.client_id) || !i.client_id || i.client_id === 'GENERAL');

  // Catálogo de SKUs e inventario acotados al CLIENTE del documento activo
  // (el cliente se elige al crear el movimiento). Si el doc no tiene cliente
  // (modo PROPIO o sin elegir), no se acota.
  const docClient = activeDoc?.client || null;
  const docSkus = docClient ? permittedSkus.filter(s => (s.client_id || '') === docClient) : permittedSkus;
  const docInventory = docClient ? permittedInventory.filter(i => (i.client_id || '') === docClient) : permittedInventory;

  const selSku = permittedSkus.find(s => s.sku === lineItem.sku) || {};

  const stockForDisp = docInventory.filter(i => {
    if (i.sku !== lineItem.sku) return false;
    if (!i.status || i.status === 'DISPONIBLE') return true;
    const st = statuses.find(s => s.id === i.status);
    if (st && st.blocks_outbound) return false; 
    return true;
  }).map(lpn => {
    const inCart = activeDoc?.items.filter(item => item.lpnId === lpn.id).reduce((sum, item) => sum + parseFloat(item.qtyToPick || item.qty), 0) || 0;
    return { ...lpn, effectiveQty: parseFloat(lpn.qty) - inCart };
  }).filter(lpn => lpn.effectiveQty > 0);
  
  const totalAvailDisp = stockForDisp.reduce((sum, item) => sum + item.effectiveQty, 0);

  const addReceiveLine = () => {
    if (!lineItem.sku || !lineItem.qty || !lineItem.location_id) return;
    const itemWithClient = { ...lineItem, desc: selSku.desc };
    if (!is3PLMode) itemWithClient.client_id = 'PROPIO';
    addLineToDoc(itemWithClient);
  };

  const handleBarcodeSubmit = async (barcode) => {
    if (!barcode.trim()) return;
    setIsScanning(true);
    try {
      const res = await apiFetch(`${host}/api/skus/barcode/${encodeURIComponent(barcode.trim())}`);
      const data = await res.json();
      if (data.found) {
        if (docClient && (data.sku.client_id || '') !== docClient) {
          showMsg(`⛔ El SKU ${data.sku.sku} no pertenece al cliente del documento`, true);
        } else {
          setLineItem(prev => ({ ...prev, sku: data.sku.sku }));
          showMsg(`✅ SKU encontrado: ${data.sku.sku} — ${data.sku.desc}`);
        }
      } else {
        // Buscar por SKU directo si no hay barcode (acotado al cliente del documento)
        const bySku = docSkus.find(s => s.sku === barcode.trim().toUpperCase());
        if (bySku) { setLineItem(prev => ({ ...prev, sku: bySku.sku })); showMsg(`✅ SKU: ${bySku.sku}`); }
        else showMsg(`⚠️ Código "${barcode}" no encontrado para este cliente`, true);
      }
    } catch(e) { showMsg('⛔ Error al buscar código', true); }
    finally { setIsScanning(false); setBarcodeInput(''); }
  };
  const handleLpnQtyChange = (lpnId, valStr, maxQty) => { const val = parseFloat(valStr) || 0; setLineItem(prev => ({ ...prev, selectedLpns: { ...prev.selectedLpns, [lpnId]: Math.min(val, maxQty) } })); };

  const addDispatchLineManual = async () => {
    const newItems = Object.entries(lineItem.selectedLpns).filter(([_, qty]) => qty > 0).map(([lpnId, qty]) => {
        const lpn = docInventory.find(i => i.id === lpnId);
        return { sku: lpn.sku, desc: lpn.desc, lpnId, location: lpn.location_id, qtyToPick: qty, serial: lpn.serial_number };
    });
    if (newItems.length === 0) return;
    const isValid = await validateRealTimeStock(newItems);
    if (!isValid) { fetchData(); return; }
    setWorkspaces(prev => ({ ...prev, dispatch: prev.dispatch.map(d => d.id === activeDocId ? { ...d, items: [...d.items, ...newItems] } : d) }));
    setLineItem({ sku: lineItem.sku, qty: '', batch: '', expDate: '', serial: '', location_id: 'PISO-RECEPCION', action: 'ADD', selectedLpns: {} });
  };

  const handleAddAutoOutboundItem = async () => {
    let remaining = parseFloat(outboundAutoQty);
    if (!remaining || remaining <= 0) return;
    if (remaining > totalAvailDisp) return showMsg('❌ Cantidad supera el stock APTO', true);
    const newItems = [];
    const sortedStock = [...stockForDisp].reverse(); 
    for (const lpn of sortedStock) {
      if (remaining <= 0) break;
      const avail = lpn.effectiveQty;
      if (avail <= 0) continue;
      const take = Math.min(avail, remaining);
      newItems.push({ sku: lpn.sku, desc: lpn.desc, lpnId: lpn.id, location: lpn.location_id, qtyToPick: take, serial: lpn.serial_number });
      remaining -= take;
    }
    const isValid = await validateRealTimeStock(newItems);
    if (!isValid) { fetchData(); return; }
    setWorkspaces(prev => ({ ...prev, dispatch: prev.dispatch.map(d => d.id === activeDocId ? { ...d, items: [...d.items, ...newItems] } : d) }));
    setLineItem({ sku: lineItem.sku, qty: '', batch: '', expDate: '', serial: '', location_id: 'PISO-RECEPCION', action: 'ADD', selectedLpns: {} });
    setOutboundAutoQty(''); setOutboundMethod('AUTO'); 
  };

  const addAdjustLine = () => { if (!lineItem.sku || !lineItem.qty) return; addLineToDoc({ ...lineItem, desc: selSku.desc }); };

  const filteredRelData = permittedInventory.filter(i => {
    const term = relSearchTerm.toLowerCase();
    return i.id.toLowerCase().includes(term) || i.sku.toLowerCase().includes(term) || (i.location_id || '').toLowerCase().includes(term);
  });
  
  const filteredSkusList = useMemo(() => permittedSkus.filter(s => {
    const term = skuSearchTerm.toLowerCase();
    const matchesSearch = !term || s.sku.toLowerCase().includes(term) || (s.desc || '').toLowerCase().includes(term) || (s.barcode && s.barcode.includes(term));
    const matchesClient = skuClientFilter ? (s.client_id || '') === skuClientFilter : true;
    const matchesCategory = skuCategoryFilter ? (s.category || '').toLowerCase().includes(skuCategoryFilter.toLowerCase()) : true;
    const matchesAbc = skuAbcFilter ? (s.abc_class || '') === skuAbcFilter : true;
    return matchesSearch && matchesClient && matchesCategory && matchesAbc;
  }), [permittedSkus, skuSearchTerm, skuClientFilter, skuCategoryFilter, skuAbcFilter]);
  
  const filteredLocs = safeLocs.filter(l => {
    const term = locSearchTerm.toLowerCase();
    if (term && !l.location_id.toLowerCase().includes(term) && !(l.zone_code || '').toLowerCase().includes(term)) return false;
    if (whZoneFilter && (l.zone_code || '') !== whZoneFilter) return false;
    if (whBodegaFilter && !l.location_id.startsWith(whBodegaFilter)) return false;
    return true;
  });
  // MEJORA 4: Estadísticas por zona
  const locZoneStats = useMemo(() => {
    const stats = {};
    const safeInv = Array.isArray(data) ? data : [];
    safeLocs.forEach(l => {
      const z = l.zone_code || 'SIN ZONA';
      if (!stats[z]) stats[z] = { total: 0, occupied: 0, blocked: 0 };
      stats[z].total++;
      const hasStock = safeInv.some(i => i.location_id === l.location_id && parseFloat(i.qty) > 0);
      if (hasStock) stats[z].occupied++;
      const hasBlocked = safeInv.some(i => i.location_id === l.location_id && parseFloat(i.qty) > 0 && i.status && i.status !== 'DISPONIBLE');
      if (hasBlocked) stats[z].blocked++;
    });
    return stats;
  }, [safeLocs, data]);
  // MEJORA 7: Mapa de calor por ubicación
  const locHeatMap = useMemo(() => {
    const map = {};
    const safeInv = Array.isArray(data) ? data : [];
    safeInv.forEach(i => {
      if (parseFloat(i.qty) > 0) {
        const current = map[i.location_id];
        if (i.status && i.status !== 'DISPONIBLE') map[i.location_id] = 'blocked';
        else if (current !== 'blocked') map[i.location_id] = 'stock';
      }
    });
    return map;
  }, [data]);

  const filteredInventory = useMemo(() => permittedInventory.filter(i => {
    const term = invSearchTerm.toLowerCase();
    const matchesSearch = !term || i.id.toLowerCase().includes(term) || i.sku.toLowerCase().includes(term) || (i.location_id || '').toLowerCase().includes(term);
    const matchesStatus = invStatusFilter ? (i.status || 'DISPONIBLE') === invStatusFilter : true;
    const matchesClient = invClientFilter ? (i.client_id || '') === invClientFilter : true;
    const matchesSku = invSkuFilter ? i.sku === invSkuFilter : true;
    const matchesLoc = invLocFilter ? (i.location_id || '').toLowerCase().includes(invLocFilter.toLowerCase()) : true;
    return matchesSearch && matchesStatus && matchesClient && matchesSku && matchesLoc;
  }), [permittedInventory, invSearchTerm, invStatusFilter, invClientFilter, invSkuFilter, invLocFilter]);

  const filteredAudit = useMemo(() => auditLogs.filter(log => {
    const matchesType = auditTypeFilter ? log.type === auditTypeFilter : true;
    const matchesUser = auditUserFilter ? (log.username || '').toLowerCase().includes(auditUserFilter.toLowerCase()) : true;
    const matchesDateFrom = auditDateFrom ? new Date(log.created_at) >= new Date(auditDateFrom) : true;
    const matchesDateTo = auditDateTo ? new Date(log.created_at) <= new Date(auditDateTo + 'T23:59:59') : true;
    return matchesType && matchesUser && matchesDateFrom && matchesDateTo;
  }), [auditLogs, auditTypeFilter, auditUserFilter, auditDateFrom, auditDateTo]);

  // PREPARACIÓN DE DATOS PARA LOS NUEVOS GRÁFICOS
  const clientOccupancyMap = {};
  if (is3PLMode) {
    // En 3PL/HYBRID: agrupar por cliente
    permittedInventory.forEach(item => {
      const ownerId = permittedSkus.find(s => s.sku === item.sku)?.client_id || item.client_id || 'PROPIO/GENERAL';
      const ownerName = clients.find(c => c.id === ownerId)?.name || ownerId;
      if (!clientOccupancyMap[ownerName]) clientOccupancyMap[ownerName] = 0;
      clientOccupancyMap[ownerName] += parseFloat(item.qty) || 0;
    });
  } else {
    // En modo PROPIO: agrupar por estado del LPN
    permittedInventory.forEach(item => {
      const statusLabel = item.status || 'DISPONIBLE';
      if (!clientOccupancyMap[statusLabel]) clientOccupancyMap[statusLabel] = 0;
      clientOccupancyMap[statusLabel] += parseFloat(item.qty) || 0;
    });
  }
  const occTotal = Object.values(clientOccupancyMap).reduce((a,b)=>a+b,0);
  const occData = Object.entries(clientOccupancyMap).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([label, value]) => ({label, value, pct: occTotal > 0 ? ((value/occTotal)*100).toFixed(1) : '0.0'}));
  const occColors = ['#6366f1', '#10b981', '#f59e0b', '#a855f7', '#ec4899'];

  const flowData = [];
  const maxDays = 7;
  for(let i=maxDays-1; i>=0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayLogs = auditLogs.filter(log => {
      if(!log.created_at) return false;
      const logDate = new Date(log.created_at);
      return logDate.getFullYear() === d.getFullYear() && logDate.getMonth() === d.getMonth() && logDate.getDate() === d.getDate();
    });
    const inQty = dayLogs.filter(l => l.type === 'INBOUND' || l.type === 'ADJUST_IN').reduce((sum, l) => sum + parseFloat(l.qty), 0);
    const outQty = dayLogs.filter(l => l.type === 'OUTBOUND' || l.type === 'ADJUST_OUT').reduce((sum, l) => sum + parseFloat(l.qty), 0);
    flowData.push({ date: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth()+1).padStart(2, '0')}`, inQty, outQty });
  }
  const maxFlow = Math.max(...flowData.flatMap(d => [d.inQty, d.outQty, 1]));

  const handlePrintLabel = (lpn) => {
    setPrintLabelData(lpn);
    setTimeout(() => {
      window.print();
    }, 100);
  };

  // HANDLERS TRANSPORTE
  const handleSaveCarrier = async (e) => {
    e.preventDefault();
    try {
      const method = carrierForm.id ? 'PUT' : 'POST';
      const url = carrierForm.id ? `${host}/api/carriers/${carrierForm.id}` : `${host}/api/carriers`;
      const res = await apiFetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(carrierForm) });
      if (res.ok) { showMsg('✅ Transportista guardado'); setCarrierForm({ id:'', name:'', rut:'', contact:'', phone:'', email:'' }); fetchData(); }
      else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
    } catch(e) { showMsg('⛔ Error de red', true); }
  };
  const handleSaveShipment = async (e) => {
    e.preventDefault();
    try {
      const shipPayload = { ...shipmentForm, username: currentUser.username };
      if ((!is3PLMode || isHybridMode) && !shipPayload.client_id) shipPayload.client_id = systemConfig.own_client_id || 'PROPIO';
      const res = await apiFetch(`${host}/api/shipments`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(shipPayload) });
      if (res.ok) { showMsg('✅ Envío creado'); setShipmentForm({ carrier_id:'', doc_num:'', client_id:'', destination:'', notes:'' }); fetchData(); }
      else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
    } catch(e) { showMsg('⛔ Error de red', true); }
  };
  const handleShipmentStatus = async (id, status) => {
    try {
      const res = await apiFetch(`${host}/api/shipments/${id}/status`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status, username: currentUser.username }) });
      if (res.ok) { showMsg('✅ Estado actualizado'); fetchData(); }
      else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
    } catch(e) { showMsg('⛔ Error de red', true); }
  };

  // HANDLERS API KEYS
  const handleGenerateKey = async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch(`${host}/api/keys`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: newKeyName, client_id: newKeyClient||null, permissions: newKeyPerms }) });
      if (res.ok) { const d = await res.json(); setGeneratedKey(d.raw_key); setNewKeyName(''); setNewKeyClient(''); setNewKeyPerms('read'); fetchData(); }
      else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
    } catch(e) { showMsg('⛔ Error de red', true); }
  };
  const handleRevokeKey = async (id) => {
    if (!(await confirm({ message: '¿Revocar esta API key?', danger: true }))) return;
    try {
      const res = await apiFetch(`${host}/api/keys/${id}`, { method:'DELETE' });
      if (res.ok) { showMsg('✅ Key revocada'); fetchData(); }
    } catch(e) { showMsg('⛔ Error de red', true); }
  };

  // HANDLERS PORTAL
  const handlePortalLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${host}/api/portal/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(portalLoginForm) });
      const d = await res.json();
      if (res.ok) { localStorage.setItem('wms_portal_token', d.token); setPortalUser(d); }
      else setPortalLoginError(d.error || 'Credenciales incorrectas');
    } catch(e) { setPortalLoginError('Error de conexión'); }
  };
  const handlePortalSaveConfig = async (clientId) => {
    try {
      const res = await apiFetch(`${host}/api/clients/${clientId}/portal`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(portalConfigForm) });
      if (res.ok) { showMsg('✅ Configuración portal guardada'); setPortalConfigClient(null); fetchData(); }
      else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
    } catch(e) { showMsg('⛔ Error de red', true); }
  };

  // HANDLERS KITTING BUILD
  const handleCheckKitAvailability = async () => {
    const buildClientId = (!is3PLMode || (isHybridMode && !kitBuildForm.client_id)) ? (systemConfig.own_client_id || 'PROPIO') : kitBuildForm.client_id;
    if (!kitBuildForm.kit_sku || !buildClientId) return showMsg('⛔ Selecciona un Kit', true);
    try {
      const res = await apiFetch(`${host}/api/kit-availability?kit_sku=${encodeURIComponent(kitBuildForm.kit_sku)}&client_id=${encodeURIComponent(buildClientId)}&qty=${kitBuildForm.qty}`);
      if (res.ok) setKitAvailability(await res.json());
      else showMsg('⛔ No se pudo verificar disponibilidad', true);
    } catch(e) { showMsg('⛔ Error de red', true); }
  };
  const handleBuildKit = async () => {
    if (!kitAvailability?.can_build) return;
    if (!(await confirm({ message: `¿Armar ${kitBuildForm.qty} unidades de ${kitBuildForm.kit_sku}?`, danger: true }))) return;
    try {
      const buildPayload = { ...kitBuildForm, username: currentUser.username };
      if ((!is3PLMode || isHybridMode) && !buildPayload.client_id) buildPayload.client_id = systemConfig.own_client_id || 'PROPIO';
      const res = await apiFetch(`${host}/api/kit-build`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(buildPayload) });
      if (res.ok) { const d = await res.json(); showMsg(`✅ Kit armado — LPN: ${d.lpn}`); setKitBuildForm({ kit_sku:'', client_id:'', qty:1, location:'PISO-RECEPCION' }); setKitAvailability(null); fetchData(); }
      else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
    } catch(e) { showMsg('⛔ Error de red', true); }
  };

  const handleCheckKitDispatchAvail = async () => {
    const dispClientId = (!is3PLMode || (isHybridMode && !kitDispatchForm.client_id)) ? (systemConfig.own_client_id || 'PROPIO') : kitDispatchForm.client_id;
    if (!kitDispatchForm.kit_sku || !dispClientId) return showMsg('⛔ Selecciona un Kit', true);
    try {
      const r = await apiFetch(`${host}/api/kit-availability?kit_sku=${encodeURIComponent(kitDispatchForm.kit_sku)}&client_id=${encodeURIComponent(dispClientId)}&qty=${kitDispatchForm.qty}`);
      if (r.ok) setKitDispatchAvail(await r.json());
      else showMsg('⛔ No se pudo verificar disponibilidad', true);
    } catch(e) { showMsg('⛔ Error de red', true); }
  };

  const handleDirectKitDispatch = async () => {
    if (!kitDispatchAvail?.can_build) return;
    if (!(await confirm({ message: `¿Despachar directamente ${kitDispatchForm.qty}x ${kitDispatchForm.kit_sku}? Se consumirán los componentes ahora.`, danger: true }))) return;
    try {
      const dispPayload = { ...kitDispatchForm, username: currentUser.username };
      if ((!is3PLMode || isHybridMode) && !dispPayload.client_id) dispPayload.client_id = systemConfig.own_client_id || 'PROPIO';
      const r = await apiFetch(`${host}/api/kits/direct-dispatch`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(dispPayload) });
      if (r.ok) {
        const d = await r.json();
        showMsg(`✅ Despacho directo completado — Orden: ${d.order_id}`);
        setKitDispatchForm({ kit_sku:'', client_id:'', qty:1, doc_num:'', glosa:'' });
        setKitDispatchAvail(null);
        fetchData();
      } else { const err = await r.json(); showMsg(`⛔ ${err.error}`, true); }
    } catch(e) { showMsg('⛔ Error de red', true); }
  };

  // VISTA MANTENIMIENTO (si está activo y no es superadmin)
  if (maintenanceMode && currentUser && currentUser.role !== 'SUPERADMIN') {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4">
        <GlobalStyles />
        <div className="bg-white p-10 rounded-3xl shadow-2xl w-full max-w-md text-center animate-in zoom-in-95">
          <div className="p-4 bg-red-100 rounded-full w-fit mx-auto mb-6"><ShieldAlert className="w-12 h-12 text-red-600"/></div>
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter mb-2">Sistema en Mantenimiento</h1>
          <p className="text-slate-500 font-medium mb-6">{maintenanceMessage || 'El sistema está temporalmente fuera de servicio.'}</p>
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Por favor, intente más tarde</p>
          </div>
          <button onClick={handleLogout} className="mt-6 text-[10px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest transition-colors">Cerrar Sesión</button>
        </div>
      </div>
    );
  }

  // VISTA PORTAL 3PL
  if (isPortalMode) {
    const portalLogout = () => { localStorage.removeItem('wms_portal_token'); localStorage.removeItem('wms_portal_user'); window.location.reload(); };
    const portalFetch = (url) => fetch(url, { headers: { 'X-Portal-Token': localStorage.getItem('wms_portal_token')||'' } });
    const loadPortalData = async (clientId, skuFilter) => {
      try {
        const invUrl = skuFilter
          ? `${host}/api/portal/inventory/${clientId}?sku=${encodeURIComponent(skuFilter)}`
          : `${host}/api/portal/inventory/${clientId}`;
        const [rI, rM, rR] = await Promise.all([
          portalFetch(invUrl),
          portalFetch(`${host}/api/portal/movements/${clientId}`),
          portalFetch(`${host}/api/portal/reports/${clientId}`),
        ]);
        if (rI.ok) { const d = await rI.json(); setPortalInv(d.inventory ?? d); }
        if (rM.ok) setPortalMovements(await rM.json());
        if (rR.ok) setPortalReports(await rR.json());
      } catch(e) {}
    };
    if (!portalUser || !localStorage.getItem('wms_portal_token')) {
      return (
        <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4">
          <GlobalStyles />
          <div className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-sm animate-in zoom-in-95">
            <div className="flex items-center mb-8"><Box className="w-10 h-10 text-indigo-600 mr-3"/><h1 className="text-2xl font-black tracking-tighter text-slate-800">Portal <span className="text-indigo-600">3PL</span></h1></div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6">Acceso exclusivo para clientes</p>
            {portalLoginError && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-xs font-bold mb-4 border border-red-200">{portalLoginError}</div>}
            <form onSubmit={handlePortalLogin} className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ID de Cliente</label>
                <input type="text" required value={portalLoginForm.client_id} onChange={e=>setPortalLoginForm({...portalLoginForm,client_id:e.target.value.toUpperCase()})} className="w-full mt-1 border-2 border-slate-200 rounded-xl px-4 py-3 font-black outline-none focus:border-indigo-500 uppercase" placeholder="Ej: CLI-001"/>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Contraseña</label>
                <input type="password" required value={portalLoginForm.password} onChange={e=>setPortalLoginForm({...portalLoginForm,password:e.target.value})} className="w-full mt-1 border-2 border-slate-200 rounded-xl px-4 py-3 font-bold outline-none focus:border-indigo-500"/>
              </div>
              <button type="submit" className="w-full bg-indigo-600 text-white font-black py-4 rounded-xl shadow-lg shadow-indigo-200 uppercase text-xs tracking-widest hover:bg-indigo-700 transition-colors mt-4">Ingresar al Portal</button>
            </form>
          </div>
        </div>
      );
    }
    // Dashboard portal
    if (portalInv.length === 0 && portalUser?.client_id) { loadPortalData(portalUser.client_id); }
    const portalCsvExport = () => {
      const rows = [['SKU','Descripción','LPN','Lote','Ubicación','Estado','Cantidad']].concat(portalInv.map(i=>[i.sku,i.desc||'',i.lpn||'',i.lot_number||'',i.location_id||'',i.status||'DISPONIBLE',i.qty]));
      const csv = rows.map(r=>r.join(',')).join('\n');
      const a = document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv); a.download=`inventario-${portalUser.client_id}-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    };
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <GlobalStyles />
        <header className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shadow-lg">
          <div className="flex items-center"><Box className="w-7 h-7 text-indigo-400 mr-2"/><span className="font-black tracking-tighter text-lg">Portal <span className="text-indigo-400">3PL</span></span><span className="ml-3 text-[10px] font-black bg-indigo-600 px-2 py-1 rounded-full uppercase">{portalUser.client_id}</span></div>
          <button onClick={portalLogout} className="text-[10px] font-black text-slate-400 hover:text-red-400 uppercase tracking-widest transition-colors">Cerrar Sesión</button>
        </header>
        <div className="flex gap-1 px-6 pt-4 border-b border-slate-200 bg-white">
          {[['inventory','Inventario'],['movements','Movimientos'],['reports','Reportes']].map(([id,label])=>(
            <button key={id} onClick={()=>setPortalTab(id)} className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-t-xl transition-colors ${portalTab===id?'bg-indigo-600 text-white':'text-slate-500 hover:text-slate-800'}`}>{label}</button>
          ))}
        </div>
        <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
          {portalTab === 'inventory' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="flex justify-between items-center flex-wrap gap-2">
                <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Inventario Actual</h2>
                <div className="flex gap-2 items-center flex-wrap">
                  <input
                    type="text"
                    placeholder="Buscar SKU..."
                    value={portalSkuFilter}
                    onChange={e => setPortalSkuFilter(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && loadPortalData(portalUser.client_id, portalSkuFilter)}
                    className="border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-400 w-40"
                  />
                  <button onClick={()=>loadPortalData(portalUser.client_id, portalSkuFilter)} className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2"><RefreshCcw size={12}/> Actualizar</button>
                  <button onClick={portalCsvExport} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2"><FileText size={12}/> Exportar CSV</button>
                </div>
              </div>
              {portalReports && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5"><p className="text-[10px] font-black text-slate-400 uppercase">Unidades Totales</p><p className="text-3xl font-black text-slate-800 mt-1">{Number(portalReports.total_units||0).toLocaleString()}</p></div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-5"><p className="text-[10px] font-black text-slate-400 uppercase">LPNs Activos</p><p className="text-3xl font-black text-slate-800 mt-1">{Number(portalReports.total_lpns||0).toLocaleString()}</p></div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-5"><p className="text-[10px] font-black text-slate-400 uppercase">SKUs Distintos</p><p className="text-3xl font-black text-slate-800 mt-1">{Number(portalReports.total_skus||0).toLocaleString()}</p></div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-5"><p className="text-[10px] font-black text-slate-400 uppercase">Recepciones (30d)</p><p className="text-3xl font-black text-slate-800 mt-1">{Number(portalReports.receipts_30d||0).toLocaleString()}</p></div>
                </div>
              )}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b"><tr><th className="p-4 text-[10px] font-black text-slate-400 uppercase">SKU</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Descripción</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">LPN</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Lote</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Ubicación</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Estado</th><th className="p-4 text-right text-[10px] font-black text-slate-400 uppercase">Qty</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {portalInv.map((i,idx)=>(
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="p-4 font-black text-xs uppercase text-indigo-700">{i.sku}</td>
                        <td className="p-4 text-xs text-slate-600">{i.desc}</td>
                        <td className="p-4 font-mono text-[10px] text-slate-500">{i.lpn}</td>
                        <td className="p-4 text-[10px] text-slate-400">{i.lot_number||'—'}</td>
                        <td className="p-4"><span className="bg-slate-100 px-2 py-1 rounded-lg font-mono text-[10px] font-bold text-slate-700">{i.location_id||'—'}</span></td>
                        <td className="p-4"><span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[9px] font-black uppercase">{i.status||'DISPONIBLE'}</span></td>
                        <td className="p-4 text-right font-black text-slate-800">{i.qty}</td>
                      </tr>
                    ))}
                    {portalInv.length===0 && <tr><td colSpan="7" className="p-8 text-center text-slate-400 text-xs">Sin inventario disponible</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {portalTab === 'movements' && (
            <div className="space-y-4 animate-in fade-in">
              <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Últimos Movimientos</h2>
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b"><tr><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Fecha</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Tipo</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">SKU</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Documento</th><th className="p-4 text-right text-[10px] font-black text-slate-400 uppercase">Qty</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {portalMovements.map((m,i)=>(
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="p-4 text-[10px] text-slate-400">{new Date(m.created_at).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})}</td>
                        <td className="p-4"><span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${m.movement_type==='INBOUND'?'bg-emerald-100 text-emerald-700':'bg-orange-100 text-orange-700'}`}>{m.movement_type}</span></td>
                        <td className="p-4 font-black text-xs uppercase text-slate-700">{m.sku}</td>
                        <td className="p-4 text-xs text-slate-500">{m.doc_num||'—'}</td>
                        <td className="p-4 text-right font-black text-slate-800">{m.qty}</td>
                      </tr>
                    ))}
                    {portalMovements.length===0 && <tr><td colSpan="5" className="p-8 text-center text-slate-400 text-xs">Sin movimientos recientes</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {portalTab === 'reports' && portalReports && (
            <div className="space-y-6 animate-in fade-in">
              <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Reporte de Actividad</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl border border-slate-200 p-5"><p className="text-[10px] font-black text-slate-400 uppercase">Unidades Totales</p><p className="text-4xl font-black text-indigo-700 mt-1">{Number(portalReports.total_units||0).toLocaleString()}</p></div>
                <div className="bg-white rounded-2xl border border-slate-200 p-5"><p className="text-[10px] font-black text-slate-400 uppercase">LPNs Activos</p><p className="text-4xl font-black text-slate-800 mt-1">{Number(portalReports.total_lpns||0).toLocaleString()}</p></div>
                <div className="bg-white rounded-2xl border border-slate-200 p-5"><p className="text-[10px] font-black text-slate-400 uppercase">SKUs Distintos</p><p className="text-4xl font-black text-slate-800 mt-1">{Number(portalReports.total_skus||0).toLocaleString()}</p></div>
                <div className="bg-white rounded-2xl border border-slate-200 p-5"><p className="text-[10px] font-black text-slate-400 uppercase">Recepciones 30d</p><p className="text-4xl font-black text-slate-800 mt-1">{Number(portalReports.receipts_30d||0).toLocaleString()}</p></div>
              </div>
              {(portalReports.top_skus||[]).length > 0 && (
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
                  <h3 className="text-sm font-black text-slate-700 uppercase tracking-tighter mb-4">Top SKUs por Unidades</h3>
                  <div className="space-y-3">
                    {portalReports.top_skus.map(s=>(
                      <div key={s.sku} className="flex items-center gap-4">
                        <span className="text-xs font-black text-slate-700 uppercase w-32 truncate">{s.sku}</span>
                        <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden"><div className="bg-indigo-500 h-full rounded-full transition-all" style={{width:`${Math.min(100, (s.total/portalReports.top_skus[0].total)*100)}%`}}/></div>
                        <span className="text-xs font-black text-slate-600 w-16 text-right">{Number(s.total).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    );
  }

  // VISTA LOGIN
  if (!currentUser) {
    // Sandbox — pantalla completa de selección de escenario
    if (showSandbox) {
      return (
        <>
          <GlobalStyles />
          <SandboxLauncher host={host} onLogin={(user) => { setCurrentUser(user); setShowSandboxWelcome(true); }} showMsg={(t,e) => showMsg(t,e)} />
        </>
      );
    }
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4">
        <GlobalStyles />
        <div className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-sm animate-in zoom-in-95">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center">
              <Box className="w-10 h-10 text-indigo-600 mr-3" />
              <h1 className="text-3xl font-black tracking-tighter text-slate-800 uppercase">{systemConfig.company_name || 'WMS Enterprise'}</h1>
            </div>
            <button onClick={()=>setShowNetworkSettings(!showNetworkSettings)} className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"><Settings2 size={18}/></button>
          </div>

          {showNetworkSettings && (
             <div className="mb-6 p-4 bg-slate-50 rounded-xl border-2 border-indigo-100 animate-in slide-in-from-top-2">
                <p className="text-[10px] font-black text-indigo-600 uppercase mb-2 flex items-center"><Globe size={10} className="mr-1"/> Servidor Externo / Túnel</p>
                <input type="text" value={customHost} onChange={e=>setCustomHost(e.target.value)} placeholder="Ej: http://tu-api.ngrok.app" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-indigo-500" />
                <p className="text-[8px] text-slate-400 mt-2">Deja en blanco para usar red local.</p>
             </div>
          )}

          {preLoginMaintenance.active && (
            <div className="bg-red-50 border-2 border-red-200 text-red-700 p-4 rounded-2xl mb-5 animate-in slide-in-from-top-2">
              <p className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2 mb-1">
                <ShieldAlert size={14}/> Sistema en mantenimiento
              </p>
              <p className="text-xs font-bold">{preLoginMaintenance.message}</p>
              <p className="text-[10px] font-bold text-red-500 mt-2">Solo los SUPERADMIN podrán acceder.</p>
            </div>
          )}
          {msg && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-xs font-bold mb-4 text-center border border-red-200">{msg.text}</div>}
          {/* SANDBOX DEMO */}
          <div className="mb-6 border-b border-slate-100 pb-6">
            <button onClick={() => setShowSandbox(true)}
              className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-2xl px-5 py-4 text-left transition-all shadow-lg shadow-amber-200/50 hover:shadow-amber-300/60 hover:scale-[1.01] active:scale-[0.99] group">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🎮</span>
                  <div>
                    <p className="text-sm font-black uppercase tracking-tight">Sandbox Interactivo</p>
                    <p className="text-[10px] font-medium text-white/80 mt-0.5">Explora el WMS completo sin crear cuenta</p>
                  </div>
                </div>
                <div className="bg-white/20 rounded-full w-8 h-8 flex items-center justify-center group-hover:bg-white/30 transition-colors">
                  <Play size={14}/>
                </div>
              </div>
            </button>
          </div>

          <form onSubmit={handleLogin} method="post" action="javascript:void(0)" className="space-y-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Usuario</label>
              <input type="text" required value={loginForm.username} onChange={e=>setLoginForm({...loginForm, username: e.target.value.toLowerCase().trim()})} className="w-full mt-1 border-2 border-slate-200 rounded-xl px-4 py-3 font-bold outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Contraseña</label>
              <div className="relative mt-1">
                <input type={showPassword ? "text" : "password"} required value={loginForm.password} onChange={e=>setLoginForm({...loginForm, password: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 font-bold outline-none focus:border-indigo-500 pr-12" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600 transition-colors">
                  {showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}
                </button>
              </div>
            </div>
            <button type="submit" disabled={isLoggingIn} className="w-full bg-indigo-600 text-white font-black py-4 rounded-xl shadow-lg shadow-indigo-200 uppercase text-xs tracking-widest hover:bg-indigo-700 transition-colors mt-6 flex justify-center items-center disabled:opacity-50">
              {isLoggingIn ? <Loader2 size={16} className="animate-spin"/> : 'Iniciar Sesión'}
            </button>
          </form>
          <p className="text-center text-[10px] text-slate-400 mt-6 font-bold uppercase tracking-widest">V8.25 - SISTEMA COMPLETADO</p>
        </div>
      </div>
    );
  }

  // VISTA PRINCIPAL
  return (
    <>
      <GlobalStyles />
      {/* MODAL DE CARGA MASIVA (editable + validación + duplicados) — los 5 flujos */}
      {importModal && (
        <BulkImportModal
          type={importModal.type}
          host={host}
          currentUser={currentUser}
          skus={skus}
          extraParams={importModal.extraParams || {}}
          onClose={() => setImportModal(null)}
          onSuccess={() => { fetchData(); }}
        />
      )}
      {/* PASO 4 — Modal de re-autenticación (step-up) para recepción/despacho */}
      {reauthPrompt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-base font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><ShieldAlert size={18} className="text-amber-500"/> Confirmar {reauthPrompt.label}</h3>
            <p className="text-xs text-slate-500 mt-1">Por seguridad, reingresa tu contraseña para autorizar esta operación.</p>
            <form onSubmit={(e) => { e.preventDefault(); const pw = e.target.elements.reauthpw.value; reauthPrompt.resolve(pw); setReauthPrompt(null); }}>
              <input name="reauthpw" type="password" autoFocus autoComplete="current-password" className="w-full mt-4 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500" placeholder="Tu contraseña"/>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => { reauthPrompt.resolve(null); setReauthPrompt(null); }} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black py-3 rounded-xl uppercase text-[10px] tracking-widest">Cancelar</button>
                <button type="submit" className="flex-[2] bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 rounded-xl uppercase text-[10px] tracking-widest">Confirmar</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {confirmDialog && (
        <ConfirmModal
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          danger={confirmDialog.danger}
          onConfirm={confirmDialog.onConfirm}
          onClose={closeConfirm}
        />
      )}

      {/* SECCIÓN OCULTA PARA IMPRESIÓN (Solo visible al imprimir) */}
      <div id="print-section" className="hidden">
        {printLabelData && (
          <div className="w-[10cm] h-[10cm] p-4 flex flex-col justify-center items-center bg-white border-2 border-black rounded-xl">
            <h1 className="text-4xl font-black uppercase text-black mb-2 tracking-tighter">{printLabelData.sku}</h1>
            <p className="text-lg font-bold text-gray-700 mb-1 text-center truncate w-full">{printLabelData.desc || 'ARTÍCULO SIN DESCRIPCIÓN'}</p>
            <div className="w-full border-t-2 border-dashed border-gray-400 my-4"></div>
            <div className="w-full flex justify-between items-center mb-2 px-2">
              <span className="text-sm font-bold text-gray-500 uppercase tracking-widest">CANTIDAD</span>
              <span className="text-3xl font-black text-black">{printLabelData.qty} {printLabelData.uom || 'UN'}</span>
            </div>
            <div className="w-full flex justify-between items-center px-2 mb-4">
              <span className="text-sm font-bold text-gray-500 uppercase tracking-widest">LPN FÍSICO</span>
              <span className="text-xl font-mono font-black text-black bg-gray-100 px-2 py-1 rounded">{printLabelData.id}</span>
            </div>
            {(printLabelData.batch_number || printLabelData.serial_number) && (
              <div className="w-full flex flex-col gap-1 items-center bg-gray-100 p-2 rounded-lg border border-gray-300">
                 {printLabelData.batch_number && <span className="text-sm font-bold uppercase">Lote: {printLabelData.batch_number} {printLabelData.expiry_date ? `| Venc: ${printLabelData.expiry_date}` : ''}</span>}
                 {printLabelData.serial_number && <span className="text-sm font-bold uppercase tracking-widest">SN: {printLabelData.serial_number}</span>}
              </div>
            )}
            <div className="mt-auto w-full text-center">
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">WMS ENTERPRISE - ETIQUETA LOGÍSTICA</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden">

        {/* OVERLAY MOBILE — cierra sidebar al tocar fuera */}
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        {/* PANEL DE NOTIFICACIONES */}
        {showNotifPanel && (
          <div className="fixed inset-y-0 right-0 z-50 w-80 bg-white shadow-2xl flex flex-col border-l border-slate-200">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <h2 className="font-black text-slate-800 uppercase text-sm tracking-tighter flex items-center gap-2"><Bell size={16} className="text-indigo-500"/> Notificaciones {notifCount > 0 && <span className="bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">{notifCount}</span>}</h2>
              <div className="flex gap-2 items-center">
                {notifCount > 0 && <button onClick={async()=>{ await apiFetch(`${host}/api/notifications/read-all`,{method:'PUT'}); setNotifications(prev=>prev.map(n=>({...n,read:true}))); setNotifCount(0); }} className="text-[10px] font-black text-indigo-500 uppercase hover:underline">Marcar todas</button>}
                <button onClick={()=>setShowNotifPanel(false)} className="p-1 hover:bg-slate-100 rounded-lg"><X size={14} className="text-slate-400"/></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-slate-400"><Bell className="w-10 h-10 mx-auto mb-3 opacity-20"/><p className="text-xs font-bold uppercase tracking-widest">Sin notificaciones</p></div>
              ) : notifications.map(n => (
                <div key={n.id} onClick={async()=>{ if(n.read) return; await apiFetch(`${host}/api/notifications/${n.id}/read`,{method:'PUT'}); setNotifications(prev=>prev.map(x=>x.id===n.id?{...x,read:true}:x)); setNotifCount(c=>Math.max(0,c-1)); }} className={`p-4 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors ${n.read?'opacity-50':''}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 mt-1.5 rounded-full shrink-0 ${n.severity==='CRITICAL'?'bg-red-500':n.severity==='WARNING'?'bg-amber-500':'bg-blue-500'}`}/>
                    <div className="min-w-0">
                      <p className={`text-xs font-black truncate ${n.severity==='CRITICAL'?'text-red-700':n.severity==='WARNING'?'text-amber-700':'text-blue-700'}`}>{n.title}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">{n.message}</p>
                      <p className="text-[9px] text-slate-400 mt-1">{new Date(n.created_at).toLocaleDateString('es-CL')}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SIDEBAR LATERAL OSCURO */}
        <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 flex flex-col shrink-0 text-slate-300 transition-transform duration-300 md:relative md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="h-16 flex items-center px-6 border-b border-white/10 shrink-0">
            <Box className="w-6 h-6 mr-2 text-indigo-500" />
            <span className="text-lg font-black tracking-tight truncate uppercase text-white">{systemConfig.company_name || 'WMS Enterprise'}</span>
          </div>
          
          <div className="px-6 py-4 bg-slate-800/50 border-b border-white/5">
            <p className="text-[9px] uppercase font-black tracking-widest text-slate-500">Usuario Activo</p>
            <div className="flex items-center justify-between mt-1">
              <div>
                <p className="text-xs font-bold text-white truncate w-36">{currentUser.full_name}</p>
                <p className="text-[10px] text-indigo-400 font-mono mt-0.5 flex items-center gap-1">
                   {currentUser.role} 
                   {!isAllClients && <span className="bg-indigo-600 text-white px-1 py-0.5 rounded text-[8px]">(Restringido)</span>}
                </p>
              </div>
              <button onClick={handleLogout} className="text-slate-400 hover:text-red-400 transition-colors" title="Cerrar Sesión"><LogOut size={16}/></button>
            </div>
          </div>

          <div className="p-4 flex-1 overflow-y-auto custom-scrollbar space-y-1">
            {!['PICKER','CLIENTE'].includes(currentUser?.role) && (
              <>
                {/* ─── PRINCIPAL ─── */}
                <p className="text-[10px] font-black uppercase text-white/50 mb-3 px-2 tracking-widest">Principal</p>
                <button data-tutorial-target="dashboard-tab" onClick={() => switchTab('dashboard')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'dashboard' ? 'bg-indigo-600/20 text-indigo-400 font-black' : 'hover:bg-slate-800'}`}><LayoutDashboard size={18} className="mr-3"/> Dashboard</button>
                <button data-tutorial-target="inventory-tab" onClick={() => switchTab('inventory')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'inventory' ? 'bg-indigo-600/20 text-indigo-400 font-black' : 'hover:bg-slate-800'}`}><Package size={18} className="mr-3"/> Stock Físico</button>
                {canView('digital-twin') && <button onClick={() => switchTab('digital-twin')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'digital-twin' ? 'bg-indigo-600/20 text-indigo-400 font-black' : 'hover:bg-slate-800'}`}><Layers size={18} className="mr-3"/> Mapa 3D Bodega</button>}

                {/* ─── OPERACIONES DIARIAS ─── */}
                {(canView('receive') || canView('dispatch') || canView('relocate') || canView('change-status') || canView('adjust') || canView('returns')) && (<>
                  <div className="my-4 border-t border-slate-800"></div>
                  <p className="text-[10px] font-black uppercase text-white/50 mb-3 px-2 tracking-widest">Operaciones Diarias</p>
                  {canView('receive') && <button data-tutorial-target="receive-tab" onClick={() => switchTab('receive')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'receive' ? 'bg-emerald-500/20 text-emerald-400 font-black' : 'hover:bg-slate-800'}`}><ArrowDownRight size={18} className="mr-3"/> Recepciones (In)</button>}
                  {canView('dispatch') && (
                    <button data-tutorial-target="dispatch-tab" onClick={() => switchTab('dispatch')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'dispatch' ? 'bg-blue-500/20 text-blue-400 font-black' : 'hover:bg-slate-800'}`}>
                      <ArrowUpRight size={18} className="mr-3"/> Despachos (Out)
                      {dispatchKpis?.pending_orders > 0 && (
                        <span className="ml-auto bg-red-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full">{dispatchKpis.pending_orders}</span>
                      )}
                    </button>
                  )}
                  {canView('relocate') && (
                    <button data-tutorial-target="relocate-tab" onClick={() => switchTab('relocate')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'relocate' ? 'bg-purple-500/20 text-purple-400 font-black' : 'hover:bg-slate-800'}`}>
                      <ArrowRightLeft size={18} className="mr-3"/> Reubicar Stock
                      {relocRequests.filter(r=>r.status==='PENDIENTE').length > 0 && (
                        <span className="ml-auto bg-amber-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full">{relocRequests.filter(r=>r.status==='PENDIENTE').length}</span>
                      )}
                    </button>
                  )}
                  {canView('change-status') && <button onClick={() => switchTab('change-status')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'change-status' ? 'bg-pink-500/20 text-pink-400 font-black' : 'hover:bg-slate-800'}`}><RefreshCcw size={18} className="mr-3"/> Cambiar Estado LPN</button>}
                  {canView('adjust') && <button onClick={() => switchTab('adjust')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'adjust' ? 'bg-amber-500/20 text-amber-400 font-black' : 'hover:bg-slate-800'}`}><ClipboardCheck size={18} className="mr-3"/> Hoja de Ajustes</button>}
                  {canView('returns') && <button onClick={() => switchTab('returns')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'returns' ? 'bg-orange-500/20 text-orange-400 font-black' : 'hover:bg-slate-800 text-slate-300'}`}><ArrowLeft size={18} className="mr-3"/> Devoluciones</button>}
                </>)}

                {/* ─── PICKING & EMPAQUE ─── */}
                {(canView('picking-monitor') || canView('waves') || canView('packing')) && (<>
                  <div className="my-4 border-t border-slate-800"></div>
                  <p className="text-[10px] font-black uppercase text-white/50 mb-3 px-2 tracking-widest">Picking & Empaque</p>
                  {canView('picking-monitor') && (
                    <button data-tutorial-target="picking-tab" onClick={() => switchTab('picking-monitor')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'picking-monitor' ? 'bg-violet-500/20 text-violet-400 font-black' : 'hover:bg-slate-800'}`}>
                      <ClipboardList size={18} className="mr-3"/> Monitor de Picking
                      {pickTasks.filter(t => t.line_status === 'PENDIENTE').length > 0 && (
                        <span className="ml-auto bg-violet-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full">{pickTasks.filter(t => t.line_status === 'PENDIENTE').length}</span>
                      )}
                    </button>
                  )}
                  {canView('waves') && <button onClick={() => switchTab('waves')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'waves' ? 'bg-violet-500/20 text-violet-400 font-black' : 'hover:bg-slate-800'}`}><Layers size={18} className="mr-3"/> Olas de Picking</button>}
                  {canView('packing') && <button onClick={() => switchTab('packing')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'packing' ? 'bg-violet-500/20 text-violet-400 font-black' : 'hover:bg-slate-800'}`}><Package size={18} className="mr-3"/> Estación Empaque</button>}
                </>)}

                {/* ─── PROGRAMACIÓN & LOGÍSTICA ─── */}
                {(canView('dispatch-schedule') || canView('docks') || canView('transport') || canView('purchase-orders') || canView('suppliers')) && (<>
                  <div className="my-4 border-t border-slate-800"></div>
                  <p className="text-[10px] font-black uppercase text-white/50 mb-3 px-2 tracking-widest">Programación & Logística</p>
                  {canView('dispatch-schedule') && (
                    <button onClick={() => switchTab('dispatch-schedule')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'dispatch-schedule' ? 'bg-teal-500/20 text-teal-400 font-black' : 'hover:bg-slate-800'}`}>
                      <CalendarClock size={18} className="mr-3"/> Prog. de Salidas
                      {dispatchSchedules.filter(d => d.status === 'PROGRAMADO').length > 0 && (
                        <span className="ml-auto bg-teal-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full">{dispatchSchedules.filter(d => d.status === 'PROGRAMADO').length}</span>
                      )}
                    </button>
                  )}
                  {canView('docks') && <button onClick={() => switchTab('docks')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'docks' ? 'bg-teal-500/20 text-teal-400 font-black' : 'hover:bg-slate-800'}`}><Truck size={18} className="mr-3"/> Muelles / Yard</button>}
                  {canView('transport') && <button onClick={() => switchTab('transport')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'transport' ? 'bg-cyan-500/20 text-cyan-400 font-black' : 'hover:bg-slate-800'}`}><Truck size={18} className="mr-3"/> Transporte</button>}
                  {canView('purchase-orders') && <button onClick={() => switchTab('purchase-orders')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'purchase-orders' ? 'bg-indigo-500/20 text-indigo-400 font-black' : 'hover:bg-slate-800 text-slate-300'}`}><FileText size={18} className="mr-3"/> Órdenes de Compra</button>}
                  {canView('suppliers') && <button onClick={() => switchTab('suppliers')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'suppliers' ? 'bg-indigo-500/20 text-indigo-400 font-black' : 'hover:bg-slate-800'}`}><Building2 size={18} className="mr-3"/> Proveedores & ASN</button>}
                  {canView('manufacturers') && <button onClick={() => switchTab('manufacturers')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'manufacturers' ? 'bg-indigo-500/20 text-indigo-400 font-black' : 'hover:bg-slate-800'}`}><HardHat size={18} className="mr-3"/> Fabricantes</button>}
                </>)}

                {/* ─── CONTROL E HISTORIAL ─── */}
                {(canView('cycle-count') || canManageMasters || canView('audit') || canView('doc-history')) && (<>
                  <div className="my-4 border-t border-slate-800"></div>
                  <p className="text-[10px] font-black uppercase text-white/50 mb-3 px-2 tracking-widest">Control e Historial</p>
                  {canView('cycle-count') && <button onClick={() => switchTab('cycle-count')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'cycle-count' ? 'bg-cyan-500/20 text-cyan-400 font-black' : 'hover:bg-slate-800 text-slate-300'}`}><ClipboardCheck size={18} className="mr-3"/> Conteos Cíclicos</button>}
                  {canView('audit') && <button onClick={() => switchTab('audit')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'audit' ? 'bg-slate-500/20 text-slate-300 font-black' : 'hover:bg-slate-800'}`}><History size={18} className="mr-3"/> Auditoría (Logs)</button>}
                </>)}

                {/* ─── REPORTES ─── */}
                {canView('sku-movement') && (<>
                  <div className="my-4 border-t border-slate-800"></div>
                  <p className="text-[10px] font-black uppercase text-white/50 mb-3 px-2 tracking-widest">Reportes</p>
                  <button onClick={() => switchTab('sku-movement')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'sku-movement' ? 'bg-indigo-600/20 text-indigo-400 font-black' : 'hover:bg-slate-800'}`}><Activity size={18} className="mr-3"/> Movimiento por SKU</button>
                  {canView('kardex') && <button onClick={() => switchTab('kardex')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'kardex' ? 'bg-violet-600/20 text-violet-400 font-black' : 'hover:bg-slate-800'}`}><BookOpen size={18} className="mr-3"/> Kardex por SKU</button>}
                  {canManageMasters && <button onClick={() => switchTab('lpn-history')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'lpn-history' ? 'bg-violet-600/20 text-violet-400 font-black' : 'hover:bg-slate-800'}`}><Search size={18} className="mr-3"/> Historial LPN</button>}
                  {canView('doc-history') && <button onClick={() => switchTab('doc-history')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'doc-history' ? 'bg-violet-600/20 text-violet-400 font-black' : 'hover:bg-slate-800'}`}><History size={18} className="mr-3"/> Historial Documentos</button>}
                </>)}

                {/* ─── MAESTROS ─── */}
                {(canView('clients') || canView('master-skus') || canView('kits') || canView('warehouse')) && (<>
                  <div className="my-4 border-t border-slate-800"></div>
                  <p className="text-[10px] font-black uppercase text-white/50 mb-3 px-2 tracking-widest">Maestros</p>
                  {is3PLMode && canView('clients') && <button onClick={() => switchTab('clients')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'clients' ? 'bg-indigo-600/20 text-indigo-400 font-black' : 'hover:bg-slate-800'}`}><Users size={18} className="mr-3"/> Clientes 3PL</button>}
                  {canView('master-skus') && <button onClick={() => switchTab('master-skus')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'master-skus' ? 'bg-indigo-600/20 text-indigo-400 font-black' : 'hover:bg-slate-800'}`}><FileText size={18} className="mr-3"/> Catálogo SKUs</button>}
                  {canView('kits') && <button onClick={() => switchTab('kits')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'kits' ? 'bg-indigo-600/20 text-indigo-400 font-black' : 'hover:bg-slate-800'}`}><Package size={18} className="mr-3"/> Armado de Kits</button>}
                  {canView('warehouse') && <button onClick={() => switchTab('warehouse')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'warehouse' ? 'bg-indigo-600/20 text-indigo-400 font-black' : 'hover:bg-slate-800'}`}><MapIcon size={18} className="mr-3"/> Diseño Bodega</button>}
                </>)}

                {/* ─── CONFIGURACIÓN ─── */}
                {(canView('statuses') || canView('doc-types') || isAdmin) && (<>
                  <div className="my-4 border-t border-slate-800"></div>
                  <p className="text-[10px] font-black uppercase text-white/50 mb-3 px-2 tracking-widest">Configuración</p>
                  {canView('statuses') && <button onClick={() => switchTab('statuses')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'statuses' ? 'bg-slate-500/20 text-slate-300 font-black' : 'hover:bg-slate-800'}`}><Activity size={18} className="mr-3"/> Estados Físicos</button>}
                  {canView('doc-types') && <button onClick={() => switchTab('doc-types')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'doc-types' ? 'bg-slate-500/20 text-slate-300 font-black' : 'hover:bg-slate-800'}`}><FileType size={18} className="mr-3"/> Tipos Documento</button>}
                  {isAdmin && <button onClick={() => switchTab('users')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'users' ? 'bg-indigo-600/20 text-indigo-400 font-black' : 'hover:bg-slate-800'}`}><UserCog size={18} className="mr-3"/> Usuarios del sistema</button>}
                  {isAdmin && <button onClick={() => switchTab('access-log')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'access-log' ? 'bg-indigo-600/20 text-indigo-400 font-black' : 'hover:bg-slate-800'}`}><Key size={18} className="mr-3"/> Registro de accesos</button>}
                  {isSuperAdmin && <button onClick={() => switchTab('superadmin')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'superadmin' ? 'bg-red-600/30 text-red-400 font-black' : 'hover:bg-slate-800 text-red-400/70'}`}><ShieldAlert size={18} className="mr-3"/> Panel de administración</button>}
                </>)}
              </>
            )}
            {currentUser?.role === 'CLIENTE' && (
              <>
                <div className="my-4 border-t border-slate-800"></div>
                <p className="text-[10px] font-black uppercase text-white/50 mb-3 px-2 tracking-widest">Mi Portal</p>
                <button onClick={() => switchTab('dashboard')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'dashboard' ? 'bg-cyan-600/20 text-cyan-400 font-black' : 'hover:bg-slate-800'}`}><LayoutDashboard size={18} className="mr-3"/> Dashboard</button>
                <button onClick={() => switchTab('inventory')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'inventory' ? 'bg-cyan-600/20 text-cyan-400 font-black' : 'hover:bg-slate-800'}`}><Package size={18} className="mr-3"/> Mi Stock</button>
                <button onClick={() => switchTab('doc-history')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'doc-history' ? 'bg-cyan-600/20 text-cyan-400 font-black' : 'hover:bg-slate-800'}`}><History size={18} className="mr-3"/> Mis Documentos</button>
                <button onClick={() => switchTab('purchase-orders')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'purchase-orders' ? 'bg-cyan-600/20 text-cyan-400 font-black' : 'hover:bg-slate-800'}`}><FileText size={18} className="mr-3"/> Órdenes de Compra</button>
                <button onClick={() => switchTab('shipments')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'shipments' ? 'bg-cyan-600/20 text-cyan-400 font-black' : 'hover:bg-slate-800'}`}><Truck size={18} className="mr-3"/> Mis Envíos</button>
                <button onClick={() => switchTab('returns')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'returns' ? 'bg-cyan-600/20 text-cyan-400 font-black' : 'hover:bg-slate-800'}`}><ArrowLeft size={18} className="mr-3"/> Mis Devoluciones</button>
                <button onClick={() => switchTab('master-skus')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'master-skus' ? 'bg-cyan-600/20 text-cyan-400 font-black' : 'hover:bg-slate-800'}`}><Box size={18} className="mr-3"/> Catálogo de Artículos</button>
              </>
            )}

            {canView('digital-twin') && currentUser?.role === 'PICKER' && (
              <>
                <div className="my-4 border-t border-slate-800"></div>
                <p className="text-[10px] font-black uppercase text-white/50 mb-3 px-2 tracking-widest">Bodega</p>
                <button onClick={() => switchTab('inventory')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'inventory' ? 'bg-green-500/20 text-green-400 font-black' : 'hover:bg-slate-800'}`}><Package size={18} className="mr-3"/> Stock Físico</button>
                <button onClick={() => switchTab('digital-twin')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'digital-twin' ? 'bg-indigo-600/20 text-indigo-400 font-black' : 'hover:bg-slate-800'}`}><Layers size={18} className="mr-3"/> Mapa 3D Bodega</button>
                <button onClick={() => switchTab('relocate')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'relocate' ? 'bg-amber-500/20 text-amber-400 font-black' : 'hover:bg-slate-800'}`}>
                  <ArrowRightLeft size={18} className="mr-3"/> Solicitar Reubicación
                  {relocRequests.filter(r=>r.status==='PENDIENTE' && r.requested_by===currentUser?.username).length > 0 && (
                    <span className="ml-auto bg-amber-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full">{relocRequests.filter(r=>r.status==='PENDIENTE' && r.requested_by===currentUser?.username).length}</span>
                  )}
                </button>
              </>
            )}
            {/* Cola personal del PICKER (Monitor lo cubre el bloque Picking & Empaque para roles superiores) */}
            {currentUser?.role === 'PICKER' && canView('picker-queue') && (
              <>
                <div className="my-4 border-t border-slate-800"></div>
                <p className="text-[10px] font-black uppercase text-white/50 mb-3 px-2 tracking-widest">Mi Trabajo</p>
                <button onClick={() => switchTab('picker-queue')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors ${activeTab === 'picker-queue' ? 'bg-violet-500/20 text-violet-400 font-black' : 'hover:bg-slate-800'}`}>
                  <ListTodo size={18} className="mr-3"/> Mi Cola de Tareas
                  {pickQueue.length > 0 && (
                    <span className="ml-auto bg-violet-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full">{pickQueue.length}</span>
                  )}
                </button>
              </>
            )}
          </div>
        </aside>

        {/* ÁREA DE TRABAJO */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* BANNER PORTAL CLIENTE */}
          {currentUser?.role === 'CLIENTE' && (
            <div className="bg-gradient-to-r from-cyan-600 to-teal-600 text-white flex items-center px-4 md:px-8 py-2 shrink-0 z-20">
              <Building2 size={12} className="shrink-0 mr-2"/>
              <span className="text-[10px] font-black uppercase tracking-widest truncate">Portal Cliente — Solo lectura · Sus datos están filtrados por su empresa</span>
            </div>
          )}

          {/* BANNER MODO SANDBOX */}
          {isDemo && (
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white flex items-center justify-between px-4 md:px-8 py-2 shrink-0 z-20">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm shrink-0">🎮</span>
                <span className="text-[10px] font-black uppercase tracking-widest truncate">
                  Sandbox · {currentUser?.persona_icon} {currentUser?.persona_label || currentUser?.role}
                  {currentUser?.sandbox_scenario && ` · ${SANDBOX_SCENARIOS[currentUser.sandbox_scenario]?.label || currentUser.sandbox_scenario}`}
                  {' '}— Simulación activa
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="bg-white/20 px-2 py-0.5 rounded text-[9px] font-black hidden sm:block">Cambios no se guardan</span>
                <button
                  onClick={tutorial.iniciar}
                  className="bg-white/25 hover:bg-white/40 text-white font-black px-3 py-1 rounded-lg text-[10px] uppercase tracking-widest transition-colors flex items-center gap-1"
                  title="Iniciar tutorial guiado"
                >
                  📘 Tutorial
                </button>
              </div>
            </div>
          )}

          <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 shrink-0 z-10">
            <div className="flex items-center gap-3">
              <button onClick={() => setSidebarOpen(true)} className="md:hidden p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors" aria-label="Abrir menú">
                <Menu size={20} />
              </button>
              <h1 className="text-xs md:text-sm font-black text-slate-800 uppercase tracking-widest opacity-80">{systemConfig.company_name || systemConfig.system_name || 'WMS Enterprise'}</h1>
              {isDemo && <span className="bg-amber-100 border border-amber-300 text-amber-700 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1">🎮 Sandbox</span>}
              <div className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest border flex items-center gap-1 ${apiStatus === 'online' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : apiStatus === 'conectando' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-red-100 text-red-700 animate-pulse border-red-200'}`}>
                {isFetchingData && <Loader2 size={9} className="animate-spin"/>}
                {apiStatus === 'online' ? 'API ONLINE' : apiStatus === 'conectando' ? 'Conectando...' : 'API OFFLINE'}
              </div>
              {['ADMIN','SUPERADMIN'].includes(currentUser?.role) && (
                <button
                  onClick={async () => {
                    setRefreshingStatic(true);
                    await fetchStatic();
                    setRefreshingStatic(false);
                  }}
                  disabled={refreshingStatic}
                  title="Refrescar catálogo — SKUs, clientes, ubicaciones y config"
                  className="flex items-center gap-1.5 px-2.5 py-1 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors text-[10px] font-black uppercase disabled:opacity-50"
                >
                  {refreshingStatic
                    ? <><Loader2 size={12} className="animate-spin"/> Actualizando…</>
                    : <><RefreshCcw size={12}/> Catálogo</>
                  }
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setDarkMode(p => !p)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors text-slate-500 dark:text-slate-400" title={darkMode ? 'Modo claro' : 'Modo oscuro'}>
                {darkMode ? <Sun size={18}/> : <Moon size={18}/>}
              </button>
              <button onClick={() => setShowNotifPanel(p => !p)} className="relative p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors text-slate-500 dark:text-slate-400">
                <Bell size={18}/>
                {notifCount > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center">{notifCount > 99 ? '99+' : notifCount}</span>}
              </button>
            </div>
          </header>
          <div className="flex-1 overflow-auto p-4 md:p-8 custom-scrollbar relative">
            {msg && <div className={`fixed top-4 right-4 md:right-8 z-50 p-4 rounded-xl shadow-2xl font-black text-xs uppercase tracking-widest animate-in slide-in-from-top-4 max-w-[90vw] ${msg.isError ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'}`}>{msg.text}</div>}
            {/* DemoHint por tab */}
            <DemoHint tabId={activeTab} isDemo={isDemo}/>

            {/* DASHBOARD MODIFICADO CON 3 COLUMNAS Y GRÁFICOS */}
            {activeTab === 'dashboard' && (
              <div className="space-y-6 md:space-y-8 animate-in fade-in max-w-7xl mx-auto pb-12">
                {/* PANEL ALERTAS CRÍTICAS */}
                {notifications.filter(n=>n.severity==='CRITICAL'&&!n.read).length > 0 && (
                  <div className="bg-red-50 border-2 border-red-300 rounded-3xl p-5 flex items-start gap-4 shadow-sm">
                    <div className="p-2 bg-red-100 rounded-xl shrink-0"><ShieldAlert className="w-5 h-5 text-red-600"/></div>
                    <div className="flex-1">
                      <p className="text-sm font-black text-red-700 uppercase tracking-tighter flex items-center gap-2">{notifications.filter(n=>n.severity==='CRITICAL'&&!n.read).length} Alerta(s) Crítica(s) sin Revisar</p>
                      <div className="mt-2 space-y-1">
                        {notifications.filter(n=>n.severity==='CRITICAL'&&!n.read).slice(0,3).map(n=>(
                          <p key={n.id} className="text-xs font-bold text-red-600">{n.message}</p>
                        ))}
                      </div>
                    </div>
                    <button onClick={()=>setShowNotifPanel(true)} className="text-[10px] font-black text-red-600 hover:text-red-800 uppercase tracking-widest shrink-0 bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded-xl transition-colors">Ver todas</button>
                  </div>
                )}
                <div className="flex justify-between items-end">
                  <div>
                    <div>
                      <h1 className="text-2xl md:text-3xl font-black text-slate-800 tracking-tight uppercase flex flex-wrap items-center gap-2 md:gap-3">
                        Panel de Control
                        <span className={`text-sm px-3 py-1 rounded-xl font-black ${operationMode==='3PL'?'bg-blue-100 text-blue-700':operationMode==='PROPIO'?'bg-emerald-100 text-emerald-700':'bg-purple-100 text-purple-700'}`}>
                          {operationMode==='3PL'?'Modo 3PL — Multi-Cliente':operationMode==='PROPIO'?'Modo Productos Propios':'Modo Mixto — PROPIO por defecto'}
                        </span>
                      </h1>
                      <p className="text-sm text-slate-500 font-medium mt-1">
                        {operationMode==='3PL'?'Gestión de inventario por cuenta de terceros con cobros por servicio':operationMode==='PROPIO'?'Gestión de inventario propio sin clientes externos':'Inventario propio + clientes externos. Cliente PROPIO se aplica por defecto si no eliges otro.'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right hidden md:block">
                     <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Operador Activo</p>
                     <p className="text-lg font-bold text-indigo-600">{currentUser?.full_name}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 p-6 rounded-[2rem] shadow-lg shadow-indigo-200 text-white relative overflow-hidden group hover:scale-[1.02] transition-transform cursor-default">
                    <div className="relative z-10">
                      <div className="p-3 bg-white/20 rounded-xl w-fit mb-4 backdrop-blur-md group-hover:bg-white/30 transition-colors"><Package className="text-white"/></div>
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-indigo-100">Unidades Totales</h3>
                      <p className="text-4xl font-black mt-1">{isAllClients ? Number(stats?.units || 0).toLocaleString() : permittedInventory.reduce((sum, i) => sum + parseFloat(i.qty), 0).toLocaleString()}</p>
                    </div>
                    <Box className="absolute -bottom-6 -right-4 w-40 h-40 text-white opacity-10 group-hover:scale-110 transition-transform duration-500" />
                  </div>

                  <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm relative overflow-hidden group hover:border-emerald-300 transition-all hover:shadow-md cursor-default">
                    <div className="p-3 bg-emerald-50 rounded-xl w-fit mb-4 group-hover:bg-emerald-100 transition-colors"><Box className="text-emerald-600"/></div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">LPNs Activos</h3>
                    <p className="text-4xl font-black text-slate-800 mt-1">{isAllClients ? Number(stats?.lpns || 0).toLocaleString() : permittedInventory.length.toLocaleString()}</p>
                  </div>

                  <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm relative overflow-hidden group hover:border-purple-300 transition-all hover:shadow-md cursor-default">
                    <div className="p-3 bg-purple-50 rounded-xl w-fit mb-4 group-hover:bg-purple-100 transition-colors"><FileText className="text-purple-600"/></div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Catálogo SKUs</h3>
                    <p className="text-4xl font-black text-slate-800 mt-1">{isAllClients ? Number(stats?.skus || 0).toLocaleString() : permittedSkus.length.toLocaleString()}</p>
                  </div>

                  {is3PLMode && (
                    <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm relative overflow-hidden group hover:border-amber-300 transition-all hover:shadow-md cursor-default">
                      <div className="p-3 bg-amber-50 rounded-xl w-fit mb-4 group-hover:bg-amber-100 transition-colors"><Users className="text-amber-600"/></div>
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Clientes 3PL</h3>
                      <p className="text-4xl font-black text-slate-800 mt-1">{permittedClients.length}</p>
                    </div>
                  )}
                  {!is3PLMode && (
                    <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm relative overflow-hidden group hover:border-emerald-300 transition-all hover:shadow-md cursor-default">
                      <div className="p-3 bg-emerald-50 rounded-xl w-fit mb-4 group-hover:bg-emerald-100 transition-colors"><Package className="text-emerald-600"/></div>
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">SKUs Activos</h3>
                      <p className="text-4xl font-black text-slate-800 mt-1">{permittedSkus.length}</p>
                      <p className="text-[9px] text-emerald-600 font-black uppercase mt-1">{systemConfig.own_client_name || 'Bodega Propia'}</p>
                    </div>
                  )}
                </div>

                {/* ── KPIs DE DESPACHO (solo ADMIN/SUPERADMIN) ──────────────── */}
                {isAdmin && dispatchKpis && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                        <ArrowUpRight className="text-blue-500 w-5 h-5"/> KPIs de Despacho
                      </h2>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Hoy / Mes actual</span>
                    </div>

                    {/* Row de métricas */}
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                      {/* Fill Rate */}
                      {(() => {
                        const v = dispatchKpis.fill_rate_today;
                        const color = v === null ? 'slate' : v >= 90 ? 'emerald' : v >= 70 ? 'amber' : 'red';
                        const colorMap = {
                          emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
                          amber:   'bg-amber-50  border-amber-200  text-amber-700',
                          red:     'bg-red-50    border-red-200    text-red-700',
                          slate:   'bg-slate-50  border-slate-200  text-slate-500',
                        };
                        const gaugeColor = {emerald:'bg-emerald-500',amber:'bg-amber-400',red:'bg-red-500',slate:'bg-slate-300'}[color];
                        return (
                          <div className={`rounded-2xl border p-4 flex flex-col gap-2 ${colorMap[color]}`}>
                            <p className="text-[9px] font-black uppercase tracking-widest opacity-70">Fill Rate Hoy</p>
                            <p className="text-3xl font-black">{v !== null ? `${v}%` : '—'}</p>
                            {v !== null && (
                              <div className="w-full bg-white/60 rounded-full h-2 overflow-hidden">
                                <div className={`${gaugeColor} h-full rounded-full transition-all duration-700`} style={{width:`${Math.min(v,100)}%`}}/>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Tiempo promedio */}
                      <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 flex flex-col gap-1">
                        <p className="text-[9px] font-black uppercase tracking-widest text-purple-500">Tiempo Prom.</p>
                        <p className="text-3xl font-black text-purple-700">
                          {dispatchKpis.avg_dispatch_time_hours > 0
                            ? `${dispatchKpis.avg_dispatch_time_hours}h`
                            : '—'}
                        </p>
                        <p className="text-[8px] text-purple-400 font-bold">entre creación y pickup</p>
                      </div>

                      {/* Órdenes pendientes */}
                      <div className={`rounded-2xl border p-4 flex flex-col gap-1 ${dispatchKpis.pending_orders > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                        <p className={`text-[9px] font-black uppercase tracking-widest ${dispatchKpis.pending_orders > 0 ? 'text-red-500' : 'text-slate-400'}`}>POs Pendientes</p>
                        <p className={`text-3xl font-black ${dispatchKpis.pending_orders > 0 ? 'text-red-700' : 'text-slate-700'}`}>{dispatchKpis.pending_orders}</p>
                        <button onClick={()=>switchTab('dispatch')} className={`text-[8px] font-black uppercase underline ${dispatchKpis.pending_orders > 0 ? 'text-red-400 hover:text-red-600' : 'text-slate-400'}`}>Ver módulo</button>
                      </div>

                      {/* SKUs stockout */}
                      <div className={`rounded-2xl border p-4 flex flex-col gap-1 ${dispatchKpis.stockout_skus > 0 ? 'bg-orange-50 border-orange-200' : 'bg-slate-50 border-slate-200'}`}>
                        <p className={`text-[9px] font-black uppercase tracking-widest ${dispatchKpis.stockout_skus > 0 ? 'text-orange-500' : 'text-slate-400'}`}>SKUs Stockout</p>
                        <p className={`text-3xl font-black ${dispatchKpis.stockout_skus > 0 ? 'text-orange-700' : 'text-slate-700'}`}>{dispatchKpis.stockout_skus}</p>
                        {dispatchKpis.stockout_skus > 0 && <p className="text-[8px] text-orange-400 font-bold">con actividad reciente</p>}
                      </div>

                      {/* On-time rate */}
                      {(() => {
                        const v = dispatchKpis.on_time_rate;
                        const color = v === null ? 'slate' : v >= 90 ? 'emerald' : v >= 70 ? 'amber' : 'red';
                        const textColor = {emerald:'text-emerald-700',amber:'text-amber-700',red:'text-red-700',slate:'text-slate-500'}[color];
                        const bgColor = {emerald:'bg-emerald-50 border-emerald-200',amber:'bg-amber-50 border-amber-200',red:'bg-red-50 border-red-200',slate:'bg-slate-50 border-slate-200'}[color];
                        return (
                          <div className={`rounded-2xl border p-4 flex flex-col gap-1 ${bgColor}`}>
                            <p className={`text-[9px] font-black uppercase tracking-widest ${v===null?'text-slate-400':textColor}`}>Envíos On-Time</p>
                            <p className={`text-3xl font-black ${textColor}`}>{v !== null ? `${v}%` : '—'}</p>
                            <p className="text-[8px] text-slate-400 font-bold">últimos 30 días</p>
                          </div>
                        );
                      })()}

                      {/* Tasa devoluciones */}
                      <div className={`rounded-2xl border p-4 flex flex-col gap-1 ${dispatchKpis.returns_rate > 5 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                        <p className={`text-[9px] font-black uppercase tracking-widest ${dispatchKpis.returns_rate > 5 ? 'text-red-500' : 'text-slate-400'}`}>Tasa Devoluciones</p>
                        <p className={`text-3xl font-black ${dispatchKpis.returns_rate > 5 ? 'text-red-700' : 'text-slate-700'}`}>{dispatchKpis.returns_rate}%</p>
                        <p className="text-[8px] text-slate-400 font-bold">del mes actual</p>
                      </div>
                    </div>

                    {/* Gráfico de barras semanal */}
                    {weeklyDispatch.length > 0 && (
                      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
                        <h3 className="text-sm font-black text-slate-700 uppercase tracking-tighter mb-5 flex items-center gap-2">
                          <ArrowUpRight className="text-blue-500 w-4 h-4"/> Despachos — Últimos 7 días
                        </h3>
                        <div className="flex items-end gap-2 h-36">
                          {weeklyDispatch.map((d, i) => {
                            const maxD = Math.max(...weeklyDispatch.map(x => x.dispatches), 1);
                            const pct = Math.round((d.dispatches / maxD) * 100);
                            const barColor = d.fill_rate >= 90 ? 'bg-emerald-500' : d.fill_rate >= 70 ? 'bg-amber-400' : d.fill_rate > 0 ? 'bg-red-400' : 'bg-slate-200';
                            const rawDate = d.date || d.dispatch_date || d.created_at;
                            // Soporta tanto "YYYY-MM-DD" como ISO completo ("...T00:00:00.000Z")
                            const parsedDate = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(rawDate)) ? rawDate + 'T12:00:00' : rawDate);
                            const dayLabel = isNaN(parsedDate.getTime()) ? '—' : parsedDate.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });
                            return (
                              <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                                {/* Tooltip */}
                                <div className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white text-[9px] font-black px-2 py-1 rounded-lg whitespace-nowrap z-10 pointer-events-none">
                                  {d.dispatches} desp. · {Number(d.units).toLocaleString()} un. · FR {d.fill_rate}%
                                </div>
                                <div className="w-full flex flex-col justify-end" style={{height:'100%'}}>
                                  <div className={`w-full rounded-t-lg transition-all duration-500 ${barColor}`} style={{height:`${Math.max(pct, d.dispatches > 0 ? 8 : 2)}%`}}/>
                                </div>
                                {d.dispatches > 0 && <span className="text-[8px] font-black text-slate-600">{d.dispatches}</span>}
                                <span className="text-[8px] text-slate-400 font-bold">{dayLabel}</span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex gap-4 mt-3 pt-3 border-t border-slate-100">
                          <span className="flex items-center gap-1 text-[8px] font-black text-slate-500"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block"/> FR ≥ 90%</span>
                          <span className="flex items-center gap-1 text-[8px] font-black text-slate-500"><span className="w-2 h-2 rounded-sm bg-amber-400 inline-block"/> FR 70-89%</span>
                          <span className="flex items-center gap-1 text-[8px] font-black text-slate-500"><span className="w-2 h-2 rounded-sm bg-red-400 inline-block"/> FR &lt; 70%</span>
                          <span className="flex items-center gap-1 text-[8px] font-black text-slate-500 ml-auto">Total mes: <strong>{Number(weeklyDispatch.reduce((s,d)=>s+d.units,0)).toLocaleString()} un.</strong></span>
                        </div>
                      </div>
                    )}

                    {/* Top SKUs despachados */}
                    {(dispatchKpis.top_dispatched_skus||[]).length > 0 && (
                      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
                        <h3 className="text-sm font-black text-slate-700 uppercase tracking-tighter mb-4">Top 5 SKUs Despachados — Mes</h3>
                        <div className="space-y-3">
                          {dispatchKpis.top_dispatched_skus.map((s, i) => {
                            const maxV = dispatchKpis.top_dispatched_skus[0].total_dispatched;
                            return (
                              <div key={s.sku} className="flex items-center gap-3">
                                <span className="text-[10px] font-black text-slate-400 w-4">{i+1}</span>
                                <span className="text-xs font-black text-slate-700 uppercase w-28 truncate" title={s.sku}>{s.sku}</span>
                                <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden">
                                  <div className="bg-blue-500 h-full rounded-full transition-all duration-700" style={{width:`${Math.round((s.total_dispatched/maxV)*100)}%`}}/>
                                </div>
                                <span className="text-xs font-black text-slate-600 w-16 text-right">{Number(s.total_dispatched).toLocaleString()}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* COLUMNA 1: Tareas y Ocupación */}
                  <div className="space-y-8">
                    {currentUser?.role !== 'CLIENTE' && <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6">
                      <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center mb-6"><ClipboardCheck className="w-5 h-5 mr-2 text-indigo-500"/> Tareas en Progreso</h3>
                      <div className="space-y-3">
                        {stockAlerts.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-2">
                        <p className="text-[10px] font-black text-red-600 uppercase tracking-widest flex items-center gap-2 mb-2"><ShieldAlert size={12}/> {stockAlerts.length} Alertas de Stock</p>
                        {stockAlerts.slice(0,3).map(a => (
                          <div key={a.sku} className="flex justify-between text-[9px] font-bold text-red-700 border-t border-red-100 pt-1 mt-1">
                            <span>{a.sku}</span>
                            <span className={parseFloat(a.current_stock) < parseFloat(a.stock_min) ? 'text-red-600' : 'text-orange-600'}>
                              {parseFloat(a.current_stock) < parseFloat(a.stock_min) ? `⬇ Mínimo (${a.current_stock}/${a.stock_min})` : `⬆ Máximo (${a.current_stock}/${a.stock_max})`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  <button onClick={() => switchTab('receive')} className="w-full flex items-center justify-between p-4 rounded-2xl bg-slate-50 hover:bg-emerald-50 border border-transparent hover:border-emerald-200 transition-all group">
                          <div className="flex items-center gap-4">
                            <div className="p-2.5 bg-emerald-100 text-emerald-600 rounded-xl group-hover:scale-110 transition-transform"><ArrowDownRight size={18}/></div>
                            <div className="text-left">
                              <p className="text-xs font-black text-slate-800 uppercase">Recepciones</p>
                              <p className="text-[10px] font-bold text-slate-500 mt-0.5">{workspaces.receive?.length || 0} documento(s) borrador</p>
                            </div>
                          </div>
                          <ChevronRight size={16} className="text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0" />
                        </button>
                        
                        <button onClick={() => switchTab('dispatch')} className="w-full flex items-center justify-between p-4 rounded-2xl bg-slate-50 hover:bg-blue-50 border border-transparent hover:border-blue-200 transition-all group">
                          <div className="flex items-center gap-4">
                            <div className="p-2.5 bg-blue-100 text-blue-600 rounded-xl group-hover:scale-110 transition-transform"><ArrowUpRight size={18}/></div>
                            <div className="text-left">
                              <p className="text-xs font-black text-slate-800 uppercase">Despachos</p>
                              <p className="text-[10px] font-bold text-slate-500 mt-0.5">{workspaces.dispatch?.length || 0} documento(s) borrador</p>
                            </div>
                          </div>
                          <ChevronRight size={16} className="text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0" />
                        </button>

                        <button onClick={() => switchTab('adjust')} className="w-full flex items-center justify-between p-4 rounded-2xl bg-slate-50 hover:bg-amber-50 border border-transparent hover:border-amber-200 transition-all group">
                          <div className="flex items-center gap-4">
                            <div className="p-2.5 bg-amber-100 text-amber-600 rounded-xl group-hover:scale-110 transition-transform"><Activity size={18}/></div>
                            <div className="text-left">
                              <p className="text-xs font-black text-slate-800 uppercase">Ajustes Mermas</p>
                              <p className="text-[10px] font-bold text-slate-500 mt-0.5">{workspaces.adjust?.length || 0} documento(s) borrador</p>
                            </div>
                          </div>
                          <ChevronRight size={16} className="text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0" />
                        </button>
                      </div>
                    </div>}

                    <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6 relative overflow-hidden group">
                       <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center mb-4"><PieChart className="w-5 h-5 mr-2 text-indigo-500"/> {currentUser?.role === 'CLIENTE' ? 'Mi Stock (%)' : is3PLMode ? 'Stock por Cliente (%)' : 'Stock por Estado (%)'}</h3>
                       <div className="flex items-center gap-6">
                         <SimpleDonut data={occData} colors={occColors} />
                         <div className="flex-1 space-y-2">
                           {occData.map((d, i) => (
                             <div key={d.label} className="flex items-center justify-between text-[10px] font-black">
                               <span className="flex items-center truncate gap-2 text-slate-600">
                                 <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{backgroundColor: occColors[i]}}></span>
                                 <span className="truncate w-20" title={d.label}>{d.label}</span>
                               </span>
                               <div className="flex flex-col items-end gap-0.5 shrink-0">
                                 <span className="font-black text-slate-800" style={{color: occColors[i]}}>{d.pct}%</span>
                                 <span className="text-[8px] text-slate-400 font-bold">{d.value.toLocaleString()} un</span>
                               </div>
                             </div>
                           ))}
                           {occData.length === 0 && <p className="text-xs text-slate-400 italic">Sin inventario</p>}
                         </div>
                       </div>
                    </div>
                  </div>

                  {/* COLUMNA 2: Flujos y Calidad */}
                  <div className="space-y-8">
                    {currentUser?.role !== 'CLIENTE' && <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6">
                       <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center mb-6"><BarChart3 className="w-5 h-5 mr-2 text-emerald-500"/> Entradas vs Salidas (7 Días)</h3>
                       <div className="h-40 flex items-end justify-between gap-2 px-2">
                         {flowData.map((d, i) => (
                           <div key={i} className="flex flex-col items-center gap-1 w-full group/bar relative">
                             <div className="absolute -top-8 opacity-0 group-hover/bar:opacity-100 transition-opacity bg-slate-800 text-white text-[9px] p-1.5 rounded flex flex-col gap-0.5 pointer-events-none z-10 whitespace-nowrap shadow-lg">
                               <span className="text-emerald-400 font-bold">In: {d.inQty}</span>
                               <span className="text-red-400 font-bold">Out: {d.outQty}</span>
                             </div>
                             <div className="flex items-end justify-center gap-1 w-full h-32 border-b border-slate-100 pb-1">
                               <div className="w-full max-w-[12px] bg-emerald-400 rounded-t-sm hover:brightness-110 transition-all" style={{height: `${maxFlow > 0 ? (d.inQty / maxFlow) * 100 : 0}%`, minHeight: d.inQty>0?'4px':'0'}}></div>
                               <div className="w-full max-w-[12px] bg-red-400 rounded-t-sm hover:brightness-110 transition-all" style={{height: `${maxFlow > 0 ? (d.outQty / maxFlow) * 100 : 0}%`, minHeight: d.outQty>0?'4px':'0'}}></div>
                             </div>
                             <span className="text-[8px] font-bold text-slate-400">{d.date}</span>
                           </div>
                         ))}
                       </div>
                       <div className="flex justify-center gap-4 mt-4 text-[9px] font-black uppercase text-slate-500">
                         <span className="flex items-center gap-1"><div className="w-2 h-2 bg-emerald-400 rounded-sm"></div> Inbound</span>
                         <span className="flex items-center gap-1"><div className="w-2 h-2 bg-red-400 rounded-sm"></div> Outbound</span>
                       </div>
                    </div>}

                    <div className="bg-slate-800 rounded-[2rem] shadow-xl p-6 text-white relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-4 opacity-5"><Layers size={80}/></div>
                      <h3 className="text-sm font-black uppercase tracking-tighter mb-4 relative z-10 flex items-center"><Activity className="w-5 h-5 mr-2 text-indigo-400"/> Calidad de Stock</h3>
                      <div className="space-y-3 relative z-10">
                        {Object.entries(permittedInventory.reduce((acc, curr) => { const s = curr.status || 'DISPONIBLE'; acc[s] = (acc[s] || 0) + 1; return acc; }, {})).slice(0, 4).map(([status, count]) => (
                          <div key={status} className="flex justify-between items-center border-b border-white/10 pb-2 last:border-0 last:pb-0">
                            <span className="flex items-center gap-3 text-[10px] font-bold text-slate-300 uppercase tracking-widest">
                              <span className={`w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)] ${status === 'DISPONIBLE' ? 'bg-emerald-400 shadow-emerald-400/50' : status === 'BLOQUEADO' ? 'bg-red-400 shadow-red-400/50' : 'bg-indigo-400 shadow-indigo-400/50'}`}></span>
                              {status}
                            </span>
                            <span className="font-black text-sm bg-slate-900 px-2 py-0.5 rounded-lg">{count}</span>
                          </div>
                        ))}
                        {permittedInventory.length === 0 && <p className="text-xs text-slate-500 italic">No hay inventario registrado.</p>}
                      </div>
                    </div>
                  </div>

                  {/* COLUMNA 3: Logs */}
                  {currentUser?.role !== 'CLIENTE' && <div className="lg:col-span-1 bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6 flex flex-col h-[600px]">
                    <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4 shrink-0">
                      <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center"><History className="w-5 h-5 mr-2 text-indigo-500"/> Transacciones (Vivo)</h3>
                    </div>
                    
                    <div className="flex-1 pr-2 custom-scrollbar">
                      {/* P13: virtualizado — render solo los logs visibles, eficiente con miles. */}
                      <VirtualizedScrollList
                        items={auditLogs}
                        itemSize={112}
                        height={520}
                        className="space-y-3"
                        emptyState={<p className="text-center text-slate-400 text-xs">Sin transacciones recientes</p>}
                        renderItem={(log) => (
                          <div key={log.id} className="flex items-start gap-4 p-4 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-colors">
                            <div className={`p-2 rounded-xl shrink-0 mt-0.5 shadow-sm ${
                              log.type === 'INBOUND' || log.type === 'ADJUST_IN' ? 'bg-emerald-100 text-emerald-600' :
                              log.type === 'OUTBOUND' || log.type === 'ADJUST_OUT' ? 'bg-red-100 text-red-600' :
                              'bg-purple-100 text-purple-600'
                            }`}>
                              {log.type === 'INBOUND' || log.type === 'ADJUST_IN' ? <ArrowDownRight size={16}/> :
                               log.type === 'OUTBOUND' || log.type === 'ADJUST_OUT' ? <ArrowUpRight size={16}/> : <RefreshCcw size={16}/>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-center mb-1">
                                <p className="text-xs font-black text-slate-800 truncate uppercase">{log.sku}</p>
                                <span className={`text-[10px] font-black bg-white px-1.5 py-0.5 rounded shadow-sm ${
                                   log.type === 'INBOUND' || log.type === 'ADJUST_IN' ? 'text-emerald-600' :
                                   log.type === 'OUTBOUND' || log.type === 'ADJUST_OUT' ? 'text-red-600' : 'text-purple-600'
                                }`}>{log.type === 'INBOUND' || log.type === 'ADJUST_IN' ? '+' : log.type === 'OUTBOUND' || log.type === 'ADJUST_OUT' ? '-' : ''}{log.qty}</span>
                              </div>
                              <p className="text-[9px] font-bold text-slate-500 uppercase flex items-center gap-1.5 mb-1.5">
                                 <span className="flex items-center"><Calendar size={8} className="mr-0.5"/> {new Date(log.created_at).toLocaleString('es-ES', { timeStyle: 'short' })}</span>
                                 <span className="text-slate-300">•</span>
                                 <span className="text-indigo-600 flex items-center"><UserCog size={8} className="mr-0.5"/> {log.username || 'SYS'}</span>
                              </p>
                              <p className="text-[10px] text-slate-600 truncate" title={log.glosa}>
                                {log.glosa || 'Sin observaciones.'}
                              </p>
                            </div>
                          </div>
                        )}
                      />
                      {auditLogs.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 py-10">
                          <History size={32} className="opacity-20 mb-2"/>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sin actividad</p>
                        </div>
                      )}
                    </div>
                  </div>}
                </div>
              </div>
            )}
            
            {/* DIGITAL TWIN / MAPA 3D */}
            {activeTab === 'digital-twin' && (
              <Suspense fallback={<TabLoader />}>
                <DigitalTwinTab
                  inventory={permittedInventory}
                  locations={safeLocs}
                  warehouses={warehouses}
                  zones={zones}
                  getStatusBadge={getStatusBadge}
                  clients={clients}
                />
              </Suspense>
            )}
            
            {/* REGISTRO DE ACCESOS ──────────────────────────── */}
            {activeTab === 'access-log' && isAdmin && (() => {
              const loadAccessLog = async (filt = accessLogFilter, page = accessLogPage) => {
                setAccessLogBusy(true);
                try {
                  const qs = new URLSearchParams();
                  if (filt.username) qs.set('username', filt.username);
                  if (filt.ip) qs.set('ip', filt.ip);
                  if (filt.success) qs.set('success', filt.success);
                  if (filt.from) qs.set('from', filt.from);
                  if (filt.to) qs.set('to', filt.to);
                  qs.set('limit', '100');
                  qs.set('offset', String(page * 100));
                  const r = await apiFetch(`${host}/api/login-history?${qs}`);
                  if (r.ok) setAccessLogData(await r.json());
                } catch (e) {} finally { setAccessLogBusy(false); }
              };
              const stats = accessLogData.stats || {};
              const rows = accessLogData.rows || [];
              const total = accessLogData.total || 0;
              const totalPages = Math.max(1, Math.ceil(total / 100));
              return (
                <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-indigo-100 rounded-2xl"><Key className="w-7 h-7 text-indigo-600"/></div>
                      <div>
                        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Registro de accesos</h1>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Quién entró al sistema, cuándo y desde qué IP</p>
                      </div>
                    </div>
                    <button onClick={() => loadAccessLog()} disabled={accessLogBusy} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 shadow-md disabled:opacity-50">
                      {accessLogBusy ? <Loader2 size={12} className="animate-spin"/> : <RefreshCcw size={12}/>}
                      Actualizar
                    </button>
                  </div>

                  {/* Tarjetas de estadísticas */}
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Accesos OK total</p><p className="text-2xl font-black text-emerald-600 mt-1">{stats.ok_total || 0}</p></div>
                    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Intentos fallidos</p><p className="text-2xl font-black text-red-600 mt-1">{stats.fail_total || 0}</p></div>
                    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">OK hoy</p><p className="text-2xl font-black text-emerald-600 mt-1">{stats.ok_today || 0}</p></div>
                    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Fallidos hoy</p><p className="text-2xl font-black text-red-600 mt-1">{stats.fail_today || 0}</p></div>
                    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Activos 24h</p><p className="text-2xl font-black text-indigo-600 mt-1">{stats.active_24h || 0}</p></div>
                    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">IPs únicas</p><p className="text-2xl font-black text-slate-700 mt-1">{stats.distinct_ips || 0}</p></div>
                  </div>

                  {/* Filtros */}
                  <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Filtrar</p>
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                      <input type="text" placeholder="Usuario" value={accessLogFilter.username} onChange={e=>setAccessLogFilter(p=>({...p, username:e.target.value}))} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500"/>
                      <input type="text" placeholder="IP" value={accessLogFilter.ip} onChange={e=>setAccessLogFilter(p=>({...p, ip:e.target.value}))} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500"/>
                      <select value={accessLogFilter.success} onChange={e=>setAccessLogFilter(p=>({...p, success:e.target.value}))} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white focus:border-indigo-500">
                        <option value="">Todos</option>
                        <option value="true">Solo accesos OK</option>
                        <option value="false">Solo fallidos</option>
                      </select>
                      <input type="date" value={accessLogFilter.from} onChange={e=>setAccessLogFilter(p=>({...p, from:e.target.value}))} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500" title="Desde"/>
                      <input type="date" value={accessLogFilter.to} onChange={e=>setAccessLogFilter(p=>({...p, to:e.target.value}))} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500" title="Hasta"/>
                      <div className="flex gap-2">
                        <button onClick={()=>{setAccessLogPage(0);loadAccessLog(accessLogFilter, 0);}} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-xl text-[10px] font-black uppercase">Aplicar</button>
                        <button onClick={()=>{const empty={username:'',ip:'',success:'',from:'',to:''};setAccessLogFilter(empty);setAccessLogPage(0);loadAccessLog(empty,0);}} className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-xl text-[10px] font-black uppercase">Limpiar</button>
                      </div>
                    </div>
                  </div>

                  {/* Tabla */}
                  <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase">Fecha / Hora</th>
                            <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase">Usuario</th>
                            <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase">Rol</th>
                            <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase">IP de origen</th>
                            <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase text-center">Resultado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {rows.length === 0 && (
                            <tr><td colSpan="5" className="p-8 text-center text-slate-400 text-sm">Sin accesos para los filtros aplicados. Presiona "Actualizar" para cargar el historial.</td></tr>
                          )}
                          {rows.map(r => (
                            <tr key={r.id} className="hover:bg-indigo-50/30 transition-colors">
                              <td className="px-5 py-3 text-xs font-bold text-slate-700">
                                <p>{new Date(r.created_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'medium' })}</p>
                                <p className="text-[9px] text-slate-400 font-medium">{timeAgo(r.created_at)}</p>
                              </td>
                              <td className="px-5 py-3">
                                <p className="font-mono text-xs font-black text-slate-800">@{r.username}</p>
                                {r.full_name && <p className="text-[10px] text-slate-500">{r.full_name}</p>}
                              </td>
                              <td className="px-5 py-3">
                                {r.role ? <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${r.role === 'SUPERADMIN' ? 'bg-red-100 text-red-700' : r.role === 'ADMIN' ? 'bg-orange-100 text-orange-700' : r.role === 'CLIENTE' ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600'}`}>{r.role}</span> : <span className="text-[10px] text-slate-400">(usuario eliminado)</span>}
                              </td>
                              <td className="px-5 py-3 font-mono text-xs text-slate-600">{r.ip || '—'}</td>
                              <td className="px-5 py-3 text-center">
                                {r.success
                                  ? <span className="bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full text-[10px] font-black uppercase inline-flex items-center gap-1"><CheckCircle2 size={10}/> Acceso OK</span>
                                  : <span className="bg-red-100 text-red-700 border border-red-200 px-3 py-1 rounded-full text-[10px] font-black uppercase inline-flex items-center gap-1"><XCircle size={10}/> Fallido</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Paginación */}
                    {total > 0 && (
                      <div className="flex items-center justify-between p-4 border-t border-slate-100 bg-slate-50">
                        <p className="text-[10px] font-bold text-slate-500">Mostrando {accessLogPage*100+1}–{Math.min((accessLogPage+1)*100, total)} de {total}</p>
                        <div className="flex gap-2">
                          <button disabled={accessLogPage===0} onClick={()=>{const p=accessLogPage-1;setAccessLogPage(p);loadAccessLog(accessLogFilter,p);}} className="bg-white border border-slate-200 px-3 py-1.5 rounded-xl text-[10px] font-black text-slate-600 disabled:opacity-30">← Anterior</button>
                          <span className="px-3 py-1.5 text-[10px] font-black text-slate-500">Pág {accessLogPage+1} / {totalPages}</span>
                          <button disabled={accessLogPage+1>=totalPages} onClick={()=>{const p=accessLogPage+1;setAccessLogPage(p);loadAccessLog(accessLogFilter,p);}} className="bg-white border border-slate-200 px-3 py-1.5 rounded-xl text-[10px] font-black text-slate-600 disabled:opacity-30">Siguiente →</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* USUARIOS CON SELECCIÓN DE MÓDULOS */}
            {activeTab === 'users' && isAdmin && (
              <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
                <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row gap-8">
                  <div className="flex-1 space-y-6 border-r border-slate-100 pr-8">
                    <div>
                      <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center">
                        <UserCog className="w-5 h-5 mr-2 text-indigo-500"/> 
                        {isEditingUser ? 'Editando Perfil' : 'Gestión de Usuarios'}
                      </h2>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Crear accesos, suspender y definir permisos</p>
                    </div>
                    <form onSubmit={handleSaveUser} className="space-y-6">
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Username *</label><input type="text" value={userForm.username} onChange={e=>setUserForm({...userForm, username: e.target.value.toLowerCase().replace(/\s/g, '')})} required disabled={isEditingUser} className={`w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 lowercase ${isEditingUser ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`} placeholder="Ej: jlopez"/></div>
                          <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Contraseña {isEditingUser ? '' : '*'}</label><input type="password" value={userForm.password} onChange={e=>setUserForm({...userForm, password: e.target.value})} required={!isEditingUser} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder={isEditingUser ? "(Vacío para no cambiar)" : "******"}/></div>
                        </div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Nombre Completo *</label><input type="text" value={userForm.full_name} onChange={e=>setUserForm({...userForm, full_name: e.target.value})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder="Ej: Juan López"/></div>
                        
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                             <label className="text-[10px] font-black text-slate-400 uppercase">Rol de Seguridad Base</label>
                             <select value={userForm.role} onChange={e=>setUserForm({...userForm, role: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 bg-white">
                               <option value="CLIENTE">CLIENTE (Portal solo lectura)</option>
                               <option value="PICKER">PICKER (Bodega)</option>
                               <option value="EJECUTIVO_CUENTA">EJECUTIVO DE CUENTA (Operario)</option>
                               {isAdmin && <option value="JEFE_BODEGA">JEFE DE BODEGA</option>}
                               <option value="AUDITOR">AUDITOR</option>
                               {isAdmin && <option value="ADMIN">ADMINISTRADOR</option>}
                             </select>
                          </div>
                          <div className="space-y-1">
                             <label className="text-[10px] font-black text-slate-400 uppercase">Estado de la Cuenta</label>
                             <select value={userForm.status} onChange={e=>setUserForm({...userForm, status: e.target.value})} className={`w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 bg-white ${userForm.status === 'SUSPENDED' ? 'text-red-600' : 'text-emerald-600'}`}>
                               <option value="ACTIVE">🟢 Activa (Permitir Acceso)</option>
                               <option value="SUSPENDED">🔴 Suspendida (Bloqueado)</option>
                             </select>
                          </div>
                        </div>

                        {/* ── ACCESO A CLIENTES (modo 3PL) ─────────────── */}
                        <div className="space-y-3 pt-4 border-t border-slate-100">
                          <label className="text-[10px] font-black text-indigo-600 uppercase flex items-center"><Users className="w-3 h-3 mr-1"/> Acceso a clientes (operaciones)</label>
                          {['ADMIN','SUPERADMIN'].includes(userForm.role) ? (
                            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
                              <p className="text-xs font-black text-indigo-700">🛡 Todos los clientes</p>
                              <p className="text-[10px] text-indigo-600 font-bold mt-0.5">Los administradores siempre acceden a todos los clientes.</p>
                            </div>
                          ) : (
                            <>
                              <p className="text-[10px] text-slate-500 font-bold">Define sobre qué clientes este usuario puede crear operaciones (recibir, despachar, ajustar). La <strong>consulta</strong> de stock e inventario sigue siendo global.</p>
                              <div className="space-y-2">
                                {[
                                  ['all','Todos los clientes','admin, jefe de bodega'],
                                  ['assigned','Solo clientes asignados','operador específico'],
                                  ['none','Sin acceso a clientes','usuario bloqueado'],
                                ].map(([id,label,desc]) => (
                                  <label key={id} className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${userForm.client_scope === id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}>
                                    <input type="radio" name="client_scope" value={id} checked={userForm.client_scope === id} onChange={()=>setUserForm(p=>({...p, client_scope: id}))} className="mt-0.5 accent-indigo-600"/>
                                    <div>
                                      <p className="text-xs font-black text-slate-800">{label}</p>
                                      <p className="text-[10px] text-slate-500 font-medium">{desc}</p>
                                    </div>
                                  </label>
                                ))}
                              </div>

                              {userForm.client_scope === 'assigned' && (
                                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 animate-in fade-in">
                                  <div className="flex items-center justify-between">
                                    <p className="text-[10px] font-black text-slate-500 uppercase">Clientes asignados ({(userForm.assigned_clients||[]).length})</p>
                                    <div className="flex gap-2">
                                      <button type="button" onClick={()=>setUserForm(p=>({...p, assigned_clients: clients.map(c=>c.id)}))} className="text-[9px] font-black text-indigo-600 hover:text-indigo-800 underline">Seleccionar todos</button>
                                      <button type="button" onClick={()=>setUserForm(p=>({...p, assigned_clients: []}))} className="text-[9px] font-black text-slate-500 hover:text-slate-700 underline">Deseleccionar todos</button>
                                    </div>
                                  </div>
                                  <div className="max-h-48 overflow-y-auto space-y-1 bg-white border border-slate-200 rounded-lg p-2">
                                    {clients.length === 0 && <p className="text-[10px] text-slate-400 text-center py-3">Sin clientes registrados aún.</p>}
                                    {clients.map(c => {
                                      const checked = (userForm.assigned_clients || []).includes(c.id);
                                      return (
                                        <label key={c.id} className="flex items-center gap-2 cursor-pointer p-1.5 hover:bg-slate-50 rounded">
                                          <input type="checkbox" checked={checked} onChange={()=>setUserForm(p=>({...p, assigned_clients: checked ? p.assigned_clients.filter(x=>x!==c.id) : [...(p.assigned_clients||[]), c.id]}))} className="w-3.5 h-3.5 accent-indigo-600"/>
                                          <span className="font-mono text-[10px] font-black text-indigo-700">{c.id}</span>
                                          <span className="text-[10px] text-slate-600">· {c.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>

                        {/* SELECCIÓN DE MÓDULOS */}
                        <div className="space-y-1 pt-4 border-t border-slate-100">
                           <label className="text-[10px] font-black text-indigo-600 uppercase flex items-center"><LayoutDashboard className="w-3 h-3 mr-1"/> Permisos de Visualización (Menú)</label>
                           <select value={userForm.allowed_modules_type} onChange={e=>{setUserForm({...userForm, allowed_modules_type: e.target.value, moduleSelection: []})}} className="w-full border-2 border-indigo-100 bg-indigo-50 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 text-indigo-800">
                             <option value="ROLE">Por Defecto (Basado en Rol Base)</option>
                             <option value="CUSTOM">Personalizado (Elegir qué módulos ve)</option>
                           </select>
                        </div>

                        {userForm.allowed_modules_type === 'CUSTOM' && (
                           <div className="grid grid-cols-2 gap-2 mt-2 bg-slate-50 p-4 rounded-xl border border-slate-200">
                              {APP_MODULES.map(m => {
                                const is3PLMod = MODULES_3PL_ONLY.includes(m.id);
                                const hiddenByMode = is3PLMod && !is3PLMode;
                                return (
                                  <label key={m.id} className={`flex items-center gap-2 bg-white px-3 py-2 rounded-lg border shadow-sm cursor-pointer ${hiddenByMode ? 'border-cyan-100 bg-cyan-50/30' : 'border-slate-100 hover:border-indigo-300'}`} title={m.label}>
                                    <input type="checkbox" checked={userForm.moduleSelection.includes(m.id)} onChange={e => { const sel = e.target.checked ? [...userForm.moduleSelection, m.id] : userForm.moduleSelection.filter(id => id !== m.id); setUserForm({...userForm, moduleSelection: sel}); }} className="w-4 h-4 text-indigo-600 rounded" />
                                    <span className="text-[10px] font-black text-slate-700 truncate">{m.label}</span>
                                    {is3PLMod && <span className="ml-auto text-[7px] bg-cyan-100 text-cyan-600 px-1 rounded font-black uppercase shrink-0">{hiddenByMode ? 'oculto' : '3PL'}</span>}
                                  </label>
                                );
                              })}
                           </div>
                        )}

                        {/* SELECCIÓN DE CLIENTES */}
                        <div className="space-y-1 pt-4 border-t border-slate-100">
                           <label className="text-[10px] font-black text-indigo-600 uppercase flex items-center"><Building2 className="w-3 h-3 mr-1"/> Aislamiento de Datos por Cliente</label>
                           <select value={userForm.allowed_clients} onChange={e=>{setUserForm({...userForm, allowed_clients: e.target.value, clientSelection: []})}} className="w-full border-2 border-indigo-100 bg-indigo-50 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 text-indigo-800">
                             <option value="ALL">Sin restricciones (Ve inventario de todos)</option>
                             <option value="RESTRICTED">Restringir (Solo ve clientes seleccionados)</option>
                           </select>
                        </div>
                        
                        {userForm.allowed_clients === 'RESTRICTED' && (
                           <div className="grid grid-cols-2 gap-2 mt-2 bg-slate-50 p-4 rounded-xl border border-slate-200 custom-scrollbar max-h-40 overflow-y-auto">
                              {clients.map(c => (
                                 <label key={c.id} className="flex items-center gap-2 cursor-pointer bg-white px-3 py-2 rounded-lg border border-slate-100 shadow-sm hover:border-indigo-300">
                                   <input type="checkbox" checked={userForm.clientSelection.includes(c.id)} onChange={e => { const sel = e.target.checked ? [...userForm.clientSelection, c.id] : userForm.clientSelection.filter(id => id !== c.id); setUserForm({...userForm, clientSelection: sel}); }} className="w-4 h-4 text-indigo-600 rounded" />
                                   <span className="text-[10px] font-black text-slate-700 truncate" title={c.name}>{c.id}</span>
                                 </label>
                              ))}
                              {clients.length === 0 && <p className="text-[10px] text-slate-400 col-span-2">No hay clientes registrados.</p>}
                           </div>
                        )}
                      </div>

                      <div className="flex gap-4 mt-4">
                        <button type="submit" disabled={isSavingUser} className={`flex-[2] text-white font-black py-4 rounded-2xl shadow-lg uppercase text-xs tracking-widest transition-colors disabled:opacity-60 flex justify-center items-center ${isEditingUser ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'}`}>
                          {isSavingUser ? <><Loader2 size={14} className="mr-2 animate-spin"/> Guardando...</> : (isEditingUser ? 'Actualizar Usuario' : 'Crear Usuario')}
                        </button>
                        {isEditingUser && (
                          <button type="button" onClick={() => {setUserForm({ username: '', full_name: '', password: '', role: 'EJECUTIVO_CUENTA', status: 'ACTIVE', allowed_clients: 'ALL', clientSelection: [], allowed_modules_type: 'ROLE', moduleSelection: [] }); setIsEditingUser(false);}} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-black py-4 rounded-2xl shadow-sm uppercase text-xs tracking-widest transition-colors">
                            Cancelar
                          </button>
                        )}
                      </div>
                    </form>
                  </div>
                  <div className="flex-[1.5] overflow-y-auto max-h-[600px] custom-scrollbar pr-2">
                    <div className="flex justify-between items-center mb-4 sticky top-0 bg-white pt-2 pb-2 z-10 border-b border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Usuarios del Sistema ({users.length})</p>
                    </div>
                    <div className="space-y-3">
                      {users.map(u => (
                        <div key={u.username} className={`p-4 border rounded-2xl flex flex-col hover:bg-slate-50 transition-colors shadow-sm ${u.status === 'SUSPENDED' ? 'bg-slate-50 border-slate-200 opacity-75' : 'bg-white border-slate-200'}`}>
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <p className="text-sm font-black text-slate-800 flex items-center gap-2">
                                {u.full_name} 
                                {u.status === 'SUSPENDED' && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[8px] uppercase">Suspendido</span>}
                              </p>
                              <p className="text-[10px] font-mono text-slate-500 mt-1">@{u.username}</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className={`px-2 py-1 rounded text-[9px] font-black uppercase border ${u.role === 'ADMIN' || u.role === 'SUPERADMIN' ? 'bg-red-50 text-red-600 border-red-200' : u.role === 'EJECUTIVO_CUENTA' ? 'bg-teal-50 text-teal-600 border-teal-200' : u.role === 'AUDITOR' ? 'bg-blue-50 text-blue-600 border-blue-200' : u.role === 'PICKER' ? 'bg-violet-50 text-violet-600 border-violet-200' : u.role === 'CLIENTE' ? 'bg-cyan-50 text-cyan-600 border-cyan-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>{u.role === 'EJECUTIVO_CUENTA' ? 'EJECUTIVO' : u.role}</span>
                              <button onClick={() => handleEditUser(u)} className="bg-white p-1.5 rounded-full border border-slate-200 text-slate-400 hover:text-indigo-600 hover:border-indigo-300 shadow-sm transition-all ml-2" title="Editar Usuario"><Pencil size={14}/></button>
                              <button onClick={() => handleDeleteUser(u.username)} disabled={u.username === 'admin'} className="bg-white p-1.5 rounded-full border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-300 shadow-sm transition-all ml-1 disabled:opacity-30"><Trash2 size={14}/></button>
                            </div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-2">
                            {u.allowed_modules !== 'ALL' && (
                              <p className="text-[9px] text-indigo-600 font-bold uppercase tracking-widest flex items-center"><LayoutDashboard size={10} className="mr-1"/> Vistas: {JSON.parse(u.allowed_modules || '[]').length} act</p>
                            )}
                            {/* Badge de scope de clientes */}
                            {(() => {
                              const isAdminRole = ['ADMIN','SUPERADMIN'].includes(u.role);
                              const scope = isAdminRole ? 'all' : (u.client_scope || 'all');
                              if (scope === 'all') return <button onClick={()=>handleEditUser(u)} className="bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[9px] font-black uppercase hover:bg-blue-200">🏢 Todos los clientes</button>;
                              if (scope === 'none') return <button onClick={()=>handleEditUser(u)} className="bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded text-[9px] font-black uppercase hover:bg-red-200">⛔ Sin acceso</button>;
                              const ac = Array.isArray(u.assigned_clients) ? u.assigned_clients : [];
                              if (ac.length === 0) return <button onClick={()=>handleEditUser(u)} className="bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded text-[9px] font-black uppercase hover:bg-amber-200">⚠ Sin clientes asignados</button>;
                              const shown = ac.slice(0,3);
                              const extra = ac.length - shown.length;
                              return (
                                <div className="flex flex-wrap gap-1 items-center" title={ac.join(', ')}>
                                  {shown.map(cid => <button key={cid} onClick={()=>handleEditUser(u)} className="bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded text-[9px] font-mono font-black hover:bg-emerald-200">{cid}</button>)}
                                  {extra > 0 && <button onClick={()=>handleEditUser(u)} className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-[9px] font-black">+{extra} más</button>}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* API KEYS */}
            {activeTab === 'users' && isAdmin && isSuperAdmin && (
              <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
                <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8">
                  <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center mb-6"><Key className="w-5 h-5 mr-2 text-indigo-500"/> API Keys para Integración ERP</h2>
                  <div className="grid md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Generar Nueva Key</h3>
                      <form onSubmit={handleGenerateKey} className="space-y-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase">Nombre / Descripción *</label>
                          <input type="text" required value={newKeyName} onChange={e=>setNewKeyName(e.target.value)} placeholder="Ej: ERP-SAP-Producción" className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500"/>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase">Cliente (opcional)</label>
                          <select value={newKeyClient} onChange={e=>setNewKeyClient(e.target.value)} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 bg-white">
                            <option value="">-- Todos los clientes --</option>
                            {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase">Permisos</label>
                          <select value={newKeyPerms} onChange={e=>setNewKeyPerms(e.target.value)} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 bg-white">
                            <option value="read">Solo Lectura</option>
                            <option value="write">Lectura + Escritura</option>
                          </select>
                        </div>
                        <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 rounded-2xl uppercase text-xs tracking-widest shadow-lg shadow-indigo-200 transition-colors flex items-center justify-center gap-2"><Key size={14}/> Generar API Key</button>
                      </form>
                      {generatedKey && (
                        <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-4 animate-in fade-in">
                          <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-2">⚠️ Copia esta key ahora — no se mostrará de nuevo</p>
                          <code className="block bg-white border border-emerald-200 rounded-xl px-4 py-3 font-mono text-xs text-slate-800 break-all select-all">{generatedKey}</code>
                          <button onClick={()=>{navigator.clipboard.writeText(generatedKey); showMsg('✅ Copiado');}} className="mt-2 text-[10px] font-black text-emerald-600 hover:text-emerald-800 uppercase tracking-widest">Copiar al portapapeles</button>
                        </div>
                      )}
                    </div>
                    <div className="space-y-3">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Keys Activas ({apiKeys.length})</h3>
                      {apiKeys.map(k=>(
                        <div key={k.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-sm font-black text-slate-800">{k.name}</p>
                              <p className="font-mono text-[10px] text-slate-500 mt-1">{k.key_prefix}••••••••</p>
                              <div className="flex gap-2 mt-2">
                                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${k.permissions==='write'?'bg-amber-100 text-amber-700':'bg-blue-100 text-blue-700'}`}>{k.permissions}</span>
                                {k.client_id && <span className="text-[9px] font-black bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">{k.client_id}</span>}
                              </div>
                            </div>
                            <button onClick={()=>handleRevokeKey(k.id)} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={14}/></button>
                          </div>
                          <p className="text-[9px] text-slate-400 mt-2">Creada: {new Date(k.created_at).toLocaleDateString('es-ES')}</p>
                        </div>
                      ))}
                      {apiKeys.length===0 && <div className="p-6 text-center text-slate-400"><Key className="w-10 h-10 mx-auto mb-2 opacity-50"/><p className="text-[10px] uppercase font-bold">Sin keys activas</p></div>}
                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Endpoints Disponibles</p>
                        <div className="space-y-1 font-mono text-[9px] text-slate-600">
                          <p>GET /v1/inventory</p>
                          <p>GET /v1/inventory/:sku/stock</p>
                          <p>GET /v1/skus</p>
                          <p>GET /v1/movements</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* HISTORIAL DE LOGINS */}
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><History className="w-4 h-4 text-slate-500"/> Historial de Accesos</h2>
                    <button onClick={async()=>{ const res=await apiFetch(`${host}/api/login-history`); const d=await res.json(); setLoginHistory(Array.isArray(d)?d:[]); setShowLoginHistory(true); }} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2"><RefreshCcw size={12}/> Cargar</button>
                  </div>
                  {showLoginHistory && loginHistory.length > 0 && (
                    <div className="overflow-x-auto max-h-64 overflow-y-auto custom-scrollbar">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 sticky top-0"><tr>
                          <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Fecha</th>
                          <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Usuario</th>
                          <th className="p-3 text-[9px] font-black text-slate-400 uppercase">IP</th>
                          <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Estado</th>
                        </tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {loginHistory.map(h=>(
                            <tr key={h.id} className={`hover:bg-slate-50 ${!h.success?'bg-red-50/50':''}`}>
                              <td className="p-3 text-[10px] text-slate-400">{new Date(h.created_at).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})}</td>
                              <td className="p-3 font-mono text-xs font-black text-slate-700">@{h.username}</td>
                              <td className="p-3 font-mono text-[10px] text-slate-500">{h.ip}</td>
                              <td className="p-3"><span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${h.success?'bg-emerald-100 text-emerald-700':'bg-red-100 text-red-700'}`}>{h.success?'OK':'Fallido'}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {showLoginHistory && loginHistory.length===0 && <p className="text-center text-xs text-slate-400 py-4">Sin registros</p>}
                </div>
              </div>
            )}

            {/* CONVERSIONES */}
            {activeTab === 'kits' && canManageMasters && (
              <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
                {/* Sub-tabs kitting */}
                <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl w-fit flex-wrap">
                  {[['definitions','Definiciones'],['build','Armar Kit'],['dispatch','Despacho Directo'],['orders','Historial']].map(([id,label])=>(
                    <button key={id} onClick={()=>setKittingTab(id)} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors ${kittingTab===id?(id==='dispatch'?'bg-emerald-600 text-white shadow-sm':'bg-white text-indigo-700 shadow-sm'):'text-slate-500 hover:text-slate-700'}`}>{label}</button>
                  ))}
                </div>

                {/* SUB-TAB DEFINICIONES (original) */}
                {kittingTab === 'definitions' && (
                <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row gap-8">
                  {/* Panel izquierdo: formulario */}
                  <div className="flex-1 space-y-6 border-r border-slate-100 pr-8">
                    <div>
                      <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center"><Package className="w-5 h-5 mr-2 text-indigo-500"/> Nuevo Kit</h2>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Agrupa SKUs en un producto compuesto</p>
                    </div>
                    <form onSubmit={handleSaveKit} className="space-y-5">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">ID del Kit (SKU) *</label>
                        <input type="text" value={kitForm.kit_sku} onChange={e=>setKitForm({...kitForm, kit_sku: e.target.value.toUpperCase()})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 uppercase" placeholder="Ej: KIT-BASICO-001"/>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Cliente *</label>
                        {is3PLMode ? (
                          <select value={kitForm.client_id} onChange={e=>setKitForm({...kitForm, client_id: e.target.value})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 bg-white">
                            <option value="">-- Seleccionar --</option>
                            {permittedClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        ) : (
                          <div className="w-full border-2 border-emerald-200 bg-emerald-50 rounded-xl px-4 py-3 text-sm font-black text-emerald-700 flex items-center gap-2">
                            <Package size={14} className="text-emerald-500 shrink-0"/>{systemConfig.own_client_name || 'Bodega Propia'}
                          </div>
                        )}
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Descripción</label>
                        <input type="text" value={kitForm.description} onChange={e=>setKitForm({...kitForm, description: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder="Ej: Kit de bienvenida"/>
                      </div>

                      {/* Agregar componente */}
                      <div className="bg-slate-50 rounded-2xl p-4 space-y-3 border border-slate-200">
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Agregar Componente</p>
                        <div className="flex gap-2">
                          <select value={kitComponentLine.sku} onChange={e=>setKitComponentLine({...kitComponentLine, sku: e.target.value})} className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500 bg-white">
                            <option value="">-- SKU --</option>
                            {permittedSkus.map(s => <option key={s.sku} value={s.sku}>{s.sku} — {s.desc}</option>)}
                          </select>
                          <input type="number" min="0.01" step="0.01" value={kitComponentLine.qty} onChange={e=>setKitComponentLine({...kitComponentLine, qty: e.target.value})} className="w-20 border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-black outline-none focus:border-indigo-500 text-center" placeholder="Qty"/>
                          <button type="button" onClick={addKitComponent} className="bg-indigo-600 text-white px-3 py-2 rounded-xl hover:bg-indigo-700 transition-colors"><Plus size={16}/></button>
                        </div>
                      </div>

                      {/* Lista de componentes del kit */}
                      {kitForm.components.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Componentes ({kitForm.components.length})</p>
                          {kitForm.components.map(c => {
                            const skuInfo = permittedSkus.find(s => s.sku === c.sku);
                            return (
                              <div key={c.sku} className="flex items-center justify-between bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2">
                                <div>
                                  <span className="text-sm font-black text-indigo-800 uppercase">{c.sku}</span>
                                  {skuInfo && <span className="text-[10px] text-indigo-500 ml-2">{skuInfo.desc}</span>}
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-sm font-black text-indigo-700 bg-indigo-100 px-3 py-0.5 rounded-full">× {c.qty}</span>
                                  <button type="button" onClick={() => removeKitComponent(c.sku)} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={14}/></button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <button type="submit" className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-200 uppercase text-xs tracking-widest hover:bg-indigo-700 transition-colors flex justify-center items-center"><Plus size={16} className="mr-2"/> Guardar Kit</button>
                    </form>
                  </div>

                  {/* Panel derecho: lista de kits */}
                  <div className="flex-[1.5] overflow-y-auto max-h-[600px] custom-scrollbar pr-2">
                    <div className="flex justify-between items-center mb-4 sticky top-0 bg-white pt-2 pb-2 z-10 border-b border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Kits Definidos ({kits.length})</p>
                    </div>
                    <div className="space-y-4">
                      {kits.map(k => (
                        <div key={`${k.kit_sku}-${k.client_id}`} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 hover:bg-white transition-colors shadow-sm">
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <p className="text-sm font-black text-slate-800 uppercase">{k.kit_sku}</p>
                              {k.description && <p className="text-[10px] text-slate-500 mt-0.5">{k.description}</p>}
                              <span className="text-[9px] font-black bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full uppercase mt-1 inline-block">{k.client_id}</span>
                            </div>
                            <button onClick={() => handleDeleteKit(k.kit_sku, k.client_id)} className="text-slate-300 hover:text-red-500 transition-colors mt-1"><Trash2 size={14}/></button>
                          </div>
                          <div className="space-y-1">
                            {(k.components || []).map(c => {
                              const skuInfo = safeSkus.find(s => s.sku === c.component_sku);
                              return (
                                <div key={c.component_sku} className="flex items-center justify-between text-[11px] bg-white border border-slate-100 rounded-lg px-3 py-1.5">
                                  <span className="font-black text-slate-700 uppercase">{c.component_sku}</span>
                                  <span className="text-slate-400">{skuInfo?.desc}</span>
                                  <span className="font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">× {c.qty}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {kits.length === 0 && <div className="p-8 text-center text-slate-400"><Package className="w-12 h-12 mx-auto mb-2 opacity-50"/><p className="text-[10px] uppercase tracking-widest font-bold">No hay kits definidos</p></div>}
                    </div>
                  </div>
                </div>
                )}

                {/* SUB-TAB ARMAR KIT */}
                {kittingTab === 'build' && (
                <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8 max-w-2xl">
                  <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center mb-6"><Package className="w-5 h-5 mr-2 text-indigo-500"/> Armar Kit</h2>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Kit (SKU) *</label>
                        <select value={kitBuildForm.kit_sku} onChange={e=>{ setKitBuildForm({...kitBuildForm,kit_sku:e.target.value}); setKitAvailability(null); }} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 bg-white">
                          <option value="">-- Seleccionar --</option>
                          {kits.map(k=><option key={`${k.kit_sku}-${k.client_id}`} value={k.kit_sku}>{k.kit_sku}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Cliente *</label>
                        {is3PLMode ? (
                          <select value={kitBuildForm.client_id} onChange={e=>{ setKitBuildForm({...kitBuildForm,client_id:e.target.value}); setKitAvailability(null); }} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 bg-white">
                            <option value="">-- Seleccionar --</option>
                            {permittedClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        ) : (
                          <div className="w-full border-2 border-emerald-200 bg-emerald-50 rounded-xl px-4 py-3 text-sm font-black text-emerald-700 flex items-center gap-2">
                            <Package size={14} className="text-emerald-500 shrink-0"/>{systemConfig.own_client_name || 'Bodega Propia'}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Cantidad *</label>
                        <input type="number" min="1" value={kitBuildForm.qty} onChange={e=>{ setKitBuildForm({...kitBuildForm,qty:parseInt(e.target.value)||1}); setKitAvailability(null); }} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500"/>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Ubicación Destino</label>
                        <input type="text" value={kitBuildForm.location} onChange={e=>setKitBuildForm({...kitBuildForm,location:e.target.value.toUpperCase()})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 uppercase"/>
                      </div>
                    </div>
                    <button onClick={handleCheckKitAvailability} className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-black py-3 rounded-2xl uppercase text-xs tracking-widest transition-colors flex items-center justify-center gap-2"><RefreshCcw size={14}/> Verificar Disponibilidad</button>
                    {kitAvailability && (
                      <div className={`rounded-2xl p-5 border-2 ${kitAvailability.can_build?'bg-emerald-50 border-emerald-300':'bg-red-50 border-red-300'}`}>
                        <p className={`text-sm font-black uppercase tracking-tighter mb-3 ${kitAvailability.can_build?'text-emerald-700':'text-red-700'}`}>{kitAvailability.can_build?'✅ Stock suficiente para armar':'⛔ Stock insuficiente'}</p>
                        <div className="space-y-2">
                          {(kitAvailability.components||[]).map(c=>(
                            <div key={c.component_sku} className="flex items-center justify-between text-[11px] bg-white rounded-xl px-4 py-2 border border-slate-100">
                              <span className="font-black uppercase text-slate-700">{c.component_sku}</span>
                              <span className="text-slate-500">Necesario: <strong>{c.needed}</strong></span>
                              <span className={`font-black ${c.available>=c.needed?'text-emerald-600':'text-red-600'}`}>Disponible: {c.available}</span>
                            </div>
                          ))}
                        </div>
                        {kitAvailability.can_build && (
                          <button onClick={handleBuildKit} className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 rounded-2xl uppercase text-xs tracking-widest shadow-lg shadow-indigo-200 transition-colors flex items-center justify-center gap-2"><Package size={16}/> Confirmar Armado</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                )}

                {/* SUB-TAB DESPACHO DIRECTO */}
                {kittingTab === 'dispatch' && (
                <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8 max-w-2xl">
                  <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center mb-2">
                    <ArrowRightLeft className="w-5 h-5 mr-2 text-emerald-500"/> Despacho Directo de Kit
                  </h2>
                  <p className="text-xs text-slate-400 font-bold mb-6">Consume los componentes directamente sin crear un LPN de kit previo.</p>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Kit (SKU) *</label>
                        <select value={kitDispatchForm.kit_sku}
                          onChange={e=>{ setKitDispatchForm({...kitDispatchForm, kit_sku:e.target.value}); setKitDispatchAvail(null); }}
                          className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-emerald-500 bg-white">
                          <option value="">-- Seleccionar --</option>
                          {kits.map(k=><option key={`${k.kit_sku}-${k.client_id}`} value={k.kit_sku}>{k.kit_sku}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Cliente *</label>
                        {is3PLMode ? (
                          <select value={kitDispatchForm.client_id}
                            onChange={e=>{ setKitDispatchForm({...kitDispatchForm, client_id:e.target.value}); setKitDispatchAvail(null); }}
                            className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-emerald-500 bg-white">
                            <option value="">-- Seleccionar --</option>
                            {permittedClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        ) : (
                          <div className="w-full border-2 border-emerald-200 bg-emerald-50 rounded-xl px-4 py-3 text-sm font-black text-emerald-700 flex items-center gap-2">
                            <Package size={14} className="text-emerald-500 shrink-0"/>{systemConfig.own_client_name || 'Bodega Propia'}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Cantidad *</label>
                        <input type="number" min="1"
                          value={kitDispatchForm.qty}
                          onChange={e=>{ setKitDispatchForm({...kitDispatchForm, qty:parseInt(e.target.value)||1}); setKitDispatchAvail(null); }}
                          className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-emerald-500"/>
                      </div>
                      <div className="col-span-2 space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">N° Documento</label>
                        <input type="text"
                          value={kitDispatchForm.doc_num}
                          onChange={e=>setKitDispatchForm({...kitDispatchForm, doc_num:e.target.value.toUpperCase()})}
                          placeholder="Ej: GD-2024-001"
                          className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-emerald-500 uppercase"/>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase">Glosa / Motivo</label>
                      <input type="text"
                        value={kitDispatchForm.glosa}
                        onChange={e=>setKitDispatchForm({...kitDispatchForm, glosa:e.target.value})}
                        placeholder="Ej: Pedido cliente, orden de producción, etc."
                        className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-emerald-500"/>
                    </div>

                    <button onClick={handleCheckKitDispatchAvail}
                      className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-black py-3 rounded-2xl uppercase text-xs tracking-widest transition-colors flex items-center justify-center gap-2">
                      <RefreshCcw size={14}/> Verificar Stock de Componentes
                    </button>

                    {kitDispatchAvail && (
                      <div className={`rounded-2xl p-5 border-2 ${kitDispatchAvail.can_build ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-red-300'}`}>
                        <p className={`text-sm font-black uppercase tracking-tighter mb-3 ${kitDispatchAvail.can_build ? 'text-emerald-700' : 'text-red-700'}`}>
                          {kitDispatchAvail.can_build ? '✅ Stock suficiente — listo para despachar' : '⛔ Stock insuficiente para despachar'}
                        </p>

                        {/* Tabla de componentes */}
                        <div className="space-y-2 mb-4">
                          {(kitDispatchAvail.components || []).map(c => {
                            const ok = c.available >= c.needed;
                            return (
                              <div key={c.component_sku} className="flex items-center justify-between text-[11px] bg-white rounded-xl px-4 py-2.5 border border-slate-100 gap-3">
                                <span className="font-black uppercase text-slate-700 flex-1 truncate">{c.component_sku}</span>
                                <span className="text-slate-400 shrink-0">×{c.required_per_kit} por kit</span>
                                <span className="text-slate-500 shrink-0">Requerido: <strong>{c.needed}</strong></span>
                                <span className={`font-black shrink-0 ${ok ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {ok ? '✓' : '✗'} Disp: {c.available}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        {/* Resumen de qué se va a descontar */}
                        {kitDispatchAvail.can_build && (
                          <div className="bg-white rounded-xl border border-emerald-200 px-4 py-3 mb-4">
                            <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-2">Al confirmar se descuentan:</p>
                            <div className="flex flex-wrap gap-2">
                              {(kitDispatchAvail.components || []).map(c => (
                                <span key={c.component_sku} className="bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1 text-[10px] font-black text-emerald-800">
                                  {c.needed} × {c.component_sku}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {kitDispatchAvail.can_build && (
                          <button onClick={handleDirectKitDispatch}
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-4 rounded-2xl uppercase text-xs tracking-widest shadow-lg shadow-emerald-200 transition-colors flex items-center justify-center gap-2">
                            <ArrowRightLeft size={16}/> Confirmar Despacho Directo {kitDispatchForm.qty}x {kitDispatchForm.kit_sku}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                )}

                {/* SUB-TAB ÓRDENES DE KIT */}
                {kittingTab === 'orders' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><ClipboardCheck className="text-indigo-500"/> Historial de Armados</h2>
                  </div>
                  <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          <th className="p-4 text-[10px] font-black text-slate-400 uppercase">Fecha</th>
                          <th className="p-4 text-[10px] font-black text-slate-400 uppercase">Tipo</th>
                          <th className="p-4 text-[10px] font-black text-slate-400 uppercase">Kit SKU</th>
                          <th className="p-4 text-[10px] font-black text-slate-400 uppercase">Cliente</th>
                          <th className="p-4 text-center text-[10px] font-black text-slate-400 uppercase">Qty</th>
                          <th className="p-4 text-[10px] font-black text-slate-400 uppercase">LPN / Notas</th>
                          <th className="p-4 text-[10px] font-black text-slate-400 uppercase">Operador</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {kitOrders.map(o => {
                          const isDispatch = o.type === 'DISPATCHED';
                          return (
                            <tr key={o.id} className={`hover:bg-slate-50 ${isDispatch ? 'bg-emerald-50/30' : ''}`}>
                              <td className="p-4 text-[10px] text-slate-400">{new Date(o.created_at).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})}</td>
                              <td className="p-4">
                                <span className={`text-[9px] font-black px-2 py-1 rounded-full uppercase ${isDispatch ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
                                  {isDispatch ? '↗ Despacho Directo' : '🔧 Armado'}
                                </span>
                              </td>
                              <td className="p-4 font-black text-xs uppercase text-slate-800">{o.kit_sku}</td>
                              <td className="p-4 text-xs text-slate-600">{o.client_id}</td>
                              <td className="p-4 text-center font-black text-slate-800">{o.qty_to_build}</td>
                              <td className="p-4 font-mono text-[9px] text-slate-500">
                                {isDispatch ? (o.notes || '—') : (o.result_lpn || '—')}
                              </td>
                              <td className="p-4 text-[10px] text-slate-400">{o.created_by}</td>
                            </tr>
                          );
                        })}
                        {kitOrders.length === 0 && <tr><td colSpan="7" className="p-8 text-center text-slate-400 text-xs">Sin órdenes registradas</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
                )}
              </div>
            )}

            {/* CLIENTES */}
            {activeTab === 'clients' && is3PLMode && canManageMasters && (
              <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
                <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row gap-8">
                  <div className="flex-1 space-y-6 border-r border-slate-100 pr-8">
                    <div>
                      <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center"><Users className="w-5 h-5 mr-2 text-indigo-500"/> Registro de Clientes</h2>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Añadir dueños de mercadería (Operación Multi-Cliente)</p>
                    </div>
                    <form onSubmit={handleSaveClient} className="space-y-6">
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">ID / RUT / CUIT *</label><input type="text" value={clientForm.id} onChange={e=>setClientForm({...clientForm, id: e.target.value.toUpperCase().replace(/\s/g, '')})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 uppercase" placeholder="Ej: CLI-001"/></div>
                          <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Razón Social / Nombre *</label><input type="text" value={clientForm.name} onChange={e=>setClientForm({...clientForm, name: e.target.value})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder="Nombre de la empresa"/></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Contacto (Persona)</label><input type="text" value={clientForm.contact} onChange={e=>setClientForm({...clientForm, contact: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder="Nombre del responsable"/></div>
                          <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Email</label><input type="email" value={clientForm.email} onChange={e=>setClientForm({...clientForm, email: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder="correo@empresa.com"/></div>
                        </div>
                      </div>
                      <button type="submit" disabled={isSavingClient} className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-200 uppercase text-xs tracking-widest hover:bg-indigo-700 transition-colors mt-4 flex justify-center items-center disabled:opacity-60">
                        {isSavingClient ? <><Loader2 size={16} className="mr-2 animate-spin"/> Guardando...</> : <><Building2 size={16} className="mr-2"/> Guardar Cliente en Base de Datos</>}
                      </button>
                    </form>
                  </div>
                  <div className="flex-[1.5] overflow-y-auto max-h-[500px] custom-scrollbar pr-2">
                    <div className="sticky top-0 bg-white pt-2 pb-3 z-10 border-b border-slate-100 space-y-2 mb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Clientes ({permittedClients.filter(c=>(c.id||'').toLowerCase().includes(clientSearchTerm.toLowerCase())||(c.name||'').toLowerCase().includes(clientSearchTerm.toLowerCase())).length})</p>
                          <button onClick={() => { const filtered = permittedClients.filter(c=>(c.id||'').toLowerCase().includes(clientSearchTerm.toLowerCase())||(c.name||'').toLowerCase().includes(clientSearchTerm.toLowerCase())); const headers='id,name,contact,email'; const csv=filtered.map(c=>`"${c.id}","${c.name}","${c.contact||''}","${c.email||''}"`).join('\n'); const blob=new Blob([headers+'\n'+csv],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='clientes_filtrados.csv'; a.click(); }} className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-2 py-1 rounded-lg text-[9px] font-black uppercase flex items-center gap-1"><Download size={10}/> CSV</button>
                          <button onClick={() => setImportModal({ type: 'clients' })} className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1 rounded-lg text-[9px] font-black uppercase flex items-center gap-1"><Upload size={10}/> Importar</button>
                        </div>
                      </div>
                      <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-2 py-1"><Search size={11} className="text-slate-400 mr-1 shrink-0"/><input type="text" placeholder="Buscar por ID o nombre..." value={clientSearchTerm} onChange={(e) => setClientSearchTerm(e.target.value)} className="bg-transparent text-[10px] font-bold outline-none w-full text-slate-700"/></div>
                    </div>
                    <div className="space-y-3">
                      {permittedClients.filter(c => (c.id || '').toLowerCase().includes(clientSearchTerm.toLowerCase()) || (c.name || '').toLowerCase().includes(clientSearchTerm.toLowerCase())).map(c => (
                        <div key={c.id} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col hover:bg-white transition-colors shadow-sm">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <p className="text-sm font-black text-slate-800 flex items-center gap-2">{c.name}</p>
                              <p className="text-[10px] font-mono text-indigo-600 mt-1">ID: {c.id}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={() => { setPortalConfigClient(c.id); setPortalConfigForm({ portal_enabled: !!c.portal_enabled, portal_password:'', portal_email: c.portal_email||'' }); }} className="text-[9px] font-black bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-2 py-1 rounded-lg uppercase flex items-center gap-1 transition-colors"><Globe size={10}/> Portal</button>
                              <button onClick={() => handleDeleteClient(c.id)} className="text-slate-300 hover:text-red-500 transition-colors ml-2"><Trash2 size={14}/></button>
                            </div>
                          </div>
                          {(c.contact || c.email) && (
                            <div className="mt-2 pt-2 border-t border-slate-100 flex gap-4 text-[9px] text-slate-500 font-bold tracking-widest">
                              {c.contact && <span>Contacto: {c.contact}</span>}
                              {c.email && <span>Email: {c.email}</span>}
                            </div>
                          )}
                          {/* Portal config expandida */}
                          {portalConfigClient === c.id && (
                            <div className="mt-3 pt-3 border-t-2 border-indigo-100 bg-indigo-50 rounded-2xl p-4 space-y-3">
                              <p className="text-[10px] font-black text-indigo-700 uppercase tracking-widest flex items-center gap-1"><Globe size={10}/> Configuración Portal 3PL</p>
                              <div className="flex items-center gap-3">
                                <label className="text-[10px] font-black text-slate-600 uppercase">Portal Habilitado</label>
                                <button onClick={()=>setPortalConfigForm(f=>({...f,portal_enabled:!f.portal_enabled}))} className={`w-10 h-6 rounded-full transition-colors ${portalConfigForm.portal_enabled?'bg-indigo-600':'bg-slate-300'}`}><span className={`block w-4 h-4 bg-white rounded-full shadow transition-transform mx-1 ${portalConfigForm.portal_enabled?'translate-x-4':'translate-x-0'}`}/></button>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-500 uppercase">Nueva Contraseña Portal</label>
                                <input type="password" placeholder="Dejar vacío para no cambiar" value={portalConfigForm.portal_password} onChange={e=>setPortalConfigForm(f=>({...f,portal_password:e.target.value}))} className="w-full border-2 border-indigo-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500"/>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-500 uppercase">Email del Portal</label>
                                <input type="email" placeholder="email@cliente.com" value={portalConfigForm.portal_email} onChange={e=>setPortalConfigForm(f=>({...f,portal_email:e.target.value}))} className="w-full border-2 border-indigo-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500"/>
                              </div>
                              {portalConfigForm.portal_enabled && (
                                <div className="bg-white rounded-xl px-3 py-2 border border-indigo-200">
                                  <p className="text-[9px] font-black text-slate-400 uppercase mb-1">URL del Portal</p>
                                  <p className="font-mono text-[10px] text-indigo-700 break-all">{window.location.origin}?portal={c.id}</p>
                                </div>
                              )}
                              <div className="flex gap-2">
                                <button onClick={()=>handlePortalSaveConfig(c.id)} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black py-2 rounded-xl text-[10px] uppercase tracking-widest transition-colors">Guardar</button>
                                <button onClick={()=>setPortalConfigClient(null)} className="px-4 bg-slate-200 hover:bg-slate-300 text-slate-600 font-black py-2 rounded-xl text-[10px] uppercase tracking-widest transition-colors">Cancelar</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      {permittedClients.length === 0 && <div className="p-8 text-center text-slate-400"><Building2 className="w-12 h-12 mx-auto mb-2 opacity-50"/><p className="text-[10px] uppercase tracking-widest font-bold">No hay clientes visibles para usted</p></div>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* MAESTRO ESTADOS */}
            {activeTab === 'statuses' && canManageMasters && (
              <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
                <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row gap-8">
                  <div className="flex-1 space-y-6 border-r border-slate-100 pr-8">
                    <div>
                      <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center"><Activity className="w-5 h-5 mr-2 text-indigo-500"/> Maestro de Estados</h2>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Configurar colores y reglas de bloqueo</p>
                    </div>
                    <form onSubmit={handleSaveStatus} className="space-y-6">
                      <div className="space-y-4">
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">ID Estado (Ej: BASURA, RETENIDO) *</label><input type="text" value={statusForm.id} onChange={e=>setStatusForm({...statusForm, id: e.target.value.toUpperCase().replace(/\s/g, '_')})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 uppercase" placeholder="Ej: EN_REVISION"/></div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Descripción / Uso *</label><input type="text" value={statusForm.description} onChange={e=>setStatusForm({...statusForm, description: e.target.value})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder="Motivo de este estado"/></div>
                        
                        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                          <div className="space-y-1">
                             <label className="text-[10px] font-black text-slate-400 uppercase">Color Visual</label>
                             <select value={statusForm.color} onChange={e=>setStatusForm({...statusForm, color: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 bg-white">
                               <option value="slate">Gris (Defecto)</option>
                               <option value="emerald">Verde</option>
                               <option value="red">Rojo</option>
                               <option value="amber">Amarillo / Naranja</option>
                               <option value="blue">Azul</option>
                               <option value="purple">Morado</option>
                               <option value="pink">Rosa</option>
                             </select>
                          </div>
                          <div className="space-y-1 flex flex-col justify-center">
                             <label className="flex items-center gap-2 cursor-pointer mt-4">
                               <input type="checkbox" checked={statusForm.blocks_outbound} onChange={e=>setStatusForm({...statusForm, blocks_outbound: e.target.checked})} className="w-5 h-5 accent-indigo-600 rounded" />
                               <span className="text-xs font-black text-slate-700 uppercase">Bloquea Despacho</span>
                             </label>
                             <p className="text-[9px] text-slate-400 mt-1 leading-tight">Si se marca, el LPN no aparecerá en el módulo de Despachos.</p>
                          </div>
                        </div>

                      </div>
                      <button type="submit" className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-200 uppercase text-xs tracking-widest hover:bg-indigo-700 transition-colors mt-4 flex justify-center items-center"><Plus size={16} className="mr-2"/> Guardar Estado</button>
                    </form>
                  </div>
                  <div className="flex-[1.5] overflow-y-auto max-h-[500px] custom-scrollbar pr-2">
                    <div className="flex justify-between items-center mb-4 sticky top-0 bg-white pt-2 pb-2 z-10 border-b border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Estados Registrados ({statuses.length})</p>
                    </div>
                    <div className="space-y-3">
                      {statuses.map(s => (
                        <div key={s.id} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col hover:bg-white transition-colors shadow-sm">
                          <div className="flex justify-between items-center mb-1">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-1 rounded text-[10px] font-black uppercase border ${getStatusBadge(s.id)}`}>{s.id}</span>
                              {s.blocks_outbound && <span className="text-[8px] bg-red-100 text-red-700 px-2 py-0.5 rounded flex items-center font-bold uppercase"><ShieldAlert size={10} className="mr-1"/> Bloquea Salida</span>}
                            </div>
                            {s.id !== 'DISPONIBLE' && (
                              <button onClick={() => handleDeleteStatus(s.id)} className="text-slate-300 hover:text-red-500 transition-colors ml-2"><Trash2 size={14}/></button>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 font-bold mt-2">{s.description}</p>
                        </div>
                      ))}
                      {statuses.length === 0 && <div className="p-8 text-center text-slate-400"><Activity className="w-12 h-12 mx-auto mb-2 opacity-50"/><p className="text-[10px] uppercase tracking-widest font-bold">No hay estados configurados</p></div>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* MAESTRO DOCUMENTOS */}
            {activeTab === 'doc-types' && canManageMasters && (
              <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
                <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row gap-8">
                  <div className="flex-1 space-y-6 border-r border-slate-100 pr-8">
                    <div>
                      <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center"><FileType className="w-5 h-5 mr-2 text-indigo-500"/> Maestro de Documentos</h2>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Configurar tipos de documentos admitidos (Factura, Guía, etc.)</p>
                    </div>
                    <form onSubmit={handleSaveDocType} className="space-y-6">
                      <div className="space-y-4">
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">ID Documento (Ej: FACTURA, GUIA) *</label><input type="text" value={docTypeForm.id} onChange={e=>setDocTypeForm({...docTypeForm, id: e.target.value.toUpperCase().replace(/\s/g, '_')})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 uppercase" placeholder="Ej: FACTURA_VENTA"/></div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Descripción *</label><input type="text" value={docTypeForm.description} onChange={e=>setDocTypeForm({...docTypeForm, description: e.target.value})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder="Ej: Factura de Venta Electrónica"/></div>
                        <div className="space-y-1">
                           <label className="text-[10px] font-black text-slate-400 uppercase">Flujo Permitido</label>
                           <select value={docTypeForm.flow_type} onChange={e=>setDocTypeForm({...docTypeForm, flow_type: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 bg-white">
                             <option value="BOTH">Ambos (Recepción y Despacho)</option>
                             <option value="INBOUND">Solo Recepción (Inbound)</option>
                             <option value="OUTBOUND">Solo Despacho (Outbound)</option>
                           </select>
                        </div>
                      </div>
                      <button type="submit" className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-200 uppercase text-xs tracking-widest hover:bg-indigo-700 transition-colors mt-4 flex justify-center items-center"><Plus size={16} className="mr-2"/> Guardar Tipo de Documento</button>
                    </form>
                  </div>
                  <div className="flex-[1.5] overflow-y-auto max-h-[500px] custom-scrollbar pr-2">
                    <div className="flex justify-between items-center mb-4 sticky top-0 bg-white pt-2 pb-2 z-10 border-b border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipos de Documento Registrados ({documentTypes.length})</p>
                    </div>
                    <div className="space-y-3">
                      {documentTypes.map(d => (
                        <div key={d.id} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col hover:bg-white transition-colors shadow-sm">
                          <div className="flex justify-between items-center mb-1">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-1 rounded text-[10px] font-black uppercase border bg-slate-100 text-slate-600 border-slate-200">{d.id}</span>
                              <span className="text-[8px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded flex items-center font-bold uppercase">{d.flow_type === 'BOTH' ? 'AMBOS' : d.flow_type === 'INBOUND' ? 'RECEPCIÓN' : 'DESPACHO'}</span>
                            </div>
                            <button onClick={() => handleDeleteDocType(d.id)} className="text-slate-300 hover:text-red-500 transition-colors ml-2"><Trash2 size={14}/></button>
                          </div>
                          <p className="text-xs text-slate-600 font-bold mt-2">{d.description}</p>
                        </div>
                      ))}
                      {documentTypes.length === 0 && <div className="p-8 text-center text-slate-400"><FileType className="w-12 h-12 mx-auto mb-2 opacity-50"/><p className="text-[10px] uppercase tracking-widest font-bold">No hay tipos de documento</p></div>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* INVENTORY */}
            {activeTab === 'inventory' && (
              <div className="space-y-4 animate-in fade-in max-w-7xl mx-auto">
                <div className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <h1 className="text-xl sm:text-2xl font-black text-slate-800 uppercase tracking-tighter leading-tight flex items-center gap-2">
                      Inventario Físico
                      {!is3PLMode && <span className="text-xs px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-700 font-black normal-case tracking-normal">{systemConfig.own_client_name || 'Bodega Propia'}</span>}
                    </h1>
                    <div className="flex gap-1.5 shrink-0 items-center">
                      {/* Toggle vista — oculto para CLIENTE (siempre consolidado) */}
                      {currentUser?.role !== 'CLIENTE' && <div className="flex bg-slate-100 p-1 rounded-xl">
                        <button onClick={()=>setInvView('lpn')} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-1 ${invView==='lpn'?'bg-white text-indigo-700 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>
                          <Package size={10}/> LPNs
                        </button>
                        <button onClick={()=>setInvView('consolidado')} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-1 ${invView==='consolidado'?'bg-white text-indigo-700 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>
                          <BarChart3 size={10}/> Saldo
                        </button>
                      </div>}
                      <button onClick={() => window.open(`${host}/api/export/inventory`, '_blank')} className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-2 sm:px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center gap-1 shadow-sm"><Download size={12}/> <span className="hidden sm:inline">Exportar</span></button>
                      <button onClick={() => setImportModal({ type: 'inventory' })} className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 sm:px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center gap-1 shadow-sm"><Upload size={12}/> <span className="hidden sm:inline">Importar</span></button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-indigo-200 transition-all flex-1">
                      <Search size={14} className="text-slate-400 mr-2 shrink-0" />
                      <input type="text" placeholder="Buscar producto, código o ubicación..." value={invSearchTerm} onChange={(e) => { setInvSearchTerm(e.target.value); setInvPage(0); }} className="bg-transparent text-xs font-bold outline-none w-full text-slate-700" />
                    </div>
                    <select value={invStatusFilter} onChange={(e) => { setInvStatusFilter(e.target.value); setInvPage(0); }} className="bg-white border border-slate-200 rounded-xl px-2 sm:px-3 py-2 text-[10px] sm:text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-200 shadow-sm text-slate-700 uppercase">
                      <option value="">Todos</option>
                      <option value="DISPONIBLE">DISPONIBLE</option>
                      {statuses.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
                    </select>
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <div className="bg-white px-3 py-2 rounded-xl border border-slate-200 shadow-sm flex items-center gap-2">
                     <span className="text-[10px] font-black text-slate-400 uppercase">Total LPNs:</span>
                     <span className="text-sm font-black text-slate-700">{permittedInventory.length}</span>
                  </div>
                  {Object.entries(permittedInventory.reduce((acc, curr) => { const s = curr.status || 'DISPONIBLE'; acc[s] = (acc[s] || 0) + 1; return acc; }, {})).map(([status, count]) => (
                    <div key={status} className={`px-3 py-2 rounded-xl border shadow-sm flex items-center gap-2 ${getStatusBadge(status)}`}>
                       <span className="text-[10px] font-black uppercase">{status}:</span>
                       <span className="text-sm font-black">{count}</span>
                    </div>
                  ))}
                </div>

                {/* ── VISTA SALDO CONSOLIDADO ── */}
                {(invView === 'consolidado' || currentUser?.role === 'CLIENTE') && (() => {
                  // Agrupar filteredInventory por sku (+ client_id solo en 3PL/HYBRID)
                  const base = showHistory && snapshotDate ? snapshotData : showHistory ? historyData : filteredInventory;
                  const groups = {};
                  base.forEach(i => {
                    const key = is3PLMode ? `${i.sku}||${i.client_id||''}` : i.sku;
                    if (!groups[key]) groups[key] = { sku: i.sku, client_id: i.client_id||'', desc: i.desc||'', byStatus: {}, locations: new Set(), totalQty: 0 };
                    const st = i.status || 'DISPONIBLE';
                    groups[key].byStatus[st] = (groups[key].byStatus[st] || 0) + parseFloat(i.qty||0);
                    groups[key].totalQty += parseFloat(i.qty||0);
                    if (i.location_id) groups[key].locations.add(i.location_id);
                  });
                  const rows = Object.values(groups).sort((a,b) => b.totalQty - a.totalQty);
                  const totalGeneral = rows.reduce((s,r) => s + r.totalQty, 0);
                  const allStatuses = [...new Set(base.map(i => i.status || 'DISPONIBLE'))].sort();

                  return (
                    <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
                      {/* KPI resumen */}
                      <div className="flex flex-wrap gap-3 p-5 border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-white">
                        <div className="flex flex-col">
                          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">SKUs únicos</span>
                          <span className="text-2xl font-black text-indigo-700">{rows.length}</span>
                        </div>
                        <div className="w-px bg-slate-200"/>
                        <div className="flex flex-col">
                          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Unidades totales</span>
                          <span className="text-2xl font-black text-slate-800">{totalGeneral.toLocaleString()}</span>
                        </div>
                        <div className="w-px bg-slate-200"/>
                        {allStatuses.map(st => (
                          <div key={st} className="flex flex-col">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{st}</span>
                            <span className={`text-xl font-black ${st==='DISPONIBLE'?'text-emerald-600':st==='BLOQUEADO'?'text-red-600':'text-amber-600'}`}>
                              {rows.reduce((s,r) => s + (r.byStatus[st]||0), 0).toLocaleString()}
                            </span>
                          </div>
                        ))}
                        {currentUser?.role !== 'CLIENTE' && (
                          <div className="ml-auto">
                            <button onClick={() => {
                              const statusCols = allStatuses;
                              const headers = ['sku','desc',...(is3PLMode?['client_id','client_name']:[]),...statusCols,'total_qty','locations'].join(',');
                              const csv = rows.map(r => {
                                const clientName = clients.find(c=>c.id===r.client_id)?.name || r.client_id || 'GENERAL';
                                const cells = [
                                  r.sku,
                                  (r.desc||'').replace(/"/g,"'"),
                                  ...(is3PLMode?[r.client_id||'',clientName]:[]),
                                  ...statusCols.map(st => r.byStatus[st] || 0),
                                  r.totalQty,
                                  [...r.locations].join('|'),
                                ];
                                return cells.map(v => `"${v}"`).join(',');
                              }).join('\n');
                              const blob = new Blob([headers+'\n'+csv],{type:'text/csv'});
                              const a = document.createElement('a');
                              a.href = URL.createObjectURL(blob);
                              a.download = `inventario_consolidado_${new Date().toISOString().slice(0,10)}.csv`;
                              a.click();
                            }} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow-sm transition-colors">
                              <Download size={12}/> Exportar CSV
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left min-w-[700px]">
                          <thead className="bg-slate-50 border-b">
                            <tr>
                              <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase">SKU / Descripción</th>
                              {is3PLMode && <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">Cliente</th>}
                              <th className="px-4 py-3 text-right text-[10px] font-black text-emerald-600 uppercase">Disponible</th>
                              <th className="px-4 py-3 text-right text-[10px] font-black text-red-500 uppercase">Bloqueado</th>
                              <th className="px-4 py-3 text-right text-[10px] font-black text-amber-600 uppercase">Cuarentena</th>
                              <th className="px-4 py-3 text-right text-[10px] font-black text-slate-600 uppercase">Total</th>
                              {currentUser?.role !== 'CLIENTE' && <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">Ubicaciones</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {rows.length === 0 && (
                              <tr><td colSpan={is3PLMode ? (currentUser?.role === 'CLIENTE' ? 6 : 7) : (currentUser?.role === 'CLIENTE' ? 5 : 6)} className="p-8 text-center text-slate-400 text-xs">Sin stock consolidado para los filtros aplicados.</td></tr>
                            )}
                            {rows.map(r => {
                              const disp = r.byStatus['DISPONIBLE'] || 0;
                              const bloq = r.byStatus['BLOQUEADO'] || 0;
                              const cuar = r.byStatus['CUARENTENA'] || 0;
                              const locs = [...r.locations];
                              const clientName = clients.find(c=>c.id===r.client_id)?.name || r.client_id || 'GENERAL';
                              return (
                                <tr key={is3PLMode ? `${r.sku}||${r.client_id}` : r.sku} className="hover:bg-indigo-50/30 transition-colors">
                                  <td className="px-5 py-3">
                                    <p className="text-xs font-black text-slate-800 uppercase">{r.sku}</p>
                                    <p className="text-[9px] text-slate-400 truncate max-w-[200px]">{r.desc}</p>
                                  </td>
                                  {is3PLMode && <td className="px-4 py-3">
                                    <span className="text-[10px] font-bold text-indigo-700 uppercase flex items-center gap-1"><Building2 size={9}/>{clientName}</span>
                                  </td>}
                                  <td className="px-4 py-3 text-right">
                                    <span className={`text-sm font-black ${disp>0?'text-emerald-600':'text-slate-300'}`}>{disp>0?disp.toLocaleString():'—'}</span>
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <span className={`text-sm font-black ${bloq>0?'text-red-500':'text-slate-300'}`}>{bloq>0?bloq.toLocaleString():'—'}</span>
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <span className={`text-sm font-black ${cuar>0?'text-amber-600':'text-slate-300'}`}>{cuar>0?cuar.toLocaleString():'—'}</span>
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <span className="text-base font-black text-slate-800">{r.totalQty.toLocaleString()}</span>
                                  </td>
                                  {currentUser?.role !== 'CLIENTE' && <td className="px-4 py-3">
                                    <div className="flex flex-wrap gap-1">
                                      {locs.slice(0,3).map(l => (
                                        <span key={l} className="bg-slate-100 border border-slate-200 rounded font-mono text-[8px] font-bold text-slate-600 px-1.5 py-0.5">{l}</span>
                                      ))}
                                      {locs.length > 3 && <span className="text-[8px] text-slate-400 font-bold">+{locs.length-3}</span>}
                                    </div>
                                  </td>}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* ── VISTA LPN (original) ── */}
                {invView === 'lpn' && currentUser?.role !== 'CLIENTE' && <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                  <table className="w-full text-left min-w-[900px]">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="px-5 pt-4 pb-1 text-[10px] font-black text-slate-400 uppercase">ID Movimiento / LPN</th>
                        <th className="px-5 pt-4 pb-1 text-[10px] font-black text-slate-400 uppercase">Ubicación y Estado</th>
                        <th className="px-5 pt-4 pb-1 text-[10px] font-black text-slate-400 uppercase">SKU / Producto</th>
                        {is3PLMode && <th className="px-5 pt-4 pb-1 text-[10px] font-black text-slate-400 uppercase">Cliente</th>}
                        <th className="px-5 pt-4 pb-1 text-right text-[10px] font-black text-slate-400 uppercase">Cantidad</th>
                        <th className="px-5 pt-4 pb-1 text-center text-[10px] font-black text-slate-400 uppercase">
                          {(invSearchTerm||invStatusFilter||invClientFilter||invSkuFilter||invLocFilter) && (
                            <button onClick={() => { setInvSearchTerm(''); setInvStatusFilter(''); setInvClientFilter(''); setInvSkuFilter(''); setInvLocFilter(''); }} className="bg-red-100 text-red-500 border border-red-200 rounded-lg px-2 py-1 text-[8px] font-black uppercase flex items-center gap-1 ml-auto"><X size={8}/> Limpiar</button>
                          )}
                        </th>
                      </tr>
                      <tr className="border-t border-slate-100">
                        <td className="px-3 pb-3 pt-1">
                          <input type="text" placeholder="🔍 Buscar LPN..." value={invSearchTerm} onChange={e=>setInvSearchTerm(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:border-indigo-400 bg-white text-slate-700 placeholder-slate-300"/>
                        </td>
                        <td className="px-3 pb-3 pt-1">
                          <div className="flex flex-col gap-1">
                            <input type="text" placeholder="🔍 Ubicación..." value={invLocFilter} onChange={e=>setInvLocFilter(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:border-indigo-400 bg-white text-slate-700 placeholder-slate-300"/>
                            <select value={invStatusFilter} onChange={e=>setInvStatusFilter(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:border-indigo-400 bg-white text-slate-700 uppercase">
                              <option value="">Todos los estados</option>
                              <option value="DISPONIBLE">DISPONIBLE</option>
                              {statuses.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
                            </select>
                          </div>
                        </td>
                        <td className="px-3 pb-3 pt-1">
                          <select value={invSkuFilter} onChange={e=>setInvSkuFilter(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:border-indigo-400 bg-white text-slate-700 uppercase">
                            <option value="">Todos los SKUs</option>
                            {[...new Set(permittedInventory.map(i=>i.sku))].sort().map(sku=><option key={sku} value={sku}>{sku}</option>)}
                          </select>
                        </td>
                        {is3PLMode && (
                          <td className="px-3 pb-3 pt-1">
                            <select value={invClientFilter} onChange={e=>setInvClientFilter(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:border-indigo-400 bg-white text-slate-700">
                              <option value="">Todos los clientes</option>
                              {permittedClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </td>
                        )}
                        <td className="px-3 pb-3 pt-1" colSpan="2">
                          <div className="flex gap-2 items-end">
                            <div className="flex flex-col gap-1 flex-1">
                              <span className="text-[8px] font-black text-indigo-500 uppercase">📸 Ver stock en otra fecha</span>
                              <input type="date" value={snapshotDate} onChange={e=>{setSnapshotDate(e.target.value); setShowHistory(false); setSnapshotData([]);}} className="w-full border-2 border-indigo-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:border-indigo-500 bg-indigo-50 text-indigo-700" title="Ver stock tal como estaba ese día"/>
                            </div>
                            <button onClick={loadSnapshot} disabled={isLoadingSnapshot || !snapshotDate} className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 border border-indigo-200 rounded-lg px-2 py-1.5 text-[9px] font-black uppercase flex items-center gap-1 whitespace-nowrap disabled:opacity-50">
                              {isLoadingSnapshot ? <Loader2 size={10} className="animate-spin"/> : <Search size={10}/>} Ver
                            </button>
                            {showHistory && snapshotDate && (
                              <button onClick={() => { setShowHistory(false); setSnapshotData([]); setSnapshotDate(''); }} className="bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-lg px-2 py-1.5 text-[9px] font-black uppercase flex items-center gap-1 whitespace-nowrap">
                                <X size={10}/> Volver
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(showHistory && snapshotDate ? snapshotData : showHistory ? historyData : filteredInventory.slice(invPage * INV_PAGE_SIZE, (invPage + 1) * INV_PAGE_SIZE)).map(i => (
                        <tr key={i.id} className={`hover:bg-slate-50 border-b border-slate-50 ${showHistory && parseFloat(i.qty) === 0 ? 'opacity-50' : ''}`}>
                          <td className="p-4">
                            <p className="font-mono text-[10px] font-black text-slate-500">{i.id}</p>
                            <p className="text-xs font-black text-slate-800 uppercase mt-1">{i.sku}</p>
                            <p className="text-[9px] text-slate-500 truncate max-w-[160px] mt-0.5">{i.desc}</p>
                          </td>
                          <td className="p-4">
                            <span className="bg-slate-100 px-2 py-1 rounded border border-slate-200 font-mono text-[10px] font-bold text-slate-700 block w-max mb-1">{i.location_id || 'PISO-RECEPCION'}</span>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${getStatusBadge(i.status)}`}>{statusLabel(i.status || 'DISPONIBLE')}</span>
                            {i.batch_number && <p className="text-[8px] font-black text-amber-700 uppercase mt-1">LT: {i.batch_number}</p>}
                            {i.serial_number && <p className="text-[8px] font-black text-indigo-700 uppercase mt-0.5">SN: {i.serial_number}</p>}
                          </td>
                          <td className="p-4">
                            <p className="text-xs font-black text-slate-800 uppercase">{i.sku}</p>
                            <p className="text-[9px] text-slate-400 truncate max-w-[150px]">{i.desc}</p>
                            {!is3PLMode && i.glosa && <p className="text-[9px] text-slate-400 italic mt-1 max-w-[150px] truncate">"{i.glosa}"</p>}
                          </td>
                          {is3PLMode && (
                            <td className="p-4">
                              <p className="text-[10px] font-bold text-indigo-700 uppercase"><Building2 size={10} className="inline mr-1"/>{clients.find(c => c.id === permittedSkus.find(s => s.sku === i.sku)?.client_id)?.name || i.client_id || 'GENERAL'}</p>
                              {showHistory && <p className="text-[8px] text-slate-400 mt-1">{i.created_at ? new Date(i.created_at).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'}) : ''}</p>}
                              {i.glosa && <p className="text-[9px] text-slate-400 italic mt-1 max-w-[150px] truncate">"{i.glosa}"</p>}
                            </td>
                          )}
                          <td className="p-4 text-right">
                            <span className={`font-black text-lg ${parseFloat(i.qty) === 0 ? 'text-red-400 line-through' : 'text-slate-800'}`}>{parseFloat(i.qty).toLocaleString()}</span>
                          </td>
                          <td className="p-4 text-center">
                            {!showHistory && <button onClick={() => handlePrintLabel(i)} className="bg-white p-2 rounded-full border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 shadow-sm transition-all"><Printer size={16}/></button>}
                            {showHistory && <span className={`text-[8px] font-black px-2 py-1 rounded uppercase ${parseFloat(i.qty) > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>{parseFloat(i.qty) > 0 ? 'Activo' : 'Consumido'}</span>}
                          </td>
                        </tr>
                      ))}
                      {!showHistory && filteredInventory.length === 0 && <tr><td colSpan={is3PLMode ? 6 : 5} className="p-8 text-center text-slate-500">No hay stock que coincida con los filtros.</td></tr>}
                      {/* Paginación UX-07 */}
                      {!showHistory && filteredInventory.length > INV_PAGE_SIZE && (
                        <tr>
                          <td colSpan={is3PLMode ? 6 : 5} className="px-4 py-3 border-t border-slate-100">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-slate-500">
                                Mostrando {invPage * INV_PAGE_SIZE + 1}–{Math.min((invPage + 1) * INV_PAGE_SIZE, filteredInventory.length)} de {filteredInventory.length} LPNs
                              </span>
                              <div className="flex gap-2">
                                <button disabled={invPage === 0} onClick={() => setInvPage(p => p - 1)} className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-40 transition-colors">← Anterior</button>
                                <button disabled={(invPage + 1) * INV_PAGE_SIZE >= filteredInventory.length} onClick={() => setInvPage(p => p + 1)} className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-40 transition-colors">Siguiente →</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      {showHistory && !isLoadingHistory && historyData.length === 0 && <tr><td colSpan="6" className="p-8 text-center text-slate-500">Sin registros históricos para los filtros aplicados.</td></tr>}
                      {showHistory && isLoadingHistory && <tr><td colSpan="6" className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin text-indigo-500 mx-auto"/></td></tr>}
                    </tbody>
                  </table>
                  </div>
                </div>}
              </div>
            )}

            {/* AUDIT */}
            {activeTab === 'audit' && canManageMasters && (
              <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
                <div className="flex flex-col gap-4 mb-4">
                  <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Historial de Auditoría</h1>
                    <button onClick={() => { const headers = 'id,type,sku,qty,glosa,username,created_at'; const csv = filteredAudit.map(l => `"${l.id}","${l.type}","${l.sku}","${l.qty}","${(l.glosa||'').replace(/"/g,"'")}","${l.username||''}","${l.created_at}"`).join('\n'); const blob = new Blob([headers+'\n'+csv],{type:'text/csv'}); const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='auditoria_filtrada.csv'; a.click(); }} className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center gap-1 shadow-sm"><Download size={12}/> Exportar Filtrado</button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <select value={auditTypeFilter} onChange={e=>{setAuditTypeFilter(e.target.value);setAuditPage(0);}} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none shadow-sm text-slate-700 uppercase">
                      <option value="">Todos los tipos</option>
                      <option value="INBOUND">Entrada</option>
                      <option value="OUTBOUND">Salida</option>
                      <option value="ADJUST_IN">Sobrante</option>
                      <option value="ADJUST_OUT">Merma</option>
                      <option value="RELOCATE">Reubicación</option>
                      <option value="STATUS_CHANGE">Cambio Estado</option>
                    </select>
                    <input type="text" placeholder="Filtrar por usuario..." value={auditUserFilter} onChange={e=>{setAuditUserFilter(e.target.value);setAuditPage(0);}} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none shadow-sm text-slate-700"/>
                    <input type="date" value={auditDateFrom} onChange={e=>{setAuditDateFrom(e.target.value);setAuditPage(0);}} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none shadow-sm text-slate-700" title="Fecha desde"/>
                    <input type="date" value={auditDateTo} onChange={e=>{setAuditDateTo(e.target.value);setAuditPage(0);}} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none shadow-sm text-slate-700" title="Fecha hasta"/>
                    {(auditTypeFilter||auditUserFilter||auditDateFrom||auditDateTo) && (
                      <button onClick={() => { setAuditTypeFilter(''); setAuditUserFilter(''); setAuditDateFrom(''); setAuditDateTo(''); }} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl px-3 py-2 text-[9px] font-black uppercase tracking-widest flex items-center gap-1 shadow-sm col-span-2"><X size={10}/> Limpiar Filtros</button>
                    )}
                  </div>
                </div>
                <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="px-5 pt-4 pb-1 text-[10px] font-black text-slate-400 uppercase">Fecha y Autor</th>
                        <th className="px-5 pt-4 pb-1 text-[10px] font-black text-slate-400 uppercase">Flujo</th>
                        <th className="px-5 pt-4 pb-1 text-[10px] font-black text-slate-400 uppercase">SKU</th>
                        <th className="px-5 pt-4 pb-1 text-center text-[10px] font-black text-slate-400 uppercase">Cant.</th>
                        <th className="px-5 pt-4 pb-1 text-[10px] font-black text-slate-400 uppercase">
                          {(auditTypeFilter||auditUserFilter||auditDateFrom||auditDateTo) && <button onClick={() => { setAuditTypeFilter(''); setAuditUserFilter(''); setAuditDateFrom(''); setAuditDateTo(''); }} className="bg-red-100 text-red-500 border border-red-200 rounded-lg px-2 py-1 text-[8px] font-black uppercase flex items-center gap-1 ml-auto"><X size={8}/> Limpiar</button>}
                        </th>
                      </tr>
                      <tr className="border-t border-slate-100">
                        <td className="px-3 pb-3 pt-1">
                          <div className="flex gap-1">
                            <input type="date" value={auditDateFrom} onChange={e=>setAuditDateFrom(e.target.value)} className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:border-indigo-400 bg-white text-slate-700" title="Desde"/>
                            <input type="date" value={auditDateTo} onChange={e=>setAuditDateTo(e.target.value)} className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:border-indigo-400 bg-white text-slate-700" title="Hasta"/>
                          </div>
                        </td>
                        <td className="px-3 pb-3 pt-1">
                          <select value={auditTypeFilter} onChange={e=>setAuditTypeFilter(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:border-indigo-400 bg-white text-slate-700 uppercase">
                            <option value="">Todos los tipos</option>
                            <option value="INBOUND">Entrada</option>
                            <option value="OUTBOUND">Salida</option>
                            <option value="ADJUST_IN">Sobrante</option>
                            <option value="ADJUST_OUT">Merma</option>
                            <option value="RELOCATE">Reubicación</option>
                            <option value="STATUS_CHANGE">Cambio Estado</option>
                          </select>
                        </td>
                        <td className="px-3 pb-3 pt-1">
                          <select value={auditTypeFilter === '' ? invSkuFilter : ''} onChange={e=>{}} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:border-indigo-400 bg-white text-slate-700 uppercase">
                            <option value="">Todos los SKUs</option>
                            {[...new Set(auditLogs.map(l=>l.sku))].sort().map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className="px-3 pb-3 pt-1"></td>
                        <td className="px-3 pb-3 pt-1">
                          <input type="text" placeholder="🔍 Usuario..." value={auditUserFilter} onChange={e=>setAuditUserFilter(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:border-indigo-400 bg-white text-slate-700"/>
                        </td>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredAudit.slice(auditPage * PAGE_SIZE, (auditPage + 1) * PAGE_SIZE).map(log => (
                        <tr key={log.id} className="hover:bg-slate-50">
                          <td className="p-5">
                            <p className="text-xs font-bold text-slate-600">{new Date(log.created_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'medium' })}</p>
                            <p className="text-[9px] font-black text-indigo-600 mt-1 uppercase">👤 {log.username || 'SYSTEM'}</p>
                          </td>
                          <td className="p-5">
                            <span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${
                              log.type === 'INBOUND' || log.type === 'ADJUST_IN' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 
                              log.type === 'OUTBOUND' || log.type === 'ADJUST_OUT' ? 'bg-red-100 text-red-800 border border-red-200' : 
                              'bg-purple-100 text-purple-800 border border-purple-200'
                            }`}>
                              {log.type === 'INBOUND' ? 'ENTRADA' : 
                               log.type === 'OUTBOUND' ? 'SALIDA' : 
                               log.type === 'ADJUST_IN' ? 'SOBRANTE (+)' : 
                               log.type === 'ADJUST_OUT' ? 'MERMA (-)' : 
                               log.type === 'STATUS_CHANGE' ? 'ESTADO FÍSICO' : 'REUBICACIÓN'}
                            </span>
                          </td>
                          <td className="p-5 text-xs font-black text-slate-800 uppercase">{log.sku}</td>
                          <td className="p-5 text-center font-black text-sm text-slate-800">{log.qty}</td>
                          <td className="p-5 text-xs text-slate-500 italic max-w-sm truncate" title={log.glosa}>
                            {log.glosa ? `"${log.glosa}"` : '-'}
                          </td>
                        </tr>
                      ))}
                      {filteredAudit.length === 0 && <tr><td colSpan="5" className="p-8 text-center text-slate-500">No hay registros que coincidan.</td></tr>}
                    </tbody>
                  </table>
                  {filteredAudit.length > PAGE_SIZE && (
                    <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50">
                      <span className="text-[10px] font-bold text-slate-500">Mostrando {auditPage * PAGE_SIZE + 1}–{Math.min((auditPage + 1) * PAGE_SIZE, filteredAudit.length)} de {filteredAudit.length}</span>
                      <div className="flex gap-2">
                        <button disabled={auditPage === 0} onClick={() => setAuditPage(p => p - 1)} className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-40">← Anterior</button>
                        <button disabled={(auditPage + 1) * PAGE_SIZE >= filteredAudit.length} onClick={() => setAuditPage(p => p + 1)} className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-40">Siguiente →</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* WAREHOUSE SETUP */}
            {activeTab === 'warehouse' && canManageMasters && (
              <div className="space-y-6 animate-in fade-in max-w-6xl mx-auto">
                {/* Banner de auditoría 3D */}
                {locAudit && (locAudit.without_3d_coords > 0 || locAudit.orphan_inventory?.length > 0) && (
                  <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 flex items-start gap-3">
                    <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20}/>
                    <div className="flex-1">
                      <p className="text-sm font-black text-amber-900 uppercase tracking-tighter">Desincronización con el Mapa 3D</p>
                      <p className="text-[11px] text-amber-800 mt-1">
                        {locAudit.without_3d_coords > 0 && <><strong>{locAudit.without_3d_coords}</strong> ubicaciones sin posición 3D no se mostrarán en el mapa. </>}
                        {locAudit.orphan_inventory?.length > 0 && <><strong>{locAudit.orphan_inventory.length}</strong> ubicaciones de LPNs no existen en el maestro. </>}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        <button onClick={()=>setLocAuditModalOpen(true)} className="bg-amber-600 hover:bg-amber-700 text-white text-[9px] font-black px-3 py-1.5 rounded-xl uppercase">Ver detalle</button>

                        {/* Mover todo a recepción — aplica a LPNs en ubicaciones huérfanas */}
                        {locAudit.orphan_inventory?.length > 0 && (
                          <button onClick={async()=>{
                            const total = locAudit.orphan_inventory.reduce((s,o)=>s+o.lpn_count,0);
                            if (!(await confirm({ message: `¿Mover ${total} LPN(s) de ${locAudit.orphan_inventory.length} ubicaciones huérfanas a PISO-RECEPCION? Esta acción es reversible desde el tab de Inventario.`, danger: true }))) return;
                            const r = await apiFetch(`${host}/api/locations/move-orphans-to-reception`, { method:'POST' });
                            if (r.ok) {
                              const d = await r.json();
                              showMsg(`✅ ${d.moved} LPN(s) movidos a PISO-RECEPCION.`);
                              const r2 = await apiFetch(`${host}/api/locations/audit-3d`); if (r2.ok) setLocAudit(await r2.json());
                            } else { showMsg('⛔ Error al mover LPNs', true); }
                          }} className="bg-blue-600 hover:bg-blue-700 text-white text-[9px] font-black px-3 py-1.5 rounded-xl uppercase flex items-center gap-1">
                            <ArrowDownRight size={11}/> Mover todo a Recepción
                          </button>
                        )}

                        {/* Generar posiciones 3D — deriva coords desde el ID de ubicación */}
                        {locAudit.without_3d_coords > 0 && (
                          <button onClick={async()=>{
                            if (!(await confirm({ message: `¿Generar posiciones 3D para ${locAudit.without_3d_coords} ubicaciones sin coordenadas? Se derivarán desde el código de ubicación.`, danger: false }))) return;
                            const dry = await apiFetch(`${host}/api/locations/migrate-3d`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ dry_run: true }) });
                            if (!dry.ok) { showMsg('⛔ Error al analizar ubicaciones', true); return; }
                            const dryData = await dry.json();
                            if (dryData.migrated === 0) { showMsg('⚠ No se detectaron ubicaciones con patrón derivable.'); return; }
                            const okGo = await confirm({ message: `Se pueden generar posiciones para ${dryData.migrated} ubicaciones (${dryData.skipped} sin patrón reconocible). ¿Aplicar?`, danger: true });
                            if (!okGo) return;
                            const apply = await apiFetch(`${host}/api/locations/migrate-3d`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ dry_run: false }) });
                            const applied = await apply.json();
                            showMsg(`✅ Posiciones generadas: ${applied.migrated} ubicaciones actualizadas.`);
                            const r2 = await apiFetch(`${host}/api/locations/audit-3d`); if (r2.ok) setLocAudit(await r2.json());
                            fetchData();
                          }} className="bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-black px-3 py-1.5 rounded-xl uppercase flex items-center gap-1">
                            <MapIcon size={11}/> Generar Posiciones 3D
                          </button>
                        )}

                        {/* Derivar coords (superadmin legacy — oculto si ya está el botón anterior) */}
                        {isSuperAdmin && false && locAudit.without_3d_coords > 0 && (
                          <button className="hidden">legacy</button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                <div className="bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm space-y-8">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <div>
                      <h3 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Diseño de Bodega Paramétrico</h3>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Configura Bodegas, Zonas, Filas, Columnas y Pasillos</p>
                    </div>
                    <div className="flex gap-2 items-center">
                      <button onClick={handleExportLocsCsv} className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-xl text-[10px] font-black border border-slate-200 flex items-center gap-1"><Download size={12}/>Exportar CSV</button>
                      <label className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-3 py-2 rounded-xl text-[10px] font-black border border-emerald-200 flex items-center gap-1 cursor-pointer"><Upload size={12}/>Importar CSV<input type="file" accept=".csv" className="hidden" onChange={e=>{if(e.target.files[0])handleImportLocsCsv(e.target.files[0]);e.target.value=''}}/></label>
                      <Warehouse className="text-indigo-500 w-8 h-8 ml-2" />
                    </div>
                  </div>

                  {/* MEJORA 4: Stats por zona */}
                  {Object.keys(locZoneStats).length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                      {Object.entries(locZoneStats).map(([zone, st]) => (
                        <button key={zone} onClick={()=>{setWhZoneFilter(whZoneFilter===zone?'':zone);setLocPage(0);}} className={`p-3 rounded-2xl border text-left transition-all ${whZoneFilter===zone?'border-indigo-400 bg-indigo-50 shadow-md':'border-slate-200 bg-white hover:border-slate-300'}`}>
                          <p className="text-[9px] font-black text-slate-500 uppercase truncate">{zone}</p>
                          <p className="text-lg font-black text-slate-800">{st.total}</p>
                          <div className="w-full bg-slate-200 rounded-full h-1.5 mt-1">
                            <div className="bg-emerald-500 h-1.5 rounded-full" style={{width:`${st.total>0?Math.round(st.occupied/st.total*100):0}%`}}></div>
                          </div>
                          <p className="text-[8px] font-bold text-slate-400 mt-1">{st.occupied} ocupadas / {st.total - st.occupied} libres</p>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <h4 className="text-xs font-black text-slate-600 uppercase border-b border-slate-100 pb-2">1. Bodegas Físicas</h4>
                      <p className="text-[10px] text-slate-400 font-bold">Número que identifica el almacén + glosa (descripción) vinculada.</p>
                      <div className="flex gap-2">
                        <input value={newWh} onChange={e=>setNewWh(e.target.value)} placeholder="N°" type="number" min="1" className="w-16 border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500"/>
                        <input value={newWhGlosa} onChange={e=>setNewWhGlosa(e.target.value)} placeholder="Glosa (ej: Bodega Principal)" className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500"
                          onKeyDown={e=>{ if(e.key==='Enter' && newWh){ const id=String(newWh).trim(); const glosa=newWhGlosa.trim()||`Bodega ${id}`; setWarehouses([...warehouses,{id,name:glosa}]); setNewWh(''); setNewWhGlosa(''); }}}/>
                        <button onClick={() => { if(newWh) { const id=String(newWh).trim(); const glosa=newWhGlosa.trim()||`Bodega ${id}`; setWarehouses([...warehouses, {id, name: glosa}]); setNewWh(''); setNewWhGlosa(''); }}} className="bg-indigo-600 hover:bg-indigo-700 transition-colors text-white px-4 py-2 rounded-xl text-xs font-black shadow-sm">+</button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {warehouses.map(w => (
                          <span key={w.id} className="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg text-[10px] font-black border border-indigo-200 flex items-center gap-2 shadow-sm">
                            <span className="font-mono bg-indigo-200 text-indigo-800 px-1.5 rounded">{w.id}</span>
                            <span className="text-indigo-600">{w.name}</span>
                            <button onClick={()=>setWarehouses(warehouses.filter(x=>x.id!==w.id))} className="text-red-400 hover:text-red-600 ml-1"><X size={11}/></button>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 pt-4 border-t border-slate-100">
                     <h4 className="text-xs font-black text-slate-600 uppercase mb-4">3. Generador Automático — Código: bodega-pasillo-columna-fila</h4>
                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-500 uppercase">Bodega (número)</label>
                          <select value={draftLoc.activeWarehouse} onChange={e=>{
                            const wh = warehouses.find(w=>w.id===e.target.value);
                            setDraftLoc({...draftLoc, activeWarehouse: e.target.value, activeZone: wh?.name || draftLoc.activeZone});
                          }} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500 bg-white">
                             {warehouses.map(w => <option key={w.id} value={w.id}>{w.id} — {w.name}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-1">
                            Zona lógica (glosa)
                            <span className="text-indigo-400 font-normal normal-case text-[9px]">— vinculada a bodega</span>
                          </label>
                          <input value={draftLoc.activeZone} onChange={e=>setDraftLoc({...draftLoc, activeZone: e.target.value})} placeholder="Ej: Bodega Principal" list="zone-glosa-list" className="w-full border-2 border-indigo-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500 bg-indigo-50"/>
                          <datalist id="zone-glosa-list">{warehouses.map(w=><option key={w.id} value={w.name}/>)}{zones.map(z=><option key={z.id} value={z.id}/>)}</datalist>
                          <p className="text-[9px] text-slate-400 font-medium">Se rellena automáticamente al seleccionar bodega.</p>
                        </div>
                     </div>

                     <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-500 uppercase">Tipo pasillo</label>
                          <select value={draftLoc.aisleType} onChange={e=>setDraftLoc({...draftLoc, aisleType: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500 bg-white">
                             <option value="LETTERS">Letras (a-z / A-Z)</option>
                             <option value="NUMBERS">Números (1-99)</option>
                          </select>
                        </div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-500 uppercase">Desde pasillo</label><input value={draftLoc.aisleStart} onChange={e=>setDraftLoc({...draftLoc, aisleStart: e.target.value})} placeholder={draftLoc.aisleType==='LETTERS'?'a':'1'} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500"/></div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-500 uppercase">Hasta pasillo</label><input value={draftLoc.aisleEnd} onChange={e=>setDraftLoc({...draftLoc, aisleEnd: e.target.value})} placeholder={draftLoc.aisleType==='LETTERS'?'c':'3'} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500"/></div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-500 uppercase">Columnas</label><input type="number" min="1" value={draftLoc.colCount} onChange={e=>setDraftLoc({...draftLoc, colCount: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500"/></div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-500 uppercase">Filas</label><input type="number" min="1" value={draftLoc.levelCount} onChange={e=>setDraftLoc({...draftLoc, levelCount: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500"/></div>
                     </div>
                  </div>

                  {/* Preview en tiempo real — formato 4 segmentos: bodega-pasillo-columna-fila */}
                  <div className="bg-slate-900 rounded-3xl p-6 text-center shadow-inner relative overflow-hidden">
                     <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(67,56,202,0.2),transparent)]"></div>
                     <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 relative z-10">Preview de IDs a generar</p>
                     <div className="flex justify-center gap-4 items-center relative z-10">
                       <span className="text-sm font-mono font-black text-emerald-400 bg-slate-800 px-4 py-2 rounded-lg">{draftLoc.activeWarehouse}-{draftLoc.aisleStart}-01-1</span>
                       <span className="text-slate-500 font-black">...</span>
                       <span className="text-sm font-mono font-black text-emerald-400 bg-slate-800 px-4 py-2 rounded-lg">{draftLoc.activeWarehouse}-{draftLoc.aisleEnd}-{String(draftLoc.colCount).padStart(2,'0')}-{draftLoc.levelCount}</span>
                     </div>
                     <p className="text-[9px] text-slate-500 mt-3 uppercase font-bold tracking-[0.1em] relative z-10">
                       Total: {(() => { const s = draftLoc.aisleType==='LETTERS'?draftLoc.aisleStart.charCodeAt(0):parseInt(draftLoc.aisleStart); const e = draftLoc.aisleType==='LETTERS'?draftLoc.aisleEnd.charCodeAt(0):parseInt(draftLoc.aisleEnd); return Math.max(0,(e-s+1)*parseInt(draftLoc.colCount||1)*parseInt(draftLoc.levelCount||1)); })()} ubicaciones
                       {safeLocs.some(l => l.location_id === `${draftLoc.activeWarehouse}-${draftLoc.aisleStart}-01-1`) && <span className="ml-3 text-amber-400">Algunas ya existen</span>}
                     </p>
                     <p className="text-[9px] text-slate-500 mt-1 uppercase font-bold relative z-10 flex justify-center gap-2">
                       <span>Bodega</span><span>-</span><span>Pasillo</span><span>-</span><span>Columna</span><span>-</span><span>Fila</span>
                     </p>
                  </div>

                  {/* MEJORA 1: Vista previa visual del layout */}
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase">
                      <input type="checkbox" checked={whOverwrite} onChange={e=>setWhOverwrite(e.target.checked)} className="rounded"/>
                      Sobrescribir duplicados
                    </label>
                    <button onClick={()=>{setWhShowPreview(!whShowPreview);setWhExcluded(new Set())}} className="text-[10px] font-black text-indigo-600 hover:text-indigo-800 underline">{whShowPreview?'Ocultar grilla':'Mostrar grilla visual'}</button>
                  </div>

                  {whShowPreview && (() => {
                    const preview = buildLocsList();
                    const existingIds = new Set(safeLocs.map(l=>l.location_id));
                    const aisles = [...new Set(preview.map(p => p.aisle || p.location_id.split('-')[1]))];
                    const cols = parseInt(draftLoc.colCount) || 1;
                    const newCount = preview.filter(p => !whExcluded.has(p.location_id)).length;
                    return (
                      <div className="space-y-3 p-4 bg-slate-50 rounded-2xl border border-slate-200">
                        <div className="flex justify-between items-center">
                          <p className="text-[10px] font-black text-slate-600 uppercase">Grilla: {aisles.length} pasillos x {cols} columnas x {draftLoc.levelCount} niveles</p>
                          <p className="text-[10px] font-black text-emerald-600">Se generaran {newCount} ubicaciones nuevas</p>
                        </div>
                        <div className="overflow-auto max-h-60 custom-scrollbar">
                          {aisles.map(aisle => (
                            <div key={aisle} className="mb-2">
                              <p className="text-[9px] font-black text-slate-500 mb-1">Pasillo {aisle}</p>
                              <div className="flex flex-wrap gap-1">
                                {preview.filter(p=>p.location_id.includes(`-${aisle}-`)).map(p => {
                                  const exists = existingIds.has(p.location_id);
                                  const excluded = whExcluded.has(p.location_id);
                                  return (
                                    <button key={p.location_id} onClick={()=>{const s=new Set(whExcluded);if(excluded)s.delete(p.location_id);else s.add(p.location_id);setWhExcluded(s);}}
                                      className={`px-1.5 py-0.5 rounded text-[7px] font-mono font-bold border transition-all ${excluded?'bg-red-50 border-red-200 text-red-400 line-through':exists?'bg-slate-200 border-slate-300 text-slate-500':'bg-emerald-50 border-emerald-200 text-emerald-700'}`}
                                      title={excluded?'Excluida (click para incluir)':exists?'Ya existe':'Nueva (click para excluir)'}>
                                      {p.location_id.split('-').slice(1).join('-')}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="text-[8px] text-slate-400 font-bold">Click en celda verde para excluir. Gris = ya existe.</p>
                      </div>
                    );
                  })()}

                  <div className="flex flex-col md:flex-row gap-4">
                    <button onClick={handleGenerateLocs} disabled={isSavingLoc || isClearingLocs} className="flex-[2] bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg uppercase text-xs tracking-widest hover:bg-indigo-700 transition-transform active:scale-95 disabled:opacity-50 flex justify-center items-center">
                      {isSavingLoc && <Loader2 size={16} className="mr-2 animate-spin"/>}
                      {isSavingLoc ? 'Inyectando en Base de Datos...' : 'Generar Racks e Inyectar en BD SQL'}
                    </button>
                    <button onClick={handleClearLocations} disabled={isSavingLoc || isClearingLocs} className="flex-1 bg-red-50 text-red-600 border border-red-200 font-black py-4 rounded-2xl shadow-sm uppercase text-xs tracking-widest hover:bg-red-100 transition-transform active:scale-95 disabled:opacity-50 flex justify-center items-center">
                      {isClearingLocs ? <Loader2 size={16} className="animate-spin"/> : <Trash2 size={16} className="mr-2"/>}
                      Limpiar Racks
                    </button>
                  </div>

                  {/* SECCIÓN 4: Ubicaciones existentes con mejoras 3, 5 y 7 */}
                  <div className="mt-8 pt-8 border-t border-slate-100 animate-in fade-in">
                     <div className="flex flex-wrap justify-between items-center mb-4 gap-3">
                       <h4 className="text-xs font-black text-slate-600 uppercase">4. Ubicaciones Existentes ({filteredLocs.length})</h4>
                       <div className="flex flex-wrap gap-2 items-center">
                         <select value={whBodegaFilter} onChange={e=>{setWhBodegaFilter(e.target.value);setLocPage(0)}} className="border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold bg-white">
                           <option value="">Todas las bodegas</option>
                           {warehouses.map(w=><option key={w.id} value={w.id}>{w.id}</option>)}
                         </select>
                         <select value={whZoneFilter} onChange={e=>{setWhZoneFilter(e.target.value);setLocPage(0)}} className="border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold bg-white">
                           <option value="">Todas las zonas</option>
                           {[...new Set(safeLocs.map(l=>l.zone_code||'SIN ZONA'))].sort().map(z=><option key={z} value={z}>{z}</option>)}
                         </select>
                         <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm w-56 focus-within:ring-2 focus-within:ring-indigo-200 transition-all">
                           <Search size={12} className="text-slate-400 mr-2" />
                           <input type="text" placeholder="Buscar..." value={locSearchTerm} onChange={(e) => { setLocSearchTerm(e.target.value); setLocPage(0); }} className="bg-transparent text-[10px] font-bold outline-none w-full text-slate-700" />
                         </div>
                       </div>
                     </div>

                     {/* MEJORA 3: Acciones masivas */}
                     {whSelected.size > 0 && (
                       <div className="flex items-center gap-3 mb-3 p-3 bg-indigo-50 rounded-xl border border-indigo-200">
                         <span className="text-[10px] font-black text-indigo-700">{whSelected.size} seleccionadas</span>
                         <select value={whBulkAction} onChange={e=>setWhBulkAction(e.target.value)} className="border border-indigo-200 rounded-lg px-2 py-1 text-[10px] font-bold bg-white">
                           <option value="">Accion masiva...</option>
                           <option value="zone">Cambiar zona</option>
                           <option value="delete">Eliminar</option>
                         </select>
                         {whBulkAction==='zone' && <select value={whBulkZone} onChange={e=>setWhBulkZone(e.target.value)} className="border border-indigo-200 rounded-lg px-2 py-1 text-[10px] font-bold bg-white"><option value="">Zona...</option>{zones.map(z=><option key={z.id} value={z.id}>{z.id}</option>)}</select>}
                         <button onClick={handleBulkLocAction} disabled={!whBulkAction} className="bg-indigo-600 text-white px-3 py-1 rounded-lg text-[10px] font-black disabled:opacity-40">Aplicar</button>
                         <button onClick={()=>setWhSelected(new Set())} className="text-[10px] font-bold text-slate-500 hover:text-red-500">Deseleccionar</button>
                       </div>
                     )}

                     <div className="overflow-y-auto max-h-80 custom-scrollbar border border-slate-200 rounded-xl bg-slate-50 shadow-inner">
                       <table className="w-full text-left">
                         <thead className="bg-slate-100 border-b border-slate-200 sticky top-0 z-10">
                           <tr>
                             <th className="p-3 pl-4"><input type="checkbox" checked={filteredLocs.slice(locPage*PAGE_SIZE,(locPage+1)*PAGE_SIZE).every(l=>whSelected.has(l.location_id))} onChange={e=>{const s=new Set(whSelected);filteredLocs.slice(locPage*PAGE_SIZE,(locPage+1)*PAGE_SIZE).forEach(l=>{if(e.target.checked)s.add(l.location_id);else s.delete(l.location_id)});setWhSelected(s)}} className="rounded"/></th>
                             <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Estado</th>
                             <th className="p-3 text-[9px] font-black text-slate-400 uppercase">ID Ubicacion</th>
                             <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Zona</th>
                             <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Tipo</th>
                             <th className="p-3 text-[9px] font-black text-slate-400 uppercase text-center">Accion</th>
                           </tr>
                         </thead>
                         <tbody className="divide-y divide-slate-200">
                           {filteredLocs.slice(locPage * PAGE_SIZE, (locPage + 1) * PAGE_SIZE).map(l => {
                             const heat = locHeatMap[l.location_id];
                             const heatIcon = heat === 'blocked' ? '\uD83D\uDD34' : heat === 'stock' ? '\uD83D\uDFE1' : '\uD83D\uDFE2';
                             return (
                             <tr key={l.location_id} className={`bg-white hover:bg-indigo-50/50 transition-colors ${whSelected.has(l.location_id)?'bg-indigo-50':''}`}>
                               <td className="p-3 pl-4"><input type="checkbox" checked={whSelected.has(l.location_id)} onChange={e=>{const s=new Set(whSelected);if(e.target.checked)s.add(l.location_id);else s.delete(l.location_id);setWhSelected(s)}} className="rounded"/></td>
                               <td className="p-3 text-center text-sm" title={heat==='blocked'?'Stock bloqueado':heat==='stock'?'Con stock':'Vacia'}>{heatIcon}</td>
                               <td className="p-3 text-xs font-mono font-bold text-slate-700">{l.location_id}</td>
                               <td className="p-3"><span className="bg-slate-100 text-slate-600 px-2 py-1 rounded-md text-[9px] font-black uppercase border border-slate-200">{l.zone_code || 'SIN ZONA'}</span></td>
                               <td className="p-3"><span className="text-[9px] font-bold text-slate-500 uppercase">{l.loc_type || 'PALLET'}</span></td>
                               <td className="p-3 text-center">
                                 <button onClick={() => handleDeleteLocation(l.location_id)} className="text-slate-300 hover:text-red-500 transition-colors" title="Eliminar"><Trash2 size={13}/></button>
                               </td>
                             </tr>);
                           })}
                           {filteredLocs.length === 0 && <tr><td colSpan="6" className="p-8 text-center text-[10px] font-bold uppercase text-slate-400 tracking-widest">No se encontraron ubicaciones.</td></tr>}
                         </tbody>
                       </table>
                     </div>
                     {filteredLocs.length > PAGE_SIZE && (
                       <div className="flex items-center justify-between px-4 py-2 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                         <span className="text-[10px] font-bold text-slate-500">{locPage * PAGE_SIZE + 1}–{Math.min((locPage + 1) * PAGE_SIZE, filteredLocs.length)} de {filteredLocs.length}</span>
                         <div className="flex gap-2">
                           <button disabled={locPage === 0} onClick={() => setLocPage(p => p - 1)} className="px-2 py-1 rounded text-[10px] font-black bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40">←</button>
                           <button disabled={(locPage + 1) * PAGE_SIZE >= filteredLocs.length} onClick={() => setLocPage(p => p + 1)} className="px-2 py-1 rounded text-[10px] font-black bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40">→</button>
                         </div>
                       </div>
                     )}
                  </div>
                </div>

                {/* ── Crear ubicación individual con posición 3D ─────────── */}
                <div className="bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm space-y-6">
                  <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><Layers className="text-indigo-500" size={16}/> Crear ubicación individual</h3>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Con posición 3D explícita para sincronizar con el mapa</p>
                    </div>
                  </div>

                  {/* Sección 1: datos básicos */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase">Código de ubicación (vacío para auto-generar)</label>
                      <input type="text" value={singleLocForm.location_id} onChange={e=>setSingleLocForm(p=>({...p, location_id: e.target.value.toUpperCase()}))} placeholder="Ej: B1-RES-A-01-01" className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500 uppercase"/>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase">Zona *</label>
                      <input type="text" value={singleLocForm.zone_code} onChange={e=>setSingleLocForm(p=>({...p, zone_code: e.target.value.toUpperCase()}))} placeholder="Ej: RES-A" className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500 uppercase"/>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase">Tipo</label>
                      <select value={singleLocForm.loc_type} onChange={e=>setSingleLocForm(p=>({...p, loc_type: e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500 bg-white">
                        <option value="RACK">RACK (estructura)</option>
                        <option value="SHELF">SHELF (estante)</option>
                        <option value="FLOOR">FLOOR (piso)</option>
                        <option value="DOCK">DOCK (muelle)</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Capacidad máx. (kg)</label>
                        <input type="number" value={singleLocForm.max_kg} onChange={e=>setSingleLocForm(p=>({...p, max_kg: e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500"/>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Pallets máximos</label>
                        <input type="number" value={singleLocForm.max_pallets} onChange={e=>setSingleLocForm(p=>({...p, max_pallets: e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500"/>
                      </div>
                    </div>
                  </div>

                  {/* Sección 2: posición 3D (expandible) */}
                  <div className="bg-slate-50 rounded-2xl border-2 border-slate-200 p-4 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={singleLocForm.enable_3d} onChange={e=>setSingleLocForm(p=>({...p, enable_3d: e.target.checked}))} className="w-4 h-4 accent-indigo-600"/>
                      <div>
                        <p className="text-xs font-black text-slate-800">Definir posición en el mapa 3D</p>
                        <p className="text-[10px] text-slate-500 font-medium">Sin esto, la ubicación no aparecerá en el gemelo digital.</p>
                      </div>
                    </label>
                    {singleLocForm.enable_3d && (() => {
                      // Auto-cálculo de coords como preview
                      const autoCalc = () => {
                        const aisle = singleLocForm.aisle;
                        if (!aisle) return { x: 0, y: 0, z: 0 };
                        const asNum = parseInt(String(aisle).replace(/\D/g, ''), 10);
                        const asLetter = String(aisle).charCodeAt(0) - 65;
                        const aisleIdx = isNaN(asNum) || /^[A-Za-z]/.test(String(aisle)) ? Math.max(0, asLetter) : (asNum - 1);
                        return {
                          x: aisleIdx * 2.5,
                          y: ((parseInt(singleLocForm.level) || 1) - 1) * 2.2,
                          z: ((parseInt(singleLocForm.row_num) || 1) - 1) * 1.5,
                        };
                      };
                      const preview = autoCalc();
                      const dispX = singleLocForm.coordsMode === 'auto' ? preview.x.toFixed(2) : singleLocForm.x;
                      const dispY = singleLocForm.coordsMode === 'auto' ? preview.y.toFixed(2) : singleLocForm.y;
                      const dispZ = singleLocForm.coordsMode === 'auto' ? preview.z.toFixed(2) : singleLocForm.z;
                      return (
                        <div className="animate-in fade-in space-y-4">
                          <div className="flex bg-white p-1 rounded-xl border border-slate-200 w-fit">
                            <button onClick={()=>setSingleLocForm(p=>({...p, coordsMode: 'auto'}))} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase ${singleLocForm.coordsMode==='auto'?'bg-indigo-600 text-white':'text-slate-500'}`}>Pasillo/Columna/Nivel</button>
                            <button onClick={()=>setSingleLocForm(p=>({...p, coordsMode: 'manual'}))} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase ${singleLocForm.coordsMode==='manual'?'bg-indigo-600 text-white':'text-slate-500'}`}>Coordenadas exactas</button>
                          </div>
                          {singleLocForm.coordsMode === 'auto' ? (
                            <div className="grid grid-cols-3 gap-3">
                              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Pasillo</label><input type="text" value={singleLocForm.aisle} onChange={e=>setSingleLocForm(p=>({...p, aisle: e.target.value.toUpperCase()}))} placeholder="A" className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500 uppercase"/></div>
                              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Columna</label><input type="number" min="1" value={singleLocForm.row_num} onChange={e=>setSingleLocForm(p=>({...p, row_num: e.target.value}))} placeholder="1" className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500"/></div>
                              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Nivel</label><input type="number" min="1" value={singleLocForm.level} onChange={e=>setSingleLocForm(p=>({...p, level: e.target.value}))} placeholder="1" className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500"/></div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-3 gap-3">
                              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">X (metros)</label><input type="number" step="0.1" value={singleLocForm.x} onChange={e=>setSingleLocForm(p=>({...p, x: e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500"/></div>
                              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Y (metros)</label><input type="number" step="0.1" value={singleLocForm.y} onChange={e=>setSingleLocForm(p=>({...p, y: e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500"/></div>
                              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Z (metros)</label><input type="number" step="0.1" value={singleLocForm.z} onChange={e=>setSingleLocForm(p=>({...p, z: e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500"/></div>
                            </div>
                          )}

                          {singleLocForm.coordsMode === 'auto' && (
                            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-[10px] font-bold text-indigo-700 flex items-center gap-3">
                              <span>Coordenadas calculadas:</span>
                              <span className="font-mono">X: {dispX}</span>
                              <span className="font-mono">Y: {dispY}</span>
                              <span className="font-mono">Z: {dispZ}</span>
                            </div>
                          )}

                          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 border-t border-slate-200">
                            <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Ancho (m)</label><input type="number" step="0.1" value={singleLocForm.width} onChange={e=>setSingleLocForm(p=>({...p, width: e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500"/></div>
                            <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Profundidad (m)</label><input type="number" step="0.1" value={singleLocForm.depth} onChange={e=>setSingleLocForm(p=>({...p, depth: e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500"/></div>
                            <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Alto (m)</label><input type="number" step="0.1" value={singleLocForm.height} onChange={e=>setSingleLocForm(p=>({...p, height: e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500"/></div>
                            <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Color en mapa</label><input type="color" value={singleLocForm.color_hex || '#6366f1'} onChange={e=>setSingleLocForm(p=>({...p, color_hex: e.target.value}))} className="w-full h-[42px] border-2 border-slate-200 rounded-xl cursor-pointer"/></div>
                          </div>
                          <p className="text-[10px] text-slate-500 font-bold italic">
                            Si ingresas Pasillo/Columna/Nivel, las coordenadas X/Y/Z se calculan automáticamente. Si prefieres, pasá al modo "Coordenadas exactas" para ingresarlas directamente.
                          </p>
                        </div>
                      );
                    })()}
                  </div>

                  <button onClick={async () => {
                    if (!singleLocForm.zone_code && !singleLocForm.location_id) return showMsg('⚠ Ingrese al menos zona o código', true);
                    const payload = {
                      location_id: singleLocForm.location_id || undefined,
                      zone_code:   singleLocForm.zone_code,
                      loc_type:    singleLocForm.loc_type,
                      max_kg:      singleLocForm.max_kg !== '' ? parseFloat(singleLocForm.max_kg) : undefined,
                      max_pallets: singleLocForm.max_pallets !== '' ? parseInt(singleLocForm.max_pallets) : undefined,
                    };
                    if (singleLocForm.enable_3d) {
                      payload.aisle   = singleLocForm.aisle || undefined;
                      payload.row_num = singleLocForm.row_num !== '' ? parseInt(singleLocForm.row_num) : undefined;
                      payload.level   = singleLocForm.level   !== '' ? parseInt(singleLocForm.level)   : undefined;
                      if (singleLocForm.coordsMode === 'manual') {
                        payload.x = singleLocForm.x !== '' ? parseFloat(singleLocForm.x) : undefined;
                        payload.y = singleLocForm.y !== '' ? parseFloat(singleLocForm.y) : undefined;
                        payload.z = singleLocForm.z !== '' ? parseFloat(singleLocForm.z) : undefined;
                      }
                      payload.width  = parseFloat(singleLocForm.width)  || 1;
                      payload.depth  = parseFloat(singleLocForm.depth)  || 1;
                      payload.height = parseFloat(singleLocForm.height) || 1;
                      if (singleLocForm.color_hex) payload.color_hex = singleLocForm.color_hex;
                    }
                    const res = await apiFetch(`${host}/api/locations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                    const data = await res.json().catch(()=>({}));
                    if (res.ok) {
                      showMsg(`✅ Ubicación ${data.location_id} creada${singleLocForm.enable_3d ? ` (X:${data.x?.toFixed?.(2)} Y:${data.y?.toFixed?.(2)} Z:${data.z?.toFixed?.(2)})` : ''}`);
                      setSingleLocForm({ location_id: '', zone_code: '', loc_type: 'RACK', max_kg: '', max_pallets: '', enable_3d: false, aisle: '', row_num: '', level: '', x: '', y: '', z: '', width: '1.2', depth: '0.8', height: '2.0', color_hex: '', coordsMode: 'auto' });
                      fetchData();
                      const r2 = await apiFetch(`${host}/api/locations/audit-3d`); if (r2.ok) setLocAudit(await r2.json());
                    } else {
                      showMsg(`⛔ ${data.error || 'Error al crear'}`, true);
                    }
                  }} className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 px-8 rounded-2xl uppercase text-[10px] tracking-widest shadow-lg">Crear ubicación</button>
                </div>
              </div>
            )}

            {/* MASTER SKUS */}
            {activeTab === 'master-skus' && (canManageMasters || currentUser?.role === 'CLIENTE') && (
              <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
                <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row gap-8">
                  {currentUser?.role !== 'CLIENTE' && <div className="flex-1 space-y-6 border-r border-slate-100 pr-8">
                    <div>
                      <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center">
                        <Box className="w-5 h-5 mr-2 text-blue-500"/> 
                        {isEditingSku ? 'Editando Artículo Existente' : 'Definición Logística (SKU)'}
                      </h2>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                        {isEditingSku ? 'Modifica los datos y presiona actualizar' : 'Registrar nuevo producto con datos logísticos completos'}
                      </p>
                    </div>
                    <form onSubmit={handleSaveSku} className="space-y-6">
                      <div className="space-y-4">
                        <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-widest border-b border-slate-100 pb-2 flex items-center"><Package className="w-4 h-4 mr-2"/> Identificación Básica</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase">Código SKU *</label>
                            <input 
                              type="text" 
                              value={skuForm.sku} 
                              onChange={e=>setSkuForm({...skuForm, sku: e.target.value.toUpperCase().replace(/\s/g, '-')})} 
                              required 
                              disabled={isEditingSku}
                              className={`w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-blue-500 uppercase ${isEditingSku ? 'bg-slate-100 text-slate-500 cursor-not-allowed border-slate-300' : 'bg-white'}`} 
                              placeholder="Ej: SF-BUJ-01"
                            />
                            {isEditingSku && <p className="text-[9px] text-amber-600 font-bold mt-1">El código no se puede modificar. Si necesita otro código, elimínelo y créelo de nuevo.</p>}
                          </div>
                          <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Categoría / Familia</label><input type="text" value={skuForm.category} onChange={e=>setSkuForm({...skuForm, category: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-500" placeholder="Ej: Repuestos"/></div>
                        </div>
                        <div className={`grid gap-4 mt-4 ${is3PLMode ? 'grid-cols-2' : 'grid-cols-1'}`}>
                          <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Código de Barras (UPC/EAN)</label><input type="text" value={skuForm.barcode || ''} onChange={e=>setSkuForm({...skuForm, barcode: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-500" placeholder="Opcional"/></div>
                          {is3PLMode && (
                            <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Cliente / Dueño *</label>
                              <select value={skuForm.client_id || ''} onChange={e=>setSkuForm({...skuForm, client_id: e.target.value})} required disabled={isEditingSku} className={`w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-500 ${isEditingSku ? 'bg-slate-100 text-slate-500 cursor-not-allowed border-slate-300' : 'bg-white'}`}>
                                <option value="">-- Seleccione Cliente --</option>
                                {clients.map(c => <option key={c.id} value={c.id}>{c.id} - {c.name}</option>)}
                              </select>
                            </div>
                          )}
                        </div>
                        <div className="space-y-1 mt-4"><label className="text-[10px] font-black text-slate-400 uppercase">Descripción Comercial *</label><input type="text" value={skuForm.desc} onChange={e=>setSkuForm({...skuForm, desc: e.target.value})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-500" placeholder="Nombre completo del producto"/></div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-widest border-b border-slate-100 pb-2 flex items-center"><Sliders className="w-4 h-4 mr-2"/> Pesos y Dimensiones</h3>
                        <div className="grid grid-cols-4 gap-4">
                          <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Peso (Kg)</label><input type="number" step="0.01" value={skuForm.weight} onChange={e=>setSkuForm({...skuForm, weight: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-2 py-3 text-xs font-bold outline-none focus:border-blue-500"/></div>
                          <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Largo (cm)</label><input type="number" step="0.1" value={skuForm.length} onChange={e=>setSkuForm({...skuForm, length: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-2 py-3 text-xs font-bold outline-none focus:border-blue-500"/></div>
                          <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Ancho (cm)</label><input type="number" step="0.1" value={skuForm.width} onChange={e=>setSkuForm({...skuForm, width: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-2 py-3 text-xs font-bold outline-none focus:border-blue-500"/></div>
                          <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Alto (cm)</label><input type="number" step="0.1" value={skuForm.height} onChange={e=>setSkuForm({...skuForm, height: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-2 py-3 text-xs font-bold outline-none focus:border-blue-500"/></div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-widest border-b border-slate-100 pb-2 flex items-center"><MapIcon className="w-4 h-4 mr-2"/> Almacenaje y Controles</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Empaque (UOM)</label><select value={skuForm.uom} onChange={e=>setSkuForm({...skuForm, uom: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none uppercase bg-white focus:border-blue-500"><option value="UN">Unidad (UN)</option><option value="CJ">Caja (CJ)</option><option value="PL">Pallet (PL)</option></select></div>
                          <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Rotación (Clase ABC)</label><select value={skuForm.abc_class} onChange={e=>setSkuForm({...skuForm, abc_class: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none uppercase bg-white focus:border-blue-500"><option value="-">Sin Clasificar</option><option value="A">Clase A (Alta)</option><option value="B">Clase B (Media)</option><option value="C">Clase C (Baja)</option></select></div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        {(() => {
                          if (!isEditingSku || !editingSkuOriginal) return null;
                          const newLot    = skuForm.traceability === 'LOT';
                          const newSerial = skuForm.traceability === 'SERIAL';
                          const criticalChange = newLot !== editingSkuOriginal.requires_lot || newSerial !== editingSkuOriginal.requires_serial;
                          if (!criticalChange) return null;
                          const hasStock = editingSkuOriginal.stock_total > 0;
                          if (!hasStock) return null;
                          return (
                            <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 flex gap-3">
                              <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5"/>
                              <div>
                                <p className="text-xs font-black text-amber-900 uppercase tracking-widest">Cambio crítico con stock activo</p>
                                <p className="text-[11px] text-amber-800 mt-1">Cambiar el control de lote/serie en un SKU con stock activo creará una <strong>versión nueva</strong> automáticamente. El stock existente seguirá en la versión anterior hasta ser despachado.</p>
                              </div>
                            </div>
                          );
                        })()}
                        <select value={skuForm.traceability} onChange={e=>setSkuForm({...skuForm, traceability: e.target.value})} className="w-full border-2 border-blue-200 bg-blue-50 text-blue-900 rounded-xl px-4 py-3 text-xs font-bold outline-none uppercase focus:border-blue-500">
                          <option value="NONE">Sin Controles (Stock General)</option>
                          <option value="LOT">Exigir Registro de LOTE y Vencimiento</option>
                          <option value="SERIAL">Exigir Registro de Número de SERIE Único</option>
                        </select>
                      </div>

                      {/* ── Fabricante (opcional) ──────────────────────── */}
                      <div className="space-y-4 bg-slate-50 -mx-2 px-4 py-4 rounded-2xl border border-slate-200">
                        <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-widest flex items-center"><HardHat className="w-4 h-4 mr-2 text-slate-500"/> Fabricante <span className="ml-2 bg-slate-200 text-slate-500 px-2 py-0.5 rounded text-[9px]">opcional</span></h3>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1 col-span-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase">Fabricante</label>
                            <select
                              value={skuForm.manufacturer_id || ''}
                              onChange={e => {
                                const val = e.target.value;
                                if (val === '__NEW__') { setShowMfrQuickForm(true); return; }
                                const sel = manufacturers.find(m => String(m.id) === val);
                                setSkuForm(p => ({ ...p, manufacturer_id: val || '', manufacturer_code: sel?.code || p.manufacturer_code }));
                              }}
                              className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 bg-white"
                            >
                              <option value="">— Sin fabricante registrado —</option>
                              {manufacturers.filter(m => m.active).map(m => (
                                <option key={m.id} value={m.id}>{m.code} · {m.name}</option>
                              ))}
                              <option value="__NEW__">+ Nuevo fabricante…</option>
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase">Código del fabricante</label>
                            <input
                              type="text"
                              value={skuForm.manufacturer_code || ''}
                              onChange={e=>setSkuForm(p=>({...p, manufacturer_code: e.target.value.toUpperCase()}))}
                              disabled={!!skuForm.manufacturer_id}
                              placeholder={skuForm.manufacturer_id ? '(usa el código del fabricante seleccionado)' : 'Texto libre si no está registrado'}
                              className={`w-full border-2 rounded-xl px-3 py-2.5 text-xs font-bold outline-none uppercase ${skuForm.manufacturer_id ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed' : 'border-slate-200 focus:border-indigo-500'}`}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase">Cód. producto del fabricante</label>
                            <input
                              type="text"
                              value={skuForm.manufacturer_sku || ''}
                              onChange={e=>setSkuForm(p=>({...p, manufacturer_sku: e.target.value}))}
                              placeholder="Ej: ES-CAJA-6040"
                              className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-indigo-500"
                            />
                          </div>
                          <div className="space-y-1 col-span-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase">Marca</label>
                            <input
                              type="text"
                              value={skuForm.brand || ''}
                              onChange={e=>setSkuForm(p=>({...p, brand: e.target.value}))}
                              placeholder="Ej: BoxMaster, 3M, Phillips…"
                              className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-indigo-500"
                            />
                            <p className="text-[9px] text-slate-400 font-bold">La marca puede ser distinta al fabricante.</p>
                          </div>
                        </div>
                      </div>

                      {/* ── Sustitutos ────────────────────────────────── */}
                      <div className="space-y-3 bg-slate-50 -mx-2 px-4 py-4 rounded-2xl border border-slate-200">
                        <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-widest flex items-center"><RefreshCcw className="w-4 h-4 mr-2 text-slate-500"/> Sustitutos</h3>
                        <label className="flex items-start gap-3 cursor-pointer p-3 bg-white border-2 border-slate-200 rounded-xl hover:border-emerald-300 transition-colors">
                          <input type="checkbox" checked={!!skuForm.allow_substitutes} onChange={e=>setSkuForm(p=>({...p, allow_substitutes: e.target.checked}))} className="mt-0.5 w-4 h-4 accent-emerald-600"/>
                          <div>
                            <p className="text-xs font-black text-slate-800">Ofrecer sustitutos cuando falte stock</p>
                            <p className="text-[10px] text-slate-500 font-medium mt-0.5">Al activar, el sistema sugerirá SKUs similares si no hay suficiente disponibilidad.</p>
                          </div>
                        </label>
                        {skuForm.allow_substitutes && (
                          <div className="bg-white border-2 border-slate-200 rounded-xl p-4 space-y-3 animate-in fade-in">
                            <div>
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Alcance de la búsqueda</p>
                              <div className="space-y-1.5">
                                {[
                                  ['any','Cualquier SKU similar'],
                                  ['same_client','Solo del mismo cliente'],
                                  ['same_category','Solo de la misma categoría'],
                                  ['same_manufacturer','Solo del mismo fabricante'],
                                  ['manual_only','Solo sustitutos manuales (sin búsqueda automática)'],
                                ].map(([id,label]) => (
                                  <label key={id} className="flex items-center gap-2 cursor-pointer">
                                    <input type="radio" name="subst_scope" value={id} checked={skuForm.substitute_scope === id} onChange={()=>setSkuForm(p=>({...p, substitute_scope: id}))} className="accent-emerald-600"/>
                                    <span className="text-xs font-bold text-slate-700">{label}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                            {skuForm.substitute_scope !== 'manual_only' && (
                              <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Similitud mínima (opcional)</label>
                                <div className="flex items-center gap-2 mt-1">
                                  <input type="number" min="1" max="100" step="1" value={skuForm.substitute_threshold || ''} onChange={e=>setSkuForm(p=>({...p, substitute_threshold: e.target.value}))} placeholder="35" className="w-24 border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-emerald-500"/>
                                  <span className="text-xs font-bold text-slate-500">%</span>
                                  <p className="text-[10px] text-slate-400 font-bold">Vacío = usar valor global (35%)</p>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex gap-4 mt-4">
                        <button type="submit" disabled={isSavingSku} className={`flex-[2] text-white font-black py-4 rounded-2xl shadow-lg uppercase text-xs tracking-widest transition-colors disabled:opacity-60 flex justify-center items-center ${isEditingSku ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'}`}>
                          {isSavingSku ? <><Loader2 size={14} className="mr-2 animate-spin"/> Guardando...</> : (isEditingSku ? 'Actualizar Producto' : 'Guardar en Maestro')}
                        </button>
                        {isEditingSku && (
                          <button type="button" onClick={() => {setSkuForm(initialSkuForm); setIsEditingSku(false);}} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-black py-4 rounded-2xl shadow-sm uppercase text-xs tracking-widest transition-colors">
                            Cancelar
                          </button>
                        )}
                      </div>
                    </form>
                  </div>}
                  <div className={`${currentUser?.role === 'CLIENTE' ? 'w-full' : 'flex-[1.5]'} overflow-y-auto max-h-[500px] custom-scrollbar pr-2`}>
                    <div className="sticky top-0 bg-white pt-2 pb-3 z-10 border-b border-slate-100 space-y-2 mb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Catálogo ({filteredSkusList.length})</p>
                          <button onClick={() => { const headers = 'sku,client_id,desc,category,uom,weight,length,width,height,abc_class,requires_lot,requires_serial,barcode'; const csv = filteredSkusList.map(s => Object.values({sku:s.sku,client_id:s.client_id||'',desc:s.desc||'',category:s.category||'',uom:s.uom||'',weight:s.weight||0,length:s.length||0,width:s.width||0,height:s.height||0,abc_class:s.abc_class||'',requires_lot:s.requires_lot||false,requires_serial:s.requires_serial||false,barcode:s.barcode||''}).map(v=>`"${v}"`).join(',')).join('\n'); const blob = new Blob([headers+'\n'+csv],{type:'text/csv'}); const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='skus_filtrados.csv'; a.click(); }} className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-2 py-1 rounded-lg text-[9px] font-black uppercase flex items-center gap-1"><Download size={10}/> CSV</button>
                          {currentUser?.role !== 'CLIENTE' && <button onClick={() => setImportModal({ type: 'skus' })} className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1 rounded-lg text-[9px] font-black uppercase flex items-center gap-1"><Upload size={10}/> Importar</button>}
                        </div>
                        {(skuSearchTerm||skuClientFilter||skuCategoryFilter||skuAbcFilter) && <button onClick={() => { setSkuSearchTerm(''); setSkuClientFilter(''); setSkuCategoryFilter(''); setSkuAbcFilter(''); }} className="bg-red-50 text-red-500 border border-red-200 rounded-lg px-2 py-1 text-[9px] font-black uppercase flex items-center gap-1"><X size={9}/> Limpiar</button>}
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 col-span-2"><Search size={11} className="text-slate-400 mr-1 shrink-0" /><input type="text" placeholder="Buscar por código o nombre..." value={skuSearchTerm} onChange={(e) => { setSkuSearchTerm(e.target.value); setSkuPage(0); }} className="bg-transparent text-[10px] font-bold outline-none w-full text-slate-700" /></div>
                        {is3PLMode ? (
                          <select value={skuClientFilter} onChange={e=>setSkuClientFilter(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-bold outline-none text-slate-700">
                            <option value="">Todos los clientes</option>
                            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        ) : (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1 text-[10px] font-black text-emerald-700 flex items-center gap-1 col-span-1">
                            <Package size={9} className="text-emerald-500"/> {systemConfig.own_client_name || 'Productos Propios'}
                          </div>
                        )}
                        <select value={skuCategoryFilter} onChange={e=>setSkuCategoryFilter(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-bold outline-none text-slate-700">
                          <option value="">Todas las categorías</option>
                          {[...new Set(permittedSkus.map(s=>s.category||'General'))].sort().map(c=><option key={c} value={c}>{c}</option>)}
                        </select>
                        <select value={skuAbcFilter} onChange={e=>setSkuAbcFilter(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-bold outline-none text-slate-700">
                          <option value="">Clase ABC</option>
                          <option value="A">Clase A</option>
                          <option value="B">Clase B</option>
                          <option value="C">Clase C</option>
                        </select>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {filteredSkusList.slice(skuPage * PAGE_SIZE, (skuPage + 1) * PAGE_SIZE).map(s => (
                        <div key={s.sku} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col hover:bg-white transition-colors shadow-sm group">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <p className="text-sm font-black text-slate-800 flex items-center gap-2">
                                {s.sku}
                                {(() => {
                                  const ver = parseInt(s.current_version) || 1;
                                  const hasOld = !!s.has_old_stock;
                                  if (ver === 1 && !hasOld) return null;
                                  return (
                                    <button onClick={()=>handleOpenVersions(s.sku)} className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${hasOld ? 'bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`} title={hasOld ? `Hay stock en versiones anteriores. Click para ver historial` : 'Click para ver historial'}>
                                      v{ver}{hasOld ? ' (hist.)' : ''}
                                    </button>
                                  );
                                })()}
                                {s.barcode && <span className="text-[9px] bg-slate-200 text-slate-600 px-1 rounded font-mono">UPC: {s.barcode}</span>}
                              </p>
                              <p className="text-[10px] text-slate-500 truncate w-48 md:w-64">{s.desc}</p>
                              {s.client_id && <p className="text-[9px] text-indigo-600 font-bold mt-1"><Building2 size={10} className="inline mr-1"/>Cliente: {clients.find(c=>c.id===s.client_id)?.name || s.client_id}</p>}
                            </div>
                            <div className="flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                              {(s.requires_lot || s.requires_serial) && <span className="text-[9px] font-black bg-amber-100 border border-amber-200 px-2 py-1 rounded uppercase text-amber-800 mr-2">{s.requires_lot ? 'LOTE' : 'SERIE'}</span>}

                              {currentUser?.role !== 'CLIENTE' && <button onClick={() => handleEditSku(s)} className="bg-white p-2 rounded-full border border-slate-200 text-slate-400 hover:text-blue-600 hover:border-blue-300 shadow-sm transition-all" title="Editar Producto">
                                <Pencil size={14}/>
                              </button>}

                              {currentUser?.role !== 'CLIENTE' && <button onClick={() => handleDeleteSku(s.sku, s.client_id)} className="bg-white p-2 rounded-full border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-300 shadow-sm transition-all ml-1" title="Eliminar Producto">
                                <Trash2 size={14}/>
                              </button>}
                            </div>
                          </div>
                          {(s.weight || s.length || s.width || s.height) && (
                            <div className="mt-2 pt-2 border-t border-slate-100 flex gap-4 text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                              {s.weight && <span>Peso: {s.weight}kg</span>}
                              {(s.length || s.width || s.height) && <span>Dim: {s.length||0}x{s.width||0}x{s.height||0}cm</span>}
                            </div>
                          )}
                        </div>
                      ))}
                      {filteredSkusList.length > PAGE_SIZE && (
                        <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl">
                          <span className="text-[10px] font-bold text-slate-500">Mostrando {skuPage * PAGE_SIZE + 1}–{Math.min((skuPage + 1) * PAGE_SIZE, filteredSkusList.length)} de {filteredSkusList.length} SKUs</span>
                          <div className="flex gap-2">
                            <button disabled={skuPage === 0} onClick={() => setSkuPage(p => p - 1)} className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 disabled:opacity-40">← Anterior</button>
                            <button disabled={(skuPage + 1) * PAGE_SIZE >= filteredSkusList.length} onClick={() => setSkuPage(p => p + 1)} className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 disabled:opacity-40">Siguiente →</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* PANEL ALERTAS STOCK MIN/MAX */}
                {isAdmin && (
                <div className="bg-white rounded-3xl border border-amber-200 shadow-sm p-6">
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter mb-5 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-amber-500"/> Alertas de Stock Mínimo / Máximo</h3>
                  <form onSubmit={handleSaveAlert} className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase">SKU *</label>
                      <select required value={alertForm.sku} onChange={e=>setAlertForm({...alertForm,sku:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-black outline-none focus:border-amber-500 bg-white uppercase">
                        <option value="">-- Seleccionar --</option>
                        {permittedSkus.map(s=><option key={s.sku} value={s.sku}>{s.sku}</option>)}
                      </select>
                    </div>
                    {is3PLMode && (
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase">Cliente</label>
                        <select value={alertForm.client_id} onChange={e=>setAlertForm({...alertForm,client_id:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-amber-500 bg-white">
                          <option value="">GENERAL</option>
                          {permittedClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                    )}
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase">Stock Mínimo</label>
                      <input type="number" min="0" step="0.01" value={alertForm.stock_min} onChange={e=>setAlertForm({...alertForm,stock_min:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-black outline-none focus:border-amber-500 text-center" placeholder="0"/>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase">Stock Máximo (0=sin límite)</label>
                      <input type="number" min="0" step="0.01" value={alertForm.stock_max} onChange={e=>setAlertForm({...alertForm,stock_max:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-black outline-none focus:border-amber-500 text-center" placeholder="0"/>
                    </div>
                    <button type="submit" className="bg-amber-500 hover:bg-amber-600 text-white font-black py-2.5 px-4 rounded-xl text-[10px] uppercase tracking-widest shadow-md flex items-center justify-center gap-2"><CheckCircle2 size={14}/> Guardar</button>
                  </form>
                  {stockAlerts.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-2">{stockAlerts.length} SKU(s) fuera de rango:</p>
                      {stockAlerts.map(a=>(
                        <div key={a.sku} className="flex justify-between items-center bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
                          <span className="text-xs font-black text-slate-800 uppercase">{a.sku}</span>
                          <span className="text-[10px] text-slate-500">{a.client_id}</span>
                          <span className={`text-[10px] font-black ${parseFloat(a.current_stock)<parseFloat(a.stock_min)?'text-red-600':'text-orange-600'}`}>
                            Stock: {a.current_stock} · {parseFloat(a.current_stock)<parseFloat(a.stock_min)?`⬇ Mín ${a.stock_min}`:`⬆ Máx ${a.stock_max}`}
                          </span>
                          <button onClick={()=>setAlertForm({sku:a.sku,client_id:a.client_id,stock_min:a.stock_min||'',stock_max:a.stock_max||''})} className="text-[9px] font-black text-amber-600 hover:text-amber-800 bg-white border border-amber-200 px-2 py-1 rounded-lg uppercase">Editar</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                )}
              </div>
            )}

            {/* ERP: RECEIVE BATCH */}
            {activeTab === 'receive' && !activeDocId && (
              <div className="space-y-4">
                {opsScopeBanner}
                <div className="max-w-4xl mx-auto flex justify-end">
                  <button onClick={() => setImportModal({ type: 'receive' })} className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow-sm transition-colors"><Upload size={14}/> Importar desde Excel</button>
                </div>
                <DocTrayView
                  module="receive" title="Documento de Ingreso" colorClass="bg-emerald-50" textClass="text-emerald-700" btnColor="bg-emerald-500 hover:bg-emerald-600" Icon={ArrowDownRight}
                  workspaces={workspaces} newDocNum={newDocNum} setNewDocNum={setNewDocNum} newDocType={newDocType} setNewDocType={setNewDocType} newDocGlosa={newDocGlosa} setNewDocGlosa={setNewDocGlosa}
                  newDocDate={newDocDate} setNewDocDate={setNewDocDate} newDocRef={newDocRef} setNewDocRef={setNewDocRef} newDocEnteredAt={newDocEnteredAt} setNewDocEnteredAt={setNewDocEnteredAt}
                  documentTypes={documentTypes} handleCreateDoc={handleCreateDoc} removeDoc={removeDoc} setActiveDocId={setActiveDocId} currentUser={currentUser}
                  is3PLMode={is3PLMode} opsClients={opsClients} newDocClient={newDocClient} setNewDocClient={setNewDocClient}
                />
              </div>
            )}
            {activeTab === 'receive' && activeDocId && activeDoc && (
              <div className="max-w-4xl mx-auto flex flex-col space-y-4 animate-in slide-in-from-right">
                <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden flex flex-col">
                  <div className="px-8 py-5 border-b border-slate-100 flex justify-between items-center bg-emerald-50">
                    <div className="flex items-center gap-4">
                      <button onClick={() => setActiveDocId(null)} className="p-2 bg-white rounded-full shadow-sm hover:bg-slate-100 transition-colors"><ArrowLeft size={16} className="text-emerald-700"/></button>
                      <div>
                        <h2 className="text-lg font-black text-emerald-900 uppercase tracking-tighter flex items-center">[{activeDoc.docType}] {activeDoc.docNum}</h2>
                        {activeDoc.client && <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mt-0.5 flex items-center gap-1"><Building2 size={11}/> {clients.find(c=>c.id===activeDoc.client)?.name || activeDoc.client}</p>}
                        <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mt-0.5">Editando... (Autoguardado activado)</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-8 bg-slate-50 flex-1">
                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4 mb-6">
                      <h3 className="text-[10px] font-black text-emerald-600 uppercase tracking-widest border-b border-slate-100 pb-2">Agregar Producto a la Carga</h3>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase">Producto (SKU) *</label>
                        {/* SCANNER DE BARCODE */}
                        <div className="flex gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                          <Scan size={16} className="text-emerald-600 shrink-0 mt-2"/>
                          <div className="flex-1">
                            <p className="text-[9px] font-black text-emerald-700 uppercase mb-1">Escanear Código de Barras / SKU</p>
                            <div className="flex gap-2">
                              <input
                                ref={barcodeInputRef}
                                type="text"
                                value={barcodeInput}
                                onChange={e => setBarcodeInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleBarcodeSubmit(barcodeInput); } }}
                                placeholder="Escanear o escribir código..."
                                className="flex-1 border border-emerald-300 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-emerald-500 bg-white uppercase"
                                disabled={isScanning}
                                autoFocus
                              />
                              <button onClick={() => handleBarcodeSubmit(barcodeInput)} disabled={isScanning || !barcodeInput} className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-[10px] font-black uppercase flex items-center gap-1 disabled:opacity-50">
                                {isScanning ? <Loader2 size={12} className="animate-spin"/> : <Search size={12}/>}
                              </button>
                            </div>
                          </div>
                        </div>
                        <select value={lineItem.sku} onChange={e=>{setLineItem({...lineItem, sku: e.target.value, qty: permittedSkus.find(s=>s.sku===e.target.value)?.requires_serial ? 1 : ''});}} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-emerald-500 uppercase bg-white">
                          <option value="">-- O seleccionar del catálogo --</option>
                          {docSkus.map(s => <option key={s.sku} value={s.sku}>[{s.uom}] {s.sku} - {s.desc}</option>)}
                        </select>
                      </div>
                      {selSku.requires_lot && (
                        <div className="grid grid-cols-2 gap-4 bg-amber-50 p-4 rounded-xl border border-amber-200">
                          <div className="space-y-1"><label className="text-[9px] font-black text-amber-800 uppercase flex items-center"><Calendar className="w-3 h-3 mr-1"/> Lote *</label><input type="text" value={lineItem.batch} onChange={e=>setLineItem({...lineItem, batch: e.target.value.toUpperCase()})} className="w-full border-2 border-amber-200 rounded-lg px-3 py-2 text-xs font-bold outline-none uppercase" /></div>
                          <div className="space-y-1"><label className="text-[9px] font-black text-amber-800 uppercase">Vencimiento</label><input type="date" value={lineItem.expDate} onChange={e=>setLineItem({...lineItem, expDate: e.target.value})} className="w-full border-2 border-amber-200 rounded-lg px-3 py-2 text-xs font-bold outline-none bg-white" /></div>
                        </div>
                      )}
                      {selSku.requires_serial && (
                        <div className="bg-blue-50 p-4 rounded-xl border border-blue-200">
                          <label className="text-[9px] font-black text-blue-800 uppercase flex items-center"><Tag className="w-3 h-3 mr-1"/> Número de Serie (SN) *</label>
                          <input type="text" value={lineItem.serial} onChange={e=>setLineItem({...lineItem, serial: e.target.value.toUpperCase()})} placeholder="ESCANEAR SERIE" className="w-full border-2 border-blue-200 rounded-lg px-3 py-3 text-lg font-black outline-none uppercase text-center mt-1" />
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-500 uppercase">Destino *</label>
                          <select value={lineItem.location_id} onChange={e=>setLineItem({...lineItem, location_id: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-emerald-500 bg-white">
                            <option value="PISO-RECEPCION">PISO-RECEPCION</option>
                            {safeLocs.map(l => <option key={l.location_id} value={l.location_id}>{l.location_id}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-500 uppercase">Cantidad *</label><input type="number" min="0.01" step="0.01" value={lineItem.qty} onChange={e=>setLineItem({...lineItem, qty: e.target.value})} disabled={selSku.requires_serial} className={`w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-xl font-black text-emerald-600 outline-none text-center ${selSku.requires_serial ? 'bg-slate-100 opacity-50' : 'focus:border-emerald-500'}`} /></div>
                      </div>
                      <button onClick={addReceiveLine} disabled={!lineItem.sku || !lineItem.qty || (selSku.requires_lot && !lineItem.batch) || (selSku.requires_serial && !lineItem.serial)} className="w-full bg-emerald-100 text-emerald-800 font-black py-3 rounded-xl uppercase text-[10px] tracking-widest hover:bg-emerald-200 transition-colors flex justify-center items-center disabled:opacity-50"><Plus size={14} className="mr-1"/> Agregar Línea al Documento</button>
                    </div>

                    {activeDoc.items.length > 0 && (
                      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden mb-6">
                        <div className="bg-slate-50 border-b border-slate-200 p-4"><h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Líneas del Documento ({activeDoc.items.length})</h3></div>
                        <table className="w-full text-left">
                          <thead className="bg-slate-100 border-b border-slate-200"><tr><th className="p-3 text-[9px] font-black text-slate-400 uppercase pl-5">SKU / Detalle</th><th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Cant</th><th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Destino</th><th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Borrar</th></tr></thead>
                          <tbody className="divide-y divide-slate-100">
                            {activeDoc.items.map((it, idx) => (
                              <tr key={idx} className="hover:bg-slate-50">
                                <td className="p-3 pl-5"><p className="text-xs font-black text-slate-800">{it.sku}</p><p className="text-[9px] text-slate-500">{it.batch ? `LT: ${it.batch}` : ''} {it.serial ? `SN: ${it.serial}` : ''}</p></td>
                                <td className="p-3 text-center text-lg font-black text-emerald-600">+{it.qty}</td>
                                <td className="p-3 text-center text-[10px] font-mono font-bold text-slate-500">{it.location_id}</td>
                                <td className="p-3 text-center"><button onClick={() => removeLineFromDoc(idx)} className="text-red-400 hover:text-red-600"><MinusCircle size={16}/></button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <button disabled={activeDoc.items.length === 0 || isCommitting} onClick={() => handleCommitAPI('receive_batch', 'receive')} className="w-full bg-slate-900 hover:bg-black text-white font-black py-4 rounded-2xl shadow-lg uppercase text-[10px] tracking-widest transition-colors disabled:opacity-50 flex justify-center items-center">{isCommitting ? <><Loader2 size={16} className="mr-2 animate-spin"/> Procesando...</> : <><Database size={16} className="mr-2"/> Procesar e Ingresar Definitivamente</>}</button>
                  </div>
                </div>
              </div>
            )}

            {/* ERP: DISPATCH BATCH CON CONFIRMACIÓN DE SALIDA (PARCIAL) */}
            {activeTab === 'dispatch' && !activeDocId && (
              <div className="space-y-4">
                {opsScopeBanner}
                <div className="max-w-4xl mx-auto flex justify-end">
                  <button onClick={() => setImportModal({ type: 'dispatch' })} className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow-sm transition-colors"><Upload size={14}/> Despachar desde Excel</button>
                </div>
                <DocTrayView
                  module="dispatch" title="Orden de Salida" colorClass="bg-blue-50" textClass="text-blue-700" btnColor="bg-blue-600 hover:bg-blue-700" Icon={ArrowUpRight}
                  workspaces={workspaces} newDocNum={newDocNum} setNewDocNum={setNewDocNum} newDocType={newDocType} setNewDocType={setNewDocType} newDocGlosa={newDocGlosa} setNewDocGlosa={setNewDocGlosa}
                  newDocDate={newDocDate} setNewDocDate={setNewDocDate} newDocRef={newDocRef} setNewDocRef={setNewDocRef} newDocEnteredAt={newDocEnteredAt} setNewDocEnteredAt={setNewDocEnteredAt}
                  documentTypes={documentTypes} handleCreateDoc={handleCreateDoc} removeDoc={removeDoc} setActiveDocId={setActiveDocId} currentUser={currentUser}
                  is3PLMode={is3PLMode} opsClients={opsClients} newDocClient={newDocClient} setNewDocClient={setNewDocClient}
                />
              </div>
            )}
            {activeTab === 'dispatch' && activeDocId && activeDoc && (
              <div className="max-w-4xl mx-auto flex flex-col space-y-4 animate-in slide-in-from-right">
                <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden flex flex-col">
                  <div className="px-8 py-5 border-b border-slate-100 flex justify-between items-center bg-blue-50">
                    <div className="flex items-center gap-4">
                      <button onClick={() => setActiveDocId(null)} className="p-2 bg-white rounded-full shadow-sm hover:bg-slate-100 transition-colors"><ArrowLeft size={16} className="text-blue-700"/></button>
                      <div>
                        <h2 className="text-lg font-black text-blue-900 uppercase tracking-tighter flex items-center">[{activeDoc.docType}] {activeDoc.docNum}</h2>
                        {activeDoc.client && <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mt-0.5 flex items-center gap-1"><Building2 size={11}/> {clients.find(c=>c.id===activeDoc.client)?.name || activeDoc.client}</p>}
                        <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mt-0.5">Armando carro de extracción...</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-8 bg-slate-50 flex-1">
                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4 mb-6">
                      <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-widest border-b border-slate-100 pb-2 flex items-center"><Search className="w-4 h-4 mr-2"/>Buscar Stock Físico (Apto)</h3>
                      <div className="flex gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                        <Scan size={16} className="text-blue-600 shrink-0 mt-2"/>
                        <div className="flex-1">
                          <p className="text-[9px] font-black text-blue-700 uppercase mb-1">Escanear Código de Barras / SKU</p>
                          <div className="flex gap-2">
                            <input ref={barcodeInputRef} type="text" value={barcodeInput} onChange={e=>setBarcodeInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();handleBarcodeSubmit(barcodeInput);}}} placeholder="Escanear o escribir código..." className="flex-1 border border-blue-300 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-blue-500 bg-white uppercase" disabled={isScanning} autoFocus />
                            <button onClick={()=>handleBarcodeSubmit(barcodeInput)} disabled={isScanning||!barcodeInput} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-[10px] font-black uppercase flex items-center gap-1 disabled:opacity-50">{isScanning ? <Loader2 size={12} className="animate-spin"/> : <Search size={12}/>}</button>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <select value={lineItem.sku} onChange={e=>setLineItem({sku: e.target.value, selectedLpns: {}})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-blue-500 uppercase bg-white">
                          <option value="">-- O seleccionar del catálogo --</option>
                          {docSkus.map(s => <option key={s.sku} value={s.sku}>[{s.uom}] {s.sku} - {s.desc}</option>)}
                        </select>
                      </div>

                      {lineItem.sku && (
                        <div className="mt-4 animate-in fade-in border border-slate-200 rounded-2xl p-4 bg-slate-50">
                          {totalAvailDisp > 0 ? (
                            <>
                              <div className="flex bg-white p-1 rounded-xl mb-4 border border-slate-200 shadow-sm">
                                <button onClick={() => setOutboundMethod('AUTO')} className={`flex-1 py-3 text-[10px] font-black uppercase rounded-lg transition-colors ${outboundMethod === 'AUTO' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>Por Producto (Automático FIFO)</button>
                                <button onClick={() => setOutboundMethod('MANUAL')} className={`flex-1 py-3 text-[10px] font-black uppercase rounded-lg transition-colors ${outboundMethod === 'MANUAL' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>Por Caja/LPN (Manual)</button>
                              </div>

                              {outboundMethod === 'AUTO' ? (
                                selSku.requires_serial ? (
                                  <div className="p-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-center shadow-inner">
                                    <p className="text-xs font-black uppercase">⚠️ Requiere Control de Serie</p>
                                    <p className="text-[10px] mt-1">Este producto es serializado. Cambia a la selección "Por Caja/LPN (Manual)" para confirmar las series exactas a despachar.</p>
                                  </div>
                                ) : (
                                  <div className="bg-white p-6 rounded-2xl border border-blue-100 flex flex-col items-center shadow-sm">
                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Cantidad Total a Extraer</p>
                                    <input type="number" min="0.01" step="0.01" max={totalAvailDisp} value={outboundAutoQty} onChange={e=>setOutboundAutoQty(e.target.value)} disabled={isValidating} className="w-full max-w-xs border-2 border-blue-200 rounded-xl px-4 py-4 text-3xl font-black text-center outline-none focus:border-blue-600 text-blue-700 bg-blue-50/50 shadow-inner disabled:opacity-50" placeholder="0" />
                                    <p className="text-[10px] text-blue-600 mt-3 font-bold bg-blue-50 px-3 py-1 rounded-full border border-blue-100">Stock DISPONIBLE: {totalAvailDisp} {selSku.uom}</p>
                                    
                                    <button onClick={handleAddAutoOutboundItem} disabled={!outboundAutoQty || parseFloat(outboundAutoQty) <= 0 || parseFloat(outboundAutoQty) > totalAvailDisp || isValidating} className="mt-5 bg-blue-600 hover:bg-blue-700 text-white font-black px-8 py-4 rounded-xl uppercase text-[10px] tracking-widest transition-transform active:scale-95 disabled:opacity-50 flex items-center shadow-lg shadow-blue-200">
                                      {isValidating ? <Loader2 size={16} className="mr-2 animate-spin"/> : <ListPlus size={16} className="mr-2"/>}
                                      {isValidating ? 'Verificando Stock Real...' : 'Auto-Asignar (FIFO) al Carro'}
                                    </button>
                                  </div>
                                )
                              ) : (
                                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto custom-scrollbar bg-white shadow-sm">
                                  <table className="w-full text-left bg-slate-50">
                                    <thead className="bg-slate-100 border-b border-slate-200 sticky top-0 z-10"><tr><th className="p-3 text-[9px] font-black text-slate-500 uppercase">LPN Físico (Apto para Salida)</th><th className="p-3 text-[9px] font-black text-slate-500 uppercase text-center">Base Restante</th><th className="p-3 text-[9px] font-black text-slate-500 uppercase text-center">Extracción</th></tr></thead>
                                    <tbody className="divide-y divide-slate-200">
                                      {stockForDisp.map(lpn => (
                                        <tr key={lpn.id} className="bg-white hover:bg-blue-50/50">
                                          <td className="p-3 text-xs font-mono font-bold text-slate-600"><p>{lpn.id}</p><p className="text-[9px] text-slate-400 mt-1">Rack: {lpn.location_id || 'PISO'} - <span className={getStatusBadge(lpn.status)}>{statusLabel(lpn.status || 'DISPONIBLE')}</span></p></td>
                                          <td className="p-3 text-sm font-black text-indigo-600 text-center">{lpn.effectiveQty}</td>
                                          <td className="p-3 text-center flex justify-center items-center h-full pt-4">
                                            {lpn.serial_number ? (
                                              <label className="cursor-pointer flex items-center justify-center gap-1 bg-indigo-50 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors shadow-sm">
                                                <input type="checkbox" checked={lineItem.selectedLpns[lpn.id] === 1} onChange={(e) => handleLpnQtyChange(lpn.id, e.target.checked ? 1 : 0, 1)} disabled={lpn.effectiveQty <= 0 || isValidating} className="w-4 h-4 text-indigo-600 rounded cursor-pointer disabled:opacity-50" />
                                                <span className="text-[10px] font-black text-indigo-800 uppercase">Extraer</span>
                                              </label>
                                            ) : (
                                              <input type="number" min="0" max={lpn.effectiveQty} value={lineItem.selectedLpns[lpn.id] || ''} onChange={(e) => handleLpnQtyChange(lpn.id, e.target.value, lpn.effectiveQty)} disabled={isValidating} className="w-20 border-2 rounded-lg px-2 py-1 text-center font-black text-sm outline-none border-slate-200 focus:border-blue-500 disabled:opacity-50" placeholder="0" />
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  <div className="flex justify-end p-4 border-t border-slate-200 bg-slate-50">
                                    <button onClick={addDispatchLineManual} disabled={Object.values(lineItem.selectedLpns).reduce((a,b)=>a+b,0) <= 0 || isValidating} className="bg-blue-100 text-blue-800 font-black px-6 py-3 rounded-xl uppercase text-[10px] tracking-widest hover:bg-blue-200 transition-colors disabled:opacity-50 flex items-center">
                                      {isValidating ? <Loader2 size={14} className="mr-2 animate-spin"/> : <ListPlus size={14} className="mr-2"/>}
                                      {isValidating ? 'Validando Stock...' : 'Añadir Selección al Carro'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-center"><p className="text-xs font-black text-red-600 uppercase">Sin Stock DISPONIBLE</p><p className="text-[10px] text-red-500 mt-1">El stock podría estar asignado al carro, bloqueado en revisión, o no hay inventario físico.</p></div>
                          )}
                        </div>
                      )}
                    </div>

                    {activeDoc.items.length > 0 && (
                      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden mb-6">
                        <div className="bg-slate-50 border-b border-slate-200 p-4 flex justify-between items-center"><h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Carro de Extracción ({activeDoc.items.length} posiciones)</h3><span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-1 rounded font-black uppercase">Total: {activeDoc.items.reduce((sum, it) => sum + parseFloat(it.qtyToPick), 0)} Unds.</span></div>
                        <table className="w-full text-left">
                          <thead className="bg-slate-100 border-b border-slate-200"><tr><th className="p-3 text-[9px] font-black text-slate-400 uppercase pl-5">Origen LPN / SKU</th><th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Sacar</th><th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Eliminar</th></tr></thead>
                          <tbody className="divide-y divide-slate-100">
                            {activeDoc.items.map((it, idx) => (
                              <tr key={idx} className="hover:bg-slate-50">
                                <td className="p-3 pl-5"><p className="text-xs font-black text-slate-800">{it.sku}</p><p className="text-[9px] font-mono text-slate-500">LPN: {it.lpnId} {it.serial && <span className="ml-1 bg-indigo-100 text-indigo-700 px-1 rounded font-bold">SN: {it.serial}</span>}</p></td>
                                <td className="p-3 text-center text-lg font-black text-blue-600">-{it.qtyToPick}</td>
                                <td className="p-3 text-center"><button onClick={() => removeLineFromDoc(idx)} className="text-red-400 hover:text-red-600"><MinusCircle size={16}/></button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    
                    {/* ── PANEL DE INTEGRACIÓN PICKING ── */}
                    {activeDoc.items.length > 0 && (() => {
                      const pending = docPickLines.filter(pl => ['PENDIENTE','EN_PROCESO'].includes(pl.line_status)).length;
                      const completed = docPickLines.filter(pl => pl.line_status === 'COMPLETADA').length;
                      const diffs = docPickLines.filter(pl => pl.line_status === 'DIFERENCIA').length;
                      const total = docPickLines.length;
                      return total > 0 ? (
                        <div className="bg-violet-50 border-2 border-violet-200 rounded-2xl p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-black text-violet-700 uppercase tracking-widest flex items-center"><ClipboardList size={14} className="mr-2"/>Estado del Picking ({total} líneas)</h4>
                            <button onClick={loadDocPickLines} className="text-[9px] font-black text-violet-500 hover:text-violet-700 uppercase">↺ Actualizar</button>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-2 text-center">
                              <p className="text-2xl font-black text-amber-700">{pending}</p>
                              <p className="text-[8px] font-black text-amber-600 uppercase">Pendientes</p>
                            </div>
                            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2 text-center">
                              <p className="text-2xl font-black text-emerald-700">{completed}</p>
                              <p className="text-[8px] font-black text-emerald-600 uppercase">Confirmadas</p>
                            </div>
                            <div className="bg-red-50 border border-red-200 rounded-xl p-2 text-center">
                              <p className="text-2xl font-black text-red-700">{diffs}</p>
                              <p className="text-[8px] font-black text-red-600 uppercase">Diferencias</p>
                            </div>
                          </div>
                          {/* Detalle por línea */}
                          <div className="space-y-1 max-h-36 overflow-y-auto custom-scrollbar">
                            {docPickLines.map(pl => (
                              <div key={pl.line_id} className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-1.5">
                                <div>
                                  <span className="font-mono text-[10px] font-black text-slate-700">{pl.sku}</span>
                                  {pl.lpn_id && <span className="text-[9px] text-slate-400 ml-2">LPN: {pl.lpn_id}</span>}
                                </div>
                                <div className="flex items-center gap-2">
                                  {pl.qty_confirmed !== null && <span className="text-[9px] font-black text-blue-600">✓{pl.qty_confirmed}</span>}
                                  {pl.batch_confirmed && <span className="text-[8px] bg-amber-100 text-amber-700 px-1 rounded">L:{pl.batch_confirmed}</span>}
                                  {pl.serial_confirmed && <span className="text-[8px] bg-indigo-100 text-indigo-700 px-1 rounded">S:{pl.serial_confirmed}</span>}
                                  <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase ${pl.line_status==='COMPLETADA'?'bg-emerald-100 text-emerald-700':pl.line_status==='DIFERENCIA'?'bg-red-100 text-red-700':pl.line_status==='EN_PROCESO'?'bg-blue-100 text-blue-700':'bg-amber-100 text-amber-700'}`}>{pl.line_status}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                          {pending > 0 && <p className="text-[9px] font-black text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">⚠️ {pending} líneas aún pendientes de confirmación por el picker. Puede despachar igualmente.</p>}
                          {diffs > 0 && <p className="text-[9px] font-black text-red-600 bg-red-50 px-3 py-1.5 rounded-lg border border-red-200">⚠️ {diffs} líneas con diferencia. La confirmación usará las cantidades del picker.</p>}
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-2xl p-4">
                          <ClipboardList size={18} className="text-violet-400 shrink-0"/>
                          <div className="flex-1">
                            <p className="text-xs font-black text-slate-600">Sin tareas de picking asignadas</p>
                            <p className="text-[9px] text-slate-400">Puede despachar directamente o enviar a pickers primero.</p>
                          </div>
                          <button onClick={handleSendToPicking} className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest shrink-0 flex items-center gap-1 transition-colors">
                            <ClipboardList size={12}/> Enviar a Picking
                          </button>
                        </div>
                      );
                    })()}

                    <button disabled={activeDoc.items.length === 0} onClick={openDispatchConfirm} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl shadow-lg uppercase text-[10px] tracking-widest transition-colors disabled:opacity-50 flex justify-center items-center">
                      <ArrowUpRight size={16} className="mr-2"/> Proceder a Confirmación de Salida
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* MODAL DE CONFIRMACIÓN Y DESPACHO PARCIAL */}
            {showDispatchConfirm && activeDoc && (
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col animate-in zoom-in-95 max-h-[90vh]">
                  <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-blue-50 shrink-0">
                    <div>
                      <h2 className="text-xl font-black text-blue-900 uppercase tracking-tighter flex items-center"><Truck className="w-6 h-6 mr-2"/> Confirmar Salida Física</h2>
                      <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mt-1">Ajuste las cantidades si es un despacho parcial</p>
                    </div>
                    <button onClick={() => { setShowDispatchConfirm(false); setShipQtys({}); }} className="bg-white p-2 rounded-full text-slate-400 hover:text-slate-600 shadow-sm"><X size={16}/></button>
                  </div>
                  <div className="p-8 flex-1 overflow-y-auto custom-scrollbar">
                    <table className="w-full text-left">
                      <thead className="bg-slate-100 border-b border-slate-200">
                        <tr>
                          <th className="p-3 text-[9px] font-black text-slate-400 uppercase pl-4">LPN / SKU</th>
                          <th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">En Carro</th>
                          <th className="p-3 text-center text-[9px] font-black text-blue-600 uppercase pr-4">A Despachar</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeDoc.items.map((it, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="p-3 pl-4">
                              <p className="text-xs font-black text-slate-800">{it.sku}</p>
                              <p className="text-[9px] font-mono text-slate-500">LPN: {it.lpnId} {it.serial && <span className="ml-1 bg-indigo-100 text-indigo-700 px-1 rounded font-bold">SN: {it.serial}</span>}</p>
                            </td>
                            <td className="p-3 text-center text-sm font-black text-slate-500">{it.qtyToPick}</td>
                            <td className="p-3 text-center pr-4">
                              <input 
                                type="number" 
                                min="0" 
                                max={it.qtyToPick} 
                                value={shipQtys[idx] === 0 ? '' : shipQtys[idx]} 
                                onChange={(e) => setShipQtys({...shipQtys, [idx]: parseFloat(e.target.value) || 0})}
                                disabled={!!it.serial} 
                                className="w-24 border-2 border-blue-200 rounded-xl px-3 py-2 text-center font-black outline-none focus:border-blue-600 text-blue-700 bg-blue-50"
                                placeholder="0"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-[10px] text-slate-400 italic text-center mt-6">Las cantidades que no despache se mantendrán en el documento para un envío posterior.</p>
                  </div>
                  <div className="p-6 border-t border-slate-100 bg-slate-50 space-y-3 shrink-0">
                    {usePickConf && (
                      <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-2 flex items-center gap-2">
                        <CheckCheck size={14} className="text-violet-600 shrink-0"/>
                        <p className="text-[9px] font-black text-violet-700 uppercase tracking-widest">Usando cantidades confirmadas por el picker</p>
                      </div>
                    )}
                    <div className="flex gap-4">
                      <button onClick={() => { setShowDispatchConfirm(false); setShipQtys({}); }} className="w-1/3 bg-white border border-slate-200 text-slate-600 font-black py-4 rounded-2xl uppercase text-[10px] tracking-widest hover:bg-slate-100 transition-colors">Volver</button>
                      <button disabled={isCommitting} onClick={handleCommitDispatchPartial} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl shadow-lg uppercase text-[10px] tracking-widest transition-colors disabled:opacity-60 flex justify-center items-center">{isCommitting ? <><Loader2 size={16} className="mr-2 animate-spin"/> Procesando...</> : <><CheckCircle2 size={16} className="mr-2"/> Confirmar y Descontar Stock</>}</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ERP: ADJUST BATCH */}
            {activeTab === 'adjust' && !activeDocId && (
              <div className="space-y-4">
                {opsScopeBanner}
                <DocTrayView
                  module="adjust" title="Hoja de Ajuste" colorClass="bg-amber-50" textClass="text-amber-700" btnColor="bg-amber-500 hover:bg-amber-600" Icon={ClipboardCheck}
                  workspaces={workspaces} newDocNum={newDocNum} setNewDocNum={setNewDocNum} newDocGlosa={newDocGlosa} setNewDocGlosa={setNewDocGlosa}
                  newDocDate={newDocDate} setNewDocDate={setNewDocDate} newDocRef={newDocRef} setNewDocRef={setNewDocRef} newDocEnteredAt={newDocEnteredAt} setNewDocEnteredAt={setNewDocEnteredAt}
                  handleCreateDoc={handleCreateDoc} removeDoc={removeDoc} setActiveDocId={setActiveDocId} currentUser={currentUser}
                />
                {/* Panel de solicitudes de ajuste */}
                {adjustRequests.length > 0 && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
                      <p className="text-sm font-black text-amber-800 uppercase tracking-tighter flex items-center gap-2">
                        <ClipboardList size={15}/> {['ADMIN','SUPERADMIN'].includes(currentUser?.role) ? 'Solicitudes de Ajuste Pendientes' : 'Mis Solicitudes de Ajuste'}
                        {adjustRequests.filter(r=>r.status==='PENDIENTE').length > 0 && <span className="bg-amber-500 text-white text-[9px] px-2 py-0.5 rounded-full font-black">{adjustRequests.filter(r=>r.status==='PENDIENTE').length}</span>}
                      </p>
                      <button onClick={async()=>{ const r=await apiFetch(`${host}/api/adjust-requests`); if(r.ok) setAdjustRequests(await r.json()); }} className="text-[9px] text-slate-400 hover:text-slate-700 font-black uppercase flex items-center gap-1"><RefreshCcw size={10}/> Actualizar</button>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {adjustRequests.map(req => (
                        <div key={req.id} className="p-4 flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${req.status==='PENDIENTE'?'bg-amber-100 text-amber-700':req.status==='APROBADA'?'bg-emerald-100 text-emerald-700':'bg-red-100 text-red-700'}`}>{req.status}</span>
                              <span className="text-[9px] font-black text-slate-500">Doc: <span className="text-slate-800 font-mono">{req.doc_num}</span></span>
                              <span className="text-[9px] text-slate-400">{new Date(req.created_at).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})}</span>
                            </div>
                            {req.glosa && <p className="text-[10px] text-slate-500">Glosa: {req.glosa}</p>}
                            <p className="text-[10px] text-slate-400">Solicitado por <strong>{req.requested_by}</strong> · {Array.isArray(req.items) ? req.items.length : JSON.parse(req.items||'[]').length} línea(s)</p>
                            {req.reject_reason && <p className="text-[10px] text-red-500 mt-1">Rechazo: "{req.reject_reason}"</p>}
                            {req.authorized_by && <p className="text-[10px] text-slate-400">Procesado por <strong>{req.authorized_by}</strong></p>}
                          </div>
                          {req.status === 'PENDIENTE' && ['ADMIN','SUPERADMIN'].includes(currentUser?.role) && (
                            <div className="flex gap-2 shrink-0">
                              <button onClick={async()=>{
                                if(!(await confirm({ message: `¿Aprobar el ajuste de stock del documento ${req.doc_num}?`, danger: true }))) return;
                                const r=await apiFetch(`${host}/api/adjust-requests/${req.id}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
                                if(r.ok){showMsg('✅ Cantidad corregida correctamente');const d=await apiFetch(`${host}/api/adjust-requests?status=PENDIENTE`);if(d.ok)setAdjustRequests(await d.json());fetchData();}
                                else{const e=await r.json();showMsg(`⛔ ${e.error}`,true);}
                              }} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-xl text-[9px] font-black uppercase flex items-center gap-1 transition-colors">
                                <CheckCircle2 size={11}/> Aprobar
                              </button>
                              <button onClick={async()=>{
                                const motivo=(await prompt({ message: 'Motivo del rechazo (opcional):' }));
                                if(motivo===null) return;
                                const r=await apiFetch(`${host}/api/adjust-requests/${req.id}/reject`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reject_reason:motivo})});
                                if(r.ok){showMsg('Solicitud rechazada');const d=await apiFetch(`${host}/api/adjust-requests?status=PENDIENTE`);if(d.ok)setAdjustRequests(await d.json());}
                                else{const e=await r.json();showMsg(`⛔ ${e.error}`,true);}
                              }} className="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase flex items-center gap-1 border border-red-200 transition-colors">
                                <X size={11}/> Rechazar
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {activeTab === 'adjust' && activeDocId && activeDoc && (
              <div className="max-w-4xl mx-auto flex flex-col space-y-4 animate-in slide-in-from-right">
                <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden flex flex-col">
                  <div className="px-8 py-5 border-b border-slate-100 flex justify-between items-center bg-amber-50">
                    <div className="flex items-center gap-4">
                      <button onClick={() => setActiveDocId(null)} className="p-2 bg-white rounded-full shadow-sm hover:bg-slate-100 transition-colors"><ArrowLeft size={16} className="text-amber-700"/></button>
                      <div>
                        <h2 className="text-lg font-black text-amber-900 uppercase tracking-tighter flex items-center">Doc: {activeDoc.docNum}</h2>
                        {activeDoc.client && <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mt-0.5 flex items-center gap-1"><Building2 size={11}/> {clients.find(c=>c.id===activeDoc.client)?.name || activeDoc.client}</p>}
                        <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mt-0.5">Agregando diferencias de inventario...</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-8 bg-slate-50 flex-1">
                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4 mb-6">
                      
                      <div className="flex bg-slate-100 p-1 rounded-xl mb-4">
                        <button onClick={() => setLineItem({...lineItem, action: 'ADD', sku: ''})} className={`flex-1 py-3 text-[10px] font-black uppercase rounded-lg transition-colors ${lineItem.action === 'ADD' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>Sobrante (+)</button>
                        <button onClick={() => setLineItem({...lineItem, action: 'SUBTRACT', sku: ''})} className={`flex-1 py-3 text-[10px] font-black uppercase rounded-lg transition-colors ${lineItem.action === 'SUBTRACT' ? 'bg-red-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>Merma (-)</button>
                      </div>

                      <div className="space-y-1"><label className="text-[10px] font-black text-slate-500 uppercase">Producto (SKU) *</label>
                        <div className="flex gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl mb-2">
                          <Scan size={16} className="text-amber-600 shrink-0 mt-2"/>
                          <div className="flex-1">
                            <p className="text-[9px] font-black text-amber-700 uppercase mb-1">Escanear Código de Barras / SKU</p>
                            <div className="flex gap-2">
                              <input ref={barcodeInputRef} type="text" value={barcodeInput} onChange={e=>setBarcodeInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();handleBarcodeSubmit(barcodeInput);}}} placeholder="Escanear o escribir código..." className="flex-1 border border-amber-300 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-amber-500 bg-white uppercase" disabled={isScanning} />
                              <button onClick={()=>handleBarcodeSubmit(barcodeInput)} disabled={isScanning||!barcodeInput} className="bg-amber-600 text-white px-3 py-2 rounded-lg text-[10px] font-black uppercase flex items-center gap-1 disabled:opacity-50">{isScanning ? <Loader2 size={12} className="animate-spin"/> : <Search size={12}/>}</button>
                            </div>
                          </div>
                        </div>
                        <select value={lineItem.sku} onChange={e=>{setLineItem({...lineItem, sku: e.target.value, qty: permittedSkus.find(s=>s.sku===e.target.value)?.requires_serial ? 1 : ''});}} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-amber-500 uppercase bg-white">
                          <option value="">-- O seleccionar del catálogo --</option>
                          {docSkus.map(s => <option key={s.sku} value={s.sku}>[{s.uom}] {s.sku} - {s.desc}</option>)}
                        </select>
                      </div>

                      {lineItem.sku && (
                        <div className="mt-4 animate-in fade-in space-y-4">
                          {lineItem.action === 'ADD' ? (
                            <>
                              {selSku.requires_lot && (
                                <div className="grid grid-cols-2 gap-4 bg-emerald-50 p-4 rounded-xl border border-emerald-200">
                                  <div className="space-y-1"><label className="text-[9px] font-black text-emerald-800 uppercase flex items-center"><Calendar className="w-3 h-3 mr-1"/> Lote *</label><input type="text" value={lineItem.batch} onChange={e=>setLineItem({...lineItem, batch: e.target.value.toUpperCase()})} className="w-full border-2 border-emerald-200 rounded-lg px-3 py-2 text-xs font-bold outline-none uppercase" /></div>
                                  <div className="space-y-1"><label className="text-[9px] font-black text-emerald-800 uppercase">Vencimiento</label><input type="date" value={lineItem.expDate} onChange={e=>setLineItem({...lineItem, expDate: e.target.value})} className="w-full border-2 border-emerald-200 rounded-lg px-3 py-2 text-xs font-bold outline-none bg-white" /></div>
                                </div>
                              )}
                              {selSku.requires_serial && (
                                <div className="bg-blue-50 p-4 rounded-xl border border-blue-200">
                                  <label className="text-[9px] font-black text-blue-800 uppercase flex items-center"><Tag className="w-3 h-3 mr-1"/> Número de Serie (SN) *</label>
                                  <input type="text" value={lineItem.serial} onChange={e=>setLineItem({...lineItem, serial: e.target.value.toUpperCase()})} placeholder="ESCANEAR SERIE" className="w-full border-2 border-blue-200 rounded-lg px-3 py-3 text-lg font-black outline-none uppercase text-center mt-1" />
                                </div>
                              )}
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1"><label className="text-[10px] font-black text-slate-500 uppercase">Destino del Sobrante *</label>
                                  <select value={lineItem.location_id} onChange={e=>setLineItem({...lineItem, location_id: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-amber-500 bg-white">
                                    <option value="PISO-RECEPCION">PISO-RECEPCION</option>
                                    {safeLocs.map(l => <option key={l.location_id} value={l.location_id}>{l.location_id}</option>)}
                                  </select>
                                </div>
                                <div className="space-y-1"><label className="text-[10px] font-black text-slate-500 uppercase">Cantidad *</label><input type="number" min="0.01" step="0.01" value={lineItem.qty} onChange={e=>setLineItem({...lineItem, qty: e.target.value})} disabled={selSku.requires_serial} className={`w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-xl font-black text-emerald-600 outline-none text-center ${selSku.requires_serial ? 'bg-slate-100 opacity-50' : 'focus:border-emerald-500'}`} /></div>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="bg-red-50 p-4 rounded-xl border border-red-100 flex justify-between items-center">
                                <div><p className="text-[10px] font-black text-red-800 uppercase tracking-widest">Stock Total Disponible (Mermas no distinguen estado)</p><p className="text-xl font-black text-red-600">{totalAvailDisp} <span className="text-sm">{selSku.uom || 'UN'}</span></p></div>
                              </div>
                              <div className="space-y-1 mt-4">
                                <label className="text-[10px] font-black text-slate-500 uppercase">Ubicación / Origen de la Merma *</label>
                                <select value={lineItem.location_id} onChange={e=>setLineItem({...lineItem, location_id: e.target.value})} className="w-full border-2 border-red-100 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-red-500 bg-white">
                                  <option value="PISO-RECEPCION">PISO-RECEPCION</option>
                                  {safeLocs.map(l => <option key={l.location_id} value={l.location_id}>{l.location_id}</option>)}
                                </select>
                              </div>
                              {totalAvailDisp > 0 ? (
                                selSku.requires_serial ? (
                                  <div className="space-y-1 mt-4">
                                    <label className="text-[10px] font-black text-red-600 uppercase flex items-center"><Tag className="w-3 h-3 mr-1"/>Escanear Serie Única a Mermar</label>
                                    <input type="text" value={lineItem.serial} onChange={e=>setLineItem({...lineItem, serial: e.target.value.toUpperCase()})} className="w-full border-2 border-red-300 rounded-xl px-4 py-4 text-xl font-black text-center outline-none focus:border-red-600 text-red-700 uppercase bg-red-50" placeholder="ESCANEAR SN" />
                                  </div>
                                ) : (
                                  <div className="space-y-1 mt-4">
                                    <label className="text-[10px] font-black text-slate-500 uppercase flex justify-between">¿Cuántas unidades desea RESTAR?</label>
                                    <input type="number" min="0.01" step="0.01" max={totalAvailDisp} value={lineItem.qty} onChange={e=>setLineItem({...lineItem, qty: e.target.value})} className="w-full border-2 border-red-200 rounded-xl px-4 py-4 text-2xl font-black text-center outline-none focus:border-red-500 text-red-600" placeholder="0" />
                                  </div>
                                )
                              ) : (
                                <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-center"><p className="text-xs font-black text-red-600 uppercase">Sin Stock para mermar</p></div>
                              )}
                            </>
                          )}
                          <button onClick={addAdjustLine} disabled={!lineItem.sku || (lineItem.action === 'ADD' && selSku.requires_lot && !lineItem.batch) || (lineItem.action === 'ADD' && selSku.requires_serial && !lineItem.serial) || (lineItem.action === 'SUBTRACT' && totalAvailDisp <= 0) || (lineItem.action === 'SUBTRACT' && selSku.requires_serial && !lineItem.serial) || (!lineItem.qty && !(lineItem.action === 'SUBTRACT' && selSku.requires_serial))} className="w-full bg-amber-100 text-amber-800 font-black py-3 rounded-xl uppercase text-[10px] tracking-widest hover:bg-amber-200 transition-colors flex justify-center items-center disabled:opacity-50"><Plus size={14} className="mr-1"/> Agregar Ajuste a la Hoja</button>
                        </div>
                      )}
                    </div>

                    {activeDoc.items.length > 0 && (
                      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden mb-6">
                        <div className="bg-slate-50 border-b border-slate-200 p-4"><h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Ajustes Registrados ({activeDoc.items.length})</h3></div>
                        <table className="w-full text-left">
                          <thead className="bg-slate-100 border-b border-slate-200"><tr><th className="p-3 text-[9px] font-black text-slate-400 uppercase pl-5">SKU / Detalle</th><th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Diferencia</th><th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Borrar</th></tr></thead>
                          <tbody className="divide-y divide-slate-100">
                            {activeDoc.items.map((it, idx) => (
                              <tr key={idx} className="hover:bg-slate-50">
                                <td className="p-3 pl-5"><p className="text-xs font-black text-slate-800">{it.sku}</p><p className="text-[9px] text-slate-500">{it.batch ? `LT: ${it.batch}` : ''} {it.serial ? `SN: ${it.serial}` : ''} {it.action === 'ADD' ? `-> ${it.location_id}` : ''}</p></td>
                                <td className={`p-3 text-center text-lg font-black ${it.action === 'ADD' ? 'text-emerald-600' : 'text-red-600'}`}>{it.action === 'ADD' ? '+' : '-'}{it.qty}</td>
                                <td className="p-3 text-center"><button onClick={() => removeLineFromDoc(idx)} className="text-red-400 hover:text-red-600"><MinusCircle size={16}/></button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {currentUser?.role === 'EJECUTIVO_CUENTA' ? (
                      <div className="space-y-2">
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2">
                          <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5"/>
                          <p className="text-[10px] font-bold text-amber-700">Como Ejecutivo de Cuenta, los ajustes requieren aprobación de un administrador antes de aplicarse al stock.</p>
                        </div>
                        <button disabled={activeDoc.items.length === 0} onClick={handleAdjustRequest} className="w-full bg-amber-500 hover:bg-amber-600 text-white font-black py-4 rounded-2xl shadow-lg uppercase text-[10px] tracking-widest transition-colors disabled:opacity-50 flex justify-center items-center"><Send size={16} className="mr-2"/> Enviar Solicitud de Ajuste</button>
                      </div>
                    ) : (
                      <button disabled={activeDoc.items.length === 0} onClick={() => handleCommitAPI('adjust_batch', 'adjust')} className="w-full bg-slate-900 hover:bg-black text-white font-black py-4 rounded-2xl shadow-lg uppercase text-[10px] tracking-widest transition-colors disabled:opacity-50 flex justify-center items-center"><Database size={16} className="mr-2"/> Procesar Hoja de Ajustes</button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* RELOCATE */}
            {activeTab === 'relocate' && (() => {
              const FIELDS = [
                { key: 'bodega',  label: 'Bodega',   placeholder: 'BOD1', idx: 0 },
                { key: 'zona',    label: 'Zona',     placeholder: 'A',    idx: 1 },
                { key: 'pasillo', label: 'Pasillo',  placeholder: 'PA01', idx: 2 },
                { key: 'columna', label: 'Columna',  placeholder: 'C03',  idx: 3 },
                { key: 'fila',    label: 'Fila',     placeholder: 'F02',  idx: 4 },
              ];
              const allLocParts = safeLocs.map(l => l.location_id.split('-'));
              const suggest = (idx) => [...new Set(allLocParts.map(p => p[idx]).filter(Boolean))].sort();
              const composeParts = (p) => [p.bodega||'', p.zona||'', p.pasillo||'', p.columna||'', p.fila||'']
                .map(v => v.trim().toUpperCase()).filter(Boolean).join('-');

              const sel = filteredRelData.find(i => i.id === relSelectedId) || null;
              const queue = permittedInventory.filter(i => destinations[i.id] && destinations[i.id] !== (i.location_id || 'PISO-RECEPCION'));
              const selQty = sel ? (relocateQtys[sel.id] ? parseFloat(relocateQtys[sel.id]) : parseFloat(sel.qty)) : 0;
              const isPartial = sel && selQty < parseFloat(sel?.qty || 0);
              const isMass = relMassMode !== 'individual';
              const isMassSingle = relMassMode === 'mass-single';
              const isMassMulti = relMassMode === 'mass-multi';
              const massComposed = massSingleDest;
              const massSelectedItems = filteredRelData.filter(i => massSelected.includes(i.id));

              const pendingRelocReqs = relocRequests.filter(r => r.status === 'PENDIENTE');
              const isSupervisorPlus = ['JEFE_BODEGA','ADMIN','SUPERADMIN'].includes(currentUser?.role);

              return (
              <div className="space-y-4 animate-in fade-in max-w-7xl mx-auto">

                {/* ── Panel de aprobaciones (solo supervisores) ────────── */}
                {isSupervisorPlus && pendingRelocReqs.length > 0 && (
                  <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl overflow-hidden">
                    <div className="px-5 py-3 bg-amber-100 border-b border-amber-200 flex items-center justify-between">
                      <p className="text-sm font-black text-amber-800 uppercase tracking-tighter flex items-center gap-2">
                        <AlertTriangle size={16}/> Solicitudes Pendientes de Autorización
                        <span className="bg-amber-500 text-white text-[9px] px-2 py-0.5 rounded-full font-black">{pendingRelocReqs.length}</span>
                      </p>
                    </div>
                    <div className="divide-y divide-amber-100">
                      {pendingRelocReqs.map(r => (
                        <div key={r.id} className="px-5 py-4 flex items-start gap-4 flex-wrap">
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs font-black text-slate-700 bg-slate-100 px-2 py-0.5 rounded">{r.lpn_id}</span>
                              <span className="font-black text-xs text-slate-800 uppercase">{r.sku}</span>
                              <span className="text-xs font-bold text-amber-700">×{r.qty}</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] font-bold">
                              <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-600">{r.location_from}</span>
                              <ChevronRight size={10} className="text-amber-400"/>
                              <span className="font-mono bg-purple-100 px-2 py-0.5 rounded text-purple-700">{r.location_to}</span>
                            </div>
                            {r.glosa && <p className="text-[10px] text-slate-500 italic">"{r.glosa}"</p>}
                            <p className="text-[9px] text-slate-400">Solicitado por <strong>{r.requested_by}</strong> · {new Date(r.requested_at).toLocaleString('es-CL')}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button onClick={async()=>{
                              const res = await apiFetch(`${host}/api/relocate-requests/${r.id}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
                              if(res.ok){showMsg('✅ Producto movido correctamente');fetchData();}
                              else{const e=await res.json();showMsg(`⛔ ${e.error}`,true);}
                            }} className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black px-4 py-2 rounded-xl uppercase transition-colors flex items-center gap-1">
                              <CheckCircle2 size={13}/> Aprobar
                            </button>
                            <button onClick={async()=>{
                              const reason = (await prompt({ message: 'Motivo del rechazo (obligatorio):' }));
                              if(!reason) return;
                              const res = await apiFetch(`${host}/api/relocate-requests/${r.id}/reject`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason})});
                              if(res.ok){showMsg('Solicitud rechazada');fetchData();}
                              else{const e=await res.json();showMsg(`⛔ ${e.error}`,true);}
                            }} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-[10px] font-black px-3 py-2 rounded-xl uppercase transition-colors flex items-center gap-1">
                              <X size={13}/> Rechazar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Encabezado + selector de modo ───────────────────── */}
                <div className="flex justify-between items-center flex-wrap gap-3">
                  <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                    <ArrowRightLeft className="text-purple-500"/>
                    {currentUser?.role === 'PICKER' ? 'Solicitar Reubicación' : 'Trasladar Stock'}
                  </h1>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Selector de modo */}
                    <div className="flex bg-slate-100 rounded-2xl p-1 gap-1">
                      {[
                        { id:'individual',   label:'Individual',       icon:'◎' },
                        { id:'mass-single',  label:'Masivo · 1 Punto', icon:'⊞' },
                        { id:'mass-multi',   label:'Masivo · Multi',   icon:'⊟' },
                      ].map(m => (
                        <button key={m.id}
                          onClick={() => { setRelMassMode(m.id); setMassSelected([]); setMassDest({bodega:'',zona:'',pasillo:'',columna:'',fila:''}); setMassDestMap({}); setRelSelectedId(null); }}
                          className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${relMassMode===m.id ? 'bg-purple-600 text-white shadow' : 'text-slate-500 hover:text-slate-700'}`}
                        >{m.icon} {m.label}</button>
                      ))}
                    </div>
                    {/* Búsqueda */}
                    <div className="flex items-center bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm w-56">
                      <Search size={14} className="text-slate-400 mr-2"/>
                      <input type="text" placeholder="Buscar producto o código..." value={relSearchTerm} onChange={e=>setRelSearchTerm(e.target.value)} className="bg-transparent text-xs font-bold outline-none w-full text-slate-700"/>
                    </div>
                    {relSearchTerm && <button onClick={()=>setRelSearchTerm('')} className="bg-red-50 text-red-500 border border-red-200 rounded-xl px-3 py-2 text-[9px] font-black uppercase flex items-center gap-1"><X size={10}/> Limpiar</button>}
                    <span className="text-[10px] font-black text-slate-400 uppercase">{filteredRelData.length} LPNs</span>
                  </div>
                </div>

                {/* ══ MODO INDIVIDUAL ══════════════════════════════════════════ */}
                {!isMass && (
                  <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                    {/* Lista LPNs */}
                    <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Selecciona un LPN para reubicar</p>
                      </div>
                      <div className="overflow-y-auto flex-1 custom-scrollbar" style={{maxHeight:'520px'}}>
                        {filteredRelData.map(i => {
                          const isSel = relSelectedId === i.id;
                          const hasDestino = !!destinations[i.id];
                          return (
                            <button key={i.id} onClick={()=>setRelSelectedId(isSel ? null : i.id)}
                              className={`w-full text-left px-5 py-4 border-b border-slate-100 transition-all flex items-start gap-3 group
                                ${isSel ? 'bg-purple-50 border-l-4 border-l-purple-500' : 'hover:bg-slate-50 border-l-4 border-l-transparent'}`}>
                              <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors
                                ${isSel ? 'border-purple-500 bg-purple-500' : 'border-slate-300 group-hover:border-purple-300'}`}>
                                {isSel && <span className="w-2 h-2 bg-white rounded-full block"/>}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-mono text-[9px] text-slate-400 truncate">{i.id}</p>
                                <p className="font-black text-xs text-slate-800 uppercase truncate mt-0.5">{i.sku}</p>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  <span className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-[9px] font-bold text-slate-600">{i.location_id || 'PISO-RECEPCION'}</span>
                                  <span className="text-[9px] font-bold text-slate-500">{i.qty} un.</span>
                                  {hasDestino && <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[8px] font-black uppercase flex items-center gap-0.5"><ArrowRightLeft size={8}/> {destinations[i.id]}</span>}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                        {filteredRelData.length === 0 && (
                          <div className="p-8 text-center text-slate-400"><Package className="w-10 h-10 mx-auto mb-2 opacity-40"/><p className="text-[10px] font-bold uppercase">Sin stock disponible</p></div>
                        )}
                      </div>
                    </div>

                    {/* Form + cola */}
                    <div className="lg:col-span-3 space-y-4">
                      {!sel && (
                        <div className="bg-white rounded-3xl border-2 border-dashed border-slate-200 p-12 flex flex-col items-center justify-center text-center">
                          <ArrowRightLeft className="w-12 h-12 text-slate-200 mb-4"/>
                          <p className="font-black text-slate-400 uppercase tracking-tighter">Selecciona un LPN</p>
                          <p className="text-xs text-slate-400 mt-1">Haz clic en cualquier LPN de la lista para configurar su reubicación</p>
                        </div>
                      )}
                      {sel && (
                        <div className="space-y-3 animate-in fade-in">
                          {/* Bloque 1 */}
                          <div className="bg-purple-50 border-2 border-purple-200 rounded-3xl p-5">
                            <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest mb-3 flex items-center gap-1"><span className="w-4 h-4 bg-purple-500 text-white rounded-full flex items-center justify-center text-[8px] font-black">1</span> LPN Seleccionado</p>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-mono text-[10px] text-purple-500">{sel.id}</p>
                                <p className="font-black text-base text-purple-900 uppercase mt-0.5">{sel.sku}</p>
                                {sel.batch_number && <p className="text-[10px] text-purple-600 mt-0.5">Lote: {sel.batch_number}</p>}
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-[9px] font-black text-purple-400 uppercase">Stock Total</p>
                                <p className="text-2xl font-black text-purple-700">{sel.qty}</p>
                                <p className="text-[9px] text-purple-500">{sel.uom || 'un.'}</p>
                              </div>
                            </div>
                          </div>
                          {/* Bloque 2 */}
                          <div className="bg-white border-2 border-slate-200 rounded-3xl p-5">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1"><span className="w-4 h-4 bg-slate-400 text-white rounded-full flex items-center justify-center text-[8px] font-black">2</span> Ubicación Actual</p>
                            <div className="flex items-center gap-3">
                              <span className="bg-slate-100 border border-slate-200 rounded-xl px-4 py-2 font-mono text-sm font-black text-slate-700">{sel.location_id || 'PISO-RECEPCION'}</span>
                              <span className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase border ${getStatusBadge(sel.status)}`}>{sel.status || 'DISPONIBLE'}</span>
                            </div>
                          </div>
                          {/* Bloque 3 */}
                          <div className="bg-white border-2 border-slate-200 rounded-3xl p-5">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1"><span className="w-4 h-4 bg-slate-400 text-white rounded-full flex items-center justify-center text-[8px] font-black">3</span> Cantidad a Mover</p>
                            <div className="flex items-center gap-4">
                              <div className="flex-1">
                                <input type="number" min="0.01" step="0.01" max={sel.qty}
                                  disabled={!!sel.serial_number}
                                  value={relocateQtys[sel.id] || ''}
                                  onChange={e => setRelocateQtys({...relocateQtys, [sel.id]: e.target.value})}
                                  placeholder={`Máximo: ${sel.qty}`}
                                  className="w-full border-2 border-purple-200 focus:border-purple-500 rounded-2xl px-4 py-3 text-xl font-black text-center outline-none transition-colors"
                                />
                                {sel.serial_number && <p className="text-[9px] text-amber-600 font-bold mt-1 text-center">Serializado — se mueve completo</p>}
                              </div>
                              <div className="text-center shrink-0">
                                <p className="text-[9px] font-black text-slate-400 uppercase">de {sel.qty}</p>
                                {!sel.serial_number && (
                                  <div className="flex gap-2 mt-2">
                                    <button onClick={()=>setRelocateQtys({...relocateQtys,[sel.id]:sel.qty})} className="text-[8px] font-black bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded-lg uppercase transition-colors">Todo</button>
                                    <button onClick={()=>setRelocateQtys({...relocateQtys,[sel.id]:Math.floor(parseFloat(sel.qty)/2)||1})} className="text-[8px] font-black bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded-lg uppercase transition-colors">½</button>
                                  </div>
                                )}
                              </div>
                            </div>
                            {!sel.serial_number && selQty > 0 && selQty < parseFloat(sel.qty) && (
                              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center gap-2">
                                <Split size={12} className="text-amber-600 shrink-0"/>
                                <p className="text-[10px] font-bold text-amber-700">Reubicación <strong>parcial</strong> — se separará el LPN en dos ({selQty} / {parseFloat(sel.qty) - selQty} un.)</p>
                              </div>
                            )}
                          </div>
                          {/* Bloque 4 — Destino */}
                          <div className={`bg-white border-2 rounded-3xl p-5 transition-colors ${destinations[sel.id] && destinations[sel.id]!==(sel.location_id||'PISO-RECEPCION') ? 'border-purple-300' : 'border-slate-200'}`}>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1">
                              <span className="w-4 h-4 bg-slate-400 text-white rounded-full flex items-center justify-center text-[8px] font-black">4</span>
                              Ubicación Destino
                            </p>
                            <LocPicker
                              value={destinations[sel.id]||''}
                              onChange={v => setDestinations(prev=>({...prev,[sel.id]:v}))}
                              safeLocs={safeLocs}
                            />
                            {destinations[sel.id] && destinations[sel.id]!==(sel.location_id||'PISO-RECEPCION') && (
                              <div className="mt-3 flex items-center gap-2 text-[10px] font-bold text-slate-500">
                                <span className="font-mono bg-slate-100 px-2 py-1 rounded">{sel.location_id||'PISO-RECEPCION'}</span>
                                <ChevronRight size={10} className="text-purple-400"/>
                                <span className="font-mono font-black text-purple-700">{destinations[sel.id]}</span>
                              </div>
                            )}
                          </div>
                          {/* Bloque 5 — Glosa */}
                          <div className="bg-white border-2 border-slate-200 rounded-3xl p-5">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1">
                              <span className="w-4 h-4 bg-slate-300 text-white rounded-full flex items-center justify-center text-[8px] font-black">5</span>
                              Glosa / Motivo <span className="ml-1 text-[8px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full">Opcional</span>
                            </p>
                            <input type="text" placeholder="Ej: Reorganización de zona, pedido prioritario, etc."
                              value={glosas[sel.id]||''} onChange={e=>setGlosas({...glosas,[sel.id]:e.target.value})}
                              className="w-full border-2 border-slate-200 focus:border-purple-400 rounded-2xl px-4 py-3 text-sm font-medium outline-none transition-colors"
                            />
                          </div>
                          {/* Confirmar / Solicitar según rol */}
                          {currentUser?.role === 'PICKER' && (
                            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-2 text-xs text-amber-700 font-bold">
                              <AlertTriangle size={14} className="shrink-0"/> Tu solicitud quedará pendiente de autorización por un supervisor antes de ejecutarse.
                            </div>
                          )}
                          <button
                            disabled={!destinations[sel.id] || destinations[sel.id]===(sel.location_id||'PISO-RECEPCION') || !(safeLocs.some(l=>l.location_id===destinations[sel.id])||destinations[sel.id]==='PISO-RECEPCION')}
                            onClick={()=>{handleRelocate(sel.id,sel.location_id,sel.qty);setRelSelectedId(null);}}
                            className={`w-full disabled:opacity-40 text-white font-black py-4 rounded-2xl uppercase text-sm tracking-widest shadow-lg transition-all flex items-center justify-center gap-3 ${currentUser?.role==='PICKER'?'bg-amber-500 hover:bg-amber-600 shadow-amber-200':'bg-purple-600 hover:bg-purple-700 shadow-purple-200'}`}
                          >
                            {currentUser?.role === 'PICKER'
                              ? <><ClipboardList size={18}/>{isPartial?'Solicitar Reubicación Parcial':'Solicitar Reubicación Total'}</>
                              : <><ArrowRightLeft size={18}/>{isPartial?'Confirmar Reubicación Parcial':'Confirmar Reubicación Total'}</>
                            }
                          </button>
                        </div>
                      )}
                      {/* Cola */}
                      {queue.length > 0 && (
                        <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden animate-in fade-in">
                          <div className="px-5 py-3 bg-purple-50 border-b border-purple-100 flex items-center justify-between">
                            <p className="text-[10px] font-black text-purple-700 uppercase tracking-widest flex items-center gap-2"><ArrowRightLeft size={12}/> Cola de Reubicación <span className="bg-purple-600 text-white text-[8px] px-1.5 py-0.5 rounded-full font-black">{queue.length}</span></p>
                            <p className="text-[9px] text-purple-400 font-bold">Pendientes de confirmar</p>
                          </div>
                          <div className="divide-y divide-slate-100">
                            {queue.map(i => {
                              const mq = relocateQtys[i.id] ? parseFloat(relocateQtys[i.id]) : parseFloat(i.qty);
                              const partial = mq < parseFloat(i.qty);
                              return (
                                <div key={i.id} className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-black text-slate-700 uppercase truncate">{i.sku}</p>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                      <span className="font-mono text-[9px] text-slate-400">{i.location_id||'PISO'}</span>
                                      <ChevronRight size={9} className="text-purple-400"/>
                                      <span className="font-mono text-[9px] font-black text-purple-700">{destinations[i.id]}</span>
                                      <span className="text-[9px] font-bold text-slate-500">{mq} un.</span>
                                      {partial && <span className="text-[8px] bg-amber-100 text-amber-700 px-1 rounded font-black">parcial</span>}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button onClick={()=>{handleRelocate(i.id,i.location_id,i.qty);if(relSelectedId===i.id)setRelSelectedId(null);}} className={`text-white text-[9px] font-black px-3 py-1.5 rounded-xl uppercase transition-colors ${currentUser?.role==='PICKER'?'bg-amber-500 hover:bg-amber-600':'bg-purple-600 hover:bg-purple-700'}`}>{currentUser?.role==='PICKER'?'Solicitar':'Mover'}</button>
                                    <button onClick={()=>{setDestinations(p=>({...p,[i.id]:''}));setRelocateQtys(p=>({...p,[i.id]:''}));setGlosas(p=>({...p,[i.id]:''}));}} className="text-slate-300 hover:text-red-400 transition-colors p-1"><X size={14}/></button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {queue.length > 1 && (
                            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50">
                              <button onClick={async()=>{for(const i of queue){await handleRelocate(i.id,i.location_id,i.qty);}setRelSelectedId(null);}}
                                className="w-full bg-slate-800 hover:bg-slate-900 text-white text-[10px] font-black py-3 rounded-xl uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                              ><ArrowRightLeft size={14}/> Confirmar Todo ({queue.length} movimientos)</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ══ MODO MASIVO · UN SOLO PUNTO ══════════════════════════════ */}
                {isMassSingle && (
                  <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                    {/* Lista con checkboxes */}
                    <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                          {massSelected.length > 0 ? `${massSelected.length} LPNs seleccionados` : 'Selecciona LPNs'}
                        </p>
                        <div className="flex gap-1">
                          <button onClick={()=>setMassSelected(filteredRelData.map(i=>i.id))} className="text-[8px] font-black bg-purple-100 text-purple-700 px-2 py-1 rounded-lg uppercase hover:bg-purple-200 transition-colors">Todos</button>
                          <button onClick={()=>setMassSelected([])} className="text-[8px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded-lg uppercase hover:bg-slate-200 transition-colors">Ninguno</button>
                        </div>
                      </div>
                      <div className="overflow-y-auto flex-1 custom-scrollbar" style={{maxHeight:'520px'}}>
                        {filteredRelData.map(i => {
                          const isChk = massSelected.includes(i.id);
                          return (
                            <button key={i.id} onClick={()=>setMassSelected(prev=>isChk?prev.filter(x=>x!==i.id):[...prev,i.id])}
                              className={`w-full text-left px-5 py-3 border-b border-slate-100 transition-all flex items-center gap-3
                                ${isChk?'bg-purple-50 border-l-4 border-l-purple-500':'hover:bg-slate-50 border-l-4 border-l-transparent'}`}>
                              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${isChk?'border-purple-500 bg-purple-500':'border-slate-300'}`}>
                                {isChk && <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-black text-xs text-slate-800 uppercase truncate">{i.sku}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="font-mono text-[9px] text-slate-400">{i.location_id||'PISO-RECEPCION'}</span>
                                  <span className="text-[9px] font-bold text-slate-500">{i.qty} un.</span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                        {filteredRelData.length === 0 && <div className="p-8 text-center text-slate-400"><Package className="w-10 h-10 mx-auto mb-2 opacity-40"/><p className="text-[10px] font-bold uppercase">Sin stock disponible</p></div>}
                      </div>
                    </div>

                    {/* Panel destino único */}
                    <div className="lg:col-span-3 space-y-4">
                      {massSelected.length === 0 ? (
                        <div className="bg-white rounded-3xl border-2 border-dashed border-slate-200 p-12 flex flex-col items-center justify-center text-center">
                          <ArrowRightLeft className="w-12 h-12 text-slate-200 mb-4"/>
                          <p className="font-black text-slate-400 uppercase tracking-tighter">Selecciona LPNs</p>
                          <p className="text-xs text-slate-400 mt-1">Marca los LPNs que deseas mover al mismo destino</p>
                        </div>
                      ) : (
                        <div className="space-y-4 animate-in fade-in">
                          {/* Resumen selección */}
                          <div className="bg-purple-50 border-2 border-purple-200 rounded-3xl p-5">
                            <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest mb-3">{massSelected.length} LPNs en cola masiva</p>
                            <div className="flex flex-wrap gap-2">
                              {massSelectedItems.map(i => (
                                <div key={i.id} className="bg-white border border-purple-200 rounded-xl px-3 py-1.5 flex items-center gap-2">
                                  <span className="font-black text-xs text-purple-900 uppercase">{i.sku}</span>
                                  <span className="text-[9px] text-purple-500 font-mono">{i.location_id||'PISO'}</span>
                                  <span className="text-[9px] font-bold text-purple-600">{i.qty}u</span>
                                  <button onClick={()=>setMassSelected(prev=>prev.filter(x=>x!==i.id))} className="text-slate-300 hover:text-red-400 transition-colors"><X size={10}/></button>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Destino único */}
                          <div className="bg-white border-2 border-slate-200 rounded-3xl p-5">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">Destino único para todos los LPNs seleccionados</p>
                            <LocPicker
                              value={massSingleDest}
                              onChange={v => setMassSingleDest(v)}
                              safeLocs={safeLocs}
                            />
                          </div>

                          {/* Glosa masiva */}
                          <div className="bg-white border-2 border-slate-200 rounded-3xl p-5">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Glosa / Motivo <span className="ml-1 text-[8px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full">Opcional</span></p>
                            <input type="text" placeholder="Ej: Reorganización masiva de zona A"
                              value={glosas['__mass__']||''} onChange={e=>setGlosas(p=>({...p,'__mass__':e.target.value}))}
                              className="w-full border-2 border-slate-200 focus:border-purple-400 rounded-2xl px-4 py-3 text-sm font-medium outline-none transition-colors"
                            />
                          </div>

                          {/* Confirmar masivo */}
                          <button
                            disabled={!massComposed || massSelected.length === 0}
                            onClick={async () => {
                              const dest = massComposed;
                              const glosa = glosas['__mass__'] || '';
                              for (const id of massSelected) {
                                const item = permittedInventory.find(x => x.id === id);
                                if (item && dest && dest !== (item.location_id || 'PISO-RECEPCION')) {
                                  setDestinations(p => ({...p, [id]: dest}));
                                  setGlosas(p => ({...p, [id]: glosa}));
                                  await handleRelocate(id, item.location_id, item.qty);
                                }
                              }
                              setMassSelected([]);
                              setMassSingleDest('');
                            }}
                            className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white font-black py-4 rounded-2xl uppercase text-sm tracking-widest shadow-lg shadow-purple-200 transition-all flex items-center justify-center gap-3"
                          >
                            <ArrowRightLeft size={18}/>
                            Mover {massSelected.length} LPN{massSelected.length !== 1 ? 's' : ''} → {massComposed || '...'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ══ MODO MASIVO · MÚLTIPLES PUNTOS ═══════════════════════════ */}
                {isMassMulti && (
                  <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                    {/* Lista con checkboxes */}
                    <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                          {massSelected.length > 0 ? `${massSelected.length} LPNs seleccionados` : 'Selecciona LPNs'}
                        </p>
                        <div className="flex gap-1">
                          <button onClick={()=>setMassSelected(filteredRelData.map(i=>i.id))} className="text-[8px] font-black bg-purple-100 text-purple-700 px-2 py-1 rounded-lg uppercase hover:bg-purple-200 transition-colors">Todos</button>
                          <button onClick={()=>setMassSelected([])} className="text-[8px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded-lg uppercase hover:bg-slate-200 transition-colors">Ninguno</button>
                        </div>
                      </div>
                      <div className="overflow-y-auto flex-1 custom-scrollbar" style={{maxHeight:'520px'}}>
                        {filteredRelData.map(i => {
                          const isChk = massSelected.includes(i.id);
                          const dc = massDestMap[i.id] || '';
                          return (
                            <button key={i.id} onClick={()=>setMassSelected(prev=>isChk?prev.filter(x=>x!==i.id):[...prev,i.id])}
                              className={`w-full text-left px-5 py-3 border-b border-slate-100 transition-all flex items-center gap-3
                                ${isChk?'bg-purple-50 border-l-4 border-l-purple-500':'hover:bg-slate-50 border-l-4 border-l-transparent'}`}>
                              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${isChk?'border-purple-500 bg-purple-500':'border-slate-300'}`}>
                                {isChk && <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-black text-xs text-slate-800 uppercase truncate">{i.sku}</p>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  <span className="font-mono text-[9px] text-slate-400">{i.location_id||'PISO'}</span>
                                  <span className="text-[9px] font-bold text-slate-500">{i.qty}u</span>
                                  {dc && <span className="bg-purple-100 text-purple-700 px-1 py-0.5 rounded text-[8px] font-black flex items-center gap-0.5"><ArrowRightLeft size={7}/>{dc}</span>}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                        {filteredRelData.length === 0 && <div className="p-8 text-center text-slate-400"><Package className="w-10 h-10 mx-auto mb-2 opacity-40"/><p className="text-[10px] font-bold uppercase">Sin stock disponible</p></div>}
                      </div>
                    </div>

                    {/* Panel destinos individuales */}
                    <div className="lg:col-span-3 space-y-4">
                      {massSelected.length === 0 ? (
                        <div className="bg-white rounded-3xl border-2 border-dashed border-slate-200 p-12 flex flex-col items-center justify-center text-center">
                          <ArrowRightLeft className="w-12 h-12 text-slate-200 mb-4"/>
                          <p className="font-black text-slate-400 uppercase tracking-tighter">Selecciona LPNs</p>
                          <p className="text-xs text-slate-400 mt-1">Marca los LPNs y asigna un destino distinto a cada uno</p>
                        </div>
                      ) : (
                        <div className="space-y-3 animate-in fade-in">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{massSelected.length} LPNs — Destinos individuales</p>
                            <button
                              onClick={() => {
                                const first = massDestMap[massSelected[0]];
                                if (first) {
                                  const upd = {};
                                  massSelected.forEach(id => { upd[id] = first; });
                                  setMassDestMap(p => ({...p, ...upd}));
                                }
                              }}
                              className="text-[8px] font-black bg-slate-100 hover:bg-slate-200 text-slate-500 px-3 py-1.5 rounded-xl uppercase transition-colors"
                            >Copiar 1º a todos</button>
                          </div>

                          <div className="space-y-3 overflow-y-auto" style={{maxHeight:'540px'}}>
                            {massSelectedItems.map((i, idx) => {
                              const dc = massDestMap[i.id] || '';
                              const dcExists = dc && (safeLocs.some(l => l.location_id === dc) || dc === 'PISO-RECEPCION');
                              const dcSame = dc === (i.location_id || 'PISO-RECEPCION');
                              return (
                                <div key={i.id} className={`bg-white border-2 rounded-2xl p-4 transition-colors ${dc && !dcSame ? 'border-purple-200' : 'border-slate-200'}`}>
                                  {/* Encabezado LPN */}
                                  <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 bg-purple-600 text-white rounded-full flex items-center justify-center text-[8px] font-black shrink-0">{idx+1}</span>
                                      <div>
                                        <p className="font-black text-xs text-slate-800 uppercase">{i.sku}</p>
                                        <p className="font-mono text-[9px] text-slate-400">{i.location_id||'PISO-RECEPCION'} · {i.qty} un.</p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {dc && (
                                        <span className={`font-mono text-[9px] font-black px-2 py-1 rounded-lg ${dcSame?'bg-amber-100 text-amber-700':dcExists?'bg-emerald-100 text-emerald-700':'bg-red-100 text-red-700'}`}>{dc}</span>
                                      )}
                                      <button onClick={()=>setMassSelected(prev=>prev.filter(x=>x!==i.id))} className="text-slate-200 hover:text-red-400 transition-colors"><X size={14}/></button>
                                    </div>
                                  </div>
                                  <LocPicker
                                    value={dc}
                                    onChange={v => setMassDestMap(prev => ({...prev, [i.id]: v}))}
                                    safeLocs={safeLocs}
                                    compact={true}
                                  />
                                </div>
                              );
                            })}
                          </div>

                          {/* Confirmar todo */}
                          {(() => {
                            const readyCount = massSelectedItems.filter(i => {
                              const dc = massDestMap[i.id] || '';
                              return dc && dc !== (i.location_id || 'PISO-RECEPCION') && (safeLocs.some(l=>l.location_id===dc)||dc==='PISO-RECEPCION');
                            }).length;
                            return (
                              <button
                                disabled={readyCount === 0}
                                onClick={async () => {
                                  for (const i of massSelectedItems) {
                                    const dc = massDestMap[i.id] || '';
                                    if (dc && dc !== (i.location_id || 'PISO-RECEPCION') && (safeLocs.some(l=>l.location_id===dc)||dc==='PISO-RECEPCION')) {
                                      setDestinations(p => ({...p, [i.id]: dc}));
                                      await handleRelocate(i.id, i.location_id, i.qty);
                                    }
                                  }
                                  setMassSelected([]);
                                  setMassDestMap({});
                                }}
                                className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white font-black py-4 rounded-2xl uppercase text-sm tracking-widest shadow-lg shadow-purple-200 transition-all flex items-center justify-center gap-3"
                              >
                                <ArrowRightLeft size={18}/>
                                Confirmar {readyCount} de {massSelected.length} movimientos
                              </button>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                )}

              </div>
              );
            })()}

            {/* ÓRDENES DE COMPRA */}
            {activeTab === 'purchase-orders' && (
              <div className="space-y-6 animate-in fade-in max-w-5xl mx-auto">
                <div className="flex items-center justify-between">
                  <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><FileText className="text-indigo-500"/> Órdenes de Compra</h1>
                  <div className="flex gap-2">
                    <button onClick={async () => { const res = await apiFetch(`${host}/api/purchase-orders`); const d = await res.json(); setPurchaseOrders(Array.isArray(d)?d:[]); }} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2"><RefreshCcw size={12}/> Cargar</button>
                    <button onClick={() => setShowPOForm(!showPOForm)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 shadow-md"><Plus size={12}/> Nueva OC</button>
                  </div>
                </div>

                {showPOForm && (
                  <div className="bg-white rounded-3xl border border-indigo-200 shadow-sm p-8 animate-in slide-in-from-top-4">
                    <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter mb-6 border-b pb-4 flex items-center gap-2"><FileText size={16} className="text-indigo-500"/> Crear Nueva Orden de Compra</h3>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <input type="text" placeholder="N° OC / Referencia *" value={newPO.doc_num} onChange={e=>setNewPO({...newPO,doc_num:e.target.value.toUpperCase()})} className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black uppercase outline-none focus:border-indigo-500"/>
                      <input type="text" placeholder="Proveedor *" value={newPO.supplier} onChange={e=>setNewPO({...newPO,supplier:e.target.value})} className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500"/>
                      {is3PLMode ? (
                        <select value={newPO.client_id} onChange={e=>setNewPO({...newPO,client_id:e.target.value})} className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 bg-white">
                          <option value="">-- Cliente Destino --</option>
                          {permittedClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      ) : (
                        <div className="border-2 border-emerald-200 bg-emerald-50 rounded-xl px-4 py-3 text-sm font-black text-emerald-700 flex items-center gap-2">
                          <Package size={14} className="text-emerald-500 shrink-0"/>{systemConfig.own_client_name || 'Bodega Propia'}
                        </div>
                      )}
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase">Fecha Esperada de Llegada</label>
                        <input type="date" value={newPO.expected_date} onChange={e=>setNewPO({...newPO,expected_date:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 bg-white"/>
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-4 mb-4">
                      <p className="text-[10px] font-black text-slate-500 uppercase mb-3">Líneas de Productos Esperados</p>
                      <div className="flex gap-3 mb-3">
                        <select value={newPOLine.sku} onChange={e=>setNewPOLine({...newPOLine,sku:e.target.value})} className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white uppercase">
                          <option value="">-- SKU --</option>
                          {permittedSkus.filter(s=>!newPO.client_id || (s.client_id||'')===newPO.client_id).map(s=><option key={s.sku} value={s.sku}>{s.sku} — {s.desc}</option>)}
                        </select>
                        <input type="number" min="0.01" placeholder="Cant. Esperada" value={newPOLine.expected_qty} onChange={e=>setNewPOLine({...newPOLine,expected_qty:e.target.value})} className="w-36 border border-slate-200 rounded-xl px-3 py-2 text-xs font-black outline-none text-center"/>
                        <button onClick={() => { if (!newPOLine.sku || !newPOLine.expected_qty) return; setNewPO(p=>({...p,items:[...p.items,{...newPOLine}]})); setNewPOLine({sku:'',expected_qty:''}); }} className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1"><Plus size={12}/> Agregar</button>
                      </div>
                      {newPO.items.map((it,i) => (
                        <div key={i} className="flex justify-between items-center bg-white p-3 rounded-xl border border-slate-200 mb-2">
                          <span className="text-xs font-black uppercase text-slate-800">{it.sku} <span className="text-slate-400 font-normal">— esperado: {it.expected_qty} un</span></span>
                          <button onClick={()=>setNewPO(p=>({...p,items:p.items.filter((_,idx)=>idx!==i)}))} className="text-red-400 hover:text-red-600"><X size={14}/></button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-3">
                      <button disabled={!newPO.doc_num || !newPO.supplier || newPO.items.length===0} onClick={async () => { const poPayload={...newPO,username:currentUser.username}; if((!is3PLMode || isHybridMode) && !poPayload.client_id) poPayload.client_id=systemConfig.own_client_id||'PROPIO'; if(is3PLMode && !poPayload.client_id) return showMsg('⛔ Selecciona el cliente de la orden de compra', true); const res = await apiFetch(`${host}/api/purchase-orders`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(poPayload)}); if(res.ok){const d=await res.json(); showMsg(`✅ OC ${d.poId} creada`); setNewPO({doc_num:'',supplier:'',client_id:'',expected_date:'',notes:'',items:[]}); setShowPOForm(false); const r2=await apiFetch(`${host}/api/purchase-orders`); setPurchaseOrders(await r2.json());} else { const e=await res.json().catch(()=>({})); showMsg(`⛔ ${e.error||'Error'}`,true); } }} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 rounded-2xl shadow-lg uppercase text-[10px] tracking-widest disabled:opacity-50">Crear Orden de Compra</button>
                      <button onClick={() => setShowPOForm(false)} className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-black py-3 px-6 rounded-2xl uppercase text-[10px]">Cancelar</button>
                    </div>
                  </div>
                )}

                {activePO ? (
                  <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="bg-indigo-50 p-6 border-b border-indigo-200 flex justify-between items-center">
                      <div>
                        <h3 className="text-lg font-black text-indigo-900 uppercase">{activePO.doc_num} — {activePO.supplier}</h3>
                        <p className="text-[10px] font-bold text-indigo-600 uppercase">Comparar cantidades recibidas vs esperadas</p>
                      </div>
                      <button onClick={() => { setActivePO(null); setPoLines([]); setPoReceivedQtys({}); }} className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase"><ArrowLeft size={12} className="inline mr-1"/> Volver</button>
                    </div>
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b"><tr>
                        <th className="p-4 text-[10px] font-black text-slate-400 uppercase">SKU / Producto</th>
                        <th className="p-4 text-center text-[10px] font-black text-slate-400 uppercase">Esperado</th>
                        <th className="p-4 text-center text-[10px] font-black text-indigo-600 uppercase">Recibido Real</th>
                        <th className="p-4 text-center text-[10px] font-black text-slate-400 uppercase">Diferencia</th>
                        <th className="p-4 text-center text-[10px] font-black text-slate-400 uppercase">Estado</th>
                      </tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {poLines.map(line => {
                          const received = parseFloat(poReceivedQtys[line.id] ?? line.received_qty ?? 0);
                          const expected = parseFloat(line.expected_qty);
                          const diff = received - expected;
                          return (
                            <tr key={line.id} className={`hover:bg-slate-50 ${diff < 0 ? 'bg-red-50/30' : diff > 0 ? 'bg-amber-50/30' : ''}`}>
                              <td className="p-4"><p className="text-xs font-black text-slate-800 uppercase">{line.sku}</p><p className="text-[9px] text-slate-500">{line.desc}</p></td>
                              <td className="p-4 text-center font-black text-slate-700">{expected} <span className="text-[9px] text-slate-400">{line.uom||'UN'}</span></td>
                              <td className="p-4 text-center">
                                {line.status === 'RECEIVED' ? <span className="font-black text-emerald-700">{line.received_qty}</span> : (
                                  <input type="number" min="0" step="0.01" value={poReceivedQtys[line.id] ?? ''} onChange={e=>setPoReceivedQtys(p=>({...p,[line.id]:e.target.value}))} className="w-24 border-2 border-indigo-200 rounded-xl px-3 py-2 text-center font-black text-sm outline-none focus:border-indigo-500 text-indigo-700 bg-indigo-50" placeholder="0"/>
                                )}
                              </td>
                              <td className="p-4 text-center">
                                {line.status === 'RECEIVED' ? (
                                  <span className={`font-black text-sm ${parseFloat(line.difference)===0?'text-emerald-600':parseFloat(line.difference)>0?'text-amber-600':'text-red-600'}`}>
                                    {parseFloat(line.difference)>0?'+':''}{line.difference}
                                  </span>
                                ) : (
                                  poReceivedQtys[line.id] !== undefined && (
                                    <span className={`font-black text-sm ${diff===0?'text-emerald-600':diff>0?'text-amber-600':'text-red-600'}`}>
                                      {diff>0?'+':''}{diff.toFixed(2)}
                                    </span>
                                  )
                                )}
                              </td>
                              <td className="p-4 text-center">
                                <span className={`text-[9px] font-black px-2 py-1 rounded uppercase ${line.status==='RECEIVED'?'bg-emerald-100 text-emerald-700':line.status==='PARTIAL'?'bg-amber-100 text-amber-700':'bg-slate-100 text-slate-600'}`}>
                                  {line.status==='RECEIVED'?'Completo':line.status==='PARTIAL'?'Parcial':'Pendiente'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
                      <div className="flex gap-4 text-[10px] font-black text-slate-500 uppercase">
                        <span>Total líneas: {poLines.length}</span>
                        <span className="text-emerald-600">Completas: {poLines.filter(l=>l.status==='RECEIVED').length}</span>
                        <span className="text-red-500">Pendientes: {poLines.filter(l=>l.status==='PENDING').length}</span>
                      </div>
                      <button onClick={async () => {
                        const items = poLines.filter(l=>l.status!=='RECEIVED' && poReceivedQtys[l.id]!==undefined).map(l=>({lineId:l.id,received_qty:parseFloat(poReceivedQtys[l.id])||0}));
                        if (!items.length) return showMsg('⚠️ Ingresa cantidades recibidas primero', true);
                        const res = await apiFetch(`${host}/api/purchase-orders/${activePO.id}/receive`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({received_items:items,username:currentUser.username})});
                        if(res.ok){showMsg('✅ Recepción comparada y guardada');const r2=await apiFetch(`${host}/api/purchase-orders/${activePO.id}/lines`);const d=await r2.json();setPoLines(d.lines);setPoReceivedQtys({});}else showMsg('⛔ Error',true);
                      }} className="bg-indigo-600 hover:bg-indigo-700 text-white font-black px-6 py-3 rounded-2xl shadow-md uppercase text-[10px] tracking-widest flex items-center gap-2"><CheckCircle2 size={14}/> Confirmar Recepción</button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {purchaseOrders.map(po => (
                      <div key={po.id} className={`bg-white p-5 rounded-2xl border shadow-sm flex items-center justify-between hover:shadow-md transition-all ${po.status==='COMPLETED'?'border-emerald-200':po.status==='PARTIAL'?'border-amber-200':'border-slate-200'}`}>
                        <div>
                          <div className="flex items-center gap-3 mb-1">
                            <p className="text-sm font-black text-slate-800 uppercase">{po.doc_num}</p>
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${po.status==='COMPLETED'?'bg-emerald-100 text-emerald-700':po.status==='PARTIAL'?'bg-amber-100 text-amber-700':'bg-slate-100 text-slate-600'}`}>{po.status}</span>
                          </div>
                          <p className="text-[10px] text-slate-500 font-bold">Proveedor: {po.supplier} · {po.received_lines}/{po.total_lines} líneas recibidas</p>
                          {po.expected_date && <p className="text-[9px] text-slate-400 mt-0.5">Esperado: {new Date(po.expected_date).toLocaleDateString('es-ES')}</p>}
                        </div>
                        <button onClick={async () => { const res = await apiFetch(`${host}/api/purchase-orders/${po.id}/lines`); const d = await res.json(); setActivePO(d.po); setPoLines(d.lines); setPoReceivedQtys({}); }} className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1"><Search size={12}/> Ver / Comparar</button>
                      </div>
                    ))}
                    {purchaseOrders.length === 0 && <div className="bg-slate-100 border-2 border-dashed border-slate-300 rounded-3xl p-16 text-center text-slate-400"><FileText className="w-12 h-12 mx-auto mb-3 opacity-50"/><p className="font-black uppercase tracking-widest text-xs">No hay órdenes. Presiona Cargar o crea una nueva.</p></div>}
                  </div>
                )}
              </div>
            )}

            {/* HISTORIAL DOCUMENTOS */}
            {activeTab === 'doc-history' && (
              <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><History className="text-slate-500"/> Historial de Documentos</h1>
                  <div className="flex gap-2">
                    {['ADMIN','SUPERADMIN'].includes(currentUser?.role) && (
                      <button onClick={async()=>{ const r=await apiFetch(`${host}/api/anulation-requests?status=PENDIENTE`); if(r.ok){const d=await r.json();setAnulationRequests(d);} setAnulHistoryTab('requests'); }} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 transition-colors ${anulHistoryTab==='requests'?'bg-red-600 text-white shadow-md':'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'}`}>
                        <XCircle size={12}/> Solicitudes Anulación
                        {anulationRequests.filter(r=>r.status==='PENDIENTE').length > 0 && <span className="bg-white text-red-600 px-1.5 rounded-full text-[8px] font-black">{anulationRequests.filter(r=>r.status==='PENDIENTE').length}</span>}
                      </button>
                    )}
                    <button onClick={async()=>{ setAnulHistoryTab('docs'); setDocHistoryPage(0); const params=new URLSearchParams(); if(docHistoryModule) params.append('module',docHistoryModule); if(docHistorySearch) params.append('search',docHistorySearch); if(docHistoryDateFrom) params.append('date_from',docHistoryDateFrom); if(docHistoryDateTo) params.append('date_to',docHistoryDateTo); const res=await apiFetch(`${host}/api/document-history?${params}`); const d=await res.json(); setDocHistory(Array.isArray(d)?d:[]); }} className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 shadow-sm"><Search size={12}/> Buscar</button>
                    {docHistory.length > 0 && <button onClick={()=> exportToExcel(docHistory,[{key:'created_at',header:'Fecha',format:'date'},{key:'module',header:'Módulo',format:'text'},{key:'doc_type',header:'Tipo Doc',format:'text'},{key:'doc_num',header:'N° Documento',format:'text'},{key:'glosa',header:'Glosa',format:'text'},{key:'username',header:'Usuario',format:'text'},{key:'total_qty',header:'Cantidad Total',format:'number'},{key:'status',header:'Estado',format:'text'},{key:'client_id',header:'Cliente ID',format:'text'}],`historial-docs${docHistoryModule?'_'+docHistoryModule:''}_${new Date().toISOString().slice(0,10)}`,'Historial')} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2"><Download size={12}/> Excel</button>}
                  </div>
                </div>

                {/* ── SOLICITUDES DE ANULACIÓN (solo admins) ── */}
                {anulHistoryTab === 'requests' && ['ADMIN','SUPERADMIN'].includes(currentUser?.role) && (
                  <div className="space-y-3">
                    <div className="flex gap-2 items-center">
                      {['PENDIENTE','APROBADA','RECHAZADA'].map(s=>(
                        <button key={s} onClick={async()=>{ const r=await apiFetch(`${host}/api/anulation-requests?status=${s}`); if(r.ok){const d=await r.json();setAnulationRequests(d);} }} className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border transition-colors ${s==='PENDIENTE'?'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100':s==='APROBADA'?'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100':'bg-red-50 border-red-300 text-red-700 hover:bg-red-100'}`}>{s}</button>
                      ))}
                      <button onClick={()=>setAnulHistoryTab('docs')} className="ml-auto text-slate-400 hover:text-slate-700 text-[10px] font-black uppercase flex items-center gap-1"><ArrowLeft size={12}/> Volver al historial</button>
                    </div>
                    {anulationRequests.length === 0 && <div className="bg-slate-100 border-2 border-dashed border-slate-300 rounded-3xl p-12 text-center text-slate-400"><XCircle className="w-10 h-10 mx-auto mb-2 opacity-40"/><p className="font-black uppercase text-xs">Sin solicitudes</p></div>}
                    {anulationRequests.map(req => (
                      <div key={req.id} className={`bg-white rounded-2xl border-2 shadow-sm p-5 ${req.status==='PENDIENTE'?'border-amber-200':req.status==='APROBADA'?'border-emerald-200':'border-red-200'}`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${req.status==='PENDIENTE'?'bg-amber-100 text-amber-700':req.status==='APROBADA'?'bg-emerald-100 text-emerald-700':'bg-red-100 text-red-700'}`}>{req.status}</span>
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded border ${req.module==='receive'?'bg-emerald-50 text-emerald-700 border-emerald-200':'bg-blue-50 text-blue-700 border-blue-200'}`}>{req.module==='receive'?'RECEPCIÓN':'DESPACHO'}</span>
                            </div>
                            <p className="text-sm font-black text-slate-800 uppercase">{req.doc_type ? `[${req.doc_type}]` : ''} {req.doc_num}</p>
                            <p className="text-xs text-slate-600 mt-1">Motivo: <span className="font-bold">"{req.reason}"</span></p>
                            <p className="text-[10px] text-slate-400 mt-1">Solicitado por <strong>{req.requested_by}</strong> · {new Date(req.created_at).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})}</p>
                            {req.authorized_by && <p className="text-[10px] text-slate-400">Procesado por <strong>{req.authorized_by}</strong> · {req.resolved_at && new Date(req.resolved_at).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})}</p>}
                            {req.reject_reason && <p className="text-[10px] text-red-500 mt-1">Rechazo: "{req.reject_reason}"</p>}
                          </div>
                          {req.status === 'PENDIENTE' && (
                            <div className="flex gap-2 shrink-0">
                              <button onClick={async()=>{
                                if(!(await confirm({ message: `¿Aprobar la anulación del documento ${req.doc_num}?\nEsto revertirá el stock.`, danger: true }))) return;
                                const r=await apiFetch(`${host}/api/anulation-requests/${req.id}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
                                if(r.ok){showMsg('✅ Anulación aprobada y stock revertido');const d=await apiFetch(`${host}/api/anulation-requests?status=PENDIENTE`);if(d.ok)setAnulationRequests(await d.json());fetchData();}
                                else{const e=await r.json();showMsg(`⛔ ${e.error}`,true);}
                              }} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1.5 transition-colors">
                                <CheckCircle2 size={12}/> Aprobar
                              </button>
                              <button onClick={async()=>{
                                const motivo=(await prompt({ message: 'Motivo del rechazo (opcional):' }));
                                if(motivo===null) return;
                                const r=await apiFetch(`${host}/api/anulation-requests/${req.id}/reject`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reject_reason:motivo})});
                                if(r.ok){showMsg('Solicitud rechazada');const d=await apiFetch(`${host}/api/anulation-requests?status=PENDIENTE`);if(d.ok)setAnulationRequests(await d.json());}
                                else{const e=await r.json();showMsg(`⛔ ${e.error}`,true);}
                              }} className="bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1.5 transition-colors border border-red-200">
                                <X size={12}/> Rechazar
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── HISTORIAL DE DOCUMENTOS ── */}
                {anulHistoryTab === 'docs' && (
                  <>
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <select value={docHistoryModule} onChange={e=>setDocHistoryModule(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white text-slate-700 uppercase">
                          <option value="">Todos los módulos</option>
                          <option value="receive">Recepciones</option>
                          <option value="dispatch">Despachos</option>
                          <option value="adjust">Ajustes</option>
                        </select>
                        <input type="text" placeholder="🔍 N° doc, glosa, usuario..." value={docHistorySearch} onChange={e=>setDocHistorySearch(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none text-slate-700"/>
                        <input type="date" value={docHistoryDateFrom} onChange={e=>setDocHistoryDateFrom(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white text-slate-700" title="Desde"/>
                        <input type="date" value={docHistoryDateTo} onChange={e=>setDocHistoryDateTo(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white text-slate-700" title="Hasta"/>
                      </div>
                    </div>
                    {/* Paginación historial de documentos */}
                    {docHistory.length > 0 && (() => {
                      const DH_PAGE_SIZE = 50;
                      const totalPages = Math.ceil(docHistory.length / DH_PAGE_SIZE);
                      return totalPages > 1 ? (
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-bold text-slate-400 uppercase">{docHistory.length} documentos — página {docHistoryPage + 1} de {totalPages}</p>
                          <div className="flex gap-2">
                            <button disabled={docHistoryPage === 0} onClick={() => setDocHistoryPage(p => p - 1)} className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">← Anterior</button>
                            <button disabled={docHistoryPage >= totalPages - 1} onClick={() => setDocHistoryPage(p => p + 1)} className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">Siguiente →</button>
                          </div>
                        </div>
                      ) : null;
                    })()}
                    <div className="space-y-3">
                      {docHistory.slice(docHistoryPage * 50, (docHistoryPage + 1) * 50).map(doc => {
                        const isVoided = doc.status === 'ANULADO';
                        const canVoid = ['receive','dispatch'].includes(doc.module) && !isVoided;
                        const isAdmin = ['ADMIN','SUPERADMIN'].includes(currentUser?.role);
                        return (
                          <div key={doc.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${isVoided?'border-red-200 opacity-70':'border-slate-200'}`}>
                            <div className="flex items-center justify-between p-5 cursor-pointer hover:bg-slate-50" onClick={() => setExpandedHistoryDoc(expandedHistoryDoc===doc.id ? null : doc.id)}>
                              <div className="flex items-center gap-4">
                                <div className={`p-2.5 rounded-xl ${isVoided?'bg-red-100 text-red-400':doc.module==='receive'?'bg-emerald-100 text-emerald-600':doc.module==='dispatch'?'bg-blue-100 text-blue-600':'bg-amber-100 text-amber-600'}`}>
                                  {isVoided?<XCircle size={16}/>:doc.module==='receive'?<ArrowDownRight size={16}/>:doc.module==='dispatch'?<ArrowUpRight size={16}/>:<ClipboardCheck size={16}/>}
                                </div>
                                <div>
                                  <p className={`text-sm font-black uppercase flex items-center gap-2 ${isVoided?'text-red-400 line-through':'text-slate-800'}`}>
                                    [{doc.doc_type||doc.module.toUpperCase()}] {doc.doc_num}
                                    {isVoided
                                      ? <span className="text-[9px] px-2 py-0.5 rounded font-black bg-red-100 text-red-600 no-underline" style={{textDecoration:'none'}}>ANULADO</span>
                                      : <span className={`text-[9px] px-2 py-0.5 rounded font-black ${doc.module==='receive'?'bg-emerald-100 text-emerald-700':doc.module==='dispatch'?'bg-blue-100 text-blue-700':'bg-amber-100 text-amber-700'}`}>{doc.module==='receive'?'RECEPCIÓN':doc.module==='dispatch'?'DESPACHO':'AJUSTE'}</span>
                                    }
                                  </p>
                                  <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                                    <span>👤 {doc.username}</span><span>·</span>
                                    <span>{new Date(doc.created_at).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})}</span>
                                    {doc.glosa && <span>· "{doc.glosa}"</span>}
                                    {doc.doc_ref && <span>· Ref: <strong>{doc.doc_ref}</strong></span>}
                                    {doc.doc_date && <span>· 📅 {doc.doc_date}</span>}
                                  </p>
                                  {isVoided && <p className="text-[9px] text-red-500 font-bold mt-0.5">Anulado por {doc.voided_by} · Motivo: "{doc.void_reason}"</p>}
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="text-right">
                                  <p className={`text-lg font-black ${isVoided?'text-red-400':'text-slate-800'}`}>{Number(doc.total_qty).toLocaleString()}</p>
                                  <p className="text-[9px] text-slate-400 uppercase font-bold">unidades</p>
                                </div>
                                {canVoid && (
                                  <button onClick={e=>{e.stopPropagation();setVoidModal({doc});setVoidReason('');}} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase flex items-center gap-1 transition-colors">
                                    <XCircle size={11}/> {isAdmin?'Anular':'Solicitar Anulación'}
                                  </button>
                                )}
                                <ChevronRight size={16} className={`text-slate-400 transition-transform ${expandedHistoryDoc===doc.id?'rotate-90':''}`}/>
                              </div>
                            </div>
                            {expandedHistoryDoc === doc.id && (
                              <div className="border-t border-slate-100 bg-slate-50 p-4">
                                <table className="w-full text-left">
                                  <thead><tr><th className="p-2 text-[9px] font-black text-slate-400 uppercase">SKU</th><th className="p-2 text-[9px] font-black text-slate-400 uppercase">Descripción</th><th className="p-2 text-center text-[9px] font-black text-slate-400 uppercase">Cantidad</th><th className="p-2 text-[9px] font-black text-slate-400 uppercase">Detalle</th></tr></thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {JSON.parse(doc.items_json||'[]').map((item,i) => (
                                      <tr key={i} className="bg-white hover:bg-slate-50">
                                        <td className="p-2 text-xs font-black text-slate-800 uppercase">{item.sku}</td>
                                        <td className="p-2 text-[10px] text-slate-500 truncate max-w-[200px]">{item.desc||'-'}</td>
                                        <td className="p-2 text-center font-black text-slate-700">{item.qty||item.qtyToPick||'-'}</td>
                                        <td className="p-2 text-[9px] text-slate-400">{item.location_id||item.lpnId||'-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {docHistory.length === 0 && <div className="bg-slate-100 border-2 border-dashed border-slate-300 rounded-3xl p-16 text-center text-slate-400"><History className="w-12 h-12 mx-auto mb-3 opacity-50"/><p className="font-black uppercase tracking-widest text-xs">Usa los filtros y presiona Buscar</p></div>}
                    </div>
                  </>
                )}

                {/* ── MODAL DE ANULACIÓN ── */}
                {voidModal && (
                  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={e=>{if(e.target===e.currentTarget)setVoidModal(null);}}>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md">
                      <div className="bg-red-600 rounded-t-3xl px-6 py-5 flex items-center justify-between">
                        <div>
                          <p className="text-white font-black uppercase tracking-tight flex items-center gap-2"><XCircle size={18}/> {['ADMIN','SUPERADMIN'].includes(currentUser?.role)?'Anular Documento':'Solicitar Anulación'}</p>
                          <p className="text-red-200 text-[11px] mt-0.5 uppercase font-bold">[{voidModal.doc.doc_type||voidModal.doc.module}] {voidModal.doc.doc_num}</p>
                        </div>
                        <button onClick={()=>setVoidModal(null)} className="text-white/70 hover:text-white"><X size={18}/></button>
                      </div>
                      <div className="p-6 space-y-4">
                        {!['ADMIN','SUPERADMIN'].includes(currentUser?.role) && (
                          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-[11px] text-amber-800 font-bold">
                            ⚠️ No tienes permisos para anular directamente. Se enviará una solicitud a un administrador para su aprobación.
                          </div>
                        )}
                        {['ADMIN','SUPERADMIN'].includes(currentUser?.role) && (
                          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-[11px] text-red-800 font-bold">
                            ⚠️ Esta acción {voidModal.doc.module==='receive'?'eliminará los LPNs creados en esta recepción':'restaurará las cantidades despachadas al inventario'}. No se puede deshacer.
                          </div>
                        )}
                        <div>
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Motivo de la anulación *</label>
                          <textarea rows={3} value={voidReason} onChange={e=>setVoidReason(e.target.value)} placeholder="Describe el motivo de la anulación..." className="w-full border-2 border-slate-200 focus:border-red-400 rounded-xl px-4 py-3 text-sm font-medium outline-none resize-none"/>
                        </div>
                        <div className="flex gap-3">
                          <button onClick={()=>setVoidModal(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl py-3 font-black uppercase text-[10px] transition-colors">Cancelar</button>
                          <button disabled={!voidReason.trim()} onClick={async()=>{
                            const isAdmin = ['ADMIN','SUPERADMIN'].includes(currentUser?.role);
                            const endpoint = isAdmin
                              ? `${host}/api/document-history/${voidModal.doc.id}/void`
                              : `${host}/api/document-history/${voidModal.doc.id}/void-request`;
                            const r = await apiFetch(endpoint, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reason:voidReason.trim()})});
                            if(r.ok){
                              showMsg(isAdmin?'✅ Documento anulado y stock revertido':'✅ Solicitud enviada al administrador');
                              setVoidModal(null);
                              // Refrescar historial
                              const params=new URLSearchParams(); if(docHistoryModule) params.append('module',docHistoryModule); if(docHistorySearch) params.append('search',docHistorySearch); if(docHistoryDateFrom) params.append('date_from',docHistoryDateFrom); if(docHistoryDateTo) params.append('date_to',docHistoryDateTo);
                              const res=await apiFetch(`${host}/api/document-history?${params}`); const d=await res.json(); setDocHistory(Array.isArray(d)?d:[]);
                              if(isAdmin) fetchData();
                            } else {const e=await r.json();showMsg(`⛔ ${e.error}`,true);}
                          }} className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-xl py-3 font-black uppercase text-[10px] transition-colors flex items-center justify-center gap-2">
                            <XCircle size={14}/> {['ADMIN','SUPERADMIN'].includes(currentUser?.role)?'Anular Ahora':'Enviar Solicitud'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 3PL BILLING */}
            {activeTab === '3pl-billing' && is3PLMode && (
              <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
                {/* Cabecera + tabs */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><Building2 className="text-blue-500"/> Facturación 3PL</h1>
                    <p className="text-[10px] font-bold text-blue-600 uppercase">Cobros por almacenaje, movimientos y servicios de valor agregado</p>
                  </div>
                  <div className="flex gap-2">
                    {[['generate','Generar Cobro',FileText],['invoices','Facturas',ClipboardList],['summary','Resumen Período',BarChart3],['tariffs','Tarifas',Tag]].map(([t,label,Icon])=>(
                      <button key={t} onClick={()=>setBillingTab(t)} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 transition-colors ${billingTab===t?'bg-blue-600 text-white shadow':'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}><Icon size={12}/>{label}</button>
                    ))}
                  </div>
                </div>

                {/* ── TAB: GENERAR COBRO ── */}
                {billingTab === 'generate' && (
                  <div className="space-y-5">
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
                      <h3 className="text-sm font-black text-slate-700 uppercase mb-4">Parámetros del Cobro</h3>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 items-end">
                        <div className="md:col-span-2 space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase">Cliente</label>
                          <select value={billingClientId} onChange={e=>{setBillingClientId(e.target.value);setBillingReport(null);}} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-blue-500 bg-white">
                            <option value="">-- Seleccionar cliente --</option>
                            {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase">Mes</label>
                          <select value={billingMonth} onChange={e=>setBillingMonth(e.target.value)} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-blue-500 bg-white">
                            {[['01','Enero'],['02','Febrero'],['03','Marzo'],['04','Abril'],['05','Mayo'],['06','Junio'],['07','Julio'],['08','Agosto'],['09','Septiembre'],['10','Octubre'],['11','Noviembre'],['12','Diciembre']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase">Año</label>
                          <input type="number" value={billingYear} onChange={e=>setBillingYear(e.target.value)} min="2020" max="2030" className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm font-black outline-none focus:border-blue-500"/>
                        </div>
                        <button disabled={!billingClientId} onClick={async()=>{
                          const r=await apiFetch(`${host}/api/report/billing/${billingClientId}?month=${billingMonth}&year=${billingYear}`);
                          const d=await r.json(); setBillingReport(d);
                          const r2=await apiFetch(`${host}/api/client-tariffs/${billingClientId}`);
                          setClientTariffs(Array.isArray(await r2.json())?await (await apiFetch(`${host}/api/client-tariffs/${billingClientId}`)).json():[]);
                        }} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-black py-2.5 rounded-xl shadow text-[10px] uppercase flex items-center justify-center gap-2"><RefreshCcw size={12}/> Calcular</button>
                      </div>
                    </div>

                    {billingReport && (() => {
                      const br = billingReport;
                      const cliName = clients.find(c=>c.id===br.client_id)?.name || br.client_id;
                      const fmtN = n => Number(n||0).toLocaleString('es-CL',{maximumFractionDigits:0});
                      const statusColor = {'EMITIDA':'blue','PAGADA':'emerald','ANULADA':'red','VENCIDA':'orange'};
                      return (
                        <div className="space-y-5">
                          {/* Cabecera resumen */}
                          <div className="bg-gradient-to-br from-blue-700 to-blue-800 rounded-3xl p-7 text-white shadow-xl">
                            <div className="flex justify-between items-start flex-wrap gap-4">
                              <div>
                                <p className="text-[9px] font-black uppercase opacity-60 tracking-widest">Cobro 3PL · {br.period}</p>
                                <h2 className="text-3xl font-black uppercase mt-1">{cliName}</h2>
                                <p className="text-blue-200 text-xs font-bold mt-1">{br.days_in_month} días · {br.stock.lpn_count} LPNs activos · {br.movements.receives} recepciones · {br.movements.dispatches} despachos</p>
                                {br.minimo_aplicado && <span className="inline-block mt-2 bg-yellow-400/20 border border-yellow-300/30 text-yellow-200 text-[9px] font-black px-2 py-1 rounded-lg uppercase">Mínimo mensual aplicado: {br.currency} {fmtN(br.minimo_mensual)}</span>}
                              </div>
                              <div className="text-right">
                                {br.tax_rate > 0 && <p className="text-[9px] opacity-60 uppercase">Neto: {br.currency} {fmtN(br.subtotal)}</p>}
                                {br.tax_rate > 0 && <p className="text-[9px] opacity-60 uppercase">IVA {br.tax_rate}%: {br.currency} {fmtN(br.tax_amount)}</p>}
                                <p className="text-[10px] font-black opacity-70 uppercase mt-1">Total a Cobrar</p>
                                <p className="text-4xl font-black">{br.currency} {fmtN(br.total)}</p>
                                <div className="flex gap-2 mt-3 justify-end">
                                  <button onClick={()=>{
                                    const csv='Concepto,Unidades,Días,Precio Unit.,Subtotal\n'+br.charges.map(c=>`${c.label},${c.units},${c.days||1},${c.unit_price},${c.subtotal}`).join('\n')+`\n,,,,\nSubtotal,,,, ${br.subtotal}\nIVA ${br.tax_rate}%,,,, ${br.tax_amount}\nTOTAL,,,, ${br.total}`;
                                    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`cobro_${br.client_id}_${br.period.replace('/','_')}.csv`;a.click();
                                  }} className="bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg text-[9px] font-black uppercase flex items-center gap-1"><Download size={10}/> CSV</button>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Detalle de cargos */}
                          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="p-5 border-b border-slate-100"><h3 className="text-sm font-black text-slate-700 uppercase flex items-center gap-2"><FileText size={15}/> Detalle de Cargos</h3></div>
                            <table className="w-full text-left">
                              <thead className="bg-slate-50 border-b"><tr>
                                <th className="p-4 text-[9px] font-black text-slate-400 uppercase">Concepto</th>
                                <th className="p-4 text-right text-[9px] font-black text-slate-400 uppercase">Unidades</th>
                                <th className="p-4 text-right text-[9px] font-black text-slate-400 uppercase">Días</th>
                                <th className="p-4 text-right text-[9px] font-black text-slate-400 uppercase">Precio Unitario</th>
                                <th className="p-4 text-right text-[9px] font-black text-slate-400 uppercase">Subtotal</th>
                              </tr></thead>
                              <tbody className="divide-y divide-slate-100">
                                {br.charges.map((c,i)=>(
                                  <tr key={i} className="hover:bg-slate-50">
                                    <td className="p-4">
                                      <p className="text-xs font-black text-slate-800">{c.label}</p>
                                      {c.detail && <p className="text-[9px] text-slate-400 mt-0.5">{c.detail}</p>}
                                    </td>
                                    <td className="p-4 text-right text-xs font-bold text-slate-600">{Number(c.units).toLocaleString('es-CL',{maximumFractionDigits:2})}</td>
                                    <td className="p-4 text-right text-xs text-slate-400">{c.days||'—'}</td>
                                    <td className="p-4 text-right text-xs font-bold text-slate-600">{br.currency} {Number(c.unit_price).toLocaleString('es-CL',{maximumFractionDigits:4})}</td>
                                    <td className="p-4 text-right text-sm font-black text-blue-700">{br.currency} {fmtN(c.subtotal)}</td>
                                  </tr>
                                ))}
                                {br.tax_rate > 0 && <>
                                  <tr className="bg-slate-50">
                                    <td colSpan="4" className="p-4 text-right text-xs font-black text-slate-500 uppercase">Subtotal Neto:</td>
                                    <td className="p-4 text-right text-sm font-black text-slate-700">{br.currency} {fmtN(br.subtotal)}</td>
                                  </tr>
                                  <tr className="bg-slate-50">
                                    <td colSpan="4" className="p-4 text-right text-xs font-bold text-slate-400 uppercase">IVA {br.tax_rate}%:</td>
                                    <td className="p-4 text-right text-xs font-bold text-slate-500">{br.currency} {fmtN(br.tax_amount)}</td>
                                  </tr>
                                </>}
                                <tr className="bg-blue-50">
                                  <td colSpan="4" className="p-4 text-right text-sm font-black text-blue-700 uppercase">Total a Cobrar:</td>
                                  <td className="p-4 text-right text-lg font-black text-blue-800">{br.currency} {fmtN(br.total)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>

                          {/* Datos de stock del período */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {[['LPNs activos',br.stock.lpn_count,'bg-slate-50 border-slate-200','text-slate-800'],
                              ['Unidades stock',Number(br.stock.total_qty||0).toLocaleString(),'bg-slate-50 border-slate-200','text-slate-800'],
                              ['Recepciones',br.movements.receives,'bg-emerald-50 border-emerald-200','text-emerald-800'],
                              ['Despachos',br.movements.dispatches,'bg-red-50 border-red-200','text-red-800']
                            ].map(([l,v,bg,tc])=>(
                              <div key={l} className={`${bg} border rounded-2xl p-4 text-center`}>
                                <p className="text-2xl font-black ${tc}">{v}</p>
                                <p className="text-[9px] font-black text-slate-400 uppercase mt-1">{l}</p>
                              </div>
                            ))}
                          </div>

                          {/* Acción: guardar como factura */}
                          <div className="bg-white rounded-3xl border-2 border-blue-200 shadow-sm p-6">
                            <h3 className="text-sm font-black text-blue-800 uppercase mb-4 flex items-center gap-2"><ClipboardList size={15}/> Emitir Factura</h3>
                            <div className="flex gap-3 flex-wrap items-end">
                              <div className="flex-1 min-w-[200px]">
                                <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Fecha Vencimiento</label>
                                <input type="date" value={billingDueDate} onChange={e=>setBillingDueDate(e.target.value)} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-blue-500"/>
                              </div>
                              <div className="flex-[2] min-w-[200px]">
                                <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Notas / Referencia</label>
                                <input type="text" value={billingNotes} onChange={e=>setBillingNotes(e.target.value)} placeholder="Ej: N° OC-2024-012, condiciones especiales..." className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-blue-500"/>
                              </div>
                              <button onClick={async()=>{
                                const r=await apiFetch(`${host}/api/billing/invoices`,{method:'POST',headers:{'Content-Type':'application/json'},
                                  body:JSON.stringify({client_id:billingClientId,month:billingMonth,year:billingYear,notes:billingNotes,due_date:billingDueDate||null})});
                                if(r.ok){showMsg('Factura emitida y guardada');setBillingNotes('');setBillingDueDate('');setBillingTab('invoices');
                                  const inv=await apiFetch(`${host}/api/billing/invoices`);setBillingInvoices(Array.isArray(await inv.json())?await (await apiFetch(`${host}/api/billing/invoices`)).json():[]);
                                }else{const e=await r.json();showMsg(e.error||'Error',true);}
                              }} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl text-[10px] font-black uppercase shadow flex items-center gap-2"><CheckCircle2 size={14}/> Emitir Factura</button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {!billingReport && (
                      <div className="bg-slate-100 border-2 border-dashed border-slate-300 rounded-3xl p-16 text-center text-slate-400">
                        <Building2 className="w-12 h-12 mx-auto mb-3 opacity-40"/>
                        <p className="font-black uppercase tracking-widest text-xs">Selecciona cliente y período para calcular el cobro</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ── TAB: FACTURAS EMITIDAS ── */}
                {billingTab === 'invoices' && (
                  <div className="space-y-5">
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 flex gap-3 flex-wrap items-end">
                      <div>
                        <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Cliente</label>
                        <select value={billingClientId} onChange={e=>setBillingClientId(e.target.value)} className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-blue-500 bg-white">
                          <option value="">Todos</option>
                          {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Mes</label>
                        <select value={billingMonth} onChange={e=>setBillingMonth(e.target.value)} className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-blue-500 bg-white">
                          <option value="">Todos</option>
                          {['01','02','03','04','05','06','07','08','09','10','11','12'].map(m=><option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Año</label>
                        <input type="number" value={billingYear} onChange={e=>setBillingYear(e.target.value)} className="w-24 border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-black outline-none focus:border-blue-500"/>
                      </div>
                      <button onClick={async()=>{
                        let url=`${host}/api/billing/invoices?year=${billingYear}`;
                        if(billingClientId) url+=`&client_id=${billingClientId}`;
                        if(billingMonth) url+=`&month=${billingMonth}`;
                        const r=await apiFetch(url); const d=await r.json();
                        setBillingInvoices(Array.isArray(d)?d:[]);
                      }} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 shadow"><Search size={12}/> Buscar</button>
                    </div>

                    {billingInvoices.length > 0 ? (
                      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                        <table className="w-full text-left">
                          <thead className="bg-slate-50 border-b"><tr>
                            <th className="p-4 text-[9px] font-black text-slate-400 uppercase">ID Factura</th>
                            <th className="p-4 text-[9px] font-black text-slate-400 uppercase">Cliente</th>
                            <th className="p-4 text-[9px] font-black text-slate-400 uppercase">Período</th>
                            <th className="p-4 text-right text-[9px] font-black text-slate-400 uppercase">Total</th>
                            <th className="p-4 text-[9px] font-black text-slate-400 uppercase">Estado</th>
                            <th className="p-4 text-[9px] font-black text-slate-400 uppercase">Emitida</th>
                            <th className="p-4 text-[9px] font-black text-slate-400 uppercase">Vence</th>
                            <th className="p-4 text-[9px] font-black text-slate-400 uppercase">Acciones</th>
                          </tr></thead>
                          <tbody className="divide-y divide-slate-100">
                            {billingInvoices.map(inv=>{
                              const stColors={'EMITIDA':'bg-blue-100 text-blue-700','PAGADA':'bg-emerald-100 text-emerald-700','ANULADA':'bg-red-100 text-red-600','VENCIDA':'bg-orange-100 text-orange-700'};
                              const cliName=clients.find(c=>c.id===inv.client_id)?.name||inv.client_id;
                              return (
                                <tr key={inv.id} className="hover:bg-slate-50">
                                  <td className="p-4 text-[10px] font-mono text-slate-500">{inv.id}</td>
                                  <td className="p-4 text-xs font-black text-slate-800 uppercase">{cliName}</td>
                                  <td className="p-4 text-xs font-bold text-slate-600">{inv.period}</td>
                                  <td className="p-4 text-right font-black text-slate-800">{inv.currency} {Number(inv.total).toLocaleString('es-CL')}</td>
                                  <td className="p-4"><span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase ${stColors[inv.status]||'bg-slate-100 text-slate-600'}`}>{inv.status}</span></td>
                                  <td className="p-4 text-[10px] text-slate-500">{inv.issued_at ? new Date(inv.issued_at).toLocaleDateString('es-CL') : '—'}</td>
                                  <td className="p-4 text-[10px] text-slate-500">{inv.due_date ? new Date(inv.due_date).toLocaleDateString('es-CL') : '—'}</td>
                                  <td className="p-4">
                                    <div className="flex gap-1">
                                      {inv.status==='EMITIDA' && <>
                                        <button onClick={async()=>{
                                          await apiFetch(`${host}/api/billing/invoices/${inv.id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'PAGADA'})});
                                          setBillingInvoices(prev=>prev.map(x=>x.id===inv.id?{...x,status:'PAGADA',paid_at:new Date().toISOString()}:x));
                                          showMsg('Factura marcada como pagada');
                                        }} className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-2 py-1 rounded-lg text-[9px] font-black uppercase">Pagada</button>
                                        <button onClick={async()=>{
                                          if(!(await confirm({ message: '¿Anular esta factura?', danger: true }))) return;
                                          await apiFetch(`${host}/api/billing/invoices/${inv.id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'ANULADA'})});
                                          setBillingInvoices(prev=>prev.map(x=>x.id===inv.id?{...x,status:'ANULADA'}:x));
                                          showMsg('Factura anulada');
                                        }} className="bg-red-100 hover:bg-red-200 text-red-600 px-2 py-1 rounded-lg text-[9px] font-black uppercase">Anular</button>
                                      </>}
                                      <button onClick={()=>{
                                        const charges = JSON.parse(inv.charges_json||'[]');
                                        const csv=`ID,${inv.id}\nCliente,${inv.client_id}\nPeríodo,${inv.period}\nEstado,${inv.status}\n\nConcepto,Unidades,Días,Precio Unit.,Subtotal\n`+
                                          charges.map(c=>`${c.label},${c.units},${c.days||1},${c.unit_price},${c.subtotal}`).join('\n')+
                                          `\n\nTotal,,,, ${inv.total}`;
                                        const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
                                        a.download=`factura_${inv.id}.csv`;a.click();
                                      }} className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded-lg text-[9px] font-black uppercase flex items-center gap-1"><Download size={10}/></button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="bg-slate-100 border-2 border-dashed border-slate-300 rounded-3xl p-16 text-center text-slate-400">
                        <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-40"/>
                        <p className="font-black uppercase tracking-widest text-xs">Presiona Buscar para ver facturas</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ── TAB: RESUMEN PERÍODO ── */}
                {billingTab === 'summary' && (
                  <div className="space-y-5">
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 flex gap-3 flex-wrap items-end">
                      <div>
                        <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Mes</label>
                        <select value={billingMonth} onChange={e=>setBillingMonth(e.target.value)} className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-blue-500 bg-white">
                          {[['01','Enero'],['02','Febrero'],['03','Marzo'],['04','Abril'],['05','Mayo'],['06','Junio'],['07','Julio'],['08','Agosto'],['09','Septiembre'],['10','Octubre'],['11','Noviembre'],['12','Diciembre']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Año</label>
                        <input type="number" value={billingYear} onChange={e=>setBillingYear(e.target.value)} className="w-24 border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-black outline-none focus:border-blue-500"/>
                      </div>
                      <button onClick={async()=>{
                        setBillingSummaryLoading(true);
                        const r=await apiFetch(`${host}/api/billing/summary?month=${billingMonth}&year=${billingYear}`);
                        const d=await r.json(); setBillingSummary(Array.isArray(d)?d:[]); setBillingSummaryLoading(false);
                      }} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 shadow"><RefreshCcw size={12}/> Cargar</button>
                    </div>

                    {billingSummaryLoading && <div className="text-center py-12 text-slate-400 font-black uppercase text-xs animate-pulse">Calculando cobros para todos los clientes...</div>}

                    {billingSummary.length > 0 && !billingSummaryLoading && (
                      <div className="space-y-4">
                        {/* Totales globales */}
                        {(() => {
                          const total = billingSummary.filter(c=>!c.error).reduce((a,c)=>a+parseFloat(c.total||0),0);
                          const pendiente = billingSummary.filter(c=>!c.invoice||c.invoice.status==='EMITIDA').reduce((a,c)=>a+parseFloat(c.total||0),0);
                          const pagado = billingSummary.filter(c=>c.invoice?.status==='PAGADA').reduce((a,c)=>a+parseFloat(c.invoice.total||0),0);
                          return (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center"><p className="text-2xl font-black text-blue-800">{billingSummary.length}</p><p className="text-[9px] font-black text-blue-500 uppercase">Clientes</p></div>
                              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center"><p className="text-xl font-black text-slate-800">$ {Number(total).toLocaleString('es-CL',{maximumFractionDigits:0})}</p><p className="text-[9px] font-black text-slate-400 uppercase">Total a Cobrar</p></div>
                              <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 text-center"><p className="text-xl font-black text-orange-700">$ {Number(pendiente).toLocaleString('es-CL',{maximumFractionDigits:0})}</p><p className="text-[9px] font-black text-orange-500 uppercase">Sin Facturar</p></div>
                              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center"><p className="text-xl font-black text-emerald-700">$ {Number(pagado).toLocaleString('es-CL',{maximumFractionDigits:0})}</p><p className="text-[9px] font-black text-emerald-500 uppercase">Cobrado / Pagado</p></div>
                            </div>
                          );
                        })()}

                        {/* Grilla de clientes */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {billingSummary.map(c=>{
                            const stColors={'EMITIDA':'bg-blue-100 text-blue-700 border-blue-200','PAGADA':'bg-emerald-100 text-emerald-700 border-emerald-200','ANULADA':'bg-red-100 text-red-600 border-red-200','VENCIDA':'bg-orange-100 text-orange-700 border-orange-200'};
                            const invSt = c.invoice?.status;
                            const borderClass = invSt==='PAGADA'?'border-emerald-200':invSt==='EMITIDA'?'border-blue-200':'border-slate-200';
                            return (
                              <div key={c.client_id} className={`bg-white rounded-2xl border-2 ${borderClass} p-5 shadow-sm`}>
                                <div className="flex justify-between items-start mb-3">
                                  <div>
                                    <p className="text-xs font-black text-slate-800 uppercase">{c.client_name}</p>
                                    <p className="text-[9px] text-slate-400 font-bold uppercase">{c.client_id}</p>
                                  </div>
                                  {invSt ? <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase border ${stColors[invSt]||'bg-slate-100 text-slate-600 border-slate-200'}`}>{invSt}</span>
                                    : <span className="px-2 py-1 rounded-lg text-[9px] font-black uppercase bg-slate-100 text-slate-500 border border-slate-200">Sin factura</span>}
                                </div>
                                <p className="text-2xl font-black text-slate-800 mb-2">{c.currency} {Number(c.total).toLocaleString('es-CL',{maximumFractionDigits:0})}</p>
                                <div className="flex gap-3 text-[9px] text-slate-400 font-bold uppercase">
                                  <span>{c.lpn_count} LPNs</span>
                                  <span>{c.receives} Rec.</span>
                                  <span>{c.dispatches} Desp.</span>
                                </div>
                                {!invSt && (
                                  <button onClick={()=>{setBillingClientId(c.client_id);setBillingTab('generate');}} className="mt-3 w-full bg-blue-50 hover:bg-blue-100 text-blue-700 text-[9px] font-black uppercase py-1.5 rounded-xl border border-blue-200 transition-colors">Ver cobro</button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {billingSummary.length === 0 && !billingSummaryLoading && (
                      <div className="bg-slate-100 border-2 border-dashed border-slate-300 rounded-3xl p-16 text-center text-slate-400">
                        <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-40"/>
                        <p className="font-black uppercase tracking-widest text-xs">Selecciona el período y presiona Cargar</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ── TAB: TARIFAS ── */}
                {billingTab === 'tariffs' && (
                  <div className="space-y-5">
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
                      <h3 className="text-sm font-black text-slate-700 uppercase mb-2">Seleccionar Cliente</h3>
                      <select value={billingClientId} onChange={async e=>{setBillingClientId(e.target.value);if(e.target.value){const r=await apiFetch(`${host}/api/client-tariffs/${e.target.value}`);const d=await r.json();setClientTariffs(Array.isArray(d)?d:[]);}}} className="border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:border-blue-500 bg-white min-w-[280px]">
                        <option value="">-- Seleccionar --</option>
                        {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>

                    {billingClientId && (
                      <>
                        {/* Tipos de tarifa predefinidos */}
                        <div className="bg-blue-50 border border-blue-200 rounded-3xl p-6">
                          <h3 className="text-sm font-black text-blue-800 uppercase mb-4 flex items-center gap-2"><Tag size={15}/> Configurar Tarifas — {clients.find(c=>c.id===billingClientId)?.name||billingClientId}</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {[
                              {type:'ALMACENAJE_LPN_DIA', label:'Almacenaje por LPN × Día', placeholder:'500', hint:'Cobra por cada LPN activo por día del mes'},
                              {type:'ALMACENAJE_KG_DIA', label:'Almacenaje por KG × Día', placeholder:'50', hint:'Cobra por kg almacenado por día (alternativa al LPN)'},
                              {type:'ALMACENAJE_UBICACION_DIA', label:'Almacenaje por Ubicación × Día', placeholder:'1000', hint:'Cobra por ubicación ocupada por día'},
                              {type:'RECEPCION_DOC', label:'Recepción por Documento', placeholder:'1500', hint:'Cargo fijo por cada documento de recepción'},
                              {type:'DESPACHO_DOC', label:'Despacho por Documento', placeholder:'2000', hint:'Cargo fijo por cada documento de despacho'},
                              {type:'MAQUILA_HORA', label:'Maquila / HH (horas en descripción)', placeholder:'5000', hint:'Precio/hora; pon las horas del mes en "descripción"'},
                              {type:'MINIMO_MENSUAL', label:'Mínimo Mensual Garantizado', placeholder:'50000', hint:'Si el total es menor, se cobra este mínimo'},
                              {type:'IVA', label:'IVA (%)', placeholder:'19', hint:'Porcentaje de IVA a aplicar (0 = sin IVA)'},
                            ].map(({type,label,placeholder,hint})=>{
                              const existing = clientTariffs.find(t=>t.tariff_type===type);
                              return (
                                <div key={type} className="bg-white rounded-2xl border border-blue-100 p-4">
                                  <div className="flex justify-between items-start mb-2">
                                    <div>
                                      <p className="text-[10px] font-black text-slate-700 uppercase">{label}</p>
                                      <p className="text-[9px] text-slate-400 mt-0.5">{hint}</p>
                                    </div>
                                    {existing && <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg">Configurado</span>}
                                  </div>
                                  <div className="flex gap-2">
                                    <input type="number" defaultValue={existing?.unit_price||''} placeholder={placeholder}
                                      id={`tariff-${type}`}
                                      className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm font-black outline-none focus:border-blue-400"/>
                                    {type==='MAQUILA_HORA' && (
                                      <input type="text" defaultValue={existing?.description||''} placeholder="Horas del mes"
                                        id={`tariff-desc-${type}`}
                                        className="w-28 border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold outline-none focus:border-blue-400"/>
                                    )}
                                    <button onClick={async()=>{
                                      const inp=document.getElementById(`tariff-${type}`);
                                      const desc=document.getElementById(`tariff-desc-${type}`);
                                      if(!inp.value) return;
                                      const r=await apiFetch(`${host}/api/client-tariffs`,{method:'POST',headers:{'Content-Type':'application/json'},
                                        body:JSON.stringify({client_id:billingClientId,tariff_type:type,unit_price:inp.value,description:desc?.value||label})});
                                      if(r.ok){showMsg('Tarifa guardada');const r2=await apiFetch(`${host}/api/client-tariffs/${billingClientId}`);setClientTariffs(Array.isArray(await r2.json())?await (await apiFetch(`${host}/api/client-tariffs/${billingClientId}`)).json():[]);}
                                      else showMsg('Error',true);
                                    }} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-xl text-[9px] font-black uppercase">Guardar</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Cargos adicionales (ajustes) */}
                        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
                          <h3 className="text-sm font-black text-slate-700 uppercase mb-4 flex items-center gap-2"><Plus size={15}/> Cargo / Crédito Adicional (AJUSTE)</h3>
                          <div className="flex gap-3 flex-wrap items-end">
                            <div className="flex-[2] min-w-[180px]">
                              <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Descripción</label>
                              <input type="text" placeholder="Ej: Seguro mercancía, Manipulación especial" value={newTariff.description} onChange={e=>setNewTariff(p=>({...p,description:e.target.value}))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-blue-500"/>
                            </div>
                            <div>
                              <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Monto (neg. = crédito)</label>
                              <input type="number" placeholder="15000" value={newTariff.unit_price} onChange={e=>setNewTariff(p=>({...p,unit_price:e.target.value}))} className="w-36 border border-slate-200 rounded-xl px-3 py-2 text-xs font-black outline-none text-right focus:border-blue-500"/>
                            </div>
                            <button onClick={async()=>{
                              if(!newTariff.description||!newTariff.unit_price) return showMsg('Completa descripción y monto',true);
                              const id=`AJUSTE_${Date.now()}`;
                              const r=await apiFetch(`${host}/api/client-tariffs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...newTariff,tariff_type:id,client_id:billingClientId})});
                              if(r.ok){showMsg('Cargo adicional guardado');setNewTariff({tariff_type:'',unit_price:'',description:''});const r2=await apiFetch(`${host}/api/client-tariffs/${billingClientId}`);setClientTariffs(await r2.json());}
                            }} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1"><Plus size={12}/> Agregar</button>
                          </div>
                          {clientTariffs.filter(t=>t.tariff_type.startsWith('AJUSTE')).length > 0 && (
                            <div className="mt-4 space-y-2">
                              {clientTariffs.filter(t=>t.tariff_type.startsWith('AJUSTE')).map(t=>(
                                <div key={t.id} className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-200">
                                  <p className="text-xs font-bold text-slate-700">{t.description}</p>
                                  <div className="flex items-center gap-3">
                                    <span className={`font-black text-sm ${parseFloat(t.unit_price)<0?'text-red-600':'text-indigo-700'}`}>{t.currency} {Number(t.unit_price).toLocaleString()}</span>
                                    <button onClick={async()=>{await apiFetch(`${host}/api/client-tariffs/${t.id}`,{method:'DELETE'});const r2=await apiFetch(`${host}/api/client-tariffs/${billingClientId}`);setClientTariffs(await r2.json());}} className="text-red-400 hover:text-red-600"><Trash2 size={14}/></button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* OCCUPATION REPORT */}
            {activeTab === 'occupation' && canManageMasters && (
              <Suspense fallback={<TabLoader />}>
                <OccupationTab
                  occupationData={occupationData}
                  setOccupationData={setOccupationData}
                  apiFetch={apiFetch}
                  host={host}
                />
              </Suspense>
            )}

            {/* MATERIALES Y HH */}
            {activeTab === 'rep-report' && canManageMasters && (
              <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><HardHat className="text-amber-500"/> Uso de Materiales y HH</h1>
                    <p className="text-[10px] font-bold text-amber-600 uppercase">Recursos por SKU · Reporte de Consumo por Despacho</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setResTab('config')} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 ${resTab==='config'?'bg-amber-600 text-white shadow':'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}><Wrench size={12}/> Configurar SKUs</button>
                    <button onClick={() => setResTab('report')} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 ${resTab==='report'?'bg-amber-600 text-white shadow':'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}><BarChart3 size={12}/> Reporte Consumo</button>
                  </div>
                </div>

                {resTab === 'config' && (
                  <div className="space-y-5">
                    {/* Selector de SKU con buscador */}
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
                      <h3 className="text-sm font-black text-slate-700 uppercase mb-4 flex items-center gap-2"><Package size={16}/> Buscar y Seleccionar SKU</h3>
                      <div className="flex gap-3 flex-wrap items-start">
                        <div className="flex-1 min-w-[260px] space-y-2">
                          <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
                            <input
                              type="text"
                              placeholder="Buscar por SKU, descripción o cliente..."
                              value={resSkuFilter}
                              onChange={e => setResSkuFilter(e.target.value)}
                              className="w-full pl-9 pr-3 py-2.5 border-2 border-amber-200 rounded-xl text-xs font-bold outline-none bg-amber-50 focus:border-amber-500 uppercase"
                            />
                            {resSkuFilter && <button onClick={()=>setResSkuFilter('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={12}/></button>}
                          </div>
                          {(() => {
                            const q = resSkuFilter.toLowerCase();
                            const filtered = safeSkus.filter(s =>
                              !q ||
                              s.sku.toLowerCase().includes(q) ||
                              (s.desc||'').toLowerCase().includes(q) ||
                              (s.client_id||'').toLowerCase().includes(q)
                            );
                            if (!resSkuFilter && !resSku) return (
                              <p className="text-[10px] text-slate-400 font-bold px-1">Escribe para filtrar los {safeSkus.length} SKUs disponibles</p>
                            );
                            if (filtered.length === 0) return (
                              <p className="text-[10px] text-red-400 font-bold px-1">Sin resultados para "{resSkuFilter}"</p>
                            );
                            return (
                              <div className="border-2 border-amber-200 rounded-xl overflow-hidden max-h-52 overflow-y-auto custom-scrollbar bg-white shadow-sm">
                                {filtered.slice(0,80).map(s => (
                                  <button key={s.sku+s.client_id} onClick={async () => {
                                    setResSku(s.sku); setResClientId(s.client_id||''); setResResources([]); setResSkuFilter('');
                                    if (s.sku && s.client_id) {
                                      const r = await apiFetch(`${host}/api/sku-resources?sku=${encodeURIComponent(s.sku)}&client_id=${encodeURIComponent(s.client_id)}`);
                                      const d = await r.json(); setResResources(Array.isArray(d)?d:[]);
                                    }
                                  }} className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-amber-50 transition-colors border-b border-slate-100 last:border-0 ${resSku===s.sku&&resClientId===s.client_id?'bg-amber-100':''}`}>
                                    <span className="text-xs font-black text-slate-800 uppercase">{s.sku}</span>
                                    <div className="text-right">
                                      <span className="text-[9px] font-bold text-slate-400 block uppercase">{s.client_id||'-'}</span>
                                      <span className="text-[9px] text-slate-400">{(s.desc||'').slice(0,28)}</span>
                                    </div>
                                  </button>
                                ))}
                                {filtered.length > 80 && <p className="text-[9px] text-center text-slate-400 py-2 font-bold">… y {filtered.length-80} más — refina la búsqueda</p>}
                              </div>
                            );
                          })()}
                        </div>
                        {resSku && (
                          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs font-bold flex items-center gap-3">
                            <div>
                              <p className="text-[9px] text-amber-600 uppercase font-black">SKU seleccionado</p>
                              <p className="text-sm font-black text-slate-800 uppercase">{resSku}</p>
                              <p className="text-[10px] text-amber-700">Cliente: {resClientId||'-'}</p>
                            </div>
                            <button onClick={()=>{setResSku('');setResClientId('');setResResources('');}} className="text-slate-400 hover:text-red-400"><X size={14}/></button>
                          </div>
                        )}
                      </div>
                    </div>

                    {resSku && (
                      <>
                        {/* Formulario agregar recurso */}
                        <div className="bg-amber-50 border border-amber-200 rounded-3xl p-6">
                          <h3 className="text-sm font-black text-amber-800 uppercase mb-4 flex items-center gap-2"><Plus size={16}/> Agregar Recurso a {resSku}</h3>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                            <div>
                              <label className="block text-[9px] font-black text-amber-700 uppercase mb-1">Tipo</label>
                              <select value={resForm.resource_type} onChange={e=>setResForm({...resForm,resource_type:e.target.value})} className="w-full border border-amber-300 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white">
                                <option value="MATERIAL">Material</option>
                                <option value="HH">HH (Horas Hombre)</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[9px] font-black text-amber-700 uppercase mb-1">Nombre del Recurso</label>
                              <input type="text" placeholder={resForm.resource_type==='HH'?'ej: Operario Almacén':'ej: Caja de Cartón'} value={resForm.resource_name} onChange={e=>setResForm({...resForm,resource_name:e.target.value})} className="w-full border border-amber-300 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white"/>
                            </div>
                            <div>
                              <label className="block text-[9px] font-black text-amber-700 uppercase mb-1">
                                {resForm.resource_type==='HH' ? `Tiempo por unidad despachada` : 'Cantidad por unidad'}
                              </label>
                              <div className="flex gap-1">
                                <input type="number" step="0.01" min="0" placeholder="1" value={resForm.qty_per_unit} onChange={e=>setResForm({...resForm,qty_per_unit:e.target.value})} className="w-full border border-amber-300 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white"/>
                                {resForm.resource_type==='HH' ? (
                                  <select value={resForm.time_unit} onChange={e=>setResForm({...resForm,time_unit:e.target.value})} className="w-28 border border-amber-300 rounded-xl px-2 py-2 text-xs font-bold outline-none bg-white">
                                    <option value="HORAS">Horas</option>
                                    <option value="MINUTOS">Minutos</option>
                                  </select>
                                ) : (
                                  <input type="text" placeholder="UN" value={resForm.unit} onChange={e=>setResForm({...resForm,unit:e.target.value.toUpperCase()})} className="w-20 border border-amber-300 rounded-xl px-2 py-2 text-xs font-bold outline-none bg-white uppercase"/>
                                )}
                              </div>
                            </div>
                            {resForm.resource_type==='HH' ? (
                              <div>
                                <label className="block text-[9px] font-black text-amber-700 uppercase mb-1">N° Personal</label>
                                <input type="number" min="1" step="1" placeholder="1" value={resForm.personnel_count} onChange={e=>setResForm({...resForm,personnel_count:e.target.value})} className="w-full border border-amber-300 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white"/>
                              </div>
                            ) : (
                              <div>
                                <label className="block text-[9px] font-black text-amber-700 uppercase mb-1">Notas</label>
                                <input type="text" placeholder="Opcional..." value={resForm.notes} onChange={e=>setResForm({...resForm,notes:e.target.value})} className="w-full border border-amber-300 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white"/>
                              </div>
                            )}
                          </div>
                          {resForm.resource_type==='HH' && (
                            <div className="mb-3">
                              <label className="block text-[9px] font-black text-amber-700 uppercase mb-1">Notas / Rol</label>
                              <input type="text" placeholder="ej: Operario de picking, turno día" value={resForm.notes} onChange={e=>setResForm({...resForm,notes:e.target.value})} className="w-full border border-amber-300 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white"/>
                            </div>
                          )}
                          <button onClick={async () => {
                            if (!resForm.resource_name.trim()) return showMsg('Nombre del recurso es requerido', true);
                            const isHH = resForm.resource_type === 'HH';
                            const body = {
                              sku: resSku, client_id: resClientId,
                              resource_type: resForm.resource_type,
                              resource_name: resForm.resource_name.trim(),
                              qty_per_unit: resForm.qty_per_unit,
                              unit: isHH ? resForm.time_unit : (resForm.unit||'UN'),
                              hours_per_unit: isHH ? resForm.qty_per_unit : '0',
                              time_unit: isHH ? resForm.time_unit : 'HORAS',
                              personnel_count: isHH ? resForm.personnel_count : '1',
                              notes: resForm.notes
                            };
                            const r = await apiFetch(`${host}/api/sku-resources`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
                            if (r.ok) {
                              showMsg('Recurso guardado');
                              setResForm({ resource_type:'MATERIAL', resource_name:'', qty_per_unit:'1', unit:'UN', hours_per_unit:'0', time_unit:'HORAS', personnel_count:'1', notes:'' });
                              const r2 = await apiFetch(`${host}/api/sku-resources?sku=${encodeURIComponent(resSku)}&client_id=${encodeURIComponent(resClientId)}`);
                              const d = await r2.json(); setResResources(Array.isArray(d)?d:[]);
                            } else { const err = await r.json(); showMsg(err.error||'Error al guardar', true); }
                          }} className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-6 py-2 text-[10px] font-black uppercase flex items-center gap-2 shadow"><Plus size={12}/> Guardar Recurso</button>
                        </div>

                        {/* Lista de recursos del SKU */}
                        {resResources.length > 0 ? (
                          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="bg-slate-50 border-b p-4"><h3 className="text-sm font-black text-slate-700 uppercase">Recursos definidos para {resSku} — {resResources.length} registros</h3></div>
                            <table className="w-full text-left">
                              <thead className="bg-slate-50 border-b"><tr>
                                <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Tipo</th>
                                <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Recurso</th>
                                <th className="p-3 text-right text-[9px] font-black text-slate-400 uppercase">Cant/UN</th>
                                <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Unidad</th>
                                <th className="p-3 text-right text-[9px] font-black text-slate-400 uppercase">Hrs/UN</th>
                                <th className="p-3 text-right text-[9px] font-black text-slate-400 uppercase">Personal</th>
                                <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Notas</th>
                                <th className="p-3"></th>
                              </tr></thead>
                              <tbody className="divide-y divide-slate-100">
                                {resResources.map(r => (
                                  <tr key={r.id} className="hover:bg-slate-50">
                                    <td className="p-3"><span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${r.resource_type==='HH'?'bg-blue-100 text-blue-700':'bg-amber-100 text-amber-700'}`}>{r.resource_type==='HH'?<><Timer size={10} className="inline mr-1"/>HH</>:<><Wrench size={10} className="inline mr-1"/>Material</>}</span></td>
                                    <td className="p-3 text-xs font-bold text-slate-800">{r.resource_name}</td>
                                    <td className="p-3 text-right text-xs font-black text-slate-700">{Number(r.qty_per_unit).toLocaleString('es-CL',{maximumFractionDigits:4})}</td>
                                    <td className="p-3 text-xs text-slate-500 font-bold uppercase">{r.resource_type==='HH'?(r.time_unit==='MINUTOS'?'min':'hrs'):r.unit}</td>
                                    <td className="p-3 text-right text-xs text-blue-700 font-bold">{r.resource_type==='HH'?<span>{Number(r.hours_per_unit).toFixed(2)} <span className="text-[9px] text-slate-400">{r.time_unit==='MINUTOS'?'min':'hrs'}</span></span>:'-'}</td>
                                    <td className="p-3 text-right text-xs font-bold text-slate-600">{r.resource_type==='HH'?r.personnel_count:'-'}</td>
                                    <td className="p-3 text-[10px] text-slate-400">{r.notes||'-'}</td>
                                    <td className="p-3"><button onClick={async () => { if (!(await confirm({ message: '¿Eliminar este recurso?', danger: true }))) return; const del = await apiFetch(`${host}/api/sku-resources/${r.id}`,{method:'DELETE'}); if (del.ok) { showMsg('Recurso eliminado'); setResResources(prev=>prev.filter(x=>x.id!==r.id)); } else showMsg('Error al eliminar',true); }} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={14}/></button></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="bg-slate-100 border-2 border-dashed border-slate-300 rounded-3xl p-10 text-center text-slate-400">
                            <Wrench className="w-10 h-10 mx-auto mb-2 opacity-40"/>
                            <p className="font-black uppercase tracking-widest text-xs">Este SKU no tiene recursos definidos</p>
                            <p className="text-[10px] mt-1">Agrega materiales o HH con el formulario de arriba</p>
                          </div>
                        )}
                      </>
                    )}
                    {!resSku && (
                      <div className="bg-slate-100 border-2 border-dashed border-slate-300 rounded-3xl p-16 text-center text-slate-400">
                        <HardHat className="w-12 h-12 mx-auto mb-3 opacity-40"/>
                        <p className="font-black uppercase tracking-widest text-xs">Selecciona un SKU para configurar sus recursos</p>
                      </div>
                    )}
                  </div>
                )}

                {resTab === 'report' && (
                  <div className="space-y-5">
                    {/* Filtros */}
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
                      <h3 className="text-sm font-black text-slate-700 uppercase mb-4 flex items-center gap-2"><BarChart3 size={16}/> Filtros del Reporte</h3>
                      <div className="flex gap-3 flex-wrap items-end">
                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Desde</label>
                          <input type="date" value={resDateFrom} onChange={e=>setResDateFrom(e.target.value)} className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-black outline-none focus:border-amber-500"/>
                        </div>
                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Hasta</label>
                          <input type="date" value={resDateTo} onChange={e=>setResDateTo(e.target.value)} className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-black outline-none focus:border-amber-500"/>
                        </div>
                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Cliente (opcional)</label>
                          <select value={resReportClient} onChange={e=>setResReportClient(e.target.value)} className="border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-amber-500 bg-white">
                            <option value="">Todos los clientes</option>
                            {(Array.isArray(clients)?clients:[]).map(c=><option key={c.id} value={c.id}>{c.name||c.id}</option>)}
                          </select>
                        </div>
                        <button onClick={async () => {
                          let url = `${host}/api/report/resources?date_from=${resDateFrom}&date_to=${resDateTo}`;
                          if (resReportClient) url += `&client_id=${encodeURIComponent(resReportClient)}`;
                          const r = await apiFetch(url);
                          const d = await r.json();
                          setResReportData(Array.isArray(d)?d:[]);
                          if (Array.isArray(d) && d.length === 0) showMsg('Sin datos para ese período');
                        }} className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 shadow"><RefreshCcw size={12}/> Generar</button>
                        {resReportData.length > 0 && (
                          <button onClick={() => {
                            const header = 'cliente,despacho,tipo_doc,fecha,sku,tipo_recurso,recurso,unidad,qty_despachada,total_recurso,tiempo_por_un,unidad_tiempo,personal,total_horas,total_minutos\n';
                            const rows = resReportData.map(r =>
                              `${r.client_id},${r.doc_num},${r.doc_type},${r.dispatch_date},${r.sku},${r.resource_type},${r.resource_name},${r.unit},${r.dispatched_qty},${Number(r.total_resource_qty||0).toFixed(3)},${r.hours_per_unit},${r.time_unit||''},${r.personnel_count},${Number(r.total_hours||0).toFixed(4)},${Math.round(Number(r.total_minutes||0))}`
                            ).join('\n');
                            const blob = new Blob([header+rows],{type:'text/csv'});
                            const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
                            a.download=`consumo_mat_hh_${resDateFrom}_${resDateTo}.csv`; a.click();
                          }} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 shadow"><Download size={12}/> Exportar CSV</button>
                        )}
                      </div>
                    </div>

                    {resReportData.length > 0 ? (() => {
                      // Agrupar: cliente → despacho → filas
                      const byClient = {};
                      resReportData.forEach(r => {
                        if (!byClient[r.client_id]) byClient[r.client_id] = {};
                        const dk = r.doc_id;
                        if (!byClient[r.client_id][dk]) byClient[r.client_id][dk] = {
                          doc_num: r.doc_num, doc_type: r.doc_type,
                          dispatch_date: r.dispatch_date, glosa: r.glosa, rows: []
                        };
                        byClient[r.client_id][dk].rows.push(r);
                      });
                      const totalHoursAll = resReportData.filter(r=>r.resource_type==='HH').reduce((a,r)=>a+parseFloat(r.total_hours||0),0);
                      const clientIds = Object.keys(byClient).sort();
                      const totalDispatches = resReportData.reduce((s,r)=>{ s.add(r.doc_id); return s; }, new Set()).size;
                      return (
                        <div className="space-y-4">
                          {/* Tarjetas resumen global */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center">
                              <p className="text-[9px] font-black text-slate-400 uppercase">Clientes</p>
                              <p className="text-2xl font-black text-slate-700">{clientIds.length}</p>
                            </div>
                            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center">
                              <p className="text-[9px] font-black text-slate-400 uppercase">Despachos</p>
                              <p className="text-2xl font-black text-slate-700">{totalDispatches}</p>
                            </div>
                            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
                              <p className="text-[9px] font-black text-amber-600 uppercase">Registros Mat.</p>
                              <p className="text-2xl font-black text-amber-800">{resReportData.filter(r=>r.resource_type==='MATERIAL').length}</p>
                            </div>
                            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center">
                              <p className="text-[9px] font-black text-blue-600 uppercase">Total HH Global</p>
                              <p className="text-lg font-black text-blue-800">{totalHoursAll.toFixed(2)} hrs</p>
                              <p className="text-[10px] font-bold text-blue-500">{Math.round(totalHoursAll*60)} min</p>
                            </div>
                          </div>

                          {/* Un bloque por cliente */}
                          {clientIds.map(cid => {
                            const dispatches = byClient[cid];
                            const dispKeys = Object.keys(dispatches);
                            const cliHours = Object.values(dispatches).flatMap(d=>d.rows).filter(r=>r.resource_type==='HH').reduce((a,r)=>a+parseFloat(r.total_hours||0),0);
                            const cliName = (Array.isArray(clients)?clients:[]).find(c=>c.id===cid)?.name || cid;
                            return (
                              <div key={cid} className="bg-white rounded-3xl border-2 border-slate-200 shadow-sm overflow-hidden">
                                {/* Cabecera cliente */}
                                <div className="bg-slate-800 px-6 py-4 flex items-center justify-between flex-wrap gap-2">
                                  <div className="flex items-center gap-3">
                                    <div className="bg-amber-400 rounded-xl p-2"><Building2 size={16} className="text-slate-900"/></div>
                                    <div>
                                      <p className="text-[9px] font-black text-slate-400 uppercase">Cliente</p>
                                      <p className="text-sm font-black text-white uppercase">{cliName}</p>
                                    </div>
                                  </div>
                                  <div className="flex gap-4 text-right">
                                    <div><p className="text-[9px] font-black text-slate-400 uppercase">Despachos</p><p className="text-lg font-black text-white">{dispKeys.length}</p></div>
                                    <div><p className="text-[9px] font-black text-slate-400 uppercase">HH Total</p><p className="text-lg font-black text-blue-300">{cliHours.toFixed(2)} hrs</p></div>
                                  </div>
                                </div>

                                {/* Despachos del cliente */}
                                <div className="divide-y divide-slate-100">
                                  {dispKeys.map(dk => {
                                    const disp = dispatches[dk];
                                    const dMat = disp.rows.filter(r=>r.resource_type==='MATERIAL');
                                    const dHH = disp.rows.filter(r=>r.resource_type==='HH');
                                    const dHours = dHH.reduce((a,r)=>a+parseFloat(r.total_hours||0),0);
                                    return (
                                      <div key={dk} className="p-5 space-y-3">
                                        {/* Cabecera despacho */}
                                        <div className="flex items-center gap-3 flex-wrap">
                                          <div className="bg-indigo-100 rounded-xl px-3 py-1.5 flex items-center gap-2">
                                            <FileText size={12} className="text-indigo-600"/>
                                            <span className="text-xs font-black text-indigo-800 uppercase">{disp.doc_num}</span>
                                          </div>
                                          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded-lg px-2 py-1 uppercase">{disp.doc_type||'N/A'}</span>
                                          <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1"><Calendar size={10}/>{disp.dispatch_date}</span>
                                          {disp.glosa && <span className="text-[10px] text-slate-400 italic">"{disp.glosa}"</span>}
                                          <div className="ml-auto flex gap-3">
                                            {dMat.length>0 && <span className="text-[9px] font-black text-amber-700 bg-amber-100 rounded-lg px-2 py-1 uppercase">{dMat.length} materiales</span>}
                                            {dHH.length>0 && <span className="text-[9px] font-black text-blue-700 bg-blue-100 rounded-lg px-2 py-1 uppercase">{dHours.toFixed(2)} hrs / {Math.round(dHours*60)} min</span>}
                                          </div>
                                        </div>

                                        {/* Tabla materiales del despacho */}
                                        {dMat.length > 0 && (
                                          <div className="rounded-2xl border border-amber-200 overflow-hidden">
                                            <div className="bg-amber-50 px-3 py-2 flex items-center gap-2 border-b border-amber-200">
                                              <Wrench size={12} className="text-amber-600"/><span className="text-[9px] font-black text-amber-700 uppercase">Materiales</span>
                                            </div>
                                            <table className="w-full text-left">
                                              <thead className="bg-slate-50"><tr>
                                                <th className="px-3 py-2 text-[8px] font-black text-slate-400 uppercase">Material</th>
                                                <th className="px-3 py-2 text-[8px] font-black text-slate-400 uppercase">SKU</th>
                                                <th className="px-3 py-2 text-right text-[8px] font-black text-slate-400 uppercase">UN Desp.</th>
                                                <th className="px-3 py-2 text-right text-[8px] font-black text-slate-400 uppercase">Total</th>
                                                <th className="px-3 py-2 text-[8px] font-black text-slate-400 uppercase">UN</th>
                                              </tr></thead>
                                              <tbody className="divide-y divide-slate-100">
                                                {dMat.map((r,i)=>(
                                                  <tr key={i} className="hover:bg-amber-50/50">
                                                    <td className="px-3 py-2 text-xs font-bold text-slate-800">{r.resource_name}</td>
                                                    <td className="px-3 py-2"><span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[9px] font-black uppercase">{r.sku}</span></td>
                                                    <td className="px-3 py-2 text-right text-xs font-black text-slate-700">{Number(r.dispatched_qty).toLocaleString('es-CL',{maximumFractionDigits:2})}</td>
                                                    <td className="px-3 py-2 text-right text-xs font-black text-amber-700">{Number(r.total_resource_qty||0).toLocaleString('es-CL',{maximumFractionDigits:3})}</td>
                                                    <td className="px-3 py-2 text-[9px] font-bold text-slate-400 uppercase">{r.unit}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}

                                        {/* Tabla HH del despacho */}
                                        {dHH.length > 0 && (
                                          <div className="rounded-2xl border border-blue-200 overflow-hidden">
                                            <div className="bg-blue-50 px-3 py-2 flex items-center gap-2 border-b border-blue-200">
                                              <Timer size={12} className="text-blue-600"/><span className="text-[9px] font-black text-blue-700 uppercase">Horas Hombre</span>
                                            </div>
                                            <table className="w-full text-left">
                                              <thead className="bg-slate-50"><tr>
                                                <th className="px-3 py-2 text-[8px] font-black text-slate-400 uppercase">Rol</th>
                                                <th className="px-3 py-2 text-[8px] font-black text-slate-400 uppercase">SKU</th>
                                                <th className="px-3 py-2 text-right text-[8px] font-black text-slate-400 uppercase">UN Desp.</th>
                                                <th className="px-3 py-2 text-right text-[8px] font-black text-slate-400 uppercase">T/UN</th>
                                                <th className="px-3 py-2 text-[8px] font-black text-slate-400 uppercase">UT</th>
                                                <th className="px-3 py-2 text-right text-[8px] font-black text-slate-400 uppercase">Pers.</th>
                                                <th className="px-3 py-2 text-right text-[8px] font-black text-slate-400 uppercase">Horas</th>
                                                <th className="px-3 py-2 text-right text-[8px] font-black text-slate-400 uppercase">Min</th>
                                              </tr></thead>
                                              <tbody className="divide-y divide-slate-100">
                                                {dHH.map((r,i)=>(
                                                  <tr key={i} className="hover:bg-blue-50/50">
                                                    <td className="px-3 py-2 text-xs font-bold text-slate-800">{r.resource_name}</td>
                                                    <td className="px-3 py-2"><span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[9px] font-black uppercase">{r.sku}</span></td>
                                                    <td className="px-3 py-2 text-right text-xs font-black text-slate-700">{Number(r.dispatched_qty).toLocaleString('es-CL',{maximumFractionDigits:2})}</td>
                                                    <td className="px-3 py-2 text-right text-xs font-bold text-blue-600">{Number(r.hours_per_unit).toFixed(2)}</td>
                                                    <td className="px-3 py-2 text-[9px] font-bold text-slate-400 uppercase">{r.time_unit==='MINUTOS'?'min':'hrs'}</td>
                                                    <td className="px-3 py-2 text-right text-xs font-bold text-slate-600">{r.personnel_count}</td>
                                                    <td className="px-3 py-2 text-right text-xs font-black text-blue-700">{Number(r.total_hours||0).toFixed(2)}</td>
                                                    <td className="px-3 py-2 text-right text-xs font-black text-indigo-600">{Math.round(Number(r.total_minutes||0))}</td>
                                                  </tr>
                                                ))}
                                                {dHH.length > 1 && (
                                                  <tr className="bg-blue-50">
                                                    <td colSpan="6" className="px-3 py-2 text-right text-[9px] font-black text-blue-600 uppercase">Subtotal despacho:</td>
                                                    <td className="px-3 py-2 text-right text-xs font-black text-blue-800">{dHours.toFixed(2)}</td>
                                                    <td className="px-3 py-2 text-right text-xs font-black text-indigo-700">{Math.round(dHours*60)}</td>
                                                  </tr>
                                                )}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* Total del cliente */}
                                {cliHours > 0 && (
                                  <div className="bg-slate-50 border-t border-slate-200 px-6 py-3 flex justify-end gap-6">
                                    <span className="text-[9px] font-black text-slate-500 uppercase self-center">Total HH {cid}:</span>
                                    <span className="text-sm font-black text-blue-700">{cliHours.toFixed(2)} hrs</span>
                                    <span className="text-sm font-black text-indigo-600">{Math.round(cliHours*60)} min</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })() : (
                      <div className="bg-slate-100 border-2 border-dashed border-slate-300 rounded-3xl p-16 text-center text-slate-400">
                        <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50"/>
                        <p className="font-black uppercase tracking-widest text-xs">Selecciona el período y presiona Generar</p>
                        <p className="text-[10px] mt-1">El reporte mostrará los recursos agrupados por cliente y por despacho</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* LPN HISTORY */}
            {activeTab === 'lpn-history' && canManageMasters && (
              <Suspense fallback={<TabLoader />}>
                <LpnHistoryTab
                  lpnHistoryId={lpnHistoryId}
                  setLpnHistoryId={setLpnHistoryId}
                  lpnHistoryData={lpnHistoryData}
                  setLpnHistoryData={setLpnHistoryData}
                  apiFetch={apiFetch}
                  host={host}
                  getStatusBadge={getStatusBadge}
                />
              </Suspense>
            )}

            {/* DEVOLUCIONES */}
            {activeTab === 'returns' && (
              <div className="space-y-6 animate-in fade-in max-w-5xl mx-auto">
                <div className="flex items-center justify-between">
                  <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><ArrowLeft className="text-orange-500"/> Gestión de Devoluciones</h1>
                  <button onClick={async () => { const res = await apiFetch(`${host}/api/returns`); const d = await res.json(); setReturnsData(Array.isArray(d)?d:[]); }} className="bg-orange-100 hover:bg-orange-200 text-orange-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 shadow-sm"><RefreshCcw size={12}/> Cargar</button>
                </div>
                <div className="bg-white rounded-3xl border border-orange-200 shadow-sm p-8">
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter mb-6 border-b pb-4">Nueva Devolución</h3>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <input type="text" placeholder="N° Documento *" value={newReturn.doc_num} onChange={e=>setNewReturn({...newReturn,doc_num:e.target.value.toUpperCase()})} className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black uppercase outline-none focus:border-orange-500"/>
                    {is3PLMode ? (
                      <select value={newReturn.client_id} onChange={e=>setNewReturn({...newReturn,client_id:e.target.value})} className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-orange-500 bg-white">
                        <option value="">-- Cliente --</option>
                        {permittedClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : (
                      <div className="border-2 border-emerald-200 bg-emerald-50 rounded-xl px-4 py-3 text-sm font-black text-emerald-700 flex items-center gap-2">
                        <Package size={14} className="text-emerald-500 shrink-0"/>{systemConfig.own_client_name || 'Bodega Propia'}
                      </div>
                    )}
                    <input type="text" placeholder="Motivo de devolución *" value={newReturn.reason} onChange={e=>setNewReturn({...newReturn,reason:e.target.value})} className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-orange-500 col-span-2"/>
                  </div>
                  <div className="bg-slate-50 rounded-2xl p-4 mb-4 space-y-3">
                    <h4 className="text-[10px] font-black text-slate-500 uppercase">Agregar Línea de Devolución</h4>
                    <div className="grid grid-cols-3 gap-3">
                      <select value={returnLineItem.sku} onChange={e=>setReturnLineItem({...returnLineItem,sku:e.target.value})} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white uppercase">
                        <option value="">-- SKU --</option>
                        {permittedSkus.filter(s=>!newReturn.client_id || (s.client_id||'')===newReturn.client_id).map(s=><option key={s.sku} value={s.sku}>{s.sku}</option>)}
                      </select>
                      <input type="number" placeholder="Cantidad" value={returnLineItem.qty} onChange={e=>setReturnLineItem({...returnLineItem,qty:e.target.value})} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none"/>
                      <select value={returnLineItem.condition} onChange={e=>setReturnLineItem({...returnLineItem,condition:e.target.value})} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white">
                        <option value="BUENO">Buen Estado → DISPONIBLE</option>
                        <option value="MALO">Dañado → RETENIDO</option>
                      </select>
                    </div>
                    <button onClick={() => { if (!returnLineItem.sku || !returnLineItem.qty) return; setNewReturn(prev=>({...prev,items:[...prev.items,{...returnLineItem}]})); setReturnLineItem({sku:'',qty:'',original_lpn:'',condition:'BUENO',location_id:'PISO-RECEPCION',notes:''}); }} className="bg-orange-100 hover:bg-orange-200 text-orange-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1"><Plus size={12}/> Agregar</button>
                  </div>
                  {newReturn.items.length > 0 && (
                    <div className="mb-4">
                      {newReturn.items.map((it,i) => (
                        <div key={i} className="flex justify-between items-center p-3 bg-white rounded-xl border border-slate-200 mb-2">
                          <span className="text-xs font-black uppercase">{it.sku} — {it.qty} un <span className={`text-[9px] px-1 rounded ${it.condition==='BUENO'?'bg-emerald-100 text-emerald-700':'bg-red-100 text-red-700'}`}>{it.condition}</span></span>
                          <button onClick={()=>setNewReturn(prev=>({...prev,items:prev.items.filter((_,idx)=>idx!==i)}))} className="text-red-400 hover:text-red-600"><Trash2 size={14}/></button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button disabled={!newReturn.doc_num || !newReturn.reason || newReturn.items.length===0} onClick={async () => { const retPayload={...newReturn,username:currentUser.username}; if((!is3PLMode || isHybridMode) && !retPayload.client_id) retPayload.client_id=systemConfig.own_client_id||'PROPIO'; if(is3PLMode && !retPayload.client_id) return showMsg('⛔ Selecciona el cliente de la devolución', true); const res = await apiFetch(`${host}/api/returns`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(retPayload)}); if (res.ok) { const d=await res.json(); showMsg(`✅ Devolución ${d.returnId} procesada`); setNewReturn({doc_num:'',doc_type:'DEVOLUCION',client_id:'',reason:'',glosa:'',items:[]}); fetchData(); } else { const e=await res.json().catch(()=>({})); showMsg(`⛔ ${e.error||'Error'}`,true); } }} className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black py-4 rounded-2xl shadow-lg uppercase text-[10px] tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"><ArrowLeft size={16}/> Procesar Devolución e Ingresar Stock</button>
                </div>
                {returnsData.length > 0 && (
                  <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b"><tr><th className="p-4 text-[10px] font-black text-slate-400 uppercase">ID Devolución</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Documento</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Motivo</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Fecha</th><th className="p-4 text-center text-[10px] font-black text-slate-400 uppercase">Líneas</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {returnsData.map(r=>(
                          <tr key={r.id} className="hover:bg-slate-50">
                            <td className="p-4 font-mono text-[10px] font-black text-orange-700">{r.id}</td>
                            <td className="p-4 text-xs font-black uppercase">{r.doc_num}</td>
                            <td className="p-4 text-xs text-slate-600">{r.reason}</td>
                            <td className="p-4 text-[10px] text-slate-400">{new Date(r.created_at).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})}</td>
                            <td className="p-4 text-center font-black text-slate-700">{r.line_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TRANSPORTE */}
            {activeTab === 'transport' && (
              <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
                <div className="flex items-center justify-between">
                  <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><Truck className="text-cyan-500"/> Módulo de Transporte</h1>
                </div>
                {/* Sub-tabs transporte */}
                <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl w-fit">
                  {[['carriers','Transportistas'],['shipments','Envíos']].map(([id,label])=>(
                    <button key={id} onClick={()=>setTransportTab(id)} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors ${transportTab===id?'bg-white text-cyan-700 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{label}</button>
                  ))}
                </div>

                {transportTab === 'carriers' && (
                <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row gap-8">
                  <div className="flex-1 space-y-5 border-r border-slate-100 pr-8">
                    <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter flex items-center"><Truck className="w-4 h-4 mr-2 text-cyan-500"/> {carrierForm.id ? 'Editar Transportista' : 'Nuevo Transportista'}</h2>
                    <form onSubmit={handleSaveCarrier} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Razón Social *</label><input type="text" required value={carrierForm.name} onChange={e=>setCarrierForm({...carrierForm,name:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500"/></div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">RUT</label><input type="text" value={carrierForm.rut} onChange={e=>setCarrierForm({...carrierForm,rut:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500"/></div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Contacto</label><input type="text" value={carrierForm.contact} onChange={e=>setCarrierForm({...carrierForm,contact:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500"/></div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Teléfono</label><input type="text" value={carrierForm.phone} onChange={e=>setCarrierForm({...carrierForm,phone:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500"/></div>
                        <div className="col-span-2 space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Email</label><input type="email" value={carrierForm.email} onChange={e=>setCarrierForm({...carrierForm,email:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500"/></div>
                      </div>
                      <div className="flex gap-3">
                        <button type="submit" className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-white font-black py-4 rounded-2xl uppercase text-xs tracking-widest shadow-lg shadow-cyan-200 transition-colors flex items-center justify-center gap-2"><Plus size={14}/> {carrierForm.id?'Actualizar':'Guardar'}</button>
                        {carrierForm.id && <button type="button" onClick={()=>setCarrierForm({id:'',name:'',rut:'',contact:'',phone:'',email:''})} className="px-6 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black py-4 rounded-2xl text-xs uppercase tracking-widest transition-colors">Cancelar</button>}
                      </div>
                    </form>
                  </div>
                  <div className="flex-[1.5] overflow-y-auto max-h-[600px] custom-scrollbar pr-2">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Transportistas Registrados ({carriers.length})</p>
                    <div className="space-y-3">
                      {carriers.map(c=>(
                        <div key={c.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 hover:bg-white transition-colors shadow-sm">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-sm font-black text-slate-800">{c.name}</p>
                              {c.rut && <p className="text-[10px] font-mono text-slate-500 mt-0.5">RUT: {c.rut}</p>}
                              <div className="flex gap-3 mt-1 text-[9px] text-slate-400 font-bold">{c.contact&&<span>{c.contact}</span>}{c.phone&&<span>{c.phone}</span>}{c.email&&<span>{c.email}</span>}</div>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={()=>setCarrierForm({id:c.id,name:c.name,rut:c.rut||'',contact:c.contact||'',phone:c.phone||'',email:c.email||''})} className="text-slate-400 hover:text-cyan-600 transition-colors"><Settings2 size={14}/></button>
                              <button onClick={async()=>{if(!(await confirm({ message: '¿Eliminar?', danger: true })))return;const r=await apiFetch(`${host}/api/carriers/${c.id}`,{method:'DELETE'});if(r.ok){showMsg('✅ Eliminado');fetchData();}}} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={14}/></button>
                            </div>
                          </div>
                        </div>
                      ))}
                      {carriers.length===0 && <div className="p-8 text-center text-slate-400"><Truck className="w-12 h-12 mx-auto mb-2 opacity-50"/><p className="text-[10px] uppercase tracking-widest font-bold">No hay transportistas registrados</p></div>}
                    </div>
                  </div>
                </div>
                )}

                {transportTab === 'shipments' && (
                <div className="space-y-6">
                  <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8">
                    <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter flex items-center mb-6"><FileText className="w-4 h-4 mr-2 text-cyan-500"/> Nuevo Envío</h2>
                    <form onSubmit={handleSaveShipment} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Transportista *</label><select required value={shipmentForm.carrier_id} onChange={e=>setShipmentForm({...shipmentForm,carrier_id:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500 bg-white"><option value="">-- Seleccionar --</option>{carriers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">N° Documento *</label><input type="text" required value={shipmentForm.doc_num} onChange={e=>setShipmentForm({...shipmentForm,doc_num:e.target.value.toUpperCase()})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-cyan-500 uppercase"/></div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Cliente</label>{is3PLMode ? (<select value={shipmentForm.client_id} onChange={e=>setShipmentForm({...shipmentForm,client_id:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500 bg-white"><option value="">-- Seleccionar --</option>{permittedClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>) : (<div className="w-full border-2 border-emerald-200 bg-emerald-50 rounded-xl px-4 py-3 text-sm font-black text-emerald-700 flex items-center gap-2"><Package size={14} className="text-emerald-500 shrink-0"/>{systemConfig.own_client_name || 'Bodega Propia'}</div>)}</div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Destino</label><input type="text" value={shipmentForm.destination} onChange={e=>setShipmentForm({...shipmentForm,destination:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500"/></div>
                        <div className="col-span-2 space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Notas</label><input type="text" value={shipmentForm.notes} onChange={e=>setShipmentForm({...shipmentForm,notes:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500"/></div>
                      </div>
                      <button type="submit" className="bg-cyan-600 hover:bg-cyan-700 text-white font-black py-4 px-8 rounded-2xl uppercase text-xs tracking-widest shadow-lg shadow-cyan-200 transition-colors flex items-center gap-2"><Plus size={14}/> Crear Envío</button>
                    </form>
                  </div>
                  <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b"><tr><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Documento</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Transportista</th>{is3PLMode && <th className="p-4 text-[10px] font-black text-slate-400 uppercase">Cliente</th>}<th className="p-4 text-[10px] font-black text-slate-400 uppercase">Destino</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Estado</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Acciones</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {shipments.map(s=>{
                          const statusColors = {PENDING:'bg-slate-100 text-slate-600',ASSIGNED:'bg-blue-100 text-blue-700',IN_TRANSIT:'bg-amber-100 text-amber-700',DELIVERED:'bg-emerald-100 text-emerald-700',RETURNED:'bg-red-100 text-red-700'};
                          const nextStatus = {PENDING:'ASSIGNED',ASSIGNED:'IN_TRANSIT',IN_TRANSIT:'DELIVERED'};
                          const nextLabel = {PENDING:'Asignar',ASSIGNED:'En Tránsito',IN_TRANSIT:'Entregar'};
                          return (
                            <tr key={s.id} className="hover:bg-slate-50">
                              <td className="p-4 font-black text-xs uppercase text-cyan-700">{s.doc_num}</td>
                              <td className="p-4 text-xs text-slate-600">{s.carrier_name||s.carrier_id}</td>
                              {is3PLMode && <td className="p-4 text-xs text-slate-500">{s.client_id||'—'}</td>}
                              <td className="p-4 text-xs text-slate-500">{s.destination||'—'}</td>
                              <td className="p-4"><span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${statusColors[s.status]||'bg-slate-100 text-slate-600'}`}>{s.status}</span></td>
                              <td className="p-4">
                                <div className="flex gap-2">
                                  {nextStatus[s.status] && <button onClick={()=>handleShipmentStatus(s.id,nextStatus[s.status])} className="text-[9px] font-black bg-cyan-50 hover:bg-cyan-100 text-cyan-700 px-2 py-1 rounded-lg uppercase transition-colors">{nextLabel[s.status]}</button>}
                                  {s.status!=='DELIVERED'&&s.status!=='RETURNED' && <button onClick={()=>handleShipmentStatus(s.id,'RETURNED')} className="text-[9px] font-black bg-red-50 hover:bg-red-100 text-red-600 px-2 py-1 rounded-lg uppercase transition-colors">Devolver</button>}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {shipments.length===0 && <tr><td colSpan={is3PLMode ? 6 : 5} className="p-8 text-center text-slate-400 text-xs">Sin envíos registrados</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
                )}
              </div>
            )}

            {/* CONTEOS CÍCLICOS — oculto para CLIENTE */}
            {activeTab === 'cycle-count' && currentUser?.role !== 'CLIENTE' && (
              <div className="space-y-6 animate-in fade-in max-w-5xl mx-auto">
                {/* ── Header ── */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><ClipboardCheck className="text-cyan-500"/> Conteo Físico</h1>
                  <button onClick={async()=>{ const r=await apiFetch(`${host}/api/cycle-count`); const d=await r.json(); setCycleCountData(Array.isArray(d)?d:[]); }} className="bg-cyan-100 hover:bg-cyan-200 text-cyan-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2"><RefreshCcw size={12}/> Cargar</button>
                </div>

                {/* ── Formulario nuevo conteo ── */}
                <div className="bg-white rounded-3xl border border-cyan-200 shadow-sm p-6 space-y-4">
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter border-b pb-3">Nuevo Conteo</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {clients.length > 0 && (
                      <div>
                        <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Cliente</label>
                        <select value={ccFilter.client_id} onChange={e=>{setCcFilter(f=>({...f,client_id:e.target.value}));setCcPreview(null);}} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-cyan-500 bg-white">
                          <option value="">Todos</option>
                          {clients.map(c=><option key={c.id} value={c.id}>{c.name||c.id}</option>)}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">SKU (opcional)</label>
                      <input value={ccFilter.sku} onChange={e=>{setCcFilter(f=>({...f,sku:e.target.value.toUpperCase()}));setCcPreview(null);}} placeholder="SKU exacto" className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold uppercase outline-none focus:border-cyan-500"/>
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Zona (opcional)</label>
                      <select value={ccFilter.zone} onChange={e=>{setCcFilter(f=>({...f,zone:e.target.value}));setCcPreview(null);}} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-cyan-500 bg-white">
                        <option value="">Todas</option>
                        {[...new Set(safeLocs.map(l=>l.zone_code).filter(Boolean))].map(z=><option key={z} value={z}>{z}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Ubicación puntual</label>
                      <input value={ccFilter.location_id} onChange={e=>{setCcFilter(f=>({...f,location_id:e.target.value.toUpperCase()}));setCcPreview(null);}} placeholder="1-A-01-1" className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold uppercase outline-none focus:border-cyan-500"/>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <label className="flex items-center gap-2 px-3 py-2 border-2 border-slate-200 rounded-xl cursor-pointer hover:border-cyan-300">
                      <input type="checkbox" checked={ccBlind} onChange={e=>setCcBlind(e.target.checked)} className="rounded accent-cyan-600"/>
                      <span className="text-xs font-black text-slate-600 uppercase">A ciegas</span>
                    </label>
                    <button onClick={async()=>{
                      setCcPreviewLoading(true);setCcPreview(null);
                      const r=await apiFetch(`${host}/api/cycle-count/preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({zone_code:ccFilter.zone||undefined,client_id:ccFilter.client_id||undefined,sku:ccFilter.sku||undefined,location_id:ccFilter.location_id||undefined})});
                      setCcPreviewLoading(false);
                      if(r.ok)setCcPreview(await r.json()); else showMsg('⛔ Error al previsualizar',true);
                    }} disabled={ccPreviewLoading} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 disabled:opacity-50">
                      <Search size={12}/> {ccPreviewLoading?'…':'Previsualizar'}
                    </button>
                    {ccPreview && <span className="text-xs font-bold text-cyan-700 bg-cyan-50 border border-cyan-200 px-3 py-1.5 rounded-xl">{ccPreview.lines} ubicaciones · {Number(ccPreview.total_units).toLocaleString('es-CL')} unidades</span>}
                    <button onClick={async()=>{
                      const body={username:currentUser.username,blind:ccBlind};
                      if(ccFilter.zone)        body.zone_code=ccFilter.zone;
                      if(ccFilter.client_id)   body.client_id=ccFilter.client_id;
                      if(ccFilter.sku)         body.sku=ccFilter.sku;
                      if(ccFilter.location_id) body.location_id=ccFilter.location_id;
                      const res=await apiFetch(`${host}/api/cycle-count/create`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
                      if(res.ok){const d=await res.json();showMsg(`✅ Conteo ${d.countId} creado — ${d.lines} líneas`);const r2=await apiFetch(`${host}/api/cycle-count`);setCycleCountData(await r2.json());setCcFilter({zone:'',client_id:'',sku:'',location_id:''});setCcPreview(null);}
                      else{const e=await res.json().catch(()=>({}));showMsg(`⛔ ${e.error||'Error'}`,true);}
                    }} className="bg-cyan-600 hover:bg-cyan-700 text-white px-6 py-2 rounded-xl text-[10px] font-black uppercase shadow-lg flex items-center gap-2 ml-auto">
                      <Plus size={13}/> Crear conteo
                    </button>
                  </div>
                </div>

                {/* ── Modal rechazar ── */}
                {ccRejectModal && (
                  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl p-6 w-96 shadow-2xl space-y-4">
                      <h3 className="font-black text-slate-800 uppercase">Rechazar conteo</h3>
                      <textarea value={ccRejectReason} onChange={e=>setCcRejectReason(e.target.value)} placeholder="Motivo del rechazo..." className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-red-400 h-24 resize-none"/>
                      <div className="flex gap-2 justify-end">
                        <button onClick={()=>{setCcRejectModal(null);setCcRejectReason('');}} className="px-4 py-2 text-[10px] font-black uppercase text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50">Cancelar</button>
                        <button onClick={async()=>{
                          const r=await apiFetch(`${host}/api/cycle-count/${ccRejectModal}/reject`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:currentUser.username,reason:ccRejectReason})});
                          if(r.ok){showMsg('Conteo rechazado');const r2=await apiFetch(`${host}/api/cycle-count`);setCycleCountData(await r2.json());}
                          else showMsg('⛔ Error',true);
                          setCcRejectModal(null);setCcRejectReason('');
                        }} className="px-4 py-2 text-[10px] font-black uppercase bg-red-600 hover:bg-red-700 text-white rounded-xl">Rechazar</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Conteo activo ── */}
                {activeCycleCount ? (()=>{
                  const isBlind=activeCycleCount.blind;
                  const isCompleted=activeCycleCount.status==='COMPLETED';
                  const isPendApproval=activeCycleCount.status==='PENDIENTE_APROBACION';
                  const showExpected=!isBlind||isCompleted||isPendApproval;
                  const canApprove=['JEFE_BODEGA','ADMIN','SUPERADMIN'].includes(currentUser?.role);
                  const STATUS_BADGE={PENDING:'bg-slate-100 text-slate-600',EN_PROCESO:'bg-cyan-100 text-cyan-700',PENDIENTE_APROBACION:'bg-amber-100 text-amber-700',COMPLETED:'bg-emerald-100 text-emerald-700',RECHAZADO:'bg-red-100 text-red-700'};
                  return (
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                      <div className="bg-cyan-50 p-5 border-b border-cyan-200 flex justify-between items-start flex-wrap gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-black text-cyan-900 uppercase">{activeCycleCount.id}</h3>
                            {isBlind && <span className="text-[9px] bg-violet-100 text-violet-700 border border-violet-200 px-2 py-0.5 rounded font-black uppercase">A ciegas</span>}
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${STATUS_BADGE[activeCycleCount.status]||'bg-slate-100 text-slate-600'}`}>{activeCycleCount.status}</span>
                          </div>
                          <p className="text-[10px] text-cyan-700 font-bold">{activeCycleCount.scope_label||activeCycleCount.zone_code} · {activeCycleCount.counted_lines}/{activeCycleCount.total_lines} contadas · {activeCycleCount.diff_lines||0} con diferencia</p>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {!isPendApproval && !isCompleted && <button onClick={()=>setCcAddLineForm({location_id:'',sku:'',qty:'',note:''})} className="bg-white border border-amber-200 text-amber-700 px-3 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1"><Plus size={11}/> Reportar hallazgo</button>}
                          <button onClick={()=>{setActiveCycleCount(null);setCycleLines([]);setCcAddLineForm(null);}} className="bg-white border border-slate-200 text-slate-600 px-3 py-2 rounded-xl text-[10px] font-black uppercase">Cerrar</button>
                          {!isPendApproval && !isCompleted && (
                            <button onClick={async()=>{
                              if(!(await confirm({message:'¿Enviar el conteo a aprobación? Si no hay diferencias, se completará directamente.',danger:false})))return;
                              const r=await apiFetch(`${host}/api/cycle-count/${activeCycleCount.id}/submit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:currentUser.username})});
                              const d=await r.json().catch(()=>({}));
                              if(r.ok){showMsg(d.requires_approval?'✅ Conteo enviado a aprobación':'✅ Conteo completado (sin diferencias)');const r2=await apiFetch(`${host}/api/cycle-count`);setCycleCountData(await r2.json());setActiveCycleCount(null);setCycleLines([]);}
                              else showMsg(`⛔ ${d.error||'Error'}`,true);
                            }} className="bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase shadow-md">Enviar a aprobación</button>
                          )}
                          {isPendApproval && canApprove && (<>
                            <button onClick={async()=>{
                              if(!(await confirm({message:'¿Aprobar y aplicar ajustes al inventario?',danger:true})))return;
                              const r=await apiFetch(`${host}/api/cycle-count/${activeCycleCount.id}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:currentUser.username})});
                              if(r.ok){showMsg('✅ Conteo aprobado y stock ajustado');const r2=await apiFetch(`${host}/api/cycle-count`);setCycleCountData(await r2.json());setActiveCycleCount(null);setCycleLines([]);fetchData();}
                              else{const e=await r.json().catch(()=>({}));showMsg(`⛔ ${e.error||'Error'}`,true);}
                            }} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase shadow-md">Aprobar</button>
                            <button onClick={()=>{setCcRejectModal(activeCycleCount.id);setCcRejectReason('');}} className="bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 px-4 py-2 rounded-xl text-[10px] font-black uppercase">Rechazar</button>
                          </>)}
                        </div>
                      </div>

                      {/* Hallazgo form */}
                      {ccAddLineForm && (
                        <div className="bg-amber-50 border-b border-amber-200 p-4 flex gap-3 flex-wrap items-end">
                          {[{label:'Ubicación',key:'location_id',ph:'1-A-01-1',w:'w-36',up:true},{label:'SKU',key:'sku',ph:'SKU',w:'w-36',up:true},{label:'Cantidad',key:'qty',ph:'0',w:'w-24',type:'number'},{label:'Nota',key:'note',ph:'Detalle...',w:'w-44'}].map(f=>(
                            <div key={f.key}>
                              <p className="text-[9px] font-black text-amber-700 uppercase mb-1">{f.label}</p>
                              <input type={f.type||'text'} min={f.type==='number'?0:undefined} step={f.type==='number'?'0.01':undefined}
                                value={ccAddLineForm[f.key]} onChange={e=>setCcAddLineForm(p=>({...p,[f.key]:f.up?e.target.value.toUpperCase():e.target.value}))}
                                placeholder={f.ph} className={`border border-amber-300 rounded-lg px-3 py-2 text-xs font-black outline-none focus:border-amber-500 bg-white ${f.w}`}/>
                            </div>
                          ))}
                          <button onClick={async()=>{
                            if(!ccAddLineForm.location_id||!ccAddLineForm.sku){showMsg('⛔ Ubicación y SKU requeridos',true);return;}
                            const r=await apiFetch(`${host}/api/cycle-count/${activeCycleCount.id}/add-line`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location_id:ccAddLineForm.location_id,sku:ccAddLineForm.sku,counted_qty:parseFloat(ccAddLineForm.qty)||0,note:ccAddLineForm.note,username:currentUser.username})});
                            if(r.ok){const d=await r.json();setCycleLines(d.lines);setCcAddLineForm(null);showMsg('✅ Hallazgo registrado');}
                            else showMsg('⛔ Error',true);
                          }} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase">Guardar</button>
                          <button onClick={()=>setCcAddLineForm(null)} className="text-slate-500 text-[9px] font-black uppercase px-3 py-2">Cancelar</button>
                        </div>
                      )}

                      {cycleLines.length===0 ? (
                        <div className="p-10 text-center space-y-3">
                          <ClipboardCheck className="w-10 h-10 mx-auto text-slate-300"/>
                          <p className="font-black text-slate-500 text-sm">No hay ubicaciones con stock para el alcance <strong>'{activeCycleCount.scope_label||activeCycleCount.zone_code}'</strong>.</p>
                          <p className="text-[11px] text-slate-400">Verifica que las ubicaciones tengan zone_code asignado en el maestro, o reporta un hallazgo manualmente.</p>
                          <button onClick={()=>setCcAddLineForm({location_id:'',sku:'',qty:'',note:''})} className="bg-amber-100 hover:bg-amber-200 text-amber-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 mx-auto"><Plus size={11}/> Reportar hallazgo</button>
                        </div>
                      ) : (
                        <div className="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
                          <table className="w-full text-left">
                            <thead className="bg-slate-50 sticky top-0">
                              <tr>
                                <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Ubicación</th>
                                <th className="p-3 text-[9px] font-black text-slate-400 uppercase">SKU</th>
                                {showExpected && <th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Esperado</th>}
                                <th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Contado</th>
                                <th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Diferencia</th>
                                <th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Acción</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {cycleLines.map(line=>(
                                <tr key={line.id} className={`hover:bg-slate-50 ${line.status==='COUNTED'?(parseFloat(line.difference)!==0?'bg-red-50':'bg-emerald-50/50'):''} ${line.line_type==='ENCONTRADO'?'bg-amber-50/60':''}`}>
                                  <td className="p-3 font-mono text-[10px] font-bold text-slate-600">{line.location_id}</td>
                                  <td className="p-3 text-xs font-black text-slate-800 uppercase">
                                    {line.sku}
                                    {line.line_type==='ENCONTRADO' && <span className="ml-1 text-[8px] bg-amber-200 text-amber-700 px-1.5 py-0.5 rounded font-black">HALLAZGO</span>}
                                    {line.note && <span className="ml-1 text-[8px] text-slate-400" title={line.note}>📝</span>}
                                  </td>
                                  {showExpected && <td className="p-3 text-center font-black text-slate-700">{line.expected_qty??'—'}</td>}
                                  <td className="p-3 text-center">
                                    {line.status==='COUNTED'||isPendApproval
                                      ? <span className="font-black text-slate-800">{line.counted_qty??'—'}</span>
                                      : <input type="number" min="0" step="0.01" value={cycleCountedQtys[line.id]||''} onChange={e=>setCycleCountedQtys(p=>({...p,[line.id]:e.target.value}))} className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-center text-xs font-black outline-none focus:border-cyan-500" placeholder="0"/>}
                                  </td>
                                  <td className="p-3 text-center">
                                    {(line.status==='COUNTED'||isPendApproval) && <span className={`font-black text-sm ${parseFloat(line.difference)>0?'text-emerald-600':parseFloat(line.difference)<0?'text-red-600':'text-slate-400'}`}>{parseFloat(line.difference)>0?'+':''}{line.difference}</span>}
                                  </td>
                                  <td className="p-3 text-center">
                                    {line.status!=='COUNTED'&&!isPendApproval && <button onClick={async()=>{
                                      const qty=cycleCountedQtys[line.id]; if(qty===undefined||qty==='')return;
                                      const r=await apiFetch(`${host}/api/cycle-count/${activeCycleCount.id}/count`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lineId:line.id,counted_qty:parseFloat(qty),username:currentUser.username})});
                                      if(r.ok){const r2=await apiFetch(`${host}/api/cycle-count/${activeCycleCount.id}/lines`);const d=await r2.json();setCycleLines(d.lines||d);const upd=cycleCountData.map(c=>c.id===activeCycleCount.id?{...c,counted_lines:(c.counted_lines||0)+1}:c);setCycleCountData(upd);setActiveCycleCount(p=>({...p,counted_lines:(p.counted_lines||0)+1}));}
                                    }} className="bg-cyan-100 hover:bg-cyan-200 text-cyan-700 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase">Registrar</button>}
                                    {line.status==='COUNTED' && <span className="text-[8px] bg-emerald-100 text-emerald-700 px-2 py-1 rounded font-black uppercase">✓</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })() : (
                  <>
                    {/* Bandeja de aprobación */}
                    {['JEFE_BODEGA','ADMIN','SUPERADMIN'].includes(currentUser?.role) && cycleCountData.some(c=>c.status==='PENDIENTE_APROBACION') && (
                      <div className="space-y-3">
                        <h3 className="text-xs font-black text-amber-700 uppercase flex items-center gap-2"><AlertTriangle size={14}/> Pendientes de aprobación</h3>
                        {cycleCountData.filter(c=>c.status==='PENDIENTE_APROBACION').map(cc=>(
                          <div key={cc.id} className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 flex justify-between items-center flex-wrap gap-3">
                            <div>
                              <p className="text-xs font-black text-amber-900 uppercase">{cc.id}</p>
                              <p className="text-[10px] text-amber-700">{cc.scope_label||cc.zone_code} · {cc.diff_lines} líneas con diferencia · Creado por {cc.created_by}</p>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={async()=>{setActiveCycleCount(cc);const r=await apiFetch(`${host}/api/cycle-count/${cc.id}/lines`);const d=await r.json();setCycleLines(d.lines||d);}} className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-2 rounded-xl text-[9px] font-black uppercase">Ver detalle</button>
                              <button onClick={async()=>{
                                if(!(await confirm({message:'¿Aprobar y aplicar ajustes al inventario?',danger:true})))return;
                                const r=await apiFetch(`${host}/api/cycle-count/${cc.id}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:currentUser.username})});
                                if(r.ok){showMsg('✅ Aprobado y stock ajustado');const r2=await apiFetch(`${host}/api/cycle-count`);setCycleCountData(await r2.json());fetchData();}
                                else{const e=await r.json().catch(()=>({}));showMsg(`⛔ ${e.error||'Error'}`,true);}
                              }} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-xl text-[9px] font-black uppercase">Aprobar</button>
                              <button onClick={()=>{setCcRejectModal(cc.id);setCcRejectReason('');}} className="bg-white border border-red-200 text-red-600 px-3 py-2 rounded-xl text-[9px] font-black uppercase hover:bg-red-50">Rechazar</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Lista de conteos */}
                    {cycleCountData.length > 0 && (()=>{
                      const STATUS_BADGE={PENDING:'bg-slate-100 text-slate-600',EN_PROCESO:'bg-cyan-100 text-cyan-700',PENDIENTE_APROBACION:'bg-amber-100 text-amber-700',COMPLETED:'bg-emerald-100 text-emerald-700',RECHAZADO:'bg-red-100 text-red-700',REVISION:'bg-orange-100 text-orange-700'};
                      const openable=['PENDING','EN_PROCESO','PENDIENTE_APROBACION'];
                      return (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {cycleCountData.map(cc=>(
                            <div key={cc.id} className={`bg-white p-5 rounded-2xl border shadow-sm flex flex-col ${cc.status==='COMPLETED'?'border-emerald-200':cc.status==='RECHAZADO'?'border-red-200':cc.status==='PENDIENTE_APROBACION'?'border-amber-200':'border-cyan-200'}`}>
                              <div className="flex justify-between items-start mb-2">
                                <div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-xs font-black text-slate-800 uppercase">{cc.id}</p>
                                    {cc.blind && <span className="text-[8px] bg-violet-100 text-violet-600 border border-violet-200 px-1.5 rounded font-black uppercase">A ciegas</span>}
                                    <span className={`text-[8px] font-black px-2 py-0.5 rounded uppercase ${STATUS_BADGE[cc.status]||'bg-slate-100 text-slate-600'}`}>{cc.status}</span>
                                  </div>
                                  <p className="text-[10px] text-slate-500 mt-0.5">{cc.scope_label||cc.zone_code} · {cc.counted_lines}/{cc.total_lines} líneas{cc.diff_lines>0?` · ${cc.diff_lines} dif.`:''}</p>
                                </div>
                              </div>
                              <div className="w-full bg-slate-100 rounded-full h-1.5 mb-3"><div className={`h-1.5 rounded-full ${cc.status==='COMPLETED'?'bg-emerald-500':cc.status==='RECHAZADO'?'bg-red-400':'bg-cyan-500'}`} style={{width:`${cc.total_lines>0?(cc.counted_lines/cc.total_lines)*100:0}%`}}></div></div>
                              {openable.includes(cc.status) && <button onClick={async()=>{setActiveCycleCount(cc);const r=await apiFetch(`${host}/api/cycle-count/${cc.id}/lines`);const d=await r.json();setCycleLines(d.lines||d);}} className="mt-auto w-full bg-cyan-100 hover:bg-cyan-200 text-cyan-700 py-2 rounded-xl text-[10px] font-black uppercase">{cc.status==='PENDIENTE_APROBACION'?'Ver / Aprobar':'Abrir y Contar'}</button>}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            )}

            {/* SUPERADMIN PANEL */}
            {activeTab === 'superadmin' && isSuperAdmin && (
              <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-4">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-red-100 rounded-2xl"><ShieldAlert className="w-8 h-8 text-red-600"/></div>
                    <div>
                      <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Panel SUPERADMIN</h1>
                      <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Acceso Restringido — Todas las acciones quedan registradas</p>
                    </div>
                  </div>
                  {/* BOTÓN MANTENIMIENTO DE EMERGENCIA */}
                  <button onClick={async () => {
                    const newMode = !maintenanceMode;
                    const msg = newMode ? (prompt('Mensaje para los usuarios:') || 'Sistema en mantenimiento.') : maintenanceMessage;
                    const res = await apiFetch(`${host}/api/system/config`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requester:currentUser.username,configs:{maintenance_mode:String(newMode),maintenance_message:msg}})});
                    if(res.ok){setMaintenanceMode(newMode);showMsg(newMode?'🔴 Modo mantenimiento ACTIVADO — todos los usuarios serán bloqueados':'🟢 Modo mantenimiento DESACTIVADO');}
                  }} className={`px-6 py-3 rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg flex items-center gap-3 transition-all ${maintenanceMode?'bg-red-600 text-white animate-pulse':'bg-slate-800 text-white hover:bg-red-600'}`}>
                    <ShieldAlert size={18}/>
                    {maintenanceMode ? '🔴 MANTENIMIENTO ACTIVO — Click para desactivar' : '⚡ Activar Modo Emergencia'}
                  </button>
                </div>

                {/* TABS INTERNOS */}
                <div className="flex bg-white p-1 rounded-2xl border border-slate-200 shadow-sm w-fit">
                  {[['metrics','📊 Estado del servidor'],['modo-modules','🔀 Modo & Módulos'],['config','⚙️ Configuración'],['demo','🎮 Modo de prueba'],['users-sa','👥 Usuarios del sistema'],['passwords','🔑 Contraseñas'],['inventory-sa','📦 Productos en bodega'],['audit-sa','📋 Historial de movimientos'],['backups','💾 Copias de respaldo'],['feedback','💡 Mejoras']].map(([id,label])=>(
                    <button key={id} onClick={()=>{ setSuperAdminTab(id); if(id==='demo'){ apiFetch(`${host}/api/demo/feedback`).then(r=>r.ok?r.json():[]).then(d=>setDemoFeedbackList(Array.isArray(d)?d:[])).catch(()=>{}); } if(id==='backups'){ apiFetch(`${host}/api/system/backups`).then(r=>r.ok?r.json():[]).then(d=>setBackupsList(Array.isArray(d)?d:[])).catch(()=>{}); } if(id==='feedback'){ apiFetch(`${host}/api/feedback`).then(r=>r.ok?r.json():[]).then(d=>setFeedbackList(Array.isArray(d)?d:[])).catch(()=>{}); } }} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-colors ${superAdminTab===id?'bg-slate-800 text-white shadow-md':'text-slate-500 hover:bg-slate-100'}`}>{label}</button>
                  ))}
                </div>

                {/* MÉTRICAS */}
                <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm p-8">
                  <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
                    <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center"><Activity className="w-5 h-5 mr-2 text-indigo-500"/> Métricas del Sistema</h2>
                    <button onClick={async () => { const res = await apiFetch(`${host}/api/system/metrics`); const d = await res.json(); setSystemMetrics(d); }} className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2"><RefreshCcw size={12}/> Actualizar</button>
                  </div>
                  {systemMetrics ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200"><p className="text-[9px] font-black text-slate-400 uppercase">LPNs Activos</p><p className="text-2xl font-black text-slate-800">{systemMetrics.inventory?.lpns || 0}</p></div>
                      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200"><p className="text-[9px] font-black text-slate-400 uppercase">Unidades Stock</p><p className="text-2xl font-black text-slate-800">{Number(systemMetrics.inventory?.units || 0).toLocaleString()}</p></div>
                      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200"><p className="text-[9px] font-black text-slate-400 uppercase">Total Logs</p><p className="text-2xl font-black text-slate-800">{Number(systemMetrics.auditLogs || 0).toLocaleString()}</p></div>
                      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200"><p className="text-[9px] font-black text-slate-400 uppercase">Usuarios</p><div className="flex flex-wrap gap-1 mt-1">{systemMetrics.usersByRole?.map(u => <span key={u.role} className="text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-black">{u.role}: {u.count}</span>)}</div></div>
                      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 col-span-2"><p className="text-[9px] font-black text-slate-400 uppercase mb-2">Top 5 SKUs por Stock</p>{systemMetrics.topSkus?.map(s => <div key={s.sku} className="flex justify-between text-[10px] font-bold text-slate-700 border-b border-slate-100 py-1 last:border-0"><span>{s.sku}</span><span className="font-black">{Number(s.total_qty).toLocaleString()}</span></div>)}</div>
                      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 col-span-2"><p className="text-[9px] font-black text-slate-400 uppercase mb-2">Actividad (Últimos 7 días)</p>{systemMetrics.recentActivity?.map(a => <div key={a.type} className="flex justify-between text-[10px] font-bold text-slate-700 border-b border-slate-100 py-1 last:border-0"><span>{a.type}</span><span className="font-black">{a.count} transacciones</span></div>)}</div>
                    </div>
                  ) : <div className="text-center py-8 text-slate-400"><p className="text-[10px] font-black uppercase">Presiona Actualizar para cargar métricas</p></div>}
                </div>

                {/* CONTRASEÑAS */}
                <div className="bg-white rounded-[40px] border border-red-100 shadow-sm p-8">
                  <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
                    <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center"><Eye className="w-5 h-5 mr-2 text-red-500"/> Contraseñas de Usuarios</h2>
                    <button onClick={async () => { if (!showPasswords) { const res = await apiFetch(`${host}/api/system/users/passwords`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({requester: currentUser.username}) }); const d = await res.json(); setSystemPasswords(Array.isArray(d) ? d : []); } setShowPasswords(!showPasswords); }} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 ${showPasswords ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>{showPasswords ? <EyeOff size={12}/> : <Eye size={12}/>} {showPasswords ? 'Ocultar' : 'Mostrar Contraseñas'}</button>
                  </div>
                  {showPasswords && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50"><tr><th className="p-3 text-[9px] font-black text-slate-400 uppercase">Usuario</th><th className="p-3 text-[9px] font-black text-slate-400 uppercase">Nombre</th><th className="p-3 text-[9px] font-black text-slate-400 uppercase">Rol</th><th className="p-3 text-[9px] font-black text-slate-400 uppercase">Contraseña</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {systemPasswords.map(u => (
                            <tr key={u.username} className="hover:bg-red-50">
                              <td className="p-3 font-mono text-xs font-black text-slate-700">@{u.username}</td>
                              <td className="p-3 text-xs text-slate-600">{u.full_name}</td>
                              <td className="p-3"><span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${u.role === 'SUPERADMIN' ? 'bg-red-100 text-red-700' : u.role === 'ADMIN' ? 'bg-orange-100 text-orange-700' : u.role === 'CLIENTE' ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600'}`}>{u.role}</span></td>
                              <td className="p-3 font-mono text-xs font-black text-red-700 bg-red-50 rounded">{u.password}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* GESTIÓN DE INVENTARIO DIRECTO */}
                <div className="bg-white rounded-[40px] border border-orange-100 shadow-sm p-8">
                  <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
                    <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center"><Database className="w-5 h-5 mr-2 text-orange-500"/> Eliminar LPNs Directamente</h2>
                    <span className="text-[9px] bg-orange-100 text-orange-700 px-2 py-1 rounded font-black uppercase border border-orange-200">⚠️ Operación Irreversible</span>
                  </div>
                  <div className="overflow-x-auto max-h-80 overflow-y-auto custom-scrollbar">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 sticky top-0"><tr><th className="p-3 text-[9px] font-black text-slate-400 uppercase">LPN</th><th className="p-3 text-[9px] font-black text-slate-400 uppercase">SKU</th><th className="p-3 text-[9px] font-black text-slate-400 uppercase">Ubicación</th><th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Qty</th><th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Eliminar</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {safeData.slice(0,50).map(i => (
                          <tr key={i.id} className="hover:bg-orange-50">
                            <td className="p-3 font-mono text-[10px] font-black text-slate-600">{i.id}</td>
                            <td className="p-3 text-xs font-black text-slate-800 uppercase">{i.sku}</td>
                            <td className="p-3 text-[10px] font-mono text-slate-500">{i.location_id || 'PISO-RECEPCION'}</td>
                            <td className="p-3 text-center font-black text-slate-800">{i.qty}</td>
                            <td className="p-3 text-center">
                              <button onClick={async () => { if (!(await confirm({ message: `⚠️ ¿Eliminar LPN ${i.id} con ${i.qty} unidades de ${i.sku}? Esta acción es IRREVERSIBLE.`, danger: true }))) return; const res = await apiFetch(`${host}/api/system/inventory/${i.id}`, { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({requester: currentUser.username}) }); if (res.ok) { showMsg(`✅ LPN ${i.id} eliminado`); fetchData(); } else { const e = await res.json(); showMsg(`⛔ ${e.error}`, true); } }} className="bg-red-100 hover:bg-red-200 text-red-700 p-2 rounded-lg transition-colors"><Trash2 size={12}/></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* TAB: MÉTRICAS */}
                {superAdminTab === 'metrics' && (
                  <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm p-8">
                    <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
                      <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center"><Activity className="w-5 h-5 mr-2 text-indigo-500"/> Métricas del Sistema</h2>
                      <button onClick={async () => { const res = await apiFetch(`${host}/api/system/metrics`); const d = await res.json(); setSystemMetrics(d); }} className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2"><RefreshCcw size={12}/> Actualizar</button>
                    </div>
                    {systemMetrics ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200"><p className="text-[9px] font-black text-slate-400 uppercase">LPNs Activos</p><p className="text-2xl font-black text-slate-800">{systemMetrics.inventory?.lpns || 0}</p></div>
                        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200"><p className="text-[9px] font-black text-slate-400 uppercase">Unidades Stock</p><p className="text-2xl font-black text-slate-800">{Number(systemMetrics.inventory?.units || 0).toLocaleString()}</p></div>
                        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200"><p className="text-[9px] font-black text-slate-400 uppercase">Total Logs</p><p className="text-2xl font-black text-slate-800">{Number(systemMetrics.auditLogs || 0).toLocaleString()}</p></div>
                        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200"><p className="text-[9px] font-black text-slate-400 uppercase">Usuarios</p><div className="flex flex-wrap gap-1 mt-1">{systemMetrics.usersByRole?.map(u => <span key={u.role} className="text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-black">{u.role}: {u.count}</span>)}</div></div>
                        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 col-span-2"><p className="text-[9px] font-black text-slate-400 uppercase mb-2">Top 5 SKUs por Stock</p>{systemMetrics.topSkus?.map(s => <div key={s.sku} className="flex justify-between text-[10px] font-bold text-slate-700 border-b border-slate-100 py-1 last:border-0"><span>{s.sku}</span><span className="font-black">{Number(s.total_qty).toLocaleString()}</span></div>)}</div>
                        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 col-span-2"><p className="text-[9px] font-black text-slate-400 uppercase mb-2">Actividad (Últimos 7 días)</p>{systemMetrics.recentActivity?.map(a => <div key={a.type} className="flex justify-between text-[10px] font-bold text-slate-700 border-b border-slate-100 py-1 last:border-0"><span>{a.type}</span><span className="font-black">{a.count} transacciones</span></div>)}</div>
                      </div>
                    ) : <div className="text-center py-8 text-slate-400"><p className="text-[10px] font-black uppercase">Presiona Actualizar para cargar métricas</p></div>}
                  </div>
                )}

                {/* TAB: MODO + MÓDULOS */}
                {superAdminTab === 'modo-modules' && (
                  <div className="space-y-6">
                    <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm p-8 space-y-6">
                      <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center border-b pb-4"><Globe className="w-5 h-5 mr-2 text-blue-500"/> Modo de Operación del Sistema</h2>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {[
                          { id:'3PL', label:'Modo 3PL', desc:'Bodega multi-cliente. Almacenas mercadería de terceros y cobras por el servicio. Se muestran todos los módulos de clientes y cobros.', color:'blue', icon:'🏭' },
                          { id:'PROPIO', label:'Modo Propio', desc:'Gestión de tu propio inventario. Sin clientes externos. Los módulos de clientes y cobros están ocultos.', color:'emerald', icon:'📦' },
                          { id:'HYBRID', label:'Modo Híbrido', desc:'Combina ambos. Tienes inventario propio Y también puedes recibir clientes externos con cobros 3PL.', color:'purple', icon:'🔀' }
                        ].map(mode=>(
                          <div key={mode.id} onClick={async()=>{ const res=await apiFetch(`${host}/api/system/config`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requester:currentUser.username,configs:{operation_mode:mode.id}})}); if(res.ok){setOperationMode(mode.id);showMsg(`✅ Modo cambiado a ${mode.label}`);fetchData();} }} className={`cursor-pointer rounded-2xl border-2 p-6 transition-all hover:shadow-md ${operationMode===mode.id?`border-${mode.color}-500 bg-${mode.color}-50 shadow-md`:'border-slate-200 hover:border-slate-300'}`}>
                            <div className="text-3xl mb-3">{mode.icon}</div>
                            <p className={`text-sm font-black uppercase mb-2 ${operationMode===mode.id?`text-${mode.color}-700`:'text-slate-700'}`}>{mode.label}</p>
                            <p className="text-[10px] text-slate-500 font-medium leading-relaxed">{mode.desc}</p>
                            {operationMode===mode.id && <div className={`mt-3 text-[9px] font-black uppercase bg-${mode.color}-100 text-${mode.color}-700 px-2 py-1 rounded-lg w-fit`}>✓ Activo Actualmente</div>}
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-slate-100 pt-6">
                        <h3 className="text-sm font-black text-slate-700 uppercase mb-4">Tarifas Globales 3PL</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          {[
                            {key:'3pl_pallet_day_price', label:'Almacenaje (LPN/día)', placeholder:'500'},
                            {key:'3pl_movement_in_price', label:'Recepción (por mov.)', placeholder:'1500'},
                            {key:'3pl_movement_out_price', label:'Despacho (por mov.)', placeholder:'2000'},
                            {key:'3pl_currency', label:'Moneda', placeholder:'CLP', isText:true}
                          ].map(f=>(
                            <div key={f.key} className="space-y-1">
                              <label className="text-[9px] font-black text-slate-400 uppercase">{f.label}</label>
                              <input type={f.isText?'text':'number'} defaultValue={systemConfig[f.key]||f.placeholder} onChange={e=>setEditingConfig(p=>({...p,[f.key]:e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-blue-500"/>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm p-8 space-y-6">
                      <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center border-b pb-4"><Layers className="w-5 h-5 mr-2 text-indigo-500"/> Control de Módulos — Licencia Modular</h2>
                      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-[10px] font-bold text-amber-700 uppercase tracking-widest">
                        ⚠️ Los cambios aquí afectan a TODOS los usuarios (excepto SUPERADMIN). Úsalo para activar/desactivar módulos según el plan contratado.
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {APP_MODULES.map(mod => {
                          const isDisabledGlobal = disabledModules.includes(mod.id);
                          const isInLicense = licenseModules.length === 0 || licenseModules.includes(mod.id);
                          const is3PLMod = MODULES_3PL_ONLY.includes(mod.id);
                          const hiddenByMode = is3PLMod && !is3PLMode;
                          return (
                            <div key={mod.id} className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${isDisabledGlobal ? 'bg-red-50 border-red-200' : hiddenByMode ? 'bg-slate-50 border-slate-200' : isInLicense ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                              <div>
                                <p className="text-xs font-black text-slate-800 uppercase">{mod.label}</p>
                                <p className="text-[9px] font-mono text-slate-400 mt-0.5">{mod.id}</p>
                                <div className="flex gap-1 mt-1 flex-wrap">
                                  {is3PLMod && <span className="text-[8px] bg-cyan-100 text-cyan-700 px-1.5 py-0.5 rounded font-black uppercase">3PL</span>}
                                  {hiddenByMode && <span className="text-[8px] bg-slate-300 text-slate-600 px-1.5 py-0.5 rounded font-black uppercase">Oculto — Modo Propio</span>}
                                  {!hiddenByMode && isDisabledGlobal && <span className="text-[8px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-black uppercase">Deshabilitado</span>}
                                  {!hiddenByMode && !isDisabledGlobal && !isInLicense && <span className="text-[8px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-black uppercase">Sin Licencia</span>}
                                  {!hiddenByMode && !isDisabledGlobal && isInLicense && <span className="text-[8px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-black uppercase">Activo</span>}
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={async () => {
                                  const newDisabled = isDisabledGlobal ? disabledModules.filter(m=>m!==mod.id) : [...disabledModules, mod.id];
                                  const res = await apiFetch(`${host}/api/system/config`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requester:currentUser.username,configs:{disabled_modules:JSON.stringify(newDisabled)}})});
                                  if(res.ok){setDisabledModules(newDisabled);showMsg(`${isDisabledGlobal?'✅ Módulo habilitado':'⛔ Módulo deshabilitado'}: ${mod.label}`);}
                                }} className={`px-3 py-2 rounded-xl text-[9px] font-black uppercase transition-colors ${isDisabledGlobal?'bg-emerald-100 hover:bg-emerald-200 text-emerald-700':'bg-red-100 hover:bg-red-200 text-red-700'}`}>
                                  {isDisabledGlobal ? '✓ Habilitar' : '✗ Deshabilitar'}
                                </button>
                                <button onClick={async () => {
                                  const newLicense = isInLicense ? licenseModules.filter(m=>m!==mod.id) : [...licenseModules, mod.id];
                                  const res = await apiFetch(`${host}/api/system/config`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requester:currentUser.username,configs:{license_modules:JSON.stringify(newLicense)}})});
                                  if(res.ok){setLicenseModules(newLicense);showMsg(`Licencia actualizada: ${mod.label}`);}
                                }} className={`px-3 py-2 rounded-xl text-[9px] font-black uppercase transition-colors ${isInLicense?'bg-slate-100 hover:bg-slate-200 text-slate-600':'bg-indigo-100 hover:bg-indigo-200 text-indigo-700'}`}>
                                  {isInLicense ? 'Quitar Licencia' : 'Licenciar'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {superAdminTab === 'config' && (() => {
                  // Input controlado: valor efectivo = lo editado || lo persistido en el server.
                  const v = (key, fallback = '') => editingConfig[key] !== undefined ? editingConfig[key] : (systemConfig[key] || fallback);
                  return (
                  <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm p-8 space-y-6">
                    <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center border-b pb-4"><Settings2 className="w-5 h-5 mr-2 text-slate-500"/> Configuración Global del Sistema</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2 col-span-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1">🏢 Nombre de la Empresa <span className="bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded text-[8px] font-black">Se muestra en login, header y menú lateral</span></label>
                        <input type="text" value={v('company_name')} onChange={e=>setEditingConfig(p=>({...p,company_name:e.target.value, system_name:e.target.value}))} className="w-full border-2 border-indigo-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder="Ej: Bodega Central S.A."/>
                      </div>
                      <div className="space-y-2 col-span-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Cliente / Empresa Licenciada</label>
                        <input type="text" value={v('license_client')} onChange={e=>setEditingConfig(p=>({...p,license_client:e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-slate-500"/>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Fecha Expiración Licencia</label>
                        <input type="date" value={v('license_expiry','2099-12-31')} onChange={e=>setEditingConfig(p=>({...p,license_expiry:e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-slate-500 bg-white"/>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Máximo de Usuarios</label>
                        <input type="number" value={v('license_max_users',99)} onChange={e=>setEditingConfig(p=>({...p,license_max_users:e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-slate-500"/>
                      </div>
                      <div className="space-y-2 col-span-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Mensaje de Mantenimiento</label>
                        <input type="text" value={v('maintenance_message')} onChange={e=>setEditingConfig(p=>({...p,maintenance_message:e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-slate-500" placeholder="Mensaje que verán los usuarios durante mantenimiento"/>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={async () => {
                        if (Object.keys(editingConfig).length === 0) return showMsg('⚠ No hay cambios para guardar', true);
                        try {
                          const res = await apiFetch(`${host}/api/system/config`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ requester: currentUser.username, configs: editingConfig }) });
                          const data = await res.json().catch(()=>({}));
                          if (res.ok) {
                            showMsg('✅ Configuración guardada');
                            setEditingConfig({});
                            fetchData();
                          } else {
                            showMsg(`⛔ ${data.error || 'No se pudo guardar (requiere rol SUPERADMIN)'}`, true);
                          }
                        } catch (e) { showMsg('⛔ Error de red al guardar', true); }
                      }} className="bg-slate-800 hover:bg-black text-white font-black py-3 px-8 rounded-2xl shadow-lg uppercase text-[10px] tracking-widest flex items-center gap-2"><CheckCircle2 size={14}/> Guardar Configuración</button>
                      {Object.keys(editingConfig).length > 0 && (
                        <button onClick={() => setEditingConfig({})} className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-black py-3 px-6 rounded-2xl uppercase text-[10px] tracking-widest">Descartar</button>
                      )}
                      <span className="text-[10px] font-bold text-slate-400 ml-auto">{Object.keys(editingConfig).length > 0 ? `${Object.keys(editingConfig).length} cambio(s) sin guardar` : 'Sin cambios'}</span>
                    </div>
                  </div>
                  );
                })()}

                {/* TAB: SANDBOX DEMO */}
                {superAdminTab === 'demo' && (
                  <div className="space-y-4">
                    {/* Info del sandbox */}
                    <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm p-8">
                      <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2 mb-4">🎮 Sandbox Interactivo</h2>
                      <p className="text-xs text-slate-500 font-medium mb-4">El sandbox permite a visitantes explorar el WMS completo sin crear cuenta. Eligen un escenario (Propio, 3PL, Híbrido) y un rol, y pueden cambiar ambos en caliente.</p>
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        {Object.values(SANDBOX_SCENARIOS).map(s => (
                          <div key={s.id} className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                            <span className="text-xl">{s.icon}</span>
                            <p className="text-[10px] font-black text-slate-700 mt-1">{s.label}</p>
                            <p className="text-[9px] text-slate-400">{s.desc}</p>
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        {Object.values(SANDBOX_ROLES).map(r => (
                          <div key={r.id} className="bg-slate-50 rounded-lg p-2 border border-slate-200 text-center">
                            <span className="text-lg">{r.icon}</span>
                            <p className="text-[9px] font-black text-slate-600 mt-0.5">{r.label}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* FEEDBACK DE USUARIOS DEMO */}
                    <div className="bg-white border-2 border-amber-100 rounded-[32px] p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                          <MessageSquare size={16} className="text-amber-500"/> Comentarios de Usuarios Sandbox
                        </h3>
                        <button onClick={async () => {
                          const res = await apiFetch(`${host}/api/demo/feedback`);
                          if (res.ok) setDemoFeedbackList(await res.json());
                          else showMsg('⛔ Error al cargar comentarios', true);
                        }} className="bg-amber-100 hover:bg-amber-200 text-amber-700 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase flex items-center gap-1.5">
                          <RefreshCcw size={11}/> Recargar
                        </button>
                      </div>
                      {demoFeedbackList.length === 0 ? (
                        <p className="text-[10px] text-slate-400 font-bold text-center py-6 uppercase">Sin comentarios aún. Presiona "Recargar" para actualizar.</p>
                      ) : (
                        <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
                          {demoFeedbackList.map(f => (
                            <div key={f.id} className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-black text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">{f.persona_label || f.username}</span>
                                  {f.rating && <span className="text-base">{['','😞','😐','🙂','😊','🤩'][Number(f.rating)]}</span>}
                                </div>
                                <span className="text-[9px] text-slate-400 font-bold">{new Date(f.created_at).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})}</span>
                              </div>
                              <p className="text-xs text-slate-700 font-medium leading-relaxed">"{f.message}"</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* TAB: USUARIOS DESDE SUPERADMIN */}
                {superAdminTab === 'users-sa' && (
                  <div className="space-y-4">
                    <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm p-8">
                      <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center border-b pb-4 mb-6"><UserCog className="w-5 h-5 mr-2 text-indigo-500"/> Gestión de Usuarios (Vista SUPERADMIN)</h2>
                      <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar">
                        {users.map(u => (
                          <div key={u.username} className={`p-4 border rounded-2xl flex flex-col hover:bg-slate-50 transition-colors shadow-sm ${u.status === 'SUSPENDED' ? 'bg-slate-50 border-slate-200 opacity-75' : 'bg-white border-slate-200'}`}>
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="text-sm font-black text-slate-800 flex items-center gap-2">
                                  {u.full_name}
                                  {u.status === 'SUSPENDED' && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[8px] uppercase">Suspendido</span>}
                                </p>
                                <p className="text-[10px] font-mono text-slate-500 mt-0.5">@{u.username}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <select defaultValue={u.role} onChange={async (e) => {
                                  const res = await apiFetch(`${host}/api/system/promote`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requester:currentUser.username,username:u.username,newRole:e.target.value})});
                                  if(res.ok){showMsg(`✅ Rol de ${u.username} cambiado a ${e.target.value}`);fetchData();}else{const err=await res.json();showMsg(`⛔ ${err.error}`,true);}
                                }} className={`border rounded-xl px-3 py-1.5 text-[10px] font-black uppercase outline-none ${u.role==='SUPERADMIN'?'bg-red-50 text-red-700 border-red-200':u.role==='ADMIN'?'bg-orange-50 text-orange-700 border-orange-200':u.role==='EJECUTIVO_CUENTA'?'bg-teal-50 text-teal-700 border-teal-200':u.role==='AUDITOR'?'bg-blue-50 text-blue-700 border-blue-200':u.role==='CLIENTE'?'bg-cyan-50 text-cyan-700 border-cyan-200':'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                  <option value="CLIENTE">CLIENTE</option>
                                  <option value="PICKER">PICKER</option>
                                  <option value="JEFE_BODEGA">JEFE_BODEGA</option>
                                  <option value="EJECUTIVO_CUENTA">EJECUTIVO_CUENTA (Operario)</option>
                                  <option value="AUDITOR">AUDITOR</option>
                                  <option value="ADMIN">ADMIN</option>
                                  {u.username !== 'admin' && <option value="SUPERADMIN">SUPERADMIN</option>}
                                </select>
                                <button onClick={async () => {
                                  const newStatus = u.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
                                  const res = await apiFetch(`${host}/api/users`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u.username,full_name:u.full_name,role:u.role,status:newStatus,allowed_clients:u.allowed_clients,allowed_modules:u.allowed_modules})});
                                  if(res.ok){showMsg(`✅ Usuario ${newStatus==='SUSPENDED'?'suspendido':'activado'}`);fetchData();}
                                }} className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase transition-colors ${u.status==='SUSPENDED'?'bg-emerald-100 text-emerald-700 hover:bg-emerald-200':'bg-red-100 text-red-700 hover:bg-red-200'}`}>
                                  {u.status === 'SUSPENDED' ? '✓ Activar' : '✗ Suspender'}
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB: CONTRASEÑAS */}
                {superAdminTab === 'passwords' && (
                  <div className="bg-white rounded-[40px] border border-red-100 shadow-sm p-8">
                    <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
                      <div>
                        <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center"><Key className="w-5 h-5 mr-2 text-red-500"/> Resetear Contraseñas de Usuarios</h2>
                        <p className="text-[10px] text-slate-400 font-bold mt-1">Las contraseñas se almacenan con bcrypt — no son visibles. Usa este panel para asignar una nueva.</p>
                      </div>
                    </div>
                    <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar">
                      {users.filter(u => u.role !== 'DEMO').map(u => (
                        <div key={u.username} className="flex items-center gap-4 p-4 border border-slate-100 rounded-2xl hover:bg-slate-50">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-black text-slate-800">{u.full_name}</p>
                            <p className="text-[10px] font-mono text-slate-400">@{u.username} · <span className={u.role==='SUPERADMIN'?'text-red-600':u.role==='ADMIN'?'text-orange-600':'text-slate-500'}>{u.role}</span></p>
                          </div>
                          {resetPwTarget === u.username ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="password"
                                placeholder="Nueva contraseña (mín. 6)"
                                value={resetPwValue}
                                onChange={e => setResetPwValue(e.target.value)}
                                onKeyDown={async e => {
                                  if (e.key === 'Enter' && resetPwValue.length >= 6) {
                                    const res = await apiFetch(`${host}/api/system/users/reset-password`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username: u.username, new_password: resetPwValue }) });
                                    if (res.ok) { showMsg(`✅ Contraseña de @${u.username} actualizada`); setResetPwTarget(null); setResetPwValue(''); }
                                    else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
                                  }
                                }}
                                className="border-2 border-red-200 focus:border-red-400 rounded-xl px-3 py-2 text-xs font-bold outline-none w-48"
                                autoFocus
                              />
                              <button onClick={async () => {
                                if (resetPwValue.length < 6) return showMsg('⛔ Mínimo 6 caracteres', true);
                                const res = await apiFetch(`${host}/api/system/users/reset-password`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username: u.username, new_password: resetPwValue }) });
                                if (res.ok) { showMsg(`✅ Contraseña de @${u.username} actualizada`); setResetPwTarget(null); setResetPwValue(''); }
                                else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
                              }} className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-3 py-2 rounded-xl text-[10px] font-black uppercase">✓ Guardar</button>
                              <button onClick={() => { setResetPwTarget(null); setResetPwValue(''); }} className="bg-slate-100 text-slate-500 px-3 py-2 rounded-xl text-[10px] font-black">✗</button>
                            </div>
                          ) : (
                            <button onClick={() => { setResetPwTarget(u.username); setResetPwValue(''); }} className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1.5 shrink-0">
                              <Key size={11}/> Resetear
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* TAB: INVENTARIO DIRECTO */}
                {superAdminTab === 'inventory-sa' && (
                  <div className="bg-white rounded-[40px] border border-orange-100 shadow-sm p-8">
                    <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
                      <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center"><Database className="w-5 h-5 mr-2 text-orange-500"/> Eliminar LPNs Directamente</h2>
                      <span className="text-[9px] bg-orange-100 text-orange-700 px-2 py-1 rounded font-black uppercase border border-orange-200">⚠️ Irreversible</span>
                    </div>
                    <div className="overflow-x-auto max-h-80 overflow-y-auto custom-scrollbar">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 sticky top-0"><tr><th className="p-3 text-[9px] font-black text-slate-400 uppercase">LPN</th><th className="p-3 text-[9px] font-black text-slate-400 uppercase">SKU</th><th className="p-3 text-[9px] font-black text-slate-400 uppercase">Ubicación</th><th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Qty</th><th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Eliminar</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {safeData.slice(0,50).map(i => (
                            <tr key={i.id} className="hover:bg-orange-50">
                              <td className="p-3 font-mono text-[10px] font-black text-slate-600">{i.id}</td>
                              <td className="p-3 text-xs font-black text-slate-800 uppercase">{i.sku}</td>
                              <td className="p-3 text-[10px] font-mono text-slate-500">{i.location_id || 'PISO-RECEPCION'}</td>
                              <td className="p-3 text-center font-black text-slate-800">{i.qty}</td>
                              <td className="p-3 text-center">
                                <button onClick={async () => { if (!(await confirm({ message: `⚠️ ¿Eliminar LPN ${i.id}?`, danger: true }))) return; const res = await apiFetch(`${host}/api/system/inventory/${i.id}`, { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({requester: currentUser.username}) }); if (res.ok) { showMsg(`✅ LPN eliminado`); fetchData(); } else { const e = await res.json(); showMsg(`⛔ ${e.error}`, true); } }} className="bg-red-100 hover:bg-red-200 text-red-700 p-2 rounded-lg"><Trash2 size={12}/></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* TAB: LOGS */}
                {superAdminTab === 'audit-sa' && (
                  <div className="bg-white rounded-[40px] border border-purple-100 shadow-sm p-8">
                    <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
                      <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center"><History className="w-5 h-5 mr-2 text-purple-500"/> Gestión de Logs</h2>
                      <button onClick={async () => { if (!(await confirm({ message: '⚠️ ¿TRUNCAR TODOS LOS LOGS?', danger: true }))) return; const res = await apiFetch(`${host}/api/system/audit`, { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({requester: currentUser.username}) }); if (res.ok) { showMsg('✅ Logs eliminados'); fetchData(); } }} className="bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2"><Trash2 size={12}/> Limpiar Todo</button>
                    </div>
                    <div className="overflow-x-auto max-h-80 overflow-y-auto custom-scrollbar">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 sticky top-0"><tr><th className="p-3 text-[9px] font-black text-slate-400 uppercase">Fecha</th><th className="p-3 text-[9px] font-black text-slate-400 uppercase">Tipo</th><th className="p-3 text-[9px] font-black text-slate-400 uppercase">SKU</th><th className="p-3 text-[9px] font-black text-slate-400 uppercase">Glosa</th><th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Acc.</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {auditLogs.slice(0,50).map(log => (
                            <tr key={log.id} className="hover:bg-purple-50">
                              <td className="p-3 text-[9px] text-slate-500">{new Date(log.created_at).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})}</td>
                              <td className="p-3"><span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${log.type==='INBOUND'||log.type==='ADJUST_IN'?'bg-emerald-100 text-emerald-700':log.type==='OUTBOUND'||log.type==='ADJUST_OUT'?'bg-red-100 text-red-700':'bg-purple-100 text-purple-700'}`}>{log.type}</span></td>
                              <td className="p-3 text-xs font-black text-slate-700 uppercase">{log.sku}</td>
                              <td className="p-3 text-[10px] text-slate-500 max-w-[200px]">
                                {editingAuditLog === log.id ? (
                                  <div className="flex gap-1">
                                    <input type="text" value={editingAuditGlosa} onChange={e=>setEditingAuditGlosa(e.target.value)} className="flex-1 border border-purple-300 rounded px-2 py-1 text-[10px] outline-none"/>
                                    <button onClick={async () => { const res = await apiFetch(`${host}/api/system/audit/${log.id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({requester: currentUser.username, glosa: editingAuditGlosa}) }); if (res.ok) { showMsg('✅ Editado'); setEditingAuditLog(null); fetchData(); } }} className="bg-emerald-100 text-emerald-700 px-2 rounded text-[9px] font-black">✓</button>
                                    <button onClick={()=>setEditingAuditLog(null)} className="bg-slate-100 text-slate-600 px-2 rounded text-[9px] font-black">✗</button>
                                  </div>
                                ) : <span className="truncate block">{log.glosa || '-'}</span>}
                              </td>
                              <td className="p-3 text-center">
                                <div className="flex gap-1 justify-center">
                                  <button onClick={() => { setEditingAuditLog(log.id); setEditingAuditGlosa(log.glosa || ''); }} className="bg-purple-100 text-purple-700 p-1.5 rounded-lg"><Pencil size={11}/></button>
                                  <button onClick={async () => { if (!(await confirm({ message: `¿Eliminar?`, danger: true }))) return; const res = await apiFetch(`${host}/api/system/audit/${log.id}`, { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({requester: currentUser.username}) }); if (res.ok) { showMsg('✅ Eliminado'); fetchData(); } }} className="bg-red-100 text-red-700 p-1.5 rounded-lg"><Trash2 size={11}/></button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* TAB: BACKUPS */}
                {superAdminTab === 'backups' && (() => {
                  const fmtBytes = (b) => {
                    const n = parseInt(b) || 0;
                    if (n > 1024*1024) return (n/1024/1024).toFixed(2) + ' MB';
                    if (n > 1024) return (n/1024).toFixed(1) + ' KB';
                    return n + ' B';
                  };
                  const fmtAge = (h) => {
                    if (h < 1) return `hace ${Math.round(h*60)} min`;
                    if (h < 24) return `hace ${Math.round(h)} h`;
                    return `hace ${Math.round(h/24)} días`;
                  };
                  const refreshList = async () => {
                    const r = await apiFetch(`${host}/api/system/backups`);
                    setBackupsList(r.ok ? await r.json() : []);
                  };
                  const triggerBadge = (t) => {
                    if (t === 'SCHEDULED')   return { cls: 'bg-blue-100 text-blue-700 border-blue-200',     label: 'Automático' };
                    if (t === 'MANUAL')      return { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Manual' };
                    if (t === 'PRE_RESTORE') return { cls: 'bg-amber-100 text-amber-700 border-amber-200',   label: 'Pre-Restauración' };
                    if (t === 'UPLOAD')      return { cls: 'bg-purple-100 text-purple-700 border-purple-200', label: 'Carga externa' };
                    return { cls: 'bg-slate-100 text-slate-600 border-slate-200', label: t || '—' };
                  };
                  const lastOk = backupsList.find(b => b.status === 'OK');
                  const handleCreate = async () => {
                    setBackupBusy(true); setBackupError('');
                    try {
                      const r = await apiFetch(`${host}/api/system/backup`, { method: 'POST' });
                      const d = await r.json();
                      if (!r.ok) { setBackupError(d.error || 'Error al crear backup'); return; }
                      showMsg(`✅ Backup creado: ${d.filename} (${fmtBytes(d.size_bytes)})`);
                      await refreshList();
                    } catch (e) { setBackupError('Error de red al crear backup'); }
                    finally { setBackupBusy(false); }
                  };
                  const handleDownload = async (b) => {
                    try {
                      const r = await apiFetch(`${host}/api/system/backups/${b.id}/download`);
                      if (!r.ok) { showMsg('⛔ No se pudo descargar el backup', true); return; }
                      const blob = await r.blob();
                      const url  = URL.createObjectURL(blob);
                      const a    = document.createElement('a');
                      a.href     = url;
                      a.download = b.filename || `backup_${b.id}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (e) { showMsg('⛔ Error de red al descargar backup', true); }
                  };
                  const handleRestore = async (b) => {
                    const ok = await confirm({
                      title: '⚠ Restaurar Sistema',
                      message: `Esta acción reemplazará TODOS los datos actuales con el backup del ${new Date(b.created_at).toLocaleString('es-CL')}. Se creará un backup automático de seguridad antes de restaurar. Esta acción no se puede deshacer.`,
                      confirmText: 'Sí, restaurar',
                      danger: true,
                    });
                    if (!ok) return;
                    setBackupRestoring(true); setBackupError('');
                    try {
                      const r = await apiFetch(`${host}/api/system/backups/${b.id}/restore`, { method: 'POST' });
                      const d = await r.json();
                      if (!r.ok) { setBackupError(d.error || 'Error al restaurar'); return; }
                      showMsg(`✅ Restauración completa: ${d.restored_tables.length} tablas, ${d.rows_inserted} filas, ${d.duration_ms}ms`);
                      await refreshList();
                      fetchData();
                    } catch (e) { setBackupError('Error de red al restaurar'); }
                    finally { setBackupRestoring(false); }
                  };
                  const handleDelete = async (b) => {
                    const ok = await confirm({
                      message: `¿Eliminar el backup ${b.filename}? El archivo físico también se borrará.`,
                      danger: true,
                    });
                    if (!ok) return;
                    const r = await apiFetch(`${host}/api/system/backups/${b.id}`, { method: 'DELETE' });
                    const d = await r.json();
                    if (!r.ok) { setBackupError(d.error || 'Error al eliminar'); return; }
                    await refreshList();
                  };

                  const handleUpload = async (file) => {
                    if (!file) return;
                    setBackupBusy(true); setBackupError('');
                    try {
                      const text = await file.text();
                      try { JSON.parse(text); } catch { setBackupError('El archivo no es JSON válido.'); return; }
                      const r = await apiFetch(`${host}/api/system/backups/upload`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body: text,
                      });
                      const d = await r.json();
                      if (!r.ok) { setBackupError(d.error || 'Error al cargar el backup'); return; }
                      showMsg(`✅ Backup cargado: ${d.filename}`);
                      await refreshList();
                    } catch { setBackupError('Error de red al cargar el backup'); }
                    finally { setBackupBusy(false); }
                  };

                  return (
                    <div className="bg-white rounded-[40px] border border-emerald-100 shadow-sm p-8 relative">
                      {backupRestoring && (
                        <div className="absolute inset-0 bg-white/90 backdrop-blur-sm z-40 flex flex-col items-center justify-center rounded-[40px]">
                          <Loader2 className="w-12 h-12 text-amber-500 animate-spin mb-4"/>
                          <p className="text-lg font-black text-slate-800 uppercase">Restaurando...</p>
                          <p className="text-xs font-bold text-amber-600 mt-2">No cerrar esta ventana</p>
                        </div>
                      )}
                      <div className="flex items-start justify-between mb-6 border-b border-slate-100 pb-4 flex-wrap gap-3">
                        <div>
                          <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                            <Database className="w-5 h-5 text-emerald-500"/> Backups del Sistema
                            <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[9px] font-black uppercase">Solo SUPERADMIN</span>
                          </h2>
                          <p className="text-xs text-slate-500 mt-1">Puntos de restauración ante fallas críticas. Backup automático diario a las 3:00 AM.</p>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <button onClick={refreshList} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2"><RefreshCcw size={12}/> Actualizar</button>
                          <label className={`cursor-pointer bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 ${backupBusy ? 'opacity-50 pointer-events-none' : ''}`} title="Cargar un archivo .json de backup externo">
                            <Upload size={12}/> Cargar backup externo
                            <input type="file" accept=".json,application/json" className="hidden" onChange={e => { if (e.target.files[0]) { handleUpload(e.target.files[0]); e.target.value = ''; }}}/>
                          </label>
                          <button onClick={handleCreate} disabled={backupBusy} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 disabled:opacity-50">
                            {backupBusy ? <Loader2 size={12} className="animate-spin"/> : <Database size={12}/>}
                            {backupBusy ? 'Procesando...' : 'Crear Backup Manual'}
                          </button>
                        </div>
                      </div>

                      {backupError && (
                        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm font-bold text-red-700 mb-4">
                          ⛔ {backupError}
                        </div>
                      )}

                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Fecha / Hora</th>
                              <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Tipo</th>
                              <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Tablas</th>
                              <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Tamaño</th>
                              <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Creado por</th>
                              <th className="p-3 text-[9px] font-black text-slate-400 uppercase text-center">Acciones</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {backupsList.length === 0 && (
                              <tr><td colSpan="6" className="p-8 text-center text-slate-400 text-sm">No hay backups todavía. Crea uno manual o espera al próximo automático.</td></tr>
                            )}
                            {backupsList.map(b => {
                              const tb = triggerBadge(b.trigger);
                              const tableCount = b.tables ? Object.keys(b.tables).length : 0;
                              const tablesTip = b.tables ? Object.entries(b.tables).map(([k,v])=>`${k}: ${v}`).join('\n') : '';
                              return (
                                <tr key={b.id} className="hover:bg-emerald-50/40">
                                  <td className="p-3">
                                    <p className="text-xs font-black text-slate-800">{new Date(b.created_at).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                                    <p className="text-[9px] text-slate-400 font-bold">{fmtAge(b.age_hours)}</p>
                                  </td>
                                  <td className="p-3"><span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${tb.cls}`}>{tb.label}</span></td>
                                  <td className="p-3"><span title={tablesTip} className="text-xs font-bold text-slate-700 cursor-help underline decoration-dotted">{tableCount} tablas</span></td>
                                  <td className="p-3 text-xs font-mono font-bold text-slate-700">{fmtBytes(b.size_bytes)}</td>
                                  <td className="p-3 text-xs font-bold text-slate-600">@{b.created_by || '—'}</td>
                                  <td className="p-3 text-center">
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button onClick={()=>handleDownload(b)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 p-2 rounded-lg" title="Descargar"><Download size={12}/></button>
                                      <button onClick={()=>handleRestore(b)} disabled={backupRestoring} className="bg-amber-100 hover:bg-amber-200 text-amber-700 p-2 rounded-lg disabled:opacity-50" title="Restaurar"><RefreshCcw size={12}/></button>
                                      <button onClick={()=>handleDelete(b)} disabled={b.id === lastOk?.id} className="bg-red-100 hover:bg-red-200 text-red-700 p-2 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed" title={b.id===lastOk?.id ? 'No se puede eliminar el más reciente' : 'Eliminar'}><Trash2 size={12}/></button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100 text-[10px] font-bold text-slate-500">
                        <p>📅 Próximo backup automático: <strong className="text-emerald-600">hoy a las 03:00 AM</strong></p>
                        <p>{lastOk ? <>Último backup exitoso: <strong className="text-slate-700">{fmtAge(lastOk.age_hours)}</strong></> : 'Sin backups exitosos aún'}</p>
                      </div>
                    </div>
                  );
                })()}

                {/* TAB: FEEDBACK / MEJORAS */}
                {superAdminTab === 'feedback' && (() => {
                  const refreshList = async (filt = feedbackFilter) => {
                    const qs = new URLSearchParams();
                    if (filt.status) qs.set('status', filt.status);
                    if (filt.category) qs.set('category', filt.category);
                    const r = await apiFetch(`${host}/api/feedback${qs.toString() ? '?' + qs.toString() : ''}`);
                    if (r.ok) setFeedbackList(await r.json());
                  };
                  const catBadge = (c) => {
                    if (c === 'BUG') return 'bg-red-100 text-red-700 border-red-200';
                    if (c === 'IDEA') return 'bg-indigo-100 text-indigo-700 border-indigo-200';
                    return 'bg-amber-100 text-amber-700 border-amber-200';
                  };
                  const statusBadge = (s) => {
                    if (s === 'NUEVO') return 'bg-blue-100 text-blue-700 border-blue-200';
                    if (s === 'EN_REVISION') return 'bg-amber-100 text-amber-700 border-amber-200';
                    if (s === 'RESUELTO') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
                    return 'bg-slate-100 text-slate-600 border-slate-200';
                  };
                  const handleStatusChange = async (id, status) => {
                    const r = await apiFetch(`${host}/api/feedback/${id}/status`, { method: 'PATCH', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ status }) });
                    if (r.ok) refreshList();
                  };
                  const handleDelete = async (id) => {
                    if (!(await confirm({ message: '¿Eliminar este feedback?', danger: true }))) return;
                    const r = await apiFetch(`${host}/api/feedback/${id}`, { method: 'DELETE' });
                    if (r.ok) refreshList();
                  };
                  const counters = {
                    total: feedbackList.length,
                    nuevo: feedbackList.filter(f => f.status === 'NUEVO').length,
                    enRev: feedbackList.filter(f => f.status === 'EN_REVISION').length,
                    resu: feedbackList.filter(f => f.status === 'RESUELTO').length,
                  };
                  return (
                    <div className="bg-white rounded-[40px] border border-amber-100 shadow-sm p-8">
                      <div className="flex items-start justify-between mb-6 border-b border-slate-100 pb-4 flex-wrap gap-3">
                        <div>
                          <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                            <Lightbulb className="w-5 h-5 text-amber-500"/> Sugerencias del Staff
                          </h2>
                          <p className="text-xs text-slate-500 mt-1">Bugs, mejoras e ideas enviadas por usuarios ADMIN / EJECUTIVO / SUPERVISOR.</p>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <span className="text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-700 px-3 py-2 rounded-xl">Total: {counters.total}</span>
                          <span className="text-[9px] font-black uppercase tracking-widest bg-blue-100 text-blue-700 px-3 py-2 rounded-xl">Nuevos: {counters.nuevo}</span>
                          <span className="text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-700 px-3 py-2 rounded-xl">En Revisión: {counters.enRev}</span>
                          <span className="text-[9px] font-black uppercase tracking-widest bg-emerald-100 text-emerald-700 px-3 py-2 rounded-xl">Resueltos: {counters.resu}</span>
                        </div>
                      </div>

                      {/* Filtros */}
                      <div className="flex gap-3 mb-4 flex-wrap">
                        <select value={feedbackFilter.status} onChange={e=>{const nf={...feedbackFilter,status:e.target.value};setFeedbackFilter(nf);refreshList(nf);}} className="border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold bg-white outline-none focus:border-amber-500">
                          <option value="">Todos los estados</option>
                          <option value="NUEVO">Nuevos</option>
                          <option value="EN_REVISION">En revisión</option>
                          <option value="RESUELTO">Resueltos</option>
                        </select>
                        <select value={feedbackFilter.category} onChange={e=>{const nf={...feedbackFilter,category:e.target.value};setFeedbackFilter(nf);refreshList(nf);}} className="border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold bg-white outline-none focus:border-amber-500">
                          <option value="">Todas las categorías</option>
                          <option value="BUG">🐛 Bug</option>
                          <option value="MEJORA">💡 Mejora</option>
                          <option value="IDEA">✨ Idea</option>
                        </select>
                        <button onClick={()=>refreshList()} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2"><RefreshCcw size={12}/> Recargar</button>
                      </div>

                      {/* Lista */}
                      <div className="space-y-3">
                        {feedbackList.length === 0 && (
                          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm">
                            Sin sugerencias por ahora.
                          </div>
                        )}
                        {feedbackList.map(f => (
                          <div key={f.id} className="bg-white border border-slate-200 rounded-2xl p-4 hover:shadow-sm transition-shadow">
                            <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${catBadge(f.category)}`}>{f.category}</span>
                                <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${statusBadge(f.status)}`}>{f.status}</span>
                                {f.page && <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[9px] font-mono">{f.page}</span>}
                                <span className="text-[10px] text-slate-500 font-bold">de <span className="font-mono text-indigo-700">@{f.username}</span> ({f.role})</span>
                              </div>
                              <span className="text-[9px] font-bold text-slate-400">{new Date(f.created_at).toLocaleString('es-CL')}</span>
                            </div>
                            <p className="text-sm text-slate-700 font-medium whitespace-pre-wrap">{f.message}</p>
                            {f.resolved_by && f.resolved_at && (
                              <p className="text-[10px] text-emerald-600 font-bold mt-2">✓ Resuelto por @{f.resolved_by} · {new Date(f.resolved_at).toLocaleString('es-CL')}</p>
                            )}
                            <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                              {f.status !== 'EN_REVISION' && <button onClick={()=>handleStatusChange(f.id,'EN_REVISION')} className="bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-[9px] font-black px-3 py-1.5 rounded-xl uppercase">→ En Revisión</button>}
                              {f.status !== 'RESUELTO' && <button onClick={()=>handleStatusChange(f.id,'RESUELTO')} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[9px] font-black px-3 py-1.5 rounded-xl uppercase">✓ Resolver</button>}
                              {f.status !== 'NUEVO' && <button onClick={()=>handleStatusChange(f.id,'NUEVO')} className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[9px] font-black px-3 py-1.5 rounded-xl uppercase">↺ Nuevo</button>}
                              <button onClick={()=>handleDelete(f.id)} className="ml-auto bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-[9px] font-black px-3 py-1.5 rounded-xl uppercase flex items-center gap-1"><Trash2 size={10}/> Eliminar</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

              </div>
            )}

            {/* CHANGE STATUS */}
            {activeTab === 'change-status' && (
              <Suspense fallback={<TabLoader />}>
                <ChangeStatusTab
                  relSearchTerm={relSearchTerm}
                  setRelSearchTerm={setRelSearchTerm}
                  filteredRelData={filteredRelData}
                  lpnStatuses={lpnStatuses}
                  setLpnStatuses={setLpnStatuses}
                  glosas={glosas}
                  setGlosas={setGlosas}
                  statuses={statuses}
                  getStatusBadge={getStatusBadge}
                  handleChangeStatus={handleChangeStatus}
                />
              </Suspense>
            )}

          {/* ═══════════════ PROGRAMACIÓN DE SALIDAS ═══════════════ */}
          {activeTab === 'dispatch-schedule' && (() => {
            const DS_STATUS = [
              { id: 'PROGRAMADO',  label: 'Programado',  color: 'bg-teal-100 text-teal-700 border-teal-200' },
              { id: 'CONFIRMADO',  label: 'Confirmado',  color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
              { id: 'DESPACHADO',  label: 'Despachado',  color: 'bg-blue-100 text-blue-700 border-blue-200' },
              { id: 'CANCELADO',   label: 'Cancelado',   color: 'bg-red-100 text-red-700 border-red-200' },
            ];
            const getStatusColor = (s) => DS_STATUS.find(x=>x.id===s)?.color || 'bg-slate-100 text-slate-600 border-slate-200';
            const todayStr = new Date().toISOString().slice(0,10);
            const isSup = ['JEFE_BODEGA','ADMIN','SUPERADMIN'].includes(currentUser?.role);

            const filtered = dispatchSchedules.filter(d => {
              if (dsStatusFilter && d.status !== dsStatusFilter) return false;
              if (dsDateFilter && d.scheduled_date !== dsDateFilter) return false;
              return true;
            });

            const handleDsSave = async (e) => {
              e.preventDefault();
              const method = dsEditId ? 'PATCH' : 'POST';
              const url = dsEditId ? `${host}/api/dispatch-schedules/${dsEditId}` : `${host}/api/dispatch-schedules`;
              const dsPayload = { ...dsForm };
              if ((!is3PLMode || isHybridMode) && !dsPayload.client_id) dsPayload.client_id = systemConfig.own_client_id || 'PROPIO';
              const res = await apiFetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(dsPayload) });
              if (res.ok) {
                showMsg(dsEditId ? '✅ Programación actualizada' : '✅ Salida programada');
                setDsForm({ doc_num:'', client_id:'', doc_type:'', glosa:'', scheduled_date:'', scheduled_time:'', carrier:'', destination:'', notes:'' });
                setDsEditId(null);
                fetchData();
              } else {
                const err = await res.json();
                showMsg(`⛔ ${err.error}`, true);
              }
            };

            const handleDsConfirm = async (id) => {
              const res = await apiFetch(`${host}/api/dispatch-schedules/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status: 'CONFIRMADO' }) });
              if (res.ok) { showMsg('✅ Fecha de salida confirmada'); fetchData(); }
              else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
            };

            const handleDsMarkDispatched = async (id) => {
              const res = await apiFetch(`${host}/api/dispatch-schedules/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status: 'DESPACHADO' }) });
              if (res.ok) { showMsg('✅ Marcado como despachado'); fetchData(); }
              else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
            };

            const handleDsCancel = async (id) => {
              if (!(await confirm({ message: '¿Cancelar esta programación?', danger: true }))) return;
              const res = await apiFetch(`${host}/api/dispatch-schedules/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status: 'CANCELADO' }) });
              if (res.ok) { showMsg('Programación cancelada'); fetchData(); }
              else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
            };

            const handleDsDelete = async (id) => {
              if (!(await confirm({ message: '¿Eliminar esta programación definitivamente?', danger: true }))) return;
              const res = await apiFetch(`${host}/api/dispatch-schedules/${id}`, { method:'DELETE' });
              if (res.ok) { showMsg('✅ Eliminado'); fetchData(); }
              else { const err = await res.json(); showMsg(`⛔ ${err.error}`, true); }
            };

            const handleDsEdit = (d) => {
              setDsForm({
                doc_num: d.doc_num, client_id: d.client_id||'', doc_type: d.doc_type||'', glosa: d.glosa||'',
                scheduled_date: d.scheduled_date?.slice(0,10)||'', scheduled_time: d.scheduled_time||'',
                carrier: d.carrier||'', destination: d.destination||'', notes: d.notes||''
              });
              setDsEditId(d.id);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            };

            // Estadísticas rápidas
            const statsToday = dispatchSchedules.filter(d => d.scheduled_date?.slice(0,10) === todayStr);
            const statsPending = dispatchSchedules.filter(d => d.status === 'PROGRAMADO').length;
            const statsConfirmed = dispatchSchedules.filter(d => d.status === 'CONFIRMADO').length;

            return (
              <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                      <CalendarClock className="text-teal-500"/> Programación de Salidas
                    </h1>
                    <p className="text-xs text-slate-500 mt-1">Asigna y confirma fechas de salida para documentos de despacho</p>
                  </div>
                  {/* KPIs rápidos */}
                  <div className="flex gap-3 flex-wrap">
                    <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm text-center min-w-[100px]">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Hoy</p>
                      <p className="text-2xl font-black text-teal-600">{statsToday.length}</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm text-center min-w-[100px]">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Por Confirmar</p>
                      <p className="text-2xl font-black text-amber-600">{statsPending}</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm text-center min-w-[100px]">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Confirmados</p>
                      <p className="text-2xl font-black text-emerald-600">{statsConfirmed}</p>
                    </div>
                  </div>
                </div>

                <div className={`grid grid-cols-1 ${isSup ? 'lg:grid-cols-5' : ''} gap-6`}>
                  {/* Formulario — solo SUPERVISOR+ */}
                  {isSup && <div className="lg:col-span-2">
                    <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm p-6 space-y-4 sticky top-4">
                      <div>
                        <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                          <CalendarClock size={16} className="text-teal-500"/>
                          {dsEditId ? 'Editar Programación' : 'Nueva Programación de Salida'}
                        </h2>
                        {dsEditId && (
                          <p className="text-[9px] text-amber-600 font-bold uppercase mt-1">Editando — ID: {dsEditId}</p>
                        )}
                      </div>
                      <form onSubmit={handleDsSave} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1 col-span-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase">N° Documento Despacho *</label>
                            <input required type="text" value={dsForm.doc_num} onChange={e=>setDsForm({...dsForm, doc_num: e.target.value.toUpperCase()})}
                              placeholder="Ej: DSP-2024-001"
                              className="w-full border-2 border-slate-200 focus:border-teal-400 rounded-xl px-3 py-2.5 text-sm font-black uppercase outline-none transition-colors"/>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-black text-slate-400 uppercase">Cliente</label>
                            {is3PLMode ? (
                              <select value={dsForm.client_id} onChange={e=>setDsForm({...dsForm, client_id: e.target.value})}
                                className="w-full border-2 border-slate-200 focus:border-teal-400 rounded-xl px-3 py-2.5 text-xs font-bold bg-white outline-none transition-colors">
                                <option value="">-- Sin asignar --</option>
                                {clients.map(c=><option key={c.id} value={c.id}>{c.id} - {c.name}</option>)}
                              </select>
                            ) : (
                              <div className="w-full border-2 border-emerald-200 bg-emerald-50 rounded-xl px-3 py-2.5 text-xs font-black text-emerald-700 flex items-center gap-2">
                                <Package size={12} className="text-emerald-500 shrink-0"/>{systemConfig.own_client_name || 'Bodega Propia'}
                              </div>
                            )}
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-black text-slate-400 uppercase">Tipo Doc</label>
                            <select value={dsForm.doc_type} onChange={e=>setDsForm({...dsForm, doc_type: e.target.value})}
                              className="w-full border-2 border-slate-200 focus:border-teal-400 rounded-xl px-3 py-2.5 text-xs font-bold bg-white outline-none transition-colors">
                              <option value="">-- Tipo --</option>
                              {documentTypes.map(dt=><option key={dt.id} value={dt.id}>{dt.id}</option>)}
                            </select>
                          </div>
                          <div className="space-y-1 col-span-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase">Glosa / Descripción</label>
                            <input type="text" value={dsForm.glosa} onChange={e=>setDsForm({...dsForm, glosa: e.target.value})}
                              placeholder="Ej: Entrega tienda norte"
                              className="w-full border-2 border-slate-200 focus:border-teal-400 rounded-xl px-3 py-2.5 text-sm font-bold outline-none transition-colors"/>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-black text-teal-600 uppercase flex items-center gap-1"><CalendarClock size={10}/> Fecha de Salida *</label>
                            <input required type="date" value={dsForm.scheduled_date} onChange={e=>setDsForm({...dsForm, scheduled_date: e.target.value})}
                              min={todayStr}
                              className="w-full border-2 border-teal-200 focus:border-teal-500 rounded-xl px-3 py-2.5 text-sm font-black outline-none transition-colors bg-teal-50"/>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-black text-teal-600 uppercase flex items-center gap-1"><Clock size={10}/> Hora de Salida</label>
                            <input type="time" value={dsForm.scheduled_time} onChange={e=>setDsForm({...dsForm, scheduled_time: e.target.value})}
                              className="w-full border-2 border-teal-200 focus:border-teal-500 rounded-xl px-3 py-2.5 text-sm font-black outline-none transition-colors bg-teal-50"/>
                          </div>
                          <div className="space-y-1 col-span-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase">Transportista / Carrier</label>
                            <input type="text" value={dsForm.carrier} onChange={e=>setDsForm({...dsForm, carrier: e.target.value})}
                              placeholder="Nombre transportista o placa"
                              className="w-full border-2 border-slate-200 focus:border-teal-400 rounded-xl px-3 py-2.5 text-sm font-bold outline-none transition-colors"/>
                          </div>
                          <div className="space-y-1 col-span-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase">Destino / Dirección</label>
                            <input type="text" value={dsForm.destination} onChange={e=>setDsForm({...dsForm, destination: e.target.value})}
                              placeholder="Dirección o lugar de entrega"
                              className="w-full border-2 border-slate-200 focus:border-teal-400 rounded-xl px-3 py-2.5 text-sm font-bold outline-none transition-colors"/>
                          </div>
                          <div className="space-y-1 col-span-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase">Notas adicionales</label>
                            <textarea value={dsForm.notes} onChange={e=>setDsForm({...dsForm, notes: e.target.value})}
                              placeholder="Instrucciones especiales, contacto, etc."
                              rows={2}
                              className="w-full border-2 border-slate-200 focus:border-teal-400 rounded-xl px-3 py-2.5 text-sm font-medium outline-none transition-colors resize-none"/>
                          </div>
                        </div>
                        <div className="flex gap-3 pt-2">
                          <button type="submit"
                            className={`flex-[2] text-white font-black py-3 rounded-2xl shadow-lg uppercase text-xs tracking-widest transition-colors ${dsEditId ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' : 'bg-teal-600 hover:bg-teal-700 shadow-teal-200'}`}>
                            {dsEditId ? 'Actualizar' : 'Programar Salida'}
                          </button>
                          {dsEditId && (
                            <button type="button" onClick={()=>{setDsForm({doc_num:'',client_id:'',doc_type:'',glosa:'',scheduled_date:'',scheduled_time:'',carrier:'',destination:'',notes:''});setDsEditId(null);}}
                              className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-black py-3 rounded-2xl shadow-sm uppercase text-xs tracking-widest transition-colors">
                              Cancelar
                            </button>
                          )}
                        </div>
                      </form>
                    </div>
                  </div>}

                  {/* Lista */}
                  <div className="lg:col-span-3 space-y-4">
                    {/* Filtros */}
                    <div className="flex gap-2 flex-wrap items-center">
                      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
                        {[{id:'',label:'Todos'}, ...DS_STATUS].map(s=>(
                          <button key={s.id} onClick={()=>setDsStatusFilter(s.id)}
                            className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${dsStatusFilter===s.id?'bg-white text-teal-700 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>
                            {s.label}
                          </button>
                        ))}
                      </div>
                      <input type="date" value={dsDateFilter} onChange={e=>setDsDateFilter(e.target.value)}
                        className="border-2 border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold outline-none focus:border-teal-400 transition-colors"/>
                      {dsDateFilter && (
                        <button onClick={()=>setDsDateFilter('')} className="text-red-400 hover:text-red-600 transition-colors"><X size={14}/></button>
                      )}
                      <span className="text-[10px] font-black text-slate-400 uppercase ml-auto">{filtered.length} resultado(s)</span>
                    </div>

                    {/* Tarjetas */}
                    {filtered.length === 0 ? (
                      <div className="bg-white rounded-3xl border-2 border-dashed border-slate-200 p-16 flex flex-col items-center justify-center text-center">
                        <CalendarClock className="w-14 h-14 text-slate-200 mb-4"/>
                        <p className="font-black text-slate-400 uppercase tracking-tighter">Sin programaciones</p>
                        <p className="text-xs text-slate-400 mt-1">Crea la primera salida usando el formulario</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {filtered.map(d => {
                          const isToday = d.scheduled_date?.slice(0,10) === todayStr;
                          const isPast = d.scheduled_date?.slice(0,10) < todayStr && d.status === 'PROGRAMADO';
                          const clientName = clients.find(c=>c.id===d.client_id)?.name;
                          return (
                            <div key={d.id} className={`bg-white rounded-2xl border-2 shadow-sm overflow-hidden transition-all ${isPast ? 'border-red-200 bg-red-50/30' : isToday && d.status==='PROGRAMADO' ? 'border-teal-300' : isToday && d.status==='CONFIRMADO' ? 'border-emerald-300' : 'border-slate-200'}`}>
                              {/* Banner de alerta */}
                              {isPast && (
                                <div className="bg-red-500 px-4 py-1.5 flex items-center gap-2">
                                  <AlertTriangle size={12} className="text-white"/>
                                  <p className="text-[9px] font-black text-white uppercase tracking-widest">Fecha vencida — pendiente de despacho</p>
                                </div>
                              )}
                              {isToday && d.status === 'PROGRAMADO' && (
                                <div className="bg-teal-500 px-4 py-1.5 flex items-center gap-2">
                                  <CalendarClock size={12} className="text-white"/>
                                  <p className="text-[9px] font-black text-white uppercase tracking-widest">Programado para HOY — pendiente confirmar</p>
                                </div>
                              )}
                              {isToday && d.status === 'CONFIRMADO' && (
                                <div className="bg-emerald-500 px-4 py-1.5 flex items-center gap-2">
                                  <CheckCircle2 size={12} className="text-white"/>
                                  <p className="text-[9px] font-black text-white uppercase tracking-widest">Confirmado para HOY — listo para despachar</p>
                                </div>
                              )}
                              <div className="p-4">
                                <div className="flex items-start justify-between gap-3 mb-3">
                                  <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-mono text-base font-black text-slate-800">{d.doc_num}</span>
                                      {d.doc_type && <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[9px] font-black uppercase">{d.doc_type}</span>}
                                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border ${getStatusColor(d.status)}`}>{d.status}</span>
                                    </div>
                                    {d.glosa && <p className="text-xs text-slate-600 mt-0.5">{d.glosa}</p>}
                                    {clientName && <p className="text-[10px] text-indigo-600 font-bold mt-0.5 flex items-center gap-1"><Building2 size={10}/>{clientName}</p>}
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-[9px] font-black text-slate-400 uppercase">Salida</p>
                                    <p className={`text-lg font-black ${isPast ? 'text-red-600' : 'text-teal-700'}`}>
                                      {new Date(d.scheduled_date + 'T12:00:00').toLocaleDateString('es-CL', {day:'2-digit',month:'short',year:'numeric'})}
                                    </p>
                                    {d.scheduled_time && (
                                      <p className="text-[10px] font-black text-slate-500 flex items-center justify-end gap-1">
                                        <Clock size={9}/> {d.scheduled_time.slice(0,5)}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                {/* Detalles secundarios */}
                                <div className="grid grid-cols-2 gap-2 mb-3">
                                  {d.carrier && (
                                    <div className="bg-slate-50 rounded-xl px-3 py-2 flex items-center gap-2">
                                      <Truck size={12} className="text-slate-400 shrink-0"/>
                                      <p className="text-[10px] font-bold text-slate-600 truncate">{d.carrier}</p>
                                    </div>
                                  )}
                                  {d.destination && (
                                    <div className="bg-slate-50 rounded-xl px-3 py-2 flex items-center gap-2">
                                      <MapIcon size={12} className="text-slate-400 shrink-0"/>
                                      <p className="text-[10px] font-bold text-slate-600 truncate">{d.destination}</p>
                                    </div>
                                  )}
                                </div>
                                {d.notes && (
                                  <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mb-3">
                                    <p className="text-[10px] text-amber-700 italic">"{d.notes}"</p>
                                  </div>
                                )}

                                {/* Footer */}
                                <div className="flex items-center justify-between border-t border-slate-100 pt-3 flex-wrap gap-2">
                                  <div className="text-[9px] text-slate-400">
                                    <span>Creado por <strong className="text-slate-600">{d.created_by}</strong> · {new Date(d.created_at).toLocaleDateString('es-CL')}</span>
                                    {d.confirmed_by && <span className="ml-2">· Confirmado por <strong className="text-emerald-600">{d.confirmed_by}</strong></span>}
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {isSup && d.status === 'PROGRAMADO' && (
                                      <button onClick={()=>handleDsConfirm(d.id)}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-black px-3 py-1.5 rounded-xl uppercase flex items-center gap-1 shadow-sm transition-colors">
                                        <CheckCircle2 size={11}/> Confirmar Fecha
                                      </button>
                                    )}
                                    {isSup && d.status === 'CONFIRMADO' && (
                                      <button onClick={()=>handleDsMarkDispatched(d.id)}
                                        className="bg-blue-600 hover:bg-blue-700 text-white text-[9px] font-black px-3 py-1.5 rounded-xl uppercase flex items-center gap-1 shadow-sm transition-colors">
                                        <ArrowUpRight size={11}/> Marcar Despachado
                                      </button>
                                    )}
                                    {isSup && ['PROGRAMADO','CONFIRMADO'].includes(d.status) && (
                                      <>
                                        <button onClick={()=>handleDsEdit(d)}
                                          className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-[9px] font-black px-3 py-1.5 rounded-xl uppercase flex items-center gap-1 transition-colors">
                                          <Pencil size={11}/> Editar
                                        </button>
                                        <button onClick={()=>handleDsCancel(d.id)}
                                          className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-[9px] font-black px-2 py-1.5 rounded-xl uppercase flex items-center gap-1 transition-colors">
                                          <X size={11}/> Cancelar
                                        </button>
                                      </>
                                    )}
                                    {d.status === 'DESPACHADO' && (
                                      <button onClick={async()=>{
                                        setDocHistoryModule(''); setDocHistoryDateFrom(''); setDocHistoryDateTo('');
                                        setDocHistorySearch(d.doc_num);
                                        const params = new URLSearchParams(); params.append('search', d.doc_num);
                                        try {
                                          const res = await apiFetch(`${host}/api/document-history?${params}`);
                                          const list = await res.json();
                                          setDocHistory(Array.isArray(list) ? list : []);
                                        } catch(e) {}
                                        switchTab('doc-history');
                                      }} className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[9px] font-black px-3 py-1.5 rounded-xl uppercase flex items-center gap-1 transition-colors">
                                        <History size={11}/> Ver documento
                                      </button>
                                    )}
                                    {isSup && ['DESPACHADO','CANCELADO'].includes(d.status) && (
                                      <button onClick={()=>handleDsDelete(d.id)}
                                        className="text-slate-300 hover:text-red-400 transition-colors p-1">
                                        <Trash2 size={14}/>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ═══════════════ MONITOR DE PICKING (SUPERVISOR/ADMIN) ═══════════════ */}
          {activeTab === 'picking-monitor' && (
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                  <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center"><ClipboardList className="w-7 h-7 mr-3 text-violet-600"/> Monitor de Picking</h1>
                  <div className="flex gap-2">
                    {['board','create','stats'].map(t => (
                      <button key={t} onClick={()=>setPickMonitorTab(t)} className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-colors ${pickMonitorTab===t ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                        {t==='board'?'Tablero':t==='create'?'Nueva Tarea':'KPIs'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── KPIs rápidos ── */}
                {pickStats && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label:'Pendientes', val: pickStats.by_status?.find(s=>s.status==='PENDIENTE')?.count||0, color:'bg-amber-50 border-amber-200 text-amber-700' },
                      { label:'En Proceso', val: pickStats.by_status?.find(s=>s.status==='EN_PROCESO')?.count||0, color:'bg-blue-50 border-blue-200 text-blue-700' },
                      { label:'Completadas', val: pickStats.by_status?.find(s=>s.status==='COMPLETADA')?.count||0, color:'bg-emerald-50 border-emerald-200 text-emerald-700' },
                      { label:'Diferencias', val: pickStats.by_status?.find(s=>s.status==='DIFERENCIA')?.count||0, color:'bg-red-50 border-red-200 text-red-700' },
                    ].map(k=>(
                      <div key={k.label} className={`rounded-2xl border-2 p-4 ${k.color}`}>
                        <p className="text-[9px] font-black uppercase tracking-widest opacity-70">{k.label}</p>
                        <p className="text-3xl font-black mt-1">{k.val}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── TABLERO ── */}
                {pickMonitorTab === 'board' && (() => {
                  const boardFiltered = pickTasks.filter(line => {
                    if (pickBoardModuleFilter && line.module !== pickBoardModuleFilter) return false;
                    if (pickBoardStatusFilter && line.line_status !== pickBoardStatusFilter) return false;
                    return true;
                  });
                  return (
                  <div className="space-y-4">
                    {/* Filtros */}
                    <div className="flex gap-3 flex-wrap items-center">
                      <select value={pickBoardModuleFilter} onChange={e=>setPickBoardModuleFilter(e.target.value)} className="border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-violet-500 bg-white">
                        <option value="">Todos los módulos</option>
                        <option value="dispatch">Despachos</option>
                        <option value="receive">Recepciones</option>
                        <option value="relocate">Reubicaciones</option>
                      </select>
                      <select value={pickBoardStatusFilter} onChange={e=>setPickBoardStatusFilter(e.target.value)} className="border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-violet-500 bg-white">
                        <option value="">Todos los estados</option>
                        <option value="PENDIENTE">Pendiente</option>
                        <option value="EN_PROCESO">En Proceso</option>
                        <option value="COMPLETADA">Completada</option>
                        <option value="DIFERENCIA">Diferencia</option>
                        <option value="SALTADA">Saltada</option>
                      </select>
                      {(pickBoardModuleFilter || pickBoardStatusFilter) && (
                        <button onClick={()=>{setPickBoardModuleFilter('');setPickBoardStatusFilter('');}} className="text-slate-400 hover:text-red-500 transition-colors flex items-center gap-1 text-xs font-black uppercase"><X size={12}/> Limpiar</button>
                      )}
                      <span className="ml-auto text-[10px] font-black text-slate-400 uppercase">{boardFiltered.length} de {pickTasks.length} líneas</span>
                    </div>

                    {/* Tabla de líneas de picking */}
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                        <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center"><ListTodo className="w-4 h-4 mr-2 text-violet-500"/> Líneas de Picking</h2>
                        <span className="text-xs text-slate-500 font-bold">{boardFiltered.length} líneas</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              {['Documento','Módulo','SKU','Ubicación','Qty','Picker','Estado','Acción'].map(h=>(
                                <th key={h} className="px-4 py-3 text-left text-[10px] font-black uppercase text-slate-500 tracking-widest">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {boardFiltered.map(line => {
                              const statusColor = {
                                'PENDIENTE':'bg-amber-50 text-amber-700 border-amber-200',
                                'EN_PROCESO':'bg-blue-50 text-blue-700 border-blue-200',
                                'COMPLETADA':'bg-emerald-50 text-emerald-700 border-emerald-200',
                                'DIFERENCIA':'bg-red-50 text-red-700 border-red-200',
                                'SALTADA':'bg-slate-50 text-slate-500 border-slate-200',
                              }[line.line_status] || 'bg-slate-50 text-slate-600 border-slate-200';
                              return (
                                <tr key={line.line_id} className="hover:bg-slate-50">
                                  <td className="px-4 py-3">
                                    <p className="font-black text-xs text-slate-800">{line.doc_num}</p>
                                    <p className="text-[9px] text-slate-400 font-mono">{line.task_id}</p>
                                  </td>
                                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${line.module==='dispatch'?'bg-blue-50 text-blue-600 border-blue-200':line.module==='receive'?'bg-emerald-50 text-emerald-600 border-emerald-200':'bg-purple-50 text-purple-600 border-purple-200'}`}>{line.module}</span></td>
                                  <td className="px-4 py-3">
                                    <p className="font-mono text-xs font-black text-slate-800">{line.sku}</p>
                                    <p className="text-[9px] text-slate-500">{line.sku_desc}</p>
                                    {line.lpn_id && <p className="text-[9px] font-mono text-indigo-600">{line.lpn_id}</p>}
                                  </td>
                                  <td className="px-4 py-3">
                                    {line.location_from && <p className="text-[9px] font-mono bg-slate-100 px-1.5 py-0.5 rounded font-bold text-slate-700 w-max">Desde: {line.location_from}</p>}
                                    {line.location_to && <p className="text-[9px] font-mono bg-indigo-50 px-1.5 py-0.5 rounded font-bold text-indigo-700 w-max mt-1">Hacia: {line.location_to}</p>}
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <span className="font-black text-slate-800">{line.qty_requested}</span>
                                    {line.qty_confirmed != null && <p className="text-[9px] text-emerald-600 font-bold">Conf: {line.qty_confirmed}</p>}
                                    {line.batch_confirmed && <p className="text-[9px] text-indigo-600 font-mono">Lote: {line.batch_confirmed}</p>}
                                    {line.serial_confirmed && <p className="text-[9px] text-indigo-600 font-mono">Serie: {line.serial_confirmed}</p>}
                                  </td>
                                  <td className="px-4 py-3">
                                    {line.assigned_to
                                      ? <span className="flex items-center text-xs font-bold text-slate-700"><UserCheck size={12} className="mr-1 text-violet-500"/>{line.assigned_to}</span>
                                      : (
                                        <select defaultValue="" onChange={async e => {
                                          if (!e.target.value) return;
                                          const r = await apiFetch(`${host}/api/pick-tasks/lines/${line.line_id}/assign`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ assigned_to: e.target.value }) });
                                          if (r.ok) { showMsg('✅ Picker asignado'); fetchData(); } else showMsg('Error al asignar', true);
                                        }} className="border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-bold outline-none focus:border-violet-500 bg-white">
                                          <option value="">Asignar picker...</option>
                                          {users.filter(u=>u.role==='PICKER').map(u=><option key={u.username} value={u.username}>{u.full_name}</option>)}
                                        </select>
                                      )
                                    }
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className={`px-2 py-1 rounded border text-[9px] font-black uppercase ${statusColor}`}>{line.line_status}</span>
                                    {line.diff_reason && <p className="text-[9px] text-red-500 mt-1 max-w-[120px] truncate" title={line.diff_reason}>{line.diff_reason}</p>}
                                  </td>
                                  <td className="px-4 py-3">
                                    {['PENDIENTE','EN_PROCESO'].includes(line.line_status) && (
                                      <button onClick={async()=>{
                                        const r = await apiFetch(`${host}/api/pick-tasks/${line.task_id}/cancel`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'Cancelado por supervisor'})});
                                        if(r.ok){showMsg('Tarea cancelada');fetchData();}
                                      }} className="text-[9px] text-red-600 hover:text-red-700 font-black uppercase flex items-center"><X size={12} className="mr-1"/>Cancelar</button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {boardFiltered.length === 0 && <tr><td colSpan="8" className="p-8 text-center text-slate-400 font-bold">{pickTasks.length === 0 ? 'No hay líneas de picking.' : 'No hay líneas que coincidan con los filtros.'}</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                  );
                })()}

                {/* ── CREAR TAREA ── */}
                {pickMonitorTab === 'create' && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
                    <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center"><Plus className="w-4 h-4 mr-2 text-violet-500"/> Crear Tareas de Picking</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Número Documento *</label>
                        <input type="text" value={pickCreateForm.doc_num} onChange={e=>setPickCreateForm({...pickCreateForm,doc_num:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-500 uppercase" placeholder="Ej: GD-2024-001"/>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Módulo *</label>
                        <select value={pickCreateForm.module} onChange={e=>setPickCreateForm({...pickCreateForm,module:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-500 bg-white">
                          <option value="dispatch">Despacho</option>
                          <option value="receive">Recepción</option>
                          <option value="relocate">Reubicación</option>
                        </select>
                      </div>
                      {is3PLMode && (
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase">Cliente</label>
                          <select value={pickCreateForm.client_id} onChange={e=>setPickCreateForm({...pickCreateForm,client_id:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-500 bg-white">
                            <option value="">Todos</option>
                            {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                      )}
                    </div>

                    {/* Agregar líneas */}
                    <div className="border-2 border-dashed border-slate-200 rounded-2xl p-4 space-y-3">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Líneas de la Tarea</p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase">SKU *</label>
                          <input type="text" value={pickLineForm.sku} onChange={e=>setPickLineForm({...pickLineForm,sku:e.target.value})} list="sku-list-pick" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-violet-500" placeholder="Código SKU"/>
                          <datalist id="sku-list-pick">{skus.map(s=><option key={s.sku} value={s.sku}>{s.desc}</option>)}</datalist>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase">LPN</label>
                          <input type="text" value={pickLineForm.lpn_id} onChange={e=>setPickLineForm({...pickLineForm,lpn_id:e.target.value})} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-violet-500" placeholder="LPN-XXXX"/>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase">Desde (Ubicación)</label>
                          <input type="text" value={pickLineForm.location_from} onChange={e=>setPickLineForm({...pickLineForm,location_from:e.target.value})} list="loc-list-pick" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-violet-500" placeholder="RACK-A-01"/>
                          <datalist id="loc-list-pick">{locations.map(l=><option key={l.location_id} value={l.location_id}/>)}</datalist>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase">Hacia (Ubicación)</label>
                          <input type="text" value={pickLineForm.location_to} onChange={e=>setPickLineForm({...pickLineForm,location_to:e.target.value})} list="loc-list-pick2" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-violet-500" placeholder="PISO-RECEPCION"/>
                          <datalist id="loc-list-pick2">{locations.map(l=><option key={l.location_id} value={l.location_id}/>)}</datalist>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase">Cantidad *</label>
                          <input type="number" min="0.01" step="0.01" value={pickLineForm.qty_requested} onChange={e=>setPickLineForm({...pickLineForm,qty_requested:e.target.value})} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-black outline-none focus:border-violet-500" placeholder="0"/>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase">Asignar a Picker</label>
                          <select value={pickLineForm.assigned_to} onChange={e=>setPickLineForm({...pickLineForm,assigned_to:e.target.value})} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-violet-500 bg-white">
                            <option value="">Sin asignar</option>
                            {users.filter(u=>u.role==='PICKER').map(u=><option key={u.username} value={u.username}>{u.full_name}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase">Prioridad (1=Máx)</label>
                          <select value={pickLineForm.priority} onChange={e=>setPickLineForm({...pickLineForm,priority:parseInt(e.target.value)})} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-violet-500 bg-white">
                            {[1,2,3,4,5,6,7,8,9,10].map(n=><option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>
                        <div className="flex items-end">
                          <button onClick={()=>{
                            if (!pickLineForm.sku || !pickLineForm.qty_requested) return showMsg('SKU y cantidad son requeridos', true);
                            const skuInfo = skus.find(s=>s.sku===pickLineForm.sku);
                            setPickCreateForm(prev=>({...prev, lines:[...prev.lines,{...pickLineForm, sku_desc:skuInfo?.desc||''}]}));
                            setPickLineForm({sku:'',sku_desc:'',lpn_id:'',location_from:'',location_to:'',qty_requested:'',assigned_to:'',priority:5});
                          }} className="w-full bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-4 py-2 text-xs font-black uppercase flex items-center justify-center transition-colors">
                            <Plus size={14} className="mr-1"/> Agregar
                          </button>
                        </div>
                      </div>

                      {/* Listado de líneas agregadas */}
                      {pickCreateForm.lines.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {pickCreateForm.lines.map((l,i)=>(
                            <div key={i} className="flex items-center gap-3 bg-violet-50 border border-violet-200 rounded-xl px-4 py-2">
                              <span className="text-[9px] font-black text-violet-400 w-5">#{i+1}</span>
                              <span className="font-mono text-xs font-black text-slate-800 flex-1">{l.sku}</span>
                              {l.lpn_id && <span className="text-[9px] font-mono bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">{l.lpn_id}</span>}
                              {l.location_from && <span className="text-[9px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">Desde: {l.location_from}</span>}
                              {l.location_to && <span className="text-[9px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">Hacia: {l.location_to}</span>}
                              <span className="font-black text-sm text-violet-700">{l.qty_requested}</span>
                              {l.assigned_to && <span className="text-[9px] text-violet-600 font-bold flex items-center"><UserCheck size={10} className="mr-0.5"/>{l.assigned_to}</span>}
                              <span className="text-[9px] bg-violet-200 text-violet-700 px-1.5 py-0.5 rounded font-black">P{l.priority}</span>
                              <button onClick={()=>setPickCreateForm(prev=>({...prev,lines:prev.lines.filter((_,j)=>j!==i)}))} className="text-red-400 hover:text-red-600"><X size={14}/></button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase">Notas (Opcional)</label>
                      <textarea value={pickCreateForm.notes} onChange={e=>setPickCreateForm({...pickCreateForm,notes:e.target.value})} rows={2} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-500 resize-none" placeholder="Instrucciones especiales para el picker..."/>
                    </div>

                    <button onClick={async()=>{
                      if (!pickCreateForm.doc_num || pickCreateForm.lines.length === 0) return showMsg('Documento y al menos una línea son requeridos', true);
                      const pickPayload = {...pickCreateForm, doc_id:pickCreateForm.doc_num};
                      if ((!is3PLMode || isHybridMode) && !pickPayload.client_id) pickPayload.client_id = systemConfig.own_client_id || 'PROPIO';
                      const r = await apiFetch(`${host}/api/pick-tasks`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pickPayload)});
                      if (r.ok) { const d=await r.json(); showMsg(`✅ ${d.count} tarea(s) de picking creada(s)`); setPickCreateForm({doc_num:'',doc_type:'GUIA_DESPACHO',module:'dispatch',client_id:'',notes:'',lines:[]}); fetchData(); setPickMonitorTab('board'); }
                      else { const e=await r.json(); showMsg(e.error||'Error al crear tareas',true); }
                    }} className="w-full bg-violet-600 hover:bg-violet-700 text-white rounded-2xl py-4 font-black uppercase tracking-widest text-sm transition-colors shadow-lg flex items-center justify-center">
                      <CheckCheck size={18} className="mr-2"/> Crear {pickCreateForm.lines.length} Tarea(s) de Picking
                    </button>
                  </div>
                )}

                {/* ── KPIs por picker ── */}
                {pickMonitorTab === 'stats' && pickStats && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                      <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Líneas por Estado</h3>
                      <div className="space-y-2">
                        {pickStats.by_status?.map(s=>(
                          <div key={s.status} className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-700">{s.status}</span>
                            <span className="font-black text-slate-800">{s.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                      <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Tasa de Diferencias</h3>
                      <p className="text-4xl font-black text-slate-800">
                        {pickStats.diff_rate?.total > 0
                          ? Math.round(pickStats.diff_rate.diffs * 100 / pickStats.diff_rate.total)
                          : 0}%
                      </p>
                      <p className="text-xs text-slate-500 mt-1">{pickStats.diff_rate?.diffs||0} diferencias de {pickStats.diff_rate?.total||0} confirmaciones</p>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm md:col-span-2">
                      <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Actividad por Picker</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="border-b border-slate-100">
                            <tr>{['Picker','Estado','Líneas'].map(h=><th key={h} className="px-3 py-2 text-left font-black text-slate-400 uppercase text-[9px]">{h}</th>)}</tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {pickStats.by_picker?.map((row,i)=>(
                              <tr key={i}><td className="px-3 py-2 font-mono font-black text-slate-700">{row.assigned_to}</td><td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-[9px] font-black border ${{'COMPLETADA':'bg-emerald-50 text-emerald-700 border-emerald-200','DIFERENCIA':'bg-red-50 text-red-700 border-red-200','EN_PROCESO':'bg-blue-50 text-blue-700 border-blue-200'}[row.status]||'bg-slate-50 text-slate-600 border-slate-200'}`}>{row.status}</span></td><td className="px-3 py-2 font-black text-slate-800">{row.count}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
            </div>
          )}

          {/* ═══════════════ COLA DEL PICKER (vista móvil) ═══════════════ */}
          {activeTab === 'picker-queue' && (
            <div className="max-w-lg mx-auto p-4 space-y-4">
                {/* Header */}
                <div className="bg-violet-600 rounded-2xl p-4 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Picker Activo</p>
                      <p className="text-lg font-black">{currentUser?.full_name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-black">{pickQueue.length}</p>
                      <p className="text-[10px] font-black uppercase opacity-70">Tareas pendientes</p>
                    </div>
                  </div>
                </div>

                {pickerView === 'queue' && (
                  <>
                    {pickQueue.length === 0 && (
                      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
                        <CheckCheck className="w-12 h-12 text-emerald-400 mx-auto mb-3"/>
                        <p className="font-black text-slate-800 text-lg">¡Todo al día!</p>
                        <p className="text-slate-500 text-sm mt-1">No tienes tareas pendientes.</p>
                      </div>
                    )}
                    {pickQueue.map(line => (
                      <div key={line.line_id} className="bg-white rounded-2xl border-2 border-slate-200 shadow-sm overflow-hidden">
                        {/* Prioridad badge */}
                        <div className={`h-1.5 ${line.priority <= 2 ? 'bg-red-500' : line.priority <= 4 ? 'bg-amber-400' : 'bg-violet-400'}`}/>
                        <div className="p-5 space-y-3">
                          <div className="flex items-start justify-between">
                            <div>
                              <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${line.module==='dispatch'?'bg-blue-50 text-blue-600 border-blue-200':line.module==='receive'?'bg-emerald-50 text-emerald-600 border-emerald-200':'bg-purple-50 text-purple-600 border-purple-200'}`}>{line.module}</span>
                              <p className="font-black text-slate-800 text-sm mt-1">{line.doc_num}</p>
                            </div>
                            <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full ${line.line_status==='EN_PROCESO'?'bg-blue-100 text-blue-700':'bg-amber-100 text-amber-700'}`}>{line.line_status}</span>
                          </div>

                          <div className="bg-slate-50 rounded-xl p-3 space-y-1">
                            <p className="font-mono font-black text-slate-800 text-sm">{line.sku}</p>
                            {line.sku_desc && <p className="text-xs text-slate-600">{line.sku_desc}</p>}
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            {line.location_from && (
                              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                                <p className="text-[9px] font-black text-amber-600 uppercase">Retirar de</p>
                                <p className="font-mono font-black text-amber-800 text-sm">{line.location_from}</p>
                              </div>
                            )}
                            {line.location_to && (
                              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
                                <p className="text-[9px] font-black text-indigo-600 uppercase">Llevar a</p>
                                <p className="font-mono font-black text-indigo-800 text-sm">{line.location_to}</p>
                              </div>
                            )}
                          </div>

                          {line.lpn_id && (
                            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
                              <p className="text-[9px] font-black text-indigo-600 uppercase">LPN</p>
                              <p className="font-mono font-black text-indigo-800">{line.lpn_id}</p>
                              {line.batch_number && <p className="text-[9px] text-indigo-500 mt-0.5">Lote actual: {line.batch_number}</p>}
                              {line.serial_number && <p className="text-[9px] text-indigo-500">Serie actual: {line.serial_number}</p>}
                            </div>
                          )}

                          <div className="flex items-center justify-between bg-violet-50 rounded-xl p-3">
                            <p className="text-[10px] font-black text-violet-600 uppercase">Cantidad Solicitada</p>
                            <p className="text-3xl font-black text-violet-800">{line.qty_requested}</p>
                          </div>

                          {line.line_status === 'PENDIENTE' && (
                            <button onClick={async()=>{
                              const r = await apiFetch(`${host}/api/picker/lines/${line.line_id}/start`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
                              if(r.ok){showMsg('Tarea tomada — confirma la cantidad');fetchData();}
                              else{const e=await r.json();showMsg(e.error||'Error',true);}
                            }} className="w-full bg-violet-600 hover:bg-violet-700 text-white rounded-xl py-4 font-black uppercase tracking-widest text-sm transition-colors flex items-center justify-center">
                              <Play size={16} className="mr-2"/> Tomar Tarea
                            </button>
                          )}

                          {line.line_status === 'EN_PROCESO' && (
                            <button onClick={()=>{ setActivePickLine(line); setPickerConfirmForm({qty_confirmed:String(line.qty_requested),batch_confirmed:'',serial_confirmed:'',diff_reason:''}); setPickerView('confirm'); }} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-4 font-black uppercase tracking-widest text-sm transition-colors flex items-center justify-center">
                              <CheckCircle2 size={16} className="mr-2"/> Confirmar Picking
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {/* ── Pantalla de confirmación ── */}
                {pickerView === 'confirm' && activePickLine && (
                  <div className="bg-white rounded-2xl border-2 border-emerald-200 shadow-lg overflow-hidden">
                    <div className="bg-emerald-600 p-4 text-white">
                      <button onClick={()=>setPickerView('queue')} className="flex items-center text-sm font-black mb-2 opacity-80 hover:opacity-100"><ArrowLeft size={16} className="mr-1"/> Volver a cola</button>
                      <p className="font-black text-lg">{activePickLine.doc_num}</p>
                      <p className="text-sm opacity-80">{activePickLine.sku} · {activePickLine.sku_desc}</p>
                    </div>
                    <div className="p-5 space-y-5">
                      {/* Cantidad confirmada */}
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Cantidad Real Encontrada *</label>
                        <input type="number" min="0" step="0.01" value={pickerConfirmForm.qty_confirmed} onChange={e=>setPickerConfirmForm({...pickerConfirmForm,qty_confirmed:e.target.value})}
                          className="w-full text-5xl font-black text-center border-4 border-slate-200 rounded-2xl py-4 outline-none focus:border-emerald-500 text-slate-800"/>
                        <p className="text-center text-xs text-slate-400 mt-1">Solicitado: <strong>{activePickLine.qty_requested}</strong></p>
                      </div>

                      {/* Lote */}
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                          Número de Lote {activePickLine.batch_number ? <span className="text-red-500">* (LPN tiene lote: {activePickLine.batch_number})</span> : '(opcional)'}
                        </label>
                        <input type="text" value={pickerConfirmForm.batch_confirmed} onChange={e=>setPickerConfirmForm({...pickerConfirmForm,batch_confirmed:e.target.value})}
                          className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-mono font-bold outline-none focus:border-emerald-500 uppercase" placeholder="Ej: LOTE-2024-01"/>
                      </div>

                      {/* Serie */}
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                          Número de Serie {activePickLine.serial_number ? <span className="text-red-500">* (LPN tiene serie)</span> : '(opcional)'}
                        </label>
                        <input type="text" value={pickerConfirmForm.serial_confirmed} onChange={e=>setPickerConfirmForm({...pickerConfirmForm,serial_confirmed:e.target.value})}
                          className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-mono font-bold outline-none focus:border-emerald-500" placeholder="Ej: SN-ABCD1234"/>
                      </div>

                      {/* Razón de diferencia — aparece si la cantidad difiere */}
                      {parseFloat(pickerConfirmForm.qty_confirmed) !== parseFloat(activePickLine.qty_requested) && (
                        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4 space-y-2">
                          <p className="text-xs font-black text-red-600 flex items-center"><AlertTriangle size={14} className="mr-1"/> Diferencia detectada — razón requerida</p>
                          <select value={pickerConfirmForm.diff_reason} onChange={e=>setPickerConfirmForm({...pickerConfirmForm,diff_reason:e.target.value})} className="w-full border-2 border-red-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-red-400 bg-white">
                            <option value="">-- Seleccionar razón --</option>
                            <option>Sin stock en ubicación</option>
                            <option>Stock insuficiente</option>
                            <option>Producto dañado</option>
                            <option>Ubicación incorrecta</option>
                            <option>LPN no encontrado</option>
                            <option>Otro (ver notas)</option>
                          </select>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <button onClick={async()=>{
                          const r = await apiFetch(`${host}/api/picker/lines/${activePickLine.line_id}/skip`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({diff_reason:pickerConfirmForm.diff_reason||'Saltada por picker'})});
                          if(r.ok){showMsg('Línea saltada');setPickerView('queue');setActivePickLine(null);fetchData();}
                          else{const e=await r.json();showMsg(e.error||'Error',true);}
                        }} className="bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl py-4 font-black uppercase text-sm flex items-center justify-center transition-colors">
                          <SkipForward size={16} className="mr-2"/> Saltar
                        </button>
                        <button onClick={async()=>{
                          const body = { qty_confirmed: parseFloat(pickerConfirmForm.qty_confirmed), batch_confirmed: pickerConfirmForm.batch_confirmed||undefined, serial_confirmed: pickerConfirmForm.serial_confirmed||undefined, diff_reason: pickerConfirmForm.diff_reason||undefined };
                          const r = await apiFetch(`${host}/api/picker/lines/${activePickLine.line_id}/confirm`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
                          if(r.ok){const d=await r.json();showMsg(d.has_diff?'⚠️ Diferencia registrada':'✅ Picking confirmado');setPickerView('queue');setActivePickLine(null);fetchData();}
                          else{const e=await r.json();showMsg(e.error||'Error al confirmar',true);}
                        }} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-4 font-black uppercase text-sm flex items-center justify-center transition-colors">
                          <CheckCircle2 size={16} className="mr-2"/> Confirmar
                        </button>
                      </div>
                    </div>
                  </div>
                )}
            </div>
          )}

          {/* ═══════════════ PROVEEDORES & ASN ═══════════════ */}
          {activeTab === 'suppliers' && (
            <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center"><Building2 className="w-7 h-7 mr-3 text-cyan-600"/> Proveedores & ASN</h2>
                <div className="flex gap-2">
                  <button onClick={()=>setAsnView(asnView==='list'?'new':'list')} className="bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest flex items-center gap-2 transition-colors">
                    {asnView==='new'?<><X size={14}/> Cancelar</>:<><Plus size={14}/> Nueva ASN</>}
                  </button>
                </div>
              </div>

              {/* Formulario nuevo proveedor */}
              <details className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <summary className="px-6 py-4 font-black text-sm uppercase tracking-widest text-slate-700 cursor-pointer flex items-center gap-2 hover:bg-slate-50"><Plus size={14}/> Registrar Proveedor</summary>
                <div className="px-6 pb-6 border-t border-slate-100 pt-4">
                  <form onSubmit={async(e)=>{ e.preventDefault(); const method = supplierEditId ? 'PUT' : 'POST'; const url = supplierEditId ? `${host}/api/suppliers/${supplierEditId}` : `${host}/api/suppliers`; const r = await apiFetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(supplierForm)}); if(r.ok){showMsg('✅ Proveedor guardado');setSupplierForm({name:'',rut:'',contact:'',email:'',phone:'',country:'CL',notes:''});setSupplierEditId(null);fetchData();}else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}}} className="grid grid-cols-2 gap-4">
                    <input required value={supplierForm.name} onChange={e=>setSupplierForm({...supplierForm,name:e.target.value})} placeholder="Nombre Proveedor *" className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400 col-span-2"/>
                    <input value={supplierForm.rut} onChange={e=>setSupplierForm({...supplierForm,rut:e.target.value})} placeholder="RUT / ID Fiscal" className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400"/>
                    <input value={supplierForm.contact} onChange={e=>setSupplierForm({...supplierForm,contact:e.target.value})} placeholder="Contacto" className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400"/>
                    <input value={supplierForm.email} onChange={e=>setSupplierForm({...supplierForm,email:e.target.value})} placeholder="Email" className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400"/>
                    <input value={supplierForm.phone} onChange={e=>setSupplierForm({...supplierForm,phone:e.target.value})} placeholder="Teléfono" className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400"/>
                    <div className="col-span-2 flex gap-3">
                      <input value={supplierForm.notes} onChange={e=>setSupplierForm({...supplierForm,notes:e.target.value})} placeholder="Notas" className="flex-1 border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400"/>
                      <button type="submit" className="bg-cyan-600 text-white px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-cyan-700 transition-colors">{supplierEditId?'Actualizar':'Guardar'}</button>
                    </div>
                  </form>
                </div>
              </details>

              {/* Lista proveedores */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 font-black text-sm text-slate-600 uppercase tracking-widest">Proveedores Registrados ({suppliers.length})</div>
                {suppliers.length===0 ? <div className="p-10 text-center text-slate-400 font-bold text-sm">Sin proveedores registrados.</div> : (
                  <div className="divide-y divide-slate-100">
                    {suppliers.map(s=>(
                      <div key={s.id} className="flex items-center justify-between px-6 py-4 hover:bg-slate-50">
                        <div>
                          <p className="font-black text-slate-800">{s.name}</p>
                          <p className="text-xs text-slate-500">{s.rut && `RUT: ${s.rut} — `}{s.contact && `Contacto: ${s.contact} — `}{s.email}</p>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={()=>{setSupplierEditId(s.id);setSupplierForm({name:s.name,rut:s.rut||'',contact:s.contact||'',email:s.email||'',phone:s.phone||'',country:s.country||'CL',notes:s.notes||''});}} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors"><Pencil size={12}/> Editar</button>
                          <button onClick={async()=>{if(!(await confirm({ message: '¿Eliminar proveedor?', danger: true })))return;const r=await apiFetch(`${host}/api/suppliers/${s.id}`,{method:'DELETE'});if(r.ok){showMsg('✅ Eliminado');fetchData();}else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}}} className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors"><Trash2 size={12}/> Eliminar</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Nueva ASN */}
              {asnView==='new' && (
                <div className="bg-white rounded-2xl border-2 border-cyan-200 shadow-sm p-6 space-y-4">
                  <h3 className="font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><Upload size={16} className="text-cyan-600"/> Nueva Nota de Embarque (ASN)</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Proveedor *</label>
                      <select value={asnForm.supplier_id} onChange={e=>setAsnForm({...asnForm,supplier_id:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400 bg-white mt-1">
                        <option value="">-- Seleccionar --</option>
                        {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Fecha Esperada *</label>
                      <input type="date" value={asnForm.expected_date} onChange={e=>setAsnForm({...asnForm,expected_date:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400 mt-1"/>
                    </div>
                    <div className="col-span-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Referencia / Orden Compra</label>
                      <input value={asnForm.reference} onChange={e=>setAsnForm({...asnForm,reference:e.target.value})} placeholder="Ej: OC-2026-001" className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400 mt-1"/>
                    </div>
                  </div>
                  {/* Líneas ASN */}
                  <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Líneas de Producto</p>
                    <div className="flex gap-3">
                      <select value={asnLineForm.sku} onChange={e=>setAsnLineForm({...asnLineForm,sku:e.target.value})} className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-cyan-400 bg-white">
                        <option value="">-- SKU --</option>
                        {skus.map(s=><option key={s.sku} value={s.sku}>{s.sku} - {s.description}</option>)}
                      </select>
                      <input type="number" min="1" value={asnLineForm.qty_expected} onChange={e=>setAsnLineForm({...asnLineForm,qty_expected:e.target.value})} placeholder="Cant." className="w-24 border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-cyan-400 text-center"/>
                      <button onClick={()=>{if(!asnLineForm.sku||!asnLineForm.qty_expected)return;setAsnForm(prev=>({...prev,lines:[...prev.lines,{sku:asnLineForm.sku,qty_expected:parseFloat(asnLineForm.qty_expected)}]}));setAsnLineForm({sku:'',qty_expected:''}); }} className="bg-cyan-600 text-white px-4 py-2 rounded-xl font-black text-xs transition-colors hover:bg-cyan-700 flex items-center gap-1"><Plus size={13}/>Agregar</button>
                    </div>
                    {asnForm.lines.map((ln,i)=>(
                      <div key={i} className="flex items-center justify-between bg-white rounded-lg px-4 py-2 border border-slate-200">
                        <span className="font-mono text-sm font-black">{ln.sku}</span>
                        <span className="text-slate-600 text-sm font-bold">Cant: {ln.qty_expected}</span>
                        <button onClick={()=>setAsnForm(prev=>({...prev,lines:prev.lines.filter((_,j)=>j!==i)}))} className="text-red-400 hover:text-red-600"><X size={14}/></button>
                      </div>
                    ))}
                  </div>
                  <button onClick={async()=>{
                    if(!asnForm.supplier_id||!asnForm.expected_date||asnForm.lines.length===0){showMsg('⛔ Completa proveedor, fecha y al menos una línea.',true);return;}
                    const r=await apiFetch(`${host}/api/asns`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(asnForm)});
                    if(r.ok){showMsg('✅ ASN creada');setAsnForm({supplier_id:'',expected_date:'',reference:'',notes:'',lines:[]});setAsnView('list');fetchData();}
                    else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}
                  }} className="w-full bg-cyan-600 text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-cyan-700 transition-colors">Crear ASN</button>
                </div>
              )}

              {/* Lista ASN */}
              {asnView==='list' && (
                <div className="space-y-3">
                  <h3 className="text-sm font-black text-slate-600 uppercase tracking-widest border-b border-slate-200 pb-2">Notas de Embarque ({asns.length})</h3>
                  {asns.length===0 ? <div className="p-10 text-center bg-white rounded-2xl border border-slate-200 text-slate-400 font-bold">Sin ASNs registradas.</div> : (
                    <div className="space-y-3">
                      {asns.map(a=>(
                        <div key={a.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                          <div className="flex items-start justify-between">
                            <div>
                              <span className={`text-[9px] font-black uppercase px-2 py-1 rounded border ${a.status==='RECIBIDO'?'bg-emerald-50 text-emerald-600 border-emerald-200':a.status==='PARCIAL'?'bg-amber-50 text-amber-600 border-amber-200':'bg-slate-50 text-slate-500 border-slate-200'}`}>{a.status}</span>
                              <p className="font-black text-slate-800 mt-1">{a.reference||`ASN-${a.id}`}</p>
                              <p className="text-xs text-slate-500">{a.supplier_name} — Esperado: {a.expected_date?.split('T')[0]}</p>
                            </div>
                            <div className="flex gap-2">
                              {a.status !== 'RECIBIDO' && (
                                <button onClick={()=>{setActiveAsn(a);setAsnReceiveQtys({});setAsnView('receive');}} className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1"><ArrowDownRight size={12}/> Recepcionar</button>
                              )}
                              <button onClick={async()=>{if(!(await confirm({ message: '¿Eliminar ASN?', danger: true })))return;const r=await apiFetch(`${host}/api/asns/${a.id}`,{method:'DELETE'});if(r.ok){showMsg('✅ Eliminada');fetchData();}else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}}} className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1"><Trash2 size={12}/></button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Recepcionar ASN */}
              {asnView==='receive' && activeAsn && (
                <div className="bg-white rounded-2xl border-2 border-emerald-200 shadow-sm p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><ArrowDownRight size={16} className="text-emerald-600"/> Recepcionar ASN: {activeAsn.reference||`ASN-${activeAsn.id}`}</h3>
                    <button onClick={()=>setAsnView('list')} className="text-slate-400 hover:text-slate-600"><X size={18}/></button>
                  </div>
                  <p className="text-sm text-slate-500">Proveedor: <strong>{activeAsn.supplier_name}</strong></p>
                  {(activeAsn.lines||[]).map(ln=>(
                    <div key={ln.id} className="bg-slate-50 rounded-xl p-4 flex items-center gap-4">
                      <div className="flex-1">
                        <p className="font-mono font-black text-slate-800">{ln.sku}</p>
                        <p className="text-xs text-slate-500">Esperado: {ln.qty_expected} — Recibido hasta ahora: {ln.qty_received||0}</p>
                      </div>
                      <input type="number" min="0" max={ln.qty_expected-(ln.qty_received||0)} placeholder="Cant. recibir" value={asnReceiveQtys[ln.id]||''} onChange={e=>setAsnReceiveQtys(p=>({...p,[ln.id]:e.target.value}))} className="w-28 border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-emerald-400 text-center"/>
                    </div>
                  ))}
                  <button onClick={async()=>{
                    const lines=(activeAsn.lines||[]).filter(ln=>asnReceiveQtys[ln.id]>0).map(ln=>({line_id:ln.id,qty_received:parseFloat(asnReceiveQtys[ln.id])}));
                    if(lines.length===0){showMsg('⛔ Ingresa al menos una cantidad',true);return;}
                    const r=await apiFetch(`${host}/api/asns/${activeAsn.id}/receive`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lines})});
                    if(r.ok){showMsg('✅ Recepción registrada');setAsnView('list');setActiveAsn(null);fetchData();}
                    else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}
                  }} className="w-full bg-emerald-600 text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition-colors">Confirmar Recepción</button>
                </div>
              )}
            </div>
          )}

          {/* ═══════════════ FABRICANTES ═══════════════ */}
          {activeTab === 'manufacturers' && (
            <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-indigo-100 rounded-2xl"><HardHat className="w-7 h-7 text-indigo-600"/></div>
                  <div>
                    <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Fabricantes</h1>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Quién produce cada SKU</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm w-72">
                  <Search size={14} className="text-slate-400"/>
                  <input type="text" placeholder="Buscar por código o nombre…" value={mfrSearchTerm} onChange={e=>setMfrSearchTerm(e.target.value)} className="bg-transparent text-xs font-bold outline-none w-full text-slate-700"/>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-2">
                  <form onSubmit={handleSaveManufacturer} className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-3 sticky top-4">
                    <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter border-b pb-3">{editingMfrId ? 'Editar fabricante' : 'Nuevo fabricante'}</h2>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1 col-span-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Código {editingMfrId ? '*' : ''}</label>
                        <input type="text" value={manufacturerForm.code} onChange={e=>setManufacturerForm(p=>({...p, code: e.target.value.toUpperCase()}))} placeholder={editingMfrId ? '' : 'Vacío para auto-generar'} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-indigo-500 uppercase"/>
                      </div>
                      <div className="space-y-1 col-span-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Nombre *</label>
                        <input type="text" required value={manufacturerForm.name} onChange={e=>setManufacturerForm(p=>({...p, name: e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-indigo-500"/>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">País</label>
                        <input type="text" value={manufacturerForm.country} onChange={e=>setManufacturerForm(p=>({...p, country: e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-indigo-500"/>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Contacto</label>
                        <input type="text" value={manufacturerForm.contact} onChange={e=>setManufacturerForm(p=>({...p, contact: e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-indigo-500"/>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Email</label>
                        <input type="email" value={manufacturerForm.email} onChange={e=>setManufacturerForm(p=>({...p, email: e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-indigo-500"/>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Teléfono</label>
                        <input type="text" value={manufacturerForm.phone} onChange={e=>setManufacturerForm(p=>({...p, phone: e.target.value}))} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-indigo-500"/>
                      </div>
                      <div className="space-y-1 col-span-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Sitio web</label>
                        <input type="text" value={manufacturerForm.website} onChange={e=>setManufacturerForm(p=>({...p, website: e.target.value}))} placeholder="https://…" className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-indigo-500"/>
                      </div>
                      <div className="space-y-1 col-span-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Notas</label>
                        <textarea value={manufacturerForm.notes} onChange={e=>setManufacturerForm(p=>({...p, notes: e.target.value}))} rows={3} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-indigo-500 resize-none"/>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 rounded-xl uppercase text-[10px] tracking-widest">{editingMfrId ? 'Guardar cambios' : 'Crear fabricante'}</button>
                      {editingMfrId && <button type="button" onClick={()=>{setEditingMfrId(null);setManufacturerForm({ code:'', name:'', country:'', contact:'', email:'', phone:'', website:'', notes:'' });}} className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-black py-3 px-4 rounded-xl uppercase text-[10px]">Cancelar</button>}
                    </div>
                  </form>
                </div>

                <div className="lg:col-span-3">
                  <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">Código</th>
                          <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">Nombre</th>
                          <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">País</th>
                          <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase text-center">SKUs</th>
                          <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase text-center">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {manufacturers.filter(m => !mfrSearchTerm || m.name.toLowerCase().includes(mfrSearchTerm.toLowerCase()) || m.code.toLowerCase().includes(mfrSearchTerm.toLowerCase())).map(m => (
                          <tr key={m.id} className={`hover:bg-indigo-50/30 ${!m.active ? 'opacity-50' : ''}`}>
                            <td className="px-4 py-3 font-mono text-xs font-black text-indigo-700">{m.code}</td>
                            <td className="px-4 py-3"><button onClick={()=>handleOpenMfrDetail(m.id)} className="text-xs font-black text-slate-800 hover:text-indigo-600 text-left">{m.name}</button>{!m.active && <span className="ml-2 text-[8px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-black uppercase">Inactivo</span>}</td>
                            <td className="px-4 py-3 text-xs font-bold text-slate-600">{m.country || '—'}</td>
                            <td className="px-4 py-3 text-center"><span className="text-xs font-black text-slate-700">{m.sku_count || 0}</span></td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button onClick={()=>handleEditMfr(m)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 p-2 rounded-lg" title="Editar"><Pencil size={12}/></button>
                                {m.active && <button onClick={()=>handleDeleteManufacturer(m.id)} className="bg-red-50 hover:bg-red-100 text-red-600 p-2 rounded-lg" title="Desactivar"><Trash2 size={12}/></button>}
                              </div>
                            </td>
                          </tr>
                        ))}
                        {manufacturers.length === 0 && <tr><td colSpan="5" className="p-8 text-center text-slate-400 text-sm">Sin fabricantes registrados aún.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Modal de detalle */}
              {mfrDetail && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={e=>e.target===e.currentTarget && setMfrDetail(null)}>
                  <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                    <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter">{mfrDetail.name}</h2>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">{mfrDetail.code} {mfrDetail.country && `· ${mfrDetail.country}`}</p>
                      </div>
                      <button onClick={()=>setMfrDetail(null)} className="p-2 hover:bg-slate-100 rounded-lg"><X size={18} className="text-slate-400"/></button>
                    </div>
                    <div className="p-5">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">SKUs vinculados ({mfrDetail.skus?.length || 0})</p>
                      {(mfrDetail.skus || []).length === 0
                        ? <p className="text-sm text-slate-400 text-center py-6">Sin SKUs vinculados a este fabricante.</p>
                        : <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50"><tr>
                              <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase">SKU</th>
                              <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase">Descripción</th>
                              <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase">Cód. fab.</th>
                              <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase">Marca</th>
                              <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase text-right">Stock</th>
                            </tr></thead>
                            <tbody className="divide-y divide-slate-100">
                              {mfrDetail.skus.map(s => (
                                <tr key={s.sku}><td className="px-3 py-2 font-mono font-black">{s.sku}</td><td className="px-3 py-2">{s.desc}</td><td className="px-3 py-2 font-mono text-slate-500">{s.manufacturer_sku || '—'}</td><td className="px-3 py-2 text-slate-600">{s.brand || '—'}</td><td className="px-3 py-2 text-right font-black">{s.stock || 0}</td></tr>
                              ))}
                            </tbody>
                          </table>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══════════════ OLAS DE PICKING ═══════════════ */}
          {activeTab === 'waves' && (
            <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center"><Layers className="w-7 h-7 mr-3 text-cyan-600"/> Olas de Picking</h2>
                <button onClick={async()=>{const r=await apiFetch(`${host}/api/pick-waves/available-lines`);if(r.ok){setWaveAvailLines(await r.json());setWaveView('new');}else showMsg('⛔ Error al cargar líneas',true);}} className="bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest flex items-center gap-2 transition-colors">
                  {waveView==='new'?null:<><Plus size={14}/> Nueva Ola</>}
                  {waveView==='new'&&<><X size={14}/> Cancelar</>}
                </button>
              </div>

              {waveView==='new' && (
                <div className="bg-white rounded-2xl border-2 border-cyan-200 shadow-sm p-6 space-y-5">
                  <h3 className="font-black text-slate-800 uppercase tracking-tighter">Crear Nueva Ola</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Nombre Ola *</label>
                      <input value={waveForm.name} onChange={e=>setWaveForm({...waveForm,name:e.target.value})} placeholder="Ej: OLA-MAÑANA-01" className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400 mt-1 uppercase"/>
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Estrategia</label>
                      <select value={waveForm.strategy} onChange={e=>setWaveForm({...waveForm,strategy:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400 bg-white mt-1">
                        <option value="FIFO">FIFO</option>
                        <option value="FEFO">FEFO</option>
                        <option value="ZONE">Por Zona</option>
                      </select>
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4 space-y-2">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Seleccionar Líneas de Picking ({waveLineSelection.size} seleccionadas)</p>
                    {waveAvailLines.length===0 && <p className="text-slate-400 text-sm">No hay líneas de picking disponibles sin asignar a una ola.</p>}
                    <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-1">
                      {waveAvailLines.map(ln=>(
                        <label key={ln.line_id} className="flex items-center gap-3 bg-white p-3 rounded-lg border border-slate-200 cursor-pointer hover:bg-cyan-50 transition-colors">
                          <input type="checkbox" checked={waveLineSelection.has(ln.line_id)} onChange={e=>{const s=new Set(waveLineSelection);e.target.checked?s.add(ln.line_id):s.delete(ln.line_id);setWaveLineSelection(s);}} className="w-4 h-4 accent-cyan-600"/>
                          <div className="flex-1">
                            <span className="font-mono font-black text-sm text-slate-800">{ln.sku}</span>
                            <span className="mx-2 text-slate-400">—</span>
                            <span className="text-xs text-slate-600">{ln.doc_num}</span>
                          </div>
                          <span className="text-[9px] font-black text-slate-400 uppercase">{ln.module}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <button onClick={async()=>{
                    if(!waveForm.name){showMsg('⛔ Ingresa nombre de ola',true);return;}
                    const r=await apiFetch(`${host}/api/pick-waves`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...waveForm,line_ids:Array.from(waveLineSelection)})});
                    if(r.ok){showMsg('✅ Ola creada');setWaveView('list');setWaveLineSelection(new Set());setWaveForm({name:'',strategy:'FIFO',notes:'',line_ids:[]});fetchData();}
                    else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}
                  }} className="w-full bg-cyan-600 text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-cyan-700 transition-colors">Crear Ola</button>
                </div>
              )}

              <div className="space-y-3">
                {waves.length===0 ? <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400 font-bold">Sin olas registradas.</div> : waves.map(w=>(
                  <div key={w.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-black text-slate-800 text-lg">{w.name}</p>
                        <div className="flex gap-2 mt-1">
                          <span className={`text-[9px] font-black uppercase px-2 py-1 rounded border ${w.status==='CERRADA'?'bg-slate-100 text-slate-500 border-slate-200':w.status==='LIBERADA'?'bg-blue-50 text-blue-600 border-blue-200':w.status==='EN_PROCESO'?'bg-amber-50 text-amber-600 border-amber-200':'bg-emerald-50 text-emerald-600 border-emerald-200'}`}>{w.status}</span>
                          <span className="text-[9px] font-black uppercase px-2 py-1 rounded border bg-slate-50 text-slate-500 border-slate-200">{w.strategy}</span>
                          <span className="text-[9px] font-black text-slate-400">{w.total_lines||0} líneas</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {w.status==='CREADA' && <button onClick={async()=>{const r=await apiFetch(`${host}/api/pick-waves/${w.id}/release`,{method:'POST'});if(r.ok){showMsg('✅ Ola liberada');fetchData();}else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}}} className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors"><Play size={12}/> Liberar</button>}
                        {(w.status==='LIBERADA'||w.status==='EN_PROCESO') && <button onClick={async()=>{const r=await apiFetch(`${host}/api/pick-waves/${w.id}/close`,{method:'POST'});if(r.ok){showMsg('✅ Ola cerrada');fetchData();}else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}}} className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors"><CheckCircle2 size={12}/> Cerrar</button>}
                      </div>
                    </div>
                    {w.notes && <p className="text-xs text-slate-500 mt-2 italic">{w.notes}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══════════════ ESTACIÓN DE EMPAQUE ═══════════════ */}
          {activeTab === 'packing' && (
            <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in">
              <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center"><Package className="w-7 h-7 mr-3 text-cyan-600"/> Estación de Empaque</h2>

              {!activePackingOrder ? (
                <div className="space-y-3">
                  {packingOrders.length===0 ? <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400 font-bold">Sin órdenes de empaque.</div> : packingOrders.map(po=>(
                    <div key={po.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-start justify-between">
                      <div>
                        <p className="font-black text-slate-800">{po.doc_num}</p>
                        <p className="text-xs text-slate-500">{is3PLMode ? `${po.client_name||po.client_id} — ` : ''}{po.total_lines||0} líneas</p>
                        <span className={`mt-2 inline-block text-[9px] font-black uppercase px-2 py-1 rounded border ${po.status==='COMPLETADA'?'bg-emerald-50 text-emerald-600 border-emerald-200':po.status==='EN_PROCESO'?'bg-amber-50 text-amber-600 border-amber-200':'bg-slate-50 text-slate-500 border-slate-200'}`}>{po.status}</span>
                      </div>
                      {po.status !== 'COMPLETADA' && (
                        <button onClick={async()=>{const r=await apiFetch(`${host}/api/packing-orders/${po.id}`);if(r.ok){setActivePackingOrder(await r.json());setPackingLineQtys({});setPackingCartons({});}}} className="text-xs bg-cyan-50 hover:bg-cyan-100 text-cyan-700 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors"><Package size={12}/> Empacar</button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-white rounded-2xl border-2 border-cyan-200 shadow-sm p-6 space-y-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-black text-slate-800 uppercase tracking-tighter">Empacando: {activePackingOrder.doc_num}</h3>
                    <button onClick={()=>setActivePackingOrder(null)} className="text-slate-400 hover:text-slate-600"><X size={18}/></button>
                  </div>
                  <div className="space-y-3">
                    {(activePackingOrder.lines||[]).map(ln=>(
                      <div key={ln.id} className="bg-slate-50 rounded-xl p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-mono font-black text-slate-800">{ln.sku}</p>
                            <p className="text-xs text-slate-500">Solicitado: {ln.qty_requested} — Empacado: {ln.qty_packed||0}</p>
                          </div>
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${ln.status==='COMPLETADA'?'bg-emerald-50 text-emerald-600 border-emerald-200':'bg-amber-50 text-amber-600 border-amber-200'}`}>{ln.status}</span>
                        </div>
                        {ln.status!=='COMPLETADA' && (
                          <div className="flex gap-2">
                            <input type="number" min="0" placeholder="Cant. empacada" value={packingLineQtys[ln.id]||''} onChange={e=>setPackingLineQtys(p=>({...p,[ln.id]:e.target.value}))} className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-cyan-400 text-center"/>
                            <input placeholder="Caja / Carton" value={packingCartons[ln.id]||''} onChange={e=>setPackingCartons(p=>({...p,[ln.id]:e.target.value}))} className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-cyan-400"/>
                            <button onClick={async()=>{
                              const r=await apiFetch(`${host}/api/packing-orders/${activePackingOrder.id}/lines/${ln.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({qty_packed:parseFloat(packingLineQtys[ln.id]||0),carton_id:packingCartons[ln.id]||null})});
                              if(r.ok){showMsg('✅ Línea actualizada');const r2=await apiFetch(`${host}/api/packing-orders/${activePackingOrder.id}`);if(r2.ok)setActivePackingOrder(await r2.json());fetchData();}
                              else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}
                            }} className="bg-cyan-600 text-white px-4 py-2 rounded-xl font-black text-xs hover:bg-cyan-700 transition-colors flex items-center gap-1"><CheckCircle2 size={13}/> OK</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <button onClick={async()=>{
                    const r=await apiFetch(`${host}/api/packing-orders/${activePackingOrder.id}/complete`,{method:'POST'});
                    if(r.ok){showMsg('✅ Orden de empaque completada');setActivePackingOrder(null);fetchData();}
                    else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}
                  }} className="w-full bg-emerald-600 text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition-colors">Completar Orden</button>
                </div>
              )}
            </div>
          )}

          {/* ═══════════════ DEVOLUCIONES ═══════════════ */}
          {activeTab === 'returns' && (
            <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in">
              <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center"><ArrowLeft className="w-7 h-7 mr-3 text-cyan-600"/> Gestión de Devoluciones</h2>

              {returnInspectId ? (
                <div className="bg-white rounded-2xl border-2 border-amber-200 shadow-sm p-6 space-y-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-black text-slate-800 uppercase">Inspeccionar Devolución #{returnInspectId}</h3>
                    <button onClick={()=>setReturnInspectId(null)} className="text-slate-400 hover:text-slate-600"><X size={18}/></button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Disposición</label>
                      <select value={returnInspectForm.disposition} onChange={e=>setReturnInspectForm({...returnInspectForm,disposition:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-amber-400 bg-white mt-1">
                        <option value="RESTOCK">RESTOCK — Devolver a stock</option>
                        <option value="SCRAP">SCRAP — Dar de baja</option>
                        <option value="SUPPLIER">SUPPLIER — Devolver a proveedor</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Cantidad Aceptada</label>
                      <input type="number" min="0" value={returnInspectForm.qty_accepted} onChange={e=>setReturnInspectForm({...returnInspectForm,qty_accepted:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-amber-400 mt-1 text-center"/>
                    </div>
                    {returnInspectForm.disposition==='RESTOCK' && (
                      <div className="col-span-2">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Ubicación Destino (RESTOCK)</label>
                        <LocPicker value={returnInspectForm.location_to} onChange={v=>setReturnInspectForm({...returnInspectForm,location_to:v})} safeLocs={locations}/>
                      </div>
                    )}
                    <div className="col-span-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Notas de Condición</label>
                      <textarea value={returnInspectForm.condition_notes} onChange={e=>setReturnInspectForm({...returnInspectForm,condition_notes:e.target.value})} rows={3} placeholder="Describir estado del producto..." className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-amber-400 mt-1 resize-none"/>
                    </div>
                  </div>
                  <button onClick={async()=>{
                    if(!returnInspectForm.qty_accepted){showMsg('⛔ Ingresa cantidad aceptada',true);return;}
                    const r=await apiFetch(`${host}/api/returns/${returnInspectId}/inspect`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(returnInspectForm)});
                    if(r.ok){showMsg('✅ Inspección registrada');setReturnInspectId(null);setReturnInspectForm({disposition:'RESTOCK',condition_notes:'',qty_accepted:'',location_to:''});fetchData();}
                    else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}
                  }} className="w-full bg-amber-600 text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-amber-700 transition-colors">Registrar Inspección</button>
                </div>
              ) : (
                <div className="space-y-3">
                  {returns.length===0 ? <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400 font-bold">Sin devoluciones registradas.</div> : returns.map(r=>(
                    <div key={r.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-start justify-between">
                      <div>
                        <p className="font-black text-slate-800">{r.original_doc_num || `RET-${r.id}`}</p>
                        <p className="text-xs text-slate-500">{is3PLMode ? `Cliente: ${r.client_name||r.client_id} — ` : ''}SKU: {r.sku} — Qty: {r.qty_returned}</p>
                        <p className="text-xs text-slate-400">Motivo: {r.return_reason}</p>
                        <span className={`mt-2 inline-block text-[9px] font-black uppercase px-2 py-1 rounded border ${r.inspection_status==='INSPECCIONADO'?'bg-emerald-50 text-emerald-600 border-emerald-200':'bg-amber-50 text-amber-600 border-amber-200'}`}>{r.inspection_status||'PENDIENTE'}</span>
                      </div>
                      {r.inspection_status !== 'INSPECCIONADO' && (
                        <button onClick={()=>{setReturnInspectId(r.id);setReturnInspectForm({disposition:'RESTOCK',condition_notes:'',qty_accepted:r.qty_returned,location_to:'PISO-RECEPCION'});}} className="text-xs bg-amber-50 hover:bg-amber-100 text-amber-700 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors"><ClipboardCheck size={12}/> Inspeccionar</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══════════════ MUELLES / YARD ═══════════════ */}
          {activeTab === 'docks' && (
            <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center"><Truck className="w-7 h-7 mr-3 text-cyan-600"/> Gestión de Muelles</h2>
                <div className="flex gap-2">
                  <button onClick={()=>setDockView(dockView==='appointments'?'docks':'appointments')} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl font-black uppercase tracking-widest transition-colors">
                    {dockView==='appointments'?'Ver Muelles':'Ver Citas'}
                  </button>
                </div>
              </div>

              {dockView==='docks' && (
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <h3 className="font-black text-sm text-slate-600 uppercase tracking-widest mb-4 border-b border-slate-100 pb-2">Registrar Muelle</h3>
                    <form onSubmit={async(e)=>{e.preventDefault();const method=dockEditId?'PUT':'POST';const url=dockEditId?`${host}/api/docks/${dockEditId}`:`${host}/api/docks`;const r=await apiFetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(dockForm)});if(r.ok){showMsg('✅ Muelle guardado');setDockForm({dock_code:'',name:'',dock_type:'INBOUND',capacity:1,notes:''});setDockEditId(null);fetchData();}else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}}} className="grid grid-cols-2 gap-4">
                      <input required value={dockForm.dock_code} onChange={e=>setDockForm({...dockForm,dock_code:e.target.value})} placeholder="Código Muelle (ej: DOCK-01) *" className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400 uppercase"/>
                      <input required value={dockForm.name} onChange={e=>setDockForm({...dockForm,name:e.target.value})} placeholder="Nombre *" className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400"/>
                      <select value={dockForm.dock_type} onChange={e=>setDockForm({...dockForm,dock_type:e.target.value})} className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400 bg-white">
                        <option value="INBOUND">INBOUND (Recepción)</option>
                        <option value="OUTBOUND">OUTBOUND (Despacho)</option>
                        <option value="BOTH">BOTH (Mixto)</option>
                      </select>
                      <input type="number" min="1" value={dockForm.capacity} onChange={e=>setDockForm({...dockForm,capacity:parseInt(e.target.value)})} placeholder="Capacidad" className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400 text-center"/>
                      <div className="col-span-2 flex gap-3">
                        <input value={dockForm.notes} onChange={e=>setDockForm({...dockForm,notes:e.target.value})} placeholder="Notas" className="flex-1 border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400"/>
                        <button type="submit" className="bg-cyan-600 text-white px-6 py-3 rounded-xl font-black text-xs uppercase hover:bg-cyan-700 transition-colors">{dockEditId?'Actualizar':'Guardar'}</button>
                      </div>
                    </form>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 font-black text-sm text-slate-600 uppercase tracking-widest">Muelles Registrados ({docks.length})</div>
                    {docks.length===0 ? <div className="p-10 text-center text-slate-400 font-bold text-sm">Sin muelles.</div> : (
                      <div className="divide-y divide-slate-100">
                        {docks.map(d=>(
                          <div key={d.id} className="flex items-center justify-between px-6 py-4 hover:bg-slate-50">
                            <div>
                              <p className="font-black text-slate-800 font-mono">{d.dock_code}</p>
                              <p className="text-xs text-slate-500">{d.name} — {d.dock_type} — Cap: {d.capacity}</p>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={()=>{setDockEditId(d.id);setDockForm({dock_code:d.dock_code,name:d.name,dock_type:d.dock_type,capacity:d.capacity,notes:d.notes||''});}} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors"><Pencil size={12}/> Editar</button>
                              <button onClick={async()=>{if(!(await confirm({ message: '¿Eliminar muelle?', danger: true })))return;const r=await apiFetch(`${host}/api/docks/${d.id}`,{method:'DELETE'});if(r.ok){showMsg('✅ Eliminado');fetchData();}else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}}} className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors"><Trash2 size={12}/></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {dockView==='appointments' && (
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <h3 className="font-black text-sm text-slate-600 uppercase tracking-widest mb-4 border-b border-slate-100 pb-2">Nueva Cita de Muelle</h3>
                    <form onSubmit={async(e)=>{e.preventDefault();const method=apptEditId?'PUT':'POST';const url=apptEditId?`${host}/api/dock-appointments/${apptEditId}`:`${host}/api/dock-appointments`;const r=await apiFetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(apptForm)});if(r.ok){showMsg('✅ Cita guardada');setApptForm({dock_id:'',carrier:'',doc_reference:'',appt_date:'',appt_time:'',direction:'INBOUND',notes:''});setApptEditId(null);fetchData();}else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}}} className="grid grid-cols-2 gap-4">
                      <select required value={apptForm.dock_id} onChange={e=>setApptForm({...apptForm,dock_id:e.target.value})} className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400 bg-white">
                        <option value="">-- Muelle *</option>
                        {docks.map(d=><option key={d.id} value={d.id}>{d.dock_code} — {d.name}</option>)}
                      </select>
                      <select value={apptForm.direction} onChange={e=>setApptForm({...apptForm,direction:e.target.value})} className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400 bg-white">
                        <option value="INBOUND">INBOUND</option>
                        <option value="OUTBOUND">OUTBOUND</option>
                      </select>
                      <input type="date" required value={apptForm.appt_date} onChange={e=>setApptForm({...apptForm,appt_date:e.target.value})} className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400"/>
                      <input type="time" value={apptForm.appt_time} onChange={e=>setApptForm({...apptForm,appt_time:e.target.value})} className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400"/>
                      <input value={apptForm.carrier} onChange={e=>setApptForm({...apptForm,carrier:e.target.value})} placeholder="Transportista" className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400"/>
                      <input value={apptForm.doc_reference} onChange={e=>setApptForm({...apptForm,doc_reference:e.target.value})} placeholder="Referencia Documento" className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400"/>
                      <div className="col-span-2 flex gap-3">
                        <input value={apptForm.notes} onChange={e=>setApptForm({...apptForm,notes:e.target.value})} placeholder="Notas" className="flex-1 border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400"/>
                        <button type="submit" className="bg-cyan-600 text-white px-6 py-3 rounded-xl font-black text-xs uppercase hover:bg-cyan-700 transition-colors">{apptEditId?'Actualizar':'Agendar'}</button>
                      </div>
                    </form>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 font-black text-sm text-slate-600 uppercase tracking-widest">Citas Agendadas ({dockAppointments.length})</div>
                    {dockAppointments.length===0 ? <div className="p-10 text-center text-slate-400 font-bold text-sm">Sin citas.</div> : (
                      <div className="divide-y divide-slate-100">
                        {dockAppointments.map(a=>(
                          <div key={a.id} className="flex items-center justify-between px-6 py-4 hover:bg-slate-50">
                            <div>
                              <p className="font-black text-slate-800">{a.appt_date?.split('T')[0]} {a.appt_time} — {a.dock_code}</p>
                              <p className="text-xs text-slate-500">{a.direction} {a.carrier && `— ${a.carrier}`} {a.doc_reference && `| ${a.doc_reference}`}</p>
                              <span className={`mt-1 inline-block text-[9px] font-black uppercase px-2 py-0.5 rounded border ${a.status==='COMPLETADA'?'bg-emerald-50 text-emerald-600 border-emerald-200':a.status==='EN_PROCESO'?'bg-blue-50 text-blue-600 border-blue-200':a.status==='CANCELADA'?'bg-red-50 text-red-600 border-red-200':'bg-amber-50 text-amber-600 border-amber-200'}`}>{a.status}</span>
                            </div>
                            <div className="flex gap-2 flex-wrap justify-end">
                              {a.status==='AGENDADA' && <>
                                <button onClick={async()=>{const r=await apiFetch(`${host}/api/dock-appointments/${a.id}/status`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'EN_PROCESO'})});if(r.ok){showMsg('✅ En proceso');fetchData();}}} className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg font-bold transition-colors">Iniciar</button>
                                <button onClick={async()=>{const r=await apiFetch(`${host}/api/dock-appointments/${a.id}/status`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'CANCELADA'})});if(r.ok){showMsg('Cancelada');fetchData();}}} className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg font-bold transition-colors">Cancelar</button>
                              </>}
                              {a.status==='EN_PROCESO' && <button onClick={async()=>{const r=await apiFetch(`${host}/api/dock-appointments/${a.id}/status`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'COMPLETADA'})});if(r.ok){showMsg('✅ Completada');fetchData();}}} className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-lg font-bold transition-colors">Completar</button>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══════════════ FACTURACIÓN 3PL ═══════════════ */}
          {activeTab === 'billing' && is3PLMode && (
            <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center"><FileText className="w-7 h-7 mr-3 text-cyan-600"/> Facturación 3PL</h2>
                <button onClick={()=>setInvoiceView(invoiceView==='list'?'new':'list')} className="bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest flex items-center gap-2 transition-colors">
                  {invoiceView==='new'?<><X size={14}/> Cancelar</>:<><Plus size={14}/> Generar Factura</>}
                </button>
              </div>

              {invoiceView==='new' && (
                <div className="bg-white rounded-2xl border-2 border-cyan-200 shadow-sm p-6 space-y-5">
                  <h3 className="font-black text-slate-800 uppercase tracking-tighter">Generar Factura por Período</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Cliente *</label>
                      <select value={invoiceGenForm.client_id} onChange={e=>setInvoiceGenForm({...invoiceGenForm,client_id:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400 bg-white mt-1">
                        <option value="">-- Seleccionar --</option>
                        {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Desde *</label>
                      <input type="date" value={invoiceGenForm.period_start} onChange={e=>setInvoiceGenForm({...invoiceGenForm,period_start:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400 mt-1"/>
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Hasta *</label>
                      <input type="date" value={invoiceGenForm.period_end} onChange={e=>setInvoiceGenForm({...invoiceGenForm,period_end:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400 mt-1"/>
                    </div>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs font-bold text-amber-800">
                    El sistema calculará automáticamente: recepciones × $5.000 + despachos × $7.000 + almacenaje por LPN × $1.500
                  </div>
                  <button onClick={async()=>{
                    if(!invoiceGenForm.client_id||!invoiceGenForm.period_start||!invoiceGenForm.period_end){showMsg('⛔ Completa todos los campos',true);return;}
                    const r=await apiFetch(`${host}/api/invoices/generate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(invoiceGenForm)});
                    if(r.ok){showMsg('✅ Factura generada');setInvoiceView('list');setInvoiceGenForm({client_id:'',period_start:'',period_end:''});fetchData();}
                    else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}
                  }} className="w-full bg-cyan-600 text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-cyan-700 transition-colors">Generar</button>
                </div>
              )}

              <div className="space-y-3">
                {invoices.length===0 ? <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400 font-bold">Sin facturas generadas.</div> : invoices.map(inv=>(
                  <div key={inv.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-black text-slate-800 font-mono">{inv.invoice_number||`INV-${inv.id}`}</p>
                        <p className="text-xs text-slate-500">Cliente: {inv.client_name||inv.client_id} — Período: {inv.period_start?.split('T')[0]} → {inv.period_end?.split('T')[0]}</p>
                        <p className="text-sm font-black text-slate-700 mt-1">Total: ${Number(inv.total_amount||0).toLocaleString('es-CL')}</p>
                        <span className={`mt-1 inline-block text-[9px] font-black uppercase px-2 py-1 rounded border ${inv.status==='PAGADA'?'bg-emerald-50 text-emerald-600 border-emerald-200':inv.status==='EMITIDA'?'bg-blue-50 text-blue-600 border-blue-200':inv.status==='ANULADA'?'bg-red-50 text-red-600 border-red-200':'bg-slate-50 text-slate-500 border-slate-200'}`}>{inv.status}</span>
                      </div>
                      <div className="flex gap-2 flex-wrap justify-end">
                        {inv.status==='BORRADOR' && <button onClick={async()=>{const r=await apiFetch(`${host}/api/invoices/${inv.id}/issue`,{method:'POST'});if(r.ok){showMsg('✅ Factura emitida');fetchData();}else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}}} className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1"><Send size={12}/> Emitir</button>}
                        {inv.status==='EMITIDA' && <button onClick={async()=>{const r=await apiFetch(`${host}/api/invoices/${inv.id}/pay`,{method:'POST'});if(r.ok){showMsg('✅ Pago registrado');fetchData();}else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}}} className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1"><CheckCircle2 size={12}/> Registrar Pago</button>}
                        {inv.status==='BORRADOR' && <button onClick={async()=>{if(!(await confirm({ message: '¿Eliminar factura?', danger: true })))return;const r=await apiFetch(`${host}/api/invoices/${inv.id}`,{method:'DELETE'});if(r.ok){showMsg('✅ Eliminada');fetchData();}else{const e2=await r.json();showMsg(`⛔ ${e2.error}`,true);}}} className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1"><Trash2 size={12}/></button>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══════════════ REPORTERÍA AVANZADA ═══════════════ */}
          {activeTab === 'advanced-reports' && (
            <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in">
              <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center"><BarChart3 className="w-7 h-7 mr-3 text-cyan-600"/> Reportería Avanzada</h2>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <div className="flex flex-wrap gap-3 mb-6">
                  {[
                    { id:'inventory-aging', label:'Antigüedad Stock', icon: Clock },
                    { id:'sku-rotation', label:'Rotación SKU', icon: RefreshCcw },
                    { id:'picker-productivity', label:'Productividad Picker', icon: UserCheck },
                    { id:'expiry-alerts', label:'Alertas Vencimiento', icon: AlertTriangle },
                    { id:'zone-occupation', label:'Ocupación Zonas', icon: MapIcon },
                  ].map(({id,label,icon:Ico})=>(
                    <button key={id} onClick={()=>setAdvReportType(id)} className={`px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest transition-colors flex items-center gap-2 border-2 ${advReportType===id?'bg-cyan-600 text-white border-cyan-600':'bg-white text-slate-600 border-slate-200 hover:border-cyan-300'}`}>
                      <Ico size={13}/> {label}
                    </button>
                  ))}
                </div>
                <button onClick={async()=>{
                  setAdvReportLoading(true);setAdvReport(null);
                  const r=await apiFetch(`${host}/api/reports/${advReportType}`).catch(()=>null);
                  setAdvReportLoading(false);
                  if(r?.ok){const d=await r.json();setAdvReport({type:advReportType,data:Array.isArray(d)?d:d.data||[]});}
                  else showMsg('⛔ Error al cargar reporte',true);
                }} disabled={advReportLoading} className="bg-cyan-600 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-cyan-700 transition-colors flex items-center gap-2">
                  {advReportLoading?<><Loader2 size={14} className="animate-spin"/> Cargando...</>:<><Download size={14}/> Generar Reporte</>}
                </button>
              </div>

              {advReport && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                    <p className="font-black text-sm text-slate-600 uppercase tracking-widest">
                      {advReport.type==='inventory-aging'&&'Antigüedad de Stock'}
                      {advReport.type==='sku-rotation'&&'Rotación de SKU'}
                      {advReport.type==='picker-productivity'&&'Productividad Pickeadores'}
                      {advReport.type==='expiry-alerts'&&'Alertas de Vencimiento'}
                      {advReport.type==='zone-occupation'&&'Ocupación de Zonas'}
                      {' '}— {advReport.data.length} registros
                    </p>
                  </div>
                  {advReport.data.length===0 ? (
                    <div className="p-10 text-center text-slate-400 font-bold">Sin datos para el reporte.</div>
                  ) : (
                    <div className="overflow-x-auto custom-scrollbar">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            {Object.keys(advReport.data[0]).map(k=>(
                              <th key={k} className="text-left px-4 py-3 font-black text-[10px] uppercase tracking-widest text-slate-500">{k.replace(/_/g,' ')}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {advReport.data.map((row,i)=>(
                            <tr key={i} className="hover:bg-slate-50">
                              {Object.values(row).map((v,j)=>(
                                <td key={j} className="px-4 py-3 font-mono text-xs text-slate-700">{v===null||v===undefined?'—':String(v)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ═══════════════ MOVIMIENTO POR SKU ═══════════════ */}
          {activeTab === 'sku-movement' && (
            <Suspense fallback={<TabLoader/>}>
              <SkuMovementTab
                apiFetch={apiFetch}
                host={host}
                clients={clients}
                currentUser={currentUser}
              />
            </Suspense>
          )}

          {/* ═══════════════ KARDEX POR SKU ═══════════════ */}
          {activeTab === 'kardex' && (
            <Suspense fallback={<TabLoader/>}>
              <KardexTab
                apiFetch={apiFetch}
                host={host}
                clients={clients}
                skuList={skus}
                currentUser={currentUser}
              />
            </Suspense>
          )}

          </div>
        </main>
      </div>

      {/* ── SANDBOX SWITCHER (solo modo demo) ─────────────────── */}
      {isDemo && (
        <SandboxSwitcher
          host={host}
          currentUser={currentUser}
          setCurrentUser={setCurrentUser}
          activeTab={activeTab}
          switchTab={switchTab}
          showMsg={(t,e) => showMsg(t,e)}
        />
      )}

      {/* ── TUTORIAL GUIADO ──────────────────────────────────────────── */}
      {isDemo && tutorial.activo && (
        <GuidedTour
          mision={tutorial.mision}
          misionActual={tutorial.misionActual}
          enCierre={tutorial.enCierre}
          completadas={tutorial.completadas}
          cargando={tutorial.cargando}
          avanzar={tutorial.avanzar}
          saltar={tutorial.saltar}
          salir={tutorial.salir}
          reiniciar={tutorial.reiniciar}
          activeTab={activeTab}
          switchTab={switchTab}
          permittedInventory={permittedInventory}
          pickTasks={pickTasks}
          notifications={notifications}
          host={host}
          apiFetch={apiFetch}
          currentUser={currentUser}
        />
      )}

      {/* ── SANDBOX WELCOME TOUR ──────────────────────────────── */}
      {showSandboxWelcome && isDemo && (
        <SandboxWelcome
          currentUser={currentUser}
          onClose={() => setShowSandboxWelcome(false)}
        />
      )}

      {/* ── MODAL DE AUDITORÍA 3D ──────────────────────────────── */}
      {locAuditModalOpen && locAudit && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={e=>e.target===e.currentTarget && setLocAuditModalOpen(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><AlertTriangle className="text-amber-500" size={18}/> Sincronización con el mapa 3D</h2>
              <button onClick={()=>setLocAuditModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-lg"><X size={18} className="text-slate-400"/></button>
            </div>
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total en BD</p>
                  <p className="text-2xl font-black text-slate-800 mt-1">{locAudit.total_in_db}</p>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
                  <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Con posición 3D</p>
                  <p className="text-2xl font-black text-emerald-700 mt-1">{locAudit.with_3d_coords}</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                  <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">Sin posición 3D</p>
                  <p className="text-2xl font-black text-amber-700 mt-1">{locAudit.without_3d_coords}</p>
                </div>
              </div>

              {locAudit.locations_without_3d?.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-2">Ubicaciones sin posición ({locAudit.locations_without_3d.length})</p>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 max-h-48 overflow-y-auto space-y-1">
                    {locAudit.locations_without_3d.map(l => (
                      <div key={l.location_id} className="flex items-center justify-between text-xs">
                        <span className="font-mono font-black text-amber-800">{l.location_id}</span>
                        <span className="text-[10px] text-amber-600">{l.zone_code || '—'} · {l.loc_type} · {l.qty_lpns} LPN</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {locAudit.duplicate_positions?.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-red-700 uppercase tracking-widest mb-2">Coordenadas duplicadas ({locAudit.duplicate_positions.length})</p>
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 max-h-32 overflow-y-auto space-y-1">
                    {locAudit.duplicate_positions.map((d, i) => (
                      <div key={i} className="text-xs">
                        <span className="font-mono font-black text-red-700">[{d.x},{d.y},{d.z}]</span>
                        <span className="text-[10px] text-red-600 ml-2">{d.location_ids.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {locAudit.orphan_inventory?.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-rose-700 uppercase tracking-widest mb-2">Inventario en ubicaciones que no existen ({locAudit.orphan_inventory.length})</p>
                  <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 max-h-32 overflow-y-auto space-y-1">
                    {locAudit.orphan_inventory.map(o => (
                      <div key={o.location_id} className="flex items-center justify-between text-xs">
                        <span className="font-mono font-black text-rose-700">{o.location_id}</span>
                        <span className="text-[10px] text-rose-600">{o.lpn_count} LPN(s) huérfanos</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL DE SUSTITUTOS (despacho 422) ─────────────────── */}
      {substituteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={e=>e.target===e.currentTarget && setSubstituteModal(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-amber-200 bg-amber-50">
              <h2 className="text-lg font-black text-amber-900 uppercase tracking-tighter flex items-center gap-2"><AlertTriangle size={18}/> Stock insuficiente</h2>
              <p className="text-[10px] font-bold text-amber-700 mt-1">El sistema sugiere productos similares con stock disponible.</p>
            </div>
            <div className="p-5 space-y-5">
              {substituteModal.items_con_deficit.map(item => {
                const data = substituteModal.substitutesBySku[item.sku];
                const selectedSku = substituteModal.selection[item.sku]?.sku || null;
                return (
                  <div key={item.sku} className="border-2 border-slate-200 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <div>
                        <p className="text-sm font-black text-slate-800">{item.sku}</p>
                        <p className="text-[10px] text-slate-500">Solicitado: <strong>{item.qty_solicitada}</strong> · Disponible: <strong>{item.qty_disponible}</strong> · <span className="text-red-600 font-black">Déficit: {item.deficit}</span></p>
                      </div>
                    </div>
                    {!data ? <p className="text-xs text-slate-400 text-center py-4">Cargando sustitutos…</p>
                      : data.substitutes.length === 0
                        ? <p className="text-xs text-slate-400 text-center py-4 bg-slate-50 rounded-xl">No hay sustitutos disponibles con stock.</p>
                        : (
                          <div className="space-y-1.5">
                            {data.substitutes.map(s => (
                              <label key={s.sku} className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${selectedSku === s.sku ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}>
                                <input type="radio" name={`subst-${item.sku}`} checked={selectedSku === s.sku} onChange={()=>setSubstituteModal(p=>({...p, selection: {...p.selection, [item.sku]: { sku: s.sku, qty: Math.min(s.available_qty, item.deficit) }}}))} className="mt-1 accent-emerald-600"/>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-sm font-black text-slate-800">{s.sku}</p>
                                    {s.match_type === 'manual'           && <span className="bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded text-[9px] font-black uppercase">★ Manual</span>}
                                    {s.match_type === 'same_manufacturer'&& <span className="bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[9px] font-black uppercase">Mismo fabricante</span>}
                                    {s.match_type === 'high_match'       && <span className="bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded text-[9px] font-black uppercase">Alta similitud</span>}
                                    {s.match_type === 'auto'             && <span className="bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded text-[9px] font-black uppercase">Auto</span>}
                                    <span className="text-[10px] font-bold text-slate-500">Stock: <strong className="text-slate-800">{s.available_qty}</strong></span>
                                    {s.similarity_score > 0 && <span className="text-[10px] font-bold text-slate-500">Similitud: <strong className="text-slate-800">{Math.round(s.similarity_score * 100)}%</strong></span>}
                                  </div>
                                  <p className="text-[11px] text-slate-600 mt-0.5">{s.desc}</p>
                                  {s.manufacturer && (s.manufacturer.name || s.manufacturer.code) && (
                                    <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1"><HardHat size={10}/> {s.manufacturer.name || s.manufacturer.code}{s.manufacturer_sku && ` · Cód. fab.: ${s.manufacturer_sku}`}{s.brand && ` · ${s.brand}`}</p>
                                  )}
                                </div>
                              </label>
                            ))}
                          </div>
                        )}
                  </div>
                );
              })}
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={()=>setSubstituteModal(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black py-3 rounded-xl uppercase text-[10px] tracking-widest">Cancelar despacho</button>
              <button
                disabled={Object.keys(substituteModal.selection).length === 0}
                onClick={async () => {
                  // Despacho con sustitutos: también exige re-clave (step-up).
                  const reauthPw = await promptReauth('despacho');
                  if (!reauthPw) return;
                  // Construir nuevo set de items mezclando original + sustitutos
                  const subItems = Object.entries(substituteModal.selection).map(([_, sel]) => ({ sku: sel.sku, qty: sel.qty }));
                  const res = await apiFetch(`${host}/api/dispatch_batch`, {
                    method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ ...substituteModal.doc, client_id: substituteModal.doc?.client, username: currentUser.username, allow_substitutes: true, substitute_items: subItems, reauth_password: reauthPw })
                  });
                  if (res.ok) {
                    showMsg('✅ Despacho con sustitutos procesado');
                    setSubstituteModal(null);
                    removeDoc('dispatch', activeDocId); setActiveDocId(null); fetchData();
                  } else {
                    const d = await res.json().catch(()=>({}));
                    showMsg(`⛔ ${d.error || 'Error al despachar'}`, true);
                  }
                }}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black py-3 rounded-xl uppercase text-[10px] tracking-widest">Confirmar despacho</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL HISTORIAL DE VERSIONES DE SKU ────────────────── */}
      {skuVersionsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={e=>e.target===e.currentTarget && setSkuVersionsModal(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter">Historial de versiones — {skuVersionsModal.sku}</h2>
              <button onClick={()=>setSkuVersionsModal(null)} className="p-2 hover:bg-slate-100 rounded-lg"><X size={18} className="text-slate-400"/></button>
            </div>
            <div className="p-5">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50"><tr>
                  <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase">Versión</th>
                  <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase">Config. lote</th>
                  <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase">Config. serie</th>
                  <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase text-right">Stock activo</th>
                  <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase">Fecha</th>
                  <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase">Motivo</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {skuVersionsModal.versions.length === 0 && (
                    <tr><td colSpan="6" className="p-6 text-center text-slate-400">Sin historial registrado.</td></tr>
                  )}
                  {skuVersionsModal.versions.map(v => (
                    <tr key={v.version} className={v.is_current ? 'bg-emerald-50/50' : ''}>
                      <td className="px-3 py-2 font-mono font-black">
                        v{v.version}
                        {v.is_current
                          ? <span className="ml-2 bg-emerald-100 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded text-[8px] font-black uppercase">✓ Actual</span>
                          : <span className="ml-2 bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded text-[8px] font-black uppercase">🔒 Histórica</span>}
                      </td>
                      <td className="px-3 py-2">{v.requires_lot ? <span className="text-emerald-700 font-black">Con lote</span> : <span className="text-slate-500">Sin lote</span>}</td>
                      <td className="px-3 py-2">{v.requires_serial ? <span className="text-emerald-700 font-black">Con serie</span> : <span className="text-slate-500">Sin serie</span>}</td>
                      <td className="px-3 py-2 text-right font-black">{v.active_stock || 0} un.</td>
                      <td className="px-3 py-2 text-[10px] text-slate-500">{v.changed_at ? new Date(v.changed_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                      <td className="px-3 py-2 text-[10px] text-slate-600 italic">{v.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-slate-600 font-medium mt-3 bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                ℹ️ El código <span className="font-mono font-black text-indigo-700">{skuVersionsModal.sku}</span> no cambia. El stock anterior se sigue despachando con su configuración original (FIFO). Las nuevas recepciones usan la configuración de la versión actual.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── QUICK FORM NUEVO FABRICANTE ────────────────────────── */}
      {showMfrQuickForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && setShowMfrQuickForm(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md animate-in zoom-in-95">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><HardHat size={16} className="text-indigo-500"/> Nuevo fabricante</h2>
              <button onClick={()=>setShowMfrQuickForm(false)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={16} className="text-slate-400"/></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase">Código (dejá vacío para auto)</label>
                <input type="text" value={manufacturerForm.code} onChange={e=>setManufacturerForm(p=>({...p, code: e.target.value.toUpperCase()}))} placeholder="Ej: FAB-006" className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-indigo-500 uppercase"/>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase">Nombre *</label>
                <input type="text" value={manufacturerForm.name} onChange={e=>setManufacturerForm(p=>({...p, name: e.target.value}))} required placeholder="Nombre comercial" className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-indigo-500"/>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase">País</label>
                <input type="text" value={manufacturerForm.country} onChange={e=>setManufacturerForm(p=>({...p, country: e.target.value}))} placeholder="Ej: Chile" className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-indigo-500"/>
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={()=>setShowMfrQuickForm(false)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black py-2.5 rounded-xl uppercase text-[10px] tracking-widest">Cancelar</button>
              <button disabled={!manufacturerForm.name.trim()} onClick={async()=>{
                const created = await handleSaveManufacturer();
                if (created) {
                  setSkuForm(p => ({ ...p, manufacturer_id: String(created.id), manufacturer_code: created.code }));
                  setShowMfrQuickForm(false);
                }
              }} className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black py-2.5 rounded-xl uppercase text-[10px] tracking-widest">Crear y seleccionar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── BOTÓN FLOTANTE DE SUGERENCIAS ──────────────────────── */}
      {currentUser && !['PICKER','CLIENTE','DEMO'].includes(currentUser.role) && !currentUser.is_demo && (
        <button
          onClick={() => setShowFeedbackModal(true)}
          className="fixed bottom-6 right-6 z-40 bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-full w-14 h-14 shadow-xl shadow-amber-300/50 flex items-center justify-center transition-transform hover:scale-110 active:scale-95"
          title="Sugerir una mejora"
        >
          <Lightbulb size={22}/>
        </button>
      )}

      {/* ── MODAL DE FEEDBACK ──────────────────────────────────── */}
      {showFeedbackModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && setShowFeedbackModal(false)}>
          <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-lg animate-in zoom-in-95">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
                  <Lightbulb className="text-amber-600" size={20}/>
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter">Sugerir Mejora</h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Tu comentario va al equipo de desarrollo</p>
                </div>
              </div>
              <button onClick={() => setShowFeedbackModal(false)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18} className="text-slate-400"/></button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Tipo</label>
                <div className="grid grid-cols-3 gap-2">
                  {[['BUG','🐛 Bug','red'],['MEJORA','💡 Mejora','amber'],['IDEA','✨ Idea','indigo']].map(([id,label,color]) => (
                    <button key={id} onClick={() => setFeedbackForm(p=>({...p, category: id}))} className={`p-3 rounded-xl text-xs font-black border-2 transition-colors ${feedbackForm.category===id ? `bg-${color}-100 border-${color}-500 text-${color}-700` : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Mensaje *</label>
                <textarea
                  value={feedbackForm.message}
                  onChange={e => setFeedbackForm(p=>({...p, message: e.target.value}))}
                  maxLength={4000}
                  rows={6}
                  placeholder="Describe el bug, la mejora o la idea con todo el detalle posible…"
                  className="w-full border-2 border-slate-200 focus:border-amber-500 rounded-xl px-4 py-3 text-sm font-medium outline-none resize-none transition-colors"
                />
                <p className="text-[10px] font-bold text-slate-400 mt-1 text-right">{feedbackForm.message.length} / 4000</p>
              </div>
              <div className="bg-slate-50 rounded-xl px-3 py-2 text-[10px] font-bold text-slate-500 flex items-center gap-2">
                <Info size={11}/> Como <span className="font-mono text-indigo-700">@{currentUser?.username}</span> · módulo actual: <span className="font-mono text-slate-700">{activeTab}</span>
              </div>
            </div>

            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => setShowFeedbackModal(false)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black py-3 rounded-2xl uppercase text-[10px] tracking-widest">Cancelar</button>
              <button
                disabled={feedbackBusy || feedbackForm.message.trim().length < 5}
                onClick={async () => {
                  setFeedbackBusy(true);
                  try {
                    const res = await apiFetch(`${host}/api/feedback`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ category: feedbackForm.category, message: feedbackForm.message.trim(), page: activeTab }),
                    });
                    const d = await res.json().catch(()=>({}));
                    if (res.ok) {
                      showMsg('✅ Gracias por tu comentario');
                      setFeedbackForm({ category: 'MEJORA', message: '' });
                      setShowFeedbackModal(false);
                    } else {
                      showMsg(`⛔ ${d.error || 'Error al enviar feedback'}`, true);
                    }
                  } catch (e) { showMsg('⛔ Error de red', true); }
                  finally { setFeedbackBusy(false); }
                }}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-black py-3 rounded-2xl uppercase text-[10px] tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {feedbackBusy ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}
                {feedbackBusy ? 'Enviando…' : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
