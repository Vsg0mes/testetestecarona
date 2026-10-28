import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { auth, setUnauthorizedHandler } from './src/api/client';
import LoginScreen from './src/screens/LoginScreen';
import MapScreen from './src/screens/MapScreen';
import { colors } from './src/theme';

export default function App() {
  const [logged, setLogged] = useState(null);

  useEffect(() => {
    setUnauthorizedHandler(() => setLogged(false));
    auth.hasToken().then(setLogged);
  }, []);

  if (logged === null) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary2} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      {logged ? (
        <MapScreen onLogout={async () => { await auth.logout(); setLogged(false); }} />
      ) : (
        <LoginScreen onLogin={() => setLogged(true)} />
      )}
    </>
  );
}
