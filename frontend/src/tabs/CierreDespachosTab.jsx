// Tab "Cierre de despachos (transporte)" — lado BODEGA (Fase 7).
//
// Visible para EJECUTIVO_CUENTA+ (stock-writers). Muestra los despachos de Origen A
// gestionados por transporte y permite el cierre MANUAL tras revisar el POD. El
// despacho solo se cierra cuando transporte confirmó el POD de su parada
// (status='habilitado_para_cierre'); de lo contrario el backend responde 409.

import React, { useState, useEffect, useCallback } from 'react';
import { Truck, RefreshCcw, CheckCircle, Clock, Lock, PackageCheck } from 'lucide-react';
import { apiFetch } from '../utils';
import { useConfirm } from '../useConfirm';
import { AvisosView } from './TransporteTab';

const api = (path, opts) => apiFetch(`/api${path}`, opts);

const statusBadge = (s) => {
  const m = {
    en_transito: ['En tránsito', 'bg-violet-100 text-violet-700', Clock],
    habilitado_para_cierre: ['Habilitado para cierre', 'bg-amber-100 text-amber-700', CheckCircle],
    CERRADO: ['Cerrado', 'bg-emerald-100 text-emerald-700', Lock],
  };
  const [label, cls, Icon] = m[s] || [s, 'bg-slate-100 text-slate-600', Clock];
  return <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${cls}`}><Icon size={11} /> {label}</span>;
};

// Tab "Transporte (bodega)": cierre de despachos por POD + avisos de llegada inbound.
export default function CierreDespachosTab({ showMsg = () => {}, currentUser }) {
  const [section, setSection] = useState('cierre');
  const canWrite = ['EJECUTIVO_CUENTA', 'JEFE_BODEGA', 'ADMIN', 'SUPERADMIN'].includes(currentUser?.role);
  return (
    <div className="space-y-6 animate-in fade-in max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
          <Truck className="text-teal-600" /> Transporte (bodega)
        </h1>
        <div className="flex bg-slate-100 rounded-2xl p-1 gap-1">
          {[['cierre', 'Cierre despachos', Lock], ['avisos', 'Avisos de llegada', PackageCheck]].map(([id, label, Icon]) => (
            <button key={id} onClick={() => setSection(id)} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-black uppercase transition-colors ${section === id ? 'bg-white shadow text-teal-700' : 'text-slate-500 hover:text-slate-700'}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </div>
      {section === 'cierre' && <CierrePanel showMsg={showMsg} />}
      {section === 'avisos' && <AvisosView showMsg={showMsg} canWrite={canWrite} soloLectura />}
    </div>
  );
}

function CierrePanel({ showMsg = () => {} }) {
  const { confirm } = useConfirm();
  const [items, setItems] = useState([]);
  const [asignadas, setAsignadas] = useState([]);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [rd, rs] = await Promise.all([
        api('/transporte/despachos'),
        api('/transporte/solicitudes?origen=DESPACHO&estado=asignada'),
      ]);
      const d = await rd.json(); setItems(Array.isArray(d) ? d : []);
      // Asignaciones que NO cuelgan de un despacho programado: si colgaran, ya
      // aparecen en la tabla de despachos. Aquí se listan las "sueltas".
      const s = await rs.json(); setAsignadas(Array.isArray(s) ? s.filter(x => !x.despacho_id) : []);
    }
    catch (e) { showMsg('Error al cargar despachos', true); }
    finally { setLoading(false); }
  }, [showMsg]);
  useEffect(() => { reload(); }, [reload]);

  const cerrar = async (id) => {
    if (!(await confirm({ title: 'Cerrar despacho', message: '¿Cerrar este despacho? Revise el POD antes de confirmar.' }))) return;
    const res = await api(`/transporte/despachos/${id}/cerrar`, { method: 'POST' });
    const d = await res.json();
    if (res.ok) { showMsg('Despacho cerrado'); reload(); } else showMsg(d.error || 'Error', true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end flex-wrap gap-3">
        <button onClick={reload} className="bg-teal-100 hover:bg-teal-200 text-teal-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2">
          <RefreshCcw size={12} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>
      <p className="text-xs text-slate-500">El despacho se cierra manualmente tras revisar el POD que confirma transporte. Mientras el POD no esté confirmado, el cierre queda bloqueado.</p>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[9px] text-slate-400 uppercase">
              <tr>
                <th className="text-left px-4 py-2">Despacho</th><th className="text-left px-3 py-2">Cliente</th>
                <th className="text-left px-3 py-2">Destino</th><th className="text-left px-3 py-2">Asignación</th>
                <th className="text-left px-3 py-2">POD confirmado</th>
                <th className="text-left px-3 py-2">Estado</th><th className="text-right px-4 py-2">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-8 font-bold">Sin despachos de transporte.</td></tr>}
              {items.map(d => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono font-bold text-slate-700">{d.doc_num}</td>
                  <td className="px-3 py-2 text-slate-600">{d.cliente_nombre || d.client_id || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 max-w-[160px] truncate">{d.destination || '—'}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {d.envio_id ? (
                      <div className="leading-tight">
                        <div className="font-bold text-slate-700">{d.transportista_nombre || '—'}</div>
                        <div className="text-[10px] text-slate-500">{[d.vehiculo_matricula, d.vehiculo_tipo].filter(Boolean).join(' · ') || '—'}{d.chofer_nombre ? ` · ${d.chofer_nombre}` : ''}</div>
                      </div>
                    ) : <span className="text-[10px] text-slate-300">sin asignar</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{d.pod_confirmado_at ? new Date(d.pod_confirmado_at).toLocaleString('es-CL') : '—'}</td>
                  <td className="px-3 py-2">{statusBadge(d.status)}</td>
                  <td className="px-4 py-2 text-right">
                    {d.status === 'habilitado_para_cierre'
                      ? <button onClick={() => cerrar(d.id)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded text-[10px] font-black uppercase">Cerrar despacho</button>
                      : d.status === 'CERRADO'
                        ? <span className="text-[10px] text-slate-400">por {d.closed_by} · {d.closed_at ? new Date(d.closed_at).toLocaleDateString('es-CL') : ''}</span>
                        : <span className="text-[10px] text-slate-300">esperando POD</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Asignaciones de transporte sin despacho programado (origen DESPACHO). El
          cierre formal por POD vive en la tabla de arriba; esto da visibilidad de
          la asignación cuando la solicitud no se ligó a un despacho. */}
      {asignadas.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-slate-50 text-xs font-black text-slate-600 uppercase tracking-wider">
            Transporte asignado sin despacho programado ({asignadas.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[9px] text-slate-400 uppercase"><tr>
                <th className="text-left px-4 py-2">Solicitud</th><th className="text-left px-3 py-2">Cliente</th>
                <th className="text-left px-3 py-2">Destino</th><th className="text-left px-3 py-2">Asignación</th>
                <th className="text-left px-3 py-2">Envío</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {asignadas.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-slate-600">{s.id}</td>
                    <td className="px-3 py-2 text-slate-700">{s.cliente_nombre || s.client_id || '—'}</td>
                    <td className="px-3 py-2 text-slate-600 max-w-[160px] truncate">{s.destino || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">
                      <div className="leading-tight">
                        <div className="font-bold text-slate-700">{s.transportista_nombre || '—'}</div>
                        <div className="text-[10px] text-slate-500">{[s.vehiculo_matricula, s.vehiculo_tipo].filter(Boolean).join(' · ') || '—'}{s.chofer_nombre ? ` · ${s.chofer_nombre}` : ''}</div>
                        {s.fecha_hora_confirmada && <div className="text-[9px] text-slate-400">{new Date(s.fecha_hora_confirmada).toLocaleString('es-CL')}</div>}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{s.envio_id || '—'}{s.envio_estado ? ` · ${s.envio_estado}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
