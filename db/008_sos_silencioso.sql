-- SOS Silencioso / Unilateral: registra o papel de quem acionou (MOTORISTA ou PASSAGEIRO)
-- e permite isolamento por usuario_id na mesma carona (idempotente)

ALTER TABLE eventos_sos ADD COLUMN IF NOT EXISTS acionado_por_papel VARCHAR(20);

UPDATE eventos_sos s
SET acionado_por_papel = CASE
  WHEN s.usuario_id = c.motorista_id THEN 'MOTORISTA'
  ELSE 'PASSAGEIRO'
END
FROM caronas c
WHERE c.id = s.carona_id
  AND s.acionado_por_papel IS NULL;

UPDATE eventos_sos
SET acionado_por_papel = 'PASSAGEIRO'
WHERE acionado_por_papel IS NULL;

ALTER TABLE eventos_sos ALTER COLUMN acionado_por_papel SET DEFAULT 'PASSAGEIRO';
ALTER TABLE eventos_sos ALTER COLUMN acionado_por_papel SET NOT NULL;

ALTER TABLE eventos_sos DROP CONSTRAINT IF EXISTS chk_eventos_sos_papel;
ALTER TABLE eventos_sos ADD CONSTRAINT chk_eventos_sos_papel
  CHECK (acionado_por_papel IN ('MOTORISTA', 'PASSAGEIRO'));

CREATE INDEX IF NOT EXISTS idx_eventos_sos_carona_usuario_abertos
  ON eventos_sos (carona_id, usuario_id)
  WHERE status IN ('ABERTO', 'EM_ATENDIMENTO');

-- Garante que caronas ativas com SOS silencioso permaneçam em EM_ANDAMENTO para não alertar a outra ponta
UPDATE caronas
SET status = 'EM_ANDAMENTO'
WHERE status = 'EMERGENCIA';

