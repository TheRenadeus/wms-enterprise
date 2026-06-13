// Joi schemas para validación de req.body en endpoints críticos (P4).
//
// Estrategia: solo los endpoints que aceptan input estructurado de usuario y donde
// un payload malformado puede romper transacciones, corromper datos o filtrar internals.
// NO los 198 endpoints — el resto valida en línea con guards manuales que ya existen.

const Joi = require('joi');

// Helper: middleware factory. Usa abortEarly=false para devolver todos los errores.
function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).json({
        error: 'Validación falló: ' + error.details.map(d => d.message).join('; '),
        details: error.details.map(d => ({ path: d.path.join('.'), message: d.message })),
      });
    }
    req.body = value; // body normalizado/coercionado
    next();
  };
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const loginSchema = Joi.object({
  username: Joi.string().trim().min(1).max(50).required(),
  password: Joi.string().min(1).max(200).required(),
});

const kitBuildSchema = Joi.object({
  kit_sku: Joi.string().trim().min(1).max(100).required(),
  client_id: Joi.string().trim().min(1).max(50).required(),
  qty: Joi.number().integer().min(1).max(100000).required(),
  location: Joi.string().trim().max(50).allow('', null),
  username: Joi.string().trim().min(1).max(50).required(),
});

const returnsInspectSchema = Joi.object({
  disposition: Joi.string().valid('RESTOCK', 'SCRAP', 'SUPPLIER').required(),
  inspection_notes: Joi.string().allow('', null).max(2000),
  condition_notes: Joi.string().allow('', null).max(2000),
  qty_accepted: Joi.number().min(0).max(1_000_000).allow(null),
  location_to: Joi.string().trim().max(50).allow('', null),
  lines: Joi.array().items(Joi.object({
    id: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
    qty_ok: Joi.number().min(0).allow(null),
    qty_damaged: Joi.number().min(0).allow(null),
  })).max(10000),
}).or('qty_accepted', 'lines'); // al menos uno

const asnReceiveSchema = Joi.object({
  received: Joi.array().items(Joi.object({
    asn_line_id: Joi.alternatives().try(Joi.number(), Joi.string()),
    line_id: Joi.alternatives().try(Joi.number(), Joi.string()),
    qty_received: Joi.number().min(0).required(),
  })),
  lines: Joi.array().items(Joi.object({
    asn_line_id: Joi.alternatives().try(Joi.number(), Joi.string()),
    line_id: Joi.alternatives().try(Joi.number(), Joi.string()),
    qty_received: Joi.number().min(0).required(),
  })),
}).or('received', 'lines');

const pickWaveCreateSchema = Joi.object({
  name: Joi.string().trim().max(100).allow('', null),
  zone_filter: Joi.string().trim().max(50).allow('', null),
  line_ids: Joi.array().items(Joi.alternatives().try(Joi.number(), Joi.string())).min(1).max(10000).required(),
});

const locationCreateSchema = Joi.object({
  location_id: Joi.string().trim().min(1).max(50).optional(),  // auto-generado si no llega
  warehouse:   Joi.string().trim().max(20).optional(),          // bodega física (número o texto)
  zone_code:   Joi.string().trim().max(100).allow('', null),    // glosa descriptiva de la bodega
  aisle:       Joi.string().trim().max(20).allow('', null),     // pasillo — preserve case
  row_num:     Joi.number().integer().min(1).allow(null),       // columna
  level:       Joi.number().integer().min(1).allow(null),       // fila
  loc_type:    Joi.string().valid('PALLET','PICKING','CAMARA','CUARENTENA','OFICINA','RACK','SHELF','FLOOR','DOCK').default('RACK'),
  max_kg:      Joi.number().min(0).default(0),
  max_pallets: Joi.number().integer().min(0).default(0),
});

const statusCreateSchema = Joi.object({
  id: Joi.string().trim().min(1).max(50).required(),
  description: Joi.string().trim().max(200).allow('', null),
  color: Joi.string().trim().max(20).allow('', null),
  blocks_outbound: Joi.boolean().default(false),
});

const documentTypeCreateSchema = Joi.object({
  id: Joi.string().trim().min(1).max(50).required(),
  description: Joi.string().trim().min(1).max(200).required(),
  flow_type: Joi.string().valid('IN', 'OUT', 'BOTH').default('BOTH'),
});

module.exports = {
  validateBody,
  schemas: {
    login: loginSchema,
    kitBuild: kitBuildSchema,
    returnsInspect: returnsInspectSchema,
    asnReceive: asnReceiveSchema,
    pickWaveCreate: pickWaveCreateSchema,
    locationCreate: locationCreateSchema,
    statusCreate: statusCreateSchema,
    documentTypeCreate: documentTypeCreateSchema,
  },
};
