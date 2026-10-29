# Carona Universitária Validada — UNIFEB

MVP desenvolvido para hackathon acadêmico da comunidade **UNIFEB (Barretos-SP)**, com foco em segurança institucional, validação de perímetro (geofencing) e resposta em tempo real a emergências (**Painel Segurança do Campus**).

## Diferenciais do Sistema
- **Anti "Uber pirata" (Geofencing duplo):** Toda carona obrigatoriamente começa ou termina no campus UNIFEB (`-20.5747, -48.5612`, raio de `500m`), validado no backend (Haversine) e no PostgreSQL (`CHECK constraint`).
- **Rota Dinâmica em Tempo Real (GPS + Vias):** Traçado de rota (Polyline) partindo da posição atual do motorista até o primeiro passageiro aguardando na lista de paradas, encurtando e recalculando dinamicamente conforme o motorista se desloca pelas vias (`POST /caronas/:id/localizacao`) e avançando para o próximo passageiro ou diretamente para o Campus UNIFEB (`-20.5747, -48.5612`) após o embarque.
- **Fluxo de Embarque e Reabertura de Vagas:** Botão *"Passageiro Embarcou"* na tela do motorista (`status = EMBARCADO`), seguido de verificação de `vagas_disponiveis` e prompt para republicar a carona pelo caminho sem interromper a rota atual (`POST /caronas/:id/embarcar` e `POST /caronas/:id/republicar`).
- **Finalização Validada por Geofencing no Campus:** O botão *"Finalizar Carona"* permanece bloqueado/desabilitado durante todo o percurso e é habilitado automaticamente apenas quando a telemetria GPS do motorista entra no raio de `<= 500m` do Campus UNIFEB (`-20.5747, -48.5612`, validado via Haversine no backend).
- **Comunidade fechada:** Acesso de motoristas e passageiros restrito ao domínio institucional `@unifeb.edu.br` (mock de SSO para o hackathon).
- **Painel "Segurança do Campus" (`/seguranca`):** Central web em tempo real para agentes de segurança acompanharem chamados SOS com mapa ao vivo, dados do veículo/placa, alerta sonoro (`AudioContext`), assunção de chamado e encerramento transacional.
- **Separação rígida de papéis (RBAC no JWT):** Tokens de usuários comuns (`role: 'USUARIO'`) e tokens de agentes (`role: 'AGENTE'`) são estritamente isolados no middleware e no armazenamento do navegador (`carona_jwt` vs `seguranca_jwt`).

---

## ⚠️ Aviso Importante sobre Credenciais de Demonstração

> **ATENÇÃO:** As credenciais dos agentes de segurança listadas abaixo são **100% fictícias e destinadas exclusivamente à demonstração no hackathon**.
> Fora do ambiente de demonstração, defina `SEED_AGENTES=false` no `.env`, substitua `SEG_SENHA_DEMO` por senhas fortes exclusivas e revogue quaisquer usuários de teste. As senhas nunca são armazenadas em texto puro no banco (utilizamos `crypto.scryptSync` nativo do Node.js com `salt:hash` de 64 bytes e verificação via `crypto.timingSafeEqual`).

| Login | Senha padrão (demo) | Nome / Posto |
| :--- | :--- | :--- |
| `seguranca1` | `Campus@2026` (ou `SEG_SENHA_DEMO`) | Agente Silva (Portaria) |
| `seguranca2` | `Campus@2026` (ou `SEG_SENHA_DEMO`) | Agente Costa (Ronda) |

Para rodar o seed manualmente a qualquer momento:
```bash
docker compose exec api node src/scripts/seed-agentes.js
```

---

## Como Subir o Ambiente (Docker Compose)

1. Copie o arquivo `.env.example` para `.env` e defina os segredos:
```bash
cp .env.example .env
```
2. Suba os contêineres (`db`, `api` e `web`):
```bash
docker compose up --build -d
```
3. Acesse no navegador:
- **App de Caronas (Alunos / Servidores):** `http://localhost:8081/`
- **Painel Segurança do Campus:** `http://localhost:8081/seguranca` (ou pelo link *"🛡️ Acesso da Segurança"* na tela inicial de login)
- **API Healthcheck:** `http://localhost:3000/health`

---

## Principais Endpoints da API

### Autenticação e Usuários
- `POST /login` — Login mock institucional (`@unifeb.edu.br`), retorna JWT de 12h.
- `GET /campus` — Coordenadas e raio do campus.
- `GET /caronas` / `POST /caronas` — Listagem e criação de caronas com dados do veículo e geofencing.
- `POST /caronas/:id/entrar` — Reserva de vaga pelo passageiro (entra na lista de paradas como `AGUARDANDO` e decrementa `vagas_disponiveis`).
- `POST /caronas/:id/embarcar` — Confirma o embarque do passageiro atual (`EMBARCADO`), atualiza a rota para o próximo passageiro ou para o Campus UNIFEB (`-20.5747, -48.5612`) e informa se ainda há `vagas_disponiveis`.
- `POST /caronas/:id/republicar` — Reabre a carona (`status = 'ABERTA'`) para buscar novos passageiros pelo caminho sem interromper a rota atual.
- `GET /minha-carona` — Carona ativa do usuário + lista de paradas + `rota_ativa` + validação de geofence (`pode_finalizar`) + estado em tempo real do SOS (`sos_status`, `sos_agente_nome`).
- `POST /caronas/:id/localizacao` / `GET /caronas/:id/localizacoes` — Telemetria GPS ao vivo com recálculo/encurtamento dinâmico da rota e verificação de entrada no geofence do campus (`<= 500m`).
- `POST /caronas/:id/finalizar` — Finaliza a carona somente quando a telemetria GPS do motorista estiver dentro do raio de `500m` do Campus UNIFEB (validado via Haversine).
- `POST /caronas/:id/sos` — Acionamento de SOS **idempotente** (passageiro ou motorista), com disparo opcional para webhook externo (`SOS_WEBHOOK_URL`).

### Segurança do Campus (`/seguranca`)
- `POST /seguranca/login` — Autenticação de agente (`scrypt` + `timingSafeEqual` + rate limit de 10 req/15min), retorna JWT de 8h (`role: 'AGENTE'`).
- `GET /seguranca/sos?status=abertos|todos` — Lista chamados SOS com dados da carona, nomes, veículo/placa e última localização ao vivo em query única (sem N+1).
- `POST /seguranca/sos/:id/assumir` — Transição condicional `ABERTO` → `EM_ATENDIMENTO` (`409` se outro agente já assumiu).
- `POST /seguranca/sos/:id/resolver` — Encerra o chamado (`RESOLVIDO` ou `FALSO_ALARME` + observação) exclusivamente pelo agente que assumiu (`403` caso contrário) e finaliza a carona na mesma transação.

