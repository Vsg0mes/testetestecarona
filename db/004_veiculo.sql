-- Adiciona dados do veículo à carona
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/004_veiculo.sql
ALTER TABLE caronas ADD COLUMN IF NOT EXISTS carro_modelo VARCHAR(80);
ALTER TABLE caronas ADD COLUMN IF NOT EXISTS carro_ano INT;
ALTER TABLE caronas ADD COLUMN IF NOT EXISTS carro_cor VARCHAR(40);
ALTER TABLE caronas ADD COLUMN IF NOT EXISTS carro_placa VARCHAR(20);

