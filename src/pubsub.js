// src/pubsub.js
const Redis = require('ioredis');
require('dotenv').config();

const REDIS_URL = process.env.REDIS_URL;
const CHANNEL = 'task_updates_channel'; // Канал для сповіщень

// Створюємо окремий клієнт для публікації (Producer)
const publisher = new Redis(REDIS_URL);

// Створюємо окремий клієнт для підписки (Consumer)
const subscriber = new Redis(REDIS_URL);

/**
 * Надсилає оновлення статусу на канал
 */
const publishUpdate = (data) => {
    // Всі дані задачі та прогресу
    publisher.publish(CHANNEL, JSON.stringify(data));
};

module.exports = {
    publisher,
    subscriber,
    CHANNEL,
    publishUpdate,
};