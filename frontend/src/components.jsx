// Componentes pre-App extraídos de App.js (split)
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  FolderOpen, Trash2, CheckCircle2, Search, X,
  Box, Calendar, Combine, Edit, Eye, Layers, Map as MapIcon,
  Scan, Split, Tag, Warehouse, XCircle,
  Database, Download, Loader2, Upload, ShieldAlert, Lightbulb, Building2
} from 'lucide-react';
import { timeAgo, apiFetch, parseSpreadsheet } from './utils';
import { DEMO_GLOSA_OPTIONS, IMPORT_CONFIG, DEMO_HINTS, SANDBOX_SCENARIOS, SANDBOX_ROLES, SANDBOX_MISSIONS } from './constants';

// GlobalStyles: noop tras migrar a Tailwind build local (P14).
// Los estilos globales viven en src/index.css; Tailwind se compila vía PostCSS.
// El CDN script fue removido (causaba advertencia "do not use cdn.tailwindcss.com in production").
const GlobalStyles = () => null;

const SimpleDonut = ({ data, colors }) => {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let cumulativePercent = 0;
  if(total === 0) return <div className="w-24 h-24 rounded-full bg-slate-100 border-4 border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-400">Vacío</div>;

  return (
    <svg viewBox="-1 -1 2 2" className="w-28 h-28 transform -rotate-90 drop-shadow-md">
      {data.map((item, i) => {
        if (item.value === 0) return null;
        const startPercent = cumulativePercent;
        const endPercent = cumulativePercent + (item.value / total);
        cumulativePercent = endPercent;
        
        if (item.value === total) return <circle key={i} cx="0" cy="0" r="1" fill={colors[i % colors.length]} />;

        const startX = Math.cos(2 * Math.PI * startPercent);
        const startY = Math.sin(2 * Math.PI * startPercent);
        const endX = Math.cos(2 * Math.PI * endPercent);
        const endY = Math.sin(2 * Math.PI * endPercent);
        const largeArcFlag = (item.value / total) > 0.5 ? 1 : 0;
        const pathData = [`M ${startX} ${startY}`, `A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY}`, `L 0 0`].join(' ');

        return <path key={i} d={pathData} fill={colors[i % colors.length]} />;
      })}
      <circle cx="0" cy="0" r="0.65" fill="white" />
    </svg>
  );
};

const DocTrayView = ({
  module, title, colorClass, textClass, btnColor, Icon,
  workspaces, newDocNum, setNewDocNum, newDocType, setNewDocType, newDocGlosa, setNewDocGlosa,
  newDocDate, setNewDocDate, newDocRef, setNewDocRef, newDocEnteredAt, setNewDocEnteredAt,
  documentTypes, handleCreateDoc, removeDoc, setActiveDocId, currentUser,
  is3PLMode, opsClients = [], newDocClient, setNewDocClient
}) => {
  const docs = workspaces[module] || [];
  const clientName = (id) => (opsClients.find(c => c.id === id)?.name) || id;
  const allowedTypes = (documentTypes || []).filter(d => d.flow_type === 'BOTH' || d.flow_type === (module === 'receive' ? 'INBOUND' : module === 'dispatch' ? 'OUTBOUND' : 'BOTH'));
  const canDeleteDoc = ['ADMIN', 'SUPERADMIN'].includes(currentUser?.role);

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
        <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center border-b border-slate-100 pb-4 mb-6">
          <Icon className={`w-6 h-6 mr-2 ${textClass}`}/> Crear Nuevo {title}
        </h2>
        <form onSubmit={(e) => handleCreateDoc(e, module)} className="flex flex-col gap-4">
          {is3PLMode && (
            <div className="space-y-1">
              <label className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-1"><Building2 size={12}/> Cliente del movimiento *</label>
              <select value={newDocClient || ''} onChange={e=>setNewDocClient(e.target.value)} required className="w-full border-2 border-indigo-200 bg-indigo-50 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 text-indigo-800">
                <option value="">-- Seleccione el cliente --</option>
                {opsClients.map(c => <option key={c.id} value={c.id}>{c.id} - {c.name}</option>)}
              </select>
              {opsClients.length === 0 && <p className="text-[9px] text-red-500 font-bold">No tiene clientes asignados para operar.</p>}
            </div>
          )}
          <div className="flex gap-4">
            {module !== 'adjust' && (
              <select value={newDocType} onChange={e=>setNewDocType(e.target.value)} required className="flex-[0.5] border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-slate-500 bg-white uppercase">
                <option value="">-- TIPO DOC --</option>
                {allowedTypes.map(d => <option key={d.id} value={d.id}>{d.description}</option>)}
              </select>
            )}
            <div className="flex-1 space-y-1">
              <input type="text" value={newDocNum} onChange={e=>setNewDocNum(e.target.value)} placeholder="Número de Documento / Ref Interna *" className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-slate-500 uppercase" required/>
            </div>
          </div>
          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 space-y-1 min-w-[140px]">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Fecha Documento</label>
              <input type="date" value={newDocDate} onChange={e=>setNewDocDate(e.target.value)} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-slate-500 bg-white" />
            </div>
            <div className="flex-[1.5] space-y-1 min-w-[160px]">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Referencia (OC / Factura)</label>
              <input type="text" value={newDocRef} onChange={e=>setNewDocRef(e.target.value)} placeholder="Ej: OC-2024-001" className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-slate-500 uppercase" />
            </div>
            <div className="flex-1 space-y-1 min-w-[180px]">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Fecha de Digitado</label>
              <input type="datetime-local" value={newDocEnteredAt} onChange={e=>setNewDocEnteredAt(e.target.value)} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-slate-500 bg-white" />
            </div>
          </div>
          <div className="flex gap-4">
            <div className="flex-[1.5] space-y-1">
              {(currentUser?.role === 'DEMO' || currentUser?.is_demo) && DEMO_GLOSA_OPTIONS[module] ? (
                <select value={newDocGlosa} onChange={e=>setNewDocGlosa(e.target.value)} className="w-full border-2 border-amber-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-amber-400 bg-amber-50 text-slate-700">
                  <option value="">— Seleccionar comentario (Opcional) —</option>
                  {DEMO_GLOSA_OPTIONS[module].map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : (
                <input type="text" value={newDocGlosa} onChange={e=>setNewDocGlosa(e.target.value)} placeholder="Observaciones / Chofer / Notas (Opcional)" className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-slate-500" />
              )}
            </div>
            <button type="submit" className={`px-6 py-3 rounded-xl font-black text-white text-xs uppercase tracking-widest shadow-md transition-transform hover:scale-105 ${btnColor}`}>Comenzar</button>
          </div>
        </form>
      </div>

      <h3 className="text-sm font-black text-slate-600 uppercase tracking-widest mt-8 mb-4 border-b border-slate-200 pb-2 flex items-center justify-between">
        <span>Documentos "En Proceso" (Borradores)</span>
        <span className="bg-slate-200 text-slate-600 px-2 py-1 rounded-lg text-[10px]">{docs.length} Pendientes</span>
      </h3>
      {docs.length === 0 ? (
         <div className="bg-slate-100 border-2 border-dashed border-slate-300 rounded-3xl p-10 text-center text-slate-400">
           <FolderOpen className="w-12 h-12 mx-auto mb-2 opacity-50" />
           <p className="font-bold uppercase tracking-widest text-xs">Bandeja Vacía</p>
         </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {docs.map(d => (
            <div key={d.id} className="bg-white p-5 rounded-2xl border-l-8 shadow-sm hover:shadow-md transition-all cursor-pointer border-slate-200 flex flex-col" style={{ borderLeftColor: '#f59e0b' }}>
              <div className="flex justify-between items-start mb-3">
                <div>
                  <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest">En Proceso / Parcial</span>
                  <h4 className="text-lg font-black text-slate-800 uppercase mt-2 leading-none">[{d.docType || 'AJUSTE'}] {d.docNum}</h4>
                  {d.client && <p className="text-[10px] font-black text-indigo-600 uppercase mt-1 flex items-center gap-1"><Building2 size={11}/> {clientName(d.client)}</p>}
                  {d.glosa && <p className="text-xs text-slate-500 mt-1 italic truncate">"{d.glosa}"</p>}
                  <div className="flex flex-wrap gap-2 mt-2">
                    {d.docDate && <span className="text-[9px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">📅 Doc: {d.docDate}</span>}
                    {d.docRef && <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">Ref: {d.docRef}</span>}
                  </div>
                </div>
                {canDeleteDoc && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); removeDoc(module, d.id); }} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={16}/></button>
                )}
              </div>
              <div className="mt-auto border-t border-slate-100 pt-3 flex justify-between items-center">
                <div>
                  {(() => {
                    const ago = timeAgo(d.createdAt);
                    const isOld = d.createdAt && (Date.now() - (() => { try { const p = d.createdAt.includes('/') ? new Date(d.createdAt.split(', ')[0].split('/').reverse().join('-')+'T'+(d.createdAt.split(', ')[1]||'00:00')) : new Date(d.createdAt); return p.getTime(); } catch(e){return Date.now();} })()) > 86400000;
                    return <p className={`text-[10px] font-bold ${isOld ? 'text-amber-500' : 'text-slate-400'}`}>Iniciado: {d.createdAt} <span className="font-black">({ago})</span>{isOld && ' ⚠️'}</p>;
                  })()}
                  {d.docEnteredAt && <p className="text-[9px] font-bold text-slate-400">Digitado: {d.docEnteredAt.replace('T',' ')}</p>}
                </div>
                <p className="text-[10px] font-black text-slate-600 uppercase bg-slate-100 px-2 py-1 rounded">{d.items.length} Líneas Extraídas</p>
              </div>
              <button type="button" onClick={() => setActiveDocId(d.id)} className={`w-full mt-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-center text-white shadow-sm ${btnColor}`}>Abrir y Continuar</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function LocPicker({ value, onChange, safeLocs, placeholder = 'Buscar o escribir ubicación...', compact = false }) {
  const [query, setQuery] = React.useState(value || '');
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => { setQuery(value || ''); }, [value]);

  const allLocs = React.useMemo(() => {
    const ids = safeLocs.map(l => l.location_id);
    return ['PISO-RECEPCION', ...ids];
  }, [safeLocs]);

  const filtered = React.useMemo(() => {
    if (!query) return allLocs.slice(0, 40);
    const q = query.toUpperCase();
    return allLocs.filter(id => id.includes(q)).slice(0, 40);
  }, [query, allLocs]);

  const isValid = value && (value === 'PISO-RECEPCION' || safeLocs.some(l => l.location_id === value));
  const isInvalid = value && !isValid;

  return (
    <div className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={e => {
            const v = e.target.value.toUpperCase();
            setQuery(v);
            onChange('');
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 160)}
          placeholder={placeholder}
          className={`w-full border-2 rounded-xl font-mono font-black uppercase outline-none transition-colors pr-8
            ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'}
            ${isValid ? 'border-emerald-400 bg-emerald-50 text-emerald-800 focus:border-emerald-500'
              : isInvalid ? 'border-red-300 bg-red-50 text-red-700 focus:border-red-400'
              : 'border-slate-200 bg-white text-slate-800 focus:border-purple-400'}`}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          {isValid   && <CheckCircle2 size={14} className="text-emerald-500"/>}
          {isInvalid && <X           size={14} className="text-red-400"/>}
          {!value    && <Search      size={13} className="text-slate-300"/>}
        </span>
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border-2 border-slate-200 rounded-xl shadow-2xl max-h-56 overflow-y-auto custom-scrollbar">
          {filtered.map(id => {
            const loc = safeLocs.find(l => l.location_id === id);
            const isSel = id === value;
            return (
              <button key={id} type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(id); setQuery(id); setOpen(false); }}
                className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 border-b border-slate-100 last:border-0 transition-colors
                  ${isSel ? 'bg-purple-50' : 'hover:bg-slate-50'}`}
              >
                <span className={`font-mono text-xs font-black ${isSel ? 'text-purple-700' : 'text-slate-700'}`}>{id}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {loc?.zone_code && (
                    <span className="text-[8px] font-black bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase">{loc.zone_code}</span>
                  )}
                  {isSel && <CheckCircle2 size={11} className="text-purple-500"/>}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {isInvalid && (
        <p className="text-[9px] text-red-500 font-bold mt-1 flex items-center gap-1">
          <X size={9}/> Ubicación no registrada — créala en Diseño Bodega primero
        </p>
      )}
    </div>
  );
}

// ── Helper exportable: convierte una ubicación de la BD en posición 3D ──────
// Prioriza:
//   1) Campos x/y/z guardados explícitamente en la BD (sincronizado).
//   2) Fallback: calcular desde aisle/row_num/level si existen.
//   3) Último fallback: parsear regex sobre location_id (legacy).
// Devuelve además las dimensiones del rack para el render 3D.
export function getPosition(loc) {
  if (!loc) return { x: 0, y: 0, z: 0, width: 1, depth: 1, height: 1 };
  const w = loc.width  != null ? parseFloat(loc.width)  : 1.2;
  const d = loc.depth  != null ? parseFloat(loc.depth)  : 0.8;
  const h = loc.height != null ? parseFloat(loc.height) : 2.0;
  // 1) coords de BD
  if (loc.x !== null && loc.x !== undefined && loc.y !== null && loc.y !== undefined && loc.z !== null && loc.z !== undefined) {
    return { x: parseFloat(loc.x), y: parseFloat(loc.y), z: parseFloat(loc.z), width: w, depth: d, height: h };
  }
  // 2) aisle/row_num/level
  if (loc.aisle != null) {
    const asNum    = parseInt(String(loc.aisle).replace(/\D/g, ''), 10);
    const asLetter = String(loc.aisle).charCodeAt(0) - 65;
    const aisleIdx = isNaN(asNum) || /^[A-Za-z]/.test(String(loc.aisle)) ? Math.max(0, asLetter) : (asNum - 1);
    return {
      x: aisleIdx * 2.5,
      y: ((parseInt(loc.level) || 1) - 1) * 2.2,
      z: ((parseInt(loc.row_num) || 1) - 1) * 1.5,
      width: w, depth: d, height: h,
    };
  }
  // 3) regex: acepta pasillo en mayúscula, minúscula o número — p.ej. "a-01-1" o "A-01-2"
  const match = (loc.location_id || '').match(/([A-Za-z0-9]+)-(\d+)-(\d+)$/);
  if (match) {
    const aisleStr = match[1].toUpperCase();
    const asNum    = parseInt(aisleStr.replace(/\D/g, ''), 10);
    const asLetter = aisleStr.charCodeAt(0) - 65;
    const aisleIdx = isNaN(asNum) || /^[A-Z]/.test(aisleStr) ? Math.max(0, asLetter) : (asNum - 1);
    return {
      x: aisleIdx * 2.5,
      y: (parseInt(match[3]) - 1) * 2.2,
      z: (parseInt(match[2]) - 1) * 1.5,
      width: w, depth: d, height: h,
    };
  }
  return { x: 0, y: 0, z: 0, width: w, depth: d, height: h };
}

function DigitalTwinView({ inventory, locations, warehouses, zones, getStatusBadge, clients, userRole }) {
  // Editar el layout (unir/bloquear casillas) solo desde JEFE_BODEGA o superior.
  const canEditLayout = ['JEFE_BODEGA', 'ADMIN', 'SUPERADMIN'].includes(userRole);
  const [hoveredLoc, setHoveredLoc] = useState(null);
  const [selectedLoc, setSelectedLoc] = useState(null);

  // Estado de bodega y zona — deben declararse ANTES de derivedZones (evita TDZ).
  const [activeWH, setActiveWH] = useState(warehouses[0]?.id || 'B1');
  const [activeZ, setActiveZ] = useState(() => {
    const codes = [...new Set(locations.map(l => l.zone_code).filter(Boolean))];
    return codes[0] || zones?.[0]?.id || 'RES';
  });

  // Derivar zonas desde los datos reales en BD, filtradas por la bodega activa.
  // Para formato 4 seg: solo zonas de ubicaciones cuyo parts[0] === activeWH.
  // Fallback a todas las zonas si no hay match (legacy o sin bodega).
  const derivedZones = useMemo(() => {
    const locsForWH = locations.filter(l => {
      if (!l.location_id) return false;
      const p = l.location_id.split('-');
      return p.length === 4 ? p[0] === activeWH : true;
    });
    const codes = [...new Set(locsForWH.map(l => l.zone_code).filter(Boolean))].sort();
    if (codes.length === 0) {
      const allCodes = [...new Set(locations.map(l => l.zone_code).filter(Boolean))].sort();
      if (allCodes.length === 0) return zones?.length ? zones : [{ id: 'RES', name: 'Reserva' }];
      return allCodes.map(code => zones?.find(z => z.id === code) || { id: code, name: code });
    }
    return codes.map(code => zones?.find(z => z.id === code) || { id: code, name: code });
  }, [locations, zones, activeWH]);

  const [editMode, setEditMode] = useState(false);
  const [blockedLocs, setBlockedLocs] = useState(new Set());
  const [editSelection, setEditSelection] = useState(new Set());
  const [mergedBlocks, setMergedBlocks] = useState([]);

  // REN-07: pre-calcular mapa location→items para O(1) por celda en lugar de O(n*m)
  const inventoryByLocation = useMemo(() => {
    const map = new Map();
    inventory.forEach(inv => {
      if (!map.has(inv.location_id)) map.set(inv.location_id, []);
      map.get(inv.location_id).push(inv);
    });
    return map;
  }, [inventory]);

  // Pre-mapa locId → posición 3D resuelta (BD > aisle/row/level > regex).
  // El grid actual sigue usando aisle/level/col para el render del grid 2D,
  // pero ahora también incluye las locations sin prefijo si tienen aisle.
  const positionByLoc = useMemo(() => {
    const map = new Map();
    locations.forEach(l => map.set(l.location_id, getPosition(l)));
    return map;
  }, [locations]);

  // Filtrar por bodega activa Y zona activa.
  // Formato 4 seg {wh}-{aisle}-{col}-{lvl}: bodega en parts[0], zona en zone_code.
  // Legacy sin zone_code: filtrar por prefijo {wh}-{zone}-.
  const activeLocations = useMemo(() => locations.filter(l => {
    if (!l.location_id) return false;
    if (l.zone_code) {
      if (l.zone_code !== activeZ) return false;
      const parts = l.location_id.split('-');
      // Formato 4 segmentos: primer segmento es el número de bodega
      if (parts.length === 4) return parts[0] === activeWH;
      return true; // legacy con zone_code: mostrar si zona coincide
    }
    return l.location_id.startsWith(`${activeWH}-${activeZ}-`);
  }), [locations, activeWH, activeZ]);

  // Mapa posición (aisle, col-0idx, lvl-0idx) → location_id real de BD.
  // Soporta nuevo formato 4 seg: {bodega}-{pasillo}-{col_padded}-{fila}
  // y legacy: RACK-A-01, B1-RES-A-01-01.
  const gridLocMap = useMemo(() => {
    const map = {};
    activeLocations.forEach(loc => {
      let aisle, col0, lvl0;
      if (loc.aisle != null && loc.row_num != null && loc.level != null) {
        aisle = String(loc.aisle);
        col0  = parseInt(loc.row_num, 10) - 1;
        lvl0  = parseInt(loc.level,   10) - 1;
      } else {
        // Nuevo formato: {warehouse}-{aisle}-{col_padded}-{level}  (4 partes)
        const parts = loc.location_id.split('-');
        if (parts.length === 4) {
          aisle = parts[1];
          col0  = parseInt(parts[2], 10) - 1;
          lvl0  = parseInt(parts[3], 10) - 1;
        }
        // Formato 5 partes legacy: {WH}-{ZONE}-{AISLE}-{COL}-{LVL}
        if (aisle == null && parts.length === 5) {
          aisle = parts[2];
          col0  = parseInt(parts[3], 10) - 1;
          lvl0  = parseInt(parts[4], 10) - 1;
        }
        // Patrón legacy PREFIX-AISLE-ROW (3 partes, ej. RACK-A-01)
        if (aisle == null) {
          const m = loc.location_id.match(/^(?:[A-Za-z0-9]+-)?([A-Za-z0-9]+)-(\d+)$/);
          if (m) { aisle = m[1]; col0 = parseInt(m[2], 10) - 1; lvl0 = 0; }
        }
      }
      if (aisle != null && !isNaN(col0) && !isNaN(lvl0) && col0 >= 0 && lvl0 >= 0) {
        if (!map[aisle]) map[aisle] = {};
        if (!map[aisle][col0]) map[aisle][col0] = {};
        map[aisle][col0][lvl0] = loc.location_id;
      }
    });
    return map;
  }, [activeLocations, activeWH, activeZ]);

  let aislesSet = new Set();
  let maxCol = 0;
  let maxLvl = 0;

  activeLocations.forEach(loc => {
    // Caso 1: ubicación con coords derivadas (aisle/row_num/level en BD)
    if (loc.aisle != null) {
      aislesSet.add(String(loc.aisle));
      const col = parseInt(loc.row_num, 10);
      const lvl = parseInt(loc.level, 10);
      if (!isNaN(col) && col > maxCol) maxCol = col;
      if (!isNaN(lvl) && lvl > maxLvl) maxLvl = lvl;
      return;
    }
    const parts = loc.location_id.split('-');
    // Caso 2: formato 4 segmentos {wh}-{aisle}-{col}-{lvl} con zone_code
    if (parts.length === 4 && loc.zone_code) {
      aislesSet.add(parts[1]);
      const col = parseInt(parts[2], 10);
      const lvl = parseInt(parts[3], 10);
      if (!isNaN(col) && col > maxCol) maxCol = col;
      if (!isNaN(lvl) && lvl > maxLvl) maxLvl = lvl;
      return;
    }
    // Caso 3: formato legacy con prefijo {wh}-{zone}-{aisle}-{col}-{lvl}
    const prefix = `${activeWH}-${activeZ}-`;
    if (loc.location_id.startsWith(prefix)) {
      const tail = loc.location_id.substring(prefix.length).split('-');
      if (tail.length >= 3) {
        aislesSet.add(tail[0]);
        const col = parseInt(tail[1], 10);
        const lvl = parseInt(tail[2], 10);
        if (!isNaN(col) && col > maxCol) maxCol = col;
        if (!isNaN(lvl) && lvl > maxLvl) maxLvl = lvl;
        return;
      }
    }
    // Caso 4: patrón legacy PREFIX-AISLE-ROW (3 partes, ej. RACK-A-01)
    const m = loc.location_id.match(/^(?:[A-Z0-9]+-)?([A-Za-z0-9]+)-(\d+)$/);
    if (m) {
      aislesSet.add(m[1]);
      const col = parseInt(m[2], 10);
      if (!isNaN(col) && col > maxCol) maxCol = col;
      if (maxLvl < 1) maxLvl = 1;
    }
  });

  const sortedAisles = Array.from(aislesSet).sort();
  const colsToRender = maxCol > 0 ? maxCol : 10; 
  const levelsToRender = maxLvl > 0 ? maxLvl : 4;

  // Fallback sintético solo para modo edición (merge/block). Para el render normal
  // se usa gridLocMap que apunta al location_id real de la BD.
  // Formato nuevo 4 segmentos: {bodega}-{pasillo}-{columna_padded}-{fila}
  const getLocId = (aisle, cIdx, lIdx) =>
    gridLocMap[aisle]?.[cIdx]?.[lIdx] ||
    `${activeWH}-${aisle}-${String(cIdx + 1).padStart(2, '0')}-${lIdx + 1}`;
  
  useEffect(() => {
    if(!editMode) setEditSelection(new Set());
  }, [editMode]);

  const handleCellClick = (locId, itemsInLoc, mergeBlock) => {
    if (editMode) {
      setEditSelection(prev => {
        const next = new Set(prev);
        const toToggle = mergeBlock ? mergeBlock.covered : [locId];
        const isSelected = toToggle.every(id => next.has(id));
        if (isSelected) { toToggle.forEach(id => next.delete(id)); } 
        else { toToggle.forEach(id => next.add(id)); }
        return next;
      });
    } else {
      const isSelected = selectedLoc?.locId === locId;
      if (!blockedLocs.has(locId)) {
        setSelectedLoc(isSelected ? null : { locId, items: itemsInLoc });
      }
    }
  };

  const handleToggleBlock = () => {
    setBlockedLocs(prev => {
       const next = new Set(prev);
       editSelection.forEach(id => {
          if (next.has(id)) next.delete(id);
          else next.add(id);
       });
       return next;
    });
    setEditSelection(new Set());
  };

  const handleMerge = () => {
    if (editSelection.size < 2) return;
    const selectedArr = Array.from(editSelection);
    
    const parsed = selectedArr.map(id => {
       const prefix = `${activeWH}-${activeZ}-`;
       const remainder = id.substring(prefix.length);
       const parts = remainder.split('-');
       return { id, aisle: parts[0], c: parseInt(parts[1], 10), l: parseInt(parts[2], 10) };
    });
    
    const aisles = new Set(parsed.map(p => p.aisle));
    if (aisles.size > 1) { alert("Operación denegada: Solo puede unir ubicaciones dentro del mismo pasillo."); return; }

    const minC = Math.min(...parsed.map(p => p.c));
    const maxC = Math.max(...parsed.map(p => p.c));
    const minL = Math.min(...parsed.map(p => p.l));
    const maxL = Math.max(...parsed.map(p => p.l));
    
    const expectedSize = (maxC - minC + 1) * (maxL - minL + 1);
    if (expectedSize !== selectedArr.length) { alert("Error de simetría: Debe seleccionar un bloque rectangular perfecto."); return; }

    const hasOverlap = mergedBlocks.some(mb => mb.covered.some(c => editSelection.has(c)));
    if (hasOverlap) { alert("Conflicto: Las ubicaciones ya forman parte de otra unión."); return; }

    const rootLoc = selectedArr.find(id => {
       const remainder = id.substring(`${activeWH}-${activeZ}-`.length);
       const parts = remainder.split('-');
       return parseInt(parts[1], 10) === minC && parseInt(parts[2], 10) === minL;
    });

    const newBlock = { id: `MERGE-${Date.now()}`, root: rootLoc, colSpan: maxC - minC + 1, rowSpan: maxL - minL + 1, covered: selectedArr };
    setMergedBlocks(prev => [...prev, newBlock]);
    setEditSelection(new Set()); 
  };

  const handleUnmerge = () => {
    const blocksToRemove = mergedBlocks.filter(mb => mb.covered.some(c => editSelection.has(c)));
    if (blocksToRemove.length === 0) return;
    setMergedBlocks(prev => prev.filter(mb => !blocksToRemove.includes(mb)));
    setEditSelection(new Set());
  };

  const displayLoc = selectedLoc || hoveredLoc;

  return (
    <div className="space-y-4 animate-in fade-in max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center flex-wrap gap-2">
            Gemelo Digital 3D
            {editMode && <span className="text-[10px] bg-red-100 text-red-600 px-2 py-1 rounded-lg uppercase tracking-widest animate-pulse border border-red-200">Modo Edición</span>}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            {editMode ? 'Seleccione casillas para unirlas o bloquearlas.' : 'Haga clic en un rack para inspeccionar su inventario en tiempo real.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
           <div className="flex items-center bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm">
             <Warehouse className="text-slate-400 w-4 h-4 mr-2 shrink-0" />
             <select value={activeWH} onChange={(e) => {
               const newWH = e.target.value;
               // Al cambiar bodega, buscar la primera zona disponible para esa bodega
               const firstZoneForWH = locations.find(l => {
                 const p = l.location_id.split('-');
                 return p.length === 4 && p[0] === newWH && l.zone_code;
               })?.zone_code || derivedZones[0]?.id;
               setActiveWH(newWH);
               if (firstZoneForWH) setActiveZ(firstZoneForWH);
               setSelectedLoc(null);
             }} className="bg-transparent text-xs font-bold text-slate-700 outline-none cursor-pointer uppercase max-w-[120px]">
               {warehouses.map(w => <option key={w.id} value={w.id}>{w.id} - {w.name}</option>)}
             </select>
           </div>
           <div className="flex items-center bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm">
             <Layers className="text-slate-400 w-4 h-4 mr-2 shrink-0" />
             <select value={activeZ} onChange={(e) => {setActiveZ(e.target.value); setSelectedLoc(null);}} className="bg-transparent text-xs font-bold text-slate-700 outline-none cursor-pointer uppercase max-w-[120px]">
               {derivedZones.map(z => <option key={z.id} value={z.id}>{z.id}{z.name !== z.id ? ` - ${z.name}` : ''}</option>)}
             </select>
           </div>

          {canEditLayout && (
            <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
              <button onClick={() => {setEditMode(false); setSelectedLoc(null);}} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors flex items-center ${!editMode ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}>
                <Eye size={12} className="mr-1"/> Vista
              </button>
              <button onClick={() => {setEditMode(true); setSelectedLoc(null);}} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors flex items-center ${editMode ? 'bg-red-500 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}>
                <Edit size={12} className="mr-1"/> Editar
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 min-h-[60vh] lg:min-h-[500px]">
        <div className={`bg-slate-900 rounded-[28px] sm:rounded-[40px] flex-1 flex flex-col p-4 sm:p-8 border-4 sm:border-8 shadow-2xl relative overflow-auto custom-scrollbar transition-colors min-h-[350px] ${editMode ? 'border-red-500/30' : 'border-slate-800'}`}>
          <div className={`absolute inset-0 pointer-events-none transition-colors ${editMode ? 'bg-[radial-gradient(circle_at_50%_50%,rgba(239,68,68,0.05),transparent)]' : 'bg-[radial-gradient(circle_at_50%_50%,rgba(67,56,202,0.1),transparent)]'}`}></div>
          
          {sortedAisles.length === 0 ? (
             <div className="h-full flex flex-col items-center justify-center text-center opacity-60 z-10">
                <MapIcon className="w-20 h-20 text-slate-500 mb-4"/>
                <p className="text-white text-lg font-black uppercase tracking-widest">Sector Vacío</p>
                <p className="text-slate-400 text-xs mt-2">No hay ubicaciones registradas para: {activeWH} - {activeZ}</p>
             </div>
          ) : (
            <div className="h-max min-h-full bg-slate-800/50 rounded-3xl p-8 flex relative z-10 border border-white/5" style={{ minWidth: `${Math.max(800, (colsToRender * 56) + 200)}px`}}>
              <div className="w-20 bg-slate-800 border-r-2 border-dashed border-slate-600 flex flex-col justify-around py-10 rounded-l-2xl shadow-inner mr-8 shrink-0">
                <div className="w-full h-16 border-r-4 border-yellow-500 text-[10px] text-slate-400 font-black flex items-center justify-center -rotate-90 tracking-[0.2em]">DOCK 1</div>
              </div>
              
              <div className="flex-1 flex flex-col gap-10">
                {sortedAisles.map((aisleName, aisleIdx) => {
                  const allLocsInAisle = [];
                  for (let c = 0; c < colsToRender; c++) {
                    for (let l = 0; l < levelsToRender; l++) {
                      allLocsInAisle.push({ cIdx: c, lIdx: l, locId: getLocId(aisleName, c, l) });
                    }
                  }

                  return (
                    <div key={aisleIdx} className="flex flex-col p-6 bg-slate-800/40 rounded-3xl border border-white/5 hover:bg-slate-700/50 transition-colors w-max">
                      <div className="text-left text-sm font-black text-slate-400 mb-6 uppercase tracking-widest shrink-0 border-b border-slate-600/50 pb-3 flex justify-between items-center">
                        <span>Pasillo {aisleName}</span>
                      </div>
                      
                      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${colsToRender}, 3rem)`, gridTemplateRows: `repeat(${levelsToRender}, 3rem) 1.5rem` }}>
                        
                        {Array.from({length: colsToRender}).map((_, c) => (
                          <div key={`label-${c}`} style={{ gridColumn: c + 1, gridRow: levelsToRender + 1 }} className="text-center text-[9px] font-black text-slate-500 mt-2 uppercase flex items-center justify-center">
                             C{String(c + 1).padStart(2, '0')}
                          </div>
                        ))}

                        {allLocsInAisle.map(({cIdx, lIdx, locId}) => {
                          const mergeBlock = mergedBlocks.find(mb => mb.covered.includes(locId));
                          if (mergeBlock && mergeBlock.root !== locId) return null; 

                          const isRootMerge = mergeBlock && mergeBlock.root === locId;
                          const colSpan = isRootMerge ? mergeBlock.colSpan : 1;
                          const rowSpan = isRootMerge ? mergeBlock.rowSpan : 1;
                          const gridRowStart = levelsToRender - (lIdx + rowSpan - 1);

                          let itemsInLoc = inventoryByLocation.get(locId) || [];
                          if (isRootMerge) { itemsInLoc = mergeBlock.covered.flatMap(id => inventoryByLocation.get(id) || []); }

                          const isBlocked = blockedLocs.has(locId);
                          const inEditSelection = editSelection.has(locId) || (isRootMerge && mergeBlock.covered.some(id => editSelection.has(id)));
                          const isViewSelected = selectedLoc?.locId === locId && !editMode;

                          let bgClass = 'bg-emerald-400/80 border-emerald-300';
                          
                          if (isBlocked) {
                             bgClass = editMode ? 'bg-slate-900 border-dashed border-red-500/50 flex items-center justify-center opacity-60 hover:bg-red-900/50' : 'opacity-0 pointer-events-none';
                          } else if (itemsInLoc.length > 0) {
                            const hasHold = itemsInLoc.some(i => i.status && i.status !== 'DISPONIBLE');
                            bgClass = hasHold ? 'bg-red-500 border-red-400 shadow-[0_0_15px_rgba(239,68,68,0.6)] animate-pulse' : 'bg-indigo-500 border-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.4)]';
                          }

                          if (inEditSelection && editMode) bgClass += ' ring-4 ring-white z-30 scale-105';
                          else if (isViewSelected && !isBlocked) bgClass += ' ring-4 ring-yellow-400 z-20 scale-110';

                          return (
                            <div 
                              key={locId} 
                              style={{ gridColumn: `${cIdx + 1} / span ${colSpan}`, gridRow: `${gridRowStart} / span ${rowSpan}` }}
                              onMouseEnter={() => !isBlocked && !editMode && setHoveredLoc({ locId, items: itemsInLoc })} 
                              onMouseLeave={() => !isBlocked && !editMode && setHoveredLoc(null)} 
                              onClick={() => handleCellClick(locId, itemsInLoc, mergeBlock)}
                              className={`w-full h-full rounded-xl border-2 transition-all flex items-center justify-center relative ${editMode ? 'cursor-pointer' : (!isBlocked ? 'cursor-crosshair hover:scale-110 hover:z-10' : '')} ${bgClass}`}
                              title={editMode ? `${locId} (Click para seleccionar)` : locId}
                            >
                               {isBlocked && editMode && <X size={14} className="text-red-400" />}
                               {isRootMerge && editMode && !isBlocked && <Combine size={14} className="text-white/50" />}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="w-full lg:w-80 bg-white rounded-[28px] sm:rounded-[40px] border border-slate-200 shadow-xl flex flex-col overflow-hidden shrink-0 lg:max-h-full max-h-96">
           <div className={`p-6 ${editMode ? 'bg-slate-800' : 'bg-indigo-600'} transition-colors text-white flex justify-between items-center shrink-0`}>
              <h2 className="font-black text-lg uppercase tracking-tighter flex items-center"><MapIcon className="w-5 h-5 mr-2 opacity-80"/> Scanner de Rack</h2>
              {selectedLoc && !editMode && <button onClick={() => setSelectedLoc(null)} className="p-1.5 hover:bg-white/20 rounded-full transition-colors" title="Cerrar selección"><X size={16}/></button>}
           </div>
           
           <div className="p-6 flex-1 bg-slate-50 flex flex-col overflow-hidden">
             {editMode ? (
                <div className="h-full flex flex-col space-y-6">
                  <div className="text-center pb-4 border-b border-slate-200">
                    <div className="bg-red-100 p-4 rounded-full inline-flex mx-auto mb-2"><Edit className="w-8 h-8 text-red-500" /></div>
                    <p className="text-xs font-black text-slate-800 uppercase tracking-widest">Editor de Layout</p>
                    <p className="text-[10px] text-slate-500 px-2 mt-1">Seleccione las casillas en el mapa 3D para modificarlas estructuralmente.</p>
                  </div>

                  <div className="space-y-3 flex-1 overflow-y-auto custom-scrollbar pr-2">
                     <div className="flex justify-between items-end border-b border-slate-200 pb-2">
                       <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Selección Actual</p>
                       <span className="text-lg font-black text-slate-800">{editSelection.size} casillas</span>
                     </div>
                     
                     <div className="space-y-3 pt-2">
                        <button onClick={handleToggleBlock} disabled={editSelection.size === 0} className="w-full bg-slate-200 hover:bg-slate-300 text-slate-800 font-black py-3 rounded-xl uppercase text-[10px] tracking-widest disabled:opacity-50 transition-colors flex items-center justify-center">
                           <XCircle size={14} className="mr-2"/> Bloquear / Ocultar
                        </button>
                        
                        <div className="pt-4 space-y-2 border-t border-slate-200">
                          <p className="text-[9px] font-bold text-slate-400 text-center">Herramientas de Agrupación (Merge)</p>
                          <button onClick={handleMerge} disabled={editSelection.size < 2} className="w-full bg-blue-100 hover:bg-blue-200 text-blue-800 font-black py-3 rounded-xl uppercase text-[10px] tracking-widest disabled:opacity-50 transition-colors flex items-center justify-center shadow-sm">
                             <Combine size={14} className="mr-2"/> Unir Seleccionadas
                          </button>
                          <button onClick={handleUnmerge} disabled={editSelection.size === 0} className="w-full bg-white border-2 border-slate-200 hover:bg-slate-50 text-slate-600 font-black py-3 rounded-xl uppercase text-[10px] tracking-widest disabled:opacity-50 transition-colors flex items-center justify-center">
                             <Split size={14} className="mr-2"/> Separar Casillas
                          </button>
                        </div>
                     </div>
                  </div>
                </div>
             ) : displayLoc ? (
               <div className="space-y-4 animate-in slide-in-from-right-4 flex-1 overflow-y-auto custom-scrollbar pr-2 pb-4">
                  <div className="shrink-0">
                     <div className="flex justify-between items-end mb-1">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ubicación</p>
                        {selectedLoc && <span className="text-[8px] bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full font-black uppercase tracking-widest animate-pulse">Fijada</span>}
                     </div>
                     <p className="text-xl font-mono font-black text-slate-800 bg-white border border-slate-200 py-2 px-4 rounded-xl shadow-sm inline-block">{displayLoc.locId}</p>
                     {mergedBlocks.some(mb => mb.root === displayLoc.locId) && (
                        <div className="mt-2 text-[9px] font-black bg-blue-100 text-blue-700 px-2 py-1 rounded inline-flex items-center uppercase tracking-widest border border-blue-200">
                          <Combine size={12} className="mr-1"/> Ubicación Agrupada
                        </div>
                     )}
                     <p className="mt-2 text-[10px] font-bold text-slate-500 uppercase border-t border-slate-200 pt-2">{displayLoc.items?.length || 0} LPN(s) Contenidos</p>
                  </div>
                  
                  {displayLoc.items && displayLoc.items.length > 0 ? (
                    <div className="space-y-3">
                      {displayLoc.items.map((item, idx) => (
                        <div key={idx} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
                          <div className={`absolute top-0 left-0 w-1.5 h-full ${item.status && item.status !== 'DISPONIBLE' ? 'bg-red-500' : 'bg-indigo-500'}`}></div>
                          <div className="flex justify-between items-start mb-1">
                             <p className="text-[10px] font-black text-indigo-700 uppercase tracking-tight">{clients?.find(c => c.id === item.client_id)?.name || item.client_id || 'GENERAL'}</p>
                             <p className="text-[9px] font-mono font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{item.id}</p>
                          </div>
                          <div className="mb-2">
                             <p className="text-sm font-black text-slate-800 leading-tight">{item.sku}</p>
                             <p className="text-[9px] font-bold text-slate-500 truncate">{item.desc}</p>
                          </div>
                          {(item.batch_number || item.serial_number) && (
                            <div className="mb-2 flex flex-col gap-1">
                               {item.batch_number && <span className="w-fit text-[8px] font-black bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded uppercase flex items-center"><Calendar className="w-3 h-3 mr-1"/> LT: {item.batch_number} | EXP: {item.expiry_date}</span>}
                               {item.serial_number && <span className="w-fit text-[8px] font-black bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded uppercase flex items-center"><Tag className="w-3 h-3 mr-1"/> SN: {item.serial_number}</span>}
                            </div>
                          )}
                          <div className="pt-2 border-t border-slate-100 flex justify-between items-end">
                            <div>
                               <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Stock Físico</p>
                               <p className="text-lg font-black text-slate-800 leading-none">{item.qty.toLocaleString()} <span className="text-[9px] text-slate-500 uppercase">{item.uom || 'UN'}</span></p>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${getStatusBadge ? getStatusBadge(item.status) : 'bg-slate-100 text-slate-600 border-slate-200'}`}>{item.status || 'DISPONIBLE'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm text-center space-y-3"><Box className="w-12 h-12 text-emerald-200 mx-auto" /><p className="text-sm font-black text-emerald-600 uppercase tracking-tighter">Ubicación Disponible</p></div>
                  )}
               </div>
             ) : (
               <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50"><Scan className="w-16 h-16 text-slate-400" /><p className="text-xs font-black text-slate-500 uppercase tracking-widest">Pase el cursor sobre un rack<br/>para inspeccionar</p></div>
             )}
           </div>
        </div>
      </div>
    </div>
  );
}


const ImportModal = ({ type, host, currentUser, extraParams, onClose, onSuccess }) => {
  const [status, setStatus] = useState('idle');
  const [preview, setPreview] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileDataRef = useRef(null);
  const filenameRef = useRef('');
  const cfg = IMPORT_CONFIG[type] || {};

  const toBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const bytes = new Uint8Array(e.target.result);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      resolve(btoa(bin));
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });

  const handleFile = async (file) => {
    if (!file) return;
    setError('');
    setStatus('loading');
    try {
      const b64 = await toBase64(file);
      fileDataRef.current = b64;
      filenameRef.current = file.name;
      const res = await apiFetch(`${host}/api/import/${type}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: b64, filename: file.name })
      });
      const d = await res.json();
      if (d.error) { setError(d.error); setStatus('idle'); return; }
      // Validar cabeceras requeridas ANTES de permitir importar (PASO 2.3).
      const headers = Array.isArray(d.headers) ? d.headers.map(h => String(h).trim().toLowerCase()) : [];
      const required = (cfg.required || []).map(r => String(r).toLowerCase());
      const missing = required.filter(r => !headers.includes(r));
      if (missing.length > 0) {
        setError(`El archivo no tiene las columnas requeridas: ${missing.join(', ')}`);
        setStatus('idle');
        return;
      }
      setPreview(d);
      setStatus('preview');
    } catch (e) { setError('Error al leer el archivo'); setStatus('idle'); }
  };

  // Normaliza la respuesta del backend a una forma consistente { success, errors[] }.
  // El backend devuelve { success, errors } en éxito pero { error } en fallo, así
  // que sin esto el render reventaba al leer results.errors.length (errors undefined).
  const normalizeResult = (d, fallbackMsg) => {
    if (!d || typeof d !== 'object') return { success: 0, errors: [fallbackMsg || 'Respuesta inesperada del servidor.'] };
    if (d.error) return { success: Number(d.success) || 0, errors: [d.error] };
    return {
      success: Number(d.success) || 0,
      errors: Array.isArray(d.errors) ? d.errors : [],
    };
  };

  const handleImport = async () => {
    setStatus('importing');
    try {
      const res = await apiFetch(`${host}/api/import/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: fileDataRef.current, filename: filenameRef.current, username: currentUser?.username, ...extraParams })
      });
      let d = null;
      try { d = await res.json(); } catch { d = null; }
      const normalized = (!res.ok || !d || d.error)
        ? normalizeResult(d, `Error del servidor (HTTP ${res.status}).`)
        : normalizeResult(d);
      setResults(normalized);
      setStatus('results');
      if (normalized.success > 0) onSuccess();
    } catch (e) {
      // No propagar la excepción al render: mostrar el fallo como resultado controlado.
      setResults({ success: 0, errors: [e?.message || 'Error de red al importar.'] });
      setStatus('results');
    }
  };

  // Derivaciones defensivas para el bloque de resultados: nunca leer .length/.map
  // directamente sobre results.errors (puede llegar undefined en respuestas de error).
  const safeSuccess = Number(results?.success) || 0;
  const safeErrors = Array.isArray(results?.errors) ? results.errors : [];
  const errText = (e) => (typeof e === 'string' ? e : (e?.message ?? JSON.stringify(e)));

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter flex items-center"><Upload className="w-5 h-5 mr-2 text-indigo-500"/>{cfg.title || 'Importar'}</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Soporta archivos .xlsx y .csv</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-colors"><X size={18} className="text-slate-400"/></button>
        </div>

        <div className="p-6 space-y-5">
          {/* Descargar plantilla */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-black text-emerald-800">Plantilla de ejemplo</p>
              <p className="text-[10px] text-emerald-600 mt-0.5">Descarga una plantilla con las columnas correctas</p>
            </div>
            <a href={`${host}/api/templates/${type}`} download className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-colors">
              <Download size={14}/> Descargar plantilla
            </a>
          </div>

          {/* Instrucciones */}
          <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Campos</p>
            <div className="flex flex-wrap gap-2">
              {cfg.required?.map(f => <span key={f} className="bg-red-100 text-red-700 text-[10px] font-black px-2 py-1 rounded-lg uppercase">{f} *</span>)}
              {cfg.optional?.map(f => <span key={f} className="bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-1 rounded-lg uppercase">{f}</span>)}
            </div>
            <p className="text-[9px] text-slate-400">* Obligatorio</p>
          </div>

          {/* Zona de carga — idle o loading */}
          {(status === 'idle' || status === 'loading') && (
            <div
              className={`border-2 border-dashed rounded-2xl p-10 text-center transition-colors cursor-pointer ${isDragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300 hover:border-indigo-300 hover:bg-slate-50'}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files[0]; if(f) handleFile(f); }}
              onClick={() => document.getElementById('import-file-input').click()}
            >
              {status === 'loading' ? (
                <><Loader2 className="w-10 h-10 mx-auto mb-2 text-indigo-400 animate-spin"/><p className="text-sm font-black text-slate-500">Procesando archivo...</p></>
              ) : (
                <><Upload className="w-10 h-10 mx-auto mb-2 text-slate-300"/><p className="text-sm font-black text-slate-500">Arrastra tu archivo aquí</p><p className="text-[10px] text-slate-400 mt-1">o haz clic para seleccionar · CSV o XLSX</p></>
              )}
              <input id="import-file-input" type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files[0]; if(f) handleFile(f); e.target.value=''; }}/>
            </div>
          )}

          {error && <p className="text-sm font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}

          {/* Preview */}
          {status === 'preview' && preview && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Vista previa — {preview.total} filas totales</p>
                <button onClick={() => { setStatus('idle'); setPreview(null); }} className="text-[10px] text-slate-400 hover:text-slate-600 font-bold uppercase">Cambiar archivo</button>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>{preview.headers.map(h => <th key={h} className="px-3 py-2 font-black text-slate-500 uppercase text-[9px] whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        {preview.headers.map(h => <td key={h} className="px-3 py-2 text-slate-700 font-bold max-w-[120px] truncate">{String(row[h] ?? '')}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.total > 5 && <p className="text-[10px] text-slate-400 text-center">Mostrando 5 de {preview.total} filas</p>}
              <button onClick={handleImport} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 rounded-2xl shadow-lg uppercase text-xs tracking-widest transition-colors flex justify-center items-center">
                <Database size={16} className="mr-2"/> Cargar {preview.total} filas
              </button>
            </div>
          )}

          {/* Importando */}
          {status === 'importing' && (
            <div className="py-10 text-center">
              <Loader2 className="w-12 h-12 mx-auto mb-3 text-indigo-400 animate-spin"/>
              <p className="text-sm font-black text-slate-600 uppercase">Importando...</p>
            </div>
          )}

          {/* Resultados */}
          {status === 'results' && results && (
            <div className="space-y-4">
              <div className={`rounded-2xl p-5 ${safeSuccess > 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50 border border-slate-200'}`}>
                <p className="text-2xl font-black text-emerald-700">{safeSuccess} <span className="text-sm font-bold text-emerald-600">filas importadas correctamente</span></p>
                {safeErrors.length > 0 && <p className="text-sm font-bold text-amber-600 mt-1">{safeErrors.length} errores</p>}
              </div>
              {safeErrors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-1">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-black text-red-600 uppercase tracking-widest">Detalle de errores</p>
                    <button onClick={() => {
                      const csv = 'Fila,Error\n' + safeErrors.map((e,i) => `${i+1},"${errText(e).replace(/"/g,'""')}"`).join('\n');
                      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
                      a.download = 'errores_importacion.csv'; a.click();
                    }} className="bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 rounded-lg px-2 py-1 text-[8px] font-black uppercase flex items-center gap-1">
                      <Download size={9}/> Descargar CSV
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {safeErrors.map((e, i) => <p key={i} className="text-xs text-red-700 font-bold">{errText(e)}</p>)}
                  </div>
                </div>
              )}
              <button onClick={onClose} className="w-full bg-slate-900 hover:bg-black text-white font-black py-4 rounded-2xl uppercase text-xs tracking-widest transition-colors">Cerrar</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
// ─────────────────────────────────────────────────────────────────────────────


const ConfirmModal = ({ title, message, confirmText = 'Confirmar', onConfirm, onClose, danger = false }) => (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
    <div className="bg-white rounded-[28px] shadow-2xl w-full max-w-md animate-in zoom-in-95">
      <div className="p-6 text-center">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${danger ? 'bg-red-100' : 'bg-amber-100'}`}>
          <ShieldAlert className={`w-7 h-7 ${danger ? 'text-red-600' : 'text-amber-600'}`}/>
        </div>
        <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter">{title}</h2>
        <p className="text-sm text-slate-500 mt-2 font-medium leading-relaxed">{message}</p>
      </div>
      <div className="flex gap-3 px-6 pb-6">
        <button onClick={onClose} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black py-3 rounded-2xl uppercase text-xs tracking-widest transition-colors">Cancelar</button>
        <button onClick={() => { onConfirm(); onClose(); }} className={`flex-1 font-black py-3 rounded-2xl uppercase text-xs tracking-widest transition-colors text-white shadow-md ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-500 hover:bg-amber-600'}`}>{confirmText}</button>
      </div>
    </div>
  </div>
);


const DemoHint = ({ tabId, isDemo }) => {
  const [dismissed, setDismissed] = React.useState(() => {
    try { return JSON.parse(sessionStorage.getItem('demo_dismissed') || '[]'); } catch { return []; }
  });
  // Auto-expand on first visit to this tab
  const [autoShown, setAutoShown] = React.useState(() => {
    try { return JSON.parse(sessionStorage.getItem('demo_auto_shown') || '[]'); } catch { return []; }
  });
  const isFirstVisit = !autoShown.includes(tabId);
  const [expanded, setExpanded] = React.useState(isFirstVisit);

  React.useEffect(() => {
    if (isFirstVisit && isDemo && DEMO_HINTS[tabId]) {
      const next = [...autoShown, tabId];
      setAutoShown(next);
      sessionStorage.setItem('demo_auto_shown', JSON.stringify(next));
      setExpanded(true);
    }
  }, [tabId]);

  if (!isDemo) return null;
  const hint = DEMO_HINTS[tabId];
  if (!hint) return null;
  const isDismissed = dismissed.includes(tabId);
  if (isDismissed && !expanded) return (
    <button onClick={()=>setExpanded(true)} className="mb-4 flex items-center gap-2 text-[10px] font-black text-amber-600 hover:text-amber-800 uppercase tracking-widest transition-colors">
      <Lightbulb size={12}/> Ver ayuda para este módulo
    </button>
  );
  const dismiss = () => {
    const next = [...dismissed, tabId];
    setDismissed(next);
    sessionStorage.setItem('demo_dismissed', JSON.stringify(next));
    setExpanded(false);
  };
  const colorMap = {
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-900',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    blue: 'bg-blue-50 border-blue-200 text-blue-900',
    purple: 'bg-purple-50 border-purple-200 text-purple-900',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
    rose: 'bg-rose-50 border-rose-200 text-rose-900',
    violet: 'bg-violet-50 border-violet-200 text-violet-900',
    orange: 'bg-orange-50 border-orange-200 text-orange-900',
    cyan: 'bg-cyan-50 border-cyan-200 text-cyan-900',
    slate: 'bg-slate-50 border-slate-200 text-slate-900',
  };
  const stepColor = {
    indigo:'text-indigo-700', emerald:'text-emerald-700', blue:'text-blue-700',
    purple:'text-purple-700', amber:'text-amber-700', rose:'text-rose-700',
    violet:'text-violet-700', orange:'text-orange-700', cyan:'text-cyan-700', slate:'text-slate-700',
  };
  return (
    <div className={`rounded-3xl border-2 p-5 mb-5 ${colorMap[hint.color]} animate-in fade-in`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1">
          <span className="text-2xl shrink-0 mt-0.5">{hint.icon}</span>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <p className="font-black text-base uppercase tracking-tighter">{hint.title}</p>
              <span className="text-[9px] font-black bg-amber-400 text-white px-2 py-0.5 rounded-full uppercase">Modo Demo</span>
            </div>
            <p className="text-sm font-medium opacity-80 mb-3">{hint.desc}</p>
            <div className="space-y-1.5">
              {hint.steps.map((s, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black bg-white/70 ${stepColor[hint.color]}`}>{i+1}</span>
                  <p className={`text-xs font-medium ${stepColor[hint.color]}`}>{s}</p>
                </div>
              ))}
            </div>
            {hint.tip && (
              <div className="mt-3 flex items-start gap-2 bg-white/50 rounded-xl px-3 py-2">
                <Lightbulb size={12} className={`shrink-0 mt-0.5 ${stepColor[hint.color]}`}/>
                <p className={`text-[10px] font-bold italic ${stepColor[hint.color]}`}>{hint.tip}</p>
              </div>
            )}
          </div>
        </div>
        <button onClick={dismiss} className="shrink-0 opacity-50 hover:opacity-100 transition-opacity mt-0.5"><X size={16}/></button>
      </div>
    </div>
  );
};

// ── SANDBOX WELCOME — Tour de bienvenida al primer login ─────────────────────
const SandboxWelcome = ({ currentUser, onClose }) => {
  const [step, setStep] = React.useState(0);
  const role = SANDBOX_ROLES[currentUser?.role] || {};
  const scenario = SANDBOX_SCENARIOS[currentUser?.sandbox_scenario] || {};
  const missions = SANDBOX_MISSIONS[currentUser?.role] || [];

  const steps = [
    {
      icon: '🎮',
      title: '¡Bienvenido al Sandbox!',
      content: (
        <div className="space-y-3">
          <p className="text-slate-600 text-sm leading-relaxed">
            Estás explorando <span className="font-black text-slate-800">WMS Enterprise</span> en modo simulación.
            Todo lo que hagas aquí usa datos de demostración — nada se guarda en la base de datos real.
          </p>
          <div className="flex gap-3">
            <div className="flex-1 bg-slate-50 rounded-xl p-3 border border-slate-200">
              <span className="text-lg">{scenario.icon}</span>
              <p className="text-[9px] font-black text-slate-400 uppercase mt-1">Escenario</p>
              <p className="text-sm font-black text-slate-700">{scenario.label}</p>
            </div>
            <div className="flex-1 bg-slate-50 rounded-xl p-3 border border-slate-200">
              <span className="text-lg">{role.icon}</span>
              <p className="text-[9px] font-black text-slate-400 uppercase mt-1">Tu Rol</p>
              <p className="text-sm font-black text-slate-700">{role.label}</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      icon: '🎯',
      title: 'Misiones por Completar',
      content: (
        <div className="space-y-3">
          <p className="text-slate-600 text-sm leading-relaxed">
            Tienes <span className="font-black text-amber-600">{missions.length} misiones</span> para explorar el sistema.
            Cada misión te lleva a un módulo diferente — ¡completa todas para ganar!
          </p>
          <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
            {missions.map((m, i) => (
              <div key={m.id} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[9px] font-black shrink-0">{i+1}</span>
                <div className="min-w-0">
                  <p className="text-xs font-black text-slate-700 truncate">{m.label}</p>
                  <p className="text-[9px] text-slate-400">{m.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      icon: '🔄',
      title: 'Cambia Rol y Escenario',
      content: (
        <div className="space-y-3">
          <p className="text-slate-600 text-sm leading-relaxed">
            Usa el <span className="font-black text-amber-600">botón flotante</span> en la esquina inferior izquierda
            para cambiar de rol o escenario en cualquier momento, sin volver a iniciar sesión.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
            <div className="bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-xl p-2 shrink-0">
              <span className="text-lg">{role.icon}</span>
            </div>
            <div>
              <p className="text-xs font-black text-amber-800">Panel Sandbox</p>
              <p className="text-[10px] text-amber-600">Cambia rol, escenario y sigue tus misiones</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.values(SANDBOX_ROLES).map(r => (
              <span key={r.id} className="text-[9px] font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-lg">
                {r.icon} {r.label}
              </span>
            ))}
          </div>
        </div>
      ),
    },
  ];

  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 pt-5">
          {steps.map((_, i) => (
            <div key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-8 bg-amber-500' : 'w-1.5 bg-slate-200'}`}/>
          ))}
        </div>

        <div className="p-6 text-center">
          <span className="text-4xl block mb-3">{current.icon}</span>
          <h2 className="text-xl font-black text-slate-800 tracking-tight mb-4">{current.title}</h2>
          <div className="text-left">{current.content}</div>
        </div>

        <div className="flex gap-3 px-6 pb-6">
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)}
              className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black py-3 rounded-2xl uppercase text-xs tracking-widest transition-colors">
              Atrás
            </button>
          )}
          <button onClick={() => isLast ? onClose() : setStep(s => s + 1)}
            className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-black py-3 rounded-2xl uppercase text-xs tracking-widest transition-colors shadow-lg">
            {isLast ? '¡Comenzar!' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── SANDBOX LAUNCHER — Pantalla de selección de escenario tipo juego ──────────
const SandboxLauncher = ({ host, onLogin, showMsg }) => {
  const [step, setStep] = React.useState('scenario'); // 'scenario' | 'role'
  const [selectedScenario, setSelectedScenario] = React.useState(null);
  const [loading, setLoading] = React.useState(null);

  const scenarios = Object.values(SANDBOX_SCENARIOS);
  const roles = Object.values(SANDBOX_ROLES);

  const handleStart = async (roleId) => {
    setLoading(roleId);
    try {
      const res = await fetch(`${host}/api/demo/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: selectedScenario, role: roleId }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.token) localStorage.setItem('wms_token', d.token);
        onLogin(d.user);
      } else {
        const err = await res.json();
        showMsg(`Error: ${err.error}`, true);
      }
    } catch { showMsg('Error de conexión.', true); }
    finally { setLoading(null); }
  };

  const scenarioColors = {
    emerald: { card: 'from-emerald-500 to-emerald-700', glow: 'shadow-emerald-300/40', ring: 'ring-emerald-400', bg: 'bg-emerald-50', text: 'text-emerald-700' },
    blue:    { card: 'from-blue-500 to-blue-700',       glow: 'shadow-blue-300/40',    ring: 'ring-blue-400',    bg: 'bg-blue-50',    text: 'text-blue-700' },
    violet:  { card: 'from-violet-500 to-violet-700',   glow: 'shadow-violet-300/40',  ring: 'ring-violet-400',  bg: 'bg-violet-50',  text: 'text-violet-700' },
  };

  const roleColors = {
    red:    { border: 'border-red-300 hover:border-red-400', bg: 'bg-red-50', badge: 'bg-red-100 text-red-700', glow: 'hover:shadow-red-200/60' },
    teal:   { border: 'border-teal-300 hover:border-teal-400', bg: 'bg-teal-50', badge: 'bg-teal-100 text-teal-700', glow: 'hover:shadow-teal-200/60' },
    blue:   { border: 'border-blue-300 hover:border-blue-400', bg: 'bg-blue-50', badge: 'bg-blue-100 text-blue-700', glow: 'hover:shadow-blue-200/60' },
    violet: { border: 'border-violet-300 hover:border-violet-400', bg: 'bg-violet-50', badge: 'bg-violet-100 text-violet-700', glow: 'hover:shadow-violet-200/60' },
    cyan:   { border: 'border-cyan-300 hover:border-cyan-400', bg: 'bg-cyan-50', badge: 'bg-cyan-100 text-cyan-700', glow: 'hover:shadow-cyan-200/60' },
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-amber-500/20 border border-amber-500/30 text-amber-300 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest mb-4">
            <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse"/> Sandbox Interactivo
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-2">WMS Enterprise</h1>
          <p className="text-slate-400 text-sm font-medium">Explora el sistema completo sin afectar datos reales</p>
        </div>

        {step === 'scenario' ? (
          <div className="animate-in fade-in slide-in-from-bottom-4">
            <p className="text-center text-[11px] font-black text-slate-500 uppercase tracking-widest mb-6">
              Paso 1 de 2 — Elige tu escenario
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              {scenarios.map(sc => {
                const c = scenarioColors[sc.color];
                return (
                  <button key={sc.id} onClick={() => { setSelectedScenario(sc.id); setStep('role'); }}
                    className={`group relative bg-gradient-to-br ${c.card} rounded-3xl p-6 text-left shadow-2xl ${c.glow} transition-all hover:scale-[1.03] hover:-translate-y-1 active:scale-[0.98]`}>
                    <span className="text-4xl block mb-3">{sc.icon}</span>
                    <h3 className="text-lg font-black text-white mb-1">{sc.label}</h3>
                    <p className="text-white/80 text-xs font-medium leading-relaxed mb-3">{sc.desc}</p>
                    <p className="text-white/50 text-[10px] font-medium leading-relaxed">{sc.detail}</p>
                    <div className="absolute top-4 right-4 bg-white/20 rounded-full w-8 h-8 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <button onClick={() => setStep('scenario')} className="text-slate-500 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-slate-700">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                </button>
                <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">
                  Paso 2 de 2 — Elige tu rol
                </p>
              </div>
              {selectedScenario && (() => {
                const sc = SANDBOX_SCENARIOS[selectedScenario];
                const c = scenarioColors[sc.color];
                return <span className={`${c.bg} ${c.text} px-3 py-1 rounded-full text-[10px] font-black uppercase`}>{sc.icon} {sc.label}</span>;
              })()}
            </div>
            <div className="grid gap-3">
              {roles.filter(r => {
                // En modo PROPIO no mostrar rol CLIENTE (no tiene sentido)
                if (selectedScenario === 'PROPIO' && r.id === 'CLIENTE') return false;
                return true;
              }).map(r => {
                const c = roleColors[r.color];
                const isLoading = loading === r.id;
                return (
                  <button key={r.id} onClick={() => handleStart(r.id)} disabled={!!loading}
                    className={`group border-2 ${c.border} rounded-2xl p-5 text-left bg-white/5 backdrop-blur-sm transition-all hover:shadow-xl ${c.glow} disabled:opacity-50 flex items-center gap-4`}>
                    <span className="text-3xl shrink-0">{r.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="text-sm font-black text-white">{r.label}</h3>
                        <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full ${c.badge}`}>{r.id === 'EJECUTIVO_CUENTA' ? 'EJECUTIVO' : r.id}</span>
                      </div>
                      <p className="text-slate-400 text-xs font-medium">{r.desc}</p>
                    </div>
                    <div className="shrink-0">
                      {isLoading
                        ? <Loader2 size={20} className="animate-spin text-slate-400"/>
                        : <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-slate-400 group-hover:bg-white/20 group-hover:text-white transition-all">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                          </div>
                      }
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-center text-slate-600 text-[10px] font-bold mt-8 uppercase tracking-wider">
          Las acciones son simuladas — nada se guarda en la base de datos
        </p>
      </div>
    </div>
  );
};

// ── SANDBOX SWITCHER — Panel flotante para cambiar rol/escenario en caliente ──
const SandboxSwitcher = ({ host, currentUser, setCurrentUser, activeTab, switchTab, showMsg }) => {
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState('role'); // 'role' | 'scenario' | 'missions'
  const [switching, setSwitching] = React.useState(null);
  const [completedMissions, setCompletedMissions] = React.useState(() => {
    try { return JSON.parse(sessionStorage.getItem('sandbox_missions') || '[]'); } catch { return []; }
  });
  const [visitedTabs, setVisitedTabs] = React.useState(() => {
    try { return JSON.parse(sessionStorage.getItem('sandbox_visited') || '[]'); } catch { return []; }
  });

  const currentRole = currentUser?.role;
  const currentScenario = currentUser?.sandbox_scenario || 'HYBRID';
  const missions = SANDBOX_MISSIONS[currentRole] || [];
  const completedCount = missions.filter(m => completedMissions.includes(m.id)).length;
  const progress = missions.length > 0 ? Math.round((completedCount / missions.length) * 100) : 0;

  // Track visited tabs
  React.useEffect(() => {
    if (activeTab && !visitedTabs.includes(activeTab)) {
      const next = [...visitedTabs, activeTab];
      setVisitedTabs(next);
      sessionStorage.setItem('sandbox_visited', JSON.stringify(next));
      // Auto-complete missions when visiting their tab
      missions.forEach(m => {
        if (m.tab === activeTab && !completedMissions.includes(m.id)) {
          const nextM = [...completedMissions, m.id];
          setCompletedMissions(nextM);
          sessionStorage.setItem('sandbox_missions', JSON.stringify(nextM));
        }
      });
    }
  }, [activeTab]);

  const handleSwitchRole = async (roleId) => {
    if (roleId === currentRole) return;
    setSwitching(roleId);
    try {
      const res = await apiFetch(`${host}/api/demo/switch-role`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roleId }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.token) localStorage.setItem('wms_token', d.token);
        setCurrentUser(d.user);
        // Reset missions for new role
        setCompletedMissions([]);
        sessionStorage.setItem('sandbox_missions', '[]');
      }
    } catch { showMsg('Error al cambiar rol', true); }
    finally { setSwitching(null); }
  };

  const handleSwitchScenario = async (scenarioId) => {
    if (scenarioId === currentScenario) return;
    setSwitching(scenarioId);
    try {
      const res = await apiFetch(`${host}/api/demo/switch-scenario`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: scenarioId }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.token) localStorage.setItem('wms_token', d.token);
        setCurrentUser(d.user);
      }
    } catch { showMsg('Error al cambiar escenario', true); }
    finally { setSwitching(null); }
  };

  const sc = SANDBOX_SCENARIOS[currentScenario];
  const rl = SANDBOX_ROLES[currentRole] || {};

  const roleColorMap = {
    red:    'bg-red-500',    teal:   'bg-teal-500',
    blue:   'bg-blue-500',   violet: 'bg-violet-500', cyan: 'bg-cyan-500',
  };

  return (
    <>
      {/* Botón flotante */}
      <button onClick={() => setOpen(!open)}
        className="fixed bottom-6 left-6 z-50 bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-2xl shadow-2xl shadow-amber-400/30 px-4 py-3 flex items-center gap-3 transition-all hover:scale-105 active:scale-95 hover:shadow-amber-400/50">
        <div className="relative">
          <span className="text-lg">{rl.icon || '🎮'}</span>
          {progress > 0 && progress < 100 && (
            <svg className="absolute -top-1 -right-1 w-4 h-4" viewBox="0 0 36 36">
              <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="white" strokeOpacity="0.3" strokeWidth="4"/>
              <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="white" strokeWidth="4"
                strokeDasharray={`${progress}, 100`} strokeLinecap="round"/>
            </svg>
          )}
          {progress === 100 && <span className="absolute -top-1 -right-1 text-[10px]">✅</span>}
        </div>
        <div className="text-left hidden sm:block">
          <p className="text-[9px] font-black uppercase tracking-widest opacity-80">Sandbox</p>
          <p className="text-[10px] font-black leading-tight">{rl.label} · {sc?.label}</p>
        </div>
      </button>

      {/* Panel expandido */}
      {open && (
        <div className="fixed bottom-20 left-6 z-50 w-80 bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in slide-in-from-bottom-4">
          {/* Header */}
          <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{rl.icon}</span>
                <div>
                  <p className="text-white font-black text-sm">{rl.label}</p>
                  <p className="text-white/70 text-[9px] font-bold uppercase">{sc?.icon} {sc?.label}</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-white/60 hover:text-white p-1"><X size={16}/></button>
            </div>
            {/* Progress bar */}
            <div className="bg-white/20 rounded-full h-1.5 mt-1">
              <div className="bg-white rounded-full h-1.5 transition-all duration-500" style={{ width: `${progress}%` }}/>
            </div>
            <p className="text-white/70 text-[9px] font-bold mt-1">{completedCount}/{missions.length} misiones · {visitedTabs.length} módulos visitados</p>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-100">
            {[['role','Rol'],['scenario','Escenario'],['missions','Misiones']].map(([id,label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex-1 py-2.5 text-[9px] font-black uppercase tracking-widest transition-colors ${tab===id ? 'text-amber-600 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-600'}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="p-4 max-h-72 overflow-y-auto custom-scrollbar">
            {/* Cambiar rol */}
            {tab === 'role' && (
              <div className="space-y-2">
                {Object.values(SANDBOX_ROLES).filter(r => {
                  if (currentScenario === 'PROPIO' && r.id === 'CLIENTE') return false;
                  return true;
                }).map(r => {
                  const isActive = r.id === currentRole;
                  const isLoading = switching === r.id;
                  const rc = roleColorMap[r.color] || 'bg-slate-500';
                  return (
                    <button key={r.id} onClick={() => handleSwitchRole(r.id)} disabled={isActive || !!switching}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${isActive ? 'bg-amber-50 border-2 border-amber-300 shadow-sm' : 'border-2 border-slate-100 hover:border-slate-300 hover:bg-slate-50'} disabled:opacity-60`}>
                      <span className="text-xl shrink-0">{r.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-black ${isActive ? 'text-amber-700' : 'text-slate-700'}`}>{r.label}</p>
                        <p className="text-[9px] text-slate-400 font-medium">{r.shortDesc}</p>
                      </div>
                      {isActive && <span className="text-[8px] font-black text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full uppercase">Activo</span>}
                      {isLoading && <Loader2 size={14} className="animate-spin text-amber-500 shrink-0"/>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Cambiar escenario */}
            {tab === 'scenario' && (
              <div className="space-y-2">
                {Object.values(SANDBOX_SCENARIOS).map(s => {
                  const isActive = s.id === currentScenario;
                  const isLoading = switching === s.id;
                  return (
                    <button key={s.id} onClick={() => handleSwitchScenario(s.id)} disabled={isActive || !!switching}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${isActive ? 'bg-amber-50 border-2 border-amber-300 shadow-sm' : 'border-2 border-slate-100 hover:border-slate-300 hover:bg-slate-50'} disabled:opacity-60`}>
                      <span className="text-xl shrink-0">{s.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-black ${isActive ? 'text-amber-700' : 'text-slate-700'}`}>{s.label}</p>
                        <p className="text-[9px] text-slate-400 font-medium">{s.desc}</p>
                      </div>
                      {isActive && <span className="text-[8px] font-black text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full uppercase">Activo</span>}
                      {isLoading && <Loader2 size={14} className="animate-spin text-amber-500 shrink-0"/>}
                    </button>
                  );
                })}
                {currentScenario === 'PROPIO' && currentRole === 'CLIENTE' && (
                  <p className="text-[9px] text-amber-600 font-bold bg-amber-50 p-2 rounded-lg mt-1">El rol Cliente no aplica en modo Propio. Se cambiará a Admin.</p>
                )}
              </div>
            )}

            {/* Misiones */}
            {tab === 'missions' && (
              <div className="space-y-2">
                {missions.length === 0 ? (
                  <p className="text-center text-slate-400 text-[10px] font-bold py-4 uppercase">Sin misiones para este rol</p>
                ) : missions.map(m => {
                  const done = completedMissions.includes(m.id);
                  return (
                    <button key={m.id} onClick={() => { switchTab(m.tab); setOpen(false); }}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all border-2 ${done ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-100 hover:border-amber-300 hover:bg-amber-50/30'}`}>
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                        {done
                          ? <CheckCircle2 size={14}/>
                          : <span className="text-[10px] font-black">{missions.indexOf(m)+1}</span>
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-black ${done ? 'text-emerald-700 line-through opacity-70' : 'text-slate-700'}`}>{m.label}</p>
                        <p className="text-[9px] text-slate-400 font-medium">{m.desc}</p>
                      </div>
                      {!done && (
                        <span className="text-[8px] font-black text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full uppercase shrink-0">Ir</span>
                      )}
                    </button>
                  );
                })}
                {completedCount === missions.length && missions.length > 0 && (
                  <div className="text-center py-3 bg-emerald-50 rounded-xl border border-emerald-200 mt-2">
                    <span className="text-lg">🎉</span>
                    <p className="text-[10px] font-black text-emerald-700 uppercase mt-1">¡Todas las misiones completadas!</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer — salir */}
          <div className="border-t border-slate-100 px-4 py-3 flex justify-between items-center">
            <p className="text-[8px] text-slate-400 font-bold uppercase">Los cambios no se guardan</p>
            <button onClick={() => { localStorage.removeItem('wms_token'); setCurrentUser(null); sessionStorage.removeItem('sandbox_missions'); sessionStorage.removeItem('sandbox_visited'); }}
              className="text-[9px] font-black text-red-500 hover:text-red-700 uppercase flex items-center gap-1 transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
              Salir del Sandbox
            </button>
          </div>
        </div>
      )}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ReceivePreviewModal — Ingreso masivo (recepción) con previsualización y
// validación client-side ANTES de insertar. El parseo es client-side (SheetJS,
// vía parseSpreadsheet) y solo las filas VÁLIDAS se envían a /api/receive_batch
// (transaccional, todo-o-nada). Las filas con error nunca se insertan.
// ─────────────────────────────────────────────────────────────────────────────
// Formato de ubicación: 4 segmentos bodega-pasillo-columna-fila (ej. 1-a-01-1).
const LOCATION_4SEG_RE = /^[A-Za-z0-9]+(-[A-Za-z0-9]+){3}$/;
const SPECIAL_LOCATIONS = ['PISO-RECEPCION'];

// ── Validadores reutilizables ────────────────────────────────────────────────
const vReqText = (label) => (v) => (String(v ?? '').trim() ? null : `${label} vacío`);
const vPosNum = (label) => (v) => {
  const s = String(v ?? '').trim();
  if (s === '') return `${label} vacía`;
  const n = parseFloat(s);
  if (isNaN(n)) return `${label} no numérica`;
  if (n <= 0) return `${label} debe ser mayor a 0`;
  return null;
};
const vLocation = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null; // opcional → vacío usa PISO-RECEPCION
  if (SPECIAL_LOCATIONS.includes(s.toUpperCase())) return null;
  return LOCATION_4SEG_RE.test(s) ? null : `Ubicación '${s}' con formato inválido (ej. 1-a-01-1)`;
};
const vSkuExists = (skuSet) => (v) => {
  const s = String(v ?? '').trim();
  if (!s) return 'SKU vacío';
  if (skuSet && skuSet.size > 0 && !skuSet.has(s.toUpperCase())) return `SKU '${s}' no existe en el catálogo`;
  return null;
};

// Interpreta el valor de una celda booleana (TRUE/FALSE/1/sí/x...) como marcado.
const isTruthyCell = (v) => v === true || ['true','1','sí','si','x','yes','verdadero'].includes(String(v ?? '').trim().toLowerCase());

// Normaliza los errores del backend a un array (strings u objetos {row,message}).
const normBackendErrors = (d) => {
  if (!d) return [];
  if (d.error) return [{ row: '-', message: d.error }];
  return Array.isArray(d.errors) ? d.errors : [];
};

// ── Esquemas por tipo de carga masiva ────────────────────────────────────────
// columns: campos a mostrar/editar · required: obligatorios · duplicateCheck:
// llama al dry-run /validate · validators(ctx): { campo: fn } · toBody: arma la
// llamada de inserción · parseResult: traduce la respuesta a { ok, info[], errors[] }.
const IMPORT_SCHEMAS = {
  receive: {
    title: 'Recepción masiva', template: 'receive',
    columns: ['sku','qty','location_id','batch_number','expiry_date','serial_number','glosa'],
    required: ['sku','qty'], duplicateCheck: true, docLabel: 'N° documento de recepción (opcional)',
    hint: 'Ubicación: bodega-pasillo-columna-fila (ej. 1-a-01-1) o vacío (PISO-RECEPCION)',
    validators: (ctx) => ({ sku: vSkuExists(ctx.skuSet), qty: vPosNum('Cantidad'), location_id: vLocation }),
    toBody: (rows, ctx) => ({ endpoint: 'receive_batch', body: {
      items: rows.map(r => ({
        sku: String(r.sku).trim(), qty: parseFloat(r.qty),
        batch: String(r.batch_number ?? '').trim() || null,
        expDate: String(r.expiry_date ?? '').trim() || null,
        serial: String(r.serial_number ?? '').trim() || null,
        location_id: String(r.location_id ?? '').trim() || 'PISO-RECEPCION',
      })),
      docNum: ctx.docNum || `REC-IMP-${Date.now()}`, docType: 'REC',
      glosa: 'Ingreso masivo por Excel', username: ctx.username,
    }}),
    parseResult: (d, n) => ({ ok: Number(d.imported) || n, info: [], errors: normBackendErrors(d) }),
  },
  dispatch: {
    title: 'Despacho masivo', template: 'dispatch',
    columns: ['sku','qty_to_pick','lpn_id'],
    required: ['sku','qty_to_pick'], duplicateCheck: true, docLabel: 'N° documento de despacho (opcional)',
    hint: 'LPN opcional: vacío = selección automática FEFO',
    validators: (ctx) => ({ sku: vSkuExists(ctx.skuSet), qty_to_pick: vPosNum('Cantidad') }),
    toBody: (rows, ctx) => ({ endpoint: 'import/dispatch', body: {
      rows: rows.map(r => ({ sku: String(r.sku).trim(), qty_to_pick: r.qty_to_pick, lpn_id: String(r.lpn_id ?? '').trim() })),
      doc_num: ctx.docNum || `DESP-IMP-${Date.now()}`, username: ctx.username,
    }}),
    parseResult: (d, n) => ({ ok: Number(d.success) || 0, info: [], errors: normBackendErrors(d) }),
  },
  skus: {
    title: 'Importar productos (SKUs)', template: 'skus',
    columns: ['sku','desc','client_id','category','uom','requires_lot','requires_serial','barcode','weight','length','width','height','abc_class','manufacturer_code','manufacturer_sku','brand'],
    required: ['sku','desc'], duplicateCheck: false,
    booleans: ['requires_lot','requires_serial'],
    hint: 'Marca la casilla para activar control de lote / serie',
    validators: () => ({ sku: vReqText('SKU'), desc: vReqText('Descripción') }),
    toBody: (rows, ctx) => ({ endpoint: 'import/skus', body: { rows, username: ctx.username } }),
    parseResult: (d, n) => {
      const info = [];
      if (d.inserted != null || d.updated != null) info.push(`${d.inserted || 0} nuevos · ${d.updated || 0} actualizados`);
      if (Array.isArray(d.versioned) && d.versioned.length)
        info.push(`${d.versioned.length} con nueva versión de control: ` + d.versioned.map(v => `${v.sku} (v${v.from}→v${v.to})`).join(', '));
      return { ok: Number(d.success) || 0, info, errors: normBackendErrors(d) };
    },
  },
  clients: {
    title: 'Importar clientes', template: 'clients',
    columns: ['id','name','contact','email'],
    required: ['id','name'], duplicateCheck: false,
    validators: () => ({ id: vReqText('ID'), name: vReqText('Nombre') }),
    toBody: (rows) => ({ endpoint: 'import/clients', body: { rows } }),
    parseResult: (d, n) => ({ ok: Number(d.success) || 0, info: [], errors: normBackendErrors(d) }),
  },
  inventory: {
    title: 'Importar inventario', template: 'inventory',
    columns: ['sku','qty','client_id','location_id','batch_number','expiry_date','serial_number','glosa'],
    required: ['sku','qty'], duplicateCheck: false,
    hint: 'Ubicación: bodega-pasillo-columna-fila (ej. 1-a-01-1) o vacío (PISO-RECEPCION)',
    validators: (ctx) => ({ sku: vSkuExists(ctx.skuSet), qty: vPosNum('Cantidad'), location_id: vLocation }),
    toBody: (rows, ctx) => ({ endpoint: 'import/inventory', body: { rows, username: ctx.username } }),
    parseResult: (d, n) => ({ ok: Number(d.success) || 0, info: [], errors: normBackendErrors(d) }),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// BulkImportModal — Carga masiva unificada para los 5 flujos (recepción, despacho,
// SKUs, clientes, inventario). Parseo client-side (SheetJS), validación por fila,
// celdas EDITABLES con re-validación en vivo, detección de duplicados (dentro del
// archivo + dry-run contra BD para recepción/despacho) y confirmación que envía
// SOLO las filas válidas. Las filas con error nunca se insertan.
// ─────────────────────────────────────────────────────────────────────────────
const BulkImportModal = ({ type, host, currentUser, skus = [], extraParams = {}, onClose, onSuccess }) => {
  const schema = IMPORT_SCHEMAS[type] || IMPORT_SCHEMAS.receive;
  const [status, setStatus] = useState('idle'); // idle | preview | importing | results
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);          // [{ data, localErrors[], dupErrors[], dupWarnings[] }]
  const [docNum, setDocNum] = useState('');
  const [docDuplicate, setDocDuplicate] = useState(false);
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState(null);  // { ok, info[], errors[] }
  const [isDragOver, setIsDragOver] = useState(false);

  const skuSet = useMemo(() => new Set((Array.isArray(skus) ? skus : []).map(s => String(s.sku ?? '').toUpperCase()).filter(Boolean)), [skus]);
  const validators = useMemo(() => schema.validators({ skuSet }), [schema, skuSet]);

  const validateData = (data) => {
    const errs = [];
    Object.entries(validators).forEach(([field, fn]) => { const e = fn(data[field]); if (e) errs.push(e); });
    // Requeridos sin validador específico → chequeo genérico de no-vacío.
    schema.required.forEach(f => { if (!validators[f] && String(data[f] ?? '').trim() === '') errs.push(`${f} vacío`); });
    return errs;
  };

  const isRowValid = (r) => r.localErrors.length === 0 && r.dupErrors.length === 0;
  const validRows = rows.filter(isRowValid);
  const errorRows = rows.filter(r => !isRowValid(r));

  const runDupCheck = async (currentRows, currentDoc) => {
    if (!schema.duplicateCheck) return;
    setChecking(true);
    try {
      const res = await apiFetch(`${host}/api/import/${type}/validate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: currentRows.map(r => r.data), doc_num: currentDoc || '' }),
      });
      const d = await res.json().catch(() => null);
      if (d && Array.isArray(d.rows)) {
        setRows(prev => prev.map((r, i) => ({ ...r, dupErrors: d.rows[i]?.errors ?? [], dupWarnings: d.rows[i]?.warnings ?? [] })));
        setDocDuplicate(!!d.doc_duplicate);
      }
    } catch { /* el backend revalida en el insert; el dry-run es solo informativo */ }
    finally { setChecking(false); }
  };

  const handleFile = async (file) => {
    if (!file) return;
    setError(''); setStatus('idle');
    try {
      const { headers, rows: parsed } = await parseSpreadsheet(file);
      const lower = headers.map(h => String(h).trim().toLowerCase());
      const missing = schema.required.filter(h => !lower.includes(h.toLowerCase()));
      if (missing.length) { setError(`El archivo no tiene las columnas requeridas: ${missing.join(', ')}.`); return; }
      if (!parsed.length) { setError('El archivo no contiene filas de datos.'); return; }
      const newRows = parsed.map(data => ({ data, localErrors: validateData(data), dupErrors: [], dupWarnings: [] }));
      setRows(newRows);
      setStatus('preview');
      runDupCheck(newRows, docNum);
    } catch (e) { setError('No se pudo leer el archivo: ' + (e?.message || 'formato no válido')); }
  };

  const updateCell = (idx, field, value) => {
    setRows(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      const data = { ...r.data, [field]: value };
      return { ...r, data, localErrors: validateData(data) };
    }));
  };

  const handleConfirm = async () => {
    const valids = rows.filter(isRowValid).map(r => r.data);
    if (!valids.length) return;
    setStatus('importing');
    const { endpoint, body } = schema.toBody(valids, { docNum, username: currentUser?.username, ...extraParams });
    try {
      const res = await apiFetch(`${host}/api/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, ...extraParams }),
      });
      let d = null; try { d = await res.json(); } catch { d = null; }
      if (!res.ok || !d || d.error) {
        setResults({ ok: 0, info: [], errors: [{ row: '-', message: (d && d.error) || `Error del servidor (HTTP ${res.status}).` }] });
        setStatus('results'); return;
      }
      const parsed = schema.parseResult(d, valids.length);
      setResults(parsed);
      setStatus('results');
      if (parsed.ok > 0) onSuccess?.();
    } catch (e) {
      setResults({ ok: 0, info: [], errors: [{ row: '-', message: e?.message || 'Error de red.' }] });
      setStatus('results');
    }
  };

  const handleCancel = () => { setRows([]); setResults(null); setError(''); setDocNum(''); setDocDuplicate(false); setStatus('idle'); onClose?.(); };

  const cols = schema.columns;
  const boolFields = schema.booleans || [];
  const rowMotivo = (r) => [...r.localErrors, ...r.dupErrors].join('; ');
  const safeResultErrors = Array.isArray(results?.errors) ? results.errors : [];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && handleCancel()}>
      <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter flex items-center"><Upload className="w-5 h-5 mr-2 text-emerald-500"/>{schema.title} — Previsualización</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Edita, verifica y confirma · CSV o XLSX</p>
          </div>
          <button onClick={handleCancel} className="p-2 hover:bg-slate-100 rounded-xl transition-colors"><X size={18} className="text-slate-400"/></button>
        </div>

        <div className="p-6 space-y-5">
          {/* Plantilla + columnas (solo en idle) */}
          {status === 'idle' && (
            <>
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-black text-emerald-800">Plantilla de ejemplo</p>
                  <p className="text-[10px] text-emerald-600 mt-0.5">Descarga el Excel con las columnas correctas</p>
                </div>
                <a href={`${host}/api/templates/${schema.template}`} download className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-colors">
                  <Download size={14}/> Descargar plantilla
                </a>
              </div>
              <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Columnas</p>
                <div className="flex flex-wrap gap-2">
                  {schema.required.map(f => <span key={f} className="bg-red-100 text-red-700 text-[10px] font-black px-2 py-1 rounded-lg uppercase">{f} *</span>)}
                  {cols.filter(c => !schema.required.includes(c)).map(f => <span key={f} className="bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-1 rounded-lg uppercase">{f}</span>)}
                </div>
                <p className="text-[9px] text-slate-400">* Obligatorio{schema.hint ? ` · ${schema.hint}` : ''}</p>
              </div>
              <div
                className={`border-2 border-dashed rounded-2xl p-10 text-center transition-colors cursor-pointer ${isDragOver ? 'border-emerald-400 bg-emerald-50' : 'border-slate-300 hover:border-emerald-300 hover:bg-slate-50'}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                onClick={() => document.getElementById('bulk-file-input').click()}
              >
                <Upload className="w-10 h-10 mx-auto mb-2 text-slate-300"/>
                <p className="text-sm font-black text-slate-500">Arrastra tu archivo aquí</p>
                <p className="text-[10px] text-slate-400 mt-1">o haz clic para seleccionar · CSV o XLSX</p>
                <input id="bulk-file-input" type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ''; }}/>
              </div>
            </>
          )}

          {error && <p className="text-sm font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}

          {/* Previsualización editable */}
          {status === 'preview' && (
            <div className="space-y-4">
              {schema.duplicateCheck && (
                <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                  <div className="flex-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{schema.docLabel}</label>
                    <input value={docNum} onChange={e => setDocNum(e.target.value)} onBlur={() => runDupCheck(rows, docNum)} placeholder="Déjalo vacío para autogenerar" className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-emerald-500"/>
                  </div>
                  <button onClick={() => runDupCheck(rows, docNum)} disabled={checking} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-50">
                    {checking ? <Loader2 size={12} className="animate-spin"/> : <ShieldAlert size={12}/>} Revalidar duplicados
                  </button>
                </div>
              )}
              {docDuplicate && <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">⚠️ El documento '{docNum}' ya fue procesado anteriormente.</p>}

              {/* Resumen */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center"><p className="text-2xl font-black text-slate-700">{rows.length}</p><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Filas</p></div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center"><p className="text-2xl font-black text-emerald-700">{validRows.length}</p><p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Válidas</p></div>
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center"><p className="text-2xl font-black text-red-600">{errorRows.length}</p><p className="text-[10px] font-bold text-red-400 uppercase tracking-widest">Con error</p></div>
              </div>
              <p className="text-[10px] text-slate-400 font-bold">Puedes corregir cualquier celda directamente en la tabla; la validación se actualiza al instante.</p>

              <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-96 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 font-black text-slate-500 uppercase text-[9px]">#</th>
                      <th className="px-2 py-2 font-black text-slate-500 uppercase text-[9px]">Estado</th>
                      {cols.map(h => <th key={h} className="px-2 py-2 font-black text-slate-500 uppercase text-[9px] whitespace-nowrap">{h}{schema.required.includes(h) && <span className="text-red-500"> *</span>}</th>)}
                      <th className="px-2 py-2 font-black text-slate-500 uppercase text-[9px]">Motivo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r, i) => {
                      const ok = isRowValid(r);
                      return (
                        <tr key={i} className={ok ? 'hover:bg-slate-50' : 'bg-red-50/50'}>
                          <td className="px-2 py-1 text-slate-400 font-bold">{i + 2}</td>
                          <td className="px-2 py-1">
                            {ok
                              ? <span className="inline-flex items-center gap-1 text-emerald-700 font-black text-[10px] uppercase"><CheckCircle2 size={12}/> OK</span>
                              : <span className="inline-flex items-center gap-1 text-red-700 font-black text-[10px] uppercase"><XCircle size={12}/> Error</span>}
                          </td>
                          {cols.map(h => {
                            // Campos booleanos (ej. requires_lot/serial) → casilla en vez de texto.
                            if (boolFields.includes(h)) {
                              return (
                                <td key={h} className="px-1 py-1 text-center">
                                  <input
                                    type="checkbox"
                                    checked={isTruthyCell(r.data[h])}
                                    onChange={(e) => updateCell(i, h, e.target.checked ? 'TRUE' : 'FALSE')}
                                    className="w-4 h-4 accent-emerald-600 cursor-pointer"
                                  />
                                </td>
                              );
                            }
                            const fieldErr = r.localErrors.some(e => e.toLowerCase().includes(h.replace('_',' ')) || e.toLowerCase().startsWith(h));
                            return (
                              <td key={h} className="px-1 py-1">
                                <input
                                  value={String(r.data[h] ?? '')}
                                  onChange={(e) => updateCell(i, h, e.target.value)}
                                  className={`w-full min-w-[80px] border rounded-md px-2 py-1 text-[11px] font-bold outline-none focus:border-emerald-500 ${fieldErr ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}
                                />
                              </td>
                            );
                          })}
                          <td className="px-2 py-1 text-[10px] font-bold max-w-[200px]">
                            {rowMotivo(r) && <span className="text-red-600">{rowMotivo(r)}</span>}
                            {r.dupWarnings.length > 0 && <span className="text-amber-600 block">{r.dupWarnings.join('; ')}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-3">
                <button onClick={handleCancel} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black py-4 rounded-2xl uppercase text-xs tracking-widest transition-colors">Cancelar</button>
                <button
                  onClick={handleConfirm}
                  disabled={validRows.length === 0}
                  className="flex-[2] bg-emerald-600 hover:bg-emerald-700 text-white font-black py-4 rounded-2xl shadow-lg uppercase text-xs tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex justify-center items-center"
                >
                  <Database size={16} className="mr-2"/> Confirmar ({validRows.length} {validRows.length === 1 ? 'fila válida' : 'filas válidas'})
                </button>
              </div>
              {validRows.length === 0 && <p className="text-[11px] text-red-500 font-bold text-center">No hay filas válidas. Corrige las celdas marcadas y reintenta.</p>}
            </div>
          )}

          {/* Importando */}
          {status === 'importing' && (
            <div className="py-10 text-center"><Loader2 className="w-12 h-12 mx-auto mb-3 text-emerald-400 animate-spin"/><p className="text-sm font-black text-slate-600 uppercase">Procesando...</p></div>
          )}

          {/* Resultados */}
          {status === 'results' && results && (
            <div className="space-y-4">
              <div className={`rounded-2xl p-5 ${results.ok > 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50 border border-slate-200'}`}>
                <p className="text-2xl font-black text-emerald-700">{Number(results.ok) || 0} <span className="text-sm font-bold text-emerald-600">filas procesadas correctamente</span></p>
                {safeResultErrors.length > 0 && <p className="text-sm font-bold text-amber-600 mt-1">{safeResultErrors.length} con error</p>}
              </div>
              {Array.isArray(results.info) && results.info.length > 0 && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 space-y-1">
                  {results.info.map((t, i) => <p key={i} className="text-xs text-indigo-700 font-bold">{t}</p>)}
                </div>
              )}
              {safeResultErrors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-1 max-h-48 overflow-y-auto">
                  {safeResultErrors.map((e, i) => <p key={i} className="text-xs text-red-700 font-bold">{typeof e === 'string' ? e : `Fila ${e?.row ?? '-'}${e?.sku ? ` · ${e.sku}` : ''}: ${e?.message ?? JSON.stringify(e)}`}</p>)}
                </div>
              )}
              <button onClick={handleCancel} className="w-full bg-slate-900 hover:bg-black text-white font-black py-4 rounded-2xl uppercase text-xs tracking-widest transition-colors">Cerrar</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
// ─────────────────────────────────────────────────────────────────────────────

export {
  GlobalStyles,
  SimpleDonut,
  DocTrayView,
  LocPicker,
  DigitalTwinView,
  ImportModal,
  BulkImportModal,
  ConfirmModal,
  DemoHint,
  SandboxWelcome,
  SandboxLauncher,
  SandboxSwitcher,
};
