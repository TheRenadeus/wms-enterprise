// Tab "Historial LPN" — lazy-loaded (P15).
// State (lpnHistoryId, lpnHistoryData) viene de App.js para no perder la búsqueda
// cuando el usuario cambia de tab y vuelve.

import React, { useState } from 'react';
import { Search, Package, ArrowDownRight, ArrowUpRight, RefreshCcw, Calendar, Download } from 'lucide-react';
import { statusLabel } from '../constants';
import { exportToExcel } from '../utils';

export default function LpnHistoryTab({
  lpnHistoryId, setLpnHistoryId,
  lpnHistoryData, setLpnHistoryData,
  apiFetch, host, getStatusBadge,
}) {
  const [searchSku, setSearchSku] = useState('');
  const [searchFrom, setSearchFrom] = useState('');
  const [searchTo, setSearchTo] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSearchById = async () => {
    if (!lpnHistoryId) return;
    setLoading(true);
    try {
      const res = await apiFetch(`${host}/api/lpn/history/${lpnHistoryId}`);
      const d = await res.json();
      setLpnHistoryData(d);
      setSearchResults(null);
    } finally { setLoading(false); }
  };

  const handleSearchByFilters = async () => {
    if (!searchSku && !searchFrom && !searchTo) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (searchSku) qs.set('sku', searchSku);
      if (searchFrom) qs.set('from', searchFrom);
      if (searchTo) qs.set('to', searchTo);
      const res = await apiFetch(`${host}/api/lpn/search?${qs.toString()}`);
      const d = await res.json();
      setSearchResults(d.lpns || []);
      setLpnHistoryData(null);
    } finally { setLoading(false); }
  };

  const loadDetail = async (lpnId) => {
    setLpnHistoryId(lpnId);
    setLoading(true);
    try {
      const res = await apiFetch(`${host}/api/lpn/history/${lpnId}`);
      const d = await res.json();
      setLpnHistoryData(d);
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-6 animate-in fade-in max-w-5xl mx-auto">
      <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Trazabilidad de bultos</h1>

      {/* Búsqueda por ID exacto */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-3">
        <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Por código de bulto</p>
        <div className="flex gap-3">
          <input
            type="text"
            value={lpnHistoryId}
            onChange={e => setLpnHistoryId(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') handleSearchById(); }}
            placeholder="Código exacto del bulto (ej: LPN-12345-678)"
            className="flex-1 border-2 border-indigo-200 rounded-xl px-4 py-3 text-sm font-black uppercase outline-none focus:border-indigo-500 bg-indigo-50"
          />
          <button onClick={handleSearchById} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl text-[10px] font-black uppercase shadow-lg flex items-center gap-2 disabled:opacity-50">
            <Search size={14}/> Buscar
          </button>
        </div>
      </div>

      {/* Búsqueda por SKU / fecha */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-3">
        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Por producto o rango de fechas</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            type="text"
            value={searchSku}
            onChange={e => setSearchSku(e.target.value.toUpperCase())}
            placeholder="Código de producto (parcial OK)"
            className="border-2 border-emerald-200 rounded-xl px-4 py-3 text-sm font-black uppercase outline-none focus:border-emerald-500 bg-emerald-50"
          />
          <div className="relative">
            <Calendar size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500"/>
            <input type="date" value={searchFrom} onChange={e=>setSearchFrom(e.target.value)} className="w-full border-2 border-emerald-200 rounded-xl pl-9 pr-3 py-3 text-xs font-bold outline-none focus:border-emerald-500 bg-white"/>
          </div>
          <div className="relative">
            <Calendar size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500"/>
            <input type="date" value={searchTo} onChange={e=>setSearchTo(e.target.value)} className="w-full border-2 border-emerald-200 rounded-xl pl-9 pr-3 py-3 text-xs font-bold outline-none focus:border-emerald-500 bg-white"/>
          </div>
          <button onClick={handleSearchByFilters} disabled={loading || (!searchSku && !searchFrom && !searchTo)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl text-[10px] font-black uppercase shadow-lg flex items-center justify-center gap-2 disabled:opacity-50">
            <Search size={14}/> Filtrar
          </button>
        </div>
      </div>

      {/* Resultados de búsqueda por filtros */}
      {searchResults && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 p-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-700 uppercase">{searchResults.length} LPN encontrados</h3>
            {searchResults.length > 0 && (
              <button
                onClick={() => exportToExcel(
                  searchResults,
                  [
                    { key: 'id',          header: 'LPN ID',      format: 'text'   },
                    { key: 'sku',         header: 'SKU',         format: 'text'   },
                    { key: 'qty',         header: 'Cantidad',    format: 'number' },
                    { key: 'status',      header: 'Estado',      format: 'text'   },
                    { key: 'location_id', header: 'Ubicación',   format: 'text'   },
                    { key: 'created_at',  header: 'Fecha',       format: 'date'   },
                  ],
                  `lpn-busqueda_${new Date().toISOString().slice(0,10)}`,
                  'LPNs'
                )}
                className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase flex items-center gap-1.5">
                <Download size={11}/> Excel
              </button>
            )}
          </div>
          {searchResults.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">Sin coincidencias para los filtros aplicados</div>
          ) : (
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
              {searchResults.map(l => (
                <button key={l.id} onClick={() => loadDetail(l.id)} className="w-full flex items-center justify-between p-4 hover:bg-indigo-50/40 text-left">
                  <div>
                    <p className="font-mono text-[10px] font-black text-indigo-700">{l.id}</p>
                    <p className="text-xs font-black text-slate-800 uppercase mt-0.5">{l.sku}</p>
                    <p className="text-[9px] text-slate-400">{new Date(l.created_at).toLocaleString('es-ES')} · {l.location_id || 'PISO'}</p>
                  </div>
                  <div className="text-right">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${getStatusBadge(l.status)}`}>{statusLabel(l.status || 'DISPONIBLE')}</span>
                    <p className="text-base font-black text-slate-800 mt-1">{l.qty}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detalle del LPN seleccionado */}
      {lpnHistoryData && (
        <div className="space-y-4">
          {lpnHistoryData.current ? (
            <div className="bg-white rounded-3xl border border-emerald-200 shadow-sm p-6">
              <h3 className="text-sm font-black text-emerald-700 uppercase mb-3 flex items-center gap-2">
                <Package size={16}/> Estado Actual del LPN
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div><p className="text-[9px] font-black text-slate-400 uppercase">SKU</p><p className="text-sm font-black text-slate-800">{lpnHistoryData.current.sku}</p></div>
                <div><p className="text-[9px] font-black text-slate-400 uppercase">Cantidad</p><p className="text-sm font-black text-slate-800">{lpnHistoryData.current.qty}</p></div>
                <div><p className="text-[9px] font-black text-slate-400 uppercase">Ubicación</p><p className="text-sm font-black text-slate-800">{lpnHistoryData.current.location_id || 'PISO-RECEPCION'}</p></div>
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase">Estado</p>
                  <span className={`px-2 py-1 rounded text-[10px] font-black uppercase border ${getStatusBadge(lpnHistoryData.current.status)}`}>
                    {statusLabel(lpnHistoryData.current.status || 'DISPONIBLE')}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center text-red-600 font-black text-sm uppercase">
              LPN no encontrado en inventario activo (puede haber sido consumido)
            </div>
          )}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-50 p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-700 uppercase">Línea de Tiempo — {lpnHistoryData.logs.length} eventos</h3>
              {lpnHistoryData.logs.length > 0 && (
                <button
                  onClick={() => exportToExcel(
                    lpnHistoryData.logs,
                    [
                      { key: 'created_at', header: 'Fecha',    format: 'date'   },
                      { key: 'type',       header: 'Tipo',     format: 'text'   },
                      { key: 'qty',        header: 'Cantidad', format: 'number' },
                      { key: 'glosa',      header: 'Glosa',    format: 'text'   },
                      { key: 'username',   header: 'Usuario',  format: 'text'   },
                    ],
                    `lpn-detalle_${lpnHistoryId}_${new Date().toISOString().slice(0,10)}`,
                    'Eventos LPN'
                  )}
                  className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase flex items-center gap-1.5">
                  <Download size={11}/> Excel
                </button>
              )}
            </div>
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto custom-scrollbar">
              {lpnHistoryData.logs.map(log => (
                <div key={log.id} className="flex items-start gap-4 p-4 hover:bg-slate-50">
                  <div className={`p-2 rounded-xl shrink-0 ${log.type === 'INBOUND' || log.type === 'ADJUST_IN' ? 'bg-emerald-100 text-emerald-600' : log.type === 'OUTBOUND' || log.type === 'ADJUST_OUT' ? 'bg-red-100 text-red-600' : 'bg-purple-100 text-purple-600'}`}>
                    {log.type === 'INBOUND' || log.type === 'ADJUST_IN' ? <ArrowDownRight size={14}/> : log.type === 'OUTBOUND' || log.type === 'ADJUST_OUT' ? <ArrowUpRight size={14}/> : <RefreshCcw size={14}/>}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start">
                      <p className="text-xs font-black text-slate-800 uppercase">{statusLabel(log.type)}</p>
                      <p className="text-[9px] font-bold text-slate-400">{new Date(log.created_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'medium' })}</p>
                    </div>
                    <p className="text-[10px] text-slate-600 mt-1">{log.glosa}</p>
                    <p className="text-[9px] text-indigo-600 font-bold mt-0.5">👤 {log.username || 'SYSTEM'} · Qty: {log.qty}</p>
                  </div>
                </div>
              ))}
              {lpnHistoryData.logs.length === 0 && (
                <div className="p-8 text-center text-slate-400 text-sm">No se encontraron eventos para este LPN</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
