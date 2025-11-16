// src/db.js
const { Pool } = require('pg');
require('dotenv').config(); // Для завантаження змінних з файлу .env

console.log('=== DB CONFIG ===');
console.log('User:', process.env.DB_USER);
console.log('Host:', process.env.DB_HOST);
console.log('Database:', process.env.DB_NAME);
console.log('Password exists:', !!process.env.DB_PASSWORD);
console.log('Port:', process.env.DB_PORT);

const pool = new Pool({
    user: process.env.DB_USER || 'user',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'hardworkdb',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || 5432,
});
// Функція для ініціалізації таблиць
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(100) NOT NULL
            );
            
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                job_id INTEGER NOT NULL UNIQUE, -- ID задачі з Redis/Bull
                status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                progress INTEGER NOT NULL DEFAULT 0,
                params JSONB,
                result JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Додамо індекс для швидкого пошуку по користувачу та статусу
            CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks (user_id, status);
        `);
        console.log("Database initialized successfully.");
    } catch (err) {
        console.error("Error initializing database:", err);
    }
}

module.exports = {
    pool,
    initDB
};