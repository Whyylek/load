// src/compute.js
const { parentPort, workerData } = require('worker_threads');
const sqlite3 = require('sqlite3');
const path = require('path');

// Шлях до файлу бази даних
const DB_PATH = path.join(__dirname, '..', 'hardwork.db');

// Отримуємо дані, передані з worker.js
const { taskParams, userId, jobId } = workerData;

/**
 * Асинхронна функція для перевірки статусу 'CANCELED' в БД.
 * ВАЖЛИВО: Вона ВІДКРИВАЄ, ЧИТАЄ і ЗАКРИВАЄ з'єднання КОЖЕН РАЗ.
 * Це гарантує, що ми бачимо зміни, зроблені іншими процесами (server.js).
 */
function checkCancellation() {
    return new Promise((resolve) => {
        // 1. Відкриваємо нове з'єднання (лише для читання)
        const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                console.error(`[Thread: ${jobId}] ❌ Помилка підключення до SQLite для перевірки скасування:`, err.message);
                return resolve(false); // Не скасовуємо, якщо не можемо перевірити
            }

            // 2. Вмикаємо WAL (для безпечного одночасного читання)
            db.exec('PRAGMA journal_mode = WAL;', (err) => {
                if (err) {
                    console.error(`[Thread: ${jobId}] ❌ Помилка ввімкнення WAL:`, err.message);
                    // Продовжуємо, навіть якщо помилка
                }

                // 3. Читаємо актуальний статус
                db.get('SELECT status FROM tasks WHERE job_id = ?', [jobId], (err, row) => {
                    
                    // 4. Негайно закриваємо з'єднання
                    db.close((closeErr) => {
                         if (closeErr) console.error(`[Thread: ${jobId}] ❌ Помилка закриття БД:`, closeErr.message);
                    }); 
                    
                    if (err) {
                        console.error(`[Thread: ${jobId}] ❌ Помилка читання статусу:`, err.message);
                        return resolve(false); 
                    }
                    
                    // 5. Повертаємо результат
                    if (row && row.status === 'CANCELED') {
                        return resolve(true); // Завдання скасовано
                    }
                    
                    return resolve(false); // Завдання не скасовано
                });
            });
        });
    });
}

/**
 * CPU-інтенсивний Monte Carlo метод для обчислення числа Пі.
 */
async function computeMonteCarlo() {
    let pointsInsideCircle = 0;
    let totalPoints = 0;
    const iterations = taskParams.iterations;
    
    // Частота оновлення прогресу (кожні 10 мільйонів ітерацій або 100 разів)
    const updateFrequency = Math.max(10000000, Math.floor(iterations / 100));

    for (let i = 0; i < iterations; i++) {
        // 1. Обчислення
        const x = Math.random();
        const y = Math.random();
        if (x * x + y * y <= 1) {
            pointsInsideCircle++;
        }
        totalPoints++;

        // 2. Оновлення прогресу та перевірка скасування
        if (i > 0 && i % updateFrequency === 0) {
            const progress = Math.round((totalPoints / iterations) * 100);
            
            parentPort.postMessage({ type: 'progress', progress: progress });
            
            // (Пункт 3) Перевіряємо, чи не скасував користувач завдання
            if (await checkCancellation()) {
                parentPort.postMessage({ type: 'canceled' });
                return { isCanceled: true };
            }
        }
    }

    // Фінальний розрахунок результату
    const piEstimate = (4 * pointsInsideCircle) / totalPoints;
    return { 
        result: { piEstimate, iterations }, 
        isCanceled: false 
    };
}

// --- Головна функція потоку ---
(async () => {
    try {
        console.log(`[Thread: ${jobId}] Початок обчислення...`);
        const result = await computeMonteCarlo();
        
        if (!result.isCanceled) {
            // Надсилаємо фінальний результат батьківському процесу
            parentPort.postMessage({
                type: 'completed',
                result: result.result,
            });
            console.log(`[Thread: ${jobId}] 🏁 Обчислення завершено.`);
        } else {
            console.log(`[Thread: ${jobId}] 🛑 Обчислення скасовано.`);
        }

    } catch (error) {
        // Якщо сталася помилка під час обчислення
        parentPort.postMessage({
            type: 'failed',
            error: error.message || 'Невідома помилка потоку',
        });
    }
    // Ми видалили 'finally { db.close() }', оскільки БД
    // тепер закривається всередині 'checkCancellation'
})();