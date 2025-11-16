// index.js
const dotenv = require('dotenv');

dotenv.config(); // Завантажуємо .env змінні

// Запускаємо наш основний серверний файл, який лежить в src/
require('./src/server.js');