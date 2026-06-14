// Utilidades compartidas extraídas de App.js (split)
import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

/**
 * Parsea un archivo .xlsx/.csv en el navegador (client-side) con SheetJS.
 * Devuelve { headers, rows } donde rows es un array de objetos por fila.
 * Usa defval:'' para que las celdas vacías sean '' (no undefined) y raw:false
 * para obtener valores formateados como string.
 * @param {File} file
 * @returns {Promise<{ headers: string[], rows: object[] }>}
 */
export function parseSpreadsheet(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('No se recibió ningún archivo')); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) { resolve({ headers: [], rows: [] }); return; }
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
        const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
        resolve({ headers, rows });
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Exporta un array de objetos a un archivo .xlsx.
 * @param {object[]} rows      - Filas ya filtradas (lo que se ve en pantalla).
 * @param {Array}    columns   - [{ key, header, format? }] donde format = 'date'|'number'|'text'
 * @param {string}   filename  - Nombre del archivo (sin extensión).
 * @param {string}   sheetName - Nombre de la hoja.
 */
export function exportToExcel(rows, columns, filename, sheetName = 'Datos') {
  if (!rows || rows.length === 0) {
    alert('No hay datos para exportar.');
    return;
  }

  // Construir matriz: encabezados + filas
  const header = columns.map(c => c.header);
  const data   = rows.map(row =>
    columns.map(({ key, format }) => {
      const val = row[key];
      if (val === null || val === undefined) return '';
      if (format === 'date')   return val ? new Date(val).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '';
      if (format === 'number') return parseFloat(val) || 0;
      return String(val);
    })
  );

  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);

  // Negrita en encabezados
  columns.forEach((_, ci) => {
    const cellAddr = XLSX.utils.encode_cell({ r: 0, c: ci });
    if (ws[cellAddr]) ws[cellAddr].s = { font: { bold: true } };
  });

  // Ancho automático según contenido
  ws['!cols'] = columns.map((col, ci) => {
    const maxLen = Math.max(
      col.header.length,
      ...data.map(r => String(r[ci] ?? '').length)
    );
    return { wch: Math.min(maxLen + 2, 60) };
  });

  // Congelar fila de encabezado
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function useAutoSaveState(key, initialValue) {
  const [state, setState] = useState(() => {
    try { const item = localStorage.getItem(key); return item ? JSON.parse(item) : initialValue; }
    catch (error) { return initialValue; }
  });
  // COD-06: debounce de 500ms para evitar escrituras excesivas en cada keystroke
  useEffect(() => {
    const timer = setTimeout(() => { localStorage.setItem(key, JSON.stringify(state)); }, 500);
    return () => clearTimeout(timer);
  }, [key, state]);
  return [state, setState];
}

// Helper global para fetch autenticado — agrega JWT automáticamente
// Flag mutable para interceptar escrituras en modo demo sin pasar por cada handler
let _isDemoMode = false;
export const setDemoMode = (v) => { _isDemoMode = v; };

export const apiFetch = (url, options = {}) => {
  const method = (options.method || 'GET').toUpperCase();
  if (_isDemoMode && !['GET','HEAD','OPTIONS'].includes(method) && !url.includes('/demo/feedback')) {
    // Simula éxito sin llamada real al servidor
    const fakeId = 'DEMO-' + Date.now();
    return Promise.resolve(new Response(JSON.stringify({
      demo: true, success: true,
      id: fakeId, returnId: fakeId,
      lpn: 'DEMO-LPN-' + Math.floor(Math.random()*9000+1000),
      raw_key: 'demo_key_no_es_real_' + fakeId,
      token: localStorage.getItem('wms_token') || '',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }
  const token = localStorage.getItem('wms_token');
  const headers = { ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // Timeout de 30 s para evitar requests colgados
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  return fetch(url, { ...options, headers, signal: controller.signal })
    .then(res => {
      clearTimeout(timeoutId);
      // Auto-logout solo en 401 (token expirado/inválido).
      // 403 = Forbidden (autenticado, sin permiso) → no cerrar sesión
      if (res.status === 401) {
        const currentPath = window.location.hash;
        if (!currentPath.includes('portal')) {
          localStorage.removeItem('wms_token');
          localStorage.removeItem('wms_current_user');
          window.location.reload();
        }
      }
      return res;
    })
    .catch(err => {
      clearTimeout(timeoutId);
      throw err;
    });
};

// UX-06: Calcula tiempo relativo para mostrar antigüedad de documentos
export const timeAgo = (dateStr) => {
  if (!dateStr) return '';
  try {
    let d;
    if (dateStr.includes('/')) {
      const [datePart, timePart] = dateStr.split(', ');
      const [day, month, year] = datePart.split('/');
      d = new Date(`20${year}-${month}-${day}T${timePart || '00:00'}`);
    } else {
      d = new Date(dateStr);
    }
    if (isNaN(d.getTime())) return dateStr;
    const diffMs = Date.now() - d.getTime();
    const diffH = Math.floor(diffMs / 3600000);
    const diffM = Math.floor(diffMs / 60000);
    if (diffM < 1) return 'hace un momento';
    if (diffM < 60) return `hace ${diffM}m`;
    if (diffH < 24) return `hace ${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    return diffD === 1 ? 'ayer' : `hace ${diffD} días`;
  } catch(e) { return dateStr; }
};
