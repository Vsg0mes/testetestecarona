const { Router } = require('express');
const db = require('../db');
const { CAMPUS, distanciaM, pertoDoCampus, calcularRotaViaria } = require('../geofence');

const router = Router();

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Garante que o usuário participa da carona (motorista ou um dos passageiros)
async function carregarCaronaDoUsuario(id, userId, client = db) {
  const caronaId = parseInt(id, 10);
  if (!Number.isInteger(caronaId)) return null;
  const { rows } = await client.query(
    `SELECT c.*
     FROM caronas c
     WHERE c.id = $1
       AND (
         c.motorista_id = $2
         OR c.passageiro_id = $2
         OR EXISTS (
           SELECT 1 FROM passageiros_carona pc
           WHERE pc.carona_id = c.id AND pc.usuario_id = $2
         )
       )`,
    [caronaId, userId]
  );
  return rows[0] || null;
}

// Carrega a carona enriquecida com lista de paradas/passageiros, rota ativa e validação de geofence
async function enriquecerCarona(caronaId, client = db) {
  const { rows } = await client.query(
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
     WHERE c.id = $1`,
    [caronaId]
  );
  const c = rows[0];
  if (!c) return null;

  // Lista de passageiros (paradas) ordenada pela ordem de entrada
  const { rows: passRows } = await client.query(
    `SELECT pc.id,
            pc.carona_id,
            pc.usuario_id,
            u.nome,
            pc.status,
            pc.lat AS parada_lat,
            pc.lng AS parada_lng,
            l.lat AS vivo_lat,
            l.lng AS vivo_lng,
            pc.criado_em,
            pc.embarcou_em
     FROM passageiros_carona pc
     JOIN usuarios u ON u.id = pc.usuario_id
     LEFT JOIN localizacoes_carona l
       ON l.carona_id = pc.carona_id AND l.usuario_id = pc.usuario_id
     WHERE pc.carona_id = $1
     ORDER BY pc.id ASC`,
    [c.id]
  );

  // Coordenada padrão intermediária caso um passageiro tenha entrado sem informar GPS inicial
  const defaultPassLat = (Number(c.origem_lat) + Number(c.destino_lat)) / 2;
  const defaultPassLng = (Number(c.origem_lng) + Number(c.destino_lng)) / 2;

  const passageiros = passRows.map((r) => {
    const lat = isNum(r.vivo_lat) ? r.vivo_lat : isNum(r.parada_lat) ? r.parada_lat : defaultPassLat;
    const lng = isNum(r.vivo_lng) ? r.vivo_lng : isNum(r.parada_lng) ? r.parada_lng : defaultPassLng;
    return {
      id: r.id,
      usuario_id: r.usuario_id,
      nome: r.nome,
      status: r.status, // 'AGUARDANDO' | 'EMBARCADO'
      lat,
      lng,
      criado_em: r.criado_em,
      embarcou_em: r.embarcou_em,
    };
  });

  // Posição atual do motorista via telemetria GPS
  const { rows: locMotRows } = await client.query(
    `SELECT lat, lng, atualizado_em
     FROM localizacoes_carona
     WHERE carona_id = $1 AND usuario_id = $2`,
    [c.id, c.motorista_id]
  );
  const locMotorista = locMotRows[0] || null;
  const motoristaLat = locMotorista ? Number(locMotorista.lat) : Number(c.origem_lat);
  const motoristaLng = locMotorista ? Number(locMotorista.lng) : Number(c.origem_lng);

  // Geofencing de finalização no Campus UNIFEB (-20.5747, -48.5612, raio <= 500m via Haversine)
  const distanciaCampusM = Math.round(distanciaM(motoristaLat, motoristaLng, CAMPUS.lat, CAMPUS.lng));
  const motoristaNoCampus = Boolean(locMotorista && pertoDoCampus(locMotorista.lat, locMotorista.lng));
  const podeFinalizar = motoristaNoCampus;

  // Paradas pendentes (AGUARDANDO) e próximo destino da rota dinâmica
  const paradas = passageiros.filter((p) => p.status === 'AGUARDANDO');
  const embarcados = passageiros.filter((p) => p.status === 'EMBARCADO');
  const passageiroAtual = paradas[0] || null;

  const origemRota = { lat: motoristaLat, lng: motoristaLng };
  const destinoRota = passageiroAtual
    ? {
        tipo: 'PASSAGEIRO',
        passageiro_id: passageiroAtual.usuario_id,
        nome: passageiroAtual.nome,
        lat: passageiroAtual.lat,
        lng: passageiroAtual.lng,
      }
    : {
        tipo: 'CAMPUS',
        passageiro_id: null,
        nome: 'Campus UNIFEB',
        lat: CAMPUS.lat,
        lng: CAMPUS.lng,
      };

  const rotaViaria = await calcularRotaViaria(origemRota, destinoRota);
  const vagasTotal = Number(c.vagas) || 1;
  const vagasDisponiveis =
    typeof c.vagas_disponiveis === 'number'
      ? Number(c.vagas_disponiveis)
      : Math.max(0, vagasTotal - passageiros.length);

  // Nome de exibição do passageiro principal / atual para compatibilidade com a UI
  const nomePassageiroExibicao =
    passageiroAtual?.nome ||
    embarcados[embarcados.length - 1]?.nome ||
    c.passageiro_nome ||
    null;

  return {
    ...c,
    vagas: vagasTotal,
    vagas_disponiveis: vagasDisponiveis,
    passageiro_nome: nomePassageiroExibicao,
    passageiros,
    paradas,
    passageiros_embarcados: embarcados,
    passageiro_atual: passageiroAtual,
    em_percurso: c.status === 'EM_ANDAMENTO' || c.status === 'EMERGENCIA' || passageiros.length > 0,
    tem_telemetria_motorista: Boolean(locMotorista),
    motorista_lat: motoristaLat,
    motorista_lng: motoristaLng,
    distancia_campus_m: distanciaCampusM,
    motorista_no_campus: motoristaNoCampus,
    pode_finalizar: podeFinalizar,
    rota_ativa: {
      origem: origemRota,
      destino: destinoRota,
      distancia_m: rotaViaria?.distancia_m ?? null,
      duracao_s: rotaViaria?.duracao_s ?? null,
      geometria: rotaViaria?.geometria || [
        [origemRota.lat, origemRota.lng],
        [destinoRota.lat, destinoRota.lng],
      ],
    },
  };
}

// GET /campus -> coordenada fixa para o app travar o formulário
router.get('/campus', (_req, res) => res.json(CAMPUS));

// GET /caronas -> caronas abertas com vagas disponíveis
router.get('/caronas', async (_req, res) => {
  const { rows } = await db.query(
    `SELECT c.*,
            COALESCE(c.vagas_disponiveis, c.vagas) AS vagas_disponiveis,
            u.nome AS motorista_nome
     FROM caronas c
     JOIN usuarios u ON u.id = c.motorista_id
     WHERE c.status = 'ABERTA'
       AND COALESCE(c.vagas_disponiveis, c.vagas) > 0
       AND c.partida_em > now() - interval '30 minutes'
     ORDER BY c.partida_em
     LIMIT 50`
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
    vagas,
    vagas_disponiveis,
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

  const vagasInput = vagas ?? vagas_disponiveis ?? 1;
  const vagasInt = parseInt(vagasInput, 10);
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
         partida_em, vagas, vagas_disponiveis, carro_modelo, carro_ano, carro_cor, carro_placa
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        req.user.id,
        origem.lat,
        origem.lng,
        destino.lat,
        destino.lng,
        dataPartida,
        vagasValidas,
        vagasValidas,
        modelo,
        anoValido,
        cor,
        placa,
      ]
    );
    const enriquecida = await enriquecerCarona(rows[0].id);
    res.status(201).json(enriquecida);
  } catch (e) {
    if (e.code === '23514') {
      // violação de CHECK constraint (segunda linha de defesa no banco)
      return res.status(422).json({ erro: 'Rejeitado pela regra de segurança do banco', constraint: e.constraint });
    }
    throw e;
  }
});

// POST /caronas/:id/entrar -> passageiro reserva vaga e entra na lista de paradas com status AGUARDANDO
router.post('/caronas/:id/entrar', async (req, res) => {
  const caronaId = parseInt(req.params.id, 10);
  if (!Number.isInteger(caronaId)) {
    return res.status(400).json({ erro: 'ID de carona inválido' });
  }

  const latBody = isNum(req.body?.lat) ? req.body.lat : null;
  const lngBody = isNum(req.body?.lng) ? req.body.lng : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: lockRows } = await client.query(
      `SELECT * FROM caronas WHERE id = $1 FOR UPDATE`,
      [caronaId]
    );
    const carona = lockRows[0];

    if (!carona) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Carona não encontrada' });
    }
    if (carona.motorista_id === req.user.id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'O motorista não pode entrar como passageiro na própria carona' });
    }

    // Verifica se o passageiro já está nesta carona
    const { rows: jaParticipa } = await client.query(
      `SELECT id FROM passageiros_carona WHERE carona_id = $1 AND usuario_id = $2`,
      [carona.id, req.user.id]
    );
    if (jaParticipa[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'Você já está participando desta carona' });
    }

    const vagasDisp =
      typeof carona.vagas_disponiveis === 'number' ? carona.vagas_disponiveis : carona.vagas;
    if (carona.status !== 'ABERTA' || vagasDisp <= 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'Carona indisponível' });
    }

    // Define coordenada de coleta do passageiro (GPS enviado ou ponto intermediário da rota)
    const pLat = latBody !== null ? latBody : (Number(carona.origem_lat) + Number(carona.destino_lat)) / 2;
    const pLng = lngBody !== null ? lngBody : (Number(carona.origem_lng) + Number(carona.destino_lng)) / 2;

    await client.query(
      `INSERT INTO passageiros_carona (carona_id, usuario_id, status, lat, lng)
       VALUES ($1, $2, 'AGUARDANDO', $3, $4)`,
      [carona.id, req.user.id, pLat, pLng]
    );

    await client.query(
      `INSERT INTO localizacoes_carona (carona_id, usuario_id, lat, lng)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (carona_id, usuario_id)
       DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, atualizado_em = now()`,
      [carona.id, req.user.id, pLat, pLng]
    );

    const novasVagas = Math.max(0, vagasDisp - 1);
    await client.query(
      `UPDATE caronas
       SET passageiro_id = COALESCE(passageiro_id, $2),
           vagas_disponiveis = $3,
           status = 'EM_ANDAMENTO'
       WHERE id = $1`,
      [carona.id, req.user.id, novasVagas]
    );

    await client.query('COMMIT');
    const enriquecida = await enriquecerCarona(carona.id);
    return res.json(enriquecida);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// POST /caronas/:id/embarcar -> motorista confirma que o passageiro atual embarcou (status -> EMBARCADO)
async function confirmarEmbarqueHandler(req, res) {
  const caronaId = parseInt(req.params.id, 10);
  if (!Number.isInteger(caronaId)) {
    return res.status(400).json({ erro: 'ID de carona inválido' });
  }

  const passageiroAlvoId = req.params.passageiroId
    ? parseInt(req.params.passageiroId, 10)
    : req.body?.passageiroId
      ? parseInt(req.body.passageiroId, 10)
      : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: lockRows } = await client.query(
      `SELECT * FROM caronas WHERE id = $1 FOR UPDATE`,
      [caronaId]
    );
    const carona = lockRows[0];

    if (!carona) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Carona não encontrada' });
    }
    if (carona.motorista_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ erro: 'Apenas o motorista pode confirmar o embarque do passageiro' });
    }
    if (!['ABERTA', 'EM_ANDAMENTO'].includes(carona.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'Carona não está em andamento para embarque' });
    }

    // Localiza o primeiro passageiro AGUARDANDO (ou o passageiroId específico se informado)
    const { rows: pendentes } = await client.query(
      `SELECT pc.*, u.nome
       FROM passageiros_carona pc
       JOIN usuarios u ON u.id = pc.usuario_id
       WHERE pc.carona_id = $1
         AND pc.status = 'AGUARDANDO'
         AND ($2::int IS NULL OR pc.usuario_id = $2 OR pc.id = $2)
       ORDER BY pc.id ASC
       LIMIT 1`,
      [carona.id, Number.isInteger(passageiroAlvoId) ? passageiroAlvoId : null]
    );

    const paradaAtual = pendentes[0];
    if (!paradaAtual) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'Não há passageiro aguardando embarque no momento' });
    }

    await client.query(
      `UPDATE passageiros_carona
       SET status = 'EMBARCADO',
           embarcou_em = now()
       WHERE id = $1`,
      [paradaAtual.id]
    );

    if (carona.status !== 'EM_ANDAMENTO') {
      await client.query(`UPDATE caronas SET status = 'EM_ANDAMENTO' WHERE id = $1`, [carona.id]);
    }

    await client.query('COMMIT');

    const enriquecida = await enriquecerCarona(carona.id);
    const vagasRestantes = enriquecida.vagas_disponiveis;
    const perguntarReabertura = vagasRestantes > 0;
    const mensagemReabertura = perguntarReabertura
      ? `Você ainda tem ${vagasRestantes} vaga(s) disponível(is). Deseja republicar a carona para encontrar outros passageiros pelo caminho?`
      : null;

    return res.json({
      ...enriquecida,
      passageiro_embarcado: {
        id: paradaAtual.id,
        usuario_id: paradaAtual.usuario_id,
        nome: paradaAtual.nome,
        status: 'EMBARCADO',
      },
      perguntar_reabertura: perguntarReabertura,
      mensagem_reabertura: mensagemReabertura,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

router.post('/caronas/:id/embarcar', confirmarEmbarqueHandler);
router.post('/caronas/:id/passageiros/:passageiroId/embarcar', confirmarEmbarqueHandler);

// POST /caronas/:id/republicar -> motorista aceita reabrir a carona para buscar novos passageiros sem interromper a rota atual
router.post('/caronas/:id/republicar', async (req, res) => {
  const caronaId = parseInt(req.params.id, 10);
  if (!Number.isInteger(caronaId)) {
    return res.status(400).json({ erro: 'ID de carona inválido' });
  }

  const { rows: lockRows } = await db.query(
    `SELECT * FROM caronas WHERE id = $1`,
    [caronaId]
  );
  const carona = lockRows[0];

  if (!carona) return res.status(404).json({ erro: 'Carona não encontrada' });
  if (carona.motorista_id !== req.user.id) {
    return res.status(403).json({ erro: 'Apenas o motorista pode republicar a carona' });
  }
  if (!['ABERTA', 'EM_ANDAMENTO'].includes(carona.status)) {
    return res.status(409).json({ erro: 'Carona não pode ser republicada neste status' });
  }
  if ((carona.vagas_disponiveis ?? 0) <= 0) {
    return res.status(409).json({ erro: 'Não há vagas disponíveis para republicar a carona' });
  }

  await db.query(
    `UPDATE caronas
     SET status = 'ABERTA',
         partida_em = GREATEST(partida_em, now())
     WHERE id = $1`,
    [carona.id]
  );

  const enriquecida = await enriquecerCarona(carona.id);
  res.json(enriquecida);
});

// GET /minha-carona -> id do usuário + carona ativa (motorista ou passageiro) + rota ativa + SOS + geofence
router.get('/minha-carona', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id
     FROM caronas c
     WHERE (
       c.motorista_id = $1
       OR c.passageiro_id = $1
       OR EXISTS (
         SELECT 1 FROM passageiros_carona pc
         WHERE pc.carona_id = c.id AND pc.usuario_id = $1
       )
     )
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

  if (!rows[0]) {
    return res.json({ usuarioId: req.user.id, carona: null });
  }

  const carona = await enriquecerCarona(rows[0].id);
  res.json({ usuarioId: req.user.id, carona });
});

// POST /caronas/:id/finalizar ->
// - Se ABERTA e sem nenhum passageiro embarcado/aguardando: cancela a oferta (CANCELADA)
// - Se em percurso: exige que a telemetria GPS do motorista esteja dentro do geofence do Campus UNIFEB (<= 500m de -20.5747, -48.5612 via Haversine)
router.post('/caronas/:id/finalizar', async (req, res) => {
  const carona = await carregarCaronaDoUsuario(req.params.id, req.user.id);
  if (!carona || !['ABERTA', 'EM_ANDAMENTO'].includes(carona.status)) {
    return res.status(409).json({ erro: 'Carona não pode ser encerrada' });
  }

  const { rows: passCountRows } = await db.query(
    `SELECT COUNT(*)::int AS total FROM passageiros_carona WHERE carona_id = $1`,
    [carona.id]
  );
  const totalPassageiros = passCountRows[0]?.total || 0;

  // Oferta aberta que ainda não teve nenhum passageiro pode ser cancelada
  if (carona.status === 'ABERTA' && totalPassageiros === 0 && !carona.passageiro_id) {
    const { rows } = await db.query(
      `UPDATE caronas SET status = 'CANCELADA' WHERE id = $1 RETURNING *`,
      [carona.id]
    );
    return res.json(rows[0]);
  }

  // Durante o percurso, se o motorista enviou coordenadas no body, registra na telemetria
  if (req.user.id === carona.motorista_id && isNum(req.body?.lat) && isNum(req.body?.lng)) {
    await db.query(
      `INSERT INTO localizacoes_carona (carona_id, usuario_id, lat, lng)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (carona_id, usuario_id)
       DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, atualizado_em = now()`,
      [carona.id, carona.motorista_id, req.body.lat, req.body.lng]
    );
  }

  // Validação obrigatória de Geofencing via Haversine na telemetria GPS do motorista
  const { rows: locRows } = await db.query(
    `SELECT lat, lng FROM localizacoes_carona WHERE carona_id = $1 AND usuario_id = $2`,
    [carona.id, carona.motorista_id]
  );
  const locMotorista = locRows[0];

  if (!locMotorista || !pertoDoCampus(locMotorista.lat, locMotorista.lng)) {
    const distAtual = locMotorista
      ? Math.round(distanciaM(locMotorista.lat, locMotorista.lng, CAMPUS.lat, CAMPUS.lng))
      : null;
    return res.status(422).json({
      erro: 'A carona só pode ser finalizada quando o motorista entrar no raio de 500m do Campus UNIFEB (-20.5747, -48.5612).',
      distancia_campus_m: distAtual,
      pode_finalizar: false,
    });
  }

  const { rows } = await db.query(
    `UPDATE caronas SET status = 'FINALIZADA' WHERE id = $1 RETURNING *`,
    [carona.id]
  );
  res.json(rows[0]);
});

// POST /caronas/:id/localizacao  body: { lat, lng } -> atualiza minha posição e retorna rota recalculada + geofence do campus
router.post('/caronas/:id/localizacao', async (req, res) => {
  const { lat, lng } = req.body || {};
  if (!isNum(lat) || !isNum(lng)) return res.status(400).json({ erro: 'Coordenadas inválidas' });

  const carona = await carregarCaronaDoUsuario(req.params.id, req.user.id);
  if (!carona || !['ABERTA', 'EM_ANDAMENTO', 'EMERGENCIA'].includes(carona.status)) {
    return res.status(409).json({ erro: 'Localização só é compartilhada em carona ativa' });
  }

  await db.query(
    `INSERT INTO localizacoes_carona (carona_id, usuario_id, lat, lng) VALUES ($1,$2,$3,$4)
     ON CONFLICT (carona_id, usuario_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, atualizado_em = now()`,
    [carona.id, req.user.id, lat, lng]
  );

  // Se for um passageiro ainda AGUARDANDO coleta, atualiza também o ponto da parada dele
  if (req.user.id !== carona.motorista_id) {
    await db.query(
      `UPDATE passageiros_carona
       SET lat = $3, lng = $4
       WHERE carona_id = $1 AND usuario_id = $2 AND status = 'AGUARDANDO'`,
      [carona.id, req.user.id, lat, lng]
    );
  }

  const enriquecida = await enriquecerCarona(carona.id);
  res.json({
    ok: true,
    lat,
    lng,
    distancia_campus_m: enriquecida?.distancia_campus_m ?? null,
    motorista_no_campus: Boolean(enriquecida?.motorista_no_campus),
    pode_finalizar: Boolean(enriquecida?.pode_finalizar),
    rota_ativa: enriquecida?.rota_ativa ?? null,
  });
});

// GET /caronas/:id/localizacoes -> posição do motorista e dos passageiros
router.get('/caronas/:id/localizacoes', async (req, res) => {
  const carona = await carregarCaronaDoUsuario(req.params.id, req.user.id);
  if (!carona) return res.status(404).json({ erro: 'Carona não encontrada' });

  const { rows } = await db.query(
    `SELECT l.usuario_id,
            u.nome,
            l.lat,
            l.lng,
            l.atualizado_em,
            CASE WHEN l.usuario_id = $2 THEN 'MOTORISTA' ELSE 'PASSAGEIRO' END AS papel,
            pc.status AS status_embarque
     FROM localizacoes_carona l
     JOIN usuarios u ON u.id = l.usuario_id
     LEFT JOIN passageiros_carona pc
       ON pc.carona_id = l.carona_id AND pc.usuario_id = l.usuario_id
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
      const enriquecida = await enriquecerCarona(caronaRetorno.id);
      return res.json({
        ...enriquecida,
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
    const enriquecida = await enriquecerCarona(caronaAtual.id);
    const caronaFinal = {
      ...enriquecida,
      ...upCarona[0],
      vagas: enriquecida.vagas,
      vagas_disponiveis: enriquecida.vagas_disponiveis,
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
