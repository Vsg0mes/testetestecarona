import { Alert, Platform } from 'react-native';

// Alert.alert com botões não funciona no react-native-web
export function notify(title, msg = '') {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${msg}`);
  else Alert.alert(title, msg);
}

export function confirm(title, msg, okText, onOk) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${msg}`)) onOk();
    return;
  }
  Alert.alert(title, msg, [
    { text: 'Cancelar', style: 'cancel' },
    { text: okText, style: 'destructive', onPress: onOk },
  ]);
}
