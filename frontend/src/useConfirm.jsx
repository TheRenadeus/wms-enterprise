// Hook imperativo para reemplazar window.confirm / window.prompt (P12).
//
// Uso:
//   const { confirm, prompt } = useConfirm();
//   if (!(await confirm({ title: 'Eliminar', message: '...', danger: true }))) return;
//   const motivo = await prompt({ title: 'Motivo', message: 'Ingresa motivo:' });
//
// El Provider monta un único modal en el árbol y resuelve la Promise cuando el
// usuario confirma/cancela. Estilo de ConfirmModal existente (mismo look-and-feel).

import React, { createContext, useContext, useState, useCallback } from 'react';
import { ShieldAlert } from 'lucide-react';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { kind, opts, resolve }
  const [inputValue, setInputValue] = useState('');

  const confirm = useCallback((opts = {}) => {
    return new Promise(resolve => {
      setInputValue('');
      setState({ kind: 'confirm', opts, resolve });
    });
  }, []);

  const promptFn = useCallback((opts = {}) => {
    return new Promise(resolve => {
      setInputValue(opts.defaultValue || '');
      setState({ kind: 'prompt', opts, resolve });
    });
  }, []);

  const close = useCallback((result) => {
    if (state) state.resolve(result);
    setState(null);
    setInputValue('');
  }, [state]);

  const ctxValue = { confirm, prompt: promptFn };

  return (
    <ConfirmContext.Provider value={ctxValue}>
      {children}
      {state && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
             onClick={(e) => e.target === e.currentTarget && close(state.kind === 'confirm' ? false : null)}>
          <div className="bg-white rounded-[28px] shadow-2xl w-full max-w-md">
            <div className="p-6 text-center">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${state.opts.danger ? 'bg-red-100' : 'bg-amber-100'}`}>
                <ShieldAlert className={`w-7 h-7 ${state.opts.danger ? 'text-red-600' : 'text-amber-600'}`}/>
              </div>
              <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter">{state.opts.title || (state.kind === 'prompt' ? 'Ingresar valor' : 'Confirmar')}</h2>
              {state.opts.message && (
                <p className="text-sm text-slate-500 mt-2 font-medium leading-relaxed">{state.opts.message}</p>
              )}
              {state.kind === 'prompt' && (
                <input
                  autoFocus
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') close(inputValue);
                    if (e.key === 'Escape') close(null);
                  }}
                  placeholder={state.opts.placeholder || ''}
                  className="mt-4 w-full px-4 py-3 rounded-2xl border border-slate-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 text-sm font-medium outline-none"
                />
              )}
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => close(state.kind === 'confirm' ? false : null)}
                      className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black py-3 rounded-2xl uppercase text-xs tracking-widest transition-colors">
                Cancelar
              </button>
              <button onClick={() => close(state.kind === 'confirm' ? true : inputValue)}
                      className={`flex-1 font-black py-3 rounded-2xl uppercase text-xs tracking-widest transition-colors text-white shadow-md ${state.opts.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-500 hover:bg-amber-600'}`}>
                {state.opts.confirmText || (state.kind === 'prompt' ? 'Aceptar' : 'Confirmar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm requiere <ConfirmProvider> arriba en el árbol');
  return ctx;
}
