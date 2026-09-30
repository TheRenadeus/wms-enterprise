// Tab "Órdenes de Compra" — lazy-loaded (COD-01 split).
// Componente de presentación: el estado y los handlers viven en App.js y se
// reciben como props, igual que ReturnsTab.

import React from 'react';
import { FileText, RefreshCcw, Plus, Package, X, ArrowLeft, CheckCircle2, Search } from 'lucide-react';

export default function PurchaseOrdersTab({
  purchaseOrders, setPurchaseOrders,
  showPOForm, setShowPOForm,
  newPO, setNewPO, newPOLine, setNewPOLine,
  activePO, setActivePO, poLines, setPoLines, poReceivedQtys, setPoReceivedQtys,
  is3PLMode, isHybridMode, permittedClients, permittedSkus, systemConfig, currentUser,
  showMsg, apiFetch, host,
}) {
  return (
    <div className="space-y-6 animate-in fade-in max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><FileText className="text-indigo-500"/> Órdenes de Compra</h1>
        <div className="flex gap-2">
          <button onClick={async () => { const res = await apiFetch(`${host}/api/purchase-orders`); const d = await res.json(); setPurchaseOrders(Array.isArray(d)?d:[]); }} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2"><RefreshCcw size={12}/> Cargar</button>
          <button onClick={() => setShowPOForm(!showPOForm)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 shadow-md"><Plus size={12}/> Nueva OC</button>
        </div>
      </div>

      {showPOForm && (
        <div className="bg-white rounded-3xl border border-indigo-200 shadow-sm p-8 animate-in slide-in-from-top-4">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter mb-6 border-b pb-4 flex items-center gap-2"><FileText size={16} className="text-indigo-500"/> Crear Nueva Orden de Compra</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <input type="text" placeholder="N° OC / Referencia *" value={newPO.doc_num} onChange={e=>setNewPO({...newPO,doc_num:e.target.value.toUpperCase()})} className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black uppercase outline-none focus:border-indigo-500"/>
            <input type="text" placeholder="Proveedor *" value={newPO.supplier} onChange={e=>setNewPO({...newPO,supplier:e.target.value})} className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500"/>
            {is3PLMode ? (
              <select value={newPO.client_id} onChange={e=>setNewPO({...newPO,client_id:e.target.value})} className="border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 bg-white">
                <option value="">-- Cliente Destino --</option>
                {permittedClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <div className="border-2 border-emerald-200 bg-emerald-50 rounded-xl px-4 py-3 text-sm font-black text-emerald-700 flex items-center gap-2">
                <Package size={14} className="text-emerald-500 shrink-0"/>{systemConfig.own_client_name || 'Bodega Propia'}
              </div>
            )}
            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase">Fecha Esperada de Llegada</label>
              <input type="date" value={newPO.expected_date} onChange={e=>setNewPO({...newPO,expected_date:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 bg-white"/>
            </div>
          </div>
          <div className="bg-slate-50 rounded-2xl p-4 mb-4">
            <p className="text-[10px] font-black text-slate-500 uppercase mb-3">Líneas de Productos Esperados</p>
            <div className="flex gap-3 mb-3">
              <select value={newPOLine.sku} onChange={e=>setNewPOLine({...newPOLine,sku:e.target.value})} className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white uppercase">
                <option value="">-- SKU --</option>
                {permittedSkus.filter(s=>!newPO.client_id || (s.client_id||'')===newPO.client_id).map(s=><option key={s.sku} value={s.sku}>{s.sku} — {s.desc}</option>)}
              </select>
              <input type="number" min="0.01" placeholder="Cant. Esperada" value={newPOLine.expected_qty} onChange={e=>setNewPOLine({...newPOLine,expected_qty:e.target.value})} className="w-36 border border-slate-200 rounded-xl px-3 py-2 text-xs font-black outline-none text-center"/>
              <button onClick={() => { if (!newPOLine.sku || !newPOLine.expected_qty) return; setNewPO(p=>({...p,items:[...p.items,{...newPOLine}]})); setNewPOLine({sku:'',expected_qty:''}); }} className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1"><Plus size={12}/> Agregar</button>
            </div>
            {newPO.items.map((it,i) => (
              <div key={i} className="flex justify-between items-center bg-white p-3 rounded-xl border border-slate-200 mb-2">
                <span className="text-xs font-black uppercase text-slate-800">{it.sku} <span className="text-slate-400 font-normal">— esperado: {it.expected_qty} un</span></span>
                <button onClick={()=>setNewPO(p=>({...p,items:p.items.filter((_,idx)=>idx!==i)}))} className="text-red-400 hover:text-red-600"><X size={14}/></button>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button disabled={!newPO.doc_num || !newPO.supplier || newPO.items.length===0} onClick={async () => { const poPayload={...newPO,username:currentUser.username}; if((!is3PLMode || isHybridMode) && !poPayload.client_id) poPayload.client_id=systemConfig.own_client_id||'PROPIO'; if(is3PLMode && !poPayload.client_id) return showMsg('⛔ Selecciona el cliente de la orden de compra', true); const res = await apiFetch(`${host}/api/purchase-orders`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(poPayload)}); if(res.ok){const d=await res.json(); showMsg(`✅ OC ${d.poId} creada`); setNewPO({doc_num:'',supplier:'',client_id:'',expected_date:'',notes:'',items:[]}); setShowPOForm(false); const r2=await apiFetch(`${host}/api/purchase-orders`); setPurchaseOrders(await r2.json());} else { const e=await res.json().catch(()=>({})); showMsg(`⛔ ${e.error||'Error'}`,true); } }} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 rounded-2xl shadow-lg uppercase text-[10px] tracking-widest disabled:opacity-50">Crear Orden de Compra</button>
            <button onClick={() => setShowPOForm(false)} className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-black py-3 px-6 rounded-2xl uppercase text-[10px]">Cancelar</button>
          </div>
        </div>
      )}

      {activePO ? (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-indigo-50 p-6 border-b border-indigo-200 flex justify-between items-center">
            <div>
              <h3 className="text-lg font-black text-indigo-900 uppercase">{activePO.doc_num} — {activePO.supplier}</h3>
              <p className="text-[10px] font-bold text-indigo-600 uppercase">Comparar cantidades recibidas vs esperadas</p>
            </div>
            <button onClick={() => { setActivePO(null); setPoLines([]); setPoReceivedQtys({}); }} className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase"><ArrowLeft size={12} className="inline mr-1"/> Volver</button>
          </div>
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b"><tr>
              <th className="p-4 text-[10px] font-black text-slate-400 uppercase">SKU / Producto</th>
              <th className="p-4 text-center text-[10px] font-black text-slate-400 uppercase">Esperado</th>
              <th className="p-4 text-center text-[10px] font-black text-indigo-600 uppercase">Recibido Real</th>
              <th className="p-4 text-center text-[10px] font-black text-slate-400 uppercase">Diferencia</th>
              <th className="p-4 text-center text-[10px] font-black text-slate-400 uppercase">Estado</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {poLines.map(line => {
                const received = parseFloat(poReceivedQtys[line.id] ?? line.received_qty ?? 0);
                const expected = parseFloat(line.expected_qty);
                const diff = received - expected;
                return (
                  <tr key={line.id} className={`hover:bg-slate-50 ${diff < 0 ? 'bg-red-50/30' : diff > 0 ? 'bg-amber-50/30' : ''}`}>
                    <td className="p-4"><p className="text-xs font-black text-slate-800 uppercase">{line.sku}</p><p className="text-[9px] text-slate-500">{line.desc}</p></td>
                    <td className="p-4 text-center font-black text-slate-700">{expected} <span className="text-[9px] text-slate-400">{line.uom||'UN'}</span></td>
                    <td className="p-4 text-center">
                      {line.status === 'RECEIVED' ? <span className="font-black text-emerald-700">{line.received_qty}</span> : (
                        <input type="number" min="0" step="0.01" value={poReceivedQtys[line.id] ?? ''} onChange={e=>setPoReceivedQtys(p=>({...p,[line.id]:e.target.value}))} className="w-24 border-2 border-indigo-200 rounded-xl px-3 py-2 text-center font-black text-sm outline-none focus:border-indigo-500 text-indigo-700 bg-indigo-50" placeholder="0"/>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      {line.status === 'RECEIVED' ? (
                        <span className={`font-black text-sm ${parseFloat(line.difference)===0?'text-emerald-600':parseFloat(line.difference)>0?'text-amber-600':'text-red-600'}`}>
                          {parseFloat(line.difference)>0?'+':''}{line.difference}
                        </span>
                      ) : (
                        poReceivedQtys[line.id] !== undefined && (
                          <span className={`font-black text-sm ${diff===0?'text-emerald-600':diff>0?'text-amber-600':'text-red-600'}`}>
                            {diff>0?'+':''}{diff.toFixed(2)}
                          </span>
                        )
                      )}
                    </td>
                    <td className="p-4 text-center">
                      <span className={`text-[9px] font-black px-2 py-1 rounded uppercase ${line.status==='RECEIVED'?'bg-emerald-100 text-emerald-700':line.status==='PARTIAL'?'bg-amber-100 text-amber-700':'bg-slate-100 text-slate-600'}`}>
                        {line.status==='RECEIVED'?'Completo':line.status==='PARTIAL'?'Parcial':'Pendiente'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
            <div className="flex gap-4 text-[10px] font-black text-slate-500 uppercase">
              <span>Total líneas: {poLines.length}</span>
              <span className="text-emerald-600">Completas: {poLines.filter(l=>l.status==='RECEIVED').length}</span>
              <span className="text-red-500">Pendientes: {poLines.filter(l=>l.status==='PENDING').length}</span>
            </div>
            <button onClick={async () => {
              const items = poLines.filter(l=>l.status!=='RECEIVED' && poReceivedQtys[l.id]!==undefined).map(l=>({lineId:l.id,received_qty:parseFloat(poReceivedQtys[l.id])||0}));
              if (!items.length) return showMsg('⚠️ Ingresa cantidades recibidas primero', true);
              const res = await apiFetch(`${host}/api/purchase-orders/${activePO.id}/receive`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({received_items:items,username:currentUser.username})});
              if(res.ok){showMsg('✅ Recepción comparada y guardada');const r2=await apiFetch(`${host}/api/purchase-orders/${activePO.id}/lines`);const d=await r2.json();setPoLines(d.lines);setPoReceivedQtys({});}else showMsg('⛔ Error',true);
            }} className="bg-indigo-600 hover:bg-indigo-700 text-white font-black px-6 py-3 rounded-2xl shadow-md uppercase text-[10px] tracking-widest flex items-center gap-2"><CheckCircle2 size={14}/> Confirmar Recepción</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {purchaseOrders.map(po => (
            <div key={po.id} className={`bg-white p-5 rounded-2xl border shadow-sm flex items-center justify-between hover:shadow-md transition-all ${po.status==='COMPLETED'?'border-emerald-200':po.status==='PARTIAL'?'border-amber-200':'border-slate-200'}`}>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <p className="text-sm font-black text-slate-800 uppercase">{po.doc_num}</p>
                  <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${po.status==='COMPLETED'?'bg-emerald-100 text-emerald-700':po.status==='PARTIAL'?'bg-amber-100 text-amber-700':'bg-slate-100 text-slate-600'}`}>{po.status}</span>
                </div>
                <p className="text-[10px] text-slate-500 font-bold">Proveedor: {po.supplier} · {po.received_lines}/{po.total_lines} líneas recibidas</p>
                {po.expected_date && <p className="text-[9px] text-slate-400 mt-0.5">Esperado: {new Date(po.expected_date).toLocaleDateString('es-ES')}</p>}
              </div>
              <button onClick={async () => { const res = await apiFetch(`${host}/api/purchase-orders/${po.id}/lines`); const d = await res.json(); setActivePO(d.po); setPoLines(d.lines); setPoReceivedQtys({}); }} className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1"><Search size={12}/> Ver / Comparar</button>
            </div>
          ))}
          {purchaseOrders.length === 0 && <div className="bg-slate-100 border-2 border-dashed border-slate-300 rounded-3xl p-16 text-center text-slate-400"><FileText className="w-12 h-12 mx-auto mb-3 opacity-50"/><p className="font-black uppercase tracking-widest text-xs">No hay órdenes. Presiona Cargar o crea una nueva.</p></div>}
        </div>
      )}
    </div>
  );
}
