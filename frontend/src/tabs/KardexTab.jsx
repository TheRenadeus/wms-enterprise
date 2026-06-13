// Tab "Kardex por SKU" — lazy-loaded.
// Línea de tiempo de movimientos de un SKU con saldo corriente,
// reconciliación contra stock físico actual.

import React, { useState, useMemo, useCallback } from 'react';
import {
  BookOpen, RefreshCcw, Search, Download,
  ArrowDownRight, ArrowUpRight, ArrowLeftRight, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { exportToExcel } from '../utils';

/* ── helpers ─────────────────────────────────────────────────────────── */
const fmtDT = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};
const fmtN = (n, decimals = 2) =>
  n === null || n === undefined ? '—'
  : Number(n).toLocaleString('es-CL', { maximumFractionDigits: decimals });

const TIPO_CFG = {
  INBOUND:    { label: 'Recepción',    icon: ArrowDownRight, cls: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  ADJUST_IN:  { label: 'Ajuste (+)',   icon: ArrowDownRight, cls: 'bg-teal-100    text-teal-700    border border-teal-200'    },
  OUTBOUND:   { label: 'Despacho',     icon: ArrowUpRight,   cls: 'bg-red-100     text-red-700     border border-red-200'     },
  ADJUST_OUT: { label: 'Ajuste (−)',   icon: ArrowUpRight,   cls: 'bg-orange-100  text-orange-700  border border-orange-200'  },
  RELOCATE:   { label: 'Reubicación',  icon: ArrowLeftRight, cls: 'bg-slate-100   text-slate-500   border border-slate-200'   },
};

const TipoBadge = ({ tipo }) => {
  const cfg = TIPO_CFG[tipo] || { label: tipo, icon: RefreshCcw, cls: 'bg-slate-100 text-slate-500 border border-slate-200' };
  const Ico = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase whitespace-nowrap ${cfg.cls}`}>
      <Ico size={9}/>{cfg.label}
    </span>
  );
};

/* ── componente principal ────────────────────────────────────────────── */
export default function KardexTab({ apiFetch, host, clients = [], skuList = [], currentUser }) {
  const [skuInput,    setSkuInput]    = useState('');
  const [skuSearch,   setSkuSearch]   = useState('');
  const [clientFilter,setClientFilter]= useState('');
  const [dateFrom,    setDateFrom]    = useState('');
  const [dateTo,      setDateTo]      = useState('');
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [showSug,     setShowSug]     = useState(false);

  // Sugerencias de SKU del catálogo en memoria
  const suggestions = useMemo(() => {
    const q = skuSearch.toLowerCase().trim();
    if (!q || q.length < 1) return [];
    return skuList
      .filter(s => s.sku?.toLowerCase().includes(q) || s.desc?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [skuSearch, skuList]);

  const selectSku = (s) => {
    setSkuInput(s.sku);
    setSkuSearch(s.sku);
    setShowSug(false);
  };

  const load = useCallback(async () => {
    const sku = skuInput.trim();
    if (!sku) return;
    setLoading(true); setData(null);
    const q = new URLSearchParams({ sku });
    if (clientFilter) q.set('client_id', clientFilter);
    if (dateFrom)     q.set('date_from', dateFrom);
    if (dateTo)       q.set('date_to',   dateTo);
    const r = await apiFetch(`${host}/api/reports/kardex?${q}`).catch(() => null);
    setLoading(false);
    if (r?.ok) setData(await r.json());
  }, [apiFetch, host, skuInput, clientFilter, dateFrom, dateTo]);

  const KARDEX_COLS = [
    { key: 'fecha',    header: 'Fecha',              format: 'date'   },
    { key: 'tipo',     header: 'Tipo',               format: 'text'   },
    { key: 'glosa',    header: 'Documento / Glosa',  format: 'text'   },
    { key: 'username', header: 'Usuario',             format: 'text'   },
    { key: 'entrada',  header: 'Entrada',             format: 'number' },
    { key: 'salida',   header: 'Salida',              format: 'number' },
    { key: 'saldo',    header: 'Saldo',               format: 'number' },
  ];

  const exportExcel = () => {
    if (!data?.movimientos?.length) return;
    const today = new Date().toISOString().slice(0, 10);
    // Fila de saldo inicial + movimientos + reconciliación al final
    const filaInicial = {
      fecha: null, tipo: 'SALDO INICIAL',
      glosa: dateFrom ? `Acumulado hasta ${dateFrom}` : 'Inicio del histórico',
      username: '', entrada: 0, salida: 0, saldo: data.saldo_inicial,
    };
    const filaRecon = {
      fecha: null, tipo: 'RECONCILIACIÓN',
      glosa: `Saldo calculado: ${data.saldo_final} | Stock actual: ${data.stock_actual} | Diferencia: ${data.diferencia}`,
      username: '', entrada: 0, salida: 0, saldo: data.diferencia,
    };
    const rows = [filaInicial, ...data.movimientos, filaRecon];
    const suffix = clientFilter ? `_${clientFilter}` : '';
    exportToExcel(rows, KARDEX_COLS, `kardex-${data.sku}${suffix}_${today}`, 'Kardex');
  };

  const difOk   = data && data.diferencia === 0;
  const difColor = difOk ? 'text-emerald-600' : 'text-amber-600';

  return (
    <div className="space-y-5 animate-in fade-in max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-3">
          <BookOpen className="w-7 h-7 text-violet-600"/>
          Kardex por SKU
        </h1>
        <div className="flex items-center gap-2">
          {data?.movimientos?.length > 0 && (
            <button onClick={exportExcel}
              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2">
              <Download size={12}/> Excel
            </button>
          )}
          <button onClick={load} disabled={loading || !skuInput.trim()}
            className="bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 shadow-sm">
            <RefreshCcw size={12} className={loading ? 'animate-spin' : ''}/>
            {loading ? 'Cargando…' : 'Generar'}
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">

          {/* Buscador SKU */}
          <div className="relative md:col-span-2">
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1 flex items-center gap-1">
              <Search size={9}/> SKU <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              placeholder="Código o descripción…"
              value={skuSearch}
              onChange={e => { setSkuSearch(e.target.value); setSkuInput(e.target.value); setShowSug(true); }}
              onBlur={() => setTimeout(() => setShowSug(false), 150)}
              onFocus={() => skuSearch && setShowSug(true)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
            {showSug && suggestions.length > 0 && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                {suggestions.map(s => (
                  <button key={s.sku}
                    onMouseDown={() => selectSku(s)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-violet-50 flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-slate-800">{s.sku}</span>
                    <span className="text-slate-400 truncate">{s.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Cliente */}
          {clients.length > 0 && (
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Cliente</label>
              <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400">
                <option value="">Todos</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
              </select>
            </div>
          )}

          {/* Rango fechas */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Desde</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400"/>
          </div>
        </div>

        {/* Segunda fila: Hasta */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
          <div className="md:col-start-4">
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Hasta</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400"/>
          </div>
        </div>
      </div>

      {/* Estado vacío */}
      {data === null && (
        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl p-14 text-center">
          <BookOpen className="w-10 h-10 mx-auto mb-3 text-slate-300"/>
          <p className="font-black uppercase tracking-widest text-xs text-slate-400">
            Selecciona un SKU y presiona Generar
          </p>
        </div>
      )}

      {/* Resultados */}
      {data && (
        <>
          {/* Header de resultado */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center gap-6">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase">SKU</p>
              <p className="font-mono font-black text-slate-800 text-lg">{data.sku}</p>
              {data.sku_desc && <p className="text-xs text-slate-500 mt-0.5">{data.sku_desc}</p>}
            </div>
            <div className="h-10 w-px bg-slate-200"/>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase">Saldo inicial</p>
              <p className="font-mono font-black text-slate-700 text-lg">{fmtN(data.saldo_inicial)}</p>
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase">Saldo final</p>
              <p className="font-mono font-black text-violet-700 text-lg">{fmtN(data.saldo_final)}</p>
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase">Movimientos</p>
              <p className="font-mono font-black text-slate-700 text-lg">
                {data.movimientos.length}{data.truncado && <span className="text-amber-500 text-xs ml-1">+</span>}
              </p>
            </div>
          </div>

          {data.truncado && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-xs text-amber-700 font-bold">
              ⚠ Se muestran solo los primeros 2.000 movimientos. Aplica un rango de fechas para ver períodos específicos.
            </div>
          )}

          {/* Tabla */}
          {data.movimientos.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center text-slate-400 font-bold text-sm">
              Sin movimientos para este SKU en el período seleccionado.
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {['Fecha', 'Tipo', 'Documento / Glosa', 'Usuario', 'Entrada', 'Salida', 'Saldo'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">

                    {/* Fila saldo inicial */}
                    <tr className="bg-slate-50">
                      <td className="px-4 py-3 text-xs text-slate-400 italic">—</td>
                      <td className="px-4 py-3">
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-slate-200 text-slate-600 whitespace-nowrap">
                          Saldo inicial
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 italic">
                        {dateFrom ? `Acumulado hasta ${new Date(dateFrom).toLocaleDateString('es-CL')}` : 'Inicio del histórico'}
                      </td>
                      <td className="px-4 py-3"/>
                      <td className="px-4 py-3"/>
                      <td className="px-4 py-3"/>
                      <td className="px-4 py-3 font-mono font-black text-slate-700 text-right whitespace-nowrap">
                        {fmtN(data.saldo_inicial)}
                      </td>
                    </tr>

                    {/* Movimientos */}
                    {data.movimientos.map((m, i) => (
                      <tr key={m.id ?? i}
                        className={`transition-colors ${m.es_reubicacion ? 'bg-slate-50/60' : 'hover:bg-slate-50'}`}>
                        <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtDT(m.fecha)}</td>
                        <td className="px-4 py-3 whitespace-nowrap"><TipoBadge tipo={m.tipo}/></td>
                        <td className="px-4 py-3 text-xs text-slate-600 max-w-[240px] truncate" title={m.glosa}>
                          {m.glosa || <span className="text-slate-300 italic">sin glosa</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{m.username || '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs font-bold text-emerald-600 text-right whitespace-nowrap">
                          {m.es_reubicacion ? <span className="text-slate-300">—</span>
                            : m.entrada > 0 ? `+${fmtN(m.entrada)}` : ''}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs font-bold text-red-500 text-right whitespace-nowrap">
                          {m.es_reubicacion ? <span className="text-slate-300">—</span>
                            : m.salida > 0 ? `−${fmtN(m.salida)}` : ''}
                        </td>
                        <td className="px-4 py-3 font-mono font-black text-slate-800 text-right whitespace-nowrap">
                          {m.es_reubicacion
                            ? <span className="text-slate-400 font-normal">{fmtN(m.saldo)}</span>
                            : fmtN(m.saldo)}
                        </td>
                      </tr>
                    ))}
                  </tbody>

                  {/* Pie: reconciliación */}
                  <tfoot className={`border-t-2 ${difOk ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                    <tr>
                      <td colSpan={6} className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          {difOk
                            ? <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0"/>
                            : <AlertTriangle size={14} className="text-amber-500 flex-shrink-0"/>}
                          <span className="text-xs font-black text-slate-600">Reconciliación —</span>
                          <span className="text-xs text-slate-500">
                            Saldo calculado: <strong className="text-violet-700">{fmtN(data.saldo_final)}</strong>
                          </span>
                          <span className="text-slate-300">·</span>
                          <span className="text-xs text-slate-500">
                            Stock actual: <strong className="text-slate-700">{fmtN(data.stock_actual)}</strong>
                          </span>
                          <span className="text-slate-300">·</span>
                          <span className={`text-xs font-black ${difColor}`}>
                            Diferencia: {data.diferencia > 0 ? '+' : ''}{fmtN(data.diferencia)}
                          </span>
                          {!difOk && (
                            <span className="text-[10px] text-amber-600 ml-1">
                              — El saldo según movimientos no cuadra con el stock actual
                              (puede haber cargas iniciales no registradas en audit_log).
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={`px-4 py-3 font-mono font-black text-right whitespace-nowrap ${difColor}`}>
                        {data.diferencia > 0 ? '+' : ''}{fmtN(data.diferencia)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
