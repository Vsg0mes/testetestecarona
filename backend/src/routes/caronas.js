const { Router } = require('express');
const db = require('../db');
const { CAMPUS, pertoDoCampus } = require('../geofence');

const router = Router();

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Garante que o usuário participa da carona (motorista ou passageiro)
async function carregarCaronaDoUsuario(id, userId) {
  const { rows } = await db.query(
    `SELECT * FROM caronas WHERE id = $1 AND (motorista_id = $2 OR passageiro_id = $2)`,
    [id, userId]
  );
  return rows[0];
}

// GET /campus -> coordenada fixa para o app travar o formulário
router.get('/campus', (_req, res) => res.json(CAMPUS));

// GET /caronas -> caronas abertas
router.get('/caronas', async (_req, res) => {
  const { rows } = await db.query(
    `SELECT c.*, u.nome AS motorista_nome FROM caronas c
     JOIN usuarios u ON u.id = c.motorista_id
     WHERE c.status = 'ABERTA' AND c.partida_em > now() - interval '30 minutes'
     ORDER BY c.partida_em LIMIT 50`
  );
  res.json(rows);
});

// POST /caronas -> cria carona com geofencing
router.post('/caronas', async (req, res) => {
  const { origem, destino, partidaEm, vagas = 1 } = req.body || {};

  if (!isNum(origem?.lat) || !isNum(origem?.lng) || !isNum(destino?.lat) || !isNum(destino?.lng)) {
    return res.status(400).json({ erro: 'Origem e destino inválidos' });
  }
  if (!pertoDoCampus(origem.lat, origem.lng) && !pertoDoCampus(destino.lat, destino.lng)) {
    return res.status(422).json({ erro: 'A carona precisa começar ou terminar no campus' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO caronas (motorista_id, origem_lat, origem_lng, destino_lat, destino_lng, partida_em, vagas)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, origem.lat, origem.lng, destino.lat, destino.lng, partidaEm || new Date(), vagas]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23514') {
      // violação de CHECK constraint (segunda linha de defesa no banco)
      return res.status(422).json({ erro: 'Rejeitado pela regra de segurança do banco', constraint: e.constraint });
    }
    throw e;
  }
});

// POST /caronas/:id/entrar -> passageiro reserva
router.post('/caronas/:id/entrar', async (req, res) => {
  const { rows } = await db.query(
    `UPDATE caronas SET passageiro_id = $2, status = 'EM_ANDAMENTO'
     WHERE id = $1 AND status = 'ABERTA' AND passageiro_id IS NULL AND motorista_id <> $2
     RETURNING *`,
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(409).json({ erro: 'Carona indisponível' });
  res.json(rows[0]);
});

// GET /minha-carona -> id do usuário + carona ativa (motorista ou passageiro)
router.get('/minha-carona', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.*, m.nome AS motorista_nome, p.nome AS passageiro_nome
     FROM caronas c
     JOIN usuarios m ON m.id = c.motorista_id
     LEFT JOIN usuarios p ON p.id = c.passageiro_id
     WHERE (c.motorista_id = $1 OR c.passageiro_id = $1)
       AND c.status IN ('ABERTA', 'EM_ANDAMENTO', 'EMERGENCIA')
     ORDER BY c.criado_em DESC LIMIT 1`,
    [req.user.id]
  );
  res.json({ usuarioId: req.user.id, carona: rows[0] || null });
});

// POST /caronas/:id/finalizar -> encerra (motorista ou passageiro); EMERGENCIA não é encerrada pelo app
router.post('/caronas/:id/finalizar', async (req, res) => {
  const { rows } = await db.query(
    `UPDATE caronas SET status = CASE WHEN status = 'ABERTA' THEN 'CANCELADA'::status_carona ELSE 'FINALIZADA'::status_carona END
     WHERE id = $1 AND (motorista_id = $2 OR passageiro_id = $2) AND status IN ('ABERTA', 'EM_ANDAMENTO')
     RETURNING *`,
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(409).json({ erro: 'Carona não pode ser encerrada' });
  res.json(rows[0]);
});

// POST /caronas/:id/localizacao  body: { lat, lng } -> atualiza minha posição (só em carona ativa)
router.post('/caronas/:id/localizacao', async (req, res) => {
  const { lat, lng } = req.body || {};
  if (!isNum(lat) || !isNum(lng)) return res.status(400).json({ erro: 'Coordenadas inválidas' });
  const carona = await carregarCaronaDoUsuario(req.params.id, req.user.id);
  if (!carona || !['EM_ANDAMENTO', 'EMERGENCIA'].includes(carona.status)) {
    return res.status(409).json({ erro: 'Localização só é compartilhada em carona em andamento' });
  }
  await db.query(
    `INSERT INTO localizacoes_carona (carona_id, usuario_id, lat, lng) VALUES ($1,$2,$3,$4)
     ON CONFLICT (carona_id, usuario_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, atualizado_em = now()`,
    [carona.id, req.user.id, lat, lng]
  );
  res.status(204).end();
});

// GET /caronas/:id/localizacoes -> posição do motorista e do passageiro
router.get('/caronas/:id/localizacoes', async (req, res) => {
  const carona = await carregarCaronaDoUsuario(req.params.id, req.user.id);
  if (!carona) return res.status(404).json({ erro: 'Carona não encontrada' });
  const { rows } = await db.query(
    `SELECT l.usuario_id, u.nome, l.lat, l.lng, l.atualizado_em,
            CASE WHEN l.usuario_id = $2 THEN 'MOTORISTA' ELSE 'PASSAGEIRO' END AS papel
     FROM localizacoes_carona l JOIN usuarios u ON u.id = l.usuario_id
     WHERE l.carona_id = $1`,
    [carona.id, carona.motorista_id]
  );
  res.json(rows);
});

// POST /caronas/:id/sos -> EMERGÊNCIA
router.post('/caronas/:id/sos', async (req, res) => {
  const carona = await carregarCaronaDoUsuario(req.params.id, req.user.id);
  if (!carona) return res.status(404).json({ erro: 'Carona não encontrada' });

  const lat = isNum(req.body?.lat) ? req.body.lat : null;
  const lng = isNum(req.body?.lng) ? req.body.lng : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE caronas SET status = 'EMERGENCIA', sos_em = now(), sos_lat = $2, sos_lng = $3
       WHERE id = $1 RETURNING *`,
      [carona.id, lat, lng]
    );
    await client.query(
      `INSERT INTO eventos_sos (carona_id, usuario_id, lat, lng) VALUES ($1,$2,$3,$4)`,
      [carona.id, req.user.id, lat, lng]
    );
    await client.query('COMMIT');
    console.warn(`[SOS] carona=${carona.id} usuario=${req.user.id} lat=${lat} lng=${lng}`);
    res.json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// GET /mensagens -> catálogo de respostas prontas
router.get('/mensagens', async (_req, res) => {
  const { rows } = await db.query('SELECT id, texto FROM mensagens_pre_definidas ORDER BY id');
  res.json(rows);
});

// GET /caronas/:id/mensagens
router.get('/caronas/:id/mensagens', async (req, res) => {
  const carona = await carregarCaronaDoUsuario(req.params.id, req.user.id);
  if (!carona) return res.status(404).json({ erro: 'Carona não encontrada' });
  const { rows } = await db.query(
    `SELECT m.id, m.autor_id, m.mensagem_id, COALESCE(m.texto, p.texto) AS texto, m.enviado_em
     FROM mensagens_carona m LEFT JOIN mensagens_pre_definidas p ON p.id = m.mensagem_id
     WHERE m.carona_id = $1 ORDER BY m.enviado_em`,
    [carona.id]
  );
  res.json(rows);
});

const CHAT_LIVRE = process.env.CHAT_LIVRE === 'true';

// GET /config -> o app sabe se mostra o campo de texto
router.get('/config', (_req, res) => res.json({ chatLivre: CHAT_LIVRE }));

// POST /caronas/:id/mensagens  body: { mensagemId: 1|2|3 } ou { texto } se CHAT_LIVRE=true
router.post('/caronas/:id/mensagens', async (req, res) => {
  const mensagemId = req.body?.mensagemId;
  const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : null;
  const temId = Number.isInteger(mensagemId);
  if (!temId && !(CHAT_LIVRE && texto)) {
    return res.status(400).json({ erro: 'Apenas IDs de mensagens pré-definidas são aceitos' });
  }
  if (!temId && texto.length > 300) return res.status(400).json({ erro: 'Mensagem muito longa (máx. 300)' });
  const carona = await carregarCaronaDoUsuario(req.params.id, req.user.id);
  if (!carona) return res.status(404).json({ erro: 'Carona não encontrada' });
  try {
    const { rows } = await db.query(
      `INSERT INTO mensagens_carona (carona_id, autor_id, mensagem_id, texto) VALUES ($1,$2,$3,$4) RETURNING *`,
      [carona.id, req.user.id, temId ? mensagemId : null, temId ? null : texto]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23503') return res.status(400).json({ erro: 'Mensagem inexistente' });
    throw e;
  }
});

module.exports = router;
