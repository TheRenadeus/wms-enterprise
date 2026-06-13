// Tab "Ocupación por Zona" — lazy-loaded (P15).
// Recibe state y handlers como props desde App.js. No mantiene state propio.

import React from 'react';
import { BarChart3, RefreshCcw } from 'lucide-react';

export default function OccupationTab({ occupationData, setOccupationData, apiFetch, host }) {
  return (
    <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Reporte de Ocupación por Zona</h1>
        <button
          onClick={async () => {
            const res = await apiFetch(`${host}/api/report/occupation`);
            const d = await res.json();
            setOccupationData(d);
          }}
          className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 shadow-sm"
        >
          <RefreshCcw size={12}/> Cargar Datos
        </button>
      </div>
      {occupationData.length === 0 ? (
        <div className="bg-slate-100 border-2 border-dashed border-slate-300 rounded-3xl p-16 text-center text-slate-400">
          <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50"/>
          <p className="font-black uppercase tracking-widest text-xs">Presiona Cargar Datos</p>
        </div>
      ) : occupationData.map(zone => (
        <div key={zone.zone} className="bg-white rounded-[40px] border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-lg font-black text-slate-800 uppercase">{zone.zone}</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase">
                {zone.occupied} de {zone.total} ubicaciones ocupadas · {zone.total > 0 ? ((zone.occupied/zone.total)*100).toFixed(1) : 0}% ocupación
              </p>
            </div>
            <div className="flex gap-4">
              <div className="text-center">
                <p className="text-2xl font-black text-indigo-600">{Number(zone.total_qty).toLocaleString()}</p>
                <p className="text-[9px] font-black text-slate-400 uppercase">Unidades</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-black text-slate-800">{zone.total_lpns}</p>
                <p className="text-[9px] font-black text-slate-400 uppercase">LPNs</p>
              </div>
            </div>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-3 mb-4">
            <div className="bg-indigo-500 h-3 rounded-full transition-all" style={{ width: `${zone.total > 0 ? (zone.occupied/zone.total)*100 : 0}%` }}></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-h-48 overflow-y-auto custom-scrollbar">
            {zone.locations.filter(l => parseInt(l.lpn_count) > 0).map(loc => (
              <div key={loc.location_id} className="bg-indigo-50 border border-indigo-100 rounded-xl p-3">
                <p className="text-[9px] font-mono font-black text-indigo-700">{loc.location_id}</p>
                <p className="text-sm font-black text-slate-800 mt-1">
                  {Number(loc.total_qty).toLocaleString()} <span className="text-[8px] text-slate-400">un</span>
                </p>
                <p className="text-[8px] text-slate-400">{loc.lpn_count} LPNs · {loc.sku_count} SKUs</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
