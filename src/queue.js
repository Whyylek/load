// src/queue.js
const Queue = require('bull');
const { REDIS_URL } = process.env; // Використовуйте змінну середовища для URL Redis

// Створюємо чергу для трудомістких задач
const heavyTaskQueue = new Queue('heavy task queue', {
    redis: REDIS_URL || 'redis://127.0.0.1:6379'
});

// Експортуємо функцію для додавання задач
const addTask = async (taskData, userId) => {
    // Властивості задачі (ID користувача, вхідні дані для розрахунку)
    const job = await heavyTaskQueue.add({
        taskData,
        userId,
        timestamp: Date.now()
    }, {
        // Додаткові опції: наприклад, максимальна кількість спроб
        attempts: 3
    });
    console.log(`Job ${job.id} added to the queue.`);
    return job;
};

module.exports = {
    heavyTaskQueue,
    addTask
};