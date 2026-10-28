import { useCallback, useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { api, errMsg } from '../api/client';
import { colors } from '../theme';

// Campus fixo vindo da tela; usamos só para dizer se é IDA ou VOLTA
function sentidoDe(c, campus) {
  const d = Math.hypot(c.origem_lat - campus.lat, c.origem_lng - campus.lng);
  return d < 0.005 ? 'VOLTA' : 'IDA';
}

const hora = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function CaronasListModal({ visible, onClose, campus, meuId, onEntrar }) {
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    try {
      const { data } = await api.get('/caronas');
      setLista(data);
      setErro('');
    } catch (e) { setErro(errMsg(e)); }
    finally { setCarregando(false); }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setCarregando(true);
    carregar();
    const t = setInterval(carregar, 5000);
    return () => clearInterval(t);
  }, [visible, carregar]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title}>Caronas disponíveis</Text>
          <Text style={s.hint}>Todas começam ou terminam no campus UNIFEB.</Text>

          {carregando && <ActivityIndicator color={colors.primary2} style={{ marginTop: 16 }} />}
          {!!erro && <Text style={{ color: colors.danger, marginTop: 8 }}>{erro}</Text>}

          <FlatList
            style={{ maxHeight: 380, marginTop: 12 }}
            data={lista}
            keyExtractor={(c) => String(c.id)}
            ListEmptyComponent={!carregando && <Text style={s.hint}>Nenhuma carona aberta agora.</Text>}
            renderItem={({ item }) => {
              const sentido = sentidoDe(item, campus);
              const minha = item.motorista_id === meuId;
              return (
                <View style={s.card}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.nome}>{item.motorista_nome}{minha ? ' (você)' : ''}</Text>
                    <Text style={s.info}>
                      {sentido === 'IDA' ? '➡️ Indo p/ campus' : '⬅️ Saindo do campus'} · 🕒 {hora(item.partida_em)} · 💺 {item.vagas}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[s.btn, minha && { opacity: 0.35 }]}
                    disabled={minha}
                    onPress={() => onEntrar(item)}
                  >
                    <Text style={s.btnText}>Entrar</Text>
                  </TouchableOpacity>
                </View>
              );
            }}
          />

          <TouchableOpacity onPress={onClose} style={s.close}>
            <Text style={{ color: colors.muted }}>Fechar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    width: '100%', maxWidth: 480, backgroundColor: '#121833',
    borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 36,
  },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 12 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  hint: { color: colors.muted, fontSize: 12, marginTop: 4 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, marginBottom: 8, borderRadius: 14,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  nome: { color: colors.text, fontWeight: '700', fontSize: 15 },
  info: { color: colors.muted, fontSize: 12, marginTop: 4 },
  btn: { backgroundColor: colors.success, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16 },
  btnText: { color: '#0B1020', fontWeight: '800' },
  close: { alignSelf: 'center', marginTop: 16 },
});

