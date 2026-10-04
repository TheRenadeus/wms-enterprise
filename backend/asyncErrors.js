// Express 4 no captura las promesas rechazadas de los handlers async: el rechazo
// queda sin manejar y, en Node 15 o superior, termina el proceso (la API se cae para
// todos). Con este parche, un handler que devuelve una promesa rechazada pasa el
// error a next(err) y lo responde apiErrorHandler con un 500 genérico.
// Express 5 lo hace de serie: al migrar, este archivo sobra.
const Layer = require('express/lib/router/layer');

Layer.prototype.handle_request = function handle(req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return next(); // manejador de errores: lo invoca handle_error
  try {
    const ret = fn(req, res, next);
    if (ret && typeof ret.then === 'function') {
      ret.then(null, (err) => next(err || new Error('Promesa rechazada sin motivo')));
    }
  } catch (err) {
    next(err);
  }
};
