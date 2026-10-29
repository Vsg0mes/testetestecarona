-- Chat Privado de SOS (Segurança <-> Vítima) com isolamento por chamado SOS (idempotente)

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

