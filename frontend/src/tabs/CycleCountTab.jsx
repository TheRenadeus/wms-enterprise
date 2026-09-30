// Tab "Conteo Físico" (conteos cíclicos) — lazy-loaded (COD-01 split).
// Componente de presentación: el estado y los handlers viven en App.js y se
// reciben como props, igual que ReturnsTab.

import React from 'react';
import { ClipboardCheck, RefreshCcw, Search, Plus, AlertTriangle } from 'lucide-react';

export default function CycleCountTab({
  cycleCountData, setCycleCountData,
  ccFilter, setCcFilter, ccBlind, setCcBlind,
  ccPreview, setCcPreview, ccPreviewLoading, setCcPreviewLoading,
  ccRejectModal, setCcRejectModal, ccRejectReason, setCcRejectReason,
  activeCycleCount, setActiveCycleCount, cycleLines, setCycleLines,
  ccAddLineForm, setCcAddLineForm, cycleCountedQtys, setCycleCountedQtys,
  clients, safeLocs, currentUser, showMsg, apiFetch, host, confirm, fetchData,
}) {
  return (
    <div className="space-y-6 animate-in fade-in max-w-5xl mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><ClipboardCheck className="text-cyan-500"/> Conteo Físico</h1>
        <button onClick={async()=>{ const r=await apiFetch(`${host}/api/cycle-count`); const d=await r.json(); setCycleCountData(Array.isArray(d)?d:[]); }} className="bg-cyan-100 hover:bg-cyan-200 text-cyan-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2"><RefreshCcw size={12}/> Cargar</button>
      </div>

      {/* ── Formulario nuevo conteo ── */}
      <div className="bg-white rounded-3xl border border-cyan-200 shadow-sm p-6 space-y-4">
        <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter border-b pb-3">Nuevo Conteo</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {clients.length > 0 && (
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Cliente</label>
              <select value={ccFilter.client_id} onChange={e=>{setCcFilter(f=>({...f,client_id:e.target.value}));setCcPreview(null);}} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-cyan-500 bg-white">
                <option value="">Todos</option>
                {clients.map(c=><option key={c.id} value={c.id}>{c.name||c.id}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">SKU (opcional)</label>
            <input value={ccFilter.sku} onChange={e=>{setCcFilter(f=>({...f,sku:e.target.value.toUpperCase()}));setCcPreview(null);}} placeholder="SKU exacto" className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold uppercase outline-none focus:border-cyan-500"/>
          </div>
          <div>
            <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Zona (opcional)</label>
            <select value={ccFilter.zone} onChange={e=>{setCcFilter(f=>({...f,zone:e.target.value}));setCcPreview(null);}} className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-cyan-500 bg-white">
              <option value="">Todas</option>
              {[...new Set(safeLocs.map(l=>l.zone_code).filter(Boolean))].map(z=><option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Ubicación puntual</label>
            <input value={ccFilter.location_id} onChange={e=>{setCcFilter(f=>({...f,location_id:e.target.value.toUpperCase()}));setCcPreview(null);}} placeholder="1-A-01-1" className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold uppercase outline-none focus:border-cyan-500"/>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 px-3 py-2 border-2 border-slate-200 rounded-xl cursor-pointer hover:border-cyan-300">
            <input type="checkbox" checked={ccBlind} onChange={e=>setCcBlind(e.target.checked)} className="rounded accent-cyan-600"/>
            <span className="text-xs font-black text-slate-600 uppercase">A ciegas</span>
          </label>
          <button onClick={async()=>{
            setCcPreviewLoading(true);setCcPreview(null);
            const r=await apiFetch(`${host}/api/cycle-count/preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({zone_code:ccFilter.zone||undefined,client_id:ccFilter.client_id||undefined,sku:ccFilter.sku||undefined,location_id:ccFilter.location_id||undefined})});
            setCcPreviewLoading(false);
            if(r.ok)setCcPreview(await r.json()); else showMsg('⛔ Error al previsualizar',true);
          }} disabled={ccPreviewLoading} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 disabled:opacity-50">
            <Search size={12}/> {ccPreviewLoading?'…':'Previsualizar'}
          </button>
          {ccPreview && <span className="text-xs font-bold text-cyan-700 bg-cyan-50 border border-cyan-200 px-3 py-1.5 rounded-xl">{ccPreview.lines} ubicaciones · {Number(ccPreview.total_units).toLocaleString('es-CL')} unidades</span>}
          <button onClick={async()=>{
            const body={username:currentUser.username,blind:ccBlind};
            if(ccFilter.zone)        body.zone_code=ccFilter.zone;
            if(ccFilter.client_id)   body.client_id=ccFilter.client_id;
            if(ccFilter.sku)         body.sku=ccFilter.sku;
            if(ccFilter.location_id) body.location_id=ccFilter.location_id;
            const res=await apiFetch(`${host}/api/cycle-count/create`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
            if(res.ok){const d=await res.json();showMsg(`✅ Conteo ${d.countId} creado — ${d.lines} líneas`);const r2=await apiFetch(`${host}/api/cycle-count`);setCycleCountData(await r2.json());setCcFilter({zone:'',client_id:'',sku:'',location_id:''});setCcPreview(null);}
            else{const e=await res.json().catch(()=>({}));showMsg(`⛔ ${e.error||'Error'}`,true);}
          }} className="bg-cyan-600 hover:bg-cyan-700 text-white px-6 py-2 rounded-xl text-[10px] font-black uppercase shadow-lg flex items-center gap-2 ml-auto">
            <Plus size={13}/> Crear conteo
          </button>
        </div>
      </div>

      {/* ── Modal rechazar ── */}
      {ccRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-96 shadow-2xl space-y-4">
            <h3 className="font-black text-slate-800 uppercase">Rechazar conteo</h3>
            <textarea value={ccRejectReason} onChange={e=>setCcRejectReason(e.target.value)} placeholder="Motivo del rechazo..." className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-red-400 h-24 resize-none"/>
            <div className="flex gap-2 justify-end">
              <button onClick={()=>{setCcRejectModal(null);setCcRejectReason('');}} className="px-4 py-2 text-[10px] font-black uppercase text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50">Cancelar</button>
              <button onClick={async()=>{
                const r=await apiFetch(`${host}/api/cycle-count/${ccRejectModal}/reject`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:currentUser.username,reason:ccRejectReason})});
                if(r.ok){showMsg('Conteo rechazado');const r2=await apiFetch(`${host}/api/cycle-count`);setCycleCountData(await r2.json());}
                else showMsg('⛔ Error',true);
                setCcRejectModal(null);setCcRejectReason('');
              }} className="px-4 py-2 text-[10px] font-black uppercase bg-red-600 hover:bg-red-700 text-white rounded-xl">Rechazar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Conteo activo ── */}
      {activeCycleCount ? (()=>{
        const isBlind=activeCycleCount.blind;
        const isCompleted=activeCycleCount.status==='COMPLETED';
        const isPendApproval=activeCycleCount.status==='PENDIENTE_APROBACION';
        const showExpected=!isBlind||isCompleted||isPendApproval;
        const canApprove=['JEFE_BODEGA','ADMIN','SUPERADMIN'].includes(currentUser?.role);
        const STATUS_BADGE={PENDING:'bg-slate-100 text-slate-600',EN_PROCESO:'bg-cyan-100 text-cyan-700',PENDIENTE_APROBACION:'bg-amber-100 text-amber-700',COMPLETED:'bg-emerald-100 text-emerald-700',RECHAZADO:'bg-red-100 text-red-700'};
        return (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-cyan-50 p-5 border-b border-cyan-200 flex justify-between items-start flex-wrap gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-black text-cyan-900 uppercase">{activeCycleCount.id}</h3>
                  {isBlind && <span className="text-[9px] bg-violet-100 text-violet-700 border border-violet-200 px-2 py-0.5 rounded font-black uppercase">A ciegas</span>}
                  <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${STATUS_BADGE[activeCycleCount.status]||'bg-slate-100 text-slate-600'}`}>{activeCycleCount.status}</span>
                </div>
                <p className="text-[10px] text-cyan-700 font-bold">{activeCycleCount.scope_label||activeCycleCount.zone_code} · {activeCycleCount.counted_lines}/{activeCycleCount.total_lines} contadas · {activeCycleCount.diff_lines||0} con diferencia</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {!isPendApproval && !isCompleted && <button onClick={()=>setCcAddLineForm({location_id:'',sku:'',qty:'',note:''})} className="bg-white border border-amber-200 text-amber-700 px-3 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1"><Plus size={11}/> Reportar hallazgo</button>}
                <button onClick={()=>{setActiveCycleCount(null);setCycleLines([]);setCcAddLineForm(null);}} className="bg-white border border-slate-200 text-slate-600 px-3 py-2 rounded-xl text-[10px] font-black uppercase">Cerrar</button>
                {!isPendApproval && !isCompleted && (
                  <button onClick={async()=>{
                    if(!(await confirm({message:'¿Enviar el conteo a aprobación? Si no hay diferencias, se completará directamente.',danger:false})))return;
                    const r=await apiFetch(`${host}/api/cycle-count/${activeCycleCount.id}/submit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:currentUser.username})});
                    const d=await r.json().catch(()=>({}));
                    if(r.ok){showMsg(d.requires_approval?'✅ Conteo enviado a aprobación':'✅ Conteo completado (sin diferencias)');const r2=await apiFetch(`${host}/api/cycle-count`);setCycleCountData(await r2.json());setActiveCycleCount(null);setCycleLines([]);}
                    else showMsg(`⛔ ${d.error||'Error'}`,true);
                  }} className="bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase shadow-md">Enviar a aprobación</button>
                )}
                {isPendApproval && canApprove && (<>
                  <button onClick={async()=>{
                    if(!(await confirm({message:'¿Aprobar y aplicar ajustes al inventario?',danger:true})))return;
                    const r=await apiFetch(`${host}/api/cycle-count/${activeCycleCount.id}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:currentUser.username})});
                    if(r.ok){showMsg('✅ Conteo aprobado y stock ajustado');const r2=await apiFetch(`${host}/api/cycle-count`);setCycleCountData(await r2.json());setActiveCycleCount(null);setCycleLines([]);fetchData();}
                    else{const e=await r.json().catch(()=>({}));showMsg(`⛔ ${e.error||'Error'}`,true);}
                  }} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase shadow-md">Aprobar</button>
                  <button onClick={()=>{setCcRejectModal(activeCycleCount.id);setCcRejectReason('');}} className="bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 px-4 py-2 rounded-xl text-[10px] font-black uppercase">Rechazar</button>
                </>)}
              </div>
            </div>

            {/* Hallazgo form */}
            {ccAddLineForm && (
              <div className="bg-amber-50 border-b border-amber-200 p-4 flex gap-3 flex-wrap items-end">
                {[{label:'Ubicación',key:'location_id',ph:'1-A-01-1',w:'w-36',up:true},{label:'SKU',key:'sku',ph:'SKU',w:'w-36',up:true},{label:'Cantidad',key:'qty',ph:'0',w:'w-24',type:'number'},{label:'Nota',key:'note',ph:'Detalle...',w:'w-44'}].map(f=>(
                  <div key={f.key}>
                    <p className="text-[9px] font-black text-amber-700 uppercase mb-1">{f.label}</p>
                    <input type={f.type||'text'} min={f.type==='number'?0:undefined} step={f.type==='number'?'0.01':undefined}
                      value={ccAddLineForm[f.key]} onChange={e=>setCcAddLineForm(p=>({...p,[f.key]:f.up?e.target.value.toUpperCase():e.target.value}))}
                      placeholder={f.ph} className={`border border-amber-300 rounded-lg px-3 py-2 text-xs font-black outline-none focus:border-amber-500 bg-white ${f.w}`}/>
                  </div>
                ))}
                <button onClick={async()=>{
                  if(!ccAddLineForm.location_id||!ccAddLineForm.sku){showMsg('⛔ Ubicación y SKU requeridos',true);return;}
                  const r=await apiFetch(`${host}/api/cycle-count/${activeCycleCount.id}/add-line`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location_id:ccAddLineForm.location_id,sku:ccAddLineForm.sku,counted_qty:parseFloat(ccAddLineForm.qty)||0,note:ccAddLineForm.note,username:currentUser.username})});
                  if(r.ok){const d=await r.json();setCycleLines(d.lines);setCcAddLineForm(null);showMsg('✅ Hallazgo registrado');}
                  else showMsg('⛔ Error',true);
                }} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase">Guardar</button>
                <button onClick={()=>setCcAddLineForm(null)} className="text-slate-500 text-[9px] font-black uppercase px-3 py-2">Cancelar</button>
              </div>
            )}

            {cycleLines.length===0 ? (
              <div className="p-10 text-center space-y-3">
                <ClipboardCheck className="w-10 h-10 mx-auto text-slate-300"/>
                <p className="font-black text-slate-500 text-sm">No hay ubicaciones con stock para el alcance <strong>'{activeCycleCount.scope_label||activeCycleCount.zone_code}'</strong>.</p>
                <p className="text-[11px] text-slate-400">Verifica que las ubicaciones tengan zone_code asignado en el maestro, o reporta un hallazgo manualmente.</p>
                <button onClick={()=>setCcAddLineForm({location_id:'',sku:'',qty:'',note:''})} className="bg-amber-100 hover:bg-amber-200 text-amber-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 mx-auto"><Plus size={11}/> Reportar hallazgo</button>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Ubicación</th>
                      <th className="p-3 text-[9px] font-black text-slate-400 uppercase">SKU</th>
                      {showExpected && <th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Esperado</th>}
                      <th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Contado</th>
                      <th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Diferencia</th>
                      <th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cycleLines.map(line=>(
                      <tr key={line.id} className={`hover:bg-slate-50 ${line.status==='COUNTED'?(parseFloat(line.difference)!==0?'bg-red-50':'bg-emerald-50/50'):''} ${line.line_type==='ENCONTRADO'?'bg-amber-50/60':''}`}>
                        <td className="p-3 font-mono text-[10px] font-bold text-slate-600">{line.location_id}</td>
                        <td className="p-3 text-xs font-black text-slate-800 uppercase">
                          {line.sku}
                          {line.line_type==='ENCONTRADO' && <span className="ml-1 text-[8px] bg-amber-200 text-amber-700 px-1.5 py-0.5 rounded font-black">HALLAZGO</span>}
                          {line.note && <span className="ml-1 text-[8px] text-slate-400" title={line.note}>📝</span>}
                        </td>
                        {showExpected && <td className="p-3 text-center font-black text-slate-700">{line.expected_qty??'—'}</td>}
                        <td className="p-3 text-center">
                          {line.status==='COUNTED'||isPendApproval
                            ? <span className="font-black text-slate-800">{line.counted_qty??'—'}</span>
                            : <input type="number" min="0" step="0.01" value={cycleCountedQtys[line.id]||''} onChange={e=>setCycleCountedQtys(p=>({...p,[line.id]:e.target.value}))} className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-center text-xs font-black outline-none focus:border-cyan-500" placeholder="0"/>}
                        </td>
                        <td className="p-3 text-center">
                          {(line.status==='COUNTED'||isPendApproval) && <span className={`font-black text-sm ${parseFloat(line.difference)>0?'text-emerald-600':parseFloat(line.difference)<0?'text-red-600':'text-slate-400'}`}>{parseFloat(line.difference)>0?'+':''}{line.difference}</span>}
                        </td>
                        <td className="p-3 text-center">
                          {line.status!=='COUNTED'&&!isPendApproval && <button onClick={async()=>{
                            const qty=cycleCountedQtys[line.id]; if(qty===undefined||qty==='')return;
                            const r=await apiFetch(`${host}/api/cycle-count/${activeCycleCount.id}/count`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lineId:line.id,counted_qty:parseFloat(qty),username:currentUser.username})});
                            if(r.ok){const r2=await apiFetch(`${host}/api/cycle-count/${activeCycleCount.id}/lines`);const d=await r2.json();setCycleLines(d.lines||d);const upd=cycleCountData.map(c=>c.id===activeCycleCount.id?{...c,counted_lines:(c.counted_lines||0)+1}:c);setCycleCountData(upd);setActiveCycleCount(p=>({...p,counted_lines:(p.counted_lines||0)+1}));}
                          }} className="bg-cyan-100 hover:bg-cyan-200 text-cyan-700 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase">Registrar</button>}
                          {line.status==='COUNTED' && <span className="text-[8px] bg-emerald-100 text-emerald-700 px-2 py-1 rounded font-black uppercase">✓</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })() : (
        <>
          {/* Bandeja de aprobación */}
          {['JEFE_BODEGA','ADMIN','SUPERADMIN'].includes(currentUser?.role) && cycleCountData.some(c=>c.status==='PENDIENTE_APROBACION') && (
            <div className="space-y-3">
              <h3 className="text-xs font-black text-amber-700 uppercase flex items-center gap-2"><AlertTriangle size={14}/> Pendientes de aprobación</h3>
              {cycleCountData.filter(c=>c.status==='PENDIENTE_APROBACION').map(cc=>(
                <div key={cc.id} className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 flex justify-between items-center flex-wrap gap-3">
                  <div>
                    <p className="text-xs font-black text-amber-900 uppercase">{cc.id}</p>
                    <p className="text-[10px] text-amber-700">{cc.scope_label||cc.zone_code} · {cc.diff_lines} líneas con diferencia · Creado por {cc.created_by}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={async()=>{setActiveCycleCount(cc);const r=await apiFetch(`${host}/api/cycle-count/${cc.id}/lines`);const d=await r.json();setCycleLines(d.lines||d);}} className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-2 rounded-xl text-[9px] font-black uppercase">Ver detalle</button>
                    <button onClick={async()=>{
                      if(!(await confirm({message:'¿Aprobar y aplicar ajustes al inventario?',danger:true})))return;
                      const r=await apiFetch(`${host}/api/cycle-count/${cc.id}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:currentUser.username})});
                      if(r.ok){showMsg('✅ Aprobado y stock ajustado');const r2=await apiFetch(`${host}/api/cycle-count`);setCycleCountData(await r2.json());fetchData();}
                      else{const e=await r.json().catch(()=>({}));showMsg(`⛔ ${e.error||'Error'}`,true);}
                    }} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-xl text-[9px] font-black uppercase">Aprobar</button>
                    <button onClick={()=>{setCcRejectModal(cc.id);setCcRejectReason('');}} className="bg-white border border-red-200 text-red-600 px-3 py-2 rounded-xl text-[9px] font-black uppercase hover:bg-red-50">Rechazar</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Lista de conteos */}
          {cycleCountData.length > 0 && (()=>{
            const STATUS_BADGE={PENDING:'bg-slate-100 text-slate-600',EN_PROCESO:'bg-cyan-100 text-cyan-700',PENDIENTE_APROBACION:'bg-amber-100 text-amber-700',COMPLETED:'bg-emerald-100 text-emerald-700',RECHAZADO:'bg-red-100 text-red-700',REVISION:'bg-orange-100 text-orange-700'};
            const openable=['PENDING','EN_PROCESO','PENDIENTE_APROBACION'];
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cycleCountData.map(cc=>(
                  <div key={cc.id} className={`bg-white p-5 rounded-2xl border shadow-sm flex flex-col ${cc.status==='COMPLETED'?'border-emerald-200':cc.status==='RECHAZADO'?'border-red-200':cc.status==='PENDIENTE_APROBACION'?'border-amber-200':'border-cyan-200'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-black text-slate-800 uppercase">{cc.id}</p>
                          {cc.blind && <span className="text-[8px] bg-violet-100 text-violet-600 border border-violet-200 px-1.5 rounded font-black uppercase">A ciegas</span>}
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded uppercase ${STATUS_BADGE[cc.status]||'bg-slate-100 text-slate-600'}`}>{cc.status}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-0.5">{cc.scope_label||cc.zone_code} · {cc.counted_lines}/{cc.total_lines} líneas{cc.diff_lines>0?` · ${cc.diff_lines} dif.`:''}</p>
                      </div>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5 mb-3"><div className={`h-1.5 rounded-full ${cc.status==='COMPLETED'?'bg-emerald-500':cc.status==='RECHAZADO'?'bg-red-400':'bg-cyan-500'}`} style={{width:`${cc.total_lines>0?(cc.counted_lines/cc.total_lines)*100:0}%`}}></div></div>
                    {openable.includes(cc.status) && <button onClick={async()=>{setActiveCycleCount(cc);const r=await apiFetch(`${host}/api/cycle-count/${cc.id}/lines`);const d=await r.json();setCycleLines(d.lines||d);}} className="mt-auto w-full bg-cyan-100 hover:bg-cyan-200 text-cyan-700 py-2 rounded-xl text-[10px] font-black uppercase">{cc.status==='PENDIENTE_APROBACION'?'Ver / Aprobar':'Abrir y Contar'}</button>}
                  </div>
                ))}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
