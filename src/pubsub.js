// src/pubsub.js
const Redis = require('ioredis');
require('dotenv').config();

const REDIS_URL = process.env.REDIS_URL;
const CHANNEL = 'task_updates_channel'; // Канал для прогресу
const CANCEL_CHANNEL = 'task_cancel_channel'; // Канал для скасування

// Один паблішер для всіх
const publisher = new Redis(REDIS_URL, {
    retryStrategy: times => Math.min(times * 50, 2000)
});

// !!! Окремий клієнт-підписник для ПРОГРЕСУ (для server.js)
const progressSubscriber = new Redis(REDIS_URL, {
    retryStrategy: times => Math.min(times * 50, 2000)
});

// !!! Окремий клієнт-підписник для СКАСУВАННЯ (для worker.js)
const cancelSubscriber = new Redis(REDIS_URL, {
    retryStrategy: times => Math.min(times * 50, 2000)
});

publisher.on('error', (err) => console.error('❌ [PubSub/Publisher] Помилка Redis:', err));
progressSubscriber.on('error', (err) => console.error('❌ [PubSub/ProgressSub] Помилка Redis:', err));
cancelSubscriber.on('error', (err) => console.error('❌ [PubSub/CancelSub] Помилка Redis:', err));

console.log('[PubSub] Клієнти Redis Pub/Sub налаштовані.');

/**
 * Надсилає оновлення статусу на канал (використовується у worker.js)
 */
const publishUpdate = (data) => {
    publisher.publish(CHANNEL, JSON.stringify(data));
};

module.exports = {
    publisher,
    progressSubscriber, // <-- Експортуємо
    cancelSubscriber,   // <-- Експортуємо
    CHANNEL,
    CANCEL_CHANNEL, 
    publishUpdate,
};