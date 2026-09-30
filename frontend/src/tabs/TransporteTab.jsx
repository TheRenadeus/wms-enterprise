// Módulo "Transporte y Logística" — vista propia del COORDINADOR_TRANSPORTE,
// separada del dashboard operativo de bodega (Fase 4).
//
// Sub-secciones:
//   · Dashboard  — KPIs, filtros, cola de solicitudes, flota, alertas.
//   · Flota & Maestros — CRUD de transportistas, vehículos, choferes, pionetas,
//                        clientes de transporte y tipos de vehículo (UI de Fase 2).
//   · Solicitudes — listado + alta de solicitud "solo transporte" (Origen B, Fase 3).
//
// Hace su propio fetch (apiFetch ya adjunta el token). El backend revalida permisos
// (requireTransporte) y RUT; aquí solo damos feedback inmediato.

import React, { useState, useEffect, useCallback } from 'react';
import {
  Truck, RefreshCcw, Plus, Trash2, AlertTriangle, Users, MapPin,
  Box, Search, ClipboardList, LayoutDashboard, Boxes, X, ArrowRightLeft, Route, PackageCheck, Container,
} from 'lucide-react';
import { apiFetch, isValidRut, formatRut } from '../utils';
import { useConfirm } from '../useConfirm';

const api = (path, opts) => apiFetch(`/api${path}`, opts);
const send = (path, method, body) =>
  api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));

// ── Helpers de presentación ────────────────────────────────────────────────────
function Kpi({ label, value, color, icon: Icon }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center gap-4`}>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}><Icon size={22} /></div>
      <div>
        <div className="text-3xl font-black text-slate-800 leading-none">{value}</div>
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">{label}</div>
      </div>
    </div>
  );
}

const badgeOrigen = (o) =>
  o === 'DESPACHO'
    ? <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[9px] font-black uppercase">Bodega</span>
    : <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-black uppercase">Solo transp.</span>;

export default function TransporteTab({ showMsg = () => {}, currentUser }) {
  const role = currentUser?.role;
  const canWrite = ['COORDINADOR_TRANSPORTE', 'ADMIN', 'SUPERADMIN'].includes(role);
  const [section, setSection] = useState('dashboard');

  return (
    <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
          <Truck className="text-cyan-600" /> Transporte y Logística
        </h1>
        <div className="flex bg-slate-100 rounded-2xl p-1 gap-1">
          {[
            ['dashboard', 'Dashboard', LayoutDashboard],
            ['flota', 'Flota & Maestros', Boxes],
            ['solicitudes', 'Solicitudes', ClipboardList],
            ['envios', 'Envíos', Truck],
            ['avisos', 'Avisos llegada', PackageCheck],
            ['contenedores', 'Contenedores', Container],
          ].map(([id, label, Icon]) => (
            <button key={id} onClick={() => setSection(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-black uppercase transition-colors ${section === id ? 'bg-white shadow text-cyan-700' : 'text-slate-500 hover:text-slate-700'}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </div>

      {section === 'dashboard' && <DashboardView showMsg={showMsg} />}
      {section === 'flota' && <FlotaView showMsg={showMsg} canWrite={canWrite} />}
      {section === 'solicitudes' && <SolicitudesView showMsg={showMsg} canWrite={canWrite} />}
      {section === 'envios' && <EnviosView showMsg={showMsg} canWrite={canWrite} />}
      {section === 'avisos' && <AvisosView showMsg={showMsg} canWrite={canWrite} />}
      {section === 'contenedores' && <ContenedoresView showMsg={showMsg} canWrite={canWrite} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTENEDORES (Fase 9)
// ═══════════════════════════════════════════════════════════════════════════
const ESTADOS_CNT = ['en_puerto', 'en_transito', 'en_bodega', 'devuelto_naviera'];
const estadoCntBadge = (e) => {
  const m = { en_puerto: 'bg-slate-100 text-slate-600', en_transito: 'bg-violet-100 text-violet-700', en_bodega: 'bg-blue-100 text-blue-700', devuelto_naviera: 'bg-emerald-100 text-emerald-700' };
  return <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${m[e] || 'bg-slate-100'}`}>{(e || '').replace(/_/g, ' ')}</span>;
};

function ContenedoresView({ showMsg, canWrite }) {
  const [items, setItems] = useState([]);
  const [envios] = useList('/transporte/envios');
  const [avisos] = useList('/transporte/avisos-llegada');
  const empty = { numero: '', tipo: '20', sello: '', naviera: '', sentido: 'EXPORT' };
  const [form, setForm] = useState(empty);
  const [asoc, setAsoc] = useState({});
  const reload = useCallback(() => { api('/transporte/contenedores').then(r => r.json()).then(d => setItems(Array.isArray(d) ? d : [])).catch(() => {}); }, []);
  useEffect(() => { reload(); }, [reload]);

  const add = async () => {
    if (!form.numero) return showMsg('Número de contenedor requerido', true);
    const res = await send('/transporte/contenedores', 'POST', form);
    const d = await res.json();
    if (res.ok) { showMsg('Contenedor creado'); setForm(empty); reload(); } else showMsg(d.error || 'Error', true);
  };
  const setEstado = async (id, estado) => { const res = await send(`/transporte/contenedores/${id}/estado`, 'PATCH', { estado }); const d = await res.json(); if (res.ok) { showMsg(`→ ${estado}`); reload(); } else showMsg(d.error || 'Error', true); };
  const asociar = async (c) => {
    const v = asoc[c.id];
    if (!v) return showMsg('Elija destino para asociar', true);
    const body = c.sentido === 'EXPORT' ? { envio_id: v } : { aviso_llegada_id: v };
    const res = await send(`/transporte/contenedores/${c.id}/asociar`, 'PATCH', body);
    const d = await res.json();
    if (res.ok) { showMsg('Asociado'); reload(); } else showMsg(d.error || 'Error', true);
  };

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
          <div className="text-xs font-black text-slate-600 uppercase tracking-wider flex items-center gap-2"><Container size={14} /> Nuevo contenedor</div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <input value={form.numero} onChange={e => setForm({ ...form, numero: e.target.value.toUpperCase() })} placeholder="Número *" className={inputCls} />
            <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })} className={`${inputCls} bg-white`}>{['20', '40', '40HC', 'REEFER'].map(t => <option key={t} value={t}>{t}</option>)}</select>
            <select value={form.sentido} onChange={e => setForm({ ...form, sentido: e.target.value })} className={`${inputCls} bg-white`}><option value="EXPORT">EXPORT</option><option value="IMPORT">IMPORT</option></select>
            <input value={form.sello} onChange={e => setForm({ ...form, sello: e.target.value })} placeholder="Sello" className={inputCls} />
            <input value={form.naviera} onChange={e => setForm({ ...form, naviera: e.target.value })} placeholder="Naviera" className={inputCls} />
            <button onClick={add} className="bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg px-3 py-2 text-[10px] font-black uppercase flex items-center justify-center gap-1"><Plus size={13} /> Crear</button>
          </div>
        </div>
      )}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b bg-slate-50 text-xs font-black text-slate-600 uppercase tracking-wider flex items-center justify-between">
          Contenedores ({items.length})<button onClick={reload} className="text-cyan-600 hover:text-cyan-800"><RefreshCcw size={13} /></button>
        </div>
        <Tabla cols={['Número', 'Tipo', 'Sentido', 'Naviera', 'Estado', 'Asociado a', canWrite ? 'Acciones' : ''].filter(Boolean)} rows={items.map(c => [
          <b className="font-mono">{c.numero}</b>, c.tipo || '—',
          <span className={`text-[9px] font-black ${c.sentido === 'EXPORT' ? 'text-blue-600' : 'text-amber-600'}`}>{c.sentido}</span>,
          c.naviera || '—', estadoCntBadge(c.estado),
          c.envio_id || c.aviso_llegada_id || <span className="text-slate-300">sin asociar</span>,
          ...(canWrite ? [
            <div className="flex flex-col gap-1 min-w-[200px]">
              {c.estado !== 'devuelto_naviera' && (
                <select value="" onChange={e => e.target.value && setEstado(c.id, e.target.value)} className="border border-slate-200 rounded px-1.5 py-1 text-[9px] font-bold outline-none focus:border-cyan-500">
                  <option value="">Cambiar estado…</option>
                  {ESTADOS_CNT.filter(s => s !== c.estado).map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              )}
              {!c.envio_id && !c.aviso_llegada_id && (
                <div className="flex gap-1">
                  <select value={asoc[c.id] || ''} onChange={e => setAsoc({ ...asoc, [c.id]: e.target.value })} className="border border-slate-200 rounded px-1.5 py-1 text-[9px] font-bold outline-none focus:border-cyan-500 flex-1">
                    <option value="">{c.sentido === 'EXPORT' ? 'Envío…' : 'Aviso…'}</option>
                    {(c.sentido === 'EXPORT' ? envios : avisos).map(o => <option key={o.id} value={o.id}>{c.sentido === 'EXPORT' ? `${o.id} (${o.matricula || '—'})` : `${o.id} · ${o.vehiculo_desc || o.carga_desc || ''}`}</option>)}
                  </select>
                  <button onClick={() => asociar(c)} className="bg-cyan-600 text-white px-2 py-1 rounded text-[9px] font-black uppercase">Asociar</button>
                </div>
              )}
            </div>,
          ] : []),
        ])} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// AVISOS DE LLEGADA (inbound) — alta por el coordinador (Fase 8)
// ═══════════════════════════════════════════════════════════════════════════
const estadoAvisoBadge = (e) => {
  const m = { avisado: 'bg-amber-100 text-amber-700', recibido: 'bg-blue-100 text-blue-700', almacenado: 'bg-emerald-100 text-emerald-700' };
  return <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${m[e] || 'bg-slate-100'}`}>{e}</span>;
};

export function AvisosView({ showMsg, canWrite, soloLectura }) {
  const [items, setItems] = useState([]);
  const [transportistas] = useList('/transporte/transportistas');
  const [clientes, setClientes] = useState([]);
  const empty = { vehiculo_desc: '', transportista_id: '', carga_desc: '', client_id: '', hora_estimada_llegada: '' };
  const [form, setForm] = useState(empty);
  const reload = useCallback(() => { api('/transporte/avisos-llegada').then(r => r.json()).then(d => setItems(Array.isArray(d) ? d : [])).catch(() => {}); }, []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { apiFetch('/api/clients').then(r => r.json()).then(d => setClientes(Array.isArray(d) ? d : [])).catch(() => {}); }, []);

  const add = async () => {
    if (!form.carga_desc && !form.vehiculo_desc) return showMsg('Indique carga o vehículo', true);
    const res = await send('/transporte/avisos-llegada', 'POST', form);
    const d = await res.json();
    if (res.ok) { showMsg('Aviso creado'); setForm(empty); reload(); } else showMsg(d.error || 'Error', true);
  };
  const del = async (id) => { const res = await send(`/transporte/avisos-llegada/${id}`, 'DELETE'); const d = await res.json(); if (res.ok) { showMsg('Eliminado'); reload(); } else showMsg(d.error || 'Error', true); };
  const avanzar = async (id, estado) => { const res = await send(`/transporte/avisos-llegada/${id}/estado`, 'PATCH', { estado }); const d = await res.json(); if (res.ok) { showMsg(`→ ${estado}`); reload(); } else showMsg(d.error || 'Error', true); };

  return (
    <div className="space-y-4">
      {canWrite && !soloLectura && (
        <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-5 space-y-3">
          <div className="text-xs font-black text-emerald-700 uppercase tracking-wider flex items-center gap-2"><PackageCheck size={14} /> Nuevo aviso de llegada (carga que se almacena)</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <input value={form.vehiculo_desc} onChange={e => setForm({ ...form, vehiculo_desc: e.target.value })} placeholder="Vehículo / matrícula" className={inputCls} />
            <select value={form.transportista_id} onChange={e => setForm({ ...form, transportista_id: e.target.value })} className={`${inputCls} bg-white`}><option value="">Transportista (opc.)</option>{transportistas.map(t => <option key={t.id} value={t.id}>{t.nombre_razon_social}</option>)}</select>
            <select value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })} className={`${inputCls} bg-white`}><option value="">Cliente bodega</option>{clientes.map(c => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}</select>
            <input value={form.carga_desc} onChange={e => setForm({ ...form, carga_desc: e.target.value })} placeholder="Descripción de la carga" className={`${inputCls} md:col-span-2`} />
            <input type="datetime-local" value={form.hora_estimada_llegada} onChange={e => setForm({ ...form, hora_estimada_llegada: e.target.value })} className={inputCls} />
          </div>
          <button onClick={add} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-4 py-2 text-[10px] font-black uppercase">Crear aviso</button>
        </div>
      )}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b bg-slate-50 text-xs font-black text-slate-600 uppercase tracking-wider flex items-center justify-between">
          Avisos de llegada ({items.length})<button onClick={reload} className="text-cyan-600 hover:text-cyan-800"><RefreshCcw size={13} /></button>
        </div>
        <Tabla cols={['Vehículo', 'Transportista', 'Cliente', 'Carga', 'ETA', 'Estado', '']} rows={items.map(a => [
          <b>{a.vehiculo_desc || '—'}</b>, a.transportista_nombre || '—', a.cliente_nombre || a.client_id || '—',
          <span className="max-w-[160px] truncate inline-block">{a.carga_desc || '—'}</span>,
          a.hora_estimada_llegada ? new Date(a.hora_estimada_llegada).toLocaleString('es-CL') : '—',
          estadoAvisoBadge(a.estado),
          soloLectura
            ? (a.estado === 'avisado' ? <button onClick={() => avanzar(a.id, 'recibido')} className="bg-blue-600 text-white px-2 py-1 rounded text-[9px] font-black uppercase">Recibir</button>
              : a.estado === 'recibido' ? <button onClick={() => avanzar(a.id, 'almacenado')} className="bg-emerald-600 text-white px-2 py-1 rounded text-[9px] font-black uppercase">Almacenar</button>
                : <span className="text-[9px] text-slate-400">listo</span>)
            : (canWrite && a.estado === 'avisado' ? <button onClick={() => del(a.id)} className="text-rose-500 hover:text-rose-700"><Trash2 size={14} /></button> : null),
        ])} />
      </div>
    </div>
  );
}

// ── Modal genérico ──────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">{children}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
function DashboardView({ showMsg }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState({ fecha: '', transportista: '', estado: 'pendiente', origen: '', sentido: '', buscar: '' });
  const [transportistas, setTransportistas] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
      const res = await api(`/transporte/dashboard?${qs}`);
      const d = await res.json();
      if (res.ok) setData(d); else showMsg(d.error || 'Error al cargar dashboard', true);
    } catch (e) { showMsg('Error de red al cargar dashboard', true); }
    finally { setLoading(false); }
  }, [f, showMsg]);

  // Debounced: `load` cambia con cada tecla en el buscador (f.buscar), y sin
  // esto se dispara un fetch al costoso /transporte/dashboard por caracter.
  useEffect(() => {
    const t = setTimeout(() => load(), 400);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => { api('/transporte/transportistas').then(r => r.json()).then(d => setTransportistas(Array.isArray(d) ? d : [])).catch(() => {}); }, []);

  const k = data?.kpis || {};
  const sols = data?.solicitudes_pendientes || [];
  const flota = data?.flota || { vehiculos: [], choferes: [], pionetas: [] };
  const alertas = data?.alertas || { volumen_incompleto: [] };

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Solicitudes pendientes" value={k.pendientes ?? '—'} color="bg-amber-100 text-amber-600" icon={ClipboardList} />
        <Kpi label="Envíos en ruta" value={k.en_ruta ?? '—'} color="bg-blue-100 text-blue-600" icon={Truck} />
        <Kpi label="Esperan POD" value={k.esperan_pod ?? '—'} color="bg-violet-100 text-violet-600" icon={MapPin} />
        <Kpi label="Vehículos disponibles" value={k.vehiculos_disponibles ?? '—'} color="bg-emerald-100 text-emerald-600" icon={Box} />
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-end gap-3">
        <div><label className="text-[9px] font-black text-slate-400 uppercase">Fecha</label>
          <input type="date" value={f.fecha} onChange={e => setF({ ...f, fecha: e.target.value })} className="block border-2 border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:border-cyan-500" /></div>
        <div><label className="text-[9px] font-black text-slate-400 uppercase">Transportista</label>
          <select value={f.transportista} onChange={e => setF({ ...f, transportista: e.target.value })} className="block border-2 border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:border-cyan-500 bg-white max-w-[160px]">
            <option value="">Todos</option>
            {transportistas.map(t => <option key={t.id} value={t.id}>{t.nombre_razon_social} ({t.tipo})</option>)}
          </select></div>
        <div><label className="text-[9px] font-black text-slate-400 uppercase">Estado</label>
          <select value={f.estado} onChange={e => setF({ ...f, estado: e.target.value })} className="block border-2 border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:border-cyan-500 bg-white">
            <option value="pendiente">Pendiente</option><option value="asignada">Asignada</option><option value="anulada">Anulada</option>
          </select></div>
        <div><label className="text-[9px] font-black text-slate-400 uppercase">Origen</label>
          <select value={f.origen} onChange={e => setF({ ...f, origen: e.target.value })} className="block border-2 border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:border-cyan-500 bg-white">
            <option value="">Todos</option><option value="DESPACHO">Bodega</option><option value="SOLO_TRANSPORTE">Solo transporte</option>
          </select></div>
        <div><label className="text-[9px] font-black text-slate-400 uppercase">Sentido</label>
          <select value={f.sentido} onChange={e => setF({ ...f, sentido: e.target.value })} className="block border-2 border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:border-cyan-500 bg-white">
            <option value="">Ambos</option><option value="SALIDA">Salida</option><option value="REGRESO">Regreso</option>
          </select></div>
        <div className="flex-1 min-w-[160px]"><label className="text-[9px] font-black text-slate-400 uppercase">Buscar (despacho/cliente)</label>
          <div className="flex items-center border-2 border-slate-200 rounded-lg px-2 focus-within:border-cyan-500">
            <Search size={13} className="text-slate-400" />
            <input value={f.buscar} onChange={e => setF({ ...f, buscar: e.target.value })} placeholder="N° despacho o cliente…" className="px-2 py-1.5 text-xs font-bold outline-none w-full" /></div></div>
        <button onClick={load} className="bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg text-[10px] font-black uppercase flex items-center gap-1.5"><RefreshCcw size={12} className={loading ? 'animate-spin' : ''} /> Actualizar</button>
      </div>

      {/* Alertas */}
      {alertas.volumen_incompleto?.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 text-rose-700 font-black text-xs uppercase mb-2"><AlertTriangle size={15} /> Volumen incompleto (SKU sin dimensiones)</div>
          <div className="flex flex-wrap gap-2">
            {alertas.volumen_incompleto.map(a => (
              <span key={a.id} className="px-2 py-1 bg-white border border-rose-200 rounded-lg text-[10px] font-bold text-rose-700">
                {a.despacho_doc_num || a.cliente || a.id}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Cola de solicitudes */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-slate-50 text-xs font-black text-slate-600 uppercase tracking-wider">Cola de solicitudes ({sols.length})</div>
          <div className="overflow-x-auto max-h-[480px]">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[9px] text-slate-400 uppercase sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2">Origen</th><th className="text-left px-3 py-2">Cliente / Despacho</th>
                  <th className="text-right px-3 py-2">Peso / Vol.</th><th className="text-center px-3 py-2">Bultos</th>
                  <th className="text-left px-3 py-2">Tipo sug.</th><th className="text-left px-3 py-2">Destino</th><th className="text-left px-3 py-2">Sentido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sols.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-8 font-bold">Sin solicitudes para los filtros actuales.</td></tr>}
                {sols.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2">{badgeOrigen(s.origen)}</td>
                    <td className="px-3 py-2 font-bold text-slate-700">
                      {s.cliente_nombre || s.cliente_transporte_nombre || s.origen_texto || '—'}
                      {s.despacho_doc_num && <span className="block text-[9px] text-slate-400 font-mono">{s.despacho_doc_num}</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {num(s.peso_total).toLocaleString('es-CL')} kg<br />
                      <span className={s.dims_incompletas ? 'text-rose-600 font-black' : 'text-slate-500'}>
                        {num(s.volumen_total).toLocaleString('es-CL')} m³{s.dims_incompletas && ' ⚠'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center text-[10px] text-slate-500">
                      {s.n_cajas ? `${s.n_cajas}cj ` : ''}{s.n_cajones ? `${s.n_cajones}cn ` : ''}{s.n_pallets ? `${s.n_pallets}pl` : ''}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{s.tipo_vehiculo_sugerido || '—'}</td>
                    <td className="px-3 py-2 text-slate-600 max-w-[140px] truncate">{s.destino || '—'}</td>
                    <td className="px-3 py-2"><span className={`text-[9px] font-black uppercase ${s.sentido === 'REGRESO' ? 'text-orange-600' : 'text-emerald-600'}`}>{s.sentido}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Flota disponible */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="text-xs font-black text-slate-600 uppercase tracking-wider">Flota disponible</div>
          <FlotaResumen icon={Box} color="text-emerald-600" label="Vehículos" items={flota.vehiculos.map(v => `${v.matricula} · ${v.tipo_vehiculo || '—'} · ${num(v.capacidad_carga_kg).toLocaleString('es-CL')}kg`)} />
          <FlotaResumen icon={Users} color="text-blue-600" label="Choferes" items={flota.choferes.map(c => c.nombre)} />
          <FlotaResumen icon={Users} color="text-violet-600" label="Pionetas" items={flota.pionetas.map(p => p.nombre)} />
        </div>
      </div>
    </div>
  );
}

function FlotaResumen({ icon: Icon, color, label, items }) {
  return (
    <div>
      <div className={`flex items-center gap-1.5 text-[10px] font-black uppercase mb-1 ${color}`}><Icon size={13} /> {label} ({items.length})</div>
      <div className="flex flex-wrap gap-1">
        {items.length === 0 && <span className="text-[10px] text-slate-400">Ninguno</span>}
        {items.map((t, i) => <span key={i} className="px-2 py-0.5 bg-slate-100 rounded text-[9px] font-bold text-slate-600">{t}</span>)}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOTA & MAESTROS
// ═══════════════════════════════════════════════════════════════════════════
function FlotaView({ showMsg, canWrite }) {
  const [tab, setTab] = useState('transportistas');
  const tabs = [
    ['transportistas', 'Transportistas'], ['vehiculos', 'Vehículos'],
    ['choferes', 'Choferes'], ['pionetas', 'Pionetas'],
    ['clientes', 'Clientes transp.'], ['tipos', 'Tipos vehículo'],
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase ${tab === id ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-700'}`}>{label}</button>
        ))}
      </div>
      {tab === 'transportistas' && <Transportistas showMsg={showMsg} canWrite={canWrite} />}
      {tab === 'vehiculos' && <Vehiculos showMsg={showMsg} canWrite={canWrite} />}
      {tab === 'choferes' && <SimplePersonas tipo="choferes" titulo="Chofer" showMsg={showMsg} canWrite={canWrite} conCorreo />}
      {tab === 'pionetas' && <SimplePersonas tipo="pionetas" titulo="Pioneta" showMsg={showMsg} canWrite={canWrite} />}
      {tab === 'clientes' && <ClientesTransporte showMsg={showMsg} canWrite={canWrite} />}
      {tab === 'tipos' && <TiposVehiculo showMsg={showMsg} canWrite={canWrite} />}
    </div>
  );
}

const inputCls = 'border-2 border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-cyan-500';
const RutInput = ({ value, onChange }) => {
  const bad = value && !isValidRut(value);
  return (
    <div>
      <input value={value} onChange={onChange} placeholder="RUT (ej: 12.345.678-5)" className={`${inputCls} ${bad ? 'border-rose-400' : ''} w-full`} />
      {bad && <span className="text-[9px] text-rose-600 font-bold">Dígito verificador inválido</span>}
    </div>
  );
};

function useList(path) {
  const [items, setItems] = useState([]);
  const reload = useCallback(() => { api(path).then(r => r.json()).then(d => setItems(Array.isArray(d) ? d : [])).catch(() => {}); }, [path]);
  useEffect(() => { reload(); }, [reload]);
  return [items, reload];
}

function Transportistas({ showMsg, canWrite }) {
  const [items, reload] = useList('/transporte/transportistas');
  const [form, setForm] = useState({ nombre_razon_social: '', tipo: 'PROPIO', rut: '', contacto: '' });
  const add = async () => {
    if (!form.nombre_razon_social) return showMsg('Razón social requerida', true);
    if (form.rut && !isValidRut(form.rut)) return showMsg('RUT inválido', true);
    const res = await send('/transporte/transportistas', 'POST', form);
    const d = await res.json();
    if (res.ok) { showMsg('Transportista creado'); setForm({ nombre_razon_social: '', tipo: 'PROPIO', rut: '', contacto: '' }); reload(); }
    else showMsg(d.error || 'Error', true);
  };
  const del = async (id) => { const res = await send(`/transporte/transportistas/${id}`, 'DELETE'); if (res.ok) { showMsg('Desactivado'); reload(); } };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
      {canWrite && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-start">
          <input value={form.nombre_razon_social} onChange={e => setForm({ ...form, nombre_razon_social: e.target.value })} placeholder="Razón social *" className={inputCls} />
          <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })} className={`${inputCls} bg-white`}><option value="PROPIO">Propio</option><option value="EXTERNO">Externo</option></select>
          <RutInput value={form.rut} onChange={e => setForm({ ...form, rut: e.target.value })} />
          <input value={form.contacto} onChange={e => setForm({ ...form, contacto: e.target.value })} placeholder="Contacto" className={inputCls} />
          <button onClick={add} className="bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg px-3 py-2 text-[10px] font-black uppercase flex items-center justify-center gap-1"><Plus size={13} /> Agregar</button>
        </div>
      )}
      <Tabla cols={['Razón social', 'Tipo', 'RUT', 'Contacto', '']} rows={items.map(t => [
        t.nombre_razon_social,
        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${t.tipo === 'PROPIO' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{t.tipo}</span>,
        t.rut ? formatRut(t.rut) : '—', t.contacto || '—',
        canWrite ? <button onClick={() => del(t.id)} className="text-rose-500 hover:text-rose-700"><Trash2 size={14} /></button> : null,
      ])} />
    </div>
  );
}

function Vehiculos({ showMsg, canWrite }) {
  const [items, reload] = useList('/transporte/vehiculos');
  const [transportistas] = useList('/transporte/transportistas');
  const [tipos] = useList('/transporte/tipos-vehiculo');
  const empty = { transportista_id: '', tipo_vehiculo: '', matricula: '', capacidad_carga_kg: '', area_largo: '', area_ancho: '', area_alto: '' };
  const [form, setForm] = useState(empty);
  const add = async () => {
    if (!form.transportista_id || !form.matricula) return showMsg('Transportista y matrícula requeridos', true);
    const res = await send('/transporte/vehiculos', 'POST', form);
    const d = await res.json();
    if (res.ok) { showMsg('Vehículo creado'); setForm(empty); reload(); } else showMsg(d.error || 'Error', true);
  };
  const del = async (id) => { const res = await send(`/transporte/vehiculos/${id}`, 'DELETE'); if (res.ok) { showMsg('Desactivado'); reload(); } };
  const vol = (num(form.area_largo) * num(form.area_ancho) * num(form.area_alto)).toFixed(3);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
      {canWrite && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <select value={form.transportista_id} onChange={e => setForm({ ...form, transportista_id: e.target.value })} className={`${inputCls} bg-white`}><option value="">Transportista *</option>{transportistas.map(t => <option key={t.id} value={t.id}>{t.nombre_razon_social}</option>)}</select>
            <select value={form.tipo_vehiculo} onChange={e => setForm({ ...form, tipo_vehiculo: e.target.value })} className={`${inputCls} bg-white`}><option value="">Tipo vehículo</option>{tipos.map(t => <option key={t.id} value={t.nombre}>{t.nombre}</option>)}</select>
            <input value={form.matricula} onChange={e => setForm({ ...form, matricula: e.target.value })} placeholder="Matrícula *" className={inputCls} />
            <input type="number" value={form.capacidad_carga_kg} onChange={e => setForm({ ...form, capacidad_carga_kg: e.target.value })} placeholder="Capacidad (kg)" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-center">
            <input type="number" step="0.01" value={form.area_largo} onChange={e => setForm({ ...form, area_largo: e.target.value })} placeholder="Área largo (m)" className={inputCls} />
            <input type="number" step="0.01" value={form.area_ancho} onChange={e => setForm({ ...form, area_ancho: e.target.value })} placeholder="Área ancho (m)" className={inputCls} />
            <input type="number" step="0.01" value={form.area_alto} onChange={e => setForm({ ...form, area_alto: e.target.value })} placeholder="Área alto (m)" className={inputCls} />
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-500">Vol. útil: <b className="text-cyan-700">{vol} m³</b></span>
              <button onClick={add} className="bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg px-3 py-2 text-[10px] font-black uppercase flex items-center gap-1"><Plus size={13} /> Agregar</button>
            </div>
          </div>
        </div>
      )}
      <Tabla cols={['Matrícula', 'Tipo', 'Transportista', 'Capacidad', 'Vol. útil', '']} rows={items.map(v => [
        <b>{v.matricula}</b>, v.tipo_vehiculo || '—', v.transportista_nombre || '—',
        `${num(v.capacidad_carga_kg).toLocaleString('es-CL')} kg`, `${num(v.volumen_util).toLocaleString('es-CL')} m³`,
        canWrite ? <button onClick={() => del(v.id)} className="text-rose-500 hover:text-rose-700"><Trash2 size={14} /></button> : null,
      ])} />
    </div>
  );
}

function SimplePersonas({ tipo, titulo, showMsg, canWrite, conCorreo }) {
  const [items, reload] = useList(`/transporte/${tipo}`);
  const [transportistas] = useList('/transporte/transportistas');
  const empty = { transportista_id: '', nombre: '', rut: '', contacto: '', correo: '' };
  const [form, setForm] = useState(empty);
  const add = async () => {
    if (!form.transportista_id || !form.nombre) return showMsg('Transportista y nombre requeridos', true);
    if (form.rut && !isValidRut(form.rut)) return showMsg('RUT inválido', true);
    const res = await send(`/transporte/${tipo}`, 'POST', form);
    const d = await res.json();
    if (res.ok) { showMsg(`${titulo} creado`); setForm(empty); reload(); } else showMsg(d.error || 'Error', true);
  };
  const del = async (id) => { const res = await send(`/transporte/${tipo}/${id}`, 'DELETE'); if (res.ok) { showMsg('Desactivado'); reload(); } };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
      {canWrite && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-start">
          <select value={form.transportista_id} onChange={e => setForm({ ...form, transportista_id: e.target.value })} className={`${inputCls} bg-white`}><option value="">Transportista *</option>{transportistas.map(t => <option key={t.id} value={t.id}>{t.nombre_razon_social}</option>)}</select>
          <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Nombre *" className={inputCls} />
          <RutInput value={form.rut} onChange={e => setForm({ ...form, rut: e.target.value })} />
          {conCorreo ? <input value={form.correo} onChange={e => setForm({ ...form, correo: e.target.value })} placeholder="Correo" className={inputCls} /> : <input value={form.contacto} onChange={e => setForm({ ...form, contacto: e.target.value })} placeholder="Contacto" className={inputCls} />}
          <button onClick={add} className="bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg px-3 py-2 text-[10px] font-black uppercase flex items-center justify-center gap-1"><Plus size={13} /> Agregar</button>
        </div>
      )}
      <Tabla cols={['Nombre', 'RUT', conCorreo ? 'Correo' : 'Contacto', '']} rows={items.map(p => [
        <b>{p.nombre}</b>, p.rut ? formatRut(p.rut) : '—', (conCorreo ? p.correo : p.contacto) || '—',
        canWrite ? <button onClick={() => del(p.id)} className="text-rose-500 hover:text-rose-700"><Trash2 size={14} /></button> : null,
      ])} />
    </div>
  );
}

function ClientesTransporte({ showMsg, canWrite }) {
  const [items, reload] = useList('/transporte/clientes');
  const [form, setForm] = useState({ nombre: '', rut: '', contacto: '' });
  const [dest, setDest] = useState({});
  const add = async () => {
    if (!form.nombre) return showMsg('Nombre requerido', true);
    if (form.rut && !isValidRut(form.rut)) return showMsg('RUT inválido', true);
    const res = await send('/transporte/clientes', 'POST', form);
    const d = await res.json();
    if (res.ok) { showMsg('Cliente creado'); setForm({ nombre: '', rut: '', contacto: '' }); reload(); } else showMsg(d.error || 'Error', true);
  };
  const del = async (id) => { const res = await send(`/transporte/clientes/${id}`, 'DELETE'); if (res.ok) { showMsg('Desactivado'); reload(); } };
  const addDest = async (cid) => {
    const dd = dest[cid] || {};
    if (!dd.nombre) return showMsg('Nombre del destino requerido', true);
    const res = await send(`/transporte/clientes/${cid}/destinos`, 'POST', dd);
    if (res.ok) { showMsg('Destino agregado'); setDest({ ...dest, [cid]: {} }); reload(); }
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
      {canWrite && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-start">
          <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Nombre *" className={inputCls} />
          <RutInput value={form.rut} onChange={e => setForm({ ...form, rut: e.target.value })} />
          <input value={form.contacto} onChange={e => setForm({ ...form, contacto: e.target.value })} placeholder="Contacto" className={inputCls} />
          <button onClick={add} className="bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg px-3 py-2 text-[10px] font-black uppercase flex items-center justify-center gap-1"><Plus size={13} /> Agregar</button>
        </div>
      )}
      <div className="space-y-3">
        {items.length === 0 && <p className="text-center text-slate-400 py-6 font-bold text-xs">Sin clientes de transporte.</p>}
        {items.map(c => (
          <div key={c.id} className="border border-slate-200 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <div className="font-black text-sm text-slate-700 flex items-center gap-2"><Users size={14} className="text-amber-500" /> {c.nombre} <span className="text-[10px] font-mono text-slate-400">{c.rut ? formatRut(c.rut) : ''}</span></div>
              {canWrite && <button onClick={() => del(c.id)} className="text-rose-500 hover:text-rose-700"><Trash2 size={14} /></button>}
            </div>
            <div className="mt-2 pl-5 space-y-1">
              {(c.destinos || []).map(d => <div key={d.id} className="text-[10px] text-slate-500 flex items-center gap-1"><MapPin size={11} className="text-slate-400" /> <b>{d.nombre}</b> — {d.direccion || 's/dirección'}</div>)}
              {canWrite && (
                <div className="flex gap-1.5 items-center mt-1">
                  <input value={dest[c.id]?.nombre || ''} onChange={e => setDest({ ...dest, [c.id]: { ...dest[c.id], nombre: e.target.value } })} placeholder="Destino" className="border border-slate-200 rounded px-2 py-1 text-[10px] font-bold outline-none focus:border-cyan-500" />
                  <input value={dest[c.id]?.direccion || ''} onChange={e => setDest({ ...dest, [c.id]: { ...dest[c.id], direccion: e.target.value } })} placeholder="Dirección" className="border border-slate-200 rounded px-2 py-1 text-[10px] font-bold outline-none focus:border-cyan-500 flex-1" />
                  <button onClick={() => addDest(c.id)} className="text-cyan-600 hover:text-cyan-800"><Plus size={14} /></button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TiposVehiculo({ showMsg, canWrite }) {
  const [items, reload] = useList('/transporte/tipos-vehiculo');
  const [nombre, setNombre] = useState('');
  const add = async () => { if (!nombre.trim()) return; const res = await send('/transporte/tipos-vehiculo', 'POST', { nombre }); if (res.ok) { setNombre(''); reload(); showMsg('Tipo agregado'); } };
  const del = async (id) => { const res = await send(`/transporte/tipos-vehiculo/${id}`, 'DELETE'); if (res.ok) { reload(); } };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
      {canWrite && (
        <div className="flex gap-2">
          <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nuevo tipo de vehículo" className={`${inputCls} flex-1`} />
          <button onClick={add} className="bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg px-3 py-2 text-[10px] font-black uppercase flex items-center gap-1"><Plus size={13} /> Agregar</button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {items.map(t => (
          <span key={t.id} className="px-3 py-1.5 bg-slate-100 rounded-lg text-[11px] font-bold text-slate-600 flex items-center gap-2">
            {t.nombre}{canWrite && <button onClick={() => del(t.id)} className="text-rose-400 hover:text-rose-600"><Trash2 size={12} /></button>}
          </span>
        ))}
      </div>
    </div>
  );
}

function Tabla({ cols, rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-[9px] text-slate-400 uppercase"><tr>{cols.map((c, i) => <th key={i} className="text-left px-3 py-2">{c}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 && <tr><td colSpan={cols.length} className="text-center text-slate-400 py-6 font-bold">Sin registros.</td></tr>}
          {rows.map((r, i) => <tr key={i} className="hover:bg-slate-50">{r.map((c, j) => <td key={j} className="px-3 py-2 text-slate-700">{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SOLICITUDES
// ═══════════════════════════════════════════════════════════════════════════
function SolicitudesView({ showMsg, canWrite }) {
  const [items, setItems] = useState([]);
  const [clientes] = useList('/transporte/clientes');
  const [tipos] = useList('/transporte/tipos-vehiculo');
  const empty = { cliente_transporte_id: '', origen_texto: '', destino: '', sentido: 'SALIDA', tipo_operacion: 'DIRECTA', peso_total: '', volumen_total: '', n_cajas: '', n_cajones: '', n_pallets: '', tipo_vehiculo_sugerido: '', fecha_hora_recepcion_destino: '' };
  const [form, setForm] = useState(empty);
  const [asignar, setAsignar] = useState(null);
  const reload = useCallback(() => { api('/transporte/solicitudes').then(r => r.json()).then(d => setItems(Array.isArray(d) ? d : [])).catch(() => {}); }, []);
  useEffect(() => { reload(); }, [reload]);

  const add = async () => {
    if (!form.cliente_transporte_id && !form.origen_texto && !form.destino) return showMsg('Indique cliente, origen o destino', true);
    const res = await send('/transporte/solicitudes', 'POST', form);
    const d = await res.json();
    if (res.ok) { showMsg('Solicitud creada'); setForm(empty); reload(); } else showMsg(d.error || 'Error', true);
  };
  const anular = async (id) => { const res = await send(`/transporte/solicitudes/${id}`, 'PATCH', { estado: 'anulada' }); if (res.ok) { showMsg('Anulada'); reload(); } else { const d = await res.json(); showMsg(d.error || 'Error', true); } };

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-5 space-y-3">
          <div className="text-xs font-black text-amber-700 uppercase tracking-wider flex items-center gap-2"><Plus size={14} /> Nueva solicitud (solo transporte)</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <select value={form.cliente_transporte_id} onChange={e => setForm({ ...form, cliente_transporte_id: e.target.value })} className={`${inputCls} bg-white`}><option value="">Cliente transporte</option>{clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
            <input value={form.origen_texto} onChange={e => setForm({ ...form, origen_texto: e.target.value })} placeholder="Origen (texto)" className={inputCls} />
            <input value={form.destino} onChange={e => setForm({ ...form, destino: e.target.value })} placeholder="Destino" className={inputCls} />
            <select value={form.sentido} onChange={e => setForm({ ...form, sentido: e.target.value })} className={`${inputCls} bg-white`}><option value="SALIDA">Salida</option><option value="REGRESO">Regreso</option></select>
            <select value={form.tipo_operacion} onChange={e => setForm({ ...form, tipo_operacion: e.target.value })} className={`${inputCls} bg-white`}><option value="DIRECTA">Directa</option><option value="TRANSITO">Tránsito</option><option value="TRASVASIJE">Trasvasije</option></select>
            <input type="number" value={form.peso_total} onChange={e => setForm({ ...form, peso_total: e.target.value })} placeholder="Peso total (kg)" className={inputCls} />
            <input type="number" step="0.01" value={form.volumen_total} onChange={e => setForm({ ...form, volumen_total: e.target.value })} placeholder="Volumen (m³)" className={inputCls} />
            <select value={form.tipo_vehiculo_sugerido} onChange={e => setForm({ ...form, tipo_vehiculo_sugerido: e.target.value })} className={`${inputCls} bg-white`}><option value="">Tipo sugerido</option>{tipos.map(t => <option key={t.id} value={t.nombre}>{t.nombre}</option>)}</select>
            <input type="number" value={form.n_cajas} onChange={e => setForm({ ...form, n_cajas: e.target.value })} placeholder="N° cajas" className={inputCls} />
            <input type="number" value={form.n_cajones} onChange={e => setForm({ ...form, n_cajones: e.target.value })} placeholder="N° cajones" className={inputCls} />
            <input type="number" value={form.n_pallets} onChange={e => setForm({ ...form, n_pallets: e.target.value })} placeholder="N° pallets" className={inputCls} />
            <input type="datetime-local" value={form.fecha_hora_recepcion_destino} onChange={e => setForm({ ...form, fecha_hora_recepcion_destino: e.target.value })} className={inputCls} />
          </div>
          <button onClick={add} className="bg-amber-500 hover:bg-amber-600 text-white rounded-lg px-4 py-2 text-[10px] font-black uppercase">Crear solicitud</button>
          <p className="text-[10px] text-slate-400">Las solicitudes desde despacho (Origen A) las crea el ejecutivo de cuenta al preparar el despacho.</p>
        </div>
      )}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b bg-slate-50 text-xs font-black text-slate-600 uppercase tracking-wider flex items-center justify-between">
          Todas las solicitudes ({items.length})
          <button onClick={reload} className="text-cyan-600 hover:text-cyan-800"><RefreshCcw size={13} /></button>
        </div>
        <Tabla cols={['Origen', 'Cliente / Despacho', 'Peso / Vol.', 'Destino', 'Estado', '']} rows={items.map(s => [
          badgeOrigen(s.origen),
          (s.cliente_nombre || s.cliente_transporte_nombre || s.origen_texto || '—') + (s.despacho_doc_num ? ` · ${s.despacho_doc_num}` : ''),
          `${num(s.peso_total).toLocaleString('es-CL')}kg / ${num(s.volumen_total).toLocaleString('es-CL')}m³${s.dims_incompletas ? ' ⚠' : ''}`,
          s.destino || '—',
          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${s.estado === 'pendiente' ? 'bg-amber-100 text-amber-700' : s.estado === 'asignada' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>{s.estado}</span>,
          (canWrite && s.estado === 'pendiente') ? (
            <div className="flex gap-2">
              <button onClick={() => setAsignar(s)} className="bg-cyan-600 hover:bg-cyan-700 text-white px-2 py-1 rounded text-[9px] font-black uppercase">Asignar</button>
              <button onClick={() => anular(s.id)} className="text-rose-500 hover:text-rose-700 text-[10px] font-black uppercase">Anular</button>
            </div>
          ) : null,
        ])} />
      </div>
      {asignar && <AsignarModal solicitud={asignar} showMsg={showMsg} onClose={() => setAsignar(null)} onDone={() => { setAsignar(null); reload(); }} />}
    </div>
  );
}

// ── Modal de asignación ───────────────────────────────────────────────────────
function AsignarModal({ solicitud, showMsg, onClose, onDone }) {
  const [transportistas] = useList('/transporte/transportistas');
  const [veh, setVeh] = useState([]);
  const [cho, setCho] = useState([]);
  const [pio, setPio] = useState([]);
  const [form, setForm] = useState({ transportista_id: '', vehiculo_id: '', chofer_id: '', pioneta_ids: [], fecha_hora_confirmada: '' });
  const [avisos, setAvisos] = useState(null);
  const [busy, setBusy] = useState(false);

  // Al elegir transportista, cargar su flota.
  useEffect(() => {
    const t = form.transportista_id;
    if (!t) { setVeh([]); setCho([]); setPio([]); return; }
    api(`/transporte/vehiculos?transportista_id=${t}`).then(r => r.json()).then(d => setVeh(Array.isArray(d) ? d : []));
    api(`/transporte/choferes?transportista_id=${t}`).then(r => r.json()).then(d => setCho(Array.isArray(d) ? d : []));
    api(`/transporte/pionetas?transportista_id=${t}`).then(r => r.json()).then(d => setPio(Array.isArray(d) ? d : []));
  }, [form.transportista_id]);

  const togglePioneta = (id) => setForm(f => ({ ...f, pioneta_ids: f.pioneta_ids.includes(id) ? f.pioneta_ids.filter(x => x !== id) : [...f.pioneta_ids, id] }));

  const submit = async (confirmar) => {
    if (!form.transportista_id || !form.vehiculo_id || !form.chofer_id) return showMsg('Transportista, vehículo y chofer son requeridos', true);
    setBusy(true);
    try {
      const res = await send(`/transporte/solicitudes/${solicitud.id}/asignar`, 'POST', { ...form, confirmar });
      const d = await res.json();
      if (!res.ok) { showMsg(d.error || 'Error', true); return; }
      if (d.requiere_confirmacion) { setAvisos(d.avisos); return; }
      showMsg('Envío creado: ' + d.envio_id); onDone();
    } catch (e) { showMsg('Error de red', true); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Asignar solicitud ${solicitud.id}`} onClose={onClose}>
      <div className="text-[11px] text-slate-500 bg-slate-50 rounded-lg p-2">
        Carga: <b>{num(solicitud.peso_total).toLocaleString('es-CL')} kg</b> · <b>{num(solicitud.volumen_total).toLocaleString('es-CL')} m³</b>
        {solicitud.dims_incompletas && <span className="text-rose-600 font-bold"> (volumen incompleto)</span>} · Destino: {solicitud.destino || '—'}
      </div>
      <select value={form.transportista_id} onChange={e => setForm({ ...form, transportista_id: e.target.value, vehiculo_id: '', chofer_id: '', pioneta_ids: [] })} className={`${inputCls} w-full bg-white`}>
        <option value="">Transportista *</option>{transportistas.map(t => <option key={t.id} value={t.id}>{t.nombre_razon_social} ({t.tipo})</option>)}
      </select>
      <select value={form.vehiculo_id} onChange={e => setForm({ ...form, vehiculo_id: e.target.value })} className={`${inputCls} w-full bg-white`} disabled={!form.transportista_id}>
        <option value="">Vehículo *</option>{veh.map(v => <option key={v.id} value={v.id}>{v.matricula} · {v.tipo_vehiculo || '—'} · {num(v.capacidad_carga_kg).toLocaleString('es-CL')}kg / {num(v.volumen_util).toLocaleString('es-CL')}m³</option>)}
      </select>
      <select value={form.chofer_id} onChange={e => setForm({ ...form, chofer_id: e.target.value })} className={`${inputCls} w-full bg-white`} disabled={!form.transportista_id}>
        <option value="">Chofer *</option>{cho.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </select>
      {form.transportista_id && (
        <div>
          <div className="text-[9px] font-black text-slate-400 uppercase mb-1">Pionetas (opcional, varias)</div>
          <div className="flex flex-wrap gap-1.5">
            {pio.length === 0 && <span className="text-[10px] text-slate-400">Sin pionetas para este transportista</span>}
            {pio.map(p => (
              <button key={p.id} onClick={() => togglePioneta(p.id)} className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${form.pioneta_ids.includes(p.id) ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-600 border-slate-200'}`}>{p.nombre}</button>
            ))}
          </div>
        </div>
      )}
      <div>
        <label className="text-[9px] font-black text-slate-400 uppercase">Fecha/hora confirmada</label>
        <input type="datetime-local" value={form.fecha_hora_confirmada} onChange={e => setForm({ ...form, fecha_hora_confirmada: e.target.value })} className={`${inputCls} w-full`} />
      </div>
      {avisos && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-amber-700 font-black text-[11px] uppercase mb-1"><AlertTriangle size={14} /> Aviso de capacidad</div>
          <ul className="list-disc pl-5 text-[11px] text-amber-800">{avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
          <div className="flex gap-2 mt-2">
            <button onClick={() => submit(true)} disabled={busy} className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded text-[10px] font-black uppercase">Asignar de todos modos</button>
            <button onClick={onClose} className="text-slate-500 text-[10px] font-black uppercase px-3 py-1.5">Cancelar</button>
          </div>
        </div>
      )}
      {!avisos && (
        <button onClick={() => submit(false)} disabled={busy} className="bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg px-4 py-2 text-[11px] font-black uppercase w-full">Crear envío</button>
      )}
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ENVÍOS (asignados) + reasignación
// ═══════════════════════════════════════════════════════════════════════════
const estadoEnvioBadge = (e) => {
  const m = { asignado: 'bg-blue-100 text-blue-700', en_ruta: 'bg-violet-100 text-violet-700', entregado: 'bg-emerald-100 text-emerald-700', anulado: 'bg-slate-200 text-slate-500' };
  return <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${m[e] || 'bg-slate-100'}`}>{e}</span>;
};

function EnviosView({ showMsg, canWrite }) {
  const [items, setItems] = useState([]);
  const [detalle, setDetalle] = useState(null);
  const [reasignar, setReasignar] = useState(null);
  const reload = useCallback(() => { api('/transporte/envios').then(r => r.json()).then(d => setItems(Array.isArray(d) ? d : [])).catch(() => {}); }, []);
  useEffect(() => { reload(); }, [reload]);
  const openDetalle = (id) => setDetalle(id);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b bg-slate-50 text-xs font-black text-slate-600 uppercase tracking-wider flex items-center justify-between">
          Envíos ({items.length})<button onClick={reload} className="text-cyan-600 hover:text-cyan-800"><RefreshCcw size={13} /></button>
        </div>
        <Tabla cols={['Envío', 'Transportista', 'Vehículo', 'Chofer', 'Paradas', 'Estado', '']} rows={items.map(e => [
          <button onClick={() => openDetalle(e.id)} className="font-mono text-cyan-700 hover:underline">{e.id}</button>,
          e.transportista_nombre || '—', e.matricula || '—', e.chofer_nombre || '—', e.n_paradas,
          estadoEnvioBadge(e.estado),
          (canWrite && !['entregado', 'anulado'].includes(e.estado)) ? <button onClick={() => setReasignar(e)} className="text-amber-600 hover:text-amber-800 text-[10px] font-black uppercase flex items-center gap-1"><ArrowRightLeft size={12} /> Reasignar</button> : null,
        ])} />
      </div>

      {detalle && <EnvioDetalle id={detalle} showMsg={showMsg} canWrite={canWrite} onClose={() => setDetalle(null)} onChanged={reload} />}

      {reasignar && <ReasignarModal envio={reasignar} showMsg={showMsg} onClose={() => setReasignar(null)} onDone={() => { setReasignar(null); reload(); }} />}
    </div>
  );
}

function ReasignarModal({ envio, showMsg, onClose, onDone }) {
  const [veh] = useList(`/transporte/vehiculos?transportista_id=${envio.transportista_id}`);
  const [cho] = useList(`/transporte/choferes?transportista_id=${envio.transportista_id}`);
  const [form, setForm] = useState({ tipo: 'SIMPLE', motivo: '', vehiculo_nuevo: '', chofer_nuevo: '', desde: '', hasta: '' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!form.motivo.trim()) return showMsg('El motivo es obligatorio', true);
    if (!form.vehiculo_nuevo && !form.chofer_nuevo) return showMsg('Indique vehículo y/o chofer nuevo', true);
    setBusy(true);
    try {
      const res = await send(`/transporte/envios/${envio.id}/reasignar`, 'POST', form);
      const d = await res.json();
      if (res.ok) { showMsg('Reasignación registrada'); onDone(); } else showMsg(d.error || 'Error', true);
    } catch (e) { showMsg('Error de red', true); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Reasignar envío ${envio.id}`} onClose={onClose}>
      <div className="flex gap-2">
        {['SIMPLE', 'TRASVASIJE'].map(t => (
          <button key={t} onClick={() => setForm({ ...form, tipo: t })} className={`flex-1 px-3 py-2 rounded-lg text-[10px] font-black uppercase border ${form.tipo === t ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-600 border-slate-200'}`}>{t}</button>
        ))}
      </div>
      <p className="text-[10px] text-slate-400">{form.tipo === 'SIMPLE' ? 'Cambia vehículo/chofer para el resto del viaje.' : 'La carga pasa a otro camión en un punto intermedio (crea un tramo nuevo).'}</p>
      <select value={form.vehiculo_nuevo} onChange={e => setForm({ ...form, vehiculo_nuevo: e.target.value })} className={`${inputCls} w-full bg-white`}>
        <option value="">Vehículo nuevo</option>{veh.map(v => <option key={v.id} value={v.id}>{v.matricula} · {v.tipo_vehiculo || '—'}</option>)}
      </select>
      <select value={form.chofer_nuevo} onChange={e => setForm({ ...form, chofer_nuevo: e.target.value })} className={`${inputCls} w-full bg-white`}>
        <option value="">Chofer nuevo</option>{cho.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </select>
      {form.tipo === 'TRASVASIJE' && (
        <div className="grid grid-cols-2 gap-2">
          <input value={form.desde} onChange={e => setForm({ ...form, desde: e.target.value })} placeholder="Desde (punto)" className={inputCls} />
          <input value={form.hasta} onChange={e => setForm({ ...form, hasta: e.target.value })} placeholder="Hasta (punto)" className={inputCls} />
        </div>
      )}
      <textarea value={form.motivo} onChange={e => setForm({ ...form, motivo: e.target.value })} placeholder="Motivo (obligatorio) *" rows={2} className={`${inputCls} w-full`} />
      <button onClick={submit} disabled={busy} className="bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg px-4 py-2 text-[11px] font-black uppercase w-full">Registrar reasignación</button>
    </Modal>
  );
}

// ── Detalle interactivo del envío: estados, consolidación, ruta y POD (Fase 6) ──
function EnvioDetalle({ id, showMsg, canWrite, onClose, onChanged }) {
  const { confirm } = useConfirm();
  const [d, setD] = useState(null);
  const [pendientes, setPendientes] = useState([]);
  const [cons, setCons] = useState({ solicitud_transporte_id: '', destino: '', carga_desc: '' });
  const [pod, setPod] = useState({});

  const load = useCallback(async () => {
    const r = await api(`/transporte/envios/${id}`); const j = await r.json();
    if (r.ok) setD(j); else showMsg(j.error || 'Error', true);
  }, [id, showMsg]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api('/transporte/solicitudes?estado=pendiente').then(r => r.json()).then(x => setPendientes(Array.isArray(x) ? x : [])).catch(() => {}); }, []);

  const refresh = () => { load(); onChanged?.(); };

  const setEstado = async (estado) => {
    const res = await send(`/transporte/envios/${id}/estado`, 'PATCH', { estado });
    const j = await res.json();
    if (res.ok) { showMsg(`Envío → ${estado}`); refresh(); } else showMsg(j.error || 'Error', true);
  };
  const consolidar = async (confirmar) => {
    if (!cons.solicitud_transporte_id && !cons.destino && !cons.carga_desc) return showMsg('Elija una solicitud o ingrese carga suelta', true);
    const res = await send(`/transporte/envios/${id}/paradas`, 'POST', { ...cons, confirmar });
    const j = await res.json();
    if (!res.ok) return showMsg(j.error || 'Error', true);
    if (j.requiere_confirmacion) { if (await confirm({ title: 'Aviso de capacidad', message: j.avisos.join('\n') + '\n\n¿Consolidar de todos modos?' })) return consolidar(true); return; }
    showMsg('Parada agregada'); setCons({ solicitud_transporte_id: '', destino: '', carga_desc: '' }); refresh();
  };
  const mover = async (idx, dir) => {
    const ps = [...d.paradas]; const j = idx + dir;
    if (j < 0 || j >= ps.length) return;
    [ps[idx], ps[j]] = [ps[j], ps[idx]];
    const res = await send(`/transporte/envios/${id}/paradas/reordenar`, 'PATCH', { orden: ps.map(p => p.id) });
    if (res.ok) refresh();
  };
  const registrarPod = async (paradaId) => {
    const p = pod[paradaId] || {};
    if (!p.pod_receptor?.trim()) return showMsg('Receptor obligatorio', true);
    const res = await send(`/transporte/envios/${id}/paradas/${paradaId}/pod`, 'POST', p);
    const j = await res.json();
    if (res.ok) { showMsg('POD registrado'); setPod({ ...pod, [paradaId]: {} }); refresh(); } else showMsg(j.error || 'Error', true);
  };

  if (!d) return <Modal title="Envío" onClose={onClose}><p className="text-xs text-slate-400">Cargando…</p></Modal>;
  const activo = !['entregado', 'anulado'].includes(d.estado);
  const minPend = Math.min(...d.paradas.filter(p => p.estado !== 'entregada').map(p => p.orden), Infinity);

  return (
    <Modal title={`Envío ${d.id}`} onClose={onClose}>
      <div className="flex items-center gap-2 flex-wrap">
        {estadoEnvioBadge(d.estado)}
        {canWrite && d.estado === 'asignado' && <button onClick={() => setEstado('en_ruta')} className="bg-violet-600 text-white px-3 py-1 rounded text-[10px] font-black uppercase">Marcar en ruta</button>}
        {canWrite && d.estado === 'en_ruta' && <button onClick={() => setEstado('entregado')} className="bg-emerald-600 text-white px-3 py-1 rounded text-[10px] font-black uppercase">Marcar entregado</button>}
        {canWrite && activo && <button onClick={async () => { if (await confirm({ title: 'Anular envío', message: '¿Anular el envío?', danger: true })) setEstado('anulado'); }} className="bg-rose-100 text-rose-700 px-3 py-1 rounded text-[10px] font-black uppercase">Anular</button>}
      </div>
      <div className="text-[11px] text-slate-600"><b>Transportista:</b> {d.transportista_nombre} · <b>Vehículo:</b> {d.matricula} · <b>Chofer:</b> {d.chofer_nombre}<br /><b>Pionetas:</b> {d.pionetas.map(p => p.nombre).join(', ') || '—'}</div>

      {/* Tramos */}
      <div>
        <div className="font-black text-slate-600 uppercase text-[10px] mb-1 flex items-center gap-1"><Route size={12} /> Tramos</div>
        {d.tramos.map(t => <div key={t.id} className="text-[11px] text-slate-600 pl-2">#{t.orden} · {t.matricula || '—'} · {t.chofer_nombre || '—'} {t.desde || t.hasta ? `(${t.desde || '?'} → ${t.hasta || '?'})` : ''} {t.motivo ? `— ${t.motivo}` : ''}</div>)}
      </div>

      {/* Paradas (ruta + POD) */}
      <div>
        <div className="font-black text-slate-600 uppercase text-[10px] mb-1 flex items-center gap-1"><MapPin size={12} /> Ruta / Paradas</div>
        <div className="space-y-1.5">
          {d.paradas.map((p, idx) => (
            <div key={p.id} className={`border rounded-lg p-2 ${p.estado === 'entregada' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200'}`}>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="font-black text-slate-700">#{p.orden}</span>
                <span className="flex-1">{p.destino || '—'} <span className="text-slate-400">· {p.carga_desc || ''}</span></span>
                <span className={`text-[9px] font-black uppercase ${p.estado === 'entregada' ? 'text-emerald-600' : 'text-amber-600'}`}>{p.estado}</span>
                {canWrite && activo && p.estado !== 'entregada' && (
                  <span className="flex gap-0.5">
                    <button onClick={() => mover(idx, -1)} className="text-slate-400 hover:text-slate-700 px-1">↑</button>
                    <button onClick={() => mover(idx, 1)} className="text-slate-400 hover:text-slate-700 px-1">↓</button>
                  </span>
                )}
              </div>
              {p.estado === 'entregada' && <div className="text-[10px] text-emerald-700 pl-4 mt-0.5">POD: {p.pod_receptor} · {p.pod_fecha_hora ? new Date(p.pod_fecha_hora).toLocaleString('es-CL') : ''} {p.pod_observaciones ? `· ${p.pod_observaciones}` : ''}</div>}
              {canWrite && d.estado === 'en_ruta' && p.estado !== 'entregada' && p.orden === minPend && (
                <div className="flex gap-1.5 mt-1.5 pl-4">
                  <input value={pod[p.id]?.pod_receptor || ''} onChange={e => setPod({ ...pod, [p.id]: { ...pod[p.id], pod_receptor: e.target.value } })} placeholder="Receptor *" className="border border-slate-200 rounded px-2 py-1 text-[10px] font-bold outline-none focus:border-cyan-500" />
                  <input value={pod[p.id]?.pod_observaciones || ''} onChange={e => setPod({ ...pod, [p.id]: { ...pod[p.id], pod_observaciones: e.target.value } })} placeholder="Observaciones" className="border border-slate-200 rounded px-2 py-1 text-[10px] font-bold outline-none focus:border-cyan-500 flex-1" />
                  <button onClick={() => registrarPod(p.id)} className="bg-emerald-600 text-white px-2 py-1 rounded text-[9px] font-black uppercase">POD</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Consolidación */}
      {canWrite && activo && (
        <div className="border-t pt-2">
          <div className="font-black text-slate-600 uppercase text-[10px] mb-1">Consolidar parada</div>
          <div className="grid grid-cols-2 gap-1.5">
            <select value={cons.solicitud_transporte_id} onChange={e => setCons({ ...cons, solicitud_transporte_id: e.target.value })} className={`${inputCls} bg-white col-span-2`}>
              <option value="">— Solicitud pendiente —</option>
              {pendientes.map(s => <option key={s.id} value={s.id}>{(s.cliente_nombre || s.cliente_transporte_nombre || s.origen_texto || s.id)} · {num(s.peso_total).toLocaleString('es-CL')}kg · {s.destino || ''}</option>)}
            </select>
            <input value={cons.destino} onChange={e => setCons({ ...cons, destino: e.target.value })} placeholder="o Destino (carga suelta)" className={inputCls} />
            <input value={cons.carga_desc} onChange={e => setCons({ ...cons, carga_desc: e.target.value })} placeholder="Descripción carga" className={inputCls} />
          </div>
          <button onClick={() => consolidar(false)} className="mt-1.5 bg-cyan-600 hover:bg-cyan-700 text-white px-3 py-1.5 rounded text-[10px] font-black uppercase flex items-center gap-1"><Plus size={12} /> Agregar parada</button>
        </div>
      )}

      {/* Historial */}
      {d.reasignaciones.length > 0 && (
        <div className="border-t pt-2">
          <div className="font-black text-slate-600 uppercase text-[10px] mb-1">Historial de reasignaciones</div>
          {d.reasignaciones.map(r => <div key={r.id} className="text-[10px] text-slate-600 pl-2">{r.tipo}: {r.vehiculo_anterior} → {r.vehiculo_nuevo} — {r.motivo} <span className="text-slate-400">({r.usuario})</span></div>)}
        </div>
      )}
    </Modal>
  );
}
