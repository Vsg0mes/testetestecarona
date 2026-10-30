import { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { api, errMsg } from '../api/client';
import { segurancaApi, segErrMsg } from '../api/segurancaClient';
import { colors } from '../theme';

const CHIPS_VITIMA = [
  'Preciso de apoio discreto na chegada',
  'O veículo desviou do trajeto combinado',
  'Estou chegando na portaria do Campus',
];

const CHIPS_AGENTE = [
  '🛡️ Segurança ciente. Estamos monitorando seu GPS em tempo real.',
  '🚔 Equipe de ronda deslocada para acompanhar seu trajeto.',
  '📍 Aguardamos você no portão principal do Campus UNIFEB.',
];

export default function SosChatModal({
  visible,
  onClose,
  sosId,
  modo = 'USUARIO', // 'USUARIO' | 'AGENTE'
  chamado = null,
  sosStatus = null,
  agenteNome = null,
}) {
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const ehAgente = modo === 'AGENTE';
  const httpClient = ehAgente ? segurancaApi : api;
  const parseErro = ehAgente ? segErrMsg : errMsg;

  const carregarMensagens = useCallback(async () => {
    if (!sosId) return;
    try {
      const { data } = await httpClient.get(`/seguranca/sos/${sosId}/mensagens`);
      setMensagens(Array.isArray(data) ? data : []);
      setErro('');
    } catch (e) {
      setErro(parseErro(e));
    } finally {
      setCarregando(false);
    }
  }, [sosId, httpClient, parseErro]);

  useEffect(() => {
    if (!visible || !sosId) return;
    setCarregando(true);
    carregarMensagens();
    const t = setInterval(carregarMensagens, 2000);
    return () => clearInterval(t);
  }, [visible, sosId, carregarMensagens]);

  async function enviarMensagem(conteudo) {
    const msg = (typeof conteudo === 'string' ? conteudo : texto).trim();
    if (!msg || !sosId || enviando) return;
    setEnviando(true);
    setErro('');
    try {
      await httpClient.post(`/seguranca/sos/${sosId}/mensagens`, { texto: msg });
      if (typeof conteudo !== 'string') {
        setTexto('');
      }
      await carregarMensagens();
    } catch (e) {
      setErro(parseErro(e));
    } finally {
      setEnviando(false);
    }
  }

  const chips = ehAgente ? CHIPS_AGENTE : CHIPS_VITIMA;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.handle} />

          {/* Cabeçalho do Chat Privado de SOS */}
          <View style={s.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>
                {ehAgente
                  ? `🛡️ Chat Direto SOS #${sosId}`
                  : '🛡️ Atendimento Discreto · Segurança do Campus'}
              </Text>
              <Text style={s.subtitle}>
                {ehAgente
                  ? 'Canal privado e exclusivo com o usuário que acionou o SOS'
                  : '🔒 Canal sigiloso: nenhum outro ocupante da carona vê estas mensagens'}
              </Text>
            </View>
            <TouchableOpacity style={s.minimizarBtn} onPress={onClose}>
              <Text style={s.minimizarText}>{ehAgente ? 'Fechar' : 'Minimizar'}</Text>
            </TouchableOpacity>
          </View>

          {/* Resumo do Chamado (para o Agente ou Status do Atendimento para a Vítima) */}
          {ehAgente && chamado ? (
            <View style={s.chamadoInfoBox}>
              <Text style={s.chamadoInfoDestaque}>
                🚨{' '}
                {chamado.acionado_por_descricao ||
                  (chamado.acionado_por_papel === 'MOTORISTA'
                    ? `SOS acionado pelo Motorista: ${chamado.acionado_por_nome}`
                    : `SOS acionado por Passageiro: ${chamado.acionado_por_nome}`)}
              </Text>
              <Text style={s.chamadoInfoLinha}>
                🚘 Veículo: {chamado.carro_modelo || 'Não informado'}
                {chamado.carro_cor ? ` · ${chamado.carro_cor}` : ''} · Placa:{' '}
                <Text style={{ color: colors.primary2, fontWeight: '900' }}>
                  {chamado.carro_placa || '---'}
                </Text>
              </Text>
              <Text style={s.chamadoInfoLinha}>
                🚗 Motorista: {chamado.motorista_nome} · 🧍 Passageiro(s):{' '}
                {chamado.passageiro_nome || '---'}
              </Text>
              <Text style={s.chamadoInfoGps}>
                📍 GPS ao vivo:{' '}
                {typeof chamado.lat_ao_vivo === 'number' && typeof chamado.lng_ao_vivo === 'number'
                  ? `${chamado.lat_ao_vivo.toFixed(4)}, ${chamado.lng_ao_vivo.toFixed(4)}`
                  : typeof chamado.lat === 'number' && typeof chamado.lng === 'number'
                    ? `${chamado.lat.toFixed(4)}, ${chamado.lng.toFixed(4)}`
                    : 'Aguardando coordenada'}
              </Text>
            </View>
          ) : (
            <View style={s.statusAtendimentoBox}>
              <Text style={s.statusAtendimentoText}>
                {sosStatus === 'EM_ATENDIMENTO' && agenteNome
                  ? `🟢 Em atendimento por ${agenteNome}`
                  : '🟡 Alerta recebido pela Central · Aguardando resposta do agente de plantão...'}
              </Text>
            </View>
          )}

          {/* Lista de mensagens em tempo real */}
          {carregando && mensagens.length === 0 ? (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator color={colors.primary2} />
            </View>
          ) : (
            <FlatList
              style={s.lista}
              data={mensagens}
              keyExtractor={(m) => String(m.id)}
              ListEmptyComponent={
                <Text style={s.emptyText}>
                  {ehAgente
                    ? 'Envie uma mensagem para orientar o solicitante do SOS com segurança.'
                    : 'Envie uma mensagem silenciosa para o agente da Segurança do Campus.'}
                </Text>
              }
              renderItem={({ item }) => {
                const msgDeAgente = item.autor_tipo === 'AGENTE';
                const minha = (ehAgente && msgDeAgente) || (!ehAgente && !msgDeAgente);

                return (
                  <View style={[s.bubble, minha ? s.bubbleMinha : s.bubbleOutra]}>
                    <View style={s.bubbleHeader}>
                      <Text style={[s.autorNome, msgDeAgente ? s.autorAgente : s.autorVitima]}>
                        {msgDeAgente ? `🛡️ ${item.autor_nome}` : `👤 ${item.autor_nome}`}
                      </Text>
                      <View
                        style={[
                          s.badgePapel,
                          msgDeAgente ? s.badgeAgente : s.badgeSolicitante,
                        ]}
                      >
                        <Text style={s.badgePapelText}>
                          {msgDeAgente ? 'SEGURANÇA' : 'SOLICITANTE SOS'}
                        </Text>
                      </View>
                    </View>
                    <Text style={s.bubbleTexto}>{item.texto}</Text>
                    <Text style={s.bubbleHora}>
                      {new Date(item.enviado_em).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </Text>
                  </View>
                );
              }}
            />
          )}

          {!!erro && <Text style={s.erroText}>⚠️ {erro}</Text>}

          {/* Atalhos rápidos */}
          <View style={s.chipsContainer}>
            {chips.map((c, idx) => (
              <TouchableOpacity
                key={idx}
                style={s.chip}
                disabled={enviando}
                onPress={() => enviarMensagem(c)}
              >
                <Text style={s.chipText} numberOfLines={1}>
                  {c}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Campo de entrada em tempo real */}
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={texto}
              onChangeText={setTexto}
              placeholder={
                ehAgente
                  ? 'Digite uma orientação para o solicitante do SOS...'
                  : 'Digite uma mensagem silenciosa para a Segurança...'
              }
              placeholderTextColor={colors.muted}
              maxLength={500}
              onSubmitEditing={() => enviarMensagem()}
              returnKeyType="send"
            />
            <TouchableOpacity
              style={[s.sendBtn, (!texto.trim() || enviando) && { opacity: 0.5 }]}
              disabled={!texto.trim() || enviando}
              onPress={() => enviarMensagem()}
            >
              <Text style={s.sendBtnText}>{enviando ? '...' : 'Enviar'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#10172E',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 18,
    paddingBottom: 28,
    borderWidth: 1.5,
    borderColor: colors.primary2,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.primary2,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  minimizarBtn: {
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  minimizarText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  chamadoInfoBox: {
    backgroundColor: 'rgba(11, 16, 32, 0.85)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 92, 0.45)',
    gap: 3,
  },
  chamadoInfoDestaque: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '900',
  },
  chamadoInfoLinha: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  chamadoInfoGps: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '700',
  },
  statusAtendimentoBox: {
    backgroundColor: 'rgba(0, 210, 211, 0.1)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 210, 211, 0.35)',
  },
  statusAtendimentoText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  lista: {
    maxHeight: 240,
    marginBottom: 10,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 20,
  },
  bubble: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginVertical: 4,
    maxWidth: '84%',
  },
  bubbleMinha: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleOutra: {
    alignSelf: 'flex-start',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
    flexWrap: 'wrap',
  },
  autorNome: {
    fontSize: 11,
    fontWeight: '800',
  },
  autorAgente: {
    color: colors.primary2,
  },
  autorVitima: {
    color: '#FFD166',
  },
  badgePapel: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
    borderWidth: 1,
  },
  badgeAgente: {
    backgroundColor: 'rgba(0, 210, 211, 0.2)',
    borderColor: colors.primary2,
  },
  badgeSolicitante: {
    backgroundColor: 'rgba(255, 59, 92, 0.22)',
    borderColor: colors.danger,
  },
  badgePapelText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '900',
  },
  bubbleTexto: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  bubbleHora: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 9,
    marginTop: 3,
    textAlign: 'right',
  },
  erroText: {
    color: colors.danger,
    fontSize: 12,
    marginBottom: 6,
    fontWeight: '700',
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  chip: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: {
    color: colors.primary2,
    fontSize: 11,
    fontWeight: '700',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  sendBtn: {
    backgroundColor: colors.primary2,
    borderRadius: 12,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnText: {
    color: '#0B1020',
    fontWeight: '900',
    fontSize: 14,
  },
});

