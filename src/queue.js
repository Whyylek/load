const Bull = require('bull');
const { pool } = require('./db'); 
require('dotenv').config();

const REDIS_URL = process.env.REDIS_URL;
const QUEUE_NAME = 'heavyTaskQueue'; 

const heavyTaskQueue = new Bull(QUEUE_NAME, REDIS_URL);
console.log(`[Queue] Черга Bull "${QUEUE_NAME}" налаштована.`);


async function addTask(taskParams, userId) {
    try {
        
        const job = await heavyTaskQueue.add({
            taskParams,
            userId,
        });

     
        const paramsString = JSON.stringify(taskParams);

       
        await pool.query(
            'INSERT INTO tasks (user_id, job_id, params, status) VALUES ($1, $2, $3, $4)',
            [userId, job.id, paramsString, 'PENDING']
        );

        return job;
    } catch (e) {
        console.error('❌ Помилка при додаванні завдання в чергу/БД:', e);
        throw e;
    }
}


async function getTask(jobId) {
    try {
        const res = await pool.query('SELECT * FROM tasks WHERE job_id = $1', [jobId]);
        const task = res.rows[0];

        // Парсимо JSON з TEXT
        if (task) {
            if (task.params) task.params = JSON.parse(task.params);
            if (task.result) task.result = JSON.parse(task.result);
        }
        
        return task;
    } catch (e) {
        console.error(`❌ Помилка при отриманні завдання ${jobId} з БД:`, e);
        return null;
    }
}

/**
 * Оновлює статус завдання в БД SQLite.
 */
async function updateTaskStatus(jobId, status, progress, result = null) {
    try {
        // Використовуємо CURRENT_TIMESTAMP замість NOW() для SQLite
        // Зберігаємо JSON як рядок
        const resultString = result ? JSON.stringify(result) : null;
        
        await pool.query(
            'UPDATE tasks SET status = $1, progress = $2, result = $3, updated_at = CURRENT_TIMESTAMP WHERE job_id = $4',
            [status, progress, resultString, jobId]
        );
    } catch (e) {
        console.error(`❌ Помилка при оновленні статусу завдання ${jobId} в БД:`, e);
    }
}

module.exports = {
    heavyTaskQueue,
    addTask,
    getTask,
    updateTaskStatus,
};