import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Vibration, Platform } from 'react-native';
import * as Location from 'expo-location';
import CampusMap from '../components/CampusMap';
import { notify, confirm } from '../ui/dialogs';
import { api, errMsg } from '../api/client';
import { colors } from '../theme';
import ChatModal from '../components/ChatModal';
import CaronasListModal from '../components/CaronasListModal';
import OferecerCaronaModal from '../components/OferecerCaronaModal';

const CAMPUS_FALLBACK = { lat: -20.5747, lng: -48.5612, raio: 500 };

export default function MapScreen({ onLogout }) {
  const [campus, setCampus] = useState(CAMPUS_FALLBACK);
  const [localizacao, setLocalizacao] = useState(null); // localização REAL obtida via GPS
  const [permissaoGps, setPermissaoGps] = useState('checking'); // 'checking' | 'granted' | 'denied'
  const [buscandoGps, setBuscandoGps] = useState(false);
  const [erroGps, setErroGps] = useState('');
  const [carona, setCarona] = useState(null);
  const [meuId, setMeuId] = useState(null);
  const [chat, setChat] = useState(false);
  const [lista, setLista] = useState(false);
  const [oferecendo, setOferecendo] = useState(false);
  const [pessoas, setPessoas] = useState([]);
  const ativa = carona && ['EM_ANDAMENTO', 'EMERGENCIA'].includes(carona.status);

  // ENVIO da minha posição durante a viagem 100% via GPS automático
  //  - motorista: GPS contínuo (watchPosition), envia a cada mudança (mín. 1s entre envios)
  //  - passageiro: posição pontual a cada 5s
  const souMotorista = carona?.motorista_id === meuId;
  useEffect(() => {
    if (!ativa) { setPessoas([]); return; }
    const enviar = (pos) => api.post(`/caronas/${carona.id}/localizacao`, pos).catch(() => {});

    if (souMotorista) {
      let sub = null;
      let ultimo = 0;
      let cancelado = false;
      Location.watchPositionAsync(
        { accuracy: Platform.OS === 'web' ? Location.Accuracy.Balanced : Location.Accuracy.High, timeInterval: 1000, distanceInterval: 3 },
        (g) => {
          const agora = Date.now();
          if (agora - ultimo < 1000) return;
          ultimo = agora;
          enviar({ lat: g.coords.latitude, lng: g.coords.longitude });
        }
      ).then((s) => { if (cancelado) s.remove(); else sub = s; }).catch(() => {});
      return () => { cancelado = true; sub?.remove(); };
    }

    async function pontual() {
      try {
        const g = await Location.getCurrentPositionAsync({});
        enviar({ lat: g.coords.latitude, lng: g.coords.longitude });
      } catch {}
    }
    pontual();
    const t = setInterval(pontual, 5000);
    return () => clearInterval(t);
  }, [ativa, carona?.id, souMotorista]);

  // LEITURA das posições (a do motorista chega quase em tempo real: polling de 2s)
  useEffect(() => {
    if (!ativa) return;
    let vivo = true;
    async function ler() {
      try {
        const { data } = await api.get(`/caronas/${carona.id}/localizacoes`);
        if (vivo) setPessoas(data.map((u) => ({ ...u, eu: u.usuario_id === meuId })));
      } catch {}
    }
    ler();
    const t = setInterval(ler, 2000);
    return () => { vivo = false; clearInterval(t); };
  }, [ativa, carona?.id, meuId]);

  // Restaura carona ativa e descobre o id do usuário (vale p/ motorista e passageiro)
  const sincronizar = useCallback(async () => {
    try {
      const { data } = await api.get('/minha-carona');
      setMeuId(data.usuarioId);
      setCarona(data.carona);
    } catch {}
  }, []);

  useEffect(() => {
    sincronizar();
    const t = setInterval(sincronizar, 5000); // motorista vê quando alguém entra
    return () => clearInterval(t);
  }, [sincronizar]);

  async function entrar(c) {
    if (carona) return notify('Você já tem uma carona ativa', 'Encerre a atual antes de entrar em outra.');
    try {
      await api.post(`/caronas/${c.id}/entrar`);
      setLista(false);
      await sincronizar();
      notify('Você entrou na carona ✅', `Motorista: ${c.motorista_nome}. Use o 💬 para avisar.`);
    } catch (e) {
      notify('Não foi possível entrar', errMsg(e));
    }
  }

  function encerrar() {
    confirm('Encerrar carona?', carona.status === 'ABERTA' ? 'A oferta será cancelada.' : 'A viagem será finalizada.',
      'ENCERRAR', async () => {
        try { await api.post(`/caronas/${carona.id}/finalizar`); setCarona(null); }
        catch (e) { notify('Erro', errMsg(e)); }
      });
  }

  const obterLocalizacaoGPS = useCallback(async (manual = false) => {
    setBuscandoGps(true);
    setErroGps('');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermissaoGps('denied');
        setErroGps('Permissão de GPS negada.');
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
      setErroGps('Não foi possível obter sua localização atual via GPS.');
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
        'Não foi possível obter sua localização exata. Permita o acesso ao GPS do seu dispositivo para continuar.'
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
        carroModelo: modelo,
        carroAno: ano,
        carroCor: cor,
        carroPlaca: placa,
      });
      setCarona(data);
      setMeuId(data.motorista_id);
      const horaTexto = new Date(data.partida_em).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      notify('Carona criada ✅', `#${data.id} (${modelo}${ano ? ` ${ano}` : ''}, ${vagas} ${vagas === 1 ? 'vaga' : 'vagas'}, saída às ${horaTexto}) publicada.`);
    } catch (e) {
      notify('🚫 Bloqueado', errMsg(e));
      throw e;
    }
  }

  function confirmarSOS() {
    if (!carona) return notify('SOS', 'Sem carona ativa. Em perigo, ligue 190.');
    confirm('Acionar SOS?', 'A segurança do campus será notificada imediatamente.', 'ACIONAR', dispararSOS);
  }

  async function dispararSOS() {
    if (Platform.OS !== 'web') Vibration.vibrate([0, 300, 150, 300]);
    let coords = {};
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {}
    try {
      const { data } = await api.post(`/caronas/${carona.id}/sos`, coords);
      setCarona(data);
      notify('🚨 EMERGÊNCIA registrada', 'Mantenha a calma. Ajuda a caminho.');
    } catch (e) {
      notify('Falha no SOS', `${errMsg(e)}\nLigue 190.`);
    }
  }

  const emergencia = carona?.status === 'EMERGENCIA';

  return (
    <View style={s.root}>
      <CampusMap
        campus={campus}
        ponto={carona ? null : localizacao}
        sentido="IDA"
        onPick={null}
        rota={carona && {
          origem: { lat: carona.origem_lat, lng: carona.origem_lng },
          destino: { lat: carona.destino_lat, lng: carona.destino_lng },
        }}
        pessoas={pessoas}
      />

      {/* Header */}
      <View style={s.header}>
        <Text style={s.brand}>Carona Universitária</Text>
        <TouchableOpacity onPress={onLogout}><Text style={{ color: colors.muted }}>Sair</Text></TouchableOpacity>
      </View>

      {/* SOS em destaque */}
      <TouchableOpacity
        style={[s.sos, emergencia && { backgroundColor: '#8B0000' }]}
        onLongPress={dispararSOS}
        onPress={confirmarSOS}
        delayLongPress={800}
      >
        <Text style={s.sosText}>SOS</Text>
      </TouchableOpacity>

      {/* Painel: carona ativa OU formulário travado */}
      <View style={s.panel}>
        {emergencia && <Text style={s.alerta}>🚨 Carona em EMERGÊNCIA</Text>}

        {carona ? (
          <View>
            <View style={s.campo}>
              <Text style={s.campoLabel}>
                {carona.motorista_id === meuId ? 'Você é o motorista' : 'Você é o passageiro'} · #{carona.id}
              </Text>
              <Text style={s.campoValor}>
                {carona.status === 'ABERTA' ? '⏳ Aguardando passageiro'
                  : carona.status === 'EM_ANDAMENTO'
                    ? `🚗 Em andamento · ${carona.motorista_id === meuId ? `Passageiro: ${carona.passageiro_nome}` : `Motorista: ${carona.motorista_nome}`}`
                    : '🚨 Emergência acionada'}
              </Text>
            </View>
            {(carona.carro_modelo || carona.carro_placa) && (
              <View style={[s.campo, { backgroundColor: 'rgba(11,16,32,0.8)' }]}>
                <Text style={s.campoLabel}>
                  {carona.motorista_id === meuId ? 'Seu Veículo Cadastrado' : 'Veículo do Motorista'}
                </Text>
                <Text style={s.campoValor}>
                  🚗 {carona.carro_modelo || 'Veículo'} {carona.carro_ano ? `(${carona.carro_ano})` : ''} {carona.carro_cor ? `· ${carona.carro_cor}` : ''}
                </Text>
                <Text style={[s.dica, { color: colors.primary2, marginTop: 4, fontWeight: '700' }]}>
                  Placa: {carona.carro_placa || '---'} · 💺 {carona.vagas} {carona.vagas === 1 ? 'lugar' : 'lugares'} · 🕒 Saída: {new Date(carona.partida_em).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            )}
            {ativa && (
              <Text style={s.dica}>
                {(() => {
                  const m = pessoas.find((u) => u.papel === 'MOTORISTA');
                  if (!m) return '⚪ Aguardando sinal do motorista…';
                  const seg = Math.max(0, Math.round((Date.now() - new Date(m.atualizado_em)) / 1000));
                  return seg <= 10 ? `🟢 Motorista ao vivo (há ${seg}s)` : `🟠 Último sinal do motorista há ${seg}s`;
                })()}
                {'  ·  localização automática via GPS'}
              </Text>
            )}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <TouchableOpacity style={[s.btn, { flex: 1 }, carona.status === 'ABERTA' && { opacity: 0.4 }]}
                disabled={carona.status === 'ABERTA'} onPress={() => setChat(true)}>
                <Text style={s.btnText}>💬 Mensagens</Text>
              </TouchableOpacity>
              {!emergencia && (
                <TouchableOpacity style={[s.btn, s.btnGhost]} onPress={encerrar}>
                  <Text style={s.btnText}>Encerrar</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : (
          <View>
            {permissaoGps === 'denied' && (
              <TouchableOpacity style={s.alertaGps} onPress={() => obterLocalizacaoGPS(true)}>
                <Text style={s.alertaGpsText}>
                  ⚠️ Localização bloqueada. Toque aqui para permitir o GPS.
                </Text>
              </TouchableOpacity>
            )}

            {/* Origem: travada na localização real do usuário via GPS */}
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
                    : '⚠️ Toque em "Atualizar GPS" para localizar'}
              </Text>
            </View>

            {/* Destino: travado no campus */}
            <View style={s.campo}>
              <Text style={s.campoLabel}>Destino (Fixo)</Text>
              <Text style={s.campoValor}>
                🔒 Campus UNIFEB (Travado)
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <TouchableOpacity
                style={[s.btn, { flex: 1 }, !localizacao && { opacity: 0.6 }]}
                onPress={iniciarOferecerCarona}
              >
                <Text style={s.btnText}>Oferecer carona</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btn, s.btnGhost, { flex: 1 }]} onPress={() => setLista(true)}>
                <Text style={s.btnText}>🔎 Buscar carona</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <ChatModal visible={chat} onClose={() => setChat(false)} caronaId={carona?.id} meuId={meuId} />
      <CaronasListModal visible={lista} onClose={() => setLista(false)} campus={campus} meuId={meuId} onEntrar={entrar} />
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
    position: 'absolute', top: 50, left: 16, right: 16, zIndex: 10, flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', backgroundColor: 'rgba(11,16,32,0.85)', padding: 14, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  brand: { color: colors.text, fontWeight: '800', fontSize: 16 },
  sos: {
    position: 'absolute', right: 20, top: 120, zIndex: 11, width: 84, height: 84, borderRadius: 42,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.35)',
    shadowColor: colors.danger, shadowOpacity: 0.8, shadowRadius: 16, elevation: 12,
  },
  sosText: { color: '#fff', fontWeight: '900', fontSize: 24, letterSpacing: 2 },
  panel: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10, padding: 20, paddingBottom: 36,
    width: '100%', maxWidth: 480, marginHorizontal: 'auto',
    backgroundColor: 'rgba(18,24,51,0.96)', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    borderWidth: 1, borderColor: colors.border,
  },
  alerta: { color: colors.danger, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
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
  dica: { color: colors.muted, fontSize: 11, marginTop: 2 },
  campo: {
    backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  campoLabel: { color: colors.muted, fontSize: 11, textTransform: 'uppercase' },
  campoValor: { color: colors.text, fontSize: 15, marginTop: 2 },
  btn: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 18, alignItems: 'center' },
  btnGhost: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
