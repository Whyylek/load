// src/worker.js - Сервер Обчислень (Worker)
const { heavyTaskQueue, updateTaskStatus, getTask } = require('./queue');
const { publishUpdate } = require('./pubsub'); // Підключаємо наш Pub/Sub
// Встановлюємо максимальний ліміт ітерацій для імітації довгої задачі
const MAX_ITERATIONS = 1e12; 

console.log(`Worker process started. Monitoring queue...`);

// --- ФУНКЦІЯ ОБЧИСЛЕННЯ (Monte Carlo) ---
async function runHeavyCalculation(iterations, jobId, userId) {
    let hits = 0;
    const totalIterations = iterations;
    
    // Якщо ітерацій занадто багато, обрізаємо їх, щоб уникнути зависання
    const actualIterations = Math.min(iterations, MAX_ITERATIONS); 
    
    const progressInterval = actualIterations / 100; // Оновлення кожні 1%
    
    for (let i = 0; i < actualIterations; i++) {
        const x = Math.random();
        const y = Math.random();
        if (x * x + y * y <= 1) {
            hits++;
        }

        // --- Контроль Прогресу та Скасування ---
        if (i > 0 && i % progressInterval === 0) {
            const progress = Math.floor((i / actualIterations) * 100);
            
            // 1. Сповіщення Основного Сервера про прогрес (Пункт 2)
            publishUpdate({ jobId, progress, status: 'RUNNING', userId });
            
            // 2. Перевірка на скасування (Пункт 3)
            // Оскільки ми не хочемо робити запит до БД на кожній ітерації, 
            // перевіряємо стан лише під час оновлення прогресу
            const taskInDb = await getTask(jobId);
            if (taskInDb && taskInDb.status === 'CANCELED') {
                 // Оновлюємо фінальний статус у БД
                await updateTaskStatus(jobId, 'CANCELED', progress); 
                return { status: 'CANCELED', result: null };
            }
            
            // 3. Оновлення статусу в БД (Це також можна робити рідше)
            await updateTaskStatus(jobId, 'RUNNING', progress);
        }
    }

    const piEstimate = (hits / actualIterations) * 4;
    return { 
        status: 'COMPLETED',
        result: { pi: piEstimate, iterations: actualIterations }
    };
}


// --- ОБРОБНИК ЧЕРГИ Bull ---
heavyTaskQueue.process(1, async (job) => { // 1 - одночасна обробка задач на цьому worker-процесі
    const { taskData, userId } = job.data;
    const jobId = job.id;
    
    console.log(`[TASK ${jobId}] Starting calculation for user ${userId}...`);

    // Встановлюємо початковий стан RUNNING
    await updateTaskStatus(jobId, 'RUNNING', 0);
    publishUpdate({ jobId, progress: 0, status: 'RUNNING', userId });

    try {
        const result = await runHeavyCalculation(taskData.iterations, jobId, userId);

        // Фінальне оновлення
        if (result.status === 'COMPLETED') {
            await updateTaskStatus(jobId, 'COMPLETED', 100, result.result);
            publishUpdate({ jobId, progress: 100, status: 'COMPLETED', userId });
            console.log(`[TASK ${jobId}] Finished. Result: ${result.result.pi.toFixed(5)}`);
        } else if (result.status === 'CANCELED') {
             console.log(`[TASK ${jobId}] CANCELED by user.`);
             publishUpdate({ jobId, progress: 0, status: 'CANCELED', userId });
        }
        
        return result; 
    } catch (error) {
        // Обробка непередбачених помилок
        await updateTaskStatus(jobId, 'ERROR', 0, { error: error.message });
        publishUpdate({ jobId, progress: 0, status: 'ERROR', userId });
        console.error(`[TASK ${jobId}] ERROR:`, error.message);
        throw error; // Повідомити Bull про помилку
    }
});

// Щоб worker не впав через необроблені винятки
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});