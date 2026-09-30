// Tab "Gestión de Devoluciones" — lazy-loaded (COD-01 split).
// Componente de presentación: el estado y los handlers viven en App.js y se
// reciben como props, igual que ChangeStatusTab / StatusesTab.

import React from 'react';
import { ArrowLeft, RefreshCcw, Package, Plus, Trash2 } from 'lucide-react';

export default function ReturnsTab({
  returnsData, setReturnsData,
  newReturn, setNewReturn,
  returnLineItem, setReturnLineItem,
  is3PLMode, isHybridMode, permittedClients, permittedSkus, systemConfig, currentUser,
  showMsg, apiFetch, host, fetchData,
}) {
  return (
    <div className="space-y-6 animate-in fade-in max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><ArrowLeft className="text-orange-500"/> Gestión de Devoluciones</h1>
        <button onClick={async () => { const res = await apiFetch(`${host}/api/returns`); const d = await res.json(); setReturnsData(Array.isArray(d)?d:[]); }} className="bg-orange-100 hover:bg-orange-200 text-orange-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 shadow-sm"><RefreshCcw size={12}/> Cargar</button>
      </div>
      <div className="bg-white rounded-3xl border border-orange-200 shadow-sm p-8">
        <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter mb-6 border-b pb-4">Nueva Devolución</h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <input type="text" placeholder="N° Documento *" value={newReturn.doc_num} onChange={e=>setNewReturn({...newReturn,doc_num:e.target.value.toUpperCase()})} className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black uppercase outline-none focus:border-orange-500"/>
          {is3PLMode ? (
            <select value={newReturn.client_id} onChange={e=>setNewReturn({...newReturn,client_id:e.target.value})} className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-orange-500 bg-white">
              <option value="">-- Cliente --</option>
              {permittedClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : (
            <div className="border-2 border-emerald-200 bg-emerald-50 rounded-xl px-4 py-3 text-sm font-black text-emerald-700 flex items-center gap-2">
              <Package size={14} className="text-emerald-500 shrink-0"/>{systemConfig.own_client_name || 'Bodega Propia'}
            </div>
          )}
          <input type="text" placeholder="Motivo de devolución *" value={newReturn.reason} onChange={e=>setNewReturn({...newReturn,reason:e.target.value})} className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-orange-500 col-span-2"/>
        </div>
        <div className="bg-slate-50 rounded-2xl p-4 mb-4 space-y-3">
          <h4 className="text-[10px] font-black text-slate-500 uppercase">Agregar Línea de Devolución</h4>
          <div className="grid grid-cols-3 gap-3">
            <select value={returnLineItem.sku} onChange={e=>setReturnLineItem({...returnLineItem,sku:e.target.value})} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white uppercase">
              <option value="">-- SKU --</option>
              {permittedSkus.filter(s=>!newReturn.client_id || (s.client_id||'')===newReturn.client_id).map(s=><option key={s.sku} value={s.sku}>{s.sku}</option>)}
            </select>
            <input type="number" placeholder="Cantidad" value={returnLineItem.qty} onChange={e=>setReturnLineItem({...returnLineItem,qty:e.target.value})} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none"/>
            <select value={returnLineItem.condition} onChange={e=>setReturnLineItem({...returnLineItem,condition:e.target.value})} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white">
              <option value="BUENO">Buen Estado → DISPONIBLE</option>
              <option value="MALO">Dañado → RETENIDO</option>
            </select>
          </div>
          <button onClick={() => { if (!returnLineItem.sku || !returnLineItem.qty) return; setNewReturn(prev=>({...prev,items:[...prev.items,{...returnLineItem}]})); setReturnLineItem({sku:'',qty:'',original_lpn:'',condition:'BUENO',location_id:'PISO-RECEPCION',notes:''}); }} className="bg-orange-100 hover:bg-orange-200 text-orange-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1"><Plus size={12}/> Agregar</button>
        </div>
        {newReturn.items.length > 0 && (
          <div className="mb-4">
            {newReturn.items.map((it,i) => (
              <div key={i} className="flex justify-between items-center p-3 bg-white rounded-xl border border-slate-200 mb-2">
                <span className="text-xs font-black uppercase">{it.sku} — {it.qty} un <span className={`text-[9px] px-1 rounded ${it.condition==='BUENO'?'bg-emerald-100 text-emerald-700':'bg-red-100 text-red-700'}`}>{it.condition}</span></span>
                <button onClick={()=>setNewReturn(prev=>({...prev,items:prev.items.filter((_,idx)=>idx!==i)}))} className="text-red-400 hover:text-red-600"><Trash2 size={14}/></button>
              </div>
            ))}
          </div>
        )}
        <button disabled={!newReturn.doc_num || !newReturn.reason || newReturn.items.length===0} onClick={async () => { const retPayload={...newReturn,username:currentUser.username}; if((!is3PLMode || isHybridMode) && !retPayload.client_id) retPayload.client_id=systemConfig.own_client_id||'PROPIO'; if(is3PLMode && !retPayload.client_id) return showMsg('⛔ Selecciona el cliente de la devolución', true); const res = await apiFetch(`${host}/api/returns`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(retPayload)}); if (res.ok) { const d=await res.json(); showMsg(`✅ Devolución ${d.returnId} procesada`); setNewReturn({doc_num:'',doc_type:'DEVOLUCION',client_id:'',reason:'',glosa:'',items:[]}); fetchData(); } else { const e=await res.json().catch(()=>({})); showMsg(`⛔ ${e.error||'Error'}`,true); } }} className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black py-4 rounded-2xl shadow-lg uppercase text-[10px] tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"><ArrowLeft size={16}/> Procesar Devolución e Ingresar Stock</button>
      </div>
      {returnsData.length > 0 && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b"><tr><th className="p-4 text-[10px] font-black text-slate-400 uppercase">ID Devolución</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Documento</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Motivo</th><th className="p-4 text-[10px] font-black text-slate-400 uppercase">Fecha</th><th className="p-4 text-center text-[10px] font-black text-slate-400 uppercase">Líneas</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {returnsData.map(r=>(
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="p-4 font-mono text-[10px] font-black text-orange-700">{r.id}</td>
                  <td className="p-4 text-xs font-black uppercase">{r.doc_num}</td>
                  <td className="p-4 text-xs text-slate-600">{r.reason}</td>
                  <td className="p-4 text-[10px] text-slate-400">{new Date(r.created_at).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})}</td>
                  <td className="p-4 text-center font-black text-slate-700">{r.line_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
