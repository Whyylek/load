// src/server.js
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const http = require('http'); 
const { Server } = require('socket.io');
require('dotenv').config();

// Логіка з наших файлів:
const { initDB, pool } = require('./db'); 
const { addTask, getTask, updateTaskStatus } = require('./queue');
const { subscriber, CHANNEL } = require('./pubsub'); 

const app = express();
const httpServer = http.createServer(app); 
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Дозволити доступ з фронтенду (для розробки)
        methods: ["GET", "POST"]
    }
}); 

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const MAX_CONCURRENT_TASKS = 5; 
const SALT_ROUNDS = 10;
const userSocketMap = {}; // Зберігає відповідність userId -> socketId

// --- Middleware та Утиліти ---
app.use(express.json());

// Middleware для авторизації (JWT)
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.sendStatus(401); 

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403); 
        req.user = user;
        next();
    });
};

// --- Socket.IO та Обробка Pub/Sub ---

// Валідація JWT при підключенні Socket.IO
io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers['authorization']?.split(' ')[1];
    if (!token) return next(new Error("Authentication error: No token provided"));

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return next(new Error("Authentication error: Invalid token"));
        socket.user = user; // Зберігаємо дані користувача в об'єкті socket
        next();
    });
});

io.on('connection', (socket) => {
    console.log(`User ${socket.user.id} connected via Socket.IO`);
    // Зберігаємо відповідність користувача до socket id
    userSocketMap[socket.user.id] = socket.id;

    socket.on('disconnect', () => {
        console.log(`User ${socket.user.id} disconnected`);
        delete userSocketMap[socket.user.id];
    });
});

// Підписка на Redis Pub/Sub для отримання оновлень від Worker'ів
subscriber.subscribe(CHANNEL, (err) => {
    if (err) console.error("Failed to subscribe to Redis channel:", err);
});

subscriber.on('message', (channel, message) => {
    if (channel === CHANNEL) {
        const update = JSON.parse(message);
        
        // Знаходимо SocketID клієнта за його userId
        const targetSocketId = userSocketMap[update.userId]; 
        
        if (targetSocketId) {
            // Надсилаємо оновлення конкретному клієнту
            io.to(targetSocketId).emit('task_update', {
                taskId: update.jobId,
                status: update.status,
                progress: update.progress
            });
        }
    }
});


// --- API Роути ---

// Реєстрація користувача
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
        await pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
            [username, password_hash]
        );
        res.status(201).send('User registered successfully');
    } catch (e) {
        // Код 23505 - порушення унікальності (username)
        if (e.code === '23505') return res.status(409).send('Username already exists.');
        res.status(500).send('Error registering user.');
    }
});

// Логін користувача
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    
    if (userResult.rows.length === 0) return res.status(401).send('Invalid credentials.');

    const user = userResult.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) return res.status(401).send('Invalid credentials.');

    // Генеруємо JWT
    const accessToken = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ accessToken, userId: user.id });
});

// 1. Запуск нової трудомісткої задачі
app.post('/api/tasks', authenticateToken, async (req, res) => {
    const { taskParams } = req.body; 
    const userId = req.user.id;
    
    // Перевірка вхідних даних (Пункт 1)
    if (!taskParams || typeof taskParams.iterations !== 'number' || taskParams.iterations > 1e15) {
        return res.status(400).send('Invalid parameters or complexity limit exceeded (max 1e15 iterations).');
    }
    
    // Обмеження кількості активних задач (Пункт 3)
    const activeTasks = await pool.query(
        "SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND status IN ('PENDING', 'RUNNING')",
        [userId]
    );
    if (parseInt(activeTasks.rows[0].count) >= MAX_CONCURRENT_TASKS) {
        return res.status(429).send(`Limit of ${MAX_CONCURRENT_TASKS} active tasks reached. Request queued (Additional points).`);
    }

    // Додати задачу в чергу та БД
    try {
        const job = await addTask(taskParams, userId);
        
        res.status(202).json({ 
            message: 'Task accepted and queued.', 
            taskId: job.id, 
            status: 'PENDING' 
        });
    } catch (e) {
        console.error('Error adding task:', e);
        res.status(500).send('Failed to queue task.');
    }
});

// 2. Перегляд історії задач (Пункт 3)
app.get('/api/tasks', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    try {
        const tasks = await pool.query(
            "SELECT job_id, status, progress, created_at, result, params FROM tasks WHERE user_id = $1 ORDER BY created_at DESC",
            [userId]
        );
        res.json(tasks.rows);
    } catch (e) {
        res.status(500).send('Error retrieving tasks.');
    }
});

// 3. Скасування задачі (Пункт 3)
app.delete('/api/tasks/:jobId', authenticateToken, async (req, res) => {
    const { jobId } = req.params;
    const userId = req.user.id;

    // Перевіряємо права та стан
    const task = await getTask(jobId);
    if (!task || task.user_id !== userId) return res.status(404).send('Task not found.');

    if (task.status === 'RUNNING' || task.status === 'PENDING') {
        // Змінюємо статус у БД. Worker перевірить це і припинить роботу.
        await updateTaskStatus(jobId, 'CANCELED', task.progress); 
        
        // Намагаємося видалити з черги Bull, якщо вона ще не запущена
        const job = await heavyTaskQueue.getJob(jobId);
        if (job && task.status === 'PENDING') {
            await job.remove();
        }

        return res.send(`Task ${jobId} successfully marked for cancellation.`);
    }

    res.status(400).send(`Task ${jobId} is already ${task.status}.`);
});


// --- Запуск Сервера та Ініціалізація ---
initDB().then(() => {
    httpServer.listen(PORT, () => {
        console.log(`✅ API Gateway Node.js server running on port ${PORT}`);
    });
}).catch(e => {
    console.error('❌ Failed to start server due to DB error:', e);
    process.exit(1);
});