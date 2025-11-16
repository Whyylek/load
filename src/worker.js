// src/worker.js
const { Worker } = require('worker_threads');
const path = require('path'); 
require('dotenv').config();

// Імпортуємо наші модулі
const { heavyTaskQueue, updateTaskStatus } = require('./queue'); 
// ---!!! (ВИПРАВЛЕННЯ 1) Імпортуємо 'subscriber' та 'CANCEL_CHANNEL' ---!!!
const { publishUpdate, CHANNEL, subscriber, CANCEL_CHANNEL } = require('./pubsub'); 

const computeScriptPath = path.join(__dirname, 'compute.js'); 
const WORKER_ID = process.env.WORKER_ID || `Worker-${process.pid}`;
const CONCURRENCY = 1;

// ---!!! (ВИПРАВЛЕННЯ 2) Мапа для зберігання активних потоків ---!!!
// Вона буде зберігати: { 'jobId-123': <WorkerThread>, 'jobId-456': <WorkerThread> }
const activeWorkers = new Map();

console.log(`[Worker: ${WORKER_ID}] ✅ Сервер обчислень (SQLite) запущено. Очікую на завдання...`);

// ---!!! (ВИПРАВЛЕННЯ 3) Підписка на канал скасування ---!!!
subscriber.subscribe(CANCEL_CHANNEL, (err) => {
    if (err) {
        console.error(`❌ [Worker: ${WORKER_ID}] Помилка підписки на ${CANCEL_CHANNEL}`, err);
    } else {
        console.log(`✅ [Worker: ${WORKER_ID}] Підписано на канал скасування: ${CANCEL_CHANNEL}`);
    }
});

// Обробник повідомлень (включає тепер і скасування)
subscriber.on('message', (channel, message) => {
    // Цей воркер тепер слухає два типи повідомлень, 
    // але 'message' з 'CHANNEL' (прогрес) нас не цікавить, 
    // оскільки воркер не має Socket.IO. Нас цікавить лише CANCEL_CHANNEL.

    if (channel === CANCEL_CHANNEL) {
        const jobIdToCancel = message; // 'message' тут - це просто jobId
        
        // Перевіряємо, чи *цей* воркер зараз виконує це завдання
        const workerToCancel = activeWorkers.get(jobIdToCancel);
        
        if (workerToCancel) {
            console.log(`[Worker: ${WORKER_ID}] 🛑 Отримано команду скасування для завдання ${jobIdToCancel}. Завершую потік...`);
            
            // Примусово "вбиваємо" потік
            workerToCancel.terminate();
            
            // Видаляємо його з мапи активних
            activeWorkers.delete(jobIdToCancel);
            
            // Ми не оновлюємо статус/не публікуємо, 
            // оскільки 'server.js' вже зробив це за нас.
        }
    }
});


/**
 * Головний обробник черги Bull
 */
heavyTaskQueue.process(CONCURRENCY, async (job) => {
    const { taskParams, userId } = job.data;
    const jobId = job.id;

    console.log(`[Worker: ${WORKER_ID}] ⏯️  Отримано завдання ${jobId} для користувача ${userId}`);

    try {
        await updateTaskStatus(jobId, 'RUNNING', 0, null);
        await publishUpdate({ 
            jobId: jobId, 
            userId: userId, 
            status: 'RUNNING', 
            progress: 0, 
            workerId: WORKER_ID 
        });

        return new Promise((resolve, reject) => {
            const worker = new Worker(computeScriptPath, {
                workerData: { taskParams, userId, jobId }, 
            });

            // ---!!! (ВИПРАВЛЕННЯ 4) Додаємо потік до мапи активних ---!!!
            activeWorkers.set(jobId.toString(), worker);

            worker.on('message', async (message) => {
                if (message.type === 'progress') {
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
                    activeWorkers.delete(jobId.toString()); // Видаляємо з мапи
                    
                    await updateTaskStatus(jobId, 'COMPLETED', 100, message.result);
                    await publishUpdate({
                        jobId: jobId,
                        userId: userId,
                        status: 'COMPLETED',
                        progress: 100,
                        result: message.result, 
                        workerId: WORKER_ID,
                    });
                    resolve(message.result);
                
                } else if (message.type === 'failed') {
                    console.error(`[Worker: ${WORKER_ID}] ❌ Помилка в потоці ${jobId}: ${message.error}`);
                    activeWorkers.delete(jobId.toString()); // Видаляємо з мапи
                    
                    await updateTaskStatus(jobId, 'FAILED', 100, { error: message.error });
                    await publishUpdate({
                        jobId: jobId,
                        userId: userId,
                        status: 'FAILED',
                        progress: 100,
                        result: { error: message.error }, 
                        workerId: WORKER_ID,
                    });
                    reject(new Error(message.error)); 
                }
                // Нам більше не потрібен 'canceled', оскільки ми "вбиваємо" потік
            });

            worker.on('error', async (err) => {
                console.error(`[Worker: ${WORKER_ID}] ❌ Критична помилка потоку ${jobId}:`, err);
                activeWorkers.delete(jobId.toString());
                
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
                // Цей код (1) спрацює при .terminate()
                if (code !== 0) {
                    console.log(`[Worker: ${WORKER_ID}] ℹ️  Потік ${jobId} був зупинений (код: ${code}).`);
                    activeWorkers.delete(jobId.toString());
                    
                    // Ми вже оновили статус на 'CANCELED' в server.js, 
                    // тому тут достатньо просто завершити job.
                    // 'resolve()' означає "успішно скасовано".
                    resolve({ status: 'terminated' }); 
                }
            });
        });
    } catch (e) {
        console.error(`[Worker: ${WORKER_ID}] ❌ Фатальна помилка обробки ${jobId}:`, e);
        await updateTaskStatus(jobId, 'FAILED', 0, { error: e.message });
        throw e;
    }
});

heavyTaskQueue.on('failed', (job, err) => {
  console.error(`[Worker: ${WORKER_ID}] ❌ Завдання ${job.id} зазнало невдачі в Bull:`, err.message);
});