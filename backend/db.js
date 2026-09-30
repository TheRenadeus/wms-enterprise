const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: 5432,
  max: 25,
  min: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // statement_timeout: corta queries lentas a nivel de PG (no del pool).
  // pg lo aplica con SET en cada conexión nueva.
  statement_timeout: 30_000,
  // query_timeout: corta del lado del cliente Node si PG no responde.
  query_timeout: 30_000,
});

// Sin este handler, un drop de conexión idle emite 'error' a nivel del cliente pg
// y sin listener Node crashea el proceso. Loggear y dejar que el pool re-conecte.
pool.on('error', (err) => {
  console.error('[pg-pool-error] conexión perdida:', err.code || '-', err.message);
});

// Mapeo de errores de BD a mensajes amigables (UX-02).
// Si el código no está mapeado, se loguea el error real pero se devuelve un
// mensaje genérico para no filtrar estructura de BD al cliente.
const mapDbError = (err) => {
  const codes = {
    '23505': 'Este registro ya existe (valor duplicado).',
    '23503': 'Referencia inválida: verifique que el cliente o SKU exista.',
    '23514': 'Valor inválido: la cantidad no puede ser negativa.',
    '22P02': 'Formato de dato incorrecto en uno de los campos.',
    '23502': 'Campo obligatorio no puede estar vacío.',
    '53300': 'Servidor ocupado, reintentar en 1s',  // too_many_connections
    '53400': 'Servidor ocupado, reintentar en 1s',  // configuration_limit_exceeded
    '57P03': 'Servidor ocupado, reintentar en 1s',  // cannot_connect_now
  };
  if (err && err.code && codes[err.code]) return codes[err.code];
  console.error('[db-error]', err?.code || '-', err?.message, err?.detail || '');
  return 'Error interno al procesar la solicitud. Contacte soporte si persiste.';
};

// Devuelve el código HTTP apropiado para un error de Postgres.
// - 53300/53400/57P03 → 503 (Service Unavailable): cliente puede reintentar.
// - 23xxx/22xxx       → 400 (input data): cliente debe corregir el body.
// - resto             → 500 (server error).
const dbErrorStatus = (err) => {
  if (!err || !err.code) return 500;
  if (['53300', '53400', '57P03'].includes(err.code)) return 503;
  if (/^2[23]/.test(err.code)) return 400;
  return 500;
};

// Helper que estandariza la respuesta de error. Devuelve 503 con un Retry-After
// de 1s cuando el pool está saturado (53300), 4xx cuando es input del cliente.
const sendDbError = (res, err) => {
  const status = dbErrorStatus(err);
  if (status === 503) res.setHeader('Retry-After', '1');
  return res.status(status).json({ error: mapDbError(err) });
};

// ¿El error es una violación de UNIQUE (documento duplicado)?
const isUniqueViolation = (err) => !!err && err.code === '23505';

module.exports = { pool, mapDbError, dbErrorStatus, sendDbError, isUniqueViolation };
