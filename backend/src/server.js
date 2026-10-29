const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const db = require('./db');
const { requireAuth } = require('./middleware/auth');
const { seedAgentes, garantirSchemaSeguranca } = require('./scripts/seed-agentes');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET ausente ou curto demais (mín. 32 caracteres).');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' }));

// Suporta chamadas diretas (:3000/...) e via proxy reverso do Nginx (/api/...)
app.use((req, _res, next) => {
  if (req.url === '/api') req.url = '/';
  else if (req.url.startsWith('/api/')) req.url = req.url.slice(4);
  next();
});

app.get(['/health', '/api/health'], async (_req, res) => {
  await db.query('SELECT 1');
  res.json({ ok: true });
});

app.use(require('./routes/auth'));                 // público: POST /login
app.use(require('./routes/seguranca'));            // Segurança do Campus: /seguranca/* (usa requireAgente próprio)
app.use(requireAuth, require('./routes/caronas')); // protegido (apenas usuários acadêmicos)

app.use('/api', require('./routes/auth'));
app.use('/api', requireAuth, require('./routes/caronas'));

// Express 5 propaga erros de handlers async automaticamente
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno' });
});

const PORT = process.env.PORT || 3000;

async function iniciar() {
  try {
    await garantirSchemaSeguranca();
    if (process.env.SEED_AGENTES === 'true') {
      await seedAgentes();
    }
  } catch (err) {
    console.error('[Inicialização] Erro ao sincronizar schema/agentes de segurança:', err);
  }
  app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
}

iniciar();
