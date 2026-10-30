-- Fluxo de embarque de passageiros, paradas dinâmicas e vagas disponíveis (idempotente)
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/007_embarque_e_rotas.sql

ALTER TABLE caronas ADD COLUMN IF NOT EXISTS vagas_disponiveis SMALLINT;

UPDATE caronas
SET vagas_disponiveis = CASE
  WHEN passageiro_id IS NULL THEN vagas
  ELSE GREATEST(0, vagas - 1)
END
WHERE vagas_disponiveis IS NULL;

ALTER TABLE caronas ALTER COLUMN vagas_disponiveis SET DEFAULT 1;
ALTER TABLE caronas ALTER COLUMN vagas_disponiveis SET NOT NULL;

ALTER TABLE caronas DROP CONSTRAINT IF EXISTS chk_vagas_disponiveis;
ALTER TABLE caronas ADD CONSTRAINT chk_vagas_disponiveis
  CHECK (vagas_disponiveis >= 0 AND vagas_disponiveis <= vagas);

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

-- Backfill de passageiros já vinculados na tabela caronas
INSERT INTO passageiros_carona (carona_id, usuario_id, status)
SELECT id, passageiro_id, 'AGUARDANDO'
FROM caronas
WHERE passageiro_id IS NOT NULL
ON CONFLICT (carona_id, usuario_id) DO NOTHING;

