
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const http = require('http'); 
const { Server } = require('socket.io');
const cors = require('cors'); 
require('dotenv').config();


const { initDB, pool } = require('./db'); 
const { addTask, getTask, updateTaskStatus, heavyTaskQueue } = require('./queue'); 


const { progressSubscriber, CHANNEL, publisher, CANCEL_CHANNEL, publishUpdate } = require('./pubsub'); 

const app = express();
const httpServer = http.createServer(app); 


app.use(cors());

const io = new Server(httpServer, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST", "DELETE"]
    },
    path: "/socket.io/", 
}); 

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const MAX_CONCURRENT_TASKS = 5; 
const SALT_ROUNDS = 10;
const userSocketMap = {}; 


app.use(express.json());


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

io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token) return next(new Error("Authentication error: No token provided"));

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return next(new Error("Authentication error: Invalid token"));
        socket.user = user; 
        next();
    });
});

io.on('connection', (socket) => {
    console.log(`[Socket.IO] User ${socket.user.id} connected via Socket.IO`);
    userSocketMap[socket.user.id] = socket.id;

    socket.on('disconnect', () => {
        console.log(`[Socket.IO] User ${socket.user.id} disconnected`);
        delete userSocketMap[socket.user.id];
    });
});


progressSubscriber.subscribe(CHANNEL, (err) => {
    if (err) console.error("Failed to subscribe to Redis channel:", err);
    else console.log(`✅ [PubSub] Subscribed to ${CHANNEL}`);
});


progressSubscriber.on('message', (channel, message) => {
    if (channel === CHANNEL) { 
        try {
            const update = JSON.parse(message);
            const targetSocketId = userSocketMap[update.userId]; 
            
            if (targetSocketId) {
                io.to(targetSocketId).emit('task_update', {
                    taskId: update.jobId,
                    status: update.status,
                    progress: update.progress,
                    result: update.result 
                });
            }
        } catch (e) {
            console.error('❌ Error processing PubSub message:', e);
        }
    }
});





app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
        
        const result = await pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
            [username, password_hash]
        );
        const userId = result.rows[0].id;
        
        const accessToken = jwt.sign({ id: userId, username: username }, JWT_SECRET, { expiresIn: '1h' });
        
        res.status(201).json({ 
            message: 'User registered successfully',
            userId: userId,
            accessToken: accessToken
        });
        
    } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT') {
             return res.status(409).send('Username already exists.');
        }
        console.error('❌ Error registering user:', e);
        res.status(500).send('Error registering user.');
    }
});


app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    
    if (userResult.rows.length === 0) return res.status(401).send('Invalid credentials.');

    const user = userResult.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) return res.status(401).send('Invalid credentials.');

    const accessToken = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ accessToken, userId: user.id });
});


app.post('/api/tasks', authenticateToken, async (req, res) => {
    const { taskParams } = req.body; 
    const userId = req.user.id;
    
    if (!taskParams || typeof taskParams.iterations !== 'number' || taskParams.iterations > 1e15) {
        return res.status(400).send('Invalid parameters or complexity limit exceeded (max 1e15 iterations).');
    }
    
    const activeTasks = await pool.query(
        "SELECT COUNT(*) as count FROM tasks WHERE user_id = $1 AND status IN ('PENDING', 'RUNNING')",
        [userId]
    );
    
    if (activeTasks.rows[0].count >= MAX_CONCURRENT_TASKS) {
        return res.status(429).send(`Limit of ${MAX_CONCURRENT_TASKS} active tasks reached.`);
    }

    try {
        const job = await addTask(taskParams, userId);
        
        res.status(202).json({ 
            message: 'Task accepted and queued.', 
            taskId: job.id, 
            status: 'PENDING' 
        });
    } catch (e) {
        console.error('❌ Error adding task:', e);
        res.status(500).send('Failed to queue task.');
    }
});


app.get('/api/tasks', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    try {
        const tasks = await pool.query(
            "SELECT job_id as taskId, status, progress, created_at, result, params FROM tasks WHERE user_id = $1 ORDER BY created_at DESC",
            [userId]
        );
        
        tasks.rows.forEach(task => {
            if (task.params) task.params = JSON.parse(task.params);
            if (task.result) task.result = JSON.parse(task.result);
        });

        res.json(tasks.rows);
    } catch (e) {
        console.error('❌ Error retrieving tasks:', e);
        res.status(500).send('Error retrieving tasks.');
    }
});

app.delete('/api/tasks/:jobId', authenticateToken, async (req, res) => {
    const { jobId } = req.params;
    const userId = req.user.id;

    console.log(`[SERVER] Отримано запит на скасування для jobId: ${jobId} (тип: ${typeof jobId})`); // <-- 1. ДОДАЙТЕ ЦЕЙ РЯДОК

    try {
        const task = await getTask(jobId);
        
        
        if (!task) {
             
             console.error(`❌ [SERVER] НЕ ЗНАЙШОВ завдання ${jobId} в БД! Перевірте, чи 'job_id' має тип TEXT і чи ви видалили hardwork.db.`);
             return res.status(404).send('Task not found in DB. Check server logs.');
        }

        if (task.user_id !== userId) {
            return res.status(404).send('Task not found.');
        }

        if (task.status === 'RUNNING' || task.status === 'PENDING') {
            
            
            await updateTaskStatus(jobId, 'CANCELED', task.progress, { status: 'Canceled by user' }); 
            
            
            const job = await heavyTaskQueue.getJob(jobId);
            if (job && task.status === 'PENDING') {
                await job.remove();
            }

           
            console.log(`[SERVER] ✅ Публікую команду скасування для ${jobId} в канал ${CANCEL_CHANNEL}`);
            await publisher.publish(CANCEL_CHANNEL, jobId);
            
            
            await publishUpdate({
                jobId: jobId,
                userId: userId,
                status: 'CANCELED',
                progress: task.progress, 
                result: { status: 'Canceled by user' }
            });

            return res.send(`Task ${jobId} successfully marked for cancellation.`);
        }

        res.status(400).send(`Task ${jobId} is already ${task.status}.`);
    } catch (e) {
        console.error('❌ Error cancelling task:', e);
        res.status(500).send('Error cancelling task.');
    }
});


initDB().then(() => {
    httpServer.listen(PORT, () => {
        console.log(`✅ API Gateway Node.js server (SQLite) running on port ${PORT}`);
    });
}).catch(e => {
    console.error('❌ Failed to start server due to DB init error:', e);
    process.exit(1);
});