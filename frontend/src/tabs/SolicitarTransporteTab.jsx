// Tab "Solicitar transporte" — lado BODEGA, Origen A (Fase 3).
//
// Lo usa el EJECUTIVO_CUENTA+ al preparar un despacho que requiere transporte.
// El ejecutivo elige el despacho (programación) e ingresa las líneas (SKU + cantidad);
// el backend CALCULA peso/volumen contra master_skus y marca dims_incompletas si
// algún SKU no tiene dimensiones. Llama a POST /transporte/solicitudes/desde-despacho
// (gate requireStockWrite). El coordinador la verá luego en su cola de solicitudes.

import React, { useState, useEffect, useCallback } from 'react';
import { Truck, Plus, Trash2, RefreshCcw, AlertTriangle, Send } from 'lucide-react';
import { apiFetch } from '../utils';

const api = (path, opts) => apiFetch(`/api${path}`, opts);
const send = (path, method, body) => api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const num = (v) => (v == null || v === '' ? 0 : Number(v));

export default function SolicitarTransporteTab({ showMsg = () => {} }) {
  const [despachos, setDespachos] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [recientes, setRecientes] = useState([]);
  const empty = {
    despacho_id: '', client_id: '', destino: '', sentido: 'SALIDA',
    n_cajas: '', n_cajones: '', n_pallets: '', tipo_vehiculo_sugerido: '',
    hora_carga_habilitada: '', fecha_hora_recepcion_destino: '',
  };
  const [form, setForm] = useState(empty);
  const [lineas, setLineas] = useState([{ sku: '', qty: '' }]);
  const [resultado, setResultado] = useState(null);
  const [busy, setBusy] = useState(false);

  const reloadRecientes = useCallback(() => {
    api('/transporte/solicitudes?origen=DESPACHO').then(r => r.json()).then(d => setRecientes(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  useEffect(() => {
    api('/dispatch-schedules').then(r => r.json()).then(d => setDespachos(Array.isArray(d) ? d.filter(x => x.status !== 'CERRADO') : [])).catch(() => {});
    api('/transporte/tipos-vehiculo').then(r => r.json()).then(d => setTipos(Array.isArray(d) ? d : [])).catch(() => {});
    reloadRecientes();
  }, [reloadRecientes]);

  // Al elegir un despacho, prefijar cliente y destino.
  const pickDespacho = (id) => {
    const d = despachos.find(x => x.id === id);
    setForm(f => ({ ...f, despacho_id: id, client_id: d?.client_id || f.client_id, destino: d?.destination || f.destino }));
  };

  const setLinea = (i, k, v) => setLineas(ls => ls.map((l, idx) => idx === i ? { ...l, [k]: v } : l));
  const addLinea = () => setLineas(ls => [...ls, { sku: '', qty: '' }]);
  const delLinea = (i) => setLineas(ls => ls.filter((_, idx) => idx !== i));

  const submit = async () => {
    const items = lineas.filter(l => l.sku && num(l.qty) > 0).map(l => ({ sku: l.sku.trim().toUpperCase(), qty: num(l.qty) }));
    if (!form.despacho_id && !form.client_id) return showMsg('Elija un despacho o indique el cliente', true);
    if (items.length === 0) return showMsg('Agregue al menos una línea (SKU + cantidad)', true);
    setBusy(true);
    try {
      const res = await send('/transporte/solicitudes/desde-despacho', 'POST', { ...form, items });
      const d = await res.json();
      if (!res.ok) { showMsg(d.error || 'Error', true); return; }
      setResultado(d);
      showMsg('Solicitud de transporte creada');
      setForm(empty); setLineas([{ sku: '', qty: '' }]);
      reloadRecientes();
    } catch (e) { showMsg('Error de red', true); }
    finally { setBusy(false); }
  };

  const inputCls = 'border-2 border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-cyan-500';

  return (
    <div className="space-y-6 animate-in fade-in max-w-5xl mx-auto">
      <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
        <Truck className="text-cyan-600" /> Solicitar transporte (desde despacho)
      </h1>
      <p className="text-xs text-slate-500">Para un despacho que requiere transporte: elige el despacho, ingresa las líneas y el sistema calcula peso y volumen. El coordinador la verá en su cola.</p>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="text-[9px] font-black text-slate-400 uppercase">Despacho programado</label>
            <select value={form.despacho_id} onChange={e => pickDespacho(e.target.value)} className={`${inputCls} w-full bg-white`}>
              <option value="">— Selecciona un despacho —</option>
              {despachos.map(d => <option key={d.id} value={d.id}>{d.doc_num} · {d.client_id || ''} · {d.destination || ''}{d.requiere_transporte ? ' (ya marcado)' : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[9px] font-black text-slate-400 uppercase">Cliente (si no hay despacho)</label>
            <input value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })} placeholder="ID cliente" className={`${inputCls} w-full`} />
          </div>
        </div>

        {/* Líneas */}
        <div>
          <div className="text-[10px] font-black text-slate-500 uppercase mb-1">Líneas del despacho (para calcular peso/volumen)</div>
          <div className="space-y-1.5">
            {lineas.map((l, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input value={l.sku} onChange={e => setLinea(i, 'sku', e.target.value)} placeholder="SKU" className={`${inputCls} flex-1 uppercase`} />
                <input type="number" value={l.qty} onChange={e => setLinea(i, 'qty', e.target.value)} placeholder="Cantidad" className={`${inputCls} w-32`} />
                <button onClick={() => delLinea(i)} className="text-rose-400 hover:text-rose-600"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <button onClick={addLinea} className="mt-1.5 text-cyan-600 hover:text-cyan-800 text-[10px] font-black uppercase flex items-center gap-1"><Plus size={12} /> Agregar línea</button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="text-[9px] font-black text-slate-400 uppercase">Destino</label><input value={form.destino} onChange={e => setForm({ ...form, destino: e.target.value })} className={`${inputCls} w-full`} /></div>
          <div><label className="text-[9px] font-black text-slate-400 uppercase">Sentido</label><select value={form.sentido} onChange={e => setForm({ ...form, sentido: e.target.value })} className={`${inputCls} w-full bg-white`}><option value="SALIDA">Salida</option><option value="REGRESO">Regreso</option></select></div>
          <div><label className="text-[9px] font-black text-slate-400 uppercase">Tipo vehículo sugerido</label><select value={form.tipo_vehiculo_sugerido} onChange={e => setForm({ ...form, tipo_vehiculo_sugerido: e.target.value })} className={`${inputCls} w-full bg-white`}><option value="">—</option>{tipos.map(t => <option key={t.id} value={t.nombre}>{t.nombre}</option>)}</select></div>
          <div><label className="text-[9px] font-black text-slate-400 uppercase">N° cajas</label><input type="number" value={form.n_cajas} onChange={e => setForm({ ...form, n_cajas: e.target.value })} className={`${inputCls} w-full`} /></div>
          <div><label className="text-[9px] font-black text-slate-400 uppercase">N° cajones</label><input type="number" value={form.n_cajones} onChange={e => setForm({ ...form, n_cajones: e.target.value })} className={`${inputCls} w-full`} /></div>
          <div><label className="text-[9px] font-black text-slate-400 uppercase">N° pallets</label><input type="number" value={form.n_pallets} onChange={e => setForm({ ...form, n_pallets: e.target.value })} className={`${inputCls} w-full`} /></div>
          <div><label className="text-[9px] font-black text-slate-400 uppercase">Hora carga habilitada</label><input type="datetime-local" value={form.hora_carga_habilitada} onChange={e => setForm({ ...form, hora_carga_habilitada: e.target.value })} className={`${inputCls} w-full`} /></div>
          <div><label className="text-[9px] font-black text-slate-400 uppercase">Recepción en destino</label><input type="datetime-local" value={form.fecha_hora_recepcion_destino} onChange={e => setForm({ ...form, fecha_hora_recepcion_destino: e.target.value })} className={`${inputCls} w-full`} /></div>
        </div>

        <button onClick={submit} disabled={busy} className="bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl px-5 py-2.5 text-[11px] font-black uppercase flex items-center gap-2"><Send size={14} /> Solicitar transporte</button>

        {resultado && (
          <div className={`rounded-xl p-3 ${resultado.dims_incompletas ? 'bg-amber-50 border border-amber-300' : 'bg-emerald-50 border border-emerald-200'}`}>
            <div className="text-[11px] font-bold text-slate-700">Calculado — Peso: <b>{num(resultado.peso_total).toLocaleString('es-CL')} kg</b> · Volumen: <b>{num(resultado.volumen_total).toLocaleString('es-CL')} m³</b></div>
            {resultado.aviso && <div className="flex items-center gap-1.5 text-amber-700 text-[11px] font-bold mt-1"><AlertTriangle size={13} /> {resultado.aviso}</div>}
          </div>
        )}
      </div>

      {/* Solicitudes recientes desde despacho */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b bg-slate-50 text-xs font-black text-slate-600 uppercase tracking-wider flex items-center justify-between">
          Solicitudes desde despacho ({recientes.length})
          <button onClick={reloadRecientes} className="text-cyan-600 hover:text-cyan-800"><RefreshCcw size={13} /></button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[9px] text-slate-400 uppercase"><tr>
              <th className="text-left px-4 py-2">Despacho</th><th className="text-left px-3 py-2">Cliente</th>
              <th className="text-right px-3 py-2">Peso / Vol.</th><th className="text-left px-3 py-2">Destino</th><th className="text-left px-3 py-2">Estado</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {recientes.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-6 font-bold">Sin solicitudes desde despacho.</td></tr>}
              {recientes.map(s => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-slate-600">{s.despacho_doc_num || '—'}</td>
                  <td className="px-3 py-2 text-slate-700">{s.cliente_nombre || s.client_id || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{num(s.peso_total).toLocaleString('es-CL')}kg / <span className={s.dims_incompletas ? 'text-rose-600 font-black' : ''}>{num(s.volumen_total).toLocaleString('es-CL')}m³{s.dims_incompletas ? ' ⚠' : ''}</span></td>
                  <td className="px-3 py-2 text-slate-600">{s.destino || '—'}</td>
                  <td className="px-3 py-2"><span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${s.estado === 'pendiente' ? 'bg-amber-100 text-amber-700' : s.estado === 'asignada' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>{s.estado}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
