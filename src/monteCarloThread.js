// src/monteCarloThread.js
const { parentPort, workerData } = require('worker_threads');
const { Pool } = require('pg'); 
const dotenv = require('dotenv');

dotenv.config();

// Створюємо власний пул підключень до БД *лише* для цього потоку.
// Це необхідно, оскільки пули не можна передавати між потоками.
// Цей пул буде використовуватися *тільки* для перевірки скасування.
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT, 10) || 5432,
});

pool.on('error', (err) => {
  console.error('[Thread] Неочікувана помилка в PG-пулі потоку', err);
});

const { taskId, iterations, userId } = workerData;
const MAX_ALLOWED_ITERATIONS = 500000000000; // Повинно збігатися з server.js

/**
 * Функція для перевірки, чи було скасовано завдання в головній БД.
 * (Пункт 3: Скасування задачі)
 */
async function checkCancellation() {
  try {
    const res = await pool.query('SELECT status FROM tasks WHERE id = $1', [taskId]);
    if (res.rows.length > 0 && res.rows[0].status === 'CANCELED') {
      return true;
    }
    return false;
  } catch (err) {
    // Якщо сталася помилка (наприклад, БД недоступна), ми не повинні зупиняти обчислення,
    // але повідомимо про це.
    console.error(`[Thread: ${taskId}] Помилка перевірки скасування:`, err.message);
    return false;
  }
}

/**
 * CPU-інтенсивний Monte Carlo метод для обчислення числа Пі.
 */
async function computeMonteCarlo() {
  let pointsInsideCircle = 0;
  let totalPoints = 0;
  
  // Визначаємо розмір "порції" для оновлення прогресу.
  // Ми хочемо надсилати оновлення ~100 разів за весь час роботи.
  // Або кожні 10 мільйонів ітерацій, якщо загальна кількість мала.
  const updateFrequency = Math.max(10000000, Math.floor(iterations / 100));

  for (let i = 0; i < iterations; i++) {
    // 1. Обчислення (Monte Carlo)
    const x = Math.random();
    const y = Math.random();
    if (x * x + y * y <= 1) {
      pointsInsideCircle++;
    }
    totalPoints++;

    // 2. Перевірка прогресу та скасування (лише кожну "порцію")
    if (i % updateFrequency === 0 && i !== 0) {
      const progress = Math.round((totalPoints / iterations) * 100);
      
      // Надсилаємо повідомлення про прогрес назад до Worker (через parentPort)
      // (Пункт 2: Інформування про хід виконання)
      parentPort.postMessage({ type: 'progress', progress });
      
      // Перевіряємо скасування через БД
      if (await checkCancellation()) {
        parentPort.postMessage({ type: 'canceled' });
        return { isCanceled: true };
      }
    }
  }

  // Фінальний розрахунок результату
  const piEstimate = (4 * pointsInsideCircle) / totalPoints;
  return { piEstimate, isCanceled: false };
}

// --- Головна функція потоку ---
(async () => {
  try {
    // Перевірка вхідних даних (Пункт 1: Обмеження трудомісткості)
    if (iterations > MAX_ALLOWED_ITERATIONS) {
      throw new Error(`Перевищено максимальну кількість ітерацій: ${iterations}. Макс. ліміт: ${MAX_ALLOWED_ITERATIONS}`);
    }
    
    console.log(`[Thread: ${taskId}] Початок обчислення...`);
    const startTime = Date.now();
    
    const result = await computeMonteCarlo();
    
    const duration = (Date.now() - startTime) / 1000; // Час виконання в секундах

    if (!result.isCanceled) {
      // Надсилаємо фінальний результат батьківському процесу (worker.js)
      parentPort.postMessage({
        type: 'completed',
        result: {
          piEstimate: result.piEstimate,
          iterations: iterations,
        },
        duration: duration,
      });
      console.log(`[Thread: ${taskId}] Обчислення завершено. Час: ${duration} сек.`);
    } else {
      console.log(`[Thread: ${taskId}] Обчислення скасовано.`);
    }

  } catch (error) {
    // Якщо сталася помилка, передаємо її батьківському процесу
    parentPort.postMessage({
      type: 'failed',
      error: error.message || 'Невідома помилка потоку',
    });
  } finally {
    // Закриваємо пул підключень до БД
    await pool.end();
    // Потік завершує свою роботу
    process.exit(0);
  }
})();