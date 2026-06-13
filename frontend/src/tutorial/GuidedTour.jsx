import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MISIONES, CIERRE, TOTAL_MISIONES } from './curriculum';

// ── Utilidad: spotlight sobre un elemento del DOM ────────────────────────────
function useSpotlight(selector, mision) {
  const [rect, setRect] = useState(null);

  useEffect(() => {
    if (!selector) { setRect(null); return; }
    let raf;
    const update = () => {
      const el = document.querySelector(selector);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      } else {
        setRect(null);
      }
    };
    update();
    raf = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [selector, mision]);

  return rect;
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function GuidedTour({
  // estado del tutorial
  mision, misionActual, enCierre, completadas, cargando,
  avanzar, saltar, salir, reiniciar,
  // estado de la app para validaciones
  activeTab, switchTab,
  permittedInventory, pickTasks, notifications,
  host, apiFetch, currentUser,
}) {
  const [yaLoHice,        setYaLoHice]        = useState(false);
  const [feedbackMsg,     setFeedbackMsg]      = useState('');
  const [feedbackRating,  setFeedbackRating]   = useState(0);
  const [feedbackEnviado, setFeedbackEnviado]  = useState(false);
  const [feedbackBusy,    setFeedbackBusy]     = useState(false);

  // Refs para snapshots de estado al inicio de cada misión
  const inventoryCountRef = useRef(permittedInventory.length);
  const pickCountRef      = useRef(pickTasks.length);
  // M3: mapa lpn_id → location_id para detectar reubicaciones
  const locationMapRef    = useRef({});
  // M5: suma total de qty para detectar despachos parciales
  const stockTotalRef     = useRef(0);

  // Actualizar snapshots cuando cambia de misión
  useEffect(() => {
    inventoryCountRef.current = permittedInventory.length;
    pickCountRef.current      = pickTasks.length;
    // M3: capturar mapa { id: location_id } para detectar cualquier cambio de ubicación
    const locMap = {};
    permittedInventory.forEach(i => { locMap[i.id] = i.location_id; });
    locationMapRef.current = locMap;
    // M5: capturar suma total de qty para detectar despachos parciales
    stockTotalRef.current = permittedInventory.reduce((s, i) => s + parseFloat(i.qty || 0), 0);
    setYaLoHice(false);
  }, [mision]); // eslint-disable-line

  // Navegar al tab destino cuando inicia una misión
  useEffect(() => {
    if (!misionActual?.targetTab) return;
    if (activeTab !== misionActual.targetTab) switchTab(misionActual.targetTab);
  }, [mision]); // eslint-disable-line

  // Spotlight del elemento objetivo
  const spotlightRect = useSpotlight(
    misionActual?.targetSelector ?? null,
    mision
  );

  // ── Validación de la misión actual ──────────────────────────────────────────
  const esValida = useCallback(() => {
    if (!misionActual) return false;
    if (yaLoHice) return true;
    if (misionActual.soloYaLoHice) return false;
    try {
      return misionActual.validar({ activeTab, permittedInventory, pickTasks, notifications, inventoryCountRef, pickCountRef, locationMapRef, stockTotalRef });
    } catch { return false; }
  }, [misionActual, yaLoHice, activeTab, permittedInventory, pickTasks, notifications]);

  const validado = esValida();

  // ── Envío de feedback ───────────────────────────────────────────────────────
  const enviarFeedback = async () => {
    if (!feedbackMsg.trim()) return;
    setFeedbackBusy(true);
    try {
      await apiFetch(`${host}/api/demo/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: feedbackMsg.trim(),
          rating: feedbackRating || null,
          persona_label: currentUser?.persona_label || currentUser?.role || 'Tutorial',
        }),
      });
      setFeedbackEnviado(true);
    } catch { /* ok */ }
    setFeedbackBusy(false);
  };

  // Cerrar con tecla Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') salir(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [salir]);

  const PAD = 10;
  const progreso = Math.round((mision / TOTAL_MISIONES) * 100);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop oscuro */}
      <div
        className="fixed inset-0 bg-black/60 z-[60]"
        style={{ pointerEvents: spotlightRect ? 'none' : 'auto' }}
        onClick={spotlightRect ? undefined : salir}
      />

      {/* Spotlight (caja transparente con box-shadow que "agujerea" el backdrop) */}
      {spotlightRect && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            top:    spotlightRect.top    - PAD,
            left:   spotlightRect.left   - PAD,
            width:  spotlightRect.width  + PAD * 2,
            height: spotlightRect.height + PAD * 2,
            borderRadius: 12,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.60)',
            border: '2px solid rgba(99,102,241,0.9)',
            zIndex: 61,
            pointerEvents: 'none',
            transition: 'all 0.25s ease',
          }}
        />
      )}

      {/* Panel principal — fijo en la parte inferior */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Tutorial guiado WMS"
        className="fixed bottom-0 left-0 right-0 z-[62] flex justify-center pb-4 px-4 pointer-events-none"
      >
        <div
          className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden pointer-events-auto"
          style={{ maxHeight: '85vh', overflowY: 'auto' }}
        >
          {/* Barra de progreso */}
          <div className="h-1.5 bg-slate-100">
            <div
              className="h-full bg-indigo-500 transition-all duration-500"
              style={{ width: `${enCierre ? 100 : progreso}%` }}
            />
          </div>

          {enCierre ? (
            /* ── CIERRE ── */
            <div className="p-6 space-y-5">
              <div className="text-center">
                <span className="text-5xl">{CIERRE.icono}</span>
                <h2 className="text-xl font-black text-slate-800 mt-2 uppercase tracking-tighter">{CIERRE.titulo}</h2>
                <p className="text-xs text-slate-500 font-bold mt-1">Completaste las {TOTAL_MISIONES} misiones</p>
              </div>

              <div className="grid grid-cols-5 gap-2">
                {CIERRE.ciclo.map((paso) => (
                  <div key={paso.label} className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
                    <div className="text-2xl">{paso.emoji}</div>
                    <p className="text-[10px] font-black text-emerald-700 uppercase mt-1">{paso.label}</p>
                    <p className="text-[9px] text-slate-500 mt-0.5 leading-tight">{paso.desc}</p>
                  </div>
                ))}
              </div>

              <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
                <p className="text-xs text-slate-700 font-bold leading-relaxed">{CIERRE.mensaje}</p>
              </div>

              {/* Feedback */}
              {!feedbackEnviado ? (
                <div className="space-y-3">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">¿Qué te pareció el tutorial?</p>
                  <div className="flex gap-2 justify-center">
                    {[1,2,3,4,5].map(n => (
                      <button
                        key={n}
                        onClick={() => setFeedbackRating(n)}
                        className={`text-2xl transition-transform hover:scale-110 ${feedbackRating >= n ? 'opacity-100' : 'opacity-30'}`}
                      >⭐</button>
                    ))}
                  </div>
                  <textarea
                    value={feedbackMsg}
                    onChange={e => setFeedbackMsg(e.target.value)}
                    placeholder="¿Qué mejorarías? ¿Algo fue confuso? (opcional)"
                    rows={2}
                    className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500 resize-none"
                  />
                  <button
                    onClick={enviarFeedback}
                    disabled={feedbackBusy || !feedbackMsg.trim()}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-2.5 rounded-xl text-[10px] uppercase tracking-widest disabled:opacity-40"
                  >
                    {feedbackBusy ? 'Enviando…' : '✉ Enviar feedback'}
                  </button>
                </div>
              ) : (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                  <p className="text-sm font-black text-emerald-700">¡Gracias por tu feedback! 🙌</p>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={reiniciar}
                  disabled={cargando}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black py-3 rounded-xl text-[10px] uppercase tracking-widest disabled:opacity-50"
                >
                  {cargando ? 'Reiniciando…' : '🔄 Reiniciar tutorial'}
                </button>
                <button
                  onClick={salir}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3 rounded-xl text-[10px] uppercase tracking-widest"
                >
                  🚀 Explorar libremente
                </button>
              </div>
            </div>

          ) : misionActual ? (
            /* ── MISIÓN ACTIVA ── */
            <div className="p-5 space-y-4">
              {/* Cabecera */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-3xl shrink-0">{misionActual.icono}</span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{misionActual.subtitulo || `Misión ${misionActual.indice + 1} de ${TOTAL_MISIONES}`}</p>
                    <h2 className="text-lg font-black text-slate-800 tracking-tighter leading-tight">{misionActual.titulo}</h2>
                  </div>
                </div>
                <button
                  onClick={salir}
                  title="Salir del tutorial (Esc)"
                  className="shrink-0 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                  aria-label="Cerrar tutorial"
                >✕</button>
              </div>

              {/* Indicadores de progreso */}
              <div className="flex gap-1">
                {MISIONES.map((m, i) => (
                  <div
                    key={m.id}
                    className={`h-1.5 flex-1 rounded-full transition-all ${
                      completadas.includes(i) ? 'bg-emerald-500' :
                      i === mision           ? 'bg-indigo-500' :
                                               'bg-slate-200'
                    }`}
                  />
                ))}
              </div>

              {/* Concepto */}
              <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
                <p className="text-xs font-bold text-slate-700 leading-relaxed">{misionActual.concepto}</p>

                {/* Glosario solo en M0 */}
                {misionActual.glosario && (
                  <div className="space-y-2 pt-1 border-t border-slate-200">
                    {misionActual.glosario.map(g => (
                      <div key={g.termino} className="flex items-start gap-2">
                        <span className="text-lg shrink-0">{g.emoji}</span>
                        <p className="text-[11px] text-slate-600 font-bold leading-snug">
                          <span className="text-slate-800 font-black">{g.termino}:</span> {g.def}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Ciclo solo en M0 */}
                {misionActual.ciclo && (
                  <div className="flex items-center gap-1 flex-wrap pt-1 border-t border-slate-200">
                    {misionActual.ciclo.map((paso, i) => (
                      <React.Fragment key={paso}>
                        <span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded-lg text-[10px] font-black">{paso}</span>
                        {i < misionActual.ciclo.length - 1 && <span className="text-slate-300 font-black text-xs">→</span>}
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>

              {/* Objetivo */}
              <div className={`rounded-2xl p-4 border-2 ${validado ? 'bg-emerald-50 border-emerald-300' : 'bg-amber-50 border-amber-200'}`}>
                <p className="text-[10px] font-black uppercase tracking-widest mb-1 ${validado ? 'text-emerald-600' : 'text-amber-600'}">
                  {validado ? '✅ Objetivo cumplido' : '🎯 Tu misión'}
                </p>
                <p className="text-xs font-bold text-slate-700 leading-relaxed">{misionActual.objetivo}</p>
                {misionActual.hint && !validado && (
                  <p className="text-[10px] text-slate-500 mt-2 italic">{misionActual.hint}</p>
                )}
              </div>

              {/* Mensaje de éxito inline */}
              {validado && (
                <div className="bg-emerald-100 border border-emerald-300 rounded-2xl p-3 text-center">
                  <p className="text-sm font-black text-emerald-700">🎉 {misionActual.mensajeExito}</p>
                </div>
              )}

              {/* Botones de acción */}
              <div className="flex gap-2">
                {/* Ya lo hice — respaldo universal para validaciones difíciles */}
                {misionActual.tieneAccion && !validado && (
                  <button
                    onClick={() => setYaLoHice(true)}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black py-3 rounded-xl text-[10px] uppercase tracking-widest border border-slate-200"
                  >
                    Ya lo hice ✓
                  </button>
                )}

                {/* Saltar misión */}
                {misionActual.tieneAccion && (
                  <button
                    onClick={saltar}
                    className="bg-slate-50 hover:bg-slate-100 text-slate-400 font-black py-3 px-4 rounded-xl text-[10px] uppercase tracking-widest border border-slate-200"
                    title="Saltar esta misión"
                  >
                    Saltar →
                  </button>
                )}

                {/* Reiniciar */}
                <button
                  onClick={reiniciar}
                  disabled={cargando}
                  className="bg-slate-50 hover:bg-slate-100 text-slate-400 font-black py-3 px-4 rounded-xl text-[10px] uppercase border border-slate-200 disabled:opacity-40"
                  title="Reiniciar desde M0 y limpiar el sandbox"
                >
                  🔄
                </button>

                {/* Siguiente (siempre a la derecha) */}
                <button
                  onClick={avanzar}
                  disabled={misionActual.tieneAccion && !validado}
                  className={`flex-[2] font-black py-3 rounded-xl text-[10px] uppercase tracking-widest transition-colors ${
                    !misionActual.tieneAccion || validado
                      ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  {mision >= TOTAL_MISIONES - 1 ? '🏁 Ver resumen' : 'Siguiente →'}
                </button>
              </div>

              {/* Indicador de sandbox */}
              <p className="text-[9px] text-center text-slate-400 font-bold">
                🎮 Modo sandbox — ningún cambio afecta datos reales · Esc para salir
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
