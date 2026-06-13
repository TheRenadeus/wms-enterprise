// Demo / sandbox router: login con escenario y rol, cambio en caliente, feedback.
// Las constantes SANDBOX_SCENARIOS y SANDBOX_ROLES viven acá porque solo se usan
// para emitir JWT y devolver la config de UI. El bloqueo de escrituras del rol DEMO
// lo hace `apiDemoBlock` en middleware.js (sigue intacto).

const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const { pool, mapDbError } = require('../db');
const { JWT_SECRET, requireAuth, requireSuperAdmin } = require('../middleware');
const { resetState } = require('../sandbox-state');

const router = express.Router();

// Limiter dedicado del demo: tolerante con loops de UI pero protege contra abuso.
// LOAD_TEST no lo bypassa porque demo no es ruta crítica.
const demoLoginLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: { error: 'Demasiados intentos de demo.' } });

const SANDBOX_SCENARIOS = {
  PROPIO:  { label: 'Bodega Propia',   desc: 'Gestionas tu propio inventario', mode: 'PROPIO' },
  '3PL':   { label: 'Operador 3PL',    desc: 'Gestionas inventario de múltiples clientes', mode: '3PL' },
  HYBRID:  { label: 'Híbrido',         desc: 'Inventario propio + clientes externos', mode: 'HYBRID' },
};

const SANDBOX_ROLES = {
  ADMIN:             { label: 'Administrador',    icon: '🏢', desc: 'Control total del sistema' },
  EJECUTIVO_CUENTA:  { label: 'Jefe de Bodega',   icon: '📦', desc: 'Operaciones diarias de almacén' },
  AUDITOR:           { label: 'Auditor',           icon: '🔎', desc: 'Vista de solo lectura para control' },
  PICKER:            { label: 'Picker',            icon: '📱', desc: 'Tareas de picking en el piso' },
  CLIENTE:           { label: 'Cliente 3PL',       icon: '🏪', desc: 'Portal de solo lectura para clientes' },
};

router.get('/demo/sandbox-config', (req, res) => {
  res.json({ scenarios: SANDBOX_SCENARIOS, roles: SANDBOX_ROLES });
});

router.post('/demo/login', demoLoginLimiter, async (req, res) => {
  const { scenario, role } = req.body;
  if (!scenario || !SANDBOX_SCENARIOS[scenario]) return res.status(400).json({ error: 'Escenario inválido.' });
  if (!role || !SANDBOX_ROLES[role]) return res.status(400).json({ error: 'Rol inválido.' });
  try {
    const sc = SANDBOX_SCENARIOS[scenario];
    const rl = SANDBOX_ROLES[role];
    const token = jwt.sign(
      { username: `sandbox_${role.toLowerCase()}`, role, allowed_clients: 'ALL', allowed_modules: 'ALL', is_demo: true, sandbox_scenario: scenario },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({
      success: true, token,
      user: {
        username: `sandbox_${role.toLowerCase()}`, full_name: `${rl.icon} ${rl.label}`, role,
        allowed_clients: 'ALL', allowed_modules: 'ALL', is_demo: true,
        sandbox_scenario: scenario, sandbox_mode: sc.mode,
        persona_label: rl.label, persona_icon: rl.icon,
      }
    });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/demo/switch-role', requireAuth, async (req, res) => {
  if (!req.user.is_demo) return res.status(403).json({ error: 'Solo disponible en modo sandbox.' });
  const { role } = req.body;
  if (!role || !SANDBOX_ROLES[role]) return res.status(400).json({ error: 'Rol inválido.' });
  const rl = SANDBOX_ROLES[role];
  const scenario = req.user.sandbox_scenario || 'HYBRID';
  const sc = SANDBOX_SCENARIOS[scenario] || SANDBOX_SCENARIOS.HYBRID;
  const token = jwt.sign(
    { username: `sandbox_${role.toLowerCase()}`, role, allowed_clients: 'ALL', allowed_modules: 'ALL', is_demo: true, sandbox_scenario: scenario },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
  res.json({
    success: true, token,
    user: {
      username: `sandbox_${role.toLowerCase()}`, full_name: `${rl.icon} ${rl.label}`, role,
      allowed_clients: 'ALL', allowed_modules: 'ALL', is_demo: true,
      sandbox_scenario: scenario, sandbox_mode: sc.mode,
      persona_label: rl.label, persona_icon: rl.icon,
    }
  });
});

router.post('/demo/switch-scenario', requireAuth, async (req, res) => {
  if (!req.user.is_demo) return res.status(403).json({ error: 'Solo disponible en modo sandbox.' });
  const { scenario } = req.body;
  if (!scenario || !SANDBOX_SCENARIOS[scenario]) return res.status(400).json({ error: 'Escenario inválido.' });
  const sc = SANDBOX_SCENARIOS[scenario];
  const role = req.user.role || 'ADMIN';
  const rl = SANDBOX_ROLES[role] || SANDBOX_ROLES.ADMIN;
  const token = jwt.sign(
    { username: `sandbox_${role.toLowerCase()}`, role, allowed_clients: 'ALL', allowed_modules: 'ALL', is_demo: true, sandbox_scenario: scenario },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
  res.json({
    success: true, token,
    user: {
      username: `sandbox_${role.toLowerCase()}`, full_name: `${rl.icon} ${rl.label}`, role,
      allowed_clients: 'ALL', allowed_modules: 'ALL', is_demo: true,
      sandbox_scenario: scenario, sandbox_mode: sc.mode,
      persona_label: rl.label, persona_icon: rl.icon,
    }
  });
});

router.post('/demo/feedback', requireAuth, async (req, res) => {
  const { message, rating, persona_label } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Mensaje requerido.' });
  try {
    const r = await pool.query(`SELECT value FROM system_config WHERE key='demo_feedback'`);
    const existing = r.rows.length ? JSON.parse(r.rows[0].value) : [];
    const entry = { id: Date.now(), username: req.user.username, persona_label: persona_label || '', message: message.trim(), rating: rating || null, created_at: new Date().toISOString() };
    const updated = [entry, ...existing].slice(0, 300);
    await pool.query(`INSERT INTO system_config (key, value, updated_by, updated_at) VALUES ('demo_feedback',$1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$1, updated_by=$2, updated_at=NOW()`, [JSON.stringify(updated), req.user.username]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/demo/feedback', requireSuperAdmin, async (req, res) => {
  try {
    const r = await pool.query(`SELECT value FROM system_config WHERE key='demo_feedback'`);
    res.json(r.rows.length ? JSON.parse(r.rows[0].value) : []);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// POST /demo/reset — reinicia el overlay en memoria del usuario sandbox.
router.post('/demo/reset', requireAuth, (req, res) => {
  if (!req.user.is_demo) return res.status(403).json({ error: 'Solo disponible en modo sandbox.' });
  resetState(req.user);
  res.json({ success: true });
});

// GET /demo/tutorial-progress — lee el progreso del tutorial guardado en system_config.
router.get('/demo/tutorial-progress', requireAuth, async (req, res) => {
  if (!req.user.is_demo) return res.status(403).json({ error: 'Solo disponible en modo sandbox.' });
  const key = `tutorial_progress_${req.user.username}`;
  try {
    const r = await pool.query(`SELECT value FROM system_config WHERE key=$1`, [key]);
    res.json(r.rows.length ? JSON.parse(r.rows[0].value) : { mision: 0, completadas: [] });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// POST /demo/tutorial-progress — guarda el progreso en system_config.
router.post('/demo/tutorial-progress', requireAuth, async (req, res) => {
  if (!req.user.is_demo) return res.status(403).json({ error: 'Solo disponible en modo sandbox.' });
  const key = `tutorial_progress_${req.user.username}`;
  const { mision, completadas } = req.body;
  try {
    await pool.query(
      `INSERT INTO system_config (key, value, updated_by, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (key) DO UPDATE SET value=$2, updated_by=$3, updated_at=NOW()`,
      [key, JSON.stringify({ mision: mision || 0, completadas: completadas || [] }), req.user.username]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
