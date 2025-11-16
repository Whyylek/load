
const { parentPort, workerData } = require('worker_threads');
const { Pool } = require('pg'); 
const dotenv = require('dotenv');

dotenv.config();


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
const MAX_ALLOWED_ITERATIONS = 500000000000; 

async function checkCancellation() {
  try {
    const res = await pool.query('SELECT status FROM tasks WHERE id = $1', [taskId]);
    if (res.rows.length > 0 && res.rows[0].status === 'CANCELED') {
      return true;
    }
    return false;
  } catch (err) {
  
    console.error(`[Thread: ${taskId}] Помилка перевірки скасування:`, err.message);
    return false;
  }
}


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

  
    if (i % updateFrequency === 0 && i !== 0) {
      const progress = Math.round((totalPoints / iterations) * 100);
      
    
      parentPort.postMessage({ type: 'progress', progress });
      
     
      if (await checkCancellation()) {
        parentPort.postMessage({ type: 'canceled' });
        return { isCanceled: true };
      }
    }
  }

  const piEstimate = (4 * pointsInsideCircle) / totalPoints;
  return { piEstimate, isCanceled: false };
}


(async () => {
  try {
 
    if (iterations > MAX_ALLOWED_ITERATIONS) {
      throw new Error(`Перевищено максимальну кількість ітерацій: ${iterations}. Макс. ліміт: ${MAX_ALLOWED_ITERATIONS}`);
    }
    
    console.log(`[Thread: ${taskId}] Початок обчислення...`);
    const startTime = Date.now();
    
    const result = await computeMonteCarlo();
    
    const duration = (Date.now() - startTime) / 1000; 

    if (!result.isCanceled) {
      
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
   
    parentPort.postMessage({
      type: 'failed',
      error: error.message || 'Невідома помилка потоку',
    });
  } finally {
  
    await pool.end();
  
    process.exit(0);
  }
})();