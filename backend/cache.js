// Cache en memoria con TTL para datos maestros.
//
// Diseño:
//   - Instancia singleton, TTL por defecto 60s.
//   - cached(key, fn): si hay valor → lo devuelve; si no → ejecuta fn(), cachea y retorna.
//   - invalidate(key | [keys]): borra entradas tras escrituras.
//
// Restricción importante: solo cachear endpoints cuyo resultado NO depende del
// usuario o filtros. Para endpoints con scope por cliente (ej. /api/skus),
// usar el endpoint /api/bootstrap (P5) que es contextual.

const NodeCache = require('node-cache');

const cache = new NodeCache({
  stdTTL: 60,
  checkperiod: 90,
  useClones: false, // devolvemos referencia compartida — datos son read-only desde el handler
});

async function cached(key, fn, ttl = 60) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = await fn();
  cache.set(key, value, ttl);
  return value;
}

function invalidate(keyOrKeys) {
  const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
  for (const k of keys) cache.del(k);
}

function stats() {
  return cache.getStats();
}

module.exports = { cache, cached, invalidate, stats };
