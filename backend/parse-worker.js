// Lee una planilla (xlsx/xls/csv) en un hilo aparte. Lo lanza parseFile en
// import-export-helpers.js, que lo termina si excede el tiempo límite: un archivo
// dañado o malicioso no puede bloquear el proceso principal de la API.
const { parentPort, workerData } = require('worker_threads');
const XLSX = require('xlsx');

try {
  const buffer = Buffer.from(workerData.data, 'base64');
  // sheetRows acota lo que se lee: no tiene sentido procesar más del máximo permitido.
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, sheetRows: workerData.maxRows + 3 });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = ws ? XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }) : [];
  parentPort.postMessage({ rows });
} catch (e) {
  parentPort.postMessage({ error: e.message });
}
