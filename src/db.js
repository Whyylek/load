const sqlite3 = require('sqlite3').verbose();
const path = require('path');


const DB_PATH = path.join(__dirname, '..', 'hardwork.db');


function getDbConnection() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

       
        db.exec('PRAGMA journal_mode = WAL;', (err) => {
            if (err) {
                return reject(err);
            }
            
           
            db.exec('PRAGMA busy_timeout = 5000;', (err) => {
                if (err) {
                    return reject(err);
                }
                resolve(db);
            });
            
        });
    });
}


const pool = {
    query: (text, params = []) => {
       
        const sql = text.replace(/\$\d+/g, '?');
        const command = sql.trim().toUpperCase(); 

        return new Promise(async (resolve, reject) => {
            let db;
            try {
                
                db = await getDbConnection();

               
                if (command.startsWith('SELECT') || command.startsWith('PRAGMA')) {
                    db.all(sql, params, (err, rows) => {
                        if (err) return reject(err);
                        resolve({ rows: rows });
                    });
                } else {
                    db.run(sql, params, function (err) {
                        if (err) return reject(err);
                        resolve({ 
                            rows: [{ id: this.lastID }], 
                            rowCount: this.changes 
                        });
                    });
                }
            } catch (err) {
                reject(err);
            } finally {
                
                if (db) {
                    db.close((err) => {
                        if (err) console.error("❌ Помилка закриття БД SQLite:", err.message);
                    });
                }
            }
        });
    }
};


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