// Tab "Maestro de Documentos" — lazy-loaded (COD-01 split).
// Componente de presentación: el estado del formulario y los handlers viven en
// App.js y se reciben como props, igual que ChangeStatusTab.

import React from 'react';
import { FileType, Plus, Trash2 } from 'lucide-react';

export default function DocTypesTab({
  documentTypes,
  docTypeForm, setDocTypeForm,
  handleSaveDocType, handleDeleteDocType,
}) {
  return (
    <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
      <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row gap-8">
        <div className="flex-1 space-y-6 border-r border-slate-100 pr-8">
          <div>
            <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center"><FileType className="w-5 h-5 mr-2 text-indigo-500"/> Maestro de Documentos</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Configurar tipos de documentos admitidos (Factura, Guía, etc.)</p>
          </div>
          <form onSubmit={handleSaveDocType} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">ID Documento (Ej: FACTURA, GUIA) *</label><input type="text" value={docTypeForm.id} onChange={e=>setDocTypeForm({...docTypeForm, id: e.target.value.toUpperCase().replace(/\s/g, '_')})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 uppercase" placeholder="Ej: FACTURA_VENTA"/></div>
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Descripción *</label><input type="text" value={docTypeForm.description} onChange={e=>setDocTypeForm({...docTypeForm, description: e.target.value})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder="Ej: Factura de Venta Electrónica"/></div>
              <div className="space-y-1">
                 <label className="text-[10px] font-black text-slate-400 uppercase">Flujo Permitido</label>
                 <select value={docTypeForm.flow_type} onChange={e=>setDocTypeForm({...docTypeForm, flow_type: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 bg-white">
                   <option value="BOTH">Ambos (Recepción y Despacho)</option>
                   <option value="INBOUND">Solo Recepción (Inbound)</option>
                   <option value="OUTBOUND">Solo Despacho (Outbound)</option>
                 </select>
              </div>
            </div>
            <button type="submit" className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-200 uppercase text-xs tracking-widest hover:bg-indigo-700 transition-colors mt-4 flex justify-center items-center"><Plus size={16} className="mr-2"/> Guardar Tipo de Documento</button>
          </form>
        </div>
        <div className="flex-[1.5] overflow-y-auto max-h-[500px] custom-scrollbar pr-2">
          <div className="flex justify-between items-center mb-4 sticky top-0 bg-white pt-2 pb-2 z-10 border-b border-slate-100">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipos de Documento Registrados ({documentTypes.length})</p>
          </div>
          <div className="space-y-3">
            {documentTypes.map(d => (
              <div key={d.id} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col hover:bg-white transition-colors shadow-sm">
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 rounded text-[10px] font-black uppercase border bg-slate-100 text-slate-600 border-slate-200">{d.id}</span>
                    <span className="text-[8px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded flex items-center font-bold uppercase">{d.flow_type === 'BOTH' ? 'AMBOS' : d.flow_type === 'INBOUND' ? 'RECEPCIÓN' : 'DESPACHO'}</span>
                  </div>
                  <button onClick={() => handleDeleteDocType(d.id)} className="text-slate-300 hover:text-red-500 transition-colors ml-2"><Trash2 size={14}/></button>
                </div>
                <p className="text-xs text-slate-600 font-bold mt-2">{d.description}</p>
              </div>
            ))}
            {documentTypes.length === 0 && <div className="p-8 text-center text-slate-400"><FileType className="w-12 h-12 mx-auto mb-2 opacity-50"/><p className="text-[10px] uppercase tracking-widest font-bold">No hay tipos de documento</p></div>}
          </div>
        </div>
      </div>
    </div>
  );
}
