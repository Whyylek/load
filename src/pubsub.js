// src/pubsub.js
const Redis = require('ioredis');
require('dotenv').config();

const REDIS_URL = process.env.REDIS_URL;
// Ця назва каналу буде використовуватися і в server.js, і в worker.js
const CHANNEL = 'task_updates_channel'; 

// Створюємо окремий клієнт для публікації (Producer)
const publisher = new Redis(REDIS_URL, {
    // Додаємо опції перепідключення про всяк випадок
    retryStrategy: times => Math.min(times * 50, 2000)
});

// Створюємо окремий клієнт для підписки (Consumer)
const subscriber = new Redis(REDIS_URL, {
    retryStrategy: times => Math.min(times * 50, 2000)
});

publisher.on('error', (err) => console.error('❌ [PubSub/Publisher] Помилка Redis:', err));
subscriber.on('error', (err) => console.error('❌ [PubSub/Subscriber] Помилка Redis:', err));

console.log('[PubSub] Клієнти Redis Pub/Sub налаштовані.');

/**
 * Надсилає оновлення статусу на канал (використовується у worker.js)
 */
const publishUpdate = (data) => {
    // Всі дані задачі та прогресу
    publisher.publish(CHANNEL, JSON.stringify(data));
};

module.exports = {
    publisher,
    subscriber,
    CHANNEL, // <-- Ключовий експорт
    publishUpdate,
};