const db = require('../db');
const { hashSenha } = require('../middleware/auth');

async function garantirSchemaSeguranca() {
  await db.query(`
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

    INSERT INTO passageiros_carona (carona_id, usuario_id, status)
    SELECT id, passageiro_id, 'AGUARDANDO'
    FROM caronas
    WHERE passageiro_id IS NOT NULL
    ON CONFLICT (carona_id, usuario_id) DO NOTHING;
  `);
}

async function seedAgentes() {
  await garantirSchemaSeguranca();

  const senhaPadrao = process.env.SEG_SENHA_DEMO || 'Campus@2026';
  const agentes = [
    {
      login: 'seguranca1',
      nome: 'Agente Silva (Portaria)',
      senha: process.env.SEG_SENHA_1 || senhaPadrao,
    },
    {
      login: 'seguranca2',
      nome: 'Agente Costa (Ronda)',
      senha: process.env.SEG_SENHA_2 || senhaPadrao,
    },
  ];

  for (const ag of agentes) {
    const senhaHash = hashSenha(ag.senha);
    await db.query(
      `INSERT INTO agentes_seguranca (login, nome, senha_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (login) DO UPDATE
         SET nome = EXCLUDED.nome,
             senha_hash = EXCLUDED.senha_hash`,
      [ag.login, ag.nome, senhaHash]
    );
  }
  console.log(`[Seed Segurança] ${agentes.length} agentes de demonstração sincronizados (${agentes.map((a) => a.login).join(', ')}).`);
}

if (require.main === module) {
  seedAgentes()
    .then(() => db.pool.end())
    .catch((err) => {
      console.error('[Seed Segurança] Falha ao executar seed:', err);
      process.exit(1);
    });
}

module.exports = { seedAgentes, garantirSchemaSeguranca };

