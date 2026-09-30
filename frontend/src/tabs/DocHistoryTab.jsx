// Tab "Historial de Documentos" (+ solicitudes de anulación) — lazy-loaded (COD-01 split).
// Componente de presentación: el estado y los handlers viven en App.js y se
// reciben como props, igual que ReturnsTab.

import React from 'react';
import {
  History, XCircle, Search, Download, ArrowLeft, CheckCircle2, X,
  ArrowDownRight, ArrowUpRight, ClipboardCheck, ChevronRight,
} from 'lucide-react';

export default function DocHistoryTab({
  anulHistoryTab, setAnulHistoryTab,
  anulationRequests, setAnulationRequests,
  docHistoryModule, setDocHistoryModule,
  docHistorySearch, setDocHistorySearch,
  docHistoryDateFrom, setDocHistoryDateFrom,
  docHistoryDateTo, setDocHistoryDateTo,
  docHistoryPage, setDocHistoryPage,
  docHistory, setDocHistory,
  expandedHistoryDoc, setExpandedHistoryDoc,
  voidModal, setVoidModal, voidReason, setVoidReason,
  currentUser, showMsg, apiFetch, host, confirm, prompt, exportToExcel, fetchData,
}) {
  return (
    <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><History className="text-slate-500"/> Historial de Documentos</h1>
        <div className="flex gap-2">
          {['ADMIN','SUPERADMIN'].includes(currentUser?.role) && (
            <button onClick={async()=>{ const r=await apiFetch(`${host}/api/anulation-requests?status=PENDIENTE`); if(r.ok){const d=await r.json();setAnulationRequests(d);} setAnulHistoryTab('requests'); }} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 transition-colors ${anulHistoryTab==='requests'?'bg-red-600 text-white shadow-md':'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'}`}>
              <XCircle size={12}/> Solicitudes Anulación
              {anulationRequests.filter(r=>r.status==='PENDIENTE').length > 0 && <span className="bg-white text-red-600 px-1.5 rounded-full text-[8px] font-black">{anulationRequests.filter(r=>r.status==='PENDIENTE').length}</span>}
            </button>
          )}
          <button onClick={async()=>{ setAnulHistoryTab('docs'); setDocHistoryPage(0); const params=new URLSearchParams(); if(docHistoryModule) params.append('module',docHistoryModule); if(docHistorySearch) params.append('search',docHistorySearch); if(docHistoryDateFrom) params.append('date_from',docHistoryDateFrom); if(docHistoryDateTo) params.append('date_to',docHistoryDateTo); const res=await apiFetch(`${host}/api/document-history?${params}`); const d=await res.json(); setDocHistory(Array.isArray(d)?d:[]); }} className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 shadow-sm"><Search size={12}/> Buscar</button>
          {docHistory.length > 0 && <button onClick={()=> exportToExcel(docHistory,[{key:'created_at',header:'Fecha',format:'date'},{key:'module',header:'Módulo',format:'text'},{key:'doc_type',header:'Tipo Doc',format:'text'},{key:'doc_num',header:'N° Documento',format:'text'},{key:'glosa',header:'Glosa',format:'text'},{key:'username',header:'Usuario',format:'text'},{key:'total_qty',header:'Cantidad Total',format:'number'},{key:'status',header:'Estado',format:'text'},{key:'client_id',header:'Cliente ID',format:'text'}],`historial-docs${docHistoryModule?'_'+docHistoryModule:''}_${new Date().toISOString().slice(0,10)}`,'Historial')} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2"><Download size={12}/> Excel</button>}
        </div>
      </div>

      {/* ── SOLICITUDES DE ANULACIÓN (solo admins) ── */}
      {anulHistoryTab === 'requests' && ['ADMIN','SUPERADMIN'].includes(currentUser?.role) && (
        <div className="space-y-3">
          <div className="flex gap-2 items-center">
            {['PENDIENTE','APROBADA','RECHAZADA'].map(s=>(
              <button key={s} onClick={async()=>{ const r=await apiFetch(`${host}/api/anulation-requests?status=${s}`); if(r.ok){const d=await r.json();setAnulationRequests(d);} }} className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border transition-colors ${s==='PENDIENTE'?'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100':s==='APROBADA'?'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100':'bg-red-50 border-red-300 text-red-700 hover:bg-red-100'}`}>{s}</button>
            ))}
            <button onClick={()=>setAnulHistoryTab('docs')} className="ml-auto text-slate-400 hover:text-slate-700 text-[10px] font-black uppercase flex items-center gap-1"><ArrowLeft size={12}/> Volver al historial</button>
          </div>
          {anulationRequests.length === 0 && <div className="bg-slate-100 border-2 border-dashed border-slate-300 rounded-3xl p-12 text-center text-slate-400"><XCircle className="w-10 h-10 mx-auto mb-2 opacity-40"/><p className="font-black uppercase text-xs">Sin solicitudes</p></div>}
          {anulationRequests.map(req => (
            <div key={req.id} className={`bg-white rounded-2xl border-2 shadow-sm p-5 ${req.status==='PENDIENTE'?'border-amber-200':req.status==='APROBADA'?'border-emerald-200':'border-red-200'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${req.status==='PENDIENTE'?'bg-amber-100 text-amber-700':req.status==='APROBADA'?'bg-emerald-100 text-emerald-700':'bg-red-100 text-red-700'}`}>{req.status}</span>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded border ${req.module==='receive'?'bg-emerald-50 text-emerald-700 border-emerald-200':'bg-blue-50 text-blue-700 border-blue-200'}`}>{req.module==='receive'?'RECEPCIÓN':'DESPACHO'}</span>
                  </div>
                  <p className="text-sm font-black text-slate-800 uppercase">{req.doc_type ? `[${req.doc_type}]` : ''} {req.doc_num}</p>
                  <p className="text-xs text-slate-600 mt-1">Motivo: <span className="font-bold">"{req.reason}"</span></p>
                  <p className="text-[10px] text-slate-400 mt-1">Solicitado por <strong>{req.requested_by}</strong> · {new Date(req.created_at).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})}</p>
                  {req.authorized_by && <p className="text-[10px] text-slate-400">Procesado por <strong>{req.authorized_by}</strong> · {req.resolved_at && new Date(req.resolved_at).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})}</p>}
                  {req.reject_reason && <p className="text-[10px] text-red-500 mt-1">Rechazo: "{req.reject_reason}"</p>}
                </div>
                {req.status === 'PENDIENTE' && (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={async()=>{
                      if(!(await confirm({ message: `¿Aprobar la anulación del documento ${req.doc_num}?\nEsto revertirá el stock.`, danger: true }))) return;
                      const r=await apiFetch(`${host}/api/anulation-requests/${req.id}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
                      if(r.ok){showMsg('✅ Anulación aprobada y stock revertido');const d=await apiFetch(`${host}/api/anulation-requests?status=PENDIENTE`);if(d.ok)setAnulationRequests(await d.json());fetchData();}
                      else{const e=await r.json();showMsg(`⛔ ${e.error}`,true);}
                    }} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1.5 transition-colors">
                      <CheckCircle2 size={12}/> Aprobar
                    </button>
                    <button onClick={async()=>{
                      const motivo=(await prompt({ message: 'Motivo del rechazo (opcional):' }));
                      if(motivo===null) return;
                      const r=await apiFetch(`${host}/api/anulation-requests/${req.id}/reject`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reject_reason:motivo})});
                      if(r.ok){showMsg('Solicitud rechazada');const d=await apiFetch(`${host}/api/anulation-requests?status=PENDIENTE`);if(d.ok)setAnulationRequests(await d.json());}
                      else{const e=await r.json();showMsg(`⛔ ${e.error}`,true);}
                    }} className="bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1.5 transition-colors border border-red-200">
                      <X size={12}/> Rechazar
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── HISTORIAL DE DOCUMENTOS ── */}
      {anulHistoryTab === 'docs' && (
        <>
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <select value={docHistoryModule} onChange={e=>setDocHistoryModule(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white text-slate-700 uppercase">
                <option value="">Todos los módulos</option>
                <option value="receive">Recepciones</option>
                <option value="dispatch">Despachos</option>
                <option value="adjust">Ajustes</option>
              </select>
              <input type="text" placeholder="🔍 N° doc, glosa, usuario..." value={docHistorySearch} onChange={e=>setDocHistorySearch(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none text-slate-700"/>
              <input type="date" value={docHistoryDateFrom} onChange={e=>setDocHistoryDateFrom(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white text-slate-700" title="Desde"/>
              <input type="date" value={docHistoryDateTo} onChange={e=>setDocHistoryDateTo(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none bg-white text-slate-700" title="Hasta"/>
            </div>
          </div>
          {/* Paginación historial de documentos */}
          {docHistory.length > 0 && (() => {
            const DH_PAGE_SIZE = 50;
            const totalPages = Math.ceil(docHistory.length / DH_PAGE_SIZE);
            return totalPages > 1 ? (
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-slate-400 uppercase">{docHistory.length} documentos — página {docHistoryPage + 1} de {totalPages}</p>
                <div className="flex gap-2">
                  <button disabled={docHistoryPage === 0} onClick={() => setDocHistoryPage(p => p - 1)} className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">← Anterior</button>
                  <button disabled={docHistoryPage >= totalPages - 1} onClick={() => setDocHistoryPage(p => p + 1)} className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">Siguiente →</button>
                </div>
              </div>
            ) : null;
          })()}
          <div className="space-y-3">
            {docHistory.slice(docHistoryPage * 50, (docHistoryPage + 1) * 50).map(doc => {
              const isVoided = doc.status === 'ANULADO';
              const canVoid = ['receive','dispatch'].includes(doc.module) && !isVoided;
              const isAdmin = ['ADMIN','SUPERADMIN'].includes(currentUser?.role);
              return (
                <div key={doc.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${isVoided?'border-red-200 opacity-70':'border-slate-200'}`}>
                  <div className="flex items-center justify-between p-5 cursor-pointer hover:bg-slate-50" onClick={() => setExpandedHistoryDoc(expandedHistoryDoc===doc.id ? null : doc.id)}>
                    <div className="flex items-center gap-4">
                      <div className={`p-2.5 rounded-xl ${isVoided?'bg-red-100 text-red-400':doc.module==='receive'?'bg-emerald-100 text-emerald-600':doc.module==='dispatch'?'bg-blue-100 text-blue-600':'bg-amber-100 text-amber-600'}`}>
                        {isVoided?<XCircle size={16}/>:doc.module==='receive'?<ArrowDownRight size={16}/>:doc.module==='dispatch'?<ArrowUpRight size={16}/>:<ClipboardCheck size={16}/>}
                      </div>
                      <div>
                        <p className={`text-sm font-black uppercase flex items-center gap-2 ${isVoided?'text-red-400 line-through':'text-slate-800'}`}>
                          [{doc.doc_type||doc.module.toUpperCase()}] {doc.doc_num}
                          {isVoided
                            ? <span className="text-[9px] px-2 py-0.5 rounded font-black bg-red-100 text-red-600 no-underline" style={{textDecoration:'none'}}>ANULADO</span>
                            : <span className={`text-[9px] px-2 py-0.5 rounded font-black ${doc.module==='receive'?'bg-emerald-100 text-emerald-700':doc.module==='dispatch'?'bg-blue-100 text-blue-700':'bg-amber-100 text-amber-700'}`}>{doc.module==='receive'?'RECEPCIÓN':doc.module==='dispatch'?'DESPACHO':'AJUSTE'}</span>
                          }
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                          <span>👤 {doc.username}</span><span>·</span>
                          <span>{new Date(doc.created_at).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})}</span>
                          {doc.glosa && <span>· "{doc.glosa}"</span>}
                          {doc.doc_ref && <span>· Ref: <strong>{doc.doc_ref}</strong></span>}
                          {doc.doc_date && <span>· 📅 {doc.doc_date}</span>}
                        </p>
                        {isVoided && <p className="text-[9px] text-red-500 font-bold mt-0.5">Anulado por {doc.voided_by} · Motivo: "{doc.void_reason}"</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className={`text-lg font-black ${isVoided?'text-red-400':'text-slate-800'}`}>{Number(doc.total_qty).toLocaleString()}</p>
                        <p className="text-[9px] text-slate-400 uppercase font-bold">unidades</p>
                      </div>
                      {canVoid && (
                        <button onClick={e=>{e.stopPropagation();setVoidModal({doc});setVoidReason('');}} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase flex items-center gap-1 transition-colors">
                          <XCircle size={11}/> {isAdmin?'Anular':'Solicitar Anulación'}
                        </button>
                      )}
                      <ChevronRight size={16} className={`text-slate-400 transition-transform ${expandedHistoryDoc===doc.id?'rotate-90':''}`}/>
                    </div>
                  </div>
                  {expandedHistoryDoc === doc.id && (
                    <div className="border-t border-slate-100 bg-slate-50 p-4">
                      <table className="w-full text-left">
                        <thead><tr><th className="p-2 text-[9px] font-black text-slate-400 uppercase">SKU</th><th className="p-2 text-[9px] font-black text-slate-400 uppercase">Descripción</th><th className="p-2 text-center text-[9px] font-black text-slate-400 uppercase">Cantidad</th><th className="p-2 text-[9px] font-black text-slate-400 uppercase">Detalle</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {JSON.parse(doc.items_json||'[]').map((item,i) => (
                            <tr key={i} className="bg-white hover:bg-slate-50">
                              <td className="p-2 text-xs font-black text-slate-800 uppercase">{item.sku}</td>
                              <td className="p-2 text-[10px] text-slate-500 truncate max-w-[200px]">{item.desc||'-'}</td>
                              <td className="p-2 text-center font-black text-slate-700">{item.qty||item.qtyToPick||'-'}</td>
                              <td className="p-2 text-[9px] text-slate-400">{item.location_id||item.lpnId||'-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
            {docHistory.length === 0 && <div className="bg-slate-100 border-2 border-dashed border-slate-300 rounded-3xl p-16 text-center text-slate-400"><History className="w-12 h-12 mx-auto mb-3 opacity-50"/><p className="font-black uppercase tracking-widest text-xs">Usa los filtros y presiona Buscar</p></div>}
          </div>
        </>
      )}

      {/* ── MODAL DE ANULACIÓN ── */}
      {voidModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={e=>{if(e.target===e.currentTarget)setVoidModal(null);}}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md">
            <div className="bg-red-600 rounded-t-3xl px-6 py-5 flex items-center justify-between">
              <div>
                <p className="text-white font-black uppercase tracking-tight flex items-center gap-2"><XCircle size={18}/> {['ADMIN','SUPERADMIN'].includes(currentUser?.role)?'Anular Documento':'Solicitar Anulación'}</p>
                <p className="text-red-200 text-[11px] mt-0.5 uppercase font-bold">[{voidModal.doc.doc_type||voidModal.doc.module}] {voidModal.doc.doc_num}</p>
              </div>
              <button onClick={()=>setVoidModal(null)} className="text-white/70 hover:text-white"><X size={18}/></button>
            </div>
            <div className="p-6 space-y-4">
              {!['ADMIN','SUPERADMIN'].includes(currentUser?.role) && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-[11px] text-amber-800 font-bold">
                  ⚠️ No tienes permisos para anular directamente. Se enviará una solicitud a un administrador para su aprobación.
                </div>
              )}
              {['ADMIN','SUPERADMIN'].includes(currentUser?.role) && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-[11px] text-red-800 font-bold">
                  ⚠️ Esta acción {voidModal.doc.module==='receive'?'eliminará los LPNs creados en esta recepción':'restaurará las cantidades despachadas al inventario'}. No se puede deshacer.
                </div>
              )}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Motivo de la anulación *</label>
                <textarea rows={3} value={voidReason} onChange={e=>setVoidReason(e.target.value)} placeholder="Describe el motivo de la anulación..." className="w-full border-2 border-slate-200 focus:border-red-400 rounded-xl px-4 py-3 text-sm font-medium outline-none resize-none"/>
              </div>
              <div className="flex gap-3">
                <button onClick={()=>setVoidModal(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl py-3 font-black uppercase text-[10px] transition-colors">Cancelar</button>
                <button disabled={!voidReason.trim()} onClick={async()=>{
                  const isAdmin = ['ADMIN','SUPERADMIN'].includes(currentUser?.role);
                  const endpoint = isAdmin
                    ? `${host}/api/document-history/${voidModal.doc.id}/void`
                    : `${host}/api/document-history/${voidModal.doc.id}/void-request`;
                  const r = await apiFetch(endpoint, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reason:voidReason.trim()})});
                  if(r.ok){
                    showMsg(isAdmin?'✅ Documento anulado y stock revertido':'✅ Solicitud enviada al administrador');
                    setVoidModal(null);
                    // Refrescar historial
                    const params=new URLSearchParams(); if(docHistoryModule) params.append('module',docHistoryModule); if(docHistorySearch) params.append('search',docHistorySearch); if(docHistoryDateFrom) params.append('date_from',docHistoryDateFrom); if(docHistoryDateTo) params.append('date_to',docHistoryDateTo);
                    const res=await apiFetch(`${host}/api/document-history?${params}`); const d=await res.json(); setDocHistory(Array.isArray(d)?d:[]);
                    if(isAdmin) fetchData();
                  } else {const e=await r.json();showMsg(`⛔ ${e.error}`,true);}
                }} className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-xl py-3 font-black uppercase text-[10px] transition-colors flex items-center justify-center gap-2">
                  <XCircle size={14}/> {['ADMIN','SUPERADMIN'].includes(currentUser?.role)?'Anular Ahora':'Enviar Solicitud'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
