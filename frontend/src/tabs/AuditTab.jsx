// Tab "Historial de Auditoría" (Kardex/Logs) — lazy-loaded (COD-01 split).
// Componente de presentación: el estado y los handlers viven en App.js y se
// reciben como props, igual que ClientsTab.

import React from 'react';
import { Download, X } from 'lucide-react';

const PAGE_SIZE = 100;

export default function AuditTab({
  filteredAudit, auditLogs, invSkuFilter,
  auditTypeFilter, setAuditTypeFilter,
  auditUserFilter, setAuditUserFilter,
  auditDateFrom, setAuditDateFrom,
  auditDateTo, setAuditDateTo,
  auditPage, setAuditPage,
}) {
  return (
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
  );
}
