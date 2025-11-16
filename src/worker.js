
const { Worker } = require('worker_threads');
const path = require('path'); 
require('dotenv').config();


const { heavyTaskQueue, updateTaskStatus } = require('./queue'); 
const { publishUpdate, CHANNEL, cancelSubscriber, CANCEL_CHANNEL } = require('./pubsub'); 

const computeScriptPath = path.join(__dirname, 'compute.js'); 
const WORKER_ID = process.env.WORKER_ID || `Worker-${process.pid}`;
const CONCURRENCY = 1;

const activeWorkers = new Map();

console.log(`[Worker: ${WORKER_ID}] ✅ Сервер обчислень (SQLite) запущено. Очікую на завдання...`);

cancelSubscriber.subscribe(CANCEL_CHANNEL, (err) => {
    if (err) {
        console.error(`❌ [Worker: ${WORKER_ID}] Помилка підписки на ${CANCEL_CHANNEL}`, err);
    } else {
        console.log(`✅ [Worker: ${WORKER_ID}] Підписано на канал скасування: ${CANCEL_CHANNEL}`);
    }
});


cancelSubscriber.on('message', (channel, message) => {
    console.log(`[WORKER] Отримав повідомлення в каналі ${channel}: ${message} (тип: ${typeof message})`);

    if (channel === CANCEL_CHANNEL) {
    
        const jobIdToCancel = message.toString(); 
        
        console.log(`[WORKER] Мої активні воркери (перед .get()):`, Array.from(activeWorkers.keys()));

     
        const workerToCancel = activeWorkers.get(jobIdToCancel);
        
        if (workerToCancel) {
            console.log(`[WORKER] ✅ Знайшов воркер ${jobIdToCancel}! Завершую потік...`);
            
           
            workerToCancel.terminate();
            
  
            activeWorkers.delete(jobIdToCancel);
            
        } else {
            console.log(`[WORKER] ❌ Не знайшов воркер ${jobIdToCancel} в 'activeWorkers'. Або він на іншому воркері, або ключ не співпав.`);
        }
    }
});



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

           
            const jobIdString = jobId.toString();
            activeWorkers.set(jobIdString, worker);
            console.log(`[WORKER] Додав воркер для ${jobIdString} в 'activeWorkers'. Мапа тепер:`, Array.from(activeWorkers.keys()));


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
                    activeWorkers.delete(jobIdString); // Видаляємо з мапи за РЯДКОМ
                    
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
                    activeWorkers.delete(jobIdString); 
                    
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
            });

            worker.on('error', async (err) => {
                console.error(`[Worker: ${WORKER_ID}] ❌ Критична помилка потоку ${jobId}:`, err);
                activeWorkers.delete(jobIdString); 
                
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
                    console.log(`[Worker: ${WORKER_ID}] ℹ️  Потік ${jobId} був зупинений (код: ${code}).`);
                    activeWorkers.delete(jobIdString);
                    
                    
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