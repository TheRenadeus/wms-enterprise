// Tab "Registro de accesos" (login history) — lazy-loaded (COD-01 split).
// Componente de presentación: el estado vive en App.js y se recibe como props;
// loadAccessLog() se mueve entero aquí ya que solo lo usaba este módulo.

import React from 'react';
import { Key, RefreshCcw, Loader2, CheckCircle2, XCircle } from 'lucide-react';

export default function AccessLogTab({
  accessLogFilter, setAccessLogFilter,
  accessLogPage, setAccessLogPage,
  accessLogData, setAccessLogData,
  accessLogBusy, setAccessLogBusy,
  apiFetch, host, timeAgo,
}) {
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
}
