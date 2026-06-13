// Tab "Análisis de Inventario" — lazy-loaded.
// Muestra ingresos por SKU y últimos movimientos por cliente.

import React, { useState, useEffect, useCallback } from 'react';
import { TrendingUp, RefreshCcw, Search, Filter, Package, ArrowDownRight, Users, Calendar, Download } from 'lucide-react';

const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
};

const fmtQty = (n) => {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('es-CL', { maximumFractionDigits: 2 });
};

const moduleBadge = (mod) => {
  const map = {
    receive: { label: 'Recepción', cls: 'bg-emerald-100 text-emerald-700' },
    dispatch: { label: 'Despacho', cls: 'bg-blue-100 text-blue-700' },
    adjust: { label: 'Ajuste', cls: 'bg-amber-100 text-amber-700' },
    returns: { label: 'Devolución', cls: 'bg-orange-100 text-orange-700' },
  };
  const m = map[mod] || { label: mod || '—', cls: 'bg-slate-100 text-slate-600' };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${m.cls}`}>{m.label}</span>;
};

export default function InventoryAnalysisTab({ apiFetch, host, clients = [], currentUser }) {
  const [view, setView] = useState('sku-entries');
  const [loading, setLoading] = useState(false);
  const [skuData, setSkuData] = useState(null);
  const [clientData, setClientData] = useState(null);
  const [filters, setFilters] = useState({ client_id: '', date_from: '', date_to: '', search: '', module: '' });

  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

  useEffect(() => {
    setFilters(f => ({ ...f, date_from: firstOfMonth, date_to: today }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams();
    if (filters.client_id) q.set('client_id', filters.client_id);
    if (filters.date_from) q.set('date_from', filters.date_from);
    if (filters.date_to)   q.set('date_to', filters.date_to);
    if (filters.search)    q.set('search', filters.search);
    if (filters.module)    q.set('module', filters.module);

    if (view === 'sku-entries') {
      const r = await apiFetch(`${host}/api/analytics/sku-entries?${q}`).catch(() => null);
      if (r?.ok) setSkuData(await r.json()); else setSkuData([]);
    } else {
      const r = await apiFetch(`${host}/api/analytics/client-movements?${q}`).catch(() => null);
      if (r?.ok) setClientData(await r.json()); else setClientData([]);
    }
    setLoading(false);
  }, [view, filters, apiFetch, host]);

  const exportCsv = () => {
    const data = view === 'sku-entries' ? skuData : clientData;
    if (!data?.length) return;
    const headers = Object.keys(data[0]);
    const rows = data.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','));
    const blob = new Blob([headers.join(',') + '\n' + rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `analisis-inventario-${view}-${today}.csv`;
    a.click();
  };

  const currentData = view === 'sku-entries' ? skuData : clientData;

  return (
    <div className="space-y-5 animate-in fade-in max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-3">
          <TrendingUp className="w-7 h-7 text-cyan-600"/>
          Análisis de Inventario
        </h1>
        <div className="flex items-center gap-2">
          {currentData?.length > 0 && (
            <button onClick={exportCsv} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2">
              <Download size={12}/> CSV
            </button>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 shadow-sm"
          >
            <RefreshCcw size={12} className={loading ? 'animate-spin' : ''}/>
            {loading ? 'Cargando…' : 'Generar'}
          </button>
        </div>
      </div>

      {/* Selector de vista */}
      <div className="flex gap-2">
        <button
          onClick={() => { setView('sku-entries'); setSkuData(null); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase border-2 transition-colors ${view === 'sku-entries' ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-600 border-slate-200 hover:border-cyan-300'}`}
        >
          <Package size={13}/> Ingresos por SKU
        </button>
        <button
          onClick={() => { setView('client-movements'); setClientData(null); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase border-2 transition-colors ${view === 'client-movements' ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-600 border-slate-200 hover:border-cyan-300'}`}
        >
          <Users size={13}/> Movimientos por Cliente
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <p className="text-[10px] font-black uppercase text-slate-400 mb-3 flex items-center gap-1"><Filter size={10}/> Filtros</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1 flex items-center gap-1"><Calendar size={9}/> Desde</label>
            <input type="date" value={filters.date_from}
              onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1 flex items-center gap-1"><Calendar size={9}/> Hasta</label>
            <input type="date" value={filters.date_to}
              onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400"
            />
          </div>
          {clients.length > 0 && (
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1 flex items-center gap-1"><Users size={9}/> Cliente</label>
              <select value={filters.client_id}
                onChange={e => setFilters(f => ({ ...f, client_id: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400"
              >
                <option value="">Todos</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
              </select>
            </div>
          )}
          {view === 'sku-entries' ? (
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1 flex items-center gap-1"><Search size={9}/> Buscar SKU</label>
              <input type="text" placeholder="SKU o descripción…" value={filters.search}
                onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400"
              />
            </div>
          ) : (
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Tipo</label>
              <select value={filters.module}
                onChange={e => setFilters(f => ({ ...f, module: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400"
              >
                <option value="">Todos</option>
                <option value="receive">Recepciones</option>
                <option value="dispatch">Despachos</option>
                <option value="adjust">Ajustes</option>
                <option value="returns">Devoluciones</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Resultados */}
      {currentData === null ? (
        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl p-14 text-center">
          <TrendingUp className="w-10 h-10 mx-auto mb-3 text-slate-300"/>
          <p className="font-black uppercase tracking-widest text-xs text-slate-400">Aplica filtros y presiona Generar</p>
        </div>
      ) : currentData.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center text-slate-400 font-bold text-sm">
          Sin datos para el período seleccionado.
        </div>
      ) : view === 'sku-entries' ? (
        <SkuEntriesTable data={currentData} />
      ) : (
        <ClientMovementsTable data={currentData} />
      )}
    </div>
  );
}

function SkuEntriesTable({ data }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <span className="text-[10px] font-black uppercase text-slate-500 flex items-center gap-2">
          <ArrowDownRight size={12} className="text-emerald-500"/> Ingresos por SKU — {data.length} registros
        </span>
      </div>
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {[
                'SKU', 'Descripción', 'Cliente', 'UOM',
                'LPNs', 'Qty Total', 'Lotes', 'Ubicaciones',
                'Primer Ingreso', 'Último Ingreso',
              ].map(h => (
                <th key={h} className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-slate-800 font-bold whitespace-nowrap">{row.sku}</td>
                <td className="px-4 py-3 text-xs text-slate-600 max-w-[200px] truncate">{row.descripcion || '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{row.client_id || '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{row.uom || '—'}</td>
                <td className="px-4 py-3 text-xs font-mono text-slate-700 text-right">{row.num_lpns}</td>
                <td className="px-4 py-3 text-xs font-mono font-bold text-emerald-700 text-right whitespace-nowrap">{fmtQty(row.qty_total)}</td>
                <td className="px-4 py-3 text-xs font-mono text-slate-500 text-right">{row.num_lotes}</td>
                <td className="px-4 py-3 text-xs font-mono text-slate-500 text-right">{row.num_ubicaciones}</td>
                <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{fmtDate(row.primer_ingreso)}</td>
                <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap font-medium">{fmtDate(row.ultimo_ingreso)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClientMovementsTable({ data }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <span className="text-[10px] font-black uppercase text-slate-500 flex items-center gap-2">
          <Users size={12} className="text-blue-500"/> Movimientos por Cliente — {data.length} registros
        </span>
      </div>
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['Cliente', 'Nombre', 'Tipo', 'Doc Num', 'Doc Tipo', 'Estado', 'Qty', 'Usuario', 'Fecha'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-slate-800 font-bold whitespace-nowrap">{row.client_id || '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-600 max-w-[160px] truncate">{row.cliente_nombre || '—'}</td>
                <td className="px-4 py-3">{moduleBadge(row.module)}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-700 whitespace-nowrap">{row.doc_num || '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{row.doc_tipo || row.doc_type || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${row.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    {row.status || '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs font-mono font-bold text-blue-700 text-right whitespace-nowrap">{fmtQty(row.total_qty)}</td>
                <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{row.username || '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap font-medium">{fmtDate(row.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
