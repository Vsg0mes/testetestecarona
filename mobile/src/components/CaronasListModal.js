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
          <Text style={s.title}>Buscar Carona</Text>
          <Text style={s.hint}>
            Caronas abertas na comunidade acadêmica. Visualize os dados do veículo informados pelo motorista.
          </Text>

          {carregando && <ActivityIndicator color={colors.primary2} style={{ marginTop: 16 }} />}
          {!!erro && <Text style={{ color: colors.danger, marginTop: 8 }}>{erro}</Text>}

          <FlatList
            style={{ maxHeight: 420, marginTop: 12 }}
            data={lista}
            keyExtractor={(c) => String(c.id)}
            ListEmptyComponent={!carregando && <Text style={s.hint}>Nenhuma carona aberta agora.</Text>}
            renderItem={({ item }) => {
              const sentido = sentidoDe(item, campus);
              const minha = item.motorista_id === meuId;
              const vagasTexto = item.vagas === 1 ? '1 lugar disponível' : `${item.vagas} lugares disponíveis`;

              return (
                <View style={s.card}>
                  {/* Cabeçalho do Card: Motorista e Sentido */}
                  <View style={s.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.nome}>
                        {item.motorista_nome} {minha ? ' (você)' : ''}
                      </Text>
                      <Text style={s.sentido}>
                        {sentido === 'IDA' ? '➡️ Indo p/ campus' : '⬅️ Saindo do campus'} · 🕒 Partida {hora(item.partida_em)}
                      </Text>
                    </View>
                    <View style={s.badgeSomenteLeitura}>
                      <Text style={s.badgeSomenteLeituraText}>👁️ Somente leitura</Text>
                    </View>
                  </View>

                  {/* Detalhes do Veículo (Cedidos pelo motorista - SOMENTE VISUALIZAÇÃO) */}
                  <View style={s.veiculoBox}>
                    <Text style={s.veiculoBoxTitulo}>🚗 Informações do Veículo</Text>

                    <View style={s.veiculoLinha}>
                      <Text style={s.veiculoProp}>Modelo:</Text>
                      <Text style={s.veiculoValor} numberOfLines={1}>
                        {item.carro_modelo || 'Não especificado'}
                      </Text>
                    </View>

                    <View style={s.veiculoLinha}>
                      <Text style={s.veiculoProp}>Ano:</Text>
                      <Text style={s.veiculoValor} numberOfLines={1}>
                        {item.carro_ano ? String(item.carro_ano) : 'Não informado'}
                      </Text>
                    </View>

                    <View style={s.veiculoLinha}>
                      <Text style={s.veiculoProp}>Cor:</Text>
                      <Text style={s.veiculoValor} numberOfLines={1}>
                        {item.carro_cor || 'Não informada'}
                      </Text>
                    </View>

                    <View style={s.veiculoLinha}>
                      <Text style={s.veiculoProp}>Placa:</Text>
                      <Text style={[s.veiculoValor, s.veiculoPlaca]}>
                        {item.carro_placa || 'Não informada'}
                      </Text>
                    </View>

                    <View style={s.veiculoLinha}>
                      <Text style={s.veiculoProp}>Horário de Saída:</Text>
                      <Text style={[s.veiculoValor, { color: colors.primary2 }]}>
                        🕒 {hora(item.partida_em)}
                      </Text>
                    </View>

                    <View style={s.veiculoLinha}>
                      <Text style={s.veiculoProp}>Capacidade:</Text>
                      <Text style={s.veiculoValorDestaque}>
                        💺 {vagasTexto}
                      </Text>
                    </View>
                  </View>

                  {/* Ação de Entrar */}
                  <TouchableOpacity
                    style={[s.btn, minha && { opacity: 0.35 }]}
                    disabled={minha}
                    onPress={() => onEntrar(item)}
                  >
                    <Text style={s.btnText}>{minha ? 'Sua oferta de carona' : 'Solicitar Entrada na Carona'}</Text>
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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    width: '100%', maxWidth: 480, backgroundColor: '#121833',
    borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 36,
  },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 12 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  hint: { color: colors.muted, fontSize: 13, marginTop: 4, lineHeight: 18 },
  card: {
    padding: 14, marginBottom: 12, borderRadius: 16,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  nome: { color: colors.text, fontWeight: '700', fontSize: 16 },
  sentido: { color: colors.primary2, fontSize: 12, marginTop: 2, fontWeight: '600' },
  badgeSomenteLeitura: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  badgeSomenteLeituraText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '600',
  },
  veiculoBox: {
    backgroundColor: 'rgba(11,16,32,0.65)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  veiculoBoxTitulo: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  veiculoLinha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  veiculoProp: {
    color: colors.muted,
    fontSize: 13,
  },
  veiculoValor: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  veiculoPlaca: {
    fontWeight: '700',
    color: colors.primary2,
    letterSpacing: 1,
  },
  veiculoValorDestaque: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '700',
  },
  btn: {
    backgroundColor: colors.success,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnText: { color: '#0B1020', fontWeight: '800', fontSize: 14 },
  close: { alignSelf: 'center', marginTop: 16 },
});
