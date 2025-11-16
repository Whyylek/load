// src/worker.js
const { Worker } = require('worker_threads');
const path = require('path'); // <--- ОСЬ ВИПРАВЛЕННЯ: Імпортуємо модуль 'path'
require('dotenv').config();

// Створюємо змінну для шляху до нашого скрипта обчислень
const computeScriptPath = path.join(__dirname, 'compute.js'); 

// Імпортуємо наші нові модулі, сумісні з SQLite
const { heavyTaskQueue, updateTaskStatus } = require('./queue'); //
const { publishUpdate, CHANNEL } = require('./pubsub'); //

// Унікальний ID для цього воркера
const WORKER_ID = process.env.WORKER_ID || `Worker-${process.pid}`;

// Кількість одночасних завдань
const CONCURRENCY = 1;

console.log(`[Worker: ${WORKER_ID}] ✅ Сервер обчислень (SQLite) запущено. Очікую на завдання...`);

/**
 * Головний обробник черги Bull
 */
heavyTaskQueue.process(CONCURRENCY, async (job) => {
    const { taskParams, userId } = job.data;
    const jobId = job.id;

    console.log(`[Worker: ${WORKER_ID}] ⏯️  Отримано завдання ${jobId} для користувача ${userId}`);

    try {
        // 1. Позначити завдання як 'RUNNING' в БД та повідомити клієнта
        await updateTaskStatus(jobId, 'RUNNING', 0, null);
        await publishUpdate({ 
            jobId: jobId, 
            userId: userId, 
            status: 'RUNNING', 
            progress: 0, 
            workerId: WORKER_ID 
        });

        // 2. Створити Promise, який буде очікувати завершення потоку
        return new Promise((resolve, reject) => {
            
            // Запускаємо наш CPU-інтенсивний файл в окремому потоці
            // Використовуємо змінну `computeScriptPath`
            const worker = new Worker(computeScriptPath, {
                workerData: { 
                    taskParams, 
                    userId, 
                    jobId 
                }, // Передаємо дані в потік
            });

            // 3. Обробка повідомлень від потоку
            worker.on('message', async (message) => {
                
                if (message.type === 'progress') {
                    // (Пункт 2: Інформування про хід виконання)
                    await updateTaskStatus(jobId, 'RUNNING', message.progress, null);
                    await publishUpdate({
                        jobId: jobId,
                        userId: userId,
                        status: 'RUNNING',
                        progress: message.progress,
                        workerId: WORKER_ID,
                    });
                
                } else if (message.type === 'completed') {
                    console.log(`[Worker: ${WORKER_ID}] 🏁 Завдання ${jobId} завершено.`);
                    
                    await updateTaskStatus(jobId, 'COMPLETED', 100, message.result);
                    await publishUpdate({
                        jobId: jobId,
                        userId: userId,
                        status: 'COMPLETED',
                        progress: 100,
                        result: message.result, // Надсилаємо фінальний результат
                        workerId: WORKER_ID,
                    });
                    resolve(message.result); // Завершуємо завдання Bull
                
                } else if (message.type === 'failed') {
                    console.error(`[Worker: ${WORKER_ID}] ❌ Помилка в потоці ${jobId}: ${message.error}`);
                    await updateTaskStatus(jobId, 'FAILED', 100, { error: message.error });
                    await publishUpdate({
                        jobId: jobId,
                        userId: userId,
                        status: 'FAILED',
                        progress: 100,
                        result: { error: message.error }, // Надсилаємо помилку
                        workerId: WORKER_ID,
                    });
                    reject(new Error(message.error)); // Повідомляємо Bull про помилку
                
                } else if (message.type === 'canceled') {
                    // (Пункт 3: Скасування задачі)
                    console.log(`[Worker: ${WORKER_ID}] 🛑 Завдання ${jobId} скасовано потоком.`);
                    // Статус 'CANCELED' вже встановлено в БД з server.js
                    resolve({ status: 'canceled' });
                }
            });

            // 4. Обробка критичних помилок потоку
            worker.on('error', async (err) => {
                console.error(`[Worker: ${WORKER_ID}] ❌ Критична помилка потоку ${jobId}:`, err);
                await updateTaskStatus(jobId, 'FAILED', 100, { error: err.message });
                await publishUpdate({
                    jobId,
                    userId,
                    status: 'FAILED',
                    progress: 100,
                    result: { error: err.message },
                    workerId: WORKER_ID,
                });
                reject(err);
            });

            worker.on('exit', (code) => {
                if (code !== 0) {
                    const errorMsg = `Потік несподівано завершився з кодом ${code}`;
                    console.error(`[Worker: ${WORKER_ID}] ❌ ${errorMsg} для ${jobId}`);
                    // Завдання буде позначено як FAILED
                    reject(new Error(errorMsg));
                }
            });
        });
    } catch (e) {
        console.error(`[Worker: ${WORKER_ID}] ❌ Фатальна помилка обробки ${jobId}:`, e);
        // Якщо помилка сталася до запуску потоку
        await updateTaskStatus(jobId, 'FAILED', 0, { error: e.message });
        throw e; // Bull перенесе завдання у failed
    }
});

// Обробка помилок самої черги
heavyTaskQueue.on('failed', (job, err) => {
  console.error(`[Worker: ${WORKER_ID}] ❌ Завдання ${job.id} зазнало невдачі в Bull:`, err.message);
});