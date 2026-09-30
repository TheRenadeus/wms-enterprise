// Tab "Registro de Clientes 3PL" — lazy-loaded (COD-01 split).
// Componente de presentación: el estado y los handlers viven en App.js y se
// reciben como props, igual que ReturnsTab.

import React from 'react';
import { Users, Building2, Loader2, Download, Upload, Search, X, Globe, Trash2 } from 'lucide-react';

export default function ClientsTab({
  clientForm, setClientForm, isSavingClient, handleSaveClient,
  filteredClients, permittedClients,
  clientIdFilter, setClientIdFilter,
  clientNameFilter, setClientNameFilter,
  clientContactFilter, setClientContactFilter,
  setImportModal,
  portalConfigClient, setPortalConfigClient,
  portalConfigForm, setPortalConfigForm,
  handleDeleteClient, handlePortalSaveConfig,
}) {
  return (
    <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
      <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row gap-8">
        <div className="flex-1 space-y-6 border-r border-slate-100 pr-8">
          <div>
            <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center"><Users className="w-5 h-5 mr-2 text-indigo-500"/> Registro de Clientes</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Añadir dueños de mercadería (Operación Multi-Cliente)</p>
          </div>
          <form onSubmit={handleSaveClient} className="space-y-6">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">ID / RUT / CUIT *</label><input type="text" value={clientForm.id} onChange={e=>setClientForm({...clientForm, id: e.target.value.toUpperCase().replace(/\s/g, '')})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 uppercase" placeholder="Ej: CLI-001"/></div>
                <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Razón Social / Nombre *</label><input type="text" value={clientForm.name} onChange={e=>setClientForm({...clientForm, name: e.target.value})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder="Nombre de la empresa"/></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Contacto (Persona)</label><input type="text" value={clientForm.contact} onChange={e=>setClientForm({...clientForm, contact: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder="Nombre del responsable"/></div>
                <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Email</label><input type="email" value={clientForm.email} onChange={e=>setClientForm({...clientForm, email: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder="correo@empresa.com"/></div>
              </div>
            </div>
            <button type="submit" disabled={isSavingClient} className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-200 uppercase text-xs tracking-widest hover:bg-indigo-700 transition-colors mt-4 flex justify-center items-center disabled:opacity-60">
              {isSavingClient ? <><Loader2 size={16} className="mr-2 animate-spin"/> Guardando...</> : <><Building2 size={16} className="mr-2"/> Guardar Cliente en Base de Datos</>}
            </button>
          </form>
        </div>
        <div className="flex-[1.5] overflow-y-auto max-h-[500px] custom-scrollbar pr-2">
          <div className="sticky top-0 bg-white pt-2 pb-3 z-10 border-b border-slate-100 space-y-2 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Clientes ({filteredClients.length})</p>
                <button onClick={() => { const headers='id,name,contact,email'; const csv=filteredClients.map(c=>`"${c.id}","${c.name}","${c.contact||''}","${c.email||''}"`).join('\n'); const blob=new Blob([headers+'\n'+csv],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='clientes_filtrados.csv'; a.click(); }} className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-2 py-1 rounded-lg text-[9px] font-black uppercase flex items-center gap-1"><Download size={10}/> CSV</button>
                <button onClick={() => setImportModal({ type: 'clients' })} className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1 rounded-lg text-[9px] font-black uppercase flex items-center gap-1"><Upload size={10}/> Importar</button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-2 py-1"><Search size={11} className="text-slate-400 mr-1 shrink-0"/><input type="text" placeholder="ID..." value={clientIdFilter} onChange={(e) => setClientIdFilter(e.target.value)} className="bg-transparent text-[10px] font-bold outline-none w-full text-slate-700"/></div>
              <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-2 py-1"><Search size={11} className="text-slate-400 mr-1 shrink-0"/><input type="text" placeholder="Nombre..." value={clientNameFilter} onChange={(e) => setClientNameFilter(e.target.value)} className="bg-transparent text-[10px] font-bold outline-none w-full text-slate-700"/></div>
              <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-2 py-1"><Search size={11} className="text-slate-400 mr-1 shrink-0"/><input type="text" placeholder="Contacto / email..." value={clientContactFilter} onChange={(e) => setClientContactFilter(e.target.value)} className="bg-transparent text-[10px] font-bold outline-none w-full text-slate-700"/></div>
            </div>
            {(clientIdFilter||clientNameFilter||clientContactFilter) && <button onClick={()=>{setClientIdFilter('');setClientNameFilter('');setClientContactFilter('');}} className="mt-1 bg-red-50 text-red-500 border border-red-200 rounded-lg px-2 py-1 text-[9px] font-black uppercase flex items-center gap-1 w-max"><X size={9}/> Limpiar</button>}
          </div>
          <div className="space-y-3">
            {filteredClients.map(c => (
              <div key={c.id} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col hover:bg-white transition-colors shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-sm font-black text-slate-800 flex items-center gap-2">{c.name}</p>
                    <p className="text-[10px] font-mono text-indigo-600 mt-1">ID: {c.id}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setPortalConfigClient(c.id); setPortalConfigForm({ portal_enabled: !!c.portal_enabled, portal_password:'', portal_email: c.portal_email||'' }); }} className="text-[9px] font-black bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-2 py-1 rounded-lg uppercase flex items-center gap-1 transition-colors"><Globe size={10}/> Portal</button>
                    <button onClick={() => handleDeleteClient(c.id)} className="text-slate-300 hover:text-red-500 transition-colors ml-2"><Trash2 size={14}/></button>
                  </div>
                </div>
                {(c.contact || c.email) && (
                  <div className="mt-2 pt-2 border-t border-slate-100 flex gap-4 text-[9px] text-slate-500 font-bold tracking-widest">
                    {c.contact && <span>Contacto: {c.contact}</span>}
                    {c.email && <span>Email: {c.email}</span>}
                  </div>
                )}
                {/* Portal config expandida */}
                {portalConfigClient === c.id && (
                  <div className="mt-3 pt-3 border-t-2 border-indigo-100 bg-indigo-50 rounded-2xl p-4 space-y-3">
                    <p className="text-[10px] font-black text-indigo-700 uppercase tracking-widest flex items-center gap-1"><Globe size={10}/> Configuración Portal 3PL</p>
                    <div className="flex items-center gap-3">
                      <label className="text-[10px] font-black text-slate-600 uppercase">Portal Habilitado</label>
                      <button onClick={()=>setPortalConfigForm(f=>({...f,portal_enabled:!f.portal_enabled}))} className={`w-10 h-6 rounded-full transition-colors ${portalConfigForm.portal_enabled?'bg-indigo-600':'bg-slate-300'}`}><span className={`block w-4 h-4 bg-white rounded-full shadow transition-transform mx-1 ${portalConfigForm.portal_enabled?'translate-x-4':'translate-x-0'}`}/></button>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 uppercase">Nueva Contraseña Portal</label>
                      <input type="password" placeholder="Dejar vacío para no cambiar" value={portalConfigForm.portal_password} onChange={e=>setPortalConfigForm(f=>({...f,portal_password:e.target.value}))} className="w-full border-2 border-indigo-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500"/>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 uppercase">Email del Portal</label>
                      <input type="email" placeholder="email@cliente.com" value={portalConfigForm.portal_email} onChange={e=>setPortalConfigForm(f=>({...f,portal_email:e.target.value}))} className="w-full border-2 border-indigo-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500"/>
                    </div>
                    {portalConfigForm.portal_enabled && (
                      <div className="bg-white rounded-xl px-3 py-2 border border-indigo-200">
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-1">URL del Portal</p>
                        <p className="font-mono text-[10px] text-indigo-700 break-all">{window.location.origin}?portal={c.id}</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button onClick={()=>handlePortalSaveConfig(c.id)} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black py-2 rounded-xl text-[10px] uppercase tracking-widest transition-colors">Guardar</button>
                      <button onClick={()=>setPortalConfigClient(null)} className="px-4 bg-slate-200 hover:bg-slate-300 text-slate-600 font-black py-2 rounded-xl text-[10px] uppercase tracking-widest transition-colors">Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {permittedClients.length === 0 && <div className="p-8 text-center text-slate-400"><Building2 className="w-12 h-12 mx-auto mb-2 opacity-50"/><p className="text-[10px] uppercase tracking-widest font-bold">No hay clientes visibles para usted</p></div>}
          </div>
        </div>
      </div>
    </div>
  );
}
