// Tab "Cambiar Estado Físico" — lazy-loaded (P15).
// filteredRelData se calcula en App.js (useMemo); aquí solo recibimos resultado.

import React, { useRef } from 'react';
import { Search, X, RefreshCcw, Scan, Building2 } from 'lucide-react';
import { statusLabel } from '../constants';

export default function ChangeStatusTab({
  relSearchTerm, setRelSearchTerm,
  filteredRelData,
  is3PLMode, opsClients = [], relClientFilter, setRelClientFilter,
  lpnStatuses, setLpnStatuses,
  glosas, setGlosas,
  statuses,
  getStatusBadge,
  handleChangeStatus,
}) {
  return (
    <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Cambiar estado de producto</h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-pink-50 border border-pink-200 rounded-xl px-3 py-2 shadow-sm">
            <Scan size={14} className="text-pink-600 mr-2"/>
            <input
              type="text"
              placeholder="Escanear código de bulto o producto..."
              onKeyDown={(e)=>{ if(e.key==='Enter'){ const v=e.currentTarget.value.trim(); if(v){ setRelSearchTerm(v); e.currentTarget.value=''; } } }}
              className="bg-transparent text-xs font-bold outline-none w-48 text-slate-700 uppercase"
            />
          </div>
          {is3PLMode && (
            <div className="flex items-center bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
              <Building2 size={14} className="text-indigo-400 mr-2"/>
              <select value={relClientFilter} onChange={(e)=>setRelClientFilter(e.target.value)} className="bg-transparent text-xs font-bold outline-none text-slate-700 max-w-[160px]">
                <option value="">Todos los clientes</option>
                {opsClients.map(c=><option key={c.id} value={c.id}>{c.id} · {c.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex items-center bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm w-72">
            <Search size={14} className="text-slate-400 mr-2" />
            <input
              type="text"
              placeholder="Buscar bulto, producto o ubicación..."
              value={relSearchTerm}
              onChange={(e) => setRelSearchTerm(e.target.value)}
              className="bg-transparent text-xs font-bold outline-none w-full text-slate-700"
            />
          </div>
          {relSearchTerm && (
            <button
              onClick={() => setRelSearchTerm('')}
              className="bg-red-50 text-red-500 border border-red-200 rounded-xl px-3 py-2 text-[9px] font-black uppercase flex items-center gap-1"
            >
              <X size={10}/> Limpiar
            </button>
          )}
          <span className="text-[10px] font-black text-slate-400 uppercase">{filteredRelData.length} registros</span>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="p-5 text-[10px] font-black text-slate-400 uppercase">LPN / SKU</th>
              <th className="p-5 text-[10px] font-black text-slate-400 uppercase">Ubicación y Estado Actual</th>
              <th className="p-5 text-[10px] font-black text-slate-400 uppercase text-center">Cantidad</th>
              <th className="p-5 text-[10px] font-black text-slate-400 uppercase">Nuevo Estado y Glosa</th>
              <th className="p-5 text-[10px] font-black text-slate-400 uppercase text-center">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRelData.map(i => (
              <tr key={i.id} className="hover:bg-slate-50">
                <td className="p-5">
                  <p className="font-mono text-[10px] font-black text-slate-500">{i.id}</p>
                  <p className="text-xs font-black text-slate-800 uppercase mt-1">{i.sku}</p>
                </td>
                <td className="p-5">
                  <span className="bg-slate-100 px-2 py-1 rounded border border-slate-200 font-mono text-xs font-bold text-slate-700 block w-max mb-1">
                    {i.location_id || 'PISO-RECEPCION'}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${getStatusBadge(i.status)}`}>
                    {statusLabel(i.status || 'DISPONIBLE')}
                  </span>
                </td>
                <td className="p-5 text-center font-black text-lg text-slate-800">{i.qty}</td>
                <td className="p-5">
                  <div className="flex flex-col gap-2">
                    <select
                      value={lpnStatuses[i.id] || ''}
                      onChange={e => setLpnStatuses({ ...lpnStatuses, [i.id]: e.target.value })}
                      className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-black outline-none focus:border-pink-500 uppercase bg-white"
                    >
                      <option value="">-- Seleccionar Estado --</option>
                      <option value="DISPONIBLE">DISPONIBLE</option>
                      {statuses.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
                    </select>
                    <input
                      type="text"
                      placeholder="Glosa (Opcional)..."
                      value={glosas[i.id] || ''}
                      onChange={e => setGlosas({ ...glosas, [i.id]: e.target.value })}
                      className="w-full border-2 border-slate-200 rounded-xl px-3 py-1.5 text-[10px] font-bold outline-none focus:border-pink-500"
                    />
                  </div>
                </td>
                <td className="p-5 text-center">
                  <button
                    disabled={!lpnStatuses[i.id] || lpnStatuses[i.id] === (i.status || 'DISPONIBLE')}
                    onClick={() => handleChangeStatus(i.id, i.status || 'DISPONIBLE')}
                    className="bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50 transition-colors shadow-md flex items-center justify-center mx-auto"
                  >
                    <RefreshCcw size={14} className="mr-1"/> Aplicar
                  </button>
                </td>
              </tr>
            ))}
            {filteredRelData.length === 0 && (
              <tr><td colSpan="5" className="p-8 text-center text-slate-500">No hay stock disponible.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
