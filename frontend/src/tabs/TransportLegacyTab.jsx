// Tab "Módulo de Transporte" (transportistas + envíos) — lazy-loaded (COD-01 split).
// Distinto de TransporteTab.jsx (módulo nuevo del Coordinador de Transporte).
// Componente de presentación: el estado y los handlers viven en App.js y se
// reciben como props, igual que ReturnsTab.

import React from 'react';
import { Truck, FileText, Plus, Settings2, Trash2, Package } from 'lucide-react';

export default function TransportLegacyTab({
  transportTab, setTransportTab,
  carrierForm, setCarrierForm, handleSaveCarrier, carriers,
  shipmentForm, setShipmentForm, handleSaveShipment, shipments, handleShipmentStatus,
  is3PLMode, permittedClients, systemConfig,
  confirm, apiFetch, host, showMsg, fetchData,
}) {
  return (
    <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><Truck className="text-cyan-500"/> Módulo de Transporte</h1>
      </div>
      {/* Sub-tabs transporte */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl w-fit">
        {[['carriers','Transportistas'],['shipments','Envíos']].map(([id,label])=>(
          <button key={id} onClick={()=>setTransportTab(id)} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors ${transportTab===id?'bg-white text-cyan-700 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{label}</button>
        ))}
      </div>

      {transportTab === 'carriers' && (
      <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row gap-8">
        <div className="flex-1 space-y-5 border-r border-slate-100 pr-8">
          <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter flex items-center"><Truck className="w-4 h-4 mr-2 text-cyan-500"/> {carrierForm.id ? 'Editar Transportista' : 'Nuevo Transportista'}</h2>
          <form onSubmit={handleSaveCarrier} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Razón Social *</label><input type="text" required value={carrierForm.name} onChange={e=>setCarrierForm({...carrierForm,name:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500"/></div>
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">RUT</label><input type="text" value={carrierForm.rut} onChange={e=>setCarrierForm({...carrierForm,rut:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500"/></div>
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Contacto</label><input type="text" value={carrierForm.contact} onChange={e=>setCarrierForm({...carrierForm,contact:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500"/></div>
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Teléfono</label><input type="text" value={carrierForm.phone} onChange={e=>setCarrierForm({...carrierForm,phone:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500"/></div>
              <div className="col-span-2 space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Email</label><input type="email" value={carrierForm.email} onChange={e=>setCarrierForm({...carrierForm,email:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500"/></div>
            </div>
            <div className="flex gap-3">
              <button type="submit" className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-white font-black py-4 rounded-2xl uppercase text-xs tracking-widest shadow-lg shadow-cyan-200 transition-colors flex items-center justify-center gap-2"><Plus size={14}/> {carrierForm.id?'Actualizar':'Guardar'}</button>
              {carrierForm.id && <button type="button" onClick={()=>setCarrierForm({id:'',name:'',rut:'',contact:'',phone:'',email:''})} className="px-6 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black py-4 rounded-2xl text-xs uppercase tracking-widest transition-colors">Cancelar</button>}
            </div>
          </form>
        </div>
        <div className="flex-[1.5] overflow-y-auto max-h-[600px] custom-scrollbar pr-2">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Transportistas Registrados ({carriers.length})</p>
          <div className="space-y-3">
            {carriers.map(c=>(
              <div key={c.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 hover:bg-white transition-colors shadow-sm">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-black text-slate-800">{c.name}</p>
                    {c.rut && <p className="text-[10px] font-mono text-slate-500 mt-0.5">RUT: {c.rut}</p>}
                    <div className="flex gap-3 mt-1 text-[9px] text-slate-400 font-bold">{c.contact&&<span>{c.contact}</span>}{c.phone&&<span>{c.phone}</span>}{c.email&&<span>{c.email}</span>}</div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={()=>setCarrierForm({id:c.id,name:c.name,rut:c.rut||'',contact:c.contact||'',phone:c.phone||'',email:c.email||''})} className="text-slate-400 hover:text-cyan-600 transition-colors"><Settings2 size={14}/></button>
                    <button onClick={async()=>{if(!(await confirm({ message: '¿Eliminar?', danger: true })))return;const r=await apiFetch(`${host}/api/carriers/${c.id}`,{method:'DELETE'});if(r.ok){showMsg('✅ Eliminado');fetchData();}}} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={14}/></button>
                  </div>
                </div>
              </div>
            ))}
            {carriers.length===0 && <div className="p-8 text-center text-slate-400"><Truck className="w-12 h-12 mx-auto mb-2 opacity-50"/><p className="text-[10px] uppercase tracking-widest font-bold">No hay transportistas registrados</p></div>}
          </div>
        </div>
      </div>
      )}

      {transportTab === 'shipments' && (
      <div className="space-y-6">
        <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8">
          <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter flex items-center mb-6"><FileText className="w-4 h-4 mr-2 text-cyan-500"/> Nuevo Envío</h2>
          <form onSubmit={handleSaveShipment} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Transportista *</label><select required value={shipmentForm.carrier_id} onChange={e=>setShipmentForm({...shipmentForm,carrier_id:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500 bg-white"><option value="">-- Seleccionar --</option>{carriers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">N° Documento *</label><input type="text" required value={shipmentForm.doc_num} onChange={e=>setShipmentForm({...shipmentForm,doc_num:e.target.value.toUpperCase()})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-cyan-500 uppercase"/></div>
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Cliente</label>{is3PLMode ? (<select value={shipmentForm.client_id} onChange={e=>setShipmentForm({...shipmentForm,client_id:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500 bg-white"><option value="">-- Seleccionar --</option>{permittedClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>) : (<div className="w-full border-2 border-emerald-200 bg-emerald-50 rounded-xl px-4 py-3 text-sm font-black text-emerald-700 flex items-center gap-2"><Package size={14} className="text-emerald-500 shrink-0"/>{systemConfig.own_client_name || 'Bodega Propia'}</div>)}</div>
              <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Destino</label><input type="text" value={shipmentForm.destination} onChange={e=>setShipmentForm({...shipmentForm,destination:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500"/></div>
              <div className="col-span-2 space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Notas</label><input type="text" value={shipmentForm.notes} onChange={e=>setShipmentForm({...shipmentForm,notes:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-500"/></div>
            </div>
            <button type="submit" className="bg-cyan-600 hover:bg-cyan-700 text-white font-black py-4 px-8 rounded-2xl uppercase text-xs tracking-widest shadow-lg shadow-cyan-200 transition-colors flex items-center gap-2"><Plus size={14}/> Crear Envío</button>
          </form>
        </div>
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b"><tr><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Documento</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Transportista</th>{is3PLMode && <th className="p-4 text-[10px] font-black text-slate-400 uppercase">Cliente</th>}<th className="p-4 text-[10px] font-black text-slate-400 uppercase">Destino</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Estado</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Acciones</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {shipments.map(s=>{
                const statusColors = {PENDING:'bg-slate-100 text-slate-600',ASSIGNED:'bg-blue-100 text-blue-700',IN_TRANSIT:'bg-amber-100 text-amber-700',DELIVERED:'bg-emerald-100 text-emerald-700',RETURNED:'bg-red-100 text-red-700'};
                const nextStatus = {PENDING:'ASSIGNED',ASSIGNED:'IN_TRANSIT',IN_TRANSIT:'DELIVERED'};
                const nextLabel = {PENDING:'Asignar',ASSIGNED:'En Tránsito',IN_TRANSIT:'Entregar'};
                return (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="p-4 font-black text-xs uppercase text-cyan-700">{s.doc_num}</td>
                    <td className="p-4 text-xs text-slate-600">{s.carrier_name||s.carrier_id}</td>
                    {is3PLMode && <td className="p-4 text-xs text-slate-500">{s.client_id||'—'}</td>}
                    <td className="p-4 text-xs text-slate-500">{s.destination||'—'}</td>
                    <td className="p-4"><span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${statusColors[s.status]||'bg-slate-100 text-slate-600'}`}>{s.status}</span></td>
                    <td className="p-4">
                      <div className="flex gap-2">
                        {nextStatus[s.status] && <button onClick={()=>handleShipmentStatus(s.id,nextStatus[s.status])} className="text-[9px] font-black bg-cyan-50 hover:bg-cyan-100 text-cyan-700 px-2 py-1 rounded-lg uppercase transition-colors">{nextLabel[s.status]}</button>}
                        {s.status!=='DELIVERED'&&s.status!=='RETURNED' && <button onClick={()=>handleShipmentStatus(s.id,'RETURNED')} className="text-[9px] font-black bg-red-50 hover:bg-red-100 text-red-600 px-2 py-1 rounded-lg uppercase transition-colors">Devolver</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {shipments.length===0 && <tr><td colSpan={is3PLMode ? 6 : 5} className="p-8 text-center text-slate-400 text-xs">Sin envíos registrados</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}
