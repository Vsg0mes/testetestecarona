import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { segurancaAuth, segErrMsg } from '../api/segurancaClient';
import { colors } from '../theme';

export default function SegurancaLoginScreen({ onLogin, onVoltarUsuario }) {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const podeEntrar = login.trim().length > 0 && senha.length > 0;

  async function entrar() {
    if (!podeEntrar) return;
    setErro('');
    setLoading(true);
    try {
      const agente = await segurancaAuth.login(login.trim(), senha);
      onLogin(agente);
    } catch (e) {
      setErro(segErrMsg(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.glow} />
      <View style={s.container}>
        <Text style={s.logo}>🛡️🚨</Text>
        <Text style={s.title}>Segurança do Campus</Text>
        <Text style={s.subtitle}>
          Central de monitoramento e resposta a emergências (SOS) — UNIFEB
        </Text>

        <View style={s.card}>
          <Text style={s.label}>Login do Agente</Text>
          <TextInput
            style={s.input}
            placeholder="Ex: seguranca1"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            value={login}
            onChangeText={(v) => { setLogin(v); setErro(''); }}
          />

          <Text style={s.label}>Senha</Text>
          <TextInput
            style={s.input}
            placeholder="••••••••"
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={senha}
            onChangeText={(v) => { setSenha(v); setErro(''); }}
            onSubmitEditing={entrar}
          />

          {!!erro && <Text style={s.erro}>⚠️ {erro}</Text>}

          <TouchableOpacity
            style={[s.btn, (!podeEntrar || loading) && { opacity: 0.45 }]}
            disabled={!podeEntrar || loading}
            onPress={entrar}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.btnText}>Acessar Central de Emergências</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={s.footer}>
          🔒 Acesso restrito a agentes credenciados • Sessão isolada (JWT 8h)
        </Text>

        {typeof onVoltarUsuario === 'function' && (
          <TouchableOpacity style={s.backBtn} onPress={onVoltarUsuario}>
            <Text style={s.backText}>← Voltar ao login de alunos e servidores</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  container: {
    width: '100%',
    maxWidth: 440,
  },
  glow: {
    position: 'absolute',
    top: -120,
    left: -100,
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: colors.danger,
    opacity: 0.18,
  },
  logo: { fontSize: 48, textAlign: 'center' },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  subtitle: { color: colors.muted, textAlign: 'center', marginTop: 8, marginBottom: 28, fontSize: 14 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 22,
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  input: {
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 14,
    backgroundColor: 'rgba(11,16,32,0.65)',
  },
  erro: { color: colors.danger, marginBottom: 12, fontWeight: '600', fontSize: 14 },
  btn: {
    backgroundColor: colors.danger,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  footer: { color: colors.muted, textAlign: 'center', marginTop: 22, fontSize: 12 },
  backBtn: { marginTop: 18, alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  backText: { color: colors.primary2, fontSize: 13, fontWeight: '600' },
});

