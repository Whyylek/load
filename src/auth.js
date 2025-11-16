// src/auth.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

// Конфігурація
const SALT_ROUNDS = 10;
// Використовуємо SUPER_SECURE_KEY_FOR_JWT_LOADBALANCER_PROJECT з .env
const JWT_SECRET = process.env.JWT_SECRET; 
const TOKEN_EXPIRATION = '7d'; // Токен дійсний 7 днів

/**
 * Хешує пароль.
 * @param {string} password - Пароль для хешування.
 * @returns {Promise<string>} Хеш пароля.
 */
async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Порівнює введений пароль з хешем.
 * @param {string} password - Введений користувачем пароль.
 * @param {string} hash - Хеш з бази даних.
 * @returns {Promise<boolean>} Результат порівняння.
 */
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Генерує JWT.
 * @param {number} userId - ID користувача, який буде вкладено в токен.
 * @returns {string} Згенерований JWT.
 */
function generateToken(userId) {
  const payload = { userId };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });
}

/**
 * Middleware для перевірки JWT в заголовках запиту.
 * Якщо токен валідний, додає userId до req.user і викликає next().
 * Інакше повертає 401 Unauthorized.
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Відсутній або недійсний токен авторизації.' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Додаємо інформацію про користувача до об'єкта запиту
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