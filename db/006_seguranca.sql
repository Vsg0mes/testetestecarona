-- Painel Segurança do Campus: agentes e ciclo de vida dos chamados SOS (idempotente)
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/006_seguranca.sql

CREATE TABLE IF NOT EXISTS agentes_seguranca (
  id          SERIAL PRIMARY KEY,
  login       VARCHAR(40) UNIQUE NOT NULL,
  nome        VARCHAR(120) NOT NULL,
  senha_hash  TEXT NOT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE eventos_sos ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ABERTO';
ALTER TABLE eventos_sos ADD COLUMN IF NOT EXISTS atendido_por INT REFERENCES agentes_seguranca(id) ON DELETE SET NULL;
ALTER TABLE eventos_sos ADD COLUMN IF NOT EXISTS atendido_em TIMESTAMPTZ;
ALTER TABLE eventos_sos ADD COLUMN IF NOT EXISTS resolvido_em TIMESTAMPTZ;
ALTER TABLE eventos_sos ADD COLUMN IF NOT EXISTS observacao VARCHAR(300);

ALTER TABLE eventos_sos DROP CONSTRAINT IF EXISTS chk_eventos_sos_status;
ALTER TABLE eventos_sos ADD CONSTRAINT chk_eventos_sos_status
  CHECK (status IN ('ABERTO', 'EM_ATENDIMENTO', 'RESOLVIDO', 'FALSO_ALARME'));

CREATE INDEX IF NOT EXISTS idx_eventos_sos_abertos
  ON eventos_sos (criado_em DESC)
  WHERE status IN ('ABERTO', 'EM_ATENDIMENTO');

CREATE INDEX IF NOT EXISTS idx_eventos_sos_carona_abertos
  ON eventos_sos (carona_id)
  WHERE status IN ('ABERTO', 'EM_ATENDIMENTO');

