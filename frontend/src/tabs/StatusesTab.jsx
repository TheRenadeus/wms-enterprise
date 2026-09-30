// Tab "Maestro de Estados" — lazy-loaded (COD-01 split).
// Componente de presentación: el estado del formulario y los handlers viven en
// App.js y se reciben como props, igual que ChangeStatusTab.

import React from 'react';
import { Activity, Plus, ShieldAlert, Trash2 } from 'lucide-react';

export default function StatusesTab({
  statuses,
  statusForm, setStatusForm,
  handleSaveStatus, handleDeleteStatus,
  getStatusBadge,
}) {
  return (
    <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
      <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row gap-8">
        <div className="flex-1 space-y-6 border-r border-slate-100 pr-8">
          <div>
            <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center"><Activity className="w-5 h-5 mr-2 text-indigo-500"/> Maestro de Estados</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Configurar colores y reglas de bloqueo</p>
          </div>
          <form onSubmit={handleSaveStatus} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">ID Estado (Ej: BASURA, RETENIDO) *</label><input type="text" value={statusForm.id} onChange={e=>setStatusForm({...statusForm, id: e.target.value.toUpperCase().replace(/\s/g, '_')})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 uppercase" placeholder="Ej: EN_REVISION"/></div>
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Descripción / Uso *</label><input type="text" value={statusForm.description} onChange={e=>setStatusForm({...statusForm, description: e.target.value})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder="Motivo de este estado"/></div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                <div className="space-y-1">
                   <label className="text-[10px] font-black text-slate-400 uppercase">Color Visual</label>
                   <select value={statusForm.color} onChange={e=>setStatusForm({...statusForm, color: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 bg-white">
                     <option value="slate">Gris (Defecto)</option>
                     <option value="emerald">Verde</option>
                     <option value="red">Rojo</option>
                     <option value="amber">Amarillo / Naranja</option>
                     <option value="blue">Azul</option>
                     <option value="purple">Morado</option>
                     <option value="pink">Rosa</option>
                   </select>
                </div>
                <div className="space-y-1 flex flex-col justify-center">
                   <label className="flex items-center gap-2 cursor-pointer mt-4">
                     <input type="checkbox" checked={statusForm.blocks_outbound} onChange={e=>setStatusForm({...statusForm, blocks_outbound: e.target.checked})} className="w-5 h-5 accent-indigo-600 rounded" />
                     <span className="text-xs font-black text-slate-700 uppercase">Bloquea Despacho</span>
                   </label>
                   <p className="text-[9px] text-slate-400 mt-1 leading-tight">Si se marca, el LPN no aparecerá en el módulo de Despachos.</p>
                </div>
              </div>

            </div>
            <button type="submit" className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-200 uppercase text-xs tracking-widest hover:bg-indigo-700 transition-colors mt-4 flex justify-center items-center"><Plus size={16} className="mr-2"/> Guardar Estado</button>
          </form>
        </div>
        <div className="flex-[1.5] overflow-y-auto max-h-[500px] custom-scrollbar pr-2">
          <div className="flex justify-between items-center mb-4 sticky top-0 bg-white pt-2 pb-2 z-10 border-b border-slate-100">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Estados Registrados ({statuses.length})</p>
          </div>
          <div className="space-y-3">
            {statuses.map(s => (
              <div key={s.id} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col hover:bg-white transition-colors shadow-sm">
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-[10px] font-black uppercase border ${getStatusBadge(s.id)}`}>{s.id}</span>
                    {s.blocks_outbound && <span className="text-[8px] bg-red-100 text-red-700 px-2 py-0.5 rounded flex items-center font-bold uppercase"><ShieldAlert size={10} className="mr-1"/> Bloquea Salida</span>}
                  </div>
                  {s.id !== 'DISPONIBLE' && (
                    <button onClick={() => handleDeleteStatus(s.id)} className="text-slate-300 hover:text-red-500 transition-colors ml-2"><Trash2 size={14}/></button>
                  )}
                </div>
                <p className="text-xs text-slate-600 font-bold mt-2">{s.description}</p>
              </div>
            ))}
            {statuses.length === 0 && <div className="p-8 text-center text-slate-400"><Activity className="w-12 h-12 mx-auto mb-2 opacity-50"/><p className="text-[10px] uppercase tracking-widest font-bold">No hay estados configurados</p></div>}
          </div>
        </div>
      </div>
    </div>
  );
}
