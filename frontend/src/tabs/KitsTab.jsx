// Tab "Armado de Kits" (definiciones + órdenes de armado/desarmado) — lazy-loaded (COD-01 split).
// Componente de presentación: el estado y los handlers viven en App.js y se reciben como props.

import React from 'react';
import { Package, Plus, Trash2, ClipboardCheck, RefreshCcw, X, AlertTriangle, Loader2 } from 'lucide-react';

export default function KitsTab({
  is3PLMode, systemConfig, permittedClients, permittedSkus, safeSkus, kits,
  kittingTab, setKittingTab,
  kitForm, setKitForm, kitComponentLine, setKitComponentLine, kitClientSkus,
  handleSaveKit, addKitComponent, removeKitComponent, handleDeleteKit,
  ordForm, setOrdForm, ordSugeridos, setOrdSugeridos, ordKit, ordenesV2, creatingOrden,
  handleCreateOrden, loadOrdenesV2, openArmar, openDesarmar, openTrace,
  armOrden, setArmOrden, armSources, setArmSources, armDest, setArmDest, armBusy, handleArmar,
  traceOrden, setTraceOrden,
  desarmOrden, setDesarmOrden, desarmDest, setDesarmDest, desarmBusy, handleDesarmar,
  renderKitSourcePicker,
}) {
  return (
    <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
      {/* Sub-tabs kitting */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl w-fit flex-wrap">
        {[['definitions','Definiciones'],['ordenes','Órdenes (armado)']].map(([id,label])=>(
          <button key={id} onClick={()=>setKittingTab(id)} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors ${kittingTab===id?'bg-white text-indigo-700 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{label}</button>
        ))}
      </div>

      {/* SUB-TAB DEFINICIONES (original) */}
      {kittingTab === 'definitions' && (
      <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row gap-8">
        {/* Panel izquierdo: formulario */}
        <div className="flex-1 space-y-6 border-r border-slate-100 pr-8">
          <div>
            <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center"><Package className="w-5 h-5 mr-2 text-indigo-500"/> Nuevo Kit</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Agrupa SKUs en un producto compuesto</p>
          </div>
          <form onSubmit={handleSaveKit} className="space-y-5">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase">ID del Kit (SKU) *</label>
              <input type="text" value={kitForm.kit_sku} onChange={e=>setKitForm({...kitForm, kit_sku: e.target.value.toUpperCase()})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 uppercase" placeholder="Ej: KIT-BASICO-001"/>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase">Cliente *</label>
              {is3PLMode ? (
                <select value={kitForm.client_id} onChange={e=>{setKitForm({...kitForm, client_id: e.target.value, components: []}); setKitComponentLine({ sku:'', qty:'' });}} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 bg-white">
                  <option value="">-- Seleccionar --</option>
                  {permittedClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              ) : (
                <div className="w-full border-2 border-emerald-200 bg-emerald-50 rounded-xl px-4 py-3 text-sm font-black text-emerald-700 flex items-center gap-2">
                  <Package size={14} className="text-emerald-500 shrink-0"/>{systemConfig.own_client_name || 'Bodega Propia'}
                </div>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase">Descripción</label>
              <input type="text" value={kitForm.description} onChange={e=>setKitForm({...kitForm, description: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder="Ej: Kit de bienvenida"/>
            </div>

            {/* Agregar componente */}
            <div className="bg-slate-50 rounded-2xl p-4 space-y-3 border border-slate-200">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Agregar Componente</p>
              <div className="flex gap-2">
                <select value={kitComponentLine.sku} onChange={e=>setKitComponentLine({...kitComponentLine, sku: e.target.value})} disabled={is3PLMode && !kitForm.client_id} className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500 bg-white disabled:bg-slate-100 disabled:cursor-not-allowed">
                  <option value="">{is3PLMode && !kitForm.client_id ? '-- Elige un cliente primero --' : '-- SKU --'}</option>
                  {kitClientSkus.map(s => <option key={s.sku} value={s.sku}>{s.sku} — {s.desc}</option>)}
                </select>
                <input type="number" min="0.01" step="0.01" value={kitComponentLine.qty} onChange={e=>setKitComponentLine({...kitComponentLine, qty: e.target.value})} className="w-20 border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-black outline-none focus:border-indigo-500 text-center" placeholder="Qty"/>
                <button type="button" onClick={addKitComponent} className="bg-indigo-600 text-white px-3 py-2 rounded-xl hover:bg-indigo-700 transition-colors"><Plus size={16}/></button>
              </div>
            </div>

            {/* Lista de componentes del kit */}
            {kitForm.components.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Componentes ({kitForm.components.length})</p>
                {kitForm.components.map(c => {
                  const skuInfo = permittedSkus.find(s => s.sku === c.sku);
                  return (
                    <div key={c.sku} className="flex items-center justify-between bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2">
                      <div>
                        <span className="text-sm font-black text-indigo-800 uppercase">{c.sku}</span>
                        {skuInfo && <span className="text-[10px] text-indigo-500 ml-2">{skuInfo.desc}</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-black text-indigo-700 bg-indigo-100 px-3 py-0.5 rounded-full">× {c.qty}</span>
                        <button type="button" onClick={() => removeKitComponent(c.sku)} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={14}/></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button type="submit" className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-200 uppercase text-xs tracking-widest hover:bg-indigo-700 transition-colors flex justify-center items-center"><Plus size={16} className="mr-2"/> Guardar Kit</button>
          </form>
        </div>

        {/* Panel derecho: lista de kits */}
        <div className="flex-[1.5] overflow-y-auto max-h-[600px] custom-scrollbar pr-2">
          <div className="flex justify-between items-center mb-4 sticky top-0 bg-white pt-2 pb-2 z-10 border-b border-slate-100">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Kits Definidos ({kits.length})</p>
          </div>
          <div className="space-y-4">
            {kits.map(k => (
              <div key={`${k.kit_sku}-${k.client_id}`} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 hover:bg-white transition-colors shadow-sm">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="text-sm font-black text-slate-800 uppercase">{k.kit_sku}</p>
                    {k.description && <p className="text-[10px] text-slate-500 mt-0.5">{k.description}</p>}
                    <span className="text-[9px] font-black bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full uppercase mt-1 inline-block">{k.client_id}</span>
                  </div>
                  <button onClick={() => handleDeleteKit(k.kit_sku, k.client_id)} className="text-slate-300 hover:text-red-500 transition-colors mt-1"><Trash2 size={14}/></button>
                </div>
                <div className="space-y-1">
                  {(k.components || []).map(c => {
                    const skuInfo = safeSkus.find(s => s.sku === c.component_sku);
                    return (
                      <div key={c.component_sku} className="flex items-center justify-between text-[11px] bg-white border border-slate-100 rounded-lg px-3 py-1.5">
                        <span className="font-black text-slate-700 uppercase">{c.component_sku}</span>
                        <span className="text-slate-400">{skuInfo?.desc}</span>
                        <span className="font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">× {c.qty}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {kits.length === 0 && <div className="p-8 text-center text-slate-400"><Package className="w-12 h-12 mx-auto mb-2 opacity-50"/><p className="text-[10px] uppercase tracking-widest font-bold">No hay kits definidos</p></div>}
          </div>
        </div>
      </div>
      )}

      {/* SUB-TAB ÓRDENES DE ARMADO (v2) */}
      {kittingTab === 'ordenes' && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Crear orden */}
        <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8">
          <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center mb-1"><ClipboardCheck className="w-5 h-5 mr-2 text-indigo-500"/> Nueva orden de armado</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5">El ejecutivo crea la orden; el picker la arma</p>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase">Cliente *</label>
                <select value={ordForm.client_id} onChange={e=>{ setOrdForm({...ordForm, client_id:e.target.value, kit_sku:''}); setOrdSugeridos({}); }} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 bg-white">
                  <option value="">-- Seleccionar --</option>
                  {permittedClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase">Kit (receta) *</label>
                <select value={ordForm.kit_sku} disabled={!ordForm.client_id} onChange={e=>{ setOrdForm({...ordForm, kit_sku:e.target.value}); setOrdSugeridos({}); }} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 bg-white disabled:bg-slate-100">
                  <option value="">{ordForm.client_id ? '-- Seleccionar --' : '-- Elige cliente --'}</option>
                  {(kits||[]).filter(k=>k.client_id===ordForm.client_id && (k.components||[]).length>0).map(k=><option key={k.kit_sku} value={k.kit_sku}>{k.kit_sku}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase">Cantidad de kits *</label>
                <input type="number" min="1" value={ordForm.cantidad_kits} onChange={e=>setOrdForm({...ordForm, cantidad_kits:parseInt(e.target.value)||1})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500"/>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase">Notas</label>
                <input type="text" value={ordForm.notas} onChange={e=>setOrdForm({...ordForm, notas:e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder="Opcional"/>
              </div>
            </div>
            {/* Componentes + origen sugerido (opcional) */}
            {ordKit && (
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Componentes · origen sugerido <span className="text-slate-300 normal-case">(opcional, el picker confirma o ajusta)</span></p>
                <div className="space-y-2">
                  {(ordKit.components||[]).map(c=>{
                    const sug = ordSugeridos[c.component_sku] || {};
                    const setSug = (k,v)=>setOrdSugeridos(prev=>({...prev, [c.component_sku]: { ...(prev[c.component_sku]||{}), [k]:v }}));
                    return (
                      <div key={c.component_sku} className="flex items-center gap-2 flex-wrap text-[11px]">
                        <span className="font-black text-slate-700 w-32 truncate">{c.component_sku}</span>
                        <span className="text-slate-400">×{parseFloat(c.qty)} → {parseFloat(c.qty)*(parseInt(ordForm.cantidad_kits)||1)}</span>
                        <input value={sug.ubicacion||''} onChange={e=>setSug('ubicacion',e.target.value.toUpperCase())} placeholder="Ubicación" className="flex-1 min-w-[90px] border border-slate-200 rounded-lg px-2 py-1 font-bold outline-none focus:border-indigo-400 uppercase"/>
                        <input value={sug.lote||''} onChange={e=>setSug('lote',e.target.value)} placeholder="Lote" className="w-20 border border-slate-200 rounded-lg px-2 py-1 font-bold outline-none focus:border-indigo-400"/>
                        <input value={sug.serie||''} onChange={e=>setSug('serie',e.target.value)} placeholder="Serie" className="w-24 border border-slate-200 rounded-lg px-2 py-1 font-bold outline-none focus:border-indigo-400"/>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <button onClick={handleCreateOrden} disabled={creatingOrden || !ordForm.kit_sku} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 rounded-2xl uppercase text-xs tracking-widest shadow-lg shadow-indigo-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">{creatingOrden ? <Loader2 size={16} className="animate-spin"/> : <Plus size={16}/>} Crear orden (pendiente)</button>
          </div>
        </div>
        {/* Lista de órdenes */}
        <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 p-4 flex items-center justify-between">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Órdenes ({ordenesV2.length})</h3>
            <button onClick={loadOrdenesV2} className="text-slate-400 hover:text-indigo-600" title="Refrescar"><RefreshCcw size={14}/></button>
          </div>
          <div className="overflow-x-auto max-h-[60vh]">
            <table className="w-full text-left">
              <thead className="bg-slate-100 border-b border-slate-200 sticky top-0"><tr>
                <th className="p-3 text-[9px] font-black text-slate-400 uppercase pl-5">Orden / Kit</th>
                <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Cliente</th>
                <th className="p-3 text-[9px] font-black text-slate-400 uppercase text-center">Cant.</th>
                <th className="p-3 text-[9px] font-black text-slate-400 uppercase text-center">Estado</th>
                <th className="p-3 text-[9px] font-black text-slate-400 uppercase text-center pr-5">Acción</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {ordenesV2.map(o=>{
                  const est = o.estado==='pendiente' ? 'bg-amber-100 text-amber-700' : o.estado==='armado' ? 'bg-emerald-100 text-emerald-700' : o.estado==='desarmado' ? 'bg-slate-200 text-slate-600' : 'bg-red-100 text-red-700';
                  return (
                    <tr key={o.id} className="hover:bg-slate-50">
                      <td className="p-3 pl-5"><p className="text-xs font-black text-slate-800">{o.kit_sku}</p><p className="text-[9px] font-mono text-slate-400">{o.id}</p></td>
                      <td className="p-3 text-[10px] font-bold text-slate-500">{o.client_name||o.client_id}</td>
                      <td className="p-3 text-center text-sm font-black text-slate-700">{o.cantidad_kits}</td>
                      <td className="p-3 text-center"><span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full ${est}`}>{o.estado}</span></td>
                      <td className="p-3 text-center pr-5 whitespace-nowrap">
                        {o.estado==='pendiente' && <button onClick={()=>openArmar(o.id)} className="bg-indigo-600 hover:bg-indigo-700 text-white text-[9px] font-black uppercase px-3 py-1.5 rounded-lg mr-1">Armar</button>}
                        {o.estado==='armado' && <button onClick={()=>openDesarmar(o.id)} className="bg-rose-600 hover:bg-rose-700 text-white text-[9px] font-black uppercase px-3 py-1.5 rounded-lg mr-1">Desarmar</button>}
                        <button onClick={()=>openTrace(o.id)} className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-[9px] font-black uppercase px-3 py-1.5 rounded-lg">Ver</button>
                      </td>
                    </tr>
                  );
                })}
                {ordenesV2.length===0 && <tr><td colSpan={5} className="p-10 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">Sin órdenes</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      )}

      {/* Modal de ARMADO (picker) */}
      {armOrden && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={()=>setArmOrden(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col" onClick={e=>e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><Package size={18} className="text-indigo-500"/> Armar {armOrden.orden.cantidad_kits}× {armOrden.orden.kit_sku}</h3>
                <p className="text-[11px] font-bold text-slate-500">{armOrden.orden.client_name||armOrden.orden.client_id} · orden {armOrden.orden.id}</p>
              </div>
              <button onClick={()=>setArmOrden(null)} className="text-slate-400 hover:text-slate-700"><X size={18}/></button>
            </div>
            <div className="overflow-auto p-5 space-y-3">
              {(armOrden.receta||[]).map(r => {
                const c = { component_sku: r.component_sku, needed: parseFloat(r.qty_necesaria), lpns: r.lpns||[] };
                const sug = (armOrden.sugeridos||[]).filter(s => s.componente_sku === r.component_sku);
                const falta = parseFloat(r.disponible) < parseFloat(r.qty_necesaria);
                return (
                  <div key={r.component_sku} className="bg-slate-50 rounded-2xl p-3 border border-slate-200">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-black text-slate-700">{r.component_sku} <span className="text-slate-400 font-bold">{r.desc||''}</span></span>
                      <span className="text-[11px] font-bold text-slate-500">Necesario: <strong>{parseFloat(r.qty_necesaria)}</strong> · Disp: <strong className={falta?'text-red-600':'text-emerald-600'}>{parseFloat(r.disponible)}</strong></span>
                    </div>
                    {(r.requires_serial || r.requires_lot) && <p className="text-[9px] font-black uppercase mt-1 text-violet-600">{r.requires_serial?'requiere serie':''}{r.requires_serial&&r.requires_lot?' · ':''}{r.requires_lot?'requiere lote':''}</p>}
                    {sug.length>0 && <div className="flex flex-wrap gap-1 mt-1.5">{sug.map((s,i)=><span key={i} className="text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5">Sugerido: {s.ubicacion||'—'}{s.lote?` · L:${s.lote}`:''}{s.serie?` · S/N:${s.serie}`:''}</span>)}</div>}
                    {renderKitSourcePicker(c, armSources, setArmSources)}
                  </div>
                );
              })}
              {/* Destino del kit */}
              <div className="bg-white rounded-2xl border border-slate-200 p-3">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Destino del kit armado</p>
                <div className="flex items-center gap-2 flex-wrap text-[11px]">
                  <input value={armDest.ubicacion} onChange={e=>setArmDest({...armDest, ubicacion:e.target.value.toUpperCase()})} placeholder="Ubicación" className="flex-1 min-w-[110px] border border-slate-200 rounded-lg px-2 py-1.5 font-bold outline-none focus:border-indigo-400 uppercase"/>
                  <input value={armDest.lote} onChange={e=>setArmDest({...armDest, lote:e.target.value})} placeholder="Lote (si aplica)" className="w-28 border border-slate-200 rounded-lg px-2 py-1.5 font-bold outline-none focus:border-indigo-400"/>
                  <input value={armDest.serie} onChange={e=>setArmDest({...armDest, serie:e.target.value})} placeholder="Serie (si aplica)" className="w-28 border border-slate-200 rounded-lg px-2 py-1.5 font-bold outline-none focus:border-indigo-400"/>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-2">
              <button onClick={()=>setArmOrden(null)} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-black py-3 rounded-2xl uppercase text-[10px] tracking-widest">Cancelar</button>
              <button onClick={handleArmar} disabled={armBusy} className="flex-[2] bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 rounded-2xl uppercase text-[10px] tracking-widest disabled:opacity-50 flex items-center justify-center gap-2">{armBusy ? <Loader2 size={14} className="animate-spin"/> : <Package size={14}/>} Confirmar armado</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de TRAZABILIDAD */}
      {traceOrden && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={()=>setTraceOrden(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col" onClick={e=>e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><ClipboardCheck size={18} className="text-indigo-500"/> Trazabilidad · {traceOrden.orden.kit_sku}</h3>
                <p className="text-[11px] font-bold text-slate-500">{traceOrden.orden.client_name||traceOrden.orden.client_id} · {traceOrden.orden.cantidad_kits} kit(s) · estado <strong>{traceOrden.orden.estado}</strong> · orden {traceOrden.orden.id}</p>
              </div>
              <button onClick={()=>setTraceOrden(null)} className="text-slate-400 hover:text-slate-700"><X size={18}/></button>
            </div>
            <div className="overflow-auto p-5 space-y-4">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-[10px] font-bold text-slate-500">
                <span>Creó: <strong className="text-slate-700">{traceOrden.orden.usuario_creador||'—'}</strong></span>
                {traceOrden.orden.armado_por && <span>Armó: <strong className="text-slate-700">{traceOrden.orden.armado_por}</strong></span>}
                {traceOrden.orden.desarmado_por && <span>Desarmó: <strong className="text-slate-700">{traceOrden.orden.desarmado_por}</strong></span>}
                {(traceOrden.kit_stock||[]).map(k=><span key={k.id}>kit_stock: <strong className="text-slate-700">{k.estado}</strong> @ {k.ubicacion}</span>)}
              </div>
              {/* Origen FINAL consumido */}
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Componentes · origen de cada pieza</p>
                {(traceOrden.consumidos||[]).length===0 ? <p className="text-[11px] text-slate-400">Aún no armado (sin consumo registrado).</p> : (
                  <div className="overflow-x-auto border border-slate-100 rounded-2xl">
                    <table className="w-full text-left">
                      <thead className="bg-slate-100 border-b border-slate-200"><tr>
                        <th className="p-2.5 text-[9px] font-black text-slate-400 uppercase pl-4">Componente</th>
                        <th className="p-2.5 text-[9px] font-black text-slate-400 uppercase text-center">Cant.</th>
                        <th className="p-2.5 text-[9px] font-black text-slate-400 uppercase">Ubicación</th>
                        <th className="p-2.5 text-[9px] font-black text-slate-400 uppercase">Lote</th>
                        <th className="p-2.5 text-[9px] font-black text-slate-400 uppercase">Serie</th>
                        <th className="p-2.5 text-[9px] font-black text-slate-400 uppercase">LPN origen</th>
                        <th className="p-2.5 text-[9px] font-black text-slate-400 uppercase text-center pr-4">vs sug.</th>
                      </tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {traceOrden.consumidos.map(cc=>(
                          <tr key={cc.id} className="hover:bg-slate-50">
                            <td className="p-2.5 pl-4 text-[11px] font-black text-slate-700">{cc.componente_sku}</td>
                            <td className="p-2.5 text-center text-[11px] font-bold text-slate-600">{parseFloat(cc.cantidad)}</td>
                            <td className="p-2.5 text-[11px] text-slate-600">{cc.ubicacion||'—'}</td>
                            <td className="p-2.5 text-[11px] text-amber-600 font-bold">{cc.lote||'—'}</td>
                            <td className="p-2.5 text-[11px] text-violet-600 font-bold">{cc.serie||'—'}</td>
                            <td className="p-2.5 text-[10px] font-mono text-slate-400">{cc.lpn_origen||'—'}</td>
                            <td className="p-2.5 text-center pr-4">{cc.difiere_de_sugerido ? <span className="text-[8px] font-black bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded uppercase">Difiere</span> : <span className="text-[8px] font-black bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded uppercase">OK</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {/* Origen sugerido (referencia) */}
              {(traceOrden.sugeridos||[]).length>0 && (
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Origen sugerido (referencia del ejecutivo)</p>
                  <div className="flex flex-wrap gap-1">
                    {traceOrden.sugeridos.map((s,i)=><span key={i} className="text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5">{s.componente_sku}: {s.ubicacion||'—'}{s.lote?` · L:${s.lote}`:''}{s.serie?` · S/N:${s.serie}`:''}</span>)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de DESARMADO (ejecutivo) */}
      {desarmOrden && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={()=>setDesarmOrden(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col" onClick={e=>e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><AlertTriangle size={18} className="text-rose-500"/> Desarmar {desarmOrden.orden.kit_sku}</h3>
                <p className="text-[11px] font-bold text-slate-500">Se reintegran estos componentes a stock:</p>
              </div>
              <button onClick={()=>setDesarmOrden(null)} className="text-slate-400 hover:text-slate-700"><X size={18}/></button>
            </div>
            <div className="overflow-auto p-5 space-y-2">
              {(desarmOrden.consumidos||[]).map(cc => (
                <div key={cc.id} className="flex items-center justify-between text-[11px] bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                  <span className="font-black text-slate-700">{cc.componente_sku}</span>
                  <span className="text-slate-500">{parseFloat(cc.cantidad)} → <strong>{desarmDest || cc.ubicacion || 'PISO-RECEPCION'}</strong>{cc.lote?` · L:${cc.lote}`:''}{cc.serie?` · S/N:${cc.serie}`:''}</span>
                </div>
              ))}
              {(desarmOrden.consumidos||[]).length===0 && <p className="text-center text-slate-400 text-xs font-bold py-4">Sin componentes consumidos.</p>}
              <div className="pt-2">
                <label className="text-[9px] font-black text-slate-400 uppercase">Ubicación destino (opcional — si se omite, vuelve a su origen)</label>
                <input value={desarmDest} onChange={e=>setDesarmDest(e.target.value.toUpperCase())} placeholder="Ej: RACK-A (vacío = ubicación de origen)" className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-rose-400 uppercase mt-1"/>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-2">
              <button onClick={()=>setDesarmOrden(null)} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-black py-3 rounded-2xl uppercase text-[10px] tracking-widest">Cancelar</button>
              <button onClick={handleDesarmar} disabled={desarmBusy} className="flex-[2] bg-rose-600 hover:bg-rose-700 text-white font-black py-3 rounded-2xl uppercase text-[10px] tracking-widest disabled:opacity-50 flex items-center justify-center gap-2">{desarmBusy ? <Loader2 size={14} className="animate-spin"/> : <AlertTriangle size={14}/>} Confirmar desarmado</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
