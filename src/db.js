// src/db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Шлях до файлу бази даних залишається незмінним
const DB_PATH = path.join(__dirname, '..', 'hardwork.db');

/**
 * Ця функція тепер створює НОВЕ з'єднання з БД
 * і вмикає режим 'WAL' (Write-Ahead Logging).
 */
function getDbConnection() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

        // ВМИКАЄМО РЕЖИМ WAL (ДОЗВОЛЯЄ ОДНОЧАСНИЙ ЗАПИС/ЧИТАННЯ)
        db.exec('PRAGMA journal_mode = WAL;', (err) => {
            if (err) {
                return reject(err);
            }
            
            // ---!!! (ГОЛОВНЕ ВИПРАВЛЕННЯ ТУТ) !!!---
            // Вказуємо SQLite почекати 5 секунд (5000 мс), якщо БД зайнята,
            // перш ніж повертати помилку SQLITE_BUSY.
            // Це вирішує конфлікти між воркером (UPDATE) та сервером (SELECT/UPDATE).
            db.exec('PRAGMA busy_timeout = 5000;', (err) => {
                if (err) {
                    return reject(err);
                }
                resolve(db);
            });
            // ---!!! (КІНЕЦЬ ВИПРАВЛЕННЯ) !!!---
        });
    });
}

/**
 * Наш 'pool' тепер буде обгорткою, яка створює
 * нове з'єднання для кожного запиту і закриває його.
 */
const pool = {
    query: (text, params = []) => {
        // Перетворюємо $1, $2 на ?, ? (синтаксис SQLite)
        const sql = text.replace(/\$\d+/g, '?');
        const command = sql.trim().toUpperCase(); 

        return new Promise(async (resolve, reject) => {
            let db;
            try {
                // 1. Отримуємо нове, свіже з'єднання
                db = await getDbConnection();

                // Перевіряємо, чи команда повертає рядки (SELECT або PRAGMA)
                if (command.startsWith('SELECT') || command.startsWith('PRAGMA')) {
                    db.all(sql, params, (err, rows) => {
                        if (err) return reject(err);
                        resolve({ rows: rows });
                    });
                } else {
                    db.run(sql, params, function (err) {
                        if (err) return reject(err);
                        resolve({ 
                            rows: [{ id: this.lastID }], // Повертаємо lastID для INSERT
                            rowCount: this.changes 
                        });
                    });
                }
            } catch (err) {
                reject(err);
            } finally {
                // 3. Закриваємо з'єднання, незалежно від результату
                if (db) {
                    db.close((err) => {
                        if (err) console.error("❌ Помилка закриття БД SQLite:", err.message);
                    });
                }
            }
        });
    }
};

// Функція ініціалізації
async function initDB() {
    try {
        console.log('Ініціалізація схеми SQLite...');
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                
                -- Переконуємось, що тут TEXT
                job_id TEXT NOT NULL UNIQUE, 
                
                status TEXT NOT NULL DEFAULT 'PENDING',
                progress INTEGER NOT NULL DEFAULT 0,
                params TEXT, 
                result TEXT, 
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks (user_id, status);
        `);
        
        // Перевіряємо, чи ввімкнено WAL
        const pragmaRes = await pool.query("PRAGMA journal_mode;");
        
        if (pragmaRes.rows && pragmaRes.rows.length > 0) {
            console.log(`✅ Схему SQLite успішно ініціалізовано (Journal Mode: ${pragmaRes.rows[0].journal_mode})`);
        } else {
             console.log(`✅ Схему SQLite успішно ініціалізовано (Journal Mode: не вдалося визначити)`);
        }
        
    } catch (err) {
        console.error("❌ Помилка ініціалізації SQLite:", err);
    }
}

module.exports = {
    pool,
    initDB
};