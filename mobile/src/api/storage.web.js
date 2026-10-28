// Web: SecureStore não existe no navegador. sessionStorage some ao fechar a aba
// (menos exposição que localStorage). Para produção web, preferir cookie httpOnly.
export const storage = {
  get: async (k) => sessionStorage.getItem(k),
  set: async (k, v) => sessionStorage.setItem(k, v),
  del: async (k) => sessionStorage.removeItem(k),
};
