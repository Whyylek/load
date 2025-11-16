
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();


const SALT_ROUNDS = 10;

const JWT_SECRET = process.env.JWT_SECRET; 
const TOKEN_EXPIRATION = '7d'; 

/**
 * Хешує пароль.
 * @param {string} password 
 * @returns {Promise<string>} 
 */
async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 
 * @param {string} password 
 * @param {string} hash 
 * @returns {Promise<boolean>} 
 */
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 *
 * @param {number} userId 
 * @returns {string} 
 */
function generateToken(userId) {
  const payload = { userId };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });
}


function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Відсутній або недійсний токен авторизації.' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    req.user = { userId: decoded.userId };
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Токен авторизації закінчився.' });
    }
    return res.status(401).json({ message: 'Недійсний токен авторизації.' });
  }
}

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  authMiddleware,
};