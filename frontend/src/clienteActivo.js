// ── Cliente Activo GLOBAL ─────────────────────────────────────────────────────
// Contexto del "cliente activo" único para toda la app. El VALOR lo provee App.js
// (que es dueño de currentUser, la lista de clientes y la persistencia). Los tabs
// hijos lo consumen con useClienteActivo() sin recibirlo por props.
//
// Forma del value:
//   {
//     activeClientId:   string | null   // id del cliente activo; 'ALL' = modo Todos; null = sin elegir
//     activeClientMode: 'single' | 'all'
//     activeClient:     {id,name,...} | null   // objeto del cliente específico (null en modo Todos)
//     setActiveClient:  (id) => void           // cambia y persiste en sessionStorage
//     options:          [{id,name,...}]        // clientes elegibles según el rol
//     canSeeAll:        boolean                // si el rol puede usar el modo "Todos"
//   }
import { createContext, useContext } from 'react';

export const ClienteActivoContext = createContext(null);

export function useClienteActivo() {
  const ctx = useContext(ClienteActivoContext);
  if (!ctx) throw new Error('useClienteActivo requiere <ClienteActivoContext.Provider> arriba en el árbol');
  return ctx;
}
