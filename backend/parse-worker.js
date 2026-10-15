// Lee una planilla (xlsx/xls/csv) en un hilo aparte. Lo lanza parseFile en
// import-export-helpers.js, que lo termina si excede el tiempo límite: un archivo
// dañado o malicioso no puede bloquear el proceso principal de la API.
const { parentPort, workerData } = require('worker_threads');
const XLSX = require('xlsx');

try {
  const buffer = Buffer.from(workerData.data, 'base64');
  // En planillas binarias (xlsx/xls), sheetRows acota lo que se lee: un archivo
  // pequeño puede declarar millones de filas. Un texto (CSV) se lee completo: ya
  // está acotado por tamaño y ahí no se puede detectar el corte de forma fiable.
  const opciones = { type: 'buffer', cellDates: true };
  if (workerData.binario) opciones.sheetRows = workerData.maxRows + 3;
  const wb = XLSX.read(buffer, opciones);
  const ws = wb.Sheets[wb.SheetNames[0]];
  // Si la hoja tenía más filas de las leídas, se avisa: importar solo una parte
  // rompería el todo-o-nada.
  if (ws && ws['!fullref'] && ws['!fullref'] !== ws['!ref']) {
    parentPort.postMessage({ truncated: true });
  } else {
    const rows = ws ? XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }) : [];
    parentPort.postMessage({ rows });
  }
} catch (e) {
  parentPort.postMessage({ error: e.message });
}
