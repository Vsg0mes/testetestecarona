const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { CAMPUS } = require('../geofence');
const {
  verificarSenha,
  signAgentToken,
  requireAgente,
  requireUsuarioOuAgente,
} = require('../middleware/auth');

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

// GET /seguranca/sos?status=abertos|todos -> Lista chamados com identificação clara de quem acionou (Motorista ou Passageiro), placa/veículo e GPS ao vivo
router.get('/seguranca/sos', requireAgente, async (req, res) => {
  const filtroStatus = String(req.query?.status || 'abertos').toLowerCase();
  const apenasAbertos = filtroStatus !== 'todos';

  const { rows } = await db.query(
    `SELECT
       s.id,
       s.carona_id,
       s.usuario_id AS acionado_por_id,
       ua.nome AS acionado_por_nome,
       COALESCE(
         s.acionado_por_papel,
         CASE WHEN s.usuario_id = c.motorista_id THEN 'MOTORISTA' ELSE 'PASSAGEIRO' END
       ) AS acionado_por_papel,
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
       la.lat AS autor_vivo_lat,
       la.lng AS autor_vivo_lng,
       la.atualizado_em AS autor_atualizado_em,
       COALESCE(locs.lista, '[]'::json) AS localizacoes_json,
       COALESCE(pass.nomes, up.nome) AS passageiros_nomes
     FROM eventos_sos s
     JOIN caronas c ON c.id = s.carona_id
     JOIN usuarios ua ON ua.id = s.usuario_id
     JOIN usuarios um ON um.id = c.motorista_id
     LEFT JOIN usuarios up ON up.id = c.passageiro_id
     LEFT JOIN agentes_seguranca ag ON ag.id = s.atendido_por
     LEFT JOIN localizacoes_carona lm ON lm.carona_id = c.id AND lm.usuario_id = c.motorista_id
     LEFT JOIN localizacoes_carona la ON la.carona_id = c.id AND la.usuario_id = s.usuario_id
     LEFT JOIN LATERAL (
       SELECT json_agg(
         json_build_object(
           'usuario_id', l.usuario_id,
           'nome', u.nome,
           'lat', l.lat,
           'lng', l.lng,
           'atualizado_em', l.atualizado_em,
           'papel', CASE WHEN l.usuario_id = c.motorista_id THEN 'MOTORISTA' ELSE 'PASSAGEIRO' END
         )
       ) AS lista
       FROM localizacoes_carona l
       JOIN usuarios u ON u.id = l.usuario_id
       WHERE l.carona_id = c.id
     ) locs ON true
     LEFT JOIN LATERAL (
       SELECT string_agg(u2.nome, ', ' ORDER BY pc.id) AS nomes
       FROM passageiros_carona pc
       JOIN usuarios u2 ON u2.id = pc.usuario_id
       WHERE pc.carona_id = c.id
     ) pass ON true
     WHERE ($1::boolean = false OR s.status IN ('ABERTO', 'EM_ATENDIMENTO'))
     ORDER BY s.criado_em DESC
     LIMIT 100`,
    [apenasAbertos]
  );

  const chamados = rows.map((r) => {
    const papel = r.acionado_por_papel === 'MOTORISTA' ? 'MOTORISTA' : 'PASSAGEIRO';
    const acionadoPorDescricao =
      papel === 'MOTORISTA'
        ? `SOS acionado pelo Motorista: ${r.acionado_por_nome}`
        : `SOS acionado por Passageiro: ${r.acionado_por_nome}`;

    const latAoVivo =
      typeof r.autor_vivo_lat === 'number'
        ? r.autor_vivo_lat
        : typeof r.motorista_lat === 'number'
          ? r.motorista_lat
          : r.lat;
    const lngAoVivo =
      typeof r.autor_vivo_lng === 'number'
        ? r.autor_vivo_lng
        : typeof r.motorista_lng === 'number'
          ? r.motorista_lng
          : r.lng;

    return {
      ...r,
      id: Number(r.id),
      acionado_por_papel: papel,
      acionado_por_descricao: acionadoPorDescricao,
      passageiro_nome: r.passageiros_nomes || r.passageiro_nome || null,
      lat_ao_vivo: latAoVivo,
      lng_ao_vivo: lngAoVivo,
      veiculo: {
        modelo: r.carro_modelo,
        ano: r.carro_ano,
        cor: r.carro_cor,
        placa: r.carro_placa,
      },
      localizacoes: Array.isArray(r.localizacoes_json) ? r.localizacoes_json : [],
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

// POST /seguranca/sos/:id/resolver -> RESOLVIDO ou FALSO_ALARME
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

    let caronaStatus = null;
    if (!falsoAlarme) {
      const { rows: caronaRows } = await client.query(
        `UPDATE caronas
         SET status = 'FINALIZADA'
         WHERE id = $1 AND status IN ('ABERTA', 'EM_ANDAMENTO', 'EMERGENCIA')
         RETURNING id, status`,
        [atual.carona_id]
      );
      caronaStatus = caronaRows[0]?.status || 'FINALIZADA';
    }

    await client.query('COMMIT');
    const resolvido = sosRows[0];
    console.info(
      `[SOS RESOLVIDO] sos=${resolvido.id} carona=${resolvido.carona_id} status=${novoStatus} agente=${req.agente.login}`
    );

    return res.json({
      ...resolvido,
      id: Number(resolvido.id),
      atendido_por_nome: req.agente.nome,
      carona_status: caronaStatus || 'EM_ANDAMENTO',
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// Helper: carrega o chamado SOS e valida estritamente se o requisitante é um AGENTE ou o próprio AUTOR do SOS
async function carregarSosComPermissaoChat(req, res) {
  const sosId = parseInt(req.params.id, 10);
  if (!Number.isInteger(sosId)) {
    res.status(400).json({ erro: 'ID de chamado SOS inválido' });
    return null;
  }

  const { rows } = await db.query(
    `SELECT s.*,
            u.nome AS vitima_nome,
            ag.nome AS agente_nome
     FROM eventos_sos s
     JOIN usuarios u ON u.id = s.usuario_id
     LEFT JOIN agentes_seguranca ag ON ag.id = s.atendido_por
     WHERE s.id = $1`,
    [sosId]
  );
  const sos = rows[0];
  if (!sos) {
    res.status(404).json({ erro: 'Chamado SOS não encontrado' });
    return null;
  }

  // RBAC Estrito: apenas Agente de Segurança (role: 'AGENTE') ou o próprio usuário que disparou o SOS (s.usuario_id)
  const ehAgente = req.authRole === 'AGENTE' && req.agente?.id;
  const ehAutorSos =
    req.authRole === 'USUARIO' &&
    req.user?.id &&
    Number(req.user.id) === Number(sos.usuario_id);

  if (!ehAgente && !ehAutorSos) {
    res.status(403).json({
      erro: 'Acesso negado: apenas o usuário que acionou o SOS e os agentes da Segurança do Campus possuem permissão para este chat privado.',
    });
    return null;
  }

  return sos;
}

// GET /seguranca/sos/:id/mensagens -> Lista mensagens do chat privado do SOS (Restrito: Agente ou Vítima autora do SOS)
router.get('/seguranca/sos/:id/mensagens', requireUsuarioOuAgente, async (req, res) => {
  const sos = await carregarSosComPermissaoChat(req, res);
  if (!sos) return;

  const { rows } = await db.query(
    `SELECT id,
            sos_id,
            autor_tipo,
            usuario_id,
            agente_id,
            autor_nome,
            autor_nome AS nome,
            texto,
            enviado_em
     FROM sos_chat_mensagens
     WHERE sos_id = $1
     ORDER BY enviado_em ASC, id ASC`,
    [sos.id]
  );

  res.json(
    rows.map((m) => ({
      ...m,
      id: Number(m.id),
      sos_id: Number(m.sos_id),
    }))
  );
});

// POST /seguranca/sos/:id/mensagens -> Envia mensagem no chat privado do SOS (Restrito: Agente ou Vítima autora do SOS)
router.post('/seguranca/sos/:id/mensagens', requireUsuarioOuAgente, async (req, res) => {
  const sos = await carregarSosComPermissaoChat(req, res);
  if (!sos) return;

  const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : '';
  if (!texto) {
    return res.status(400).json({ erro: 'Digite uma mensagem para enviar' });
  }
  if (texto.length > 500) {
    return res.status(400).json({ erro: 'Mensagem muito longa (máx. 500 caracteres)' });
  }

  const ehAgente = req.authRole === 'AGENTE';
  const autorTipo = ehAgente ? 'AGENTE' : 'USUARIO';
  const usuarioId = ehAgente ? null : req.user.id;
  const agenteId = ehAgente ? req.agente.id : null;
  const autorNome = ehAgente
    ? req.agente.nome || req.agente.login || 'Agente de Segurança'
    : sos.vitima_nome || req.user.email.split('@')[0];

  const { rows } = await db.query(
    `INSERT INTO sos_chat_mensagens (sos_id, autor_tipo, usuario_id, agente_id, autor_nome, texto)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, sos_id, autor_tipo, usuario_id, agente_id, autor_nome, autor_nome AS nome, texto, enviado_em`,
    [sos.id, autorTipo, usuarioId, agenteId, autorNome, texto]
  );

  const msg = rows[0];
  res.status(201).json({
    ...msg,
    id: Number(msg.id),
    sos_id: Number(msg.sos_id),
  });
});

module.exports = router;
