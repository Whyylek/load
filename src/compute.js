
const { parentPort, workerData } = require('worker_threads');


const { taskParams, userId, jobId } = workerData;
const { iterations } = taskParams;


async function computeMonteCarlo() {
    let pointsInsideCircle = 0;
    let totalPoints = 0;
    

    const updateFrequency = Math.max(10000000, Math.floor(iterations / 100));

    for (let i = 0; i < iterations; i++) {
       
        const x = Math.random();
        const y = Math.random();
        if (x * x + y * y <= 1) {
            pointsInsideCircle++;
        }
        totalPoints++;

       
        if (i > 0 && i % updateFrequency === 0) {
            const progress = Math.round((totalPoints / iterations) * 100);
            
           
            parentPort.postMessage({ type: 'progress', progress: progress });
        }
    }

    
    const piEstimate = (4 * pointsInsideCircle) / totalPoints;
    return { 
        result: { piEstimate, iterations }, 
    };
}


(async () => {
    try {
        console.log(`[Thread: ${jobId}] Початок обчислення...`);
        const result = await computeMonteCarlo();
        
       
        parentPort.postMessage({
            type: 'completed',
            result: result.result,
        });
        console.log(`[Thread: ${jobId}] 🏁 Обчислення завершено.`);

    } catch (error) {
       
        parentPort.postMessage({
            type: 'failed',
            error: error.message || 'Невідома помилка потоку',
        });
    }

})();