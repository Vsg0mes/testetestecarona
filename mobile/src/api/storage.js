// Nativo: armazenamento criptografado do SO (Keychain / Keystore)
import * as SecureStore from 'expo-secure-store';

export const storage = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  del: (k) => SecureStore.deleteItemAsync(k),
};
