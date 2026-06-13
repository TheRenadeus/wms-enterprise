import { useState, useCallback, useEffect, useRef } from 'react';
import { MISIONES } from './curriculum';

// Hook que gestiona el estado del tutorial guiado.
// El progreso se persiste en el backend para sobrevivir recargas.
export function useTutorial({ apiFetch, host, isDemo }) {
  const [activo,       setActivo]       = useState(false);
  const [mision,       setMision]       = useState(0);
  const [completadas,  setCompletadas]  = useState([]);
  const [cargando,     setCargando]     = useState(false);
  const persistTimerRef = useRef(null);

  // Cargar progreso al activar el tutorial
  useEffect(() => {
    if (!activo || !isDemo) return;
    (async () => {
      try {
        const r = await apiFetch(`${host}/api/demo/tutorial-progress`);
        if (r.ok) {
          const d = await r.json();
          setMision(d.mision ?? 0);
          setCompletadas(d.completadas ?? []);
        }
      } catch { /* sin red — ignorar, el estado local es suficiente */ }
    })();
  }, [activo]); // eslint-disable-line

  // Persistir progreso al backend con debounce de 800ms
  const persistir = useCallback((m, c) => {
    if (!isDemo) return;
    clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(async () => {
      try {
        await apiFetch(`${host}/api/demo/tutorial-progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mision: m, completadas: c }),
        });
      } catch { /* offline — ok */ }
    }, 800);
  }, [apiFetch, host, isDemo]);

  const avanzar = useCallback(() => {
    setMision(prev => {
      const siguiente = prev + 1;
      setCompletadas(c => {
        const nuevas = [...new Set([...c, prev])];
        persistir(siguiente, nuevas);
        return nuevas;
      });
      return siguiente;
    });
  }, [persistir]);

  const saltar = useCallback(() => {
    setMision(prev => {
      const siguiente = Math.min(prev + 1, MISIONES.length);
      persistir(siguiente, completadas);
      return siguiente;
    });
  }, [completadas, persistir]);

  const irA = useCallback((idx) => {
    setMision(idx);
    persistir(idx, completadas);
  }, [completadas, persistir]);

  const reiniciar = useCallback(async () => {
    setCargando(true);
    try {
      await apiFetch(`${host}/api/demo/reset`, { method: 'POST' });
    } catch { /* ok si falla — solo limpiamos estado local */ }
    setMision(0);
    setCompletadas([]);
    persistir(0, []);
    setCargando(false);
  }, [apiFetch, host, persistir]);

  const iniciar = useCallback(() => setActivo(true),  []);
  const salir   = useCallback(() => setActivo(false), []);

  const misionActual = MISIONES[mision] ?? null;
  const enCierre     = mision >= MISIONES.length;

  return {
    activo, iniciar, salir,
    mision, misionActual, enCierre,
    completadas,
    cargando,
    avanzar, saltar, irA, reiniciar,
  };
}
