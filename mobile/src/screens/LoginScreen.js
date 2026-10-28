import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { auth, errMsg } from '../api/client';
import { colors } from '../theme';

const DOMAIN = '@unifeb.edu.br';

export default function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const valido = email.trim().toLowerCase().endsWith(DOMAIN);

  async function entrar() {
    setErro('');
    setLoading(true);
    try {
      await auth.login(email.trim().toLowerCase());
      onLogin();
    } catch (e) {
      setErro(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.glow} />
      <Text style={s.logo}>🎓🚗</Text>
      <Text style={s.title}>Carona Universitária</Text>
      <Text style={s.subtitle}>Validada pela sua instituição. Só a comunidade acadêmica entra.</Text>

      <View style={s.card}>
        <TextInput
          style={s.input}
          placeholder={`seu.nome${DOMAIN}`}
          placeholderTextColor={colors.muted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={email}
          onChangeText={setEmail}
        />
        {!!erro && <Text style={s.erro}>{erro}</Text>}
        <TouchableOpacity
          style={[s.btn, !valido && { opacity: 0.4 }]}
          disabled={!valido || loading}
          onPress={entrar}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Login com E-mail Institucional</Text>}
        </TouchableOpacity>
      </View>

      <Text style={s.footer}>🔒 SSO institucional • Sessão protegida no dispositivo</Text>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24 },
  glow: {
    position: 'absolute', top: -120, right: -100, width: 320, height: 320, borderRadius: 160,
    backgroundColor: colors.primary, opacity: 0.25,
  },
  logo: { fontSize: 48, textAlign: 'center' },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  subtitle: { color: colors.muted, textAlign: 'center', marginTop: 8, marginBottom: 32 },
  card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 20, padding: 20 },
  input: {
    color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginBottom: 12,
  },
  erro: { color: colors.danger, marginBottom: 10 },
  btn: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  footer: { color: colors.muted, textAlign: 'center', marginTop: 24, fontSize: 12 },
});
