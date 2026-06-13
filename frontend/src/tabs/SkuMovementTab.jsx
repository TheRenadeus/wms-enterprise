// Tab "Movimiento por SKU" — lazy-loaded.
// Muestra, por cliente+SKU, última recepción, último despacho,
// días sin movimiento y estado configurable.

import React, { useState, useCallback } from 'react';
import {
  Activity, RefreshCcw, Users, Download, Settings2,
  CheckCircle2, AlertTriangle, Clock, HelpCircle, Save
} from 'lucide-react';
import { exportToExcel } from '../utils';

const fmtDate = (iso) => {
  if (!iso) return <span className="text-slate-300 italic text-xs">nunca</span>;
  return new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const fmtDias = (n) => {
  if (n === null || n === undefined) return '—';
  return `${n}d`;
};

const ESTADO_CFG = {
  ACTIVO:    { label: 'Activo',     cls: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  LENTO:     { label: 'Lento',      cls: 'bg-amber-100   text-amber-700   border border-amber-200'   },
  ESTANCADO: { label: 'Estancado',  cls: 'bg-red-100     text-red-700     border border-red-200'     },
  SIN_DATOS: { label: 'Sin datos',  cls: 'bg-slate-100   text-slate-500   border border-slate-200'   },
};

const EstadoBadge = ({ estado }) => {
  const cfg = ESTADO_CFG[estado] || ESTADO_CFG.SIN_DATOS;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase whitespace-nowrap ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};

const RESUMEN_ICONS = {
  ACTIVO:    { icon: CheckCircle2, color: 'text-emerald-500' },
  LENTO:     { icon: Clock,        color: 'text-amber-500'   },
  ESTANCADO: { icon: AlertTriangle,color: 'text-red-500'     },
  SIN_DATOS: { icon: HelpCircle,   color: 'text-slate-400'   },
};

export default function SkuMovementTab({ apiFetch, host, clients = [], currentUser }) {
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [clientFilter, setClientFilter] = useState('');
  const [staleDays, setStaleDays] = useState('');
  const [threshold, setThreshold] = useState(90);
  const [savingCfg, setSavingCfg] = useState(false);
  const [cfgMsg, setCfgMsg]       = useState('');

  const isJefeOrAbove = ['ADMIN', 'SUPERADMIN', 'EJECUTIVO_CUENTA'].includes(currentUser?.role);

  const load = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams();
    if (clientFilter) q.set('client_id', clientFilter);
    if (staleDays)    q.set('stale_days', staleDays);
    const r = await apiFetch(`${host}/api/reports/sku-movement?${q}`).catch(() => null);
    setLoading(false);
    if (r?.ok) {
      const body = await r.json();
      setData(body.rows);
      setThreshold(body.threshold);
    } else {
      setData([]);
    }
  }, [apiFetch, host, clientFilter, staleDays]);

  const saveConfig = async () => {
    const days = parseInt(staleDays);
    if (!days || days < 1) { setCfgMsg('Ingresa un número válido primero.'); return; }
    setSavingCfg(true); setCfgMsg('');
    const r = await apiFetch(`${host}/api/reports/sku-movement/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stale_days: days }),
    }).catch(() => null);
    setSavingCfg(false);
    setCfgMsg(r?.ok ? `✅ Guardado: ${days} días como umbral por defecto.` : '⛔ Error al guardar.');
    setTimeout(() => setCfgMsg(''), 4000);
  };

  const SKU_MOV_COLS = [
    { key: 'client_id',           header: 'Cliente ID',          format: 'text'   },
    { key: 'client_name',         header: 'Cliente',             format: 'text'   },
    { key: 'sku',                 header: 'SKU',                 format: 'text'   },
    { key: 'sku_desc',            header: 'Descripción',         format: 'text'   },
    { key: 'stock_actual',        header: 'Stock',               format: 'number' },
    { key: 'last_inbound',        header: 'Última Recepción',    format: 'date'   },
    { key: 'dias_desde_recepcion',header: 'Días s/ Recepción',   format: 'number' },
    { key: 'last_outbound',       header: 'Último Despacho',     format: 'date'   },
    { key: 'dias_desde_despacho', header: 'Días s/ Despacho',    format: 'number' },
    { key: 'dias_sin_movimiento', header: 'Días sin Movimiento', format: 'number' },
    { key: 'estado',              header: 'Estado',              format: 'text'   },
    { key: 'umbral_dias',         header: 'Umbral (días)',        format: 'number' },
  ];

  const exportExcel = () => {
    const today = new Date().toISOString().slice(0, 10);
    const suffix = clientFilter ? `_${clientFilter}` : '';
    exportToExcel(data || [], SKU_MOV_COLS, `movimiento-sku${suffix}_${today}`, 'Movimiento por SKU');
  };

  // Resumen por estado
  const resumen = data ? Object.entries(
    data.reduce((acc, r) => { acc[r.estado] = (acc[r.estado] || 0) + 1; return acc; }, {})
  ) : [];

  return (
    <div className="space-y-5 animate-in fade-in max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-3">
          <Activity className="w-7 h-7 text-indigo-600"/>
          Movimiento por SKU
        </h1>
        <div className="flex items-center gap-2">
          {data?.length > 0 && (
            <button onClick={exportExcel}
              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2">
              <Download size={12}/> Excel
            </button>
          )}
          <button onClick={load} disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 shadow-sm">
            <RefreshCcw size={12} className={loading ? 'animate-spin' : ''}/>
            {loading ? 'Cargando…' : 'Generar'}
          </button>
        </div>
      </div>

      {/* Filtros y configuración */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

          {/* Selector cliente */}
          {clients.length > 0 && (
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1 flex items-center gap-1">
                <Users size={9}/> Cliente
              </label>
              <select value={clientFilter}
                onChange={e => setClientFilter(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400">
                <option value="">Todos los clientes</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
              </select>
            </div>
          )}

          {/* Umbral de días (siempre visible para el query) */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1 flex items-center gap-1">
              <Clock size={9}/> Días para marcar estancado
              {!isJefeOrAbove && <span className="text-slate-300 ml-1">(solo lectura)</span>}
            </label>
            <input
              type="number" min="1" max="3650"
              placeholder={`Actual: ${threshold}d`}
              value={staleDays}
              onChange={e => setStaleDays(e.target.value)}
              disabled={!isJefeOrAbove && !staleDays}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-50"
            />
          </div>

          {/* Botón guardar umbral — solo JEFE/ADMIN */}
          {isJefeOrAbove && (
            <div className="flex flex-col justify-end">
              <button onClick={saveConfig} disabled={savingCfg || !staleDays}
                className="flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-900 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-colors">
                <Save size={11}/> {savingCfg ? 'Guardando…' : 'Guardar como default'}
              </button>
              {cfgMsg && <p className="text-[10px] mt-1 text-slate-500">{cfgMsg}</p>}
            </div>
          )}
        </div>

        {data && (
          <p className="text-[10px] text-slate-400 font-bold">
            Umbral aplicado: <span className="text-indigo-600 font-black">{threshold} días</span>
            {' · '}LENTO ≥ {Math.floor(threshold / 2)}d · ESTANCADO ≥ {threshold}d
          </p>
        )}
      </div>

      {/* Tarjetas resumen */}
      {data && resumen.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {['ACTIVO', 'LENTO', 'ESTANCADO', 'SIN_DATOS'].map(estado => {
            const count = data.filter(r => r.estado === estado).length;
            const cfg   = ESTADO_CFG[estado];
            const { icon: Ico, color } = RESUMEN_ICONS[estado];
            return (
              <div key={estado} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                <Ico className={`w-8 h-8 ${color} flex-shrink-0`}/>
                <div>
                  <p className="text-2xl font-black text-slate-800">{count}</p>
                  <p className={`text-[10px] font-black uppercase ${color}`}>{cfg.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tabla */}
      {data === null ? (
        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl p-14 text-center">
          <Activity className="w-10 h-10 mx-auto mb-3 text-slate-300"/>
          <p className="font-black uppercase tracking-widest text-xs text-slate-400">
            Selecciona filtros y presiona Generar
          </p>
        </div>
      ) : data.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center text-slate-400 font-bold text-sm">
          Sin SKUs con stock para los filtros seleccionados.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <span className="text-[10px] font-black uppercase text-slate-500">
              {data.length} SKUs · umbral {threshold}d
            </span>
          </div>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {[
                    'Cliente', 'SKU', 'Descripción', 'Stock',
                    'Última recepción', 'Días s/ recep.',
                    'Último despacho', 'Días s/ desp.',
                    'Días sin mov.', 'Estado',
                  ].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                      <div className="font-bold text-slate-700">{row.client_name || row.client_id || '—'}</div>
                      <div className="text-slate-400 font-mono text-[10px]">{row.client_id}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-bold text-slate-800 whitespace-nowrap">{row.sku}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 max-w-[180px] truncate">{row.sku_desc || '—'}</td>
                    <td className="px-4 py-3 text-xs font-mono font-bold text-indigo-700 text-right whitespace-nowrap">
                      {Number(row.stock_actual).toLocaleString('es-CL')}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">{fmtDate(row.last_inbound)}</td>
                    <td className="px-4 py-3 text-xs font-mono text-slate-500 text-right">{fmtDias(row.dias_desde_recepcion)}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">{fmtDate(row.last_outbound)}</td>
                    <td className="px-4 py-3 text-xs font-mono text-slate-500 text-right">{fmtDias(row.dias_desde_despacho)}</td>
                    <td className="px-4 py-3 text-xs font-mono font-bold text-slate-700 text-right">
                      {row.dias_sin_movimiento !== null && row.dias_sin_movimiento !== undefined
                        ? `${row.dias_sin_movimiento}d`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <EstadoBadge estado={row.estado}/>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
