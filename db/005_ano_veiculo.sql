-- Adiciona ano do veículo à carona
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/005_ano_veiculo.sql
ALTER TABLE caronas ADD COLUMN IF NOT EXISTS carro_ano INT;

