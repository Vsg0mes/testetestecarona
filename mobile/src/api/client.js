import axios from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { storage } from './storage';

const TOKEN_KEY = 'carona_jwt';

// No navegador usa o proxy reverso /api quando em HTTPS/ngrok/porta 8081, ou http://<host>:3000 no dev server
const getBaseURL = () => {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location) {
      if (
        window.location.protocol === 'https:' ||
        window.location.hostname.includes('ngrok') ||
        window.location.port === '8081' ||
        window.location.port === ''
      ) {
        return '/api';
      }
      return `http://${window.location.hostname}:3000`;
    }
    return '/api';
  }
  return Constants.expoConfig?.extra?.apiUrl;
};

const baseURL = getBaseURL();

export const api = axios.create({ baseURL, timeout: 10000 });

// Injeta o JWT em toda requisição
api.interceptors.request.use(async (config) => {
  const token = await storage.get(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    if (error.response?.status === 401) {
      await storage.del(TOKEN_KEY);
      onUnauthorized();
    }
    return Promise.reject(error);
  }
);

export const auth = {
  async login(email) {
    const { data } = await api.post('/login', { email });
    await storage.set(TOKEN_KEY, data.token);
    return data.usuario;
  },
  hasToken: async () => !!(await storage.get(TOKEN_KEY)),
  logout: () => storage.del(TOKEN_KEY),
};

export const errMsg = (e) => e.response?.data?.erro || 'Falha de conexão';
