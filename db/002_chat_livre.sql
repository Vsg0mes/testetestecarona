-- Migração: chat com texto livre (temporário, controlado por CHAT_LIVRE na API)
-- Aplicar em banco existente:
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/002_chat_livre.sql
ALTER TABLE mensagens_carona ALTER COLUMN mensagem_id DROP NOT NULL;
ALTER TABLE mensagens_carona ADD COLUMN IF NOT EXISTS texto VARCHAR(300);
ALTER TABLE mensagens_carona DROP CONSTRAINT IF EXISTS chk_msg_id_ou_texto;
ALTER TABLE mensagens_carona ADD CONSTRAINT chk_msg_id_ou_texto
  CHECK ((mensagem_id IS NOT NULL) <> (texto IS NOT NULL AND length(btrim(texto)) > 0));

