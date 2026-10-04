const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT) || 5432,
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

// Red de seguridad: una conexión nunca vuelve al pool con una transacción abierta.
// Si un handler responde tras BEGIN sin COMMIT ni ROLLBACK (un return temprano), la
// siguiente consulta de otra petición en esa conexión correría dentro de esa
// transacción y con sus bloqueos. Aquí se registra el caso y se hace ROLLBACK antes
// de devolverla. client.inTransaction indica si hay una transacción abierta.
const TX_ABRE = /^\s*(BEGIN|START\s+TRANSACTION)\b/i;
const TX_CIERRA = /^\s*(COMMIT|END|ABORT|ROLLBACK(?!\s+TO\b))\b/i;
const rawConnect = pool.connect.bind(pool);
pool.connect = function connect(cb) {
  if (typeof cb === 'function') return rawConnect(cb);
  return rawConnect().then((client) => {
    if (!client.__txGuard) {
      const query = client.query;
      client.query = function trackedQuery(config, ...rest) {
        const sql = typeof config === 'string' ? config : config && config.text;
        if (typeof sql === 'string') {
          if (TX_ABRE.test(sql)) client.inTransaction = true;
          else if (TX_CIERRA.test(sql)) client.inTransaction = false;
        }
        return query.call(this, config, ...rest);
      };
      client.__txGuard = true;
    }
    client.inTransaction = false;
    const release = client.release;
    client.release = (err) => {
      if (err || !client.inTransaction) return release(err);
      console.error('[pg-tx] conexión liberada con una transacción abierta: se hace ROLLBACK');
      client.query('ROLLBACK').then(() => release(), (e) => release(e));
    };
    return client;
  });
};

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

// Texto de error apto para mostrar: los mensajes de validación propios se muestran
// tal cual; los de PostgreSQL y los errores de programación, nunca en crudo.
const userError = (err) => {
  if (!err) return 'Error interno.';
  if (err.severity || err instanceof TypeError || err instanceof RangeError || err instanceof ReferenceError) return mapDbError(err);
  return err.message || 'Error interno.';
};

module.exports = { pool, mapDbError, dbErrorStatus, sendDbError, isUniqueViolation, userError };
