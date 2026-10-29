import axios from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { storage } from './storage';

const SEG_TOKEN_KEY = 'seguranca_jwt';
const SEG_AGENTE_KEY = 'seguranca_agente';

const baseURL = Platform.OS === 'web'
  ? '/api'
  : Constants.expoConfig?.extra?.apiUrl;

export const segurancaApi = axios.create({ baseURL, timeout: 10000 });

segurancaApi.interceptors.request.use(async (config) => {
  const token = await storage.get(SEG_TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let onAgenteUnauthorized = () => {};
export const setAgenteUnauthorizedHandler = (fn) => {
  onAgenteUnauthorized = fn;
};

segurancaApi.interceptors.response.use(
  (r) => r,
  async (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/seguranca/login')) {
      await storage.del(SEG_TOKEN_KEY);
      await storage.del(SEG_AGENTE_KEY);
      onAgenteUnauthorized();
    }
    return Promise.reject(error);
  }
);

export const segurancaAuth = {
  async login(login, senha) {
    const { data } = await segurancaApi.post('/seguranca/login', { login, senha });
    await storage.set(SEG_TOKEN_KEY, data.token);
    await storage.set(SEG_AGENTE_KEY, JSON.stringify(data.agente));
    return data.agente;
  },
  async hasToken() {
    return !!(await storage.get(SEG_TOKEN_KEY));
  },
  async getAgente() {
    try {
      const raw = await storage.get(SEG_AGENTE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  async logout() {
    await storage.del(SEG_TOKEN_KEY);
    await storage.del(SEG_AGENTE_KEY);
  },
};

export const segErrMsg = (e) => e.response?.data?.erro || 'Falha de conexão com o servidor';

