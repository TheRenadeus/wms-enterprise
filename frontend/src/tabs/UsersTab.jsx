// Tab "Usuarios del sistema" (gestión de usuarios + API keys + historial de accesos) — lazy-loaded (COD-01 split).
// Componente de presentación: el estado y los handlers viven en App.js y se reciben como props.

import React from 'react';
import { UserCog, Users, LayoutDashboard, Building2, Loader2, UserCheck, UserX, Pencil, Trash2, Key, History, RefreshCcw } from 'lucide-react';
import { MODULES_3PL_ONLY, APP_MODULES } from '../constants';

export default function UsersTab({
  isAdmin, isSuperAdmin, is3PLMode, clients, systemConfig, users, currentUser,
  userForm, setUserForm, isEditingUser, setIsEditingUser, isSavingUser,
  handleSaveUser, handleEditUser, handleDeleteUser, handleToggleUserStatus,
  apiKeys, newKeyName, setNewKeyName, newKeyClient, setNewKeyClient, newKeyPerms, setNewKeyPerms,
  generatedKey, handleGenerateKey, handleRevokeKey,
  loginHistory, setLoginHistory, showLoginHistory, setShowLoginHistory,
  showMsg, apiFetch, host,
}) {
  return (
    <>
      {isAdmin && (
        <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
          <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row gap-8">
            <div className="flex-1 space-y-6 border-r border-slate-100 pr-8">
              <div>
                <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center">
                  <UserCog className="w-5 h-5 mr-2 text-indigo-500"/>
                  {isEditingUser ? 'Editando Perfil' : 'Gestión de Usuarios'}
                </h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Crear accesos, suspender y definir permisos</p>
              </div>
              <form onSubmit={handleSaveUser} className="space-y-6">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Username *</label><input type="text" value={userForm.username} onChange={e=>setUserForm({...userForm, username: e.target.value.toLowerCase().replace(/\s/g, '')})} required disabled={isEditingUser} className={`w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-indigo-500 lowercase ${isEditingUser ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`} placeholder="Ej: jlopez"/></div>
                    <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Contraseña {isEditingUser ? '' : '*'}</label><input type="password" value={userForm.password} onChange={e=>setUserForm({...userForm, password: e.target.value})} required={!isEditingUser} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder={isEditingUser ? "(Vacío para no cambiar)" : "******"}/></div>
                  </div>
                  <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase">Nombre Completo *</label><input type="text" value={userForm.full_name} onChange={e=>setUserForm({...userForm, full_name: e.target.value})} required className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500" placeholder="Ej: Juan López"/></div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-400 uppercase">Rol de Seguridad Base</label>
                       <select value={userForm.role} onChange={e=>setUserForm({...userForm, role: e.target.value})} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 bg-white">
                         <option value="CLIENTE">CLIENTE (Portal solo lectura)</option>
                         <option value="PICKER">PICKER (Bodega)</option>
                         <option value="EJECUTIVO_CUENTA">EJECUTIVO DE CUENTA (Operario)</option>
                         {isAdmin && <option value="COORDINADOR_TRANSPORTE">COORDINADOR DE TRANSPORTE</option>}
                         {isAdmin && <option value="JEFE_BODEGA">JEFE DE BODEGA</option>}
                         <option value="AUDITOR">AUDITOR</option>
                         {isAdmin && <option value="ADMIN">ADMINISTRADOR</option>}
                       </select>
                    </div>
                    <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-400 uppercase">Estado de la Cuenta</label>
                       <select value={userForm.status} onChange={e=>setUserForm({...userForm, status: e.target.value})} className={`w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 bg-white ${userForm.status === 'SUSPENDED' ? 'text-red-600' : 'text-emerald-600'}`}>
                         <option value="ACTIVE">🟢 Activa (Permitir Acceso)</option>
                         <option value="SUSPENDED">🔴 Inhabilitada (Bloqueado)</option>
                       </select>
                    </div>
                  </div>

                  {/* ── ACCESO A CLIENTES (modo 3PL) ─────────────── */}
                  <div className="space-y-3 pt-4 border-t border-slate-100">
                    <label className="text-[10px] font-black text-indigo-600 uppercase flex items-center"><Users className="w-3 h-3 mr-1"/> Acceso a clientes (operaciones)</label>
                    {['ADMIN','SUPERADMIN'].includes(userForm.role) ? (
                      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
                        <p className="text-xs font-black text-indigo-700">🛡 Todos los clientes</p>
                        <p className="text-[10px] text-indigo-600 font-bold mt-0.5">Los administradores siempre acceden a todos los clientes.</p>
                      </div>
                    ) : (
                      <>
                        <p className="text-[10px] text-slate-500 font-bold">Define sobre qué clientes este usuario puede crear operaciones (recibir, despachar, ajustar). La <strong>consulta</strong> de stock e inventario sigue siendo global.</p>
                        <div className="space-y-2">
                          {[
                            ['all','Todos los clientes','admin, jefe de bodega'],
                            ['assigned','Solo clientes asignados','operador específico'],
                            ['none','Sin acceso a clientes','usuario bloqueado'],
                          ].map(([id,label,desc]) => (
                            <label key={id} className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${userForm.client_scope === id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}>
                              <input type="radio" name="client_scope" value={id} checked={userForm.client_scope === id} onChange={()=>setUserForm(p=>({...p, client_scope: id}))} className="mt-0.5 accent-indigo-600"/>
                              <div>
                                <p className="text-xs font-black text-slate-800">{label}</p>
                                <p className="text-[10px] text-slate-500 font-medium">{desc}</p>
                              </div>
                            </label>
                          ))}
                        </div>

                        {userForm.client_scope === 'assigned' && (
                          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 animate-in fade-in">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] font-black text-slate-500 uppercase">Clientes asignados ({(userForm.assigned_clients||[]).length})</p>
                              <div className="flex gap-2">
                                <button type="button" onClick={()=>setUserForm(p=>({...p, assigned_clients: clients.map(c=>c.id)}))} className="text-[9px] font-black text-indigo-600 hover:text-indigo-800 underline">Seleccionar todos</button>
                                <button type="button" onClick={()=>setUserForm(p=>({...p, assigned_clients: []}))} className="text-[9px] font-black text-slate-500 hover:text-slate-700 underline">Deseleccionar todos</button>
                              </div>
                            </div>
                            <div className="max-h-48 overflow-y-auto space-y-1 bg-white border border-slate-200 rounded-lg p-2">
                              {clients.length === 0 && <p className="text-[10px] text-slate-400 text-center py-3">Sin clientes registrados aún.</p>}
                              {clients.map(c => {
                                const checked = (userForm.assigned_clients || []).includes(c.id);
                                return (
                                  <label key={c.id} className="flex items-center gap-2 cursor-pointer p-1.5 hover:bg-slate-50 rounded">
                                    <input type="checkbox" checked={checked} onChange={()=>setUserForm(p=>({...p, assigned_clients: checked ? p.assigned_clients.filter(x=>x!==c.id) : [...(p.assigned_clients||[]), c.id]}))} className="w-3.5 h-3.5 accent-indigo-600"/>
                                    <span className="font-mono text-[10px] font-black text-indigo-700">{c.id}</span>
                                    <span className="text-[10px] text-slate-600">· {c.name}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* SELECCIÓN DE MÓDULOS */}
                  <div className="space-y-1 pt-4 border-t border-slate-100">
                     <label className="text-[10px] font-black text-indigo-600 uppercase flex items-center"><LayoutDashboard className="w-3 h-3 mr-1"/> Permisos de Visualización (Menú)</label>
                     <select value={userForm.allowed_modules_type} onChange={e=>{setUserForm({...userForm, allowed_modules_type: e.target.value, moduleSelection: []})}} className="w-full border-2 border-indigo-100 bg-indigo-50 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 text-indigo-800">
                       <option value="ROLE">Por Defecto (Basado en Rol Base)</option>
                       <option value="CUSTOM">Personalizado (Elegir qué módulos ve)</option>
                     </select>
                  </div>

                  {userForm.allowed_modules_type === 'CUSTOM' && (
                     <div className="grid grid-cols-2 gap-2 mt-2 bg-slate-50 p-4 rounded-xl border border-slate-200">
                        {APP_MODULES.map(m => {
                          const is3PLMod = MODULES_3PL_ONLY.includes(m.id);
                          const hiddenByMode = is3PLMod && !is3PLMode;
                          return (
                            <label key={m.id} className={`flex items-center gap-2 bg-white px-3 py-2 rounded-lg border shadow-sm cursor-pointer ${hiddenByMode ? 'border-cyan-100 bg-cyan-50/30' : 'border-slate-100 hover:border-indigo-300'}`} title={m.label}>
                              <input type="checkbox" checked={userForm.moduleSelection.includes(m.id)} onChange={e => { const sel = e.target.checked ? [...userForm.moduleSelection, m.id] : userForm.moduleSelection.filter(id => id !== m.id); setUserForm({...userForm, moduleSelection: sel}); }} className="w-4 h-4 text-indigo-600 rounded" />
                              <span className="text-[10px] font-black text-slate-700 truncate">{m.label}</span>
                              {is3PLMod && <span className="ml-auto text-[7px] bg-cyan-100 text-cyan-600 px-1 rounded font-black uppercase shrink-0">{hiddenByMode ? 'oculto' : '3PL'}</span>}
                            </label>
                          );
                        })}
                     </div>
                  )}

                  {/* SELECCIÓN DE CLIENTES */}
                  <div className="space-y-1 pt-4 border-t border-slate-100">
                     <label className="text-[10px] font-black text-indigo-600 uppercase flex items-center"><Building2 className="w-3 h-3 mr-1"/> Aislamiento de Datos por Cliente</label>
                     <select value={userForm.allowed_clients} onChange={e=>{setUserForm({...userForm, allowed_clients: e.target.value, clientSelection: []})}} className="w-full border-2 border-indigo-100 bg-indigo-50 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 text-indigo-800">
                       <option value="ALL">Sin restricciones (Ve inventario de todos)</option>
                       <option value="RESTRICTED">Restringir (Solo ve clientes seleccionados)</option>
                     </select>
                  </div>

                  {userForm.allowed_clients === 'RESTRICTED' && (
                     <div className="grid grid-cols-2 gap-2 mt-2 bg-slate-50 p-4 rounded-xl border border-slate-200 custom-scrollbar max-h-40 overflow-y-auto">
                        {clients.map(c => (
                           <label key={c.id} className="flex items-center gap-2 cursor-pointer bg-white px-3 py-2 rounded-lg border border-slate-100 shadow-sm hover:border-indigo-300">
                             <input type="checkbox" checked={userForm.clientSelection.includes(c.id)} onChange={e => { const sel = e.target.checked ? [...userForm.clientSelection, c.id] : userForm.clientSelection.filter(id => id !== c.id); setUserForm({...userForm, clientSelection: sel}); }} className="w-4 h-4 text-indigo-600 rounded" />
                             <span className="text-[10px] font-black text-slate-700 truncate" title={c.name}>{c.id}</span>
                           </label>
                        ))}
                        {clients.length === 0 && <p className="text-[10px] text-slate-400 col-span-2">No hay clientes registrados.</p>}
                     </div>
                  )}
                </div>

                <div className="flex gap-4 mt-4">
                  <button type="submit" disabled={isSavingUser} className={`flex-[2] text-white font-black py-4 rounded-2xl shadow-lg uppercase text-xs tracking-widest transition-colors disabled:opacity-60 flex justify-center items-center ${isEditingUser ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'}`}>
                    {isSavingUser ? <><Loader2 size={14} className="mr-2 animate-spin"/> Guardando...</> : (isEditingUser ? 'Actualizar Usuario' : 'Crear Usuario')}
                  </button>
                  {isEditingUser && (
                    <button type="button" onClick={() => {setUserForm({ username: '', full_name: '', password: '', role: 'EJECUTIVO_CUENTA', status: 'ACTIVE', allowed_clients: 'ALL', clientSelection: [], allowed_modules_type: 'ROLE', moduleSelection: [] }); setIsEditingUser(false);}} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-black py-4 rounded-2xl shadow-sm uppercase text-xs tracking-widest transition-colors">
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            </div>
            <div className="flex-[1.5] overflow-y-auto max-h-[600px] custom-scrollbar pr-2">
              <div className="flex justify-between items-center mb-4 sticky top-0 bg-white pt-2 pb-2 z-10 border-b border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Usuarios del Sistema ({users.length})</p>
                {(() => {
                  const max = parseInt(systemConfig?.license_max_users, 10);
                  const active = users.filter(u => (u.status || 'ACTIVE') !== 'SUSPENDED' && u.role !== 'SUPERADMIN').length;
                  if (!Number.isFinite(max) || max <= 0) return <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Cupos: sin límite</span>;
                  const full = active >= max;
                  return <span className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest border ${full ? 'bg-red-50 text-red-600 border-red-200' : 'bg-emerald-50 text-emerald-600 border-emerald-200'}`} title="Usuarios activos que ocupan cupo de licencia (SUPERADMIN no cuenta)">Cupos: {active} / {max}{full ? ' · lleno' : ''}</span>;
                })()}
              </div>
              <div className="space-y-3">
                {users.map(u => (
                  <div key={u.username} className={`p-4 border rounded-2xl flex flex-col hover:bg-slate-50 transition-colors shadow-sm ${u.status === 'SUSPENDED' ? 'bg-slate-50 border-slate-200 opacity-75' : 'bg-white border-slate-200'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-sm font-black text-slate-800 flex items-center gap-2">
                          {u.full_name}
                          {u.status === 'SUSPENDED' && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[8px] uppercase">Inhabilitado</span>}
                        </p>
                        <p className="text-[10px] font-mono text-slate-500 mt-1">@{u.username}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className={`px-2 py-1 rounded text-[9px] font-black uppercase border ${u.role === 'ADMIN' || u.role === 'SUPERADMIN' ? 'bg-red-50 text-red-600 border-red-200' : u.role === 'EJECUTIVO_CUENTA' ? 'bg-teal-50 text-teal-600 border-teal-200' : u.role === 'AUDITOR' ? 'bg-blue-50 text-blue-600 border-blue-200' : u.role === 'PICKER' ? 'bg-violet-50 text-violet-600 border-violet-200' : u.role === 'CLIENTE' ? 'bg-cyan-50 text-cyan-600 border-cyan-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>{u.role === 'EJECUTIVO_CUENTA' ? 'EJECUTIVO' : u.role}</span>
                        <button onClick={() => handleToggleUserStatus(u)} disabled={u.username === 'admin' || u.username === currentUser?.username} className={`p-1.5 rounded-full border shadow-sm transition-all ml-2 disabled:opacity-30 ${u.status === 'SUSPENDED' ? 'bg-white border-slate-200 text-slate-400 hover:text-emerald-600 hover:border-emerald-300' : 'bg-white border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-300'}`} title={u.status === 'SUSPENDED' ? 'Activar (ocupa un cupo)' : 'Inhabilitar (libera el cupo)'}>{u.status === 'SUSPENDED' ? <UserCheck size={14}/> : <UserX size={14}/>}</button>
                        <button onClick={() => handleEditUser(u)} className="bg-white p-1.5 rounded-full border border-slate-200 text-slate-400 hover:text-indigo-600 hover:border-indigo-300 shadow-sm transition-all ml-2" title="Editar Usuario"><Pencil size={14}/></button>
                        <button onClick={() => handleDeleteUser(u.username)} disabled={u.username === 'admin'} className="bg-white p-1.5 rounded-full border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-300 shadow-sm transition-all ml-1 disabled:opacity-30"><Trash2 size={14}/></button>
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-2">
                      {u.allowed_modules !== 'ALL' && (
                        <p className="text-[9px] text-indigo-600 font-bold uppercase tracking-widest flex items-center"><LayoutDashboard size={10} className="mr-1"/> Vistas: {JSON.parse(u.allowed_modules || '[]').length} act</p>
                      )}
                      {/* Badge de scope de clientes */}
                      {(() => {
                        const isAdminRole = ['ADMIN','SUPERADMIN'].includes(u.role);
                        const scope = isAdminRole ? 'all' : (u.client_scope || 'all');
                        if (scope === 'all') return <button onClick={()=>handleEditUser(u)} className="bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[9px] font-black uppercase hover:bg-blue-200">🏢 Todos los clientes</button>;
                        if (scope === 'none') return <button onClick={()=>handleEditUser(u)} className="bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded text-[9px] font-black uppercase hover:bg-red-200">⛔ Sin acceso</button>;
                        const ac = Array.isArray(u.assigned_clients) ? u.assigned_clients : [];
                        if (ac.length === 0) return <button onClick={()=>handleEditUser(u)} className="bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded text-[9px] font-black uppercase hover:bg-amber-200">⚠ Sin clientes asignados</button>;
                        const shown = ac.slice(0,3);
                        const extra = ac.length - shown.length;
                        return (
                          <div className="flex flex-wrap gap-1 items-center" title={ac.join(', ')}>
                            {shown.map(cid => <button key={cid} onClick={()=>handleEditUser(u)} className="bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded text-[9px] font-mono font-black hover:bg-emerald-200">{cid}</button>)}
                            {extra > 0 && <button onClick={()=>handleEditUser(u)} className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-[9px] font-black">+{extra} más</button>}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API KEYS */}
      {isAdmin && isSuperAdmin && (
        <div className="space-y-6 animate-in fade-in max-w-7xl mx-auto">
          <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 p-8">
            <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter flex items-center mb-6"><Key className="w-5 h-5 mr-2 text-indigo-500"/> API Keys para Integración ERP</h2>
            <div className="grid md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Generar Nueva Key</h3>
                <form onSubmit={handleGenerateKey} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase">Nombre / Descripción *</label>
                    <input type="text" required value={newKeyName} onChange={e=>setNewKeyName(e.target.value)} placeholder="Ej: ERP-SAP-Producción" className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500"/>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase">Cliente (opcional)</label>
                    <select value={newKeyClient} onChange={e=>setNewKeyClient(e.target.value)} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 bg-white">
                      <option value="">-- Todos los clientes --</option>
                      {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase">Permisos</label>
                    <select value={newKeyPerms} onChange={e=>setNewKeyPerms(e.target.value)} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-500 bg-white">
                      <option value="read">Solo Lectura</option>
                      <option value="write">Lectura + Escritura</option>
                    </select>
                  </div>
                  <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 rounded-2xl uppercase text-xs tracking-widest shadow-lg shadow-indigo-200 transition-colors flex items-center justify-center gap-2"><Key size={14}/> Generar API Key</button>
                </form>
                {generatedKey && (
                  <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-4 animate-in fade-in">
                    <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-2">⚠️ Copia esta key ahora — no se mostrará de nuevo</p>
                    <code className="block bg-white border border-emerald-200 rounded-xl px-4 py-3 font-mono text-xs text-slate-800 break-all select-all">{generatedKey}</code>
                    <button onClick={()=>{navigator.clipboard.writeText(generatedKey); showMsg('✅ Copiado');}} className="mt-2 text-[10px] font-black text-emerald-600 hover:text-emerald-800 uppercase tracking-widest">Copiar al portapapeles</button>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Keys Activas ({apiKeys.length})</h3>
                {apiKeys.map(k=>(
                  <div key={k.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-black text-slate-800">{k.name}</p>
                        <p className="font-mono text-[10px] text-slate-500 mt-1">{k.key_prefix}••••••••</p>
                        <div className="flex gap-2 mt-2">
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${k.permissions==='write'?'bg-amber-100 text-amber-700':'bg-blue-100 text-blue-700'}`}>{k.permissions}</span>
                          {k.client_id && <span className="text-[9px] font-black bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">{k.client_id}</span>}
                        </div>
                      </div>
                      <button onClick={()=>handleRevokeKey(k.id)} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={14}/></button>
                    </div>
                    <p className="text-[9px] text-slate-400 mt-2">Creada: {new Date(k.created_at).toLocaleDateString('es-ES')}</p>
                  </div>
                ))}
                {apiKeys.length===0 && <div className="p-6 text-center text-slate-400"><Key className="w-10 h-10 mx-auto mb-2 opacity-50"/><p className="text-[10px] uppercase font-bold">Sin keys activas</p></div>}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Endpoints Disponibles</p>
                  <div className="space-y-1 font-mono text-[9px] text-slate-600">
                    <p>GET /v1/inventory</p>
                    <p>GET /v1/inventory/:sku/stock</p>
                    <p>GET /v1/skus</p>
                    <p>GET /v1/movements</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* HISTORIAL DE LOGINS */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><History className="w-4 h-4 text-slate-500"/> Historial de Accesos</h2>
              <button onClick={async()=>{ const res=await apiFetch(`${host}/api/login-history`); const d=await res.json(); setLoginHistory(Array.isArray(d)?d:[]); setShowLoginHistory(true); }} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2"><RefreshCcw size={12}/> Cargar</button>
            </div>
            {showLoginHistory && loginHistory.length > 0 && (
              <div className="overflow-x-auto max-h-64 overflow-y-auto custom-scrollbar">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 sticky top-0"><tr>
                    <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Fecha</th>
                    <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Usuario</th>
                    <th className="p-3 text-[9px] font-black text-slate-400 uppercase">IP</th>
                    <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Estado</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {loginHistory.map(h=>(
                      <tr key={h.id} className={`hover:bg-slate-50 ${!h.success?'bg-red-50/50':''}`}>
                        <td className="p-3 text-[10px] text-slate-400">{new Date(h.created_at).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})}</td>
                        <td className="p-3 font-mono text-xs font-black text-slate-700">@{h.username}</td>
                        <td className="p-3 font-mono text-[10px] text-slate-500">{h.ip}</td>
                        <td className="p-3"><span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${h.success?'bg-emerald-100 text-emerald-700':'bg-red-100 text-red-700'}`}>{h.success?'OK':'Fallido'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {showLoginHistory && loginHistory.length===0 && <p className="text-center text-xs text-slate-400 py-4">Sin registros</p>}
          </div>
        </div>
      )}
    </>
  );
}
