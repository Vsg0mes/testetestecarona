const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { CAMPUS } = require('../geofence');
const { verificarSenha, signAgentToken, requireAgente } = require('../middleware/auth');

const router = Router();

const segurancaLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de login. Aguarde 15 minutos.' },
});

// POST /seguranca/login -> Autenticação com login e senha (scrypt + timingSafeEqual)
router.post('/seguranca/login', segurancaLoginLimiter, async (req, res) => {
  const login = String(req.body?.login || '').trim();
  const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';

  if (!login || !senha) {
    verificarSenha(senha, '');
    return res.status(401).json({ erro: 'Login ou senha inválidos' });
  }

  const { rows } = await db.query(
    `SELECT id, login, nome, senha_hash FROM agentes_seguranca WHERE login = $1`,
    [login]
  );
  const agente = rows[0];

  const senhaOk = verificarSenha(senha, agente ? agente.senha_hash : '');
  if (!agente || !senhaOk) {
    return res.status(401).json({ erro: 'Login ou senha inválidos' });
  }

  const dadosAgente = { id: agente.id, login: agente.login, nome: agente.nome };
  return res.json({
    token: signAgentToken(dadosAgente),
    agente: dadosAgente,
  });
});

// GET /seguranca/campus -> Coordenadas do campus para o mapa da segurança
router.get('/seguranca/campus', requireAgente, (_req, res) => {
  res.json(CAMPUS);
});

// GET /seguranca/sos?status=abertos|todos -> Lista chamados com JOINs (sem N+1)
router.get('/seguranca/sos', requireAgente, async (req, res) => {
  const filtroStatus = String(req.query?.status || 'abertos').toLowerCase();
  const apenasAbertos = filtroStatus !== 'todos';

  const { rows } = await db.query(
    `SELECT
       s.id,
       s.carona_id,
       s.usuario_id AS acionado_por_id,
       ua.nome AS acionado_por_nome,
       s.lat,
       s.lng,
       s.status,
       s.atendido_por,
       ag.nome AS atendido_por_nome,
       ag.login AS atendido_por_login,
       s.atendido_em,
       s.resolvido_em,
       s.observacao,
       s.criado_em,
       c.status AS carona_status,
       c.origem_lat,
       c.origem_lng,
       c.destino_lat,
       c.destino_lng,
       c.partida_em,
       c.carro_modelo,
       c.carro_ano,
       c.carro_cor,
       c.carro_placa,
       c.motorista_id,
       um.nome AS motorista_nome,
       um.email AS motorista_email,
       c.passageiro_id,
       up.nome AS passageiro_nome,
       up.email AS passageiro_email,
       lm.lat AS motorista_lat,
       lm.lng AS motorista_lng,
       lm.atualizado_em AS motorista_atualizado_em,
       lp.lat AS passageiro_lat,
       lp.lng AS passageiro_lng,
       lp.atualizado_em AS passageiro_atualizado_em
     FROM eventos_sos s
     JOIN caronas c ON c.id = s.carona_id
     JOIN usuarios ua ON ua.id = s.usuario_id
     JOIN usuarios um ON um.id = c.motorista_id
     LEFT JOIN usuarios up ON up.id = c.passageiro_id
     LEFT JOIN agentes_seguranca ag ON ag.id = s.atendido_por
     LEFT JOIN localizacoes_carona lm ON lm.carona_id = c.id AND lm.usuario_id = c.motorista_id
     LEFT JOIN localizacoes_carona lp ON lp.carona_id = c.id AND lp.usuario_id = c.passageiro_id
     WHERE ($1::boolean = false OR s.status IN ('ABERTO', 'EM_ATENDIMENTO'))
     ORDER BY s.criado_em DESC
     LIMIT 100`,
    [apenasAbertos]
  );

  const chamados = rows.map((r) => {
    const localizacoes = [];
    if (typeof r.motorista_lat === 'number' && typeof r.motorista_lng === 'number') {
      localizacoes.push({
        usuario_id: r.motorista_id,
        nome: r.motorista_nome,
        lat: r.motorista_lat,
        lng: r.motorista_lng,
        atualizado_em: r.motorista_atualizado_em,
        papel: 'MOTORISTA',
      });
    }
    if (r.passageiro_id && typeof r.passageiro_lat === 'number' && typeof r.passageiro_lng === 'number') {
      localizacoes.push({
        usuario_id: r.passageiro_id,
        nome: r.passageiro_nome,
        lat: r.passageiro_lat,
        lng: r.passageiro_lng,
        atualizado_em: r.passageiro_atualizado_em,
        papel: 'PASSAGEIRO',
      });
    }
    return {
      ...r,
      id: Number(r.id),
      veiculo: {
        modelo: r.carro_modelo,
        ano: r.carro_ano,
        cor: r.carro_cor,
        placa: r.carro_placa,
      },
      localizacoes,
    };
  });

  res.json(chamados);
});

// POST /seguranca/sos/:id/assumir -> ABERTO -> EM_ATENDIMENTO (condicional)
router.post('/seguranca/sos/:id/assumir', requireAgente, async (req, res) => {
  const sosId = parseInt(req.params.id, 10);
  if (!Number.isInteger(sosId)) {
    return res.status(400).json({ erro: 'ID de chamado inválido' });
  }

  const { rows } = await db.query(
    `UPDATE eventos_sos
     SET status = 'EM_ATENDIMENTO',
         atendido_por = $2,
         atendido_em = now()
     WHERE id = $1 AND status = 'ABERTO'
     RETURNING *`,
    [sosId, req.agente.id]
  );

  if (!rows[0]) {
    const check = await db.query('SELECT id, status, atendido_por FROM eventos_sos WHERE id = $1', [sosId]);
    if (!check.rows[0]) {
      return res.status(404).json({ erro: 'Chamado SOS não encontrado' });
    }
    return res.status(409).json({ erro: 'Chamado já foi assumido ou encerrado por outro agente' });
  }

  const chamado = rows[0];
  console.info(`[SOS ASSUMIDO] sos=${chamado.id} carona=${chamado.carona_id} agente=${req.agente.login}`);
  return res.json({
    ...chamado,
    id: Number(chamado.id),
    atendido_por_nome: req.agente.nome,
    atendido_por_login: req.agente.login,
  });
});

// POST /seguranca/sos/:id/resolver -> RESOLVIDO ou FALSO_ALARME + carona FINALIZADA na mesma transação
router.post('/seguranca/sos/:id/resolver', requireAgente, async (req, res) => {
  const sosId = parseInt(req.params.id, 10);
  if (!Number.isInteger(sosId)) {
    return res.status(400).json({ erro: 'ID de chamado inválido' });
  }

  const falsoAlarme = req.body?.falsoAlarme === true;
  const novoStatus = falsoAlarme ? 'FALSO_ALARME' : 'RESOLVIDO';
  const observacaoRaw = typeof req.body?.observacao === 'string' ? req.body.observacao.trim() : '';
  const observacao = observacaoRaw ? observacaoRaw.slice(0, 300) : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: atuais } = await client.query(
      'SELECT * FROM eventos_sos WHERE id = $1 FOR UPDATE',
      [sosId]
    );
    const atual = atuais[0];

    if (!atual) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Chamado SOS não encontrado' });
    }
    if (atual.status !== 'EM_ATENDIMENTO') {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'O chamado precisa estar em atendimento para ser resolvido' });
    }
    if (Number(atual.atendido_por) !== Number(req.agente.id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ erro: 'Apenas o agente que assumiu este chamado pode resolvê-lo' });
    }

    const { rows: sosRows } = await client.query(
      `UPDATE eventos_sos
       SET status = $2,
           resolvido_em = now(),
           observacao = $3
       WHERE id = $1
       RETURNING *`,
      [sosId, novoStatus, observacao]
    );

    const { rows: caronaRows } = await client.query(
      `UPDATE caronas
       SET status = 'FINALIZADA'
       WHERE id = $1 AND status = 'EMERGENCIA'
       RETURNING id, status`,
      [atual.carona_id]
    );

    await client.query('COMMIT');
    const resolvido = sosRows[0];
    console.info(
      `[SOS RESOLVIDO] sos=${resolvido.id} carona=${resolvido.carona_id} status=${novoStatus} agente=${req.agente.login}`
    );

    return res.json({
      ...resolvido,
      id: Number(resolvido.id),
      atendido_por_nome: req.agente.nome,
      carona_status: caronaRows[0]?.status || 'FINALIZADA',
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

module.exports = router;

