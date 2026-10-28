const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { signToken } = require('../middleware/auth');

const router = Router();
const DOMAIN = (process.env.EMAIL_DOMAIN || '@unifeb.edu.br').toLowerCase();
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+$/;

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });

// POST /login  -> Mock de SSO institucional
router.post('/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();

  if (!EMAIL_RE.test(email) || !email.endsWith(DOMAIN)) {
    return res.status(403).json({ erro: `Use seu e-mail institucional (${DOMAIN})` });
  }

  const { rows } = await db.query(
    `INSERT INTO usuarios (email, nome) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, email, nome`,
    [email, email.split('@')[0]]
  );
  const user = rows[0];
  res.json({ token: signToken(user), usuario: user });
});

module.exports = router;
