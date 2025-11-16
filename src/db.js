// src/db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Шлях до файлу бази даних залишається незмінним
const DB_PATH = path.join(__dirname, '..', 'hardwork.db');

/**
 * Ця функція тепер створює НОВЕ з'єднання з БД
 * і вмикає режим 'WAL' (Write-Ahead Logging).
 * WAL є КРИТИЧНО ВАЖЛИВИМ для того, щоб дозволити 'compute.js' (який читає)
 * бачити зміни, які 'server.js' (який пише) робить *одночасно*.
 */
function getDbConnection() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

        // ВМИКАЄМО РЕЖИМ WAL (ВИРІШУЄ ПРОБЛЕМУ СКАСУВАННЯ)
        db.exec('PRAGMA journal_mode = WAL;', (err) => {
            if (err) {
                return reject(err);
            }
            resolve(db);
        });
    });
}

/**
 * Наш 'pool' тепер буде обгорткою, яка створює
 * нове з'єднання для кожного запиту і закриває його.
 * Це робить SQLite безпечним для паралельного доступу з багатьох процесів.
 */
const pool = {
    query: (text, params = []) => {
        // Перетворюємо $1, $2 на ?, ? (синтаксис SQLite)
        const sql = text.replace(/\$\d+/g, '?');
        
        return new Promise(async (resolve, reject) => {
            let db;
            try {
                // 1. Отримуємо нове, свіже з'єднання
                db = await getDbConnection();

                // 2. Виконуємо запит
                if (sql.trim().toUpperCase().startsWith('SELECT')) {
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

// Функція ініціалізації залишається такою ж, але тепер вона
// буде використовувати наш новий 'pool.query', який безпечний для процесів.
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
                job_id INTEGER NOT NULL UNIQUE, 
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
        console.log(`✅ Схему SQLite успішно ініціалізовано (Journal Mode: ${pragmaRes.rows[0].journal_mode})`);
        
    } catch (err) {
        console.error("❌ Помилка ініціалізації SQLite:", err);
    }
}

module.exports = {
    pool,
    initDB
};