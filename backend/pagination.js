// Helper de paginación server-side (P10).
//
// Defaults conservadores: limit=50, max=200. Si el frontend no pasa nada,
// recibe 50 filas. El FE debe inspeccionar el header X-Total-Count para
// saber si necesita pedir más páginas.

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parsePagination(req, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  const rawLimit = parseInt(req.query.limit, 10);
  const rawOffset = parseInt(req.query.offset, 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : defaultLimit, 1), maxLimit);
  const offset = Math.max(Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0, 0);
  return { limit, offset, page: Math.floor(offset / limit) + 1 };
}

function setPaginationHeaders(res, { total, limit, offset }) {
  res.setHeader('X-Total-Count', String(total));
  res.setHeader('X-Limit', String(limit));
  res.setHeader('X-Offset', String(offset));
  res.setHeader('X-Has-More', String(offset + limit < total));
  // CORS: el navegador no expone estos headers al JS por defecto.
  res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count, X-Limit, X-Offset, X-Has-More');
}

module.exports = { parsePagination, setPaginationHeaders, DEFAULT_LIMIT, MAX_LIMIT };
