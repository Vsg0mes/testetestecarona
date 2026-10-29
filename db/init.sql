-- =====================================================================
-- Carona Universitária Validada - Schema MVP (PostgreSQL 16)
-- =====================================================================

-- ---------- Geofencing: coordenada fixa do campus ----------
-- IMMUTABLE para poder ser usada dentro de CHECK constraint.
-- Distância aproximada (equiretangular) - suficiente para raio de ~500m.
CREATE OR REPLACE FUNCTION perto_do_campus(lat DOUBLE PRECISION, lng DOUBLE PRECISION)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT 6371000 * sqrt(
           power(radians(lat - (-20.5747)), 2) +
           power(radians(lng - (-48.5612)) * cos(radians((lat + (-20.5747)) / 2)), 2)
         ) <= 500;
$$;

-- ---------- Usuários ----------
CREATE TABLE usuarios (
  id          SERIAL PRIMARY KEY,
  email       VARCHAR(255) NOT NULL UNIQUE,
  nome        VARCHAR(120),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_email_institucional
    CHECK (email ~* '^[A-Za-z0-9._%+-]+@unifeb\.edu\.br$')
);

-- ---------- Caronas ----------
CREATE TYPE status_carona AS ENUM ('ABERTA', 'EM_ANDAMENTO', 'FINALIZADA', 'CANCELADA', 'EMERGENCIA');

CREATE TABLE caronas (
  id             SERIAL PRIMARY KEY,
  motorista_id   INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  passageiro_id  INT REFERENCES usuarios(id) ON DELETE SET NULL,
  origem_lat     DOUBLE PRECISION NOT NULL CHECK (origem_lat  BETWEEN -90  AND 90),
  origem_lng     DOUBLE PRECISION NOT NULL CHECK (origem_lng  BETWEEN -180 AND 180),
  destino_lat    DOUBLE PRECISION NOT NULL CHECK (destino_lat BETWEEN -90  AND 90),
  destino_lng    DOUBLE PRECISION NOT NULL CHECK (destino_lng BETWEEN -180 AND 180),
  partida_em        TIMESTAMPTZ NOT NULL,
  vagas             SMALLINT NOT NULL DEFAULT 1 CHECK (vagas BETWEEN 1 AND 6),
  vagas_disponiveis SMALLINT NOT NULL DEFAULT 1 CHECK (vagas_disponiveis BETWEEN 0 AND 6),
  carro_modelo      VARCHAR(80),
  carro_ano      INT,
  carro_cor      VARCHAR(40),
  carro_placa    VARCHAR(20),
  status         status_carona NOT NULL DEFAULT 'ABERTA',
  sos_em         TIMESTAMPTZ,
  sos_lat        DOUBLE PRECISION,
  sos_lng        DOUBLE PRECISION,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Anti "Uber pirata": origem OU destino obrigatoriamente no campus
  CONSTRAINT chk_geofence_campus
    CHECK (perto_do_campus(origem_lat, origem_lng) OR perto_do_campus(destino_lat, destino_lng)),
  CONSTRAINT chk_passageiro_diferente
    CHECK (passageiro_id IS NULL OR passageiro_id <> motorista_id)
);
CREATE INDEX idx_caronas_status ON caronas(status);

-- ---------- Paradas / Passageiros da Carona (Fluxo de Embarque e Rota Dinâmica) ----------
CREATE TABLE IF NOT EXISTS passageiros_carona (
  id          SERIAL PRIMARY KEY,
  carona_id   INT NOT NULL REFERENCES caronas(id) ON DELETE CASCADE,
  usuario_id  INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  status      VARCHAR(20) NOT NULL DEFAULT 'AGUARDANDO'
              CHECK (status IN ('AGUARDANDO', 'EMBARCADO')),
  lat         DOUBLE PRECISION CHECK (lat BETWEEN -90 AND 90),
  lng         DOUBLE PRECISION CHECK (lng BETWEEN -180 AND 180),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  embarcou_em TIMESTAMPTZ,
  UNIQUE (carona_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS idx_passageiros_carona_carona
  ON passageiros_carona (carona_id, id);

-- ---------- Chat restrito (anti "Tinder") ----------
-- Catálogo fixo: o único "texto" do chat vive aqui.
CREATE TABLE mensagens_pre_definidas (
  id     SMALLINT PRIMARY KEY,
  texto  VARCHAR(60) NOT NULL UNIQUE
);
INSERT INTO mensagens_pre_definidas (id, texto) VALUES
  (1, 'Estou no portão'),
  (2, 'Chegando'),
  (3, 'Tive um imprevisto');

-- Log de envio: apenas IDs numéricos, sem coluna de texto livre.
CREATE TABLE mensagens_carona (
  id          BIGSERIAL PRIMARY KEY,
  carona_id   INT NOT NULL REFERENCES caronas(id) ON DELETE CASCADE,
  autor_id    INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  mensagem_id SMALLINT NOT NULL REFERENCES mensagens_pre_definidas(id),
  enviado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_msg_carona ON mensagens_carona(carona_id, enviado_em);

-- ---------- Agentes de Segurança do Campus ----------
CREATE TABLE agentes_seguranca (
  id          SERIAL PRIMARY KEY,
  login       VARCHAR(40) UNIQUE NOT NULL,
  nome        VARCHAR(120) NOT NULL,
  senha_hash  TEXT NOT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Telemetria / SOS (log centralizado no Postgres) ----------
CREATE TABLE eventos_sos (
  id                 BIGSERIAL PRIMARY KEY,
  carona_id          INT NOT NULL REFERENCES caronas(id) ON DELETE CASCADE,
  usuario_id         INT NOT NULL REFERENCES usuarios(id),
  acionado_por_papel VARCHAR(20) NOT NULL DEFAULT 'PASSAGEIRO',
  lat                DOUBLE PRECISION,
  lng                DOUBLE PRECISION,
  status             VARCHAR(20) NOT NULL DEFAULT 'ABERTO',
  atendido_por       INT REFERENCES agentes_seguranca(id) ON DELETE SET NULL,
  atendido_em        TIMESTAMPTZ,
  resolvido_em       TIMESTAMPTZ,
  observacao         VARCHAR(300),
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_eventos_sos_status
    CHECK (status IN ('ABERTO', 'EM_ATENDIMENTO', 'RESOLVIDO', 'FALSO_ALARME')),
  CONSTRAINT chk_eventos_sos_papel
    CHECK (acionado_por_papel IN ('MOTORISTA', 'PASSAGEIRO'))
);

CREATE INDEX idx_eventos_sos_abertos
  ON eventos_sos (criado_em DESC)
  WHERE status IN ('ABERTO', 'EM_ATENDIMENTO');

CREATE INDEX idx_eventos_sos_carona_abertos
  ON eventos_sos (carona_id)
  WHERE status IN ('ABERTO', 'EM_ATENDIMENTO');

-- ---------- Chat Privado de SOS (Segurança <-> Vítima) ----------
CREATE TABLE IF NOT EXISTS sos_chat_mensagens (
  id          BIGSERIAL PRIMARY KEY,
  sos_id      BIGINT NOT NULL REFERENCES eventos_sos(id) ON DELETE CASCADE,
  autor_tipo  VARCHAR(20) NOT NULL CHECK (autor_tipo IN ('USUARIO', 'AGENTE')),
  usuario_id  INT REFERENCES usuarios(id) ON DELETE SET NULL,
  agente_id   INT REFERENCES agentes_seguranca(id) ON DELETE SET NULL,
  autor_nome  VARCHAR(120) NOT NULL,
  texto       VARCHAR(500) NOT NULL,
  enviado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sos_chat_mensagens_sos
  ON sos_chat_mensagens (sos_id, enviado_em ASC, id ASC);
