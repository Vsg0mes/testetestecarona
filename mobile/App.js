import { useEffect, useState } from 'react';
import { View, ActivityIndicator, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { auth, setUnauthorizedHandler } from './src/api/client';
import { segurancaAuth, setAgenteUnauthorizedHandler } from './src/api/segurancaClient';
import LoginScreen from './src/screens/LoginScreen';
import MapScreen from './src/screens/MapScreen';
import SegurancaLoginScreen from './src/screens/SegurancaLoginScreen';
import SegurancaPainelScreen from './src/screens/SegurancaPainelScreen';
import { colors } from './src/theme';

function detectarModoInicial() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const path = window.location.pathname || '';
    const hash = window.location.hash || '';
    if (path.startsWith('/seguranca') || hash === '#seguranca') {
      return 'seguranca';
    }
  }
  return 'usuario';
}

export default function App() {
  const [modo, setModo] = useState(detectarModoInicial);
  const [logged, setLogged] = useState(null);
  const [agenteLogged, setAgenteLogged] = useState(null);
  const [agente, setAgente] = useState(null);

  useEffect(() => {
    setUnauthorizedHandler(() => setLogged(false));
    setAgenteUnauthorizedHandler(() => {
      setAgenteLogged(false);
      setAgente(null);
    });

    auth.hasToken().then(setLogged);
    Promise.all([segurancaAuth.hasToken(), segurancaAuth.getAgente()]).then(([temToken, ag]) => {
      setAgenteLogged(temToken);
      setAgente(ag);
    });

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const onPopState = () => setModo(detectarModoInicial());
      window.addEventListener('popstate', onPopState);
      return () => window.removeEventListener('popstate', onPopState);
    }
  }, []);

  function irParaSeguranca() {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.history.pushState({}, '', '/seguranca');
    }
    setModo('seguranca');
  }

  function irParaUsuario() {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.history.pushState({}, '', '/');
    }
    setModo('usuario');
  }

  if (logged === null || agenteLogged === null) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary2} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      {modo === 'seguranca' ? (
        agenteLogged ? (
          <SegurancaPainelScreen
            agenteInicial={agente}
            onLogout={async () => {
              await segurancaAuth.logout();
              setAgente(null);
              setAgenteLogged(false);
            }}
          />
        ) : (
          <SegurancaLoginScreen
            onLogin={(ag) => {
              setAgente(ag);
              setAgenteLogged(true);
            }}
            onVoltarUsuario={irParaUsuario}
          />
        )
      ) : logged ? (
        <MapScreen
          onLogout={async () => {
            await auth.logout();
            setLogged(false);
          }}
        />
      ) : (
        <LoginScreen
          onLogin={() => setLogged(true)}
          onIrSeguranca={irParaSeguranca}
        />
      )}
    </>
  );
}
