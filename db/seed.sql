-- =====================================================================
-- Seed de demonstração (Barretos-SP). Idempotente: pode rodar várias vezes.
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/seed.sql
-- Coordenadas aproximadas dos bairros. Toda carona passa pelo geofence (CHECK).
-- =====================================================================
BEGIN;

INSERT INTO usuarios (email, nome) VALUES
  ('ana.souza@unifeb.edu.br',     'Ana Souza'),
  ('bruno.lima@unifeb.edu.br',    'Bruno Lima'),
  ('carla.mendes@unifeb.edu.br',  'Carla Mendes'),
  ('diego.alves@unifeb.edu.br',   'Diego Alves'),
  ('prof.renata@unifeb.edu.br',   'Profa. Renata')
ON CONFLICT (email) DO NOTHING;

-- Limpa caronas antigas dos usuários de demo
DELETE FROM caronas WHERE motorista_id IN (
  SELECT id FROM usuarios WHERE email IN (
    'ana.souza@unifeb.edu.br','bruno.lima@unifeb.edu.br','carla.mendes@unifeb.edu.br',
    'diego.alves@unifeb.edu.br','prof.renata@unifeb.edu.br'));

-- Campus UNIFEB: -20.5747, -48.5612
INSERT INTO caronas (motorista_id, origem_lat, origem_lng, destino_lat, destino_lng, partida_em, vagas, vagas_disponiveis, carro_modelo, carro_ano, carro_cor, carro_placa)
SELECT u.id, v.olat, v.olng, v.dlat, v.dlng, now() + v.em, v.vagas, v.vagas, v.modelo, v.ano, v.cor, v.placa
FROM (VALUES
  -- IDA: bairro -> campus
  ('ana.souza@unifeb.edu.br',    -20.5572, -48.5678, -20.5747, -48.5612, interval '15 minutes', 3, 'Chevrolet Onix', 2021, 'Branco', 'BRA2E19'), -- Centro
  ('bruno.lima@unifeb.edu.br',   -20.5450, -48.5790, -20.5747, -48.5612, interval '40 minutes', 2, 'Hyundai HB20', 2019, 'Prata', 'ABC-1234'),   -- Zona Norte
  ('prof.renata@unifeb.edu.br',  -20.5880, -48.5450, -20.5747, -48.5612, interval '25 minutes', 1, 'Toyota Corolla', 2023, 'Cinza', 'REN-4T40'), -- Zona Sul
  -- VOLTA: campus -> bairro
  ('carla.mendes@unifeb.edu.br', -20.5747, -48.5612, -20.5605, -48.5560, interval '2 hours',    3, 'Volkswagen Gol', 2017, 'Vermelho', 'CAR-1A99'), -- Rodoviária
  ('diego.alves@unifeb.edu.br',  -20.5747, -48.5612, -20.5200, -48.5880, interval '3 hours',    4, 'Renault Kwid', 2022, 'Preto', 'DIE-6000')    -- Pq. do Peão
) AS v(email, olat, olng, dlat, dlng, em, vagas, modelo, ano, cor, placa)
JOIN usuarios u ON u.email = v.email;

COMMIT;

SELECT c.id, u.nome, c.carro_modelo, c.carro_ano, c.carro_cor, c.carro_placa, c.vagas, c.status, c.partida_em
FROM caronas c JOIN usuarios u ON u.id = c.motorista_id
WHERE c.status = 'ABERTA' ORDER BY c.partida_em;

