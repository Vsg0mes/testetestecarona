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
  const {
    origem,
    destino,
    partidaEm,
    horarioPartida,
    vagas = 1,
    carroModelo,
    carroAno,
    carroCor,
    carroPlaca,
  } = req.body || {};

  if (!isNum(origem?.lat) || !isNum(origem?.lng) || !isNum(destino?.lat) || !isNum(destino?.lng)) {
    return res.status(400).json({ erro: 'Origem e destino inválidos' });
  }
  if (!pertoDoCampus(origem.lat, origem.lng) && !pertoDoCampus(destino.lat, destino.lng)) {
    return res.status(422).json({ erro: 'A carona precisa começar ou terminar no campus' });
  }

  // Parse do horário de partida escolhido pelo motorista
  let dataPartida = new Date();
  if (partidaEm && !isNaN(new Date(partidaEm).getTime())) {
    dataPartida = new Date(partidaEm);
  } else if (horarioPartida && /^\d{1,2}:\d{2}$/.test(horarioPartida)) {
    const [h, m] = horarioPartida.split(':').map(Number);
    dataPartida = new Date();
    dataPartida.setHours(h, m, 0, 0);
    // Se o horário digitado for mais de 30 minutos no passado de hoje, assume dia seguinte
    if (dataPartida.getTime() < Date.now() - 30 * 60 * 1000) {
      dataPartida.setDate(dataPartida.getDate() + 1);
    }
  }

  const vagasInt = parseInt(vagas, 10);
  const vagasValidas = Number.isInteger(vagasInt) && vagasInt >= 1 && vagasInt <= 6 ? vagasInt : 1;
  const modelo = (carroModelo || req.body?.carro_modelo || '').trim().slice(0, 80) || null;
  const anoInt = parseInt(carroAno || req.body?.carro_ano, 10);
  const anoValido = Number.isInteger(anoInt) && anoInt >= 1970 && anoInt <= 2035 ? anoInt : null;
  const cor = (carroCor || req.body?.carro_cor || '').trim().slice(0, 40) || null;
  const placa = (carroPlaca || req.body?.carro_placa || '').trim().toUpperCase().slice(0, 20) || null;

  try {
    const { rows } = await db.query(
      `INSERT INTO caronas (
         motorista_id, origem_lat, origem_lng, destino_lat, destino_lng,
         partida_em, vagas, carro_modelo, carro_ano, carro_cor, carro_placa
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        req.user.id,
        origem.lat,
        origem.lng,
        destino.lat,
        destino.lng,
        dataPartida,
        vagasValidas,
        modelo,
        anoValido,
        cor,
        placa,
      ]
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

// GET /minha-carona -> id do usuário + carona ativa (motorista ou passageiro) + status do SOS
router.get('/minha-carona', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.*,
            m.nome AS motorista_nome,
            p.nome AS passageiro_nome,
            sos.id AS sos_id,
            sos.status AS sos_status,
            sos.atendido_em AS sos_atendido_em,
            ag.nome AS sos_agente_nome
     FROM caronas c
     JOIN usuarios m ON m.id = c.motorista_id
     LEFT JOIN usuarios p ON p.id = c.passageiro_id
     LEFT JOIN LATERAL (
       SELECT s.id, s.status, s.atendido_por, s.atendido_em
       FROM eventos_sos s
       WHERE s.carona_id = c.id
       ORDER BY s.criado_em DESC
       LIMIT 1
     ) sos ON true
     LEFT JOIN agentes_seguranca ag ON ag.id = sos.atendido_por
     WHERE (c.motorista_id = $1 OR c.passageiro_id = $1)
       AND c.status IN ('ABERTA', 'EM_ANDAMENTO', 'EMERGENCIA')
     ORDER BY
       CASE c.status
         WHEN 'EMERGENCIA' THEN 1
         WHEN 'EM_ANDAMENTO' THEN 2
         ELSE 3
       END,
       c.criado_em DESC
     LIMIT 1`,
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

async function dispararWebhookSos(sos, carona, usuarioId) {
  const webhookUrl = (process.env.SOS_WEBHOOK_URL || '').trim();
  if (!webhookUrl) return;
  try {
    const { rows } = await db.query(
      `SELECT um.nome AS motorista_nome, up.nome AS passageiro_nome, ua.nome AS acionado_por_nome
       FROM caronas c
       JOIN usuarios um ON um.id = c.motorista_id
       LEFT JOIN usuarios up ON up.id = c.passageiro_id
       LEFT JOIN usuarios ua ON ua.id = $2
       WHERE c.id = $1`,
      [carona.id, usuarioId]
    );
    const info = rows[0] || {};
    const lat = sos.lat ?? carona.sos_lat ?? carona.origem_lat;
    const lng = sos.lng ?? carona.sos_lng ?? carona.origem_lng;
    const payload = {
      evento: 'SOS_ACIONADO',
      sosId: Number(sos.id),
      caronaId: carona.id,
      acionadoPor: info.acionado_por_nome || `Usuário #${usuarioId}`,
      motorista: info.motorista_nome || null,
      passageiro: info.passageiro_nome || null,
      placa: carona.carro_placa || null,
      veiculo: {
        modelo: carona.carro_modelo,
        ano: carona.carro_ano,
        cor: carona.carro_cor,
        placa: carona.carro_placa,
      },
      lat,
      lng,
      mapaUrl:
        typeof lat === 'number' && typeof lng === 'number'
          ? `https://www.google.com/maps?q=${lat},${lng}`
          : null,
      criadoEm: sos.criado_em,
    };
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    console.warn(`[SOS Webhook] Falha ao enviar notificação externa: ${err.message}`);
  }
}

// POST /caronas/:id/sos -> EMERGÊNCIA (idempotente para SOS ativo na mesma carona; motorista ou passageiro)
router.post('/caronas/:id/sos', async (req, res) => {
  const caronaPerm = await carregarCaronaDoUsuario(req.params.id, req.user.id);
  if (!caronaPerm) return res.status(404).json({ erro: 'Carona não encontrada' });
  if (['FINALIZADA', 'CANCELADA'].includes(caronaPerm.status)) {
    return res.status(409).json({ erro: 'Não é possível acionar SOS em carona encerrada' });
  }

  let lat = isNum(req.body?.lat) ? req.body.lat : null;
  let lng = isNum(req.body?.lng) ? req.body.lng : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Trava a linha da carona para garantir idempotência concorrente
    const { rows: caronaLockRows } = await client.query(
      `SELECT c.*, m.nome AS motorista_nome, p.nome AS passageiro_nome
       FROM caronas c
       JOIN usuarios m ON m.id = c.motorista_id
       LEFT JOIN usuarios p ON p.id = c.passageiro_id
       WHERE c.id = $1
       FOR UPDATE OF c`,
      [caronaPerm.id]
    );
    const caronaAtual = caronaLockRows[0];

    // Se já houver SOS não resolvido (ABERTO ou EM_ATENDIMENTO) para esta carona, reutiliza
    const { rows: sosExistentes } = await client.query(
      `SELECT s.*, ag.nome AS sos_agente_nome
       FROM eventos_sos s
       LEFT JOIN agentes_seguranca ag ON ag.id = s.atendido_por
       WHERE s.carona_id = $1 AND s.status IN ('ABERTO', 'EM_ATENDIMENTO')
       ORDER BY s.criado_em DESC
       LIMIT 1`,
      [caronaAtual.id]
    );

    if (sosExistentes[0]) {
      const sosExistente = sosExistentes[0];
      let caronaRetorno = caronaAtual;
      if (caronaAtual.status !== 'EMERGENCIA') {
        const { rows: upRows } = await client.query(
          `UPDATE caronas SET status = 'EMERGENCIA' WHERE id = $1 RETURNING *`,
          [caronaAtual.id]
        );
        caronaRetorno = { ...caronaAtual, ...upRows[0] };
      }
      await client.query('COMMIT');
      return res.json({
        ...caronaRetorno,
        sos_id: Number(sosExistente.id),
        sos_status: sosExistente.status,
        sos_atendido_em: sosExistente.atendido_em,
        sos_agente_nome: sosExistente.sos_agente_nome || null,
        sos: { ...sosExistente, id: Number(sosExistente.id) },
      });
    }

    // Se o cliente não enviou coordenadas no body, tenta a última posição ao vivo ou origem da carona
    if (lat === null || lng === null) {
      const { rows: locRows } = await client.query(
        `SELECT lat, lng FROM localizacoes_carona
         WHERE carona_id = $1
         ORDER BY (usuario_id = $2) DESC, atualizado_em DESC
         LIMIT 1`,
        [caronaAtual.id, req.user.id]
      );
      if (locRows[0]) {
        lat = locRows[0].lat;
        lng = locRows[0].lng;
      } else {
        lat = caronaAtual.origem_lat;
        lng = caronaAtual.origem_lng;
      }
    }

    const { rows: upCarona } = await client.query(
      `UPDATE caronas SET status = 'EMERGENCIA', sos_em = now(), sos_lat = $2, sos_lng = $3
       WHERE id = $1 RETURNING *`,
      [caronaAtual.id, lat, lng]
    );
    const { rows: novoSosRows } = await client.query(
      `INSERT INTO eventos_sos (carona_id, usuario_id, lat, lng, status)
       VALUES ($1, $2, $3, $4, 'ABERTO')
       RETURNING *`,
      [caronaAtual.id, req.user.id, lat, lng]
    );
    await client.query('COMMIT');

    const novoSos = novoSosRows[0];
    const caronaFinal = {
      ...caronaAtual,
      ...upCarona[0],
      sos_id: Number(novoSos.id),
      sos_status: novoSos.status,
      sos_atendido_em: null,
      sos_agente_nome: null,
      sos: { ...novoSos, id: Number(novoSos.id) },
    };

    console.warn(`[SOS] id=${novoSos.id} carona=${caronaAtual.id} usuario=${req.user.id} lat=${lat} lng=${lng}`);
    dispararWebhookSos(novoSos, caronaFinal, req.user.id);

    return res.json(caronaFinal);
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
