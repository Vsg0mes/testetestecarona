import { useEffect, useState, useCallback } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { api, errMsg } from '../api/client';
import { colors } from '../theme';

// Fallback local; a fonte da verdade é GET /mensagens
const RESPOSTAS = [
  { id: 1, texto: 'Estou no portão', icone: '📍' },
  { id: 2, texto: 'Chegando', icone: '🚗' },
  { id: 3, texto: 'Tive um imprevisto', icone: '⚠️' },
];

export default function ChatModal({ visible, onClose, caronaId, meuId }) {
  const [historico, setHistorico] = useState([]);
  const [erro, setErro] = useState('');
  const [chatLivre, setChatLivre] = useState(false);
  const [texto, setTexto] = useState('');

  useEffect(() => {
    if (visible) api.get('/config').then(({ data }) => setChatLivre(!!data.chatLivre)).catch(() => {});
  }, [visible]);

  async function enviarTexto() {
    const t = texto.trim();
    if (!t) return;
    try {
      await api.post(`/caronas/${caronaId}/mensagens`, { texto: t });
      setTexto('');
      setErro('');
      carregar();
    } catch (e) { setErro(errMsg(e)); }
  }

  const carregar = useCallback(async () => {
    if (!caronaId) return;
    try {
      const { data } = await api.get(`/caronas/${caronaId}/mensagens`);
      setHistorico(data);
    } catch (e) { setErro(errMsg(e)); }
  }, [caronaId]);

  useEffect(() => {
    if (!visible) return;
    carregar();
    const t = setInterval(carregar, 4000); // polling simples p/ MVP
    return () => clearInterval(t);
  }, [visible, carregar]);

  async function enviar(mensagemId) {
    try {
      await api.post(`/caronas/${caronaId}/mensagens`, { mensagemId });
      carregar();
    } catch (e) { setErro(errMsg(e)); }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title}>Mensagens rápidas</Text>
          <Text style={s.hint}>Por segurança, o chat não aceita texto livre.</Text>

          <FlatList
            style={{ maxHeight: 260, marginVertical: 12 }}
            data={historico}
            keyExtractor={(m) => String(m.id)}
            ListEmptyComponent={<Text style={s.hint}>Nenhuma mensagem ainda.</Text>}
            renderItem={({ item }) => {
              const meu = item.autor_id === meuId;
              return (
                <View style={[s.bubble, meu ? s.mine : s.theirs]}>
                  <Text style={s.bubbleText}>{item.texto}</Text>
                  <Text style={s.time}>{new Date(item.enviado_em).toLocaleTimeString().slice(0, 5)}</Text>
                </View>
              );
            }}
          />

          {!!erro && <Text style={{ color: colors.danger }}>{erro}</Text>}

          <View style={s.quickRow}>
            {RESPOSTAS.map((r) => (
              <TouchableOpacity key={r.id} style={s.quick} onPress={() => enviar(r.id)}>
                <Text style={{ fontSize: 22 }}>{r.icone}</Text>
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
                placeholder="Digite uma mensagem..."
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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#121833', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 36 },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 12 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  hint: { color: colors.muted, fontSize: 12, marginTop: 4 },
  bubble: { padding: 10, borderRadius: 14, marginVertical: 4, maxWidth: '75%' },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.card },
  bubbleText: { color: '#fff', fontWeight: '600' },
  time: { color: 'rgba(255,255,255,0.6)', fontSize: 10, marginTop: 2, textAlign: 'right' },
  quickRow: { flexDirection: 'row', gap: 10 },
  quick: {
    flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 16,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  quickText: { color: colors.text, fontSize: 12, marginTop: 6, textAlign: 'center' },
  close: { alignSelf: 'center', marginTop: 16 },
  inputRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  input: {
    flex: 1, color: colors.text, backgroundColor: colors.card, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10,
  },
  send: { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' },
});
