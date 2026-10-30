import { useEffect, useState, useCallback, useRef } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { api, errMsg } from '../api/client';
import { colors } from '../theme';

// Fallback local; a fonte da verdade é GET /mensagens
const RESPOSTAS = [
  { id: 1, texto: 'Estou no portão', icone: '📍' },
  { id: 2, texto: 'Chegando', icone: '🚗' },
  { id: 3, texto: 'Tive um imprevisto', icone: '⚠️' },
];

export default function ChatModal({ visible, onClose, caronaId, meuId, motoristaId, onNovasMsg }) {
  const [historico, setHistorico] = useState([]);
  const [erro, setErro] = useState('');
  const [chatLivre, setChatLivre] = useState(false);
  const [texto, setTexto] = useState('');
  // Rastreia quantas mensagens já foram vistas para calcular não-lidas
  const ultimoTotalVistoRef = useRef(0);
  const visibleRef = useRef(visible);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    // Ao trocar de carona, reinicia contador visto
    ultimoTotalVistoRef.current = 0;
  }, [caronaId]);

  useEffect(() => {
    if (visible) {
      api
        .get('/config')
        .then(({ data }) => setChatLivre(!!data.chatLivre))
        .catch(() => {});
    }
  }, [visible]);

  const carregar = useCallback(async () => {
    if (!caronaId) return;
    try {
      const { data } = await api.get(`/caronas/${caronaId}/mensagens`);
      setHistorico(data);
      if (visibleRef.current) {
        ultimoTotalVistoRef.current = data.length;
        if (typeof onNovasMsg === 'function') onNovasMsg(0);
      } else if (typeof onNovasMsg === 'function') {
        const totalAtual = data.length;
        const naoLidas = Math.max(0, totalAtual - ultimoTotalVistoRef.current);
        onNovasMsg(naoLidas);
      }
    } catch (e) {
      setErro(errMsg(e));
    }
  }, [caronaId, onNovasMsg]);

  useEffect(() => {
    if (visible) {
      if (typeof onNovasMsg === 'function') onNovasMsg(0);
      carregar();
      const t = setInterval(carregar, 3000);
      return () => clearInterval(t);
    } else if (caronaId) {
      // Modal fechado: polling a cada 4s para detectar novas mensagens e exibir badge
      carregar();
      const t = setInterval(carregar, 4000);
      return () => clearInterval(t);
    }
  }, [visible, caronaId, carregar, onNovasMsg]);

  async function enviarTexto() {
    const t = texto.trim();
    if (!t) return;
    try {
      await api.post(`/caronas/${caronaId}/mensagens`, { texto: t });
      setTexto('');
      setErro('');
      carregar();
    } catch (e) {
      setErro(errMsg(e));
    }
  }

  async function enviar(mensagemId) {
    try {
      await api.post(`/caronas/${caronaId}/mensagens`, { mensagemId });
      setErro('');
      carregar();
    } catch (e) {
      setErro(errMsg(e));
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title}>💬 Chat da Carona</Text>
          <Text style={s.hint}>
            {chatLivre
              ? 'Comunicação entre motorista e passageiros da viagem.'
              : 'Por segurança, o chat utiliza mensagens rápidas pré-definidas.'}
          </Text>

          <FlatList
            style={{ maxHeight: 280, marginVertical: 12 }}
            data={historico}
            keyExtractor={(m) => String(m.id)}
            ListEmptyComponent={<Text style={s.hint}>Nenhuma mensagem ainda.</Text>}
            renderItem={({ item }) => {
              const remetenteId = item.usuario_id ?? item.autor_id;
              const meu = Number(remetenteId) === Number(meuId);
              const ehMotorista = Boolean(
                item.is_motorista ||
                  item.papel === 'MOTORISTA' ||
                  (motoristaId && Number(remetenteId) === Number(motoristaId)) ||
                  (item.motorista_id && Number(remetenteId) === Number(item.motorista_id))
              );
              const nomeRemetente =
                item.nome || item.autor_nome || (meu ? 'Você' : `Usuário #${remetenteId}`);

              return (
                <View style={[s.bubble, meu ? s.mine : s.theirs]}>
                  <View style={s.autorRow}>
                    <Text style={[s.autorNome, meu && s.autorNomeMeu]}>
                      {nomeRemetente}
                      {ehMotorista ? ' 🚗 (Motorista)' : ''}
                      {meu ? ' · você' : ''}
                    </Text>
                    {ehMotorista && (
                      <View style={[s.badgeMotorista, meu && s.badgeMotoristaMeu]}>
                        <Text style={s.badgeMotoristaText}>[MOTORISTA]</Text>
                      </View>
                    )}
                  </View>

                  <Text style={s.bubbleText}>{item.texto}</Text>
                  <Text style={s.time}>
                    {new Date(item.enviado_em).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
              );
            }}
          />

          {!!erro && <Text style={{ color: colors.danger, marginBottom: 6 }}>{erro}</Text>}

          <View style={s.quickRow}>
            {RESPOSTAS.map((r) => (
              <TouchableOpacity key={r.id} style={s.quick} onPress={() => enviar(r.id)}>
                <Text style={{ fontSize: 20 }}>{r.icone}</Text>
                <Text style={s.quickText}>{r.texto}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {chatLivre && (
            <View style={s.inputRow}>
              <TextInput
                style={s.input}
                value={texto}
                onChangeText={setTexto}
                placeholder="Digite uma mensagem para a carona..."
                placeholderTextColor={colors.muted}
                maxLength={300}
                onSubmitEditing={enviarTexto}
                returnKeyType="send"
              />
              <TouchableOpacity style={s.send} onPress={enviarTexto}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>Enviar</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity onPress={onClose} style={s.close}>
            <Text style={{ color: colors.muted }}>Fechar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#121833',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: 36,
    borderWidth: 1,
    borderColor: colors.border,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginBottom: 12,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  hint: { color: colors.muted, fontSize: 12, marginTop: 4 },
  bubble: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginVertical: 4,
    maxWidth: '82%',
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  autorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  autorNome: {
    color: colors.primary2,
    fontSize: 11,
    fontWeight: '800',
  },
  autorNomeMeu: {
    color: '#E8E6FF',
  },
  badgeMotorista: {
    backgroundColor: 'rgba(255, 165, 2, 0.22)',
    borderColor: '#FFA502',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  badgeMotoristaMeu: {
    backgroundColor: 'rgba(11, 16, 32, 0.45)',
    borderColor: '#FFD166',
  },
  badgeMotoristaText: {
    color: '#FFD166',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  bubbleText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  time: { color: 'rgba(255,255,255,0.65)', fontSize: 10, marginTop: 3, textAlign: 'right' },
  quickRow: { flexDirection: 'row', gap: 10 },
  quick: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickText: { color: colors.text, fontSize: 11, marginTop: 4, textAlign: 'center' },
  close: { alignSelf: 'center', marginTop: 16 },
  inputRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  input: {
    flex: 1,
    color: colors.text,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  send: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
});
