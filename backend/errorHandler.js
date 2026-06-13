// Error handler centralizado para /api (P7).
//
// Captura excepciones no manejadas que escapan de los try/catch de cada handler.
// Loguea con stack en server y devuelve JSON limpio al cliente (sin filtrar internals).
// Se monta AL FINAL de la cadena, después de todas las rutas pero antes del catch-all
// estático del frontend.
//
// Para que Express lo identifique como error handler, la firma debe tener 4 args.

const { mapDbError } = require('./db');

function apiErrorHandler(err, req, res, next) {
  // Si la respuesta ya empezó a enviarse, delegar al default de Express.
  if (res.headersSent) return next(err);

  const isApi = req.path && req.path.startsWith('/api');
  // BodyParser: JSON malformado → 400 limpio, sin stack.
  if (err.type === 'entity.parse.failed' || err.name === 'SyntaxError') {
    return res.status(400).json({ error: 'JSON malformado en el body.' });
  }

  console.error('[unhandled]', req.method, req.path, '—', err.code || err.name || '-', err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(0, 4).join('\n'));

  if (isApi) {
    return res.status(err.statusCode || 500).json({ error: mapDbError(err) });
  }
  return res.status(500).send('Internal Server Error');
}

module.exports = { apiErrorHandler };
