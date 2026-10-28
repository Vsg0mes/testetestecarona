# Prompt de continuação — Carona Universitária Validada (UNIFEB)

> Copie tudo abaixo da linha e cole como primeira mensagem para o assistente na nova máquina.

---

Atue como Desenvolvedor Full-Stack Sênior e especialista em hackathons. Estou continuando o MVP **"Carona Universitária Validada"**, um app de caronas fechado para a comunidade acadêmica do **UNIFEB (Barretos-SP)**. O hackathon dura 4 dias, então o foco é o caminho feliz, sem over-engineering. O código já existe neste repositório. **Leia os arquivos antes de alterar qualquer coisa.**

## Visão e diferenciais (não podem ser quebrados)
- **Anti "Uber pirata":** toda carona precisa começar OU terminar no campus. Isso é validado no backend (Haversine) E no banco (CHECK constraint).
- **Anti "Tinder":** o chat NÃO tem texto livre. Aceita só IDs: 1 = "Estou no portão", 2 = "Chegando", 3 = "Tive um imprevisto".
- **Login:** mock de SSO. Só aceita e-mails `@unifeb.edu.br` e gera um JWT HS256 com validade de 12h.
- **SOS:** muda o status da carona para `EMERGENCIA` e grava um log na tabela `eventos_sos`, tudo na mesma transação.

## Stack
- **Infra:** Docker Compose com apenas 2 contêineres: `db` (postgres:16-alpine), que fica numa rede interna sem porta exposta, e `api` (node:22-alpine, porta 3000, read_only, sem root).
- **Backend:** Node 22, Express 5, `pg` direto (sem ORM), helmet, express-rate-limit, jsonwebtoken.
- **Frontend:** Expo SDK 52 (React Native 0.76), rodando no celular e também na **web** (react-native-web).

## Estrutura
```
docker-compose.yml  .env.example  (.env é local, não versionar)
db/init.sql                         # schema + constraints + função perto_do_campus()
backend/src/server.js               # express, helmet, error handler
backend/src/db.js                   # Pool pg
backend/src/geofence.js             # CAMPUS + haversine
backend/src/middleware/auth.js      # signToken / requireAuth
backend/src/routes/auth.js          # POST /login
backend/src/routes/caronas.js       # demais rotas (protegidas)
mobile/App.js                       # navegação por estado (login <-> mapa)
mobile/src/api/client.js            # axios + interceptor JWT; na web usa http://<host>:3000
mobile/src/api/storage(.web).js     # SecureStore no celular / sessionStorage na web
mobile/src/ui/dialogs.js            # notify/confirm multiplataforma
mobile/src/components/CampusMap(.web).js  # react-native-maps no celular / Leaflet na web
mobile/src/components/ChatModal.js  # só botões, sem TextInput, polling de 4s
mobile/src/screens/LoginScreen.js, MapScreen.js
```

## Endpoints
Público: `POST /login`, `GET /health`.
Protegidos (Bearer): `GET /campus`, `GET /caronas`, `POST /caronas`, `POST /caronas/:id/entrar`, `POST /caronas/:id/sos`, `GET /mensagens`, `GET|POST /caronas/:id/mensagens` (body `{ "mensagemId": 1|2|3 }`).

## Banco (db/init.sql)
- **Tabelas:** `usuarios` (CHECK de e-mail `@unifeb\.edu\.br`), `caronas` (CHECK `chk_geofence_campus`, enum `status_carona`), `mensagens_pre_definidas` (seed 1, 2, 3), `mensagens_carona` (só IDs) e `eventos_sos`.
- **Campus:** UNIFEB, Av. Prof. Roberto Frade Monte, 389 → **lat -20.5747, lng -48.5612, raio de 500 m**.
- ⚠️ Essa coordenada está **duplicada**: na função SQL `perto_do_campus()` e no `.env` / `docker-compose.yml` (CAMPUS_LAT/LNG/RAIO_M). Se mudar, mude nos dois e rode `docker compose down -v`, porque o init.sql só roda com o volume vazio.

## Como rodar
```bash
cp .env.example .env   # gere os segredos:
#   POSTGRES_PASSWORD=$(openssl rand -hex 16)   JWT_SECRET=$(openssl rand -hex 32)  (mín. 32 chars, senão a API não sobe)
docker compose up --build -d
cd mobile && npm install && npx expo install --fix
npx expo start --web --port 8081      # site em http://localhost:8081
# celular: troque extra.apiUrl no mobile/app.json pelo IP da máquina e use o Expo Go
```

## Lições já aprendidas (não repetir)
1. **NÃO iniciar o Expo com `CI=1`**: isso desliga a observação de arquivos, e o navegador fica recebendo código antigo.
2. **No `pg`**, não reutilizar o mesmo `$1` em contextos de tipo diferentes (ex.: VARCHAR e `split_part`), porque dá erro "inconsistent types". Passe parâmetros separados.
3. **Tiles do CARTO agora exigem API key.** Use `tile.openstreetmap.org` com o filtro CSS `.tiles-dark` (invert + hue-rotate).
4. **O `import 'leaflet/dist/leaflet.css'` não funciona bem no Metro web.** O CSS é injetado via `<link>` do unpkg dentro de `CampusMap.web.js`. Sem esse CSS, os tiles cobrem a página inteira.
5. **O mapa web fica num wrapper com `zIndex: 0` e `isolation: isolate`**, e os overlays (header, SOS, painel) têm zIndex 10/11. Sem isso, as camadas do Leaflet (z-index 400+) ficam por cima da UI.
6. **`Alert.alert` com botões não funciona no react-native-web.** Use `notify` / `confirm` de `src/ui/dialogs.js`.
7. **Sequences não voltam** quando um INSERT é rejeitado pelo CHECK. Não presuma IDs em testes.
8. **Pacote extra necessário para a web:** `expo-asset` (além de react-dom, react-native-web, @expo/metro-runtime, leaflet@1.9 e react-leaflet@4).

## Estado atual
- ✅ Opção A concluída: `GET /minha-carona`, `POST /caronas/:id/finalizar`, `db/seed.sql` (5 usuários + 5 caronas em Barretos), modal "Buscar carona" com botão Entrar, painel de carona ativa (motorista/passageiro) com polling de 5s. Fluxo testado via curl.
- Seed: `docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/seed.sql` (idempotente).
- ✅ Localização ao vivo: tabela `localizacoes_carona` (`db/003_localizacao.sql`), `POST /caronas/:id/localizacao`, `GET /caronas/:id/localizacoes`. Só em carona EM_ANDAMENTO/EMERGENCIA, ciclo de 4s. Clique no mapa durante a viagem sobrescreve o GPS (necessário na demo com 2 abas na mesma máquina).
- ⚠️ **Chat livre TEMPORÁRIO** ligado (`CHAT_LIVRE=true` no compose; migração `db/002_chat_livre.sql`, `GET /config`). Para voltar ao anti "Tinder": `CHAT_LIVRE=false` no `.env` e `docker compose up -d api`.
- ✅ API testada com curl: login (aceita/recusa), geofence (API + CHECK do banco), entrar na carona, chat (ID válido, texto recusado, ID inexistente recusado), SOS + log.
- ✅ Versão web roda, com mapa Leaflet escuro centralizado no UNIFEB.
- ⚠️ A UI web acabou de ser corrigida (CSS do Leaflet + z-index), mas falta confirmar visualmente o fluxo completo: login → clicar no mapa → oferecer carona → chat → SOS.
- ⚠️ O domínio `@unifeb.edu.br` foi presumido; confirmar com a faculdade.

## Próximos passos sugeridos (priorizar pelo impacto no pitch)
1. Validar visualmente o fluxo web completo e ajustar o layout para desktop (limitar a largura do painel, ex.: maxWidth 480 centralizado).
2. Tela/lista de caronas disponíveis (`GET /caronas`) com botão "Entrar", para demonstrar motorista e passageiro em 2 abas.
3. Painel simples "Segurança do Campus" listando caronas em `EMERGENCIA` (polling), o que é muito forte na demo.
4. Script de seed com usuários e caronas de exemplo em Barretos para a apresentação.
5. (Opcional) Trocar o polling do chat por SSE, se sobrar tempo.

Responda em português, com código pronto para rodar, e confirme com testes (curl/navegador) antes de dizer que algo funciona.
