// src/compute.js
const { parentPort, workerData } = require('worker_threads');

// Отримуємо дані, передані з worker.js
const { taskParams, userId, jobId } = workerData;
const { iterations } = taskParams;

/**
 * CPU-інтенсивний Monte Carlo метод для обчислення числа Пі.
 * Цей потік тепер не турбується про скасування.
 * Він просто рахує і надсилає прогрес.
 * Якщо 'worker.js' отримає команду скасування, він 'вб'є' цей потік.
 */
async function computeMonteCarlo() {
    let pointsInsideCircle = 0;
    let totalPoints = 0;
    
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

        // 2. Оновлення прогресу
        if (i > 0 && i % updateFrequency === 0) {
            const progress = Math.round((totalPoints / iterations) * 100);
            
            // Надсилаємо прогрес батьківському процесу (worker.js)
            parentPort.postMessage({ type: 'progress', progress: progress });
        }
    }

    // Фінальний розрахунок результату
    const piEstimate = (4 * pointsInsideCircle) / totalPoints;
    return { 
        result: { piEstimate, iterations }, 
    };
}

// --- Головна функція потоку ---
(async () => {
    try {
        console.log(`[Thread: ${jobId}] Початок обчислення...`);
        const result = await computeMonteCarlo();
        
        // Надсилаємо фінальний результат батьківському процесу
        parentPort.postMessage({
            type: 'completed',
            result: result.result,
        });
        console.log(`[Thread: ${jobId}] 🏁 Обчислення завершено.`);

    } catch (error) {
        // Якщо сталася помилка під час обчислення
        parentPort.postMessage({
            type: 'failed',
            error: error.message || 'Невідома помилка потоку',
        });
    }
    // 'finally' блок для закриття БД нам більше не потрібен
})();