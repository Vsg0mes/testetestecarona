import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native';
import CampusMap from '../components/CampusMap';
import SosChatModal from '../components/SosChatModal';
import { segurancaApi, segurancaAuth, segErrMsg } from '../api/segurancaClient';
import { notify, confirm } from '../ui/dialogs';
import { colors } from '../theme';

const CAMPUS_FALLBACK = { lat: -20.5747, lng: -48.5612, raio: 500 };

function formatarDuracao(inicioIso, fimIso, agoraMs) {
  if (!inicioIso) return '--';
  const ini = new Date(inicioIso).getTime();
  const fim = fimIso ? new Date(fimIso).getTime() : agoraMs;
  const totalSeg = Math.max(0, Math.floor((fim - ini) / 1000));
  const h = Math.floor(totalSeg / 3600);
  const m = Math.floor((totalSeg % 3600) / 60);
  const s = totalSeg % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }
  return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function statusMeta(status) {
  switch (status) {
    case 'ABERTO':
      return { label: '🚨 ABERTO', cor: colors.danger, bg: 'rgba(255,59,92,0.2)' };
    case 'EM_ATENDIMENTO':
      return { label: '🛡️ EM ATENDIMENTO', cor: '#FFA502', bg: 'rgba(255,165,2,0.2)' };
    case 'RESOLVIDO':
      return { label: '✅ RESOLVIDO', cor: colors.success, bg: 'rgba(46,213,115,0.18)' };
    case 'FALSO_ALARME':
      return { label: '⚪ FALSO ALARME', cor: colors.muted, bg: 'rgba(139,147,181,0.18)' };
    default:
      return { label: status, cor: colors.text, bg: colors.card };
  }
}

export default function SegurancaPainelScreen({ agenteInicial, onLogout }) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 840;

  const [agente, setAgente] = useState(agenteInicial || null);
  const [campus, setCampus] = useState(CAMPUS_FALLBACK);
  const [aba, setAba] = useState('abertos'); // 'abertos' | 'todos'
  const [chamados, setChamados] = useState([]);
  const [selecionadoId, setSelecionadoId] = useState(null);
  const [chatSosId, setChatSosId] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [acaoId, setAcaoId] = useState(null);

  // Campos de resolução por chamado
  const [falsoAlarmePorId, setFalsoAlarmePorId] = useState({});
  const [obsPorId, setObsPorId] = useState({});

  // Relógio de 1s para tempo decorrido e pisca-alerta visual
  const [agoraMs, setAgoraMs] = useState(Date.now());
  const [pisca, setPisca] = useState(false);

  // Alerta sonoro via Web Audio API
  const [somAtivo, setSomAtivo] = useState(false);
  const [novoSosDestaque, setNovoSosDestaque] = useState(false);
  const audioCtxRef = useRef(null);
  const idsConhecidosRef = useRef(new Set());
  const primeiraCargaRef = useRef(true);

  const tocarBeep = useCallback(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      // Sequência de 3 bipes de alerta (880Hz -> 1174Hz -> 880Hz)
      const freqs = [880, 1174, 880];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.22);
        gain.gain.setValueAtTime(0.18, ctx.currentTime + idx * 0.22);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.22 + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.22);
        osc.stop(ctx.currentTime + idx * 0.22 + 0.19);
      });
    } catch {}
  }, []);

  function alternarSom() {
    if (!somAtivo) {
      setSomAtivo(true);
      tocarBeep();
    } else {
      setSomAtivo(false);
    }
  }

  useEffect(() => {
    if (!agente) {
      segurancaAuth.getAgente().then((a) => {
        if (a) setAgente(a);
      });
    }
    segurancaApi.get('/seguranca/campus').then(({ data }) => setCampus(data)).catch(() => {});
  }, [agente]);

  // Atualiza contador de segundos e efeito de piscar a cada 1s
  useEffect(() => {
    const t = setInterval(() => {
      setAgoraMs(Date.now());
      setPisca((v) => !v);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const carregarChamados = useCallback(async () => {
    try {
      const { data } = await segurancaApi.get(`/seguranca/sos?status=${aba}`);
      setChamados(data);

      // Detecta novos SOS em aberto para disparar alerta sonoro e destaque visual
      const abertosIds = data.filter((c) => c.status === 'ABERTO').map((c) => c.id);
      let entrouNovo = false;
      for (const id of abertosIds) {
        if (!idsConhecidosRef.current.has(id)) {
          idsConhecidosRef.current.add(id);
          if (!primeiraCargaRef.current) {
            entrouNovo = true;
          }
        }
      }
      data.forEach((c) => idsConhecidosRef.current.add(c.id));
      primeiraCargaRef.current = false;

      if (entrouNovo) {
        setNovoSosDestaque(true);
        if (somAtivo) tocarBeep();
        setTimeout(() => setNovoSosDestaque(false), 10000);
      } else if (abertosIds.length > 0 && somAtivo) {
        // Enquanto houver SOS ABERTO sem ninguém assumir, reforça alerta sonoro
        tocarBeep();
      }

      setSelecionadoId((atual) => {
        if (atual && data.some((c) => c.id === atual)) return atual;
        return data[0]?.id || null;
      });
    } catch {}
    finally {
      setCarregando(false);
    }
  }, [aba, somAtivo, tocarBeep]);

  // Polling de 3s da lista de chamados
  useEffect(() => {
    setCarregando(true);
    carregarChamados();
    const t = setInterval(carregarChamados, 3000);
    return () => clearInterval(t);
  }, [carregarChamados]);

  async function assumirChamado(item) {
    setAcaoId(item.id);
    try {
      await segurancaApi.post(`/seguranca/sos/${item.id}/assumir`);
      setSelecionadoId(item.id);
      await carregarChamados();
      // Abre automaticamente o chat privado direto com o solicitante do SOS
      setChatSosId(item.id);
    } catch (e) {
      notify('Não foi possível assumir', segErrMsg(e));
      await carregarChamados();
    } finally {
      setAcaoId(null);
    }
  }

  function confirmarResolver(item) {
    const ehFalso = !!falsoAlarmePorId[item.id];
    const obs = (obsPorId[item.id] || '').trim();
    confirm(
      ehFalso ? 'Encerrar como Falso Alarme?' : 'Resolver e Encerrar SOS?',
      `O chamado #${item.id} será marcado como ${ehFalso ? 'FALSO_ALARME' : 'RESOLVIDO'} e a carona #${item.carona_id} voltará para FINALIZADA.`,
      'CONFIRMAR',
      async () => {
        setAcaoId(item.id);
        try {
          await segurancaApi.post(`/seguranca/sos/${item.id}/resolver`, {
            falsoAlarme: ehFalso,
            observacao: obs || undefined,
          });
          await carregarChamados();
          notify('Ocorrência encerrada ✅', `SOS #${item.id} finalizado com sucesso.`);
        } catch (e) {
          notify('Erro ao resolver chamado', segErrMsg(e));
          await carregarChamados();
        } finally {
          setAcaoId(null);
        }
      }
    );
  }

  const selecionado = chamados.find((c) => c.id === selecionadoId) || chamados[0] || null;
  const qtdAbertos = chamados.filter((c) => c.status === 'ABERTO').length;
  const qtdEmAtendimento = chamados.filter((c) => c.status === 'EM_ATENDIMENTO').length;
  const alertaPiscando = (qtdAbertos > 0 || novoSosDestaque) && pisca;

  // Coordenada do pino de SOS no mapa (prioriza GPS ao vivo de quem acionou / motorista)
  const sosMapa = selecionado
    ? {
        id: selecionado.id,
        lat:
          typeof selecionado.lat_ao_vivo === 'number'
            ? selecionado.lat_ao_vivo
            : typeof selecionado.lat === 'number'
              ? selecionado.lat
              : typeof selecionado.motorista_lat === 'number'
                ? selecionado.motorista_lat
                : selecionado.origem_lat,
        lng:
          typeof selecionado.lng_ao_vivo === 'number'
            ? selecionado.lng_ao_vivo
            : typeof selecionado.lng === 'number'
              ? selecionado.lng
              : typeof selecionado.motorista_lng === 'number'
                ? selecionado.motorista_lng
                : selecionado.origem_lng,
        carro_placa: selecionado.carro_placa,
        status: selecionado.status,
      }
    : null;

  const rotaMapa = selecionado
    ? {
        origem: { lat: selecionado.origem_lat, lng: selecionado.origem_lng },
        destino: { lat: selecionado.destino_lat, lng: selecionado.destino_lng },
      }
    : null;

  const pessoasMapa = selecionado?.localizacoes || [];

  return (
    <View style={s.root}>
      {/* Barra superior da Central de Segurança */}
      <View style={[s.topbar, alertaPiscando && s.topbarAlerta]}>
        <View style={s.topLeft}>
          <Text style={s.brand}>🛡️ Segurança do Campus · UNIFEB</Text>
          <Text style={s.agenteInfo}>
            {agente ? `Operador: ${agente.nome} (${agente.login})` : 'Operador autenticado'} · Atualização a cada 3s
          </Text>
        </View>

        <View style={s.topRight}>
          <TouchableOpacity
            style={[s.somBtn, somAtivo && s.somBtnAtivo]}
            onPress={alternarSom}
          >
            <Text style={s.somBtnText}>
              {somAtivo ? '🔊 Som Ativo' : '🔔 Ativar som'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.sairBtn} onPress={onLogout}>
            <Text style={s.sairText}>Sair</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Banner piscante quando há SOS ABERTO aguardando atendimento */}
      {qtdAbertos > 0 && (
        <View style={[s.bannerEmergencia, pisca && { backgroundColor: '#FF3B5C' }]}>
          <Text style={s.bannerEmergenciaText}>
            🚨 ATENÇÃO: {qtdAbertos} {qtdAbertos === 1 ? 'CHAMADO SOS ABERTO AGUARDANDO ATENDIMENTO IMEDIATO!' : 'CHAMADOS SOS ABERTOS AGUARDANDO ATENDIMENTO!'}
          </Text>
        </View>
      )}

      {/* Corpo principal: Lista à esquerda + Mapa à direita */}
      <View style={[s.main, !isDesktop && s.mainMobile]}>
        {/* Coluna Esquerda: Lista de Chamados */}
        <View style={[s.sidebar, !isDesktop && s.sidebarMobile]}>
          {/* Abas Abertos / Histórico */}
          <View style={s.tabsRow}>
            <TouchableOpacity
              style={[s.tabBtn, aba === 'abertos' && s.tabBtnAtiva]}
              onPress={() => setAba('abertos')}
            >
              <Text style={[s.tabText, aba === 'abertos' && s.tabTextAtiva]}>
                🚨 Abertos ({qtdAbertos + qtdEmAtendimento})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.tabBtn, aba === 'todos' && s.tabBtnAtiva]}
              onPress={() => setAba('todos')}
            >
              <Text style={[s.tabText, aba === 'todos' && s.tabTextAtiva]}>
                📋 Histórico
              </Text>
            </TouchableOpacity>
          </View>

          {carregando && chamados.length === 0 ? (
            <View style={{ padding: 32, alignItems: 'center' }}>
              <ActivityIndicator color={colors.primary2} />
              <Text style={{ color: colors.muted, marginTop: 10, fontSize: 13 }}>
                Sincronizando chamados de emergência...
              </Text>
            </View>
          ) : chamados.length === 0 ? (
            <View style={s.emptyBox}>
              <Text style={{ fontSize: 32, textAlign: 'center' }}>✅</Text>
              <Text style={s.emptyTitle}>
                {aba === 'abertos' ? 'Nenhum SOS ativo no momento' : 'Nenhum registro de SOS'}
              </Text>
              <Text style={s.emptyDesc}>
                O painel verifica novas ocorrências automaticamente a cada 3 segundos.
              </Text>
            </View>
          ) : (
            <ScrollView style={s.listaScroll} contentContainerStyle={{ paddingBottom: 24 }}>
              {chamados.map((item) => {
                const isSelected = selecionado?.id === item.id;
                const meta = statusMeta(item.status);
                const abertoPiscando = item.status === 'ABERTO' && pisca;
                const assumidoPorMim =
                  item.status === 'EM_ATENDIMENTO' &&
                  agente &&
                  Number(item.atendido_por) === Number(agente.id);
                const tempoTexto = formatarDuracao(item.criado_em, item.resolvido_em, agoraMs);

                return (
                  <TouchableOpacity
                    key={item.id}
                    activeOpacity={0.9}
                    onPress={() => setSelecionadoId(item.id)}
                    style={[
                      s.card,
                      isSelected && s.cardSelecionado,
                      abertoPiscando && s.cardAlertaPiscando,
                    ]}
                  >
                    {/* Cabeçalho do Card */}
                    <View style={s.cardHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={s.cardId}>🚨 SOS #{item.id}</Text>
                        <Text style={s.caronaTag}>Carona #{item.carona_id}</Text>
                      </View>
                      <View style={[s.badge, { backgroundColor: meta.bg, borderColor: meta.cor }]}>
                        <Text style={[s.badgeText, { color: meta.cor }]}>{meta.label}</Text>
                      </View>
                    </View>

                    {/* Tempo decorrido atualizado a cada segundo */}
                    <View style={s.tempoRow}>
                      <Text style={s.tempoLabel}>
                        ⏱️ {item.resolvido_em ? `Duração até encerramento: ${tempoTexto}` : `Tempo decorrido: ${tempoTexto}`}
                      </Text>
                      <Text style={s.horaCriado}>
                        {new Date(item.criado_em).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </Text>
                    </View>

                    {/* Envolvidos: Identificação clara de quem acionou (Motorista ou Passageiro) */}
                    <View style={s.infoBox}>
                      <Text style={[s.infoLine, { color: colors.danger, fontWeight: '900', marginBottom: 2 }]}>
                        🚨{' '}
                        {item.acionado_por_descricao ||
                          (item.acionado_por_papel === 'MOTORISTA' ||
                          Number(item.acionado_por_id) === Number(item.motorista_id)
                            ? `SOS acionado pelo Motorista: ${item.acionado_por_nome}`
                            : `SOS acionado por Passageiro: ${item.acionado_por_nome}`)}
                      </Text>
                      <Text style={s.infoLine}>
                        <Text style={s.infoKey}>🚗 Motorista: </Text>
                        <Text style={s.infoVal}>{item.motorista_nome}</Text>
                      </Text>
                      <Text style={s.infoLine}>
                        <Text style={s.infoKey}>🧍 Passageiro(s): </Text>
                        <Text style={s.infoVal}>{item.passageiro_nome || 'Sem passageiro'}</Text>
                      </Text>
                    </View>

                    {/* Veículo e Placa */}
                    <View style={s.veiculoBox}>
                      <Text style={s.veiculoTexto}>
                        🚘 {item.carro_modelo || 'Veículo não informado'}
                        {item.carro_ano ? ` (${item.carro_ano})` : ''}
                        {item.carro_cor ? ` · ${item.carro_cor}` : ''}
                      </Text>
                      <Text style={s.placaBadge}>
                        PLACA: {item.carro_placa || '---'}
                      </Text>
                    </View>

                    {/* Localização ao vivo */}
                    <View style={s.locRow}>
                      <Text style={s.locText}>
                        📍 GPS:{' '}
                        {typeof item.lat_ao_vivo === 'number' && typeof item.lng_ao_vivo === 'number'
                          ? `${item.lat_ao_vivo.toFixed(4)}, ${item.lng_ao_vivo.toFixed(4)}`
                          : typeof item.lat === 'number' && typeof item.lng === 'number'
                            ? `${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}`
                            : 'Usando origem da carona'}
                      </Text>
                      <Text style={s.locVivo}>
                        {item.localizacoes?.length > 0
                          ? `🟢 ${item.localizacoes.length} GPS ao vivo`
                          : '⚪ Sem telemetria recente'}
                      </Text>
                    </View>

                    {/* Informações de atendimento */}
                    {item.atendido_por_nome && (
                      <Text style={s.atendidoText}>
                        🛡️ Responsável: {item.atendido_por_nome}
                      </Text>
                    )}

                    {item.observacao && (
                      <Text style={s.obsSalvaText}>
                        📝 Observação: {item.observacao}
                      </Text>
                    )}

                    {/* Botão de Chat Privado com o Solicitante do SOS */}
                    <TouchableOpacity
                      style={s.btnChatSos}
                      onPress={() => {
                        setSelecionadoId(item.id);
                        setChatSosId(item.id);
                      }}
                    >
                      <Text style={s.btnChatSosText}>
                        💬 Abrir Chat Direto com Solicitante (SOS)
                      </Text>
                    </TouchableOpacity>

                    {/* Botão: Assumir chamado */}
                    {item.status === 'ABERTO' && (
                      <TouchableOpacity
                        style={[s.btnAssumir, acaoId === item.id && { opacity: 0.6 }]}
                        disabled={acaoId === item.id}
                        onPress={() => assumirChamado(item)}
                      >
                        <Text style={s.btnAssumirText}>
                          {acaoId === item.id ? 'Assumindo...' : '🛡️ Assumir Chamado e Atender SOS'}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {/* Área de resolução (só para quem assumiu) */}
                    {item.status === 'EM_ATENDIMENTO' && (
                      <View style={s.resolverArea}>
                        {assumidoPorMim ? (
                          <>
                            <TouchableOpacity
                              style={s.checkRow}
                              onPress={() =>
                                setFalsoAlarmePorId((p) => ({ ...p, [item.id]: !p[item.id] }))
                              }
                            >
                              <View
                                style={[
                                  s.checkbox,
                                  falsoAlarmePorId[item.id] && s.checkboxAtivo,
                                ]}
                              >
                                {falsoAlarmePorId[item.id] && (
                                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '900' }}>✓</Text>
                                )}
                              </View>
                              <Text style={s.checkLabel}>Classificar como Falso Alarme</Text>
                            </TouchableOpacity>

                            <TextInput
                              style={s.obsInput}
                              placeholder="Observação curta do atendimento (opcional)..."
                              placeholderTextColor={colors.muted}
                              maxLength={300}
                              value={obsPorId[item.id] || ''}
                              onChangeText={(txt) =>
                                setObsPorId((p) => ({ ...p, [item.id]: txt }))
                              }
                            />

                            <TouchableOpacity
                              style={[s.btnResolver, acaoId === item.id && { opacity: 0.6 }]}
                              disabled={acaoId === item.id}
                              onPress={() => confirmarResolver(item)}
                            >
                              <Text style={s.btnResolverText}>
                                {acaoId === item.id
                                  ? 'Encerrando...'
                                  : falsoAlarmePorId[item.id]
                                    ? '⚪ Encerrar como Falso Alarme'
                                    : '✅ Resolver Chamado'}
                              </Text>
                            </TouchableOpacity>
                          </>
                        ) : (
                          <Text style={s.outroAgenteAviso}>
                            🔒 Assumido por {item.atendido_por_nome || 'outro agente'}. Apenas o agente responsável pode encerrar.
                          </Text>
                        )}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* Coluna Direita: Mapa ao vivo com Campus, SOS e posições */}
        <View style={[s.mapArea, !isDesktop && s.mapAreaMobile]}>
          <CampusMap
            campus={campus}
            ponto={null}
            onPick={null}
            rota={rotaMapa}
            pessoas={pessoasMapa}
            sos={sosMapa}
          />

          {/* Overlay informativo sobre o mapa */}
          <View style={s.mapOverlay}>
            {selecionado ? (
              <>
                <Text style={s.mapOverlayTitle}>
                  📍 Monitorando SOS #{selecionado.id} ·{' '}
                  {selecionado.acionado_por_descricao ||
                    (selecionado.acionado_por_papel === 'MOTORISTA'
                      ? `SOS acionado pelo Motorista: ${selecionado.acionado_por_nome}`
                      : `SOS acionado por Passageiro: ${selecionado.acionado_por_nome}`)}
                </Text>
                <Text style={s.mapOverlaySub}>
                  🚗 {selecionado.motorista_nome} ({selecionado.carro_modelo || 'Veículo'} · Placa {selecionado.carro_placa || '---'}) · 🧍 {selecionado.passageiro_nome || 'Sem passageiro'}
                </Text>
              </>
            ) : (
              <Text style={s.mapOverlaySub}>
                🎓 Perímetro do Campus UNIFEB ({campus.raio}m) · Selecione um chamado à esquerda para focar no mapa
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Modal de Chat Direto Privado (Segurança <-> Solicitante do SOS) */}
      <SosChatModal
        visible={Boolean(chatSosId)}
        onClose={() => setChatSosId(null)}
        sosId={chatSosId}
        modo="AGENTE"
        chamado={chamados.find((c) => c.id === chatSosId) || selecionado}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: '#121833',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    zIndex: 10,
  },
  topbarAlerta: {
    borderBottomColor: colors.danger,
    backgroundColor: 'rgba(60, 12, 28, 0.96)',
  },
  topLeft: { flex: 1 },
  brand: { color: colors.text, fontSize: 17, fontWeight: '800' },
  agenteInfo: { color: colors.muted, fontSize: 12, marginTop: 2 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  somBtn: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  somBtnAtivo: {
    backgroundColor: 'rgba(0, 210, 211, 0.18)',
    borderColor: colors.primary2,
  },
  somBtnText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  sairBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  sairText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  bannerEmergencia: {
    backgroundColor: '#B00020',
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    zIndex: 10,
  },
  bannerEmergenciaText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  main: {
    flex: 1,
    flexDirection: 'row',
  },
  mainMobile: {
    flexDirection: 'column',
  },
  sidebar: {
    width: 440,
    backgroundColor: '#0E1428',
    borderRightWidth: 1,
    borderRightColor: colors.border,
    zIndex: 10,
  },
  sidebarMobile: {
    width: '100%',
    flex: 1.15,
    borderRightWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabsRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.card,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabBtnAtiva: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabText: { color: colors.muted, fontWeight: '700', fontSize: 13 },
  tabTextAtiva: { color: '#fff' },
  listaScroll: { flex: 1, padding: 12 },
  emptyBox: {
    margin: 20,
    padding: 24,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  emptyTitle: { color: colors.text, fontWeight: '800', fontSize: 16, marginTop: 8, textAlign: 'center' },
  emptyDesc: { color: colors.muted, fontSize: 12, marginTop: 6, textAlign: 'center', lineHeight: 18 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  cardSelecionado: {
    borderColor: colors.primary2,
    backgroundColor: 'rgba(0, 210, 211, 0.07)',
  },
  cardAlertaPiscando: {
    borderColor: colors.danger,
    backgroundColor: 'rgba(255, 59, 92, 0.14)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardId: { color: colors.text, fontWeight: '900', fontSize: 16 },
  caronaTag: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  badgeText: { fontSize: 10, fontWeight: '800' },
  tempoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tempoLabel: { color: '#FFA502', fontSize: 12, fontWeight: '800' },
  horaCriado: { color: colors.muted, fontSize: 11 },
  infoBox: {
    backgroundColor: 'rgba(11,16,32,0.65)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    gap: 3,
  },
  infoLine: { fontSize: 13 },
  infoKey: { color: colors.muted, fontWeight: '600' },
  infoVal: { color: colors.text, fontWeight: '700' },
  veiculoBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(11,16,32,0.85)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  veiculoTexto: { color: colors.text, fontSize: 12, fontWeight: '600', flex: 1, marginRight: 8 },
  placaBadge: {
    color: colors.primary2,
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  locRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  locText: { color: colors.muted, fontSize: 11 },
  locVivo: { color: colors.success, fontSize: 11, fontWeight: '700' },
  atendidoText: { color: colors.primary2, fontSize: 12, fontWeight: '700', marginTop: 4 },
  obsSalvaText: { color: colors.text, fontSize: 12, fontStyle: 'italic', marginTop: 4 },
  btnChatSos: {
    marginTop: 8,
    backgroundColor: 'rgba(0, 210, 211, 0.16)',
    borderWidth: 1,
    borderColor: colors.primary2,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnChatSosText: {
    color: colors.primary2,
    fontWeight: '800',
    fontSize: 13,
  },
  btnAssumir: {
    marginTop: 10,
    backgroundColor: colors.danger,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnAssumirText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  resolverArea: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxAtivo: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkLabel: { color: colors.text, fontSize: 12, fontWeight: '600' },
  obsInput: {
    backgroundColor: 'rgba(11,16,32,0.8)',
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    marginBottom: 8,
  },
  btnResolver: {
    backgroundColor: colors.success,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnResolverText: { color: '#0B1020', fontWeight: '900', fontSize: 14 },
  outroAgenteAviso: {
    color: '#FFA502',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  mapArea: {
    flex: 1,
    position: 'relative',
  },
  mapAreaMobile: {
    flex: 0.85,
    minHeight: 260,
  },
  mapOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    zIndex: 10,
    backgroundColor: 'rgba(11,16,32,0.9)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mapOverlayTitle: { color: colors.text, fontWeight: '800', fontSize: 14 },
  mapOverlaySub: { color: colors.muted, fontSize: 12, marginTop: 2 },
});

