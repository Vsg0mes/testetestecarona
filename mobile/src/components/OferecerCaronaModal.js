import { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors } from '../theme';

const VAGAS_OPCOES = [1, 2, 3, 4, 5, 6];

// Padrão tradicional: 3 letras + 4 números (ex: PHL4506)
// Padrão Mercosul:    3 letras + 1 número + 1 letra + 2 números (ex: PHL4F06)
const REGEX_PLACA = /^[A-Z]{3}[0-9]{1}[A-Z0-9]{1}[0-9]{2}$/;

function formatarHoraMinuto(d) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** Capitaliza a primeira letra de cada palavra */
function formatCapitalize(text) {
  return text
    .split(' ')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Formata a placa: somente alfanuméricos, maiúsculas, máx 7 caracteres */
function formatPlate(text) {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 7);
}

/**
 * Máscara automática HH:mm
 * - Permite apenas dígitos; insere ':' automaticamente após os 2 primeiros
 * - Limita a 5 caracteres
 */
function formatTimeMask(raw, prev) {
  // Remove tudo que não for dígito
  const digitos = raw.replace(/\D/g, '');

  // Se o usuário apagou o ':', permite remoção dos dígitos normalmente
  if (raw.length < prev.length) {
    // Ao apagar, retiramos o ':' se ficou sobrando no final
    const semDoisPontos = raw.replace(':', '');
    const d = semDoisPontos.replace(/\D/g, '').slice(0, 4);
    if (d.length <= 2) return d;
    return d.slice(0, 2) + ':' + d.slice(2);
  }

  if (digitos.length <= 2) return digitos;
  return digitos.slice(0, 2) + ':' + digitos.slice(2, 4);
}

export default function OferecerCaronaModal({
  visible,
  onClose,
  onConfirmar,
  sentido,
  ponto,
}) {
  const [modelo, setModelo] = useState('');
  const [ano, setAno] = useState('');
  const [cor, setCor] = useState('');
  const [placa, setPlaca] = useState('');
  const [horario, setHorario] = useState('');
  const [vagas, setVagas] = useState(3);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  // Ao abrir, inicializa o horário com o horário atual + 15 minutos se estiver vazio
  useEffect(() => {
    if (visible) {
      setErro('');
      if (!horario) {
        const d = new Date(Date.now() + 15 * 60 * 1000);
        setHorario(formatarHoraMinuto(d));
      }
    }
  }, [visible]);

  function ajustarHorario(minutosAdicionais) {
    const d = new Date(Date.now() + minutosAdicionais * 60 * 1000);
    setHorario(formatarHoraMinuto(d));
    setErro('');
  }

  // Handler de horário com máscara HH:mm
  function handleHorarioChange(text) {
    const mascara = formatTimeMask(text, horario);
    setHorario(mascara);
    setErro('');
  }

  async function handleConfirmar() {
    const mod = modelo.trim();
    const c = cor.trim();
    const plc = placa.trim().toUpperCase();
    const a = ano.trim();
    const horaStr = horario.trim();

    if (!mod) {
      setErro('Informe o modelo do veículo (ex: Onix, Gol, HB20)');
      return;
    }
    if (!c) {
      setErro('Informe a cor do veículo');
      return;
    }
    if (!plc) {
      setErro('Informe a placa do veículo');
      return;
    }

    // Validação de padrão de placa (Tradicional ou Mercosul)
    if (!REGEX_PLACA.test(plc)) {
      setErro(
        'Placa inválida. Use o padrão antigo (ex: PHL4506) ou Mercosul (ex: PHL4F06).'
      );
      return;
    }

    let anoNum = null;
    if (a) {
      anoNum = parseInt(a, 10);
      if (isNaN(anoNum) || anoNum < 1970 || anoNum > 2035) {
        setErro('Informe um ano válido para o veículo (ex: 2021)');
        return;
      }
    }

    const matchHora = horaStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!matchHora) {
      setErro('Informe um horário de partida válido no formato HH:mm (ex: 19:30)');
      return;
    }
    const h = parseInt(matchHora[1], 10);
    const m = parseInt(matchHora[2], 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) {
      setErro('Horário inválido. Horas entre 00 e 23 e minutos entre 00 e 59.');
      return;
    }

    const dataPartida = new Date();
    dataPartida.setHours(h, m, 0, 0);
    // Se o horário for anterior ao atual por mais de 30 minutos, agenda para amanhã
    if (dataPartida.getTime() < Date.now() - 30 * 60 * 1000) {
      dataPartida.setDate(dataPartida.getDate() + 1);
    }

    setErro('');
    setSalvando(true);
    try {
      await onConfirmar({
        modelo: mod,
        ano: anoNum,
        cor: c,
        placa: plc,
        vagas,
        partidaEm: dataPartida.toISOString(),
        horarioPartida: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      });
      // Limpa os campos após sucesso
      setModelo('');
      setAno('');
      setCor('');
      setPlaca('');
      setHorario('');
      setVagas(3);
      onClose();
    } catch (e) {
      setErro(e?.message || 'Erro ao publicar carona');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.sheet}>
          <View style={s.handle} />

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={s.title}>Oferecer Carona</Text>
            <Text style={s.hint}>
              Cadastre o veículo, o horário previsto de saída e a quantidade de lugares para sua comunidade acadêmica.
            </Text>

            {/* Rota resumida */}
            <View style={s.rotaBox}>
              <Text style={s.rotaTag}>
                ➡️ Destino: Campus UNIFEB (Travado)
              </Text>
              {ponto ? (
                <Text style={s.rotaCoord}>
                  📍 Origem real (GPS): {ponto.lat.toFixed(4)}, {ponto.lng.toFixed(4)}
                </Text>
              ) : (
                <Text style={[s.rotaCoord, { color: colors.danger }]}>
                  ⚠️ Localização GPS não identificada
                </Text>
              )}
            </View>

            {/* Horário de Partida */}
            <Text style={s.secaoTitle}>🕒 Horário Previsto de Saída</Text>
            <Text style={s.hintHora}>Defina quando você pretende sair:</Text>

            <View style={s.horaWrapper}>
              <TextInput
                style={[s.input, s.inputHora]}
                placeholder="19:30"
                placeholderTextColor={colors.muted}
                value={horario}
                onChangeText={handleHorarioChange}
                keyboardType="number-pad"
                maxLength={5}
              />
              <View style={s.chipsHora}>
                <TouchableOpacity style={s.chipBtn} onPress={() => ajustarHorario(0)}>
                  <Text style={s.chipText}>Agora</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.chipBtn} onPress={() => ajustarHorario(15)}>
                  <Text style={s.chipText}>+15 min</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.chipBtn} onPress={() => ajustarHorario(30)}>
                  <Text style={s.chipText}>+30 min</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.chipBtn} onPress={() => ajustarHorario(60)}>
                  <Text style={s.chipText}>+1h</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Informações do Carro */}
            <Text style={[s.secaoTitle, { marginTop: 14 }]}>🚗 Dados do Veículo</Text>

            <View style={s.row}>
              <View style={{ flex: 2 }}>
                <Text style={s.label}>Modelo *</Text>
                <TextInput
                  style={s.input}
                  placeholder="Ex: Onix, Gol, HB20"
                  placeholderTextColor={colors.muted}
                  value={modelo}
                  onChangeText={(t) => { setModelo(formatCapitalize(t)); setErro(''); }}
                  autoCapitalize="words"
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={s.label}>Ano</Text>
                <TextInput
                  style={s.input}
                  placeholder="Ex: 2022"
                  placeholderTextColor={colors.muted}
                  value={ano}
                  onChangeText={(t) => { setAno(t); setErro(''); }}
                  keyboardType="numeric"
                  maxLength={4}
                />
              </View>
            </View>

            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Cor *</Text>
                <TextInput
                  style={s.input}
                  placeholder="Ex: Prata, Branco"
                  placeholderTextColor={colors.muted}
                  value={cor}
                  onChangeText={(t) => { setCor(formatCapitalize(t)); setErro(''); }}
                  autoCapitalize="words"
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={s.label}>Placa *</Text>
                <TextInput
                  style={[s.input, s.inputPlaca]}
                  placeholder="Ex: BRA2E19"
                  placeholderTextColor={colors.muted}
                  value={placa}
                  onChangeText={(t) => { setPlaca(formatPlate(t)); setErro(''); }}
                  autoCapitalize="characters"
                  maxLength={7}
                />
              </View>
            </View>

            {/* Quantidade de Lugares Disponíveis */}
            <Text style={s.label}>Lugares disponíveis no carro</Text>
            <View style={s.vagasContainer}>
              {VAGAS_OPCOES.map((num) => {
                const selecionado = vagas === num;
                return (
                  <TouchableOpacity
                    key={num}
                    style={[s.vagaBtn, selecionado && s.vagaBtnAtivo]}
                    onPress={() => setVagas(num)}
                  >
                    <Text style={[s.vagaText, selecionado && s.vagaTextAtivo]}>
                      💺 {num} {num === 1 ? 'vaga' : 'vagas'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {!!erro && <Text style={s.erroText}>⚠️ {erro}</Text>}

            {/* Botões de Ação */}
            <TouchableOpacity
              style={[s.btnConfirmar, salvando && { opacity: 0.6 }]}
              disabled={salvando}
              onPress={handleConfirmar}
            >
              {salvando ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.btnConfirmarText}>Confirmar e Publicar Carona</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={onClose} style={s.btnCancelar} disabled={salvando}>
              <Text style={s.btnCancelarText}>Cancelar</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '92%',
    backgroundColor: '#121833',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
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
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  hint: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  rotaBox: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 12,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rotaTag: {
    color: colors.primary2,
    fontWeight: '700',
    fontSize: 14,
  },
  rotaCoord: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
  },
  secaoTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
    marginTop: 6,
  },
  hintHora: {
    color: colors.muted,
    fontSize: 12,
    marginBottom: 8,
  },
  horaWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  inputHora: {
    width: 90,
    marginBottom: 0,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    color: colors.primary2,
  },
  chipsHora: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chipBtn: {
    backgroundColor: colors.card,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: colors.card,
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 12,
  },
  inputPlaca: {
    fontWeight: '700',
    letterSpacing: 1,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  vagasContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  vagaBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  vagaBtnAtivo: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  vagaText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  vagaTextAtivo: {
    color: '#fff',
    fontWeight: '700',
  },
  erroText: {
    color: colors.danger,
    fontSize: 13,
    marginBottom: 12,
    fontWeight: '600',
  },
  btnConfirmar: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  btnConfirmarText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  btnCancelar: {
    alignSelf: 'center',
    paddingVertical: 12,
    marginTop: 6,
  },
  btnCancelarText: {
    color: colors.muted,
    fontSize: 14,
  },
});
