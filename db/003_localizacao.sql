-- Localização ao vivo de motorista e passageiro (só a última posição de cada um)
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/003_localizacao.sql
CREATE TABLE IF NOT EXISTS localizacoes_carona (
  carona_id     INT NOT NULL REFERENCES caronas(id) ON DELETE CASCADE,
  usuario_id    INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  lat           DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng           DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (carona_id, usuario_id)
);

