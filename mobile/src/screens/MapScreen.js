import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Vibration,
  Platform,
  Modal,
  ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import CampusMap from '../components/CampusMap';
import { notify, confirm } from '../ui/dialogs';
import { api, errMsg } from '../api/client';
import { colors } from '../theme';
import ChatModal from '../components/ChatModal';
import SosChatModal from '../components/SosChatModal';
import CaronasListModal from '../components/CaronasListModal';
import OferecerCaronaModal from '../components/OferecerCaronaModal';

const CAMPUS_FALLBACK = { lat: -20.5747, lng: -48.5612, raio: 500 };

export default function MapScreen({ onLogout }) {
  const [campus, setCampus] = useState(CAMPUS_FALLBACK);
  const [localizacao, setLocalizacao] = useState(null); // localização obtida via GPS (ou ponto no mapa em demo)
  const [permissaoGps, setPermissaoGps] = useState('checking'); // 'checking' | 'granted' | 'denied'
  const [buscandoGps, setBuscandoGps] = useState(false);
  const [erroGps, setErroGps] = useState('');
  const [carona, setCarona] = useState(null);
  const [meuId, setMeuId] = useState(null);
  const [chat, setChat] = useState(false);
  const [chatSos, setChatSos] = useState(false);
  const [lista, setLista] = useState(false);
  const [oferecendo, setOferecendo] = useState(false);
  const [pessoas, setPessoas] = useState([]);
  const [embarcando, setEmbarcando] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  const [modalReabertura, setModalReabertura] = useState(null); // { vagasDisponiveis, mensagem }
  const [republicando, setRepublicando] = useState(false);

  // Quando o usuário move a posição manualmente no mapa (demo web), pausa sobrescrita automática do GPS fixo do PC
  const overrideGpsAteRef = useRef(0);

  const souMotorista = Boolean(carona && carona.motorista_id === meuId);
  const ativa = Boolean(
    carona && ['ABERTA', 'EM_ANDAMENTO', 'EMERGENCIA'].includes(carona.status)
  );
  const emPercurso = Boolean(
    carona &&
      (carona.status === 'EM_ANDAMENTO' ||
        carona.status === 'EMERGENCIA' ||
        (carona.passageiros && carona.passageiros.length > 0))
  );

  // Envia telemetria para POST /caronas/:id/localizacao e atualiza rota_ativa + validação de geofence em tempo real
  const enviarTelemetria = useCallback(
    async (pos, caronaIdAlvo) => {
      const id = caronaIdAlvo || carona?.id;
      if (!id || !pos || typeof pos.lat !== 'number' || typeof pos.lng !== 'number') return null;
      try {
        const { data } = await api.post(`/caronas/${id}/localizacao`, {
          lat: pos.lat,
          lng: pos.lng,
        });
        if (data && data.ok) {
          setCarona((atual) => {
            if (!atual || atual.id !== id) return atual;
            return {
              ...atual,
              tem_telemetria_motorista:
                atual.motorista_id === meuId ? true : atual.tem_telemetria_motorista,
              motorista_lat: atual.motorista_id === meuId ? pos.lat : atual.motorista_lat,
              motorista_lng: atual.motorista_id === meuId ? pos.lng : atual.motorista_lng,
              distancia_campus_m:
                typeof data.distancia_campus_m === 'number'
                  ? data.distancia_campus_m
                  : atual.distancia_campus_m,
              motorista_no_campus: Boolean(data.motorista_no_campus),
              pode_finalizar: Boolean(data.pode_finalizar),
              rota_ativa: data.rota_ativa || atual.rota_ativa,
            };
          });
        }
        return data;
      } catch {
        return null;
      }
    },
    [carona?.id, meuId]
  );

  // ENVIO da minha posição durante a viagem via GPS automático
  useEffect(() => {
    if (!ativa || !carona?.id) {
      setPessoas([]);
      return;
    }

    if (souMotorista) {
      let sub = null;
      let ultimo = 0;
      let cancelado = false;
      Location.watchPositionAsync(
        {
          accuracy: Platform.OS === 'web' ? Location.Accuracy.Balanced : Location.Accuracy.High,
          timeInterval: 1000,
          distanceInterval: 3,
        },
        (g) => {
          if (Date.now() < overrideGpsAteRef.current) return;
          const agora = Date.now();
          if (agora - ultimo < 1000) return;
          ultimo = agora;
          const coords = { lat: g.coords.latitude, lng: g.coords.longitude };
          setLocalizacao(coords);
          enviarTelemetria(coords, carona.id);
        }
      )
        .then((s) => {
          if (cancelado) s.remove();
          else sub = s;
        })
        .catch(() => {});
      return () => {
        cancelado = true;
        sub?.remove();
      };
    }

    async function pontual() {
      if (Date.now() < overrideGpsAteRef.current) return;
      try {
        const g = await Location.getCurrentPositionAsync({});
        const coords = { lat: g.coords.latitude, lng: g.coords.longitude };
        setLocalizacao(coords);
        enviarTelemetria(coords, carona.id);
      } catch {}
    }
    pontual();
    const t = setInterval(pontual, 5000);
    return () => clearInterval(t);
  }, [ativa, carona?.id, souMotorista, enviarTelemetria]);

  // LEITURA das posições (polling de 2s)
  const lerLocalizacoes = useCallback(async () => {
    if (!ativa || !carona?.id) return;
    try {
      const { data } = await api.get(`/caronas/${carona.id}/localizacoes`);
      setPessoas(data.map((u) => ({ ...u, eu: u.usuario_id === meuId })));
    } catch {}
  }, [ativa, carona?.id, meuId]);

  useEffect(() => {
    if (!ativa || !carona?.id) return;
    lerLocalizacoes();
    const t = setInterval(lerLocalizacoes, 2000);
    return () => clearInterval(t);
  }, [ativa, carona?.id, lerLocalizacoes]);

  // Restaura carona ativa, paradas, rota_ativa e validação de geofence
  const sincronizar = useCallback(async () => {
    try {
      const { data } = await api.get('/minha-carona');
      setMeuId(data.usuarioId);
      setCarona(data.carona);
    } catch {}
  }, []);

  useEffect(() => {
    sincronizar();
    const t = setInterval(sincronizar, 3000);
    return () => clearInterval(t);
  }, [sincronizar]);

  async function entrar(c) {
    if (carona) return notify('Você já tem uma carona ativa', 'Encerre a atual antes de entrar em outra.');
    try {
      const payload =
        localizacao && typeof localizacao.lat === 'number' && typeof localizacao.lng === 'number'
          ? { lat: localizacao.lat, lng: localizacao.lng }
          : {};
      const { data } = await api.post(`/caronas/${c.id}/entrar`, payload);
      setCarona(data);
      setLista(false);
      await sincronizar();
      notify('Você entrou na carona ✅', `Motorista: ${c.motorista_nome}. Aguarde o embarque no ponto.`);
    } catch (e) {
      notify('Não foi possível entrar', errMsg(e));
    }
  }

  // Clique no mapa:
  // - Sem carona ativa: define/ajusta ponto de origem
  // - Com carona ativa: atualiza telemetria GPS em tempo real via POST /caronas/:id/localizacao
  async function handleMapPick(coords) {
    if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') return;
    overrideGpsAteRef.current = Date.now() + 120000;
    setLocalizacao(coords);
    setPermissaoGps('granted');
    setErroGps('');
    if (ativa && carona?.id) {
      await enviarTelemetria(coords, carona.id);
      await lerLocalizacoes();
    }
  }

  // Avança um passo ao longo da polilinha da rota ativa (útil para demonstrar encurtamento de rota nas vias)
  async function avancarPassoNaRota() {
    if (!carona?.id || !carona?.rota_ativa) return;
    const geom = carona.rota_ativa.geometria;
    const dest = carona.rota_ativa.destino;
    let proximoPonto = null;

    if (Array.isArray(geom) && geom.length >= 2) {
      // Avança ~25% dos pontos restantes da via ou direto ao destino se estiver perto
      const idx = geom.length <= 4 ? geom.length - 1 : Math.min(geom.length - 1, Math.max(2, Math.floor(geom.length * 0.35)));
      proximoPonto = { lat: geom[idx][0], lng: geom[idx][1] };
    } else if (dest) {
      proximoPonto = { lat: dest.lat, lng: dest.lng };
    }

    if (proximoPonto) {
      overrideGpsAteRef.current = Date.now() + 120000;
      setLocalizacao(proximoPonto);
      await enviarTelemetria(proximoPonto, carona.id);
      await lerLocalizacoes();
    }
  }

  // Fluxo 2: Motorista confirma "Passageiro Embarcou"
  async function confirmarEmbarquePassageiro() {
    if (!carona?.id || embarcando) return;
    setEmbarcando(true);
    try {
      const { data } = await api.post(`/caronas/${carona.id}/embarcar`);
      setCarona(data);
      await lerLocalizacoes();

      const vagasRestantes =
        typeof data.vagas_disponiveis === 'number' ? data.vagas_disponiveis : 0;

      // Logo após confirmar o embarque, verifica vagas_disponiveis e exibe o prompt se ainda houver vagas
      if (vagasRestantes > 0) {
        const msg =
          data.mensagem_reabertura ||
          `Você ainda tem ${vagasRestantes} vaga(s) disponível(is). Deseja republicar a carona para encontrar outros passageiros pelo caminho?`;
        setModalReabertura({
          caronaId: data.id,
          vagasDisponiveis: vagasRestantes,
          mensagem: msg,
        });
      } else {
        notify(
          'Passageiro embarcado ✅',
          'Todos os assentos foram preenchidos. Rota atualizada para o Campus UNIFEB!'
        );
      }
    } catch (e) {
      notify('Erro ao registrar embarque', errMsg(e));
    } finally {
      setEmbarcando(false);
    }
  }

  // Motorista aceita republicar a carona para encontrar novos passageiros pelo caminho
  async function aceitarRepublicarCarona() {
    const id = modalReabertura?.caronaId || carona?.id;
    if (!id || republicando) return;
    setRepublicando(true);
    try {
      const { data } = await api.post(`/caronas/${id}/republicar`);
      setCarona(data);
      setModalReabertura(null);
      notify(
        'Carona republicada 📢',
        `Sua carona está visível novamente com ${data.vagas_disponiveis} vaga(s) disponível(is) sem interromper sua rota atual.`
      );
    } catch (e) {
      notify('Não foi possível republicar', errMsg(e));
    } finally {
      setRepublicando(false);
    }
  }

  // Fluxo 3: Finalizar Carona (habilitado apenas quando dentro do geofence <= 500m do Campus UNIFEB)
  async function finalizarCaronaNoCampus() {
    if (!carona?.id || finalizando) return;
    if (!carona.pode_finalizar) {
      return notify(
        'Fora do Campus UNIFEB',
        'A finalização só é habilitada quando o GPS do motorista entra no raio de 500m do Campus UNIFEB (-20.5747, -48.5612).'
      );
    }
    setFinalizando(true);
    try {
      await api.post(`/caronas/${carona.id}/finalizar`, {
        lat: carona.motorista_lat,
        lng: carona.motorista_lng,
      });
      setCarona(null);
      setPessoas([]);
      notify('Carona finalizada ✅', 'Chegada ao Campus UNIFEB validada por geofencing com sucesso!');
    } catch (e) {
      notify('Não foi possível finalizar', errMsg(e));
    } finally {
      setFinalizando(false);
    }
  }

  function cancelarOfertaSemPassageiros() {
    if (!carona?.id) return;
    confirm(
      'Cancelar oferta de carona?',
      'Nenhum passageiro embarcou ainda. A oferta será cancelada.',
      'CANCELAR OFERTA',
      async () => {
        try {
          await api.post(`/caronas/${carona.id}/finalizar`);
          setCarona(null);
        } catch (e) {
          notify('Erro', errMsg(e));
        }
      }
    );
  }

  const obterLocalizacaoGPS = useCallback(async (manual = false) => {
    setBuscandoGps(true);
    setErroGps('');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermissaoGps('denied');
        setErroGps('Permissão de GPS negada. Você também pode tocar no mapa para definir sua posição.');
        if (manual) {
          notify(
            'GPS Obrigatório',
            'Para evitar fraudes e garantir a segurança, precisamos da sua localização exata para oferecer caronas.'
          );
        }
        return null;
      }
      setPermissaoGps('granted');
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Platform.OS === 'web' ? Location.Accuracy.Balanced : Location.Accuracy.High,
      });
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setLocalizacao(coords);
      return coords;
    } catch (e) {
      console.warn('Erro ao obter GPS:', e);
      setErroGps('Não foi possível obter sua localização via satélite. Toque no mapa ou tente novamente.');
      if (manual) {
        notify('Erro de GPS', 'Verifique se o serviço de localização do dispositivo está ativado.');
      }
      return null;
    } finally {
      setBuscandoGps(false);
    }
  }, []);

  useEffect(() => {
    api.get('/campus').then(({ data }) => setCampus(data)).catch(() => {});
    obterLocalizacaoGPS(false);
  }, [obterLocalizacaoGPS]);

  async function iniciarOferecerCarona() {
    let loc = localizacao;
    if (!loc) {
      loc = await obterLocalizacaoGPS(true);
    }
    if (!loc) {
      return notify(
        'GPS Obrigatório',
        'Não foi possível obter sua localização exata. Permita o acesso ao GPS ou toque no mapa para indicar sua posição.'
      );
    }
    setOferecendo(true);
  }

  async function confirmarOferecer({ modelo, ano, cor, placa, vagas, partidaEm, horarioPartida }) {
    if (!localizacao) {
      notify('GPS não localizado', 'Aguarde a obtenção da sua posição exata via satélite.');
      return;
    }
    try {
      const { data } = await api.post('/caronas', {
        origem: { lat: localizacao.lat, lng: localizacao.lng },
        destino: { lat: campus.lat, lng: campus.lng },
        partidaEm,
        horarioPartida,
        vagas,
        vagas_disponiveis: vagas,
        carroModelo: modelo,
        carroAno: ano,
        carroCor: cor,
        carroPlaca: placa,
      });
      setCarona(data);
      setMeuId(data.motorista_id);
      // Envia a telemetria inicial do motorista
      enviarTelemetria(localizacao, data.id);
      const horaTexto = new Date(data.partida_em).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      notify(
        'Carona criada ✅',
        `#${data.id} (${modelo}${ano ? ` ${ano}` : ''}, ${vagas} ${vagas === 1 ? 'vaga' : 'vagas'}, saída às ${horaTexto}) publicada.`
      );
    } catch (e) {
      notify('🚫 Bloqueado', errMsg(e));
      throw e;
    }
  }

  async function dispararSOS() {
    if (!carona) return notify('SOS', 'Sem carona ativa. Em perigo, ligue 190.');
    let coords = {};
    if (localizacao && typeof localizacao.lat === 'number' && typeof localizacao.lng === 'number') {
      coords = { lat: localizacao.lat, lng: localizacao.lng };
    } else {
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      } catch {}
    }
    try {
      const { data } = await api.post(`/caronas/${carona.id}/sos`, coords);
      setCarona(data);
      setChatSos(true);
    } catch (e) {
      notify('Falha no SOS', `${errMsg(e)}\nLigue 190.`);
    }
  }

  // SOS Silencioso / Unilateral: apenas o próprio autor do SOS recebe sos_status do backend
  const meuSosAtivo = Boolean(
    carona?.sos_status && ['ABERTO', 'EM_ATENDIMENTO'].includes(carona.sos_status)
  );
  const passageiroAtual = carona?.passageiro_atual || carona?.paradas?.[0] || null;
  const embarcados = carona?.passageiros_embarcados || [];
  const paradasPendentes = carona?.paradas || [];
  const vagasDisponiveis =
    typeof carona?.vagas_disponiveis === 'number' ? carona.vagas_disponiveis : carona?.vagas ?? 0;
  const podeFinalizar = Boolean(carona?.pode_finalizar);
  const rotaParaMapa = carona
    ? carona.rota_ativa || {
        origem: { lat: carona.origem_lat, lng: carona.origem_lng },
        destino: { lat: carona.destino_lat, lng: carona.destino_lng },
      }
    : null;

  return (
    <View style={s.root}>
      <CampusMap
        campus={campus}
        ponto={carona ? null : localizacao}
        sentido="IDA"
        onPick={handleMapPick}
        rota={rotaParaMapa}
        pessoas={pessoas}
        paradas={paradasPendentes}
        sos={null}
      />

      {/* Header */}
      <View style={s.header}>
        <Text style={s.brand}>Carona Universitária</Text>
        <TouchableOpacity onPress={onLogout}>
          <Text style={{ color: colors.muted }}>Sair</Text>
        </TouchableOpacity>
      </View>

      {/* Botão de SOS Silencioso: feedback discreto apenas para o usuário que acionou */}
      <TouchableOpacity
        style={[s.sos, meuSosAtivo && s.sosSilenciosoAtivo]}
        onLongPress={dispararSOS}
        onPress={dispararSOS}
        delayLongPress={500}
      >
        <Text style={[s.sosText, meuSosAtivo && s.sosTextAtivo]}>
          {meuSosAtivo ? '🛡️ SOS' : 'SOS'}
        </Text>
        {meuSosAtivo && <Text style={s.sosSubText}>ATIVO</Text>}
      </TouchableOpacity>

      {/* Painel inferior (mantém modo normal de navegação mesmo durante SOS silencioso) */}
      <View style={s.panel}>
        {meuSosAtivo && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setChatSos(true)}
            style={s.sosSilenciosoBox}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={s.sosSilenciosoTitulo}>
                  🛡️ SOS silencioso enviado (visível apenas para você)
                </Text>
                <Text style={s.sosSilenciosoDetalhe}>
                  {carona.sos_status === 'EM_ATENDIMENTO' && carona.sos_agente_nome
                    ? `Acompanhamento ativo por ${carona.sos_agente_nome}`
                    : 'A Segurança do Campus recebeu sua localização em tempo real.'}
                </Text>
              </View>
              <View style={s.sosChatPill}>
                <Text style={s.sosChatPillText}>💬 Chat Segurança</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}

        {carona ? (
          <View>
            {/* Status principal da carona e rota ativa */}
            <View style={s.campo}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={s.campoLabel}>
                  {souMotorista ? 'Você é o motorista' : 'Você é o passageiro'} · #{carona.id}
                </Text>
                <Text style={s.vagasBadge}>
                  💺 {vagasDisponiveis}/{carona.vagas} vaga(s) livre(s)
                </Text>
              </View>

              <Text style={s.campoValor}>
                {passageiroAtual
                  ? `🚗 A caminho de ${passageiroAtual.nome} (Parada de coleta)`
                  : embarcados.length > 0
                    ? carona.status === 'ABERTA'
                      ? `🎓 Rumo ao Campus UNIFEB · 📢 Buscando + passageiros`
                      : `🎓 Em rota final para o Campus UNIFEB`
                    : '⏳ Aguardando solicitação de passageiro'}
              </Text>

              {/* Resumo de paradas e passageiros embarcados */}
              {(paradasPendentes.length > 0 || embarcados.length > 0) && (
                <View style={s.paradasResumo}>
                  {paradasPendentes.map((p, idx) => (
                    <Text key={`pend-${p.usuario_id}`} style={s.paradaItemPendente}>
                      📍 {idx + 1}ª Parada: {p.nome} ({p.status})
                    </Text>
                  ))}
                  {embarcados.map((p) => (
                    <Text key={`emb-${p.usuario_id}`} style={s.paradaItemEmbarcado}>
                      ✅ {p.nome}: {p.status}
                    </Text>
                  ))}
                </View>
              )}
            </View>

            {/* Dados do veículo */}
            {(carona.carro_modelo || carona.carro_placa) && (
              <View style={[s.campo, { backgroundColor: 'rgba(11,16,32,0.8)' }]}>
                <Text style={s.campoLabel}>
                  {souMotorista ? 'Seu Veículo Cadastrado' : 'Veículo do Motorista'}
                </Text>
                <Text style={s.campoValor}>
                  🚗 {carona.carro_modelo || 'Veículo'} {carona.carro_ano ? `(${carona.carro_ano})` : ''}{' '}
                  {carona.carro_cor ? `· ${carona.carro_cor}` : ''}
                </Text>
                <Text style={[s.dica, { color: colors.primary2, marginTop: 4, fontWeight: '700' }]}>
                  Placa: {carona.carro_placa || '---'} · 💺 {vagasDisponiveis}{' '}
                  {vagasDisponiveis === 1 ? 'vaga livre' : 'vagas livres'} · 🕒 Saída:{' '}
                  {new Date(carona.partida_em).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            )}

            {/* Indicador de telemetria GPS + distância ao geofence do Campus UNIFEB */}
            <View style={s.telemetriaRow}>
              <Text style={s.dica}>
                {(() => {
                  const m = pessoas.find((u) => u.papel === 'MOTORISTA');
                  if (!m && !carona.tem_telemetria_motorista) return '⚪ Aguardando sinal GPS do motorista…';
                  return podeFinalizar
                    ? `🟢 Dentro do Campus UNIFEB (${carona.distancia_campus_m ?? 0}m ≤ 500m)`
                    : `📡 GPS ativo · Distância ao Campus: ${carona.distancia_campus_m ?? '--'}m`;
                })()}
              </Text>

              {souMotorista && (
                <TouchableOpacity style={s.simularBtn} onPress={avancarPassoNaRota}>
                  <Text style={s.simularBtnText}>🧭 Avançar na via</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Botão "Passageiro Embarcou": visível para o motorista quando está a caminho do passageiro */}
            {souMotorista && passageiroAtual && (
              <TouchableOpacity
                style={[s.btnEmbarcou, embarcando && { opacity: 0.6 }]}
                disabled={embarcando}
                onPress={confirmarEmbarquePassageiro}
              >
                {embarcando ? (
                  <ActivityIndicator color="#0B1020" />
                ) : (
                  <Text style={s.btnEmbarcouText}>
                    ✅ Passageiro Embarcou ({passageiroAtual.nome})
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* Ações principais: Chat e Finalizar Carona (validado por Geofencing no Campus) */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <TouchableOpacity
                style={[
                  s.btn,
                  { flex: 1 },
                  !emPercurso && carona.status === 'ABERTA' && { opacity: 0.4 },
                ]}
                disabled={!emPercurso && carona.status === 'ABERTA'}
                onPress={() => setChat(true)}
              >
                <Text style={s.btnText}>💬 Mensagens</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  s.btn,
                  podeFinalizar ? s.btnFinalizarHabilitado : s.btnFinalizarDesabilitado,
                  { flex: 1.2 },
                ]}
                disabled={!podeFinalizar || finalizando}
                onPress={finalizarCaronaNoCampus}
              >
                <Text
                  style={[
                    s.btnText,
                    podeFinalizar ? { color: '#0B1020', fontWeight: '900' } : { color: colors.muted },
                  ]}
                >
                  {finalizando
                    ? 'Finalizando...'
                    : podeFinalizar
                      ? '🏁 Finalizar Carona'
                      : '🔒 Finalizar Carona'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Caso a oferta ainda não tenha nenhum passageiro, permite cancelar oferta */}
            {souMotorista && carona.status === 'ABERTA' && !emPercurso && (
              <TouchableOpacity style={s.cancelarOfertaLink} onPress={cancelarOfertaSemPassageiros}>
                <Text style={s.cancelarOfertaText}>Cancelar oferta de carona</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View>
            {permissaoGps === 'denied' && (
              <TouchableOpacity style={s.alertaGps} onPress={() => obterLocalizacaoGPS(true)}>
                <Text style={s.alertaGpsText}>
                  ⚠️ Localização bloqueada. Toque aqui para permitir o GPS ou toque no mapa.
                </Text>
              </TouchableOpacity>
            )}

            {/* Origem: localização real do usuário via GPS */}
            <View style={s.campo}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={s.campoLabel}>Origem (Sua Localização GPS Real)</Text>
                <TouchableOpacity onPress={() => obterLocalizacaoGPS(true)} disabled={buscandoGps}>
                  <Text style={s.linkAtualizar}>
                    {buscandoGps ? '⏳ Buscando...' : '🔄 Atualizar GPS'}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={s.campoValor} numberOfLines={1}>
                {localizacao
                  ? `📍 ${localizacao.lat.toFixed(4)}, ${localizacao.lng.toFixed(4)} (GPS Validado)`
                  : buscandoGps
                    ? '📡 Conectando ao GPS do dispositivo...'
                    : '⚠️ Toque em "Atualizar GPS" ou no mapa para localizar'}
              </Text>
            </View>

            {/* Destino: travado no campus */}
            <View style={s.campo}>
              <Text style={s.campoLabel}>Destino (Fixo)</Text>
              <Text style={s.campoValor}>🔒 Campus UNIFEB (Travado)</Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <TouchableOpacity
                style={[s.btn, { flex: 1 }, !localizacao && { opacity: 0.6 }]}
                onPress={iniciarOferecerCarona}
              >
                <Text style={s.btnText}>Oferecer carona</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btn, s.btnGhost, { flex: 1 }]}
                onPress={() => setLista(true)}
              >
                <Text style={s.btnText}>🔎 Buscar carona</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Modal/Prompt de Reabertura de Vagas após embarque */}
      <Modal
        visible={Boolean(modalReabertura)}
        animationType="fade"
        transparent
        onRequestClose={() => setModalReabertura(null)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>💺 Vagas Disponíveis na Carona</Text>
            <Text style={s.modalMensagem}>
              {modalReabertura?.mensagem ||
                `Você ainda tem ${modalReabertura?.vagasDisponiveis ?? 1} vaga(s) disponível(is). Deseja republicar a carona para encontrar outros passageiros pelo caminho?`}
            </Text>

            <View style={s.modalBotoes}>
              <TouchableOpacity
                style={[s.modalBtnSecundario, { flex: 1 }]}
                disabled={republicando}
                onPress={() => setModalReabertura(null)}
              >
                <Text style={s.modalBtnSecundarioText}>Não, seguir rota</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.modalBtnPrimario, { flex: 1.3 }, republicando && { opacity: 0.6 }]}
                disabled={republicando}
                onPress={aceitarRepublicarCarona}
              >
                <Text style={s.modalBtnPrimarioText}>
                  {republicando ? 'Republicando...' : 'Sim, republicar'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ChatModal
        visible={chat}
        onClose={() => setChat(false)}
        caronaId={carona?.id}
        meuId={meuId}
        motoristaId={carona?.motorista_id}
      />
      {meuSosAtivo && carona?.sos_id && (
        <SosChatModal
          visible={chatSos}
          onClose={() => setChatSos(false)}
          sosId={carona.sos_id}
          modo="USUARIO"
          sosStatus={carona.sos_status}
          agenteNome={carona.sos_agente_nome}
        />
      )}
      <CaronasListModal
        visible={lista}
        onClose={() => setLista(false)}
        campus={campus}
        meuId={meuId}
        onEntrar={entrar}
      />
      <OferecerCaronaModal
        visible={oferecendo}
        onClose={() => setOferecendo(false)}
        onConfirmar={confirmarOferecer}
        sentido="IDA"
        ponto={localizacao}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(11,16,32,0.85)',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  brand: { color: colors.text, fontWeight: '800', fontSize: 16 },
  sos: {
    position: 'absolute',
    right: 20,
    top: 120,
    zIndex: 11,
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.35)',
    shadowColor: colors.danger,
    shadowOpacity: 0.8,
    shadowRadius: 16,
    elevation: 12,
  },
  sosText: { color: '#fff', fontWeight: '900', fontSize: 22, letterSpacing: 1.5 },
  sosTextAtivo: { color: colors.primary2, fontSize: 15, letterSpacing: 0.5 },
  sosSubText: { color: '#fff', fontWeight: '800', fontSize: 10, marginTop: 1 },
  sosSilenciosoAtivo: {
    backgroundColor: 'rgba(18, 24, 51, 0.95)',
    borderColor: colors.primary2,
    borderWidth: 2.5,
    shadowColor: colors.primary2,
    shadowOpacity: 0.35,
  },
  sosSilenciosoBox: {
    backgroundColor: 'rgba(0, 210, 211, 0.1)',
    borderColor: 'rgba(0, 210, 211, 0.35)',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  sosSilenciosoTitulo: {
    color: colors.primary2,
    fontSize: 11,
    fontWeight: '800',
  },
  sosSilenciosoDetalhe: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 1,
  },
  sosChatPill: {
    backgroundColor: colors.primary2,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  sosChatPillText: {
    color: '#0B1020',
    fontSize: 11,
    fontWeight: '900',
  },
  panel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    padding: 20,
    paddingBottom: 32,
    width: '100%',
    maxWidth: 480,
    marginHorizontal: 'auto',
    backgroundColor: 'rgba(18,24,51,0.96)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
  },
  alerta: { color: colors.danger, fontWeight: '800', textAlign: 'center', marginBottom: 4 },
  sosStatusBox: {
    backgroundColor: 'rgba(255, 59, 92, 0.14)',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  sosStatusDetalhe: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  alertaGps: {
    backgroundColor: 'rgba(255, 59, 92, 0.15)',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  alertaGpsText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  linkAtualizar: {
    color: colors.primary2,
    fontSize: 12,
    fontWeight: '700',
  },
  dica: { color: colors.muted, fontSize: 11, marginTop: 2, flex: 1 },
  campo: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  campoLabel: { color: colors.muted, fontSize: 11, textTransform: 'uppercase' },
  campoValor: { color: colors.text, fontSize: 15, marginTop: 2, fontWeight: '600' },
  vagasBadge: {
    color: colors.primary2,
    fontSize: 11,
    fontWeight: '800',
  },
  paradasResumo: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    gap: 3,
  },
  paradaItemPendente: {
    color: colors.primary2,
    fontSize: 12,
    fontWeight: '700',
  },
  paradaItemEmbarcado: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '700',
  },
  telemetriaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    marginBottom: 4,
    gap: 8,
  },
  simularBtn: {
    backgroundColor: 'rgba(0, 210, 211, 0.16)',
    borderWidth: 1,
    borderColor: colors.primary2,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  simularBtnText: {
    color: colors.primary2,
    fontSize: 11,
    fontWeight: '800',
  },
  btnEmbarcou: {
    backgroundColor: colors.success,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginTop: 6,
  },
  btnEmbarcouText: {
    color: '#0B1020',
    fontWeight: '900',
    fontSize: 15,
  },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  btnFinalizarHabilitado: {
    backgroundColor: colors.success,
    borderWidth: 1,
    borderColor: colors.success,
  },
  btnFinalizarDesabilitado: {
    backgroundColor: 'rgba(22, 31, 61, 0.5)',
    borderWidth: 1,
    borderColor: colors.border,
    opacity: 0.45,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelarOfertaLink: {
    alignSelf: 'center',
    marginTop: 10,
    paddingVertical: 4,
  },
  cancelarOfertaText: {
    color: colors.muted,
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#121833',
    borderRadius: 22,
    padding: 22,
    borderWidth: 1.5,
    borderColor: colors.primary2,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
  },
  modalMensagem: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
  },
  modalBotoes: {
    flexDirection: 'row',
    gap: 10,
  },
  modalBtnSecundario: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  modalBtnSecundarioText: {
    color: colors.muted,
    fontWeight: '700',
    fontSize: 14,
  },
  modalBtnPrimario: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  modalBtnPrimarioText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
});
