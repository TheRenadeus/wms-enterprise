// Load test para WMS Enterprise.
// Usa solo el http core de Node — sin deps. Corre contra http://localhost:3000.
//
// Fases:
//   A) 50K clientes vía POST /api/clients
//   B) 500K SKUs vía POST /api/skus
//   C) 5M movimientos vía POST /api/import/receive (batch 1000)
//   D) Benchmarks GET
//
// Variables de entorno:
//   PHASES=ABCD       (default ABCD; puedes correr solo A, BC, etc.)
//   N_CLIENTS=50000
//   N_SKUS=500000
//   N_MOVES=5000000
//   BATCH_MOVES=1000
//   CONC_CLIENTS=50
//   CONC_SKUS=50
//   CONC_MOVES=20
//   API=http://localhost:3000
//   LOAD_TEST_USER=admin  LOAD_TEST_PASSWORD=…   (credenciales del usuario con que se prueba)

const http = require('http');
const { performance } = require('perf_hooks');

const API = process.env.API || 'http://localhost:3000';
const PHASES = (process.env.PHASES || 'ABCD').toUpperCase();
const N_CLIENTS = +(process.env.N_CLIENTS || 50000);
const N_SKUS    = +(process.env.N_SKUS    || 500000);
const N_MOVES   = +(process.env.N_MOVES   || 5000000);
const BATCH_MOVES = +(process.env.BATCH_MOVES || 1000);
const CONC_CLIENTS = +(process.env.CONC_CLIENTS || 50);
const CONC_SKUS    = +(process.env.CONC_SKUS    || 50);
const CONC_MOVES   = +(process.env.CONC_MOVES   || 20);

const url = new URL(API);
const agent = new http.Agent({ keepAlive: true, maxSockets: 200 });

let TOKEN = '';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const opt = {
      hostname: url.hostname,
      port: url.port,
      path,
      method,
      agent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    };
    const start = performance.now();
    const r = http.request(opt, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        const dur = performance.now() - start;
        resolve({ status: res.statusCode, body: chunks, dur });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function login() {
  // Credenciales desde el entorno (nunca en el código): LOAD_TEST_USER (por defecto admin) y LOAD_TEST_PASSWORD
  const password = process.env.LOAD_TEST_PASSWORD;
  if (!password) throw new Error('Define LOAD_TEST_PASSWORD (y LOAD_TEST_USER si no es admin) para el login de la prueba');
  const r = await req('POST', '/api/login', { username: process.env.LOAD_TEST_USER || 'admin', password });
  const j = JSON.parse(r.body);
  if (!j.token) throw new Error('Login falló: ' + r.body);
  TOKEN = j.token;
  console.log('[login] OK — JWT obtenido');
}

// Worker pool simple. fn(i) debe devolver Promise<{ok, dur, status}>
async function runPool(total, concurrency, fn, label) {
  const lat = [];
  let done = 0, ok = 0, fail = 0;
  let nextIdx = 0;
  const errSamples = [];
  const t0 = performance.now();

  // Progress reporter
  const tick = setInterval(() => {
    const elapsed = (performance.now() - t0) / 1000;
    const rate = done / elapsed;
    const eta = rate > 0 ? Math.round((total - done) / rate) : '?';
    process.stdout.write(
      `\r[${label}] ${done}/${total} | ${rate.toFixed(0)} req/s | ok=${ok} fail=${fail} | ETA ${eta}s   `
    );
  }, 1000);

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= total) return;
      try {
        const r = await fn(i);
        lat.push(r.dur);
        if (r.ok) ok++;
        else {
          fail++;
          if (errSamples.length < 5) errSamples.push({ i, status: r.status, body: r.body?.slice(0, 200) });
        }
      } catch (e) {
        fail++;
        if (errSamples.length < 5) errSamples.push({ i, err: e.message });
      }
      done++;
    }
  });
  await Promise.all(workers);
  clearInterval(tick);
  const elapsed = (performance.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  const p = (q) => lat[Math.floor(lat.length * q)] || 0;
  console.log(
    `\n[${label}] DONE — ${done} en ${elapsed.toFixed(1)}s | ${(done/elapsed).toFixed(0)} req/s | ` +
    `p50=${p(0.5).toFixed(0)}ms p95=${p(0.95).toFixed(0)}ms p99=${p(0.99).toFixed(0)}ms | ok=${ok} fail=${fail}`
  );
  if (errSamples.length) {
    console.log(`[${label}] muestras de errores:`);
    errSamples.forEach(e => console.log(' ', e));
  }
  return { elapsed, ok, fail, p50: p(0.5), p95: p(0.95), p99: p(0.99), rps: done/elapsed };
}

const pad = (n, w) => String(n).padStart(w, '0');

// FASE A — clientes
async function phaseA() {
  return runPool(N_CLIENTS, CONC_CLIENTS, async (i) => {
    const id = `CLI${pad(i+1, 6)}`;
    const r = await req('POST', '/api/clients', {
      id, name: `Cliente Demo ${i+1}`, contact: `Contacto ${i+1}`, email: `cli${i+1}@demo.com`,
    });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, body: r.body, dur: r.dur };
  }, 'A:clients');
}

// FASE B — SKUs (round-robin sobre clientes creados)
async function phaseB() {
  return runPool(N_SKUS, CONC_SKUS, async (i) => {
    const clientId = `CLI${pad((i % N_CLIENTS) + 1, 6)}`;
    const sku = `SKU${pad(i+1, 7)}`;
    const r = await req('POST', '/api/skus', {
      sku, client_id: clientId, desc: `Producto ${i+1}`,
      category: ['ELEC','HERR','OFIC','CONS'][i%4], uom: 'UN',
      weight: 1, length: 10, width: 10, height: 10,
    });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, body: r.body, dur: r.dur };
  }, 'B:skus');
}

// FASE C — movimientos vía /api/receive_batch (JSON directo).
// Cada call crea N LPNs + N audit_log rows en una transacción.
async function phaseC() {
  const totalCalls = Math.ceil(N_MOVES / BATCH_MOVES);
  return runPool(totalCalls, CONC_MOVES, async (callIdx) => {
    const rowsThisCall = Math.min(BATCH_MOVES, N_MOVES - callIdx * BATCH_MOVES);
    const items = [];
    for (let j = 0; j < rowsThisCall; j++) {
      const moveIdx = callIdx * BATCH_MOVES + j;
      const skuIdx = moveIdx % N_SKUS;
      items.push({
        sku: `SKU${pad(skuIdx+1, 7)}`,
        qty: 1,
        location_id: 'PISO-RECEPCION',
      });
    }
    const r = await req('POST', '/api/receive_batch', {
      items,
      docNum: `LOAD-${callIdx}`,
      docType: 'REC',
      glosa: 'Load test',
      username: 'LOAD_TEST',
    });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, body: r.body, dur: r.dur };
  }, 'C:moves');
}

// FASE D — benchmarks de listados
async function phaseD() {
  console.log('\n=== FASE D — benchmarks GET ===');
  const targets = [
    { name: 'GET /api/clients',                  path: '/api/clients' },
    { name: 'GET /api/skus?limit=100',           path: '/api/skus?limit=100' },
    { name: 'GET /api/inventory?limit=100',      path: '/api/inventory?limit=100' },
    { name: 'GET /api/inventory?search=SKU0050000', path: '/api/inventory?search=SKU0050000' },
    { name: 'GET /api/skus?search=SKU0250000',   path: '/api/skus?search=SKU0250000' },
    { name: 'GET /api/audit?limit=100',          path: '/api/audit?limit=100' },
  ];
  for (const t of targets) {
    const durs = [];
    for (let k = 0; k < 5; k++) {
      const r = await req('GET', t.path);
      durs.push(r.dur);
      if (r.status >= 400) { console.log(`  ${t.name} → HTTP ${r.status} ${r.body.slice(0,120)}`); break; }
    }
    durs.sort((a,b)=>a-b);
    const avg = durs.reduce((a,b)=>a+b,0)/durs.length;
    console.log(`  ${t.name.padEnd(45)} avg=${avg.toFixed(0)}ms min=${durs[0].toFixed(0)}ms max=${durs[durs.length-1].toFixed(0)}ms`);
  }
}

(async () => {
  console.log(`=== WMS load test — ${new Date().toISOString()} ===`);
  console.log(`API=${API} phases=${PHASES} clients=${N_CLIENTS} skus=${N_SKUS} moves=${N_MOVES}`);
  await login();
  const summary = {};
  if (PHASES.includes('A')) summary.A = await phaseA();
  if (PHASES.includes('B')) summary.B = await phaseB();
  if (PHASES.includes('C')) summary.C = await phaseC();
  if (PHASES.includes('D')) await phaseD();
  console.log('\n=== RESUMEN ===');
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
