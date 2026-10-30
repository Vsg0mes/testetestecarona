const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const SCRYPT_KEYLEN = 64;
const DUMMY_SALT = '00000000000000000000000000000000';
const DUMMY_HASH = crypto.scryptSync('senha_invalida_dummy', DUMMY_SALT, SCRYPT_KEYLEN);

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

function verificarSenha(senha, senhaHash) {
  if (typeof senha !== 'string' || !senha || typeof senhaHash !== 'string' || !senhaHash) {
    crypto.scryptSync(String(senha || ''), DUMMY_SALT, SCRYPT_KEYLEN);
    return false;
  }
  const partes = senhaHash.split(':');
  if (partes.length !== 2) return false;
  const [salt, hashHex] = partes;
  const esperado = Buffer.from(hashHex, 'hex');
  if (!salt || esperado.length !== SCRYPT_KEYLEN) return false;
  const calculado = crypto.scryptSync(senha, salt, SCRYPT_KEYLEN);
  return crypto.timingSafeEqual(esperado, calculado);
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: 'USUARIO' }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '12h',
  });
}

function signAgentToken(agente) {
  return jwt.sign(
    { sub: agente.id, login: agente.login, nome: agente.nome, role: 'AGENTE' },
    JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: '8h',
    }
  );
}

function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ erro: 'Token ausente' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (payload.role === 'AGENTE' || !payload.email) {
      return res.status(403).json({ erro: 'Acesso restrito a usuários da comunidade acadêmica' });
    }
    req.user = { id: Number(payload.sub), email: payload.email };
    return next();
  } catch {
    return res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
}

function requireAgente(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ erro: 'Token ausente' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (payload.role !== 'AGENTE' || !payload.login) {
      return res.status(403).json({ erro: 'Acesso restrito aos agentes da Segurança do Campus' });
    }
    req.agente = { id: Number(payload.sub), login: payload.login, nome: payload.nome };
    return next();
  } catch {
    return res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
}

// Permite token de AGENTE ou token de USUARIO (para rotas onde o handler valida propriedade estrita, ex.: chat privado SOS)
function requireUsuarioOuAgente(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ erro: 'Token ausente' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (payload.role === 'AGENTE' && payload.login) {
      req.authRole = 'AGENTE';
      req.agente = { id: Number(payload.sub), login: payload.login, nome: payload.nome };
      return next();
    }
    if (payload.role !== 'AGENTE' && payload.email) {
      req.authRole = 'USUARIO';
      req.user = { id: Number(payload.sub), email: payload.email };
      return next();
    }
    return res.status(403).json({ erro: 'Token sem permissão válida' });
  } catch {
    return res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
}

module.exports = {
  hashSenha,
  verificarSenha,
  signToken,
  signAgentToken,
  requireAuth,
  requireAgente,
  requireUsuarioOuAgente,
  DUMMY_HASH,
};
