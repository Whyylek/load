// app.js

// --- 1. Глобальні налаштування та змінні ---

// URL нашого Nginx-балансувальника
const API_BASE_URL = 'http://localhost:80'; 

// Змінні для зберігання стану
let jwtToken = null;
let socket = null;

// --- 2. Отримання DOM-елементів ---
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');

// Форми
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const taskForm = document.getElementById('task-form');

// Повідомлення
const authMessage = document.getElementById('auth-message');
const taskMessage = document.getElementById('task-message');
const welcomeMessage = document.getElementById('welcome-message');

// Кнопки
const logoutButton = document.getElementById('logout-button');
const refreshTasksButton = document.getElementById('refresh-tasks-button');

// Таблиця завдань
const taskTableBody = document.getElementById('task-table-body');

// --- 3. Логіка Автентифікації ---

// Обробник Реєстрації
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    
    try {
        const res = await fetch(`${API_BASE_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(errorText || 'Помилка реєстрації');
        }

        const data = await res.json();
        setAuthMessage('Реєстрація успішна! Входимо...', true);
        
        // Автоматично логінимо користувача після успішної реєстрації
        showApp(data.accessToken, username);

    } catch (err) {
        setAuthMessage(err.message, false);
    }
});

// Обробник Логіну
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    
    try {
        const res = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(errorText || 'Помилка входу');
        }

        const data = await res.json();
        // Успішний вхід
        showApp(data.accessToken, username);

    } catch (err) {
        setAuthMessage(err.message, false);
    }
});

// Обробник Виходу
logoutButton.addEventListener('click', () => {
    jwtToken = null;
    localStorage.removeItem('jwtToken');
    localStorage.removeItem('username');
    
    // Приховуємо додаток, показуємо екран логіну
    authContainer.style.display = 'block';
    appContainer.style.display = 'none';
    setAuthMessage('Ви успішно вийшли.', true);

    // Від'єднуємо Socket.IO
    if (socket) {
        socket.disconnect();
        socket = null;
    }
});

// Допоміжна функція для показу/приховування екранів
function showApp(token, username) {
    jwtToken = token;
    localStorage.setItem('jwtToken', token);
    localStorage.setItem('username', username);

    welcomeMessage.textContent = `Вітаємо, ${username}!`;
    
    authContainer.style.display = 'none';
    appContainer.style.display = 'block';
    
    // Підключаємо Socket.IO та завантажуємо історію завдань
    connectSocket();
    fetchTasks();
}

// Встановлює повідомлення про помилку/успіх на формі логіну
function setAuthMessage(message, isSuccess) {
    authMessage.textContent = message;
    authMessage.className = isSuccess ? 'message success' : 'message error';
}

// Встановлює повідомлення на формі завдань
function setTaskMessage(message, isSuccess) {
    taskMessage.textContent = message;
    taskMessage.className = isSuccess ? 'message success' : 'message error';
}

// --- 4. Логіка Socket.IO (Пункт 2) ---

function connectSocket() {
    if (socket) {
        socket.disconnect();
    }

    // Підключаємось до нашого Nginx (порт 80)
    // Передаємо токен для автентифікації
    // Вказуємо 'path' відповідно до nginx.conf
    socket = io(API_BASE_URL, {
        query: { token: jwtToken },
        path: '/socket.io/' 
    });

    socket.on('connect', () => {
        console.log('✅ [Socket.IO] Успішно підключено до сервера.');
    });

    // Головний обробник оновлень (Пункт 2)
    socket.on('task_update', (task) => {
        console.log('[Socket.IO] Отримано оновлення:', task);
        // Оновлюємо рядок таблиці на основі даних з сокету
        updateTaskRow(task);
    });

    socket.on('disconnect', () => {
        console.log('🔌 [Socket.IO] Відключено від сервера.');
    });

    socket.on('connect_error', (err) => {
        console.error('❌ [Socket.IO] Помилка підключення:', err.message);
        // Якщо токен застарів, вимагаємо повторного логіну
        if (err.message.includes('Invalid token')) {
            handleLogout();
            setAuthMessage('Сесія закінчилася. Будь ласка, увійдіть знову.', false);
        }
    });
}

// --- 5. Логіка Роботи із Завданнями (Пункт 1, 3) ---

// Обробник створення нового завдання
taskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const iterations = document.getElementById('iterations').value;
    
    try {
        const res = await fetch(`${API_BASE_URL}/api/tasks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${jwtToken}`
            },
            body: JSON.stringify({ taskParams: { iterations: parseInt(iterations) } })
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(errorText || 'Помилка створення завдання');
        }

        const data = await res.json();
        setTaskMessage(`Завдання ${data.taskId} прийнято.`, true);
        
        // Оновлюємо список, щоб побачити нове "PENDING" завдання
        fetchTasks();

    } catch (err) {
        setTaskMessage(err.message, false);
    }
});

// Кнопка оновлення списку завдань
refreshTasksButton.addEventListener('click', fetchTasks);

// Завантажити історію завдань з сервера
async function fetchTasks() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/tasks`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${jwtToken}` }
        });

        if (!res.ok) throw new Error('Не вдалося завантажити історію');
        
        const tasks = await res.json();
        renderTaskList(tasks);
    } catch (err) {
        setTaskMessage(err.message, false);
    }
}

// Обробник скасування завдання
async function handleCancelTask(taskId) {
    try {
        const res = await fetch(`${API_BASE_URL}/api/tasks/${taskId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${jwtToken}` }
        });

        if (!res.ok) throw new Error('Помилка скасування');

        // Оновлення не потрібне, оскільки ми очікуємо 'task_update'
        // через Socket.IO, який оновить статус на 'CANCELED'
        setTaskMessage(`Завдання ${taskId} скасовано.`, true);

    } catch (err) {
        setTaskMessage(err.message, false);
    }
}

// --- 6. Рендеринг (Відображення) ---

// Оновлює всю таблицю
function renderTaskList(tasks) {
    taskTableBody.innerHTML = ''; // Очищуємо таблицю
    tasks.forEach(task => {
        const row = createTaskRowElement(task);
        taskTableBody.appendChild(row);
    });
}

// Оновлює (або створює) ОДИН рядок (викликається з Socket.IO)
function updateTaskRow(task) {
    const existingRow = document.getElementById(`task-${task.taskId}`);
    if (existingRow) {
        // Якщо рядок є, оновлюємо його
        const newRow = createTaskRowElement(task);
        existingRow.innerHTML = newRow.innerHTML; // Замінюємо вміст
    } else {
        // Якщо рядка немає (нове завдання), створюємо і додаємо зверху
        const newRow = createTaskRowElement(task);
        taskTableBody.prepend(newRow); // Додаємо на початок
    }
}

// Створює HTML-елемент <tr> для одного завдання
function createTaskRowElement(task) {
    const row = document.createElement('tr');
    row.id = `task-${task.taskId}`; // Унікальний ID для рядка

    // 1. ID Завдання
    const idCell = document.createElement('td');
    idCell.textContent = task.taskId;
    
    // 2. Статус (з CSS-класом)
    const statusCell = document.createElement('td');
    statusCell.textContent = task.status;
    statusCell.className = `status-${task.status.toLowerCase()}`;
    
    // 3. Прогрес (Progress Bar)
    const progressCell = document.createElement('td');
    const progressBarContainer = document.createElement('div');
    progressBarContainer.className = 'progress-bar-container';
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    progressBar.style.width = `${task.progress || 0}%`;
    progressBar.textContent = `${task.progress || 0}%`;
    progressBarContainer.appendChild(progressBar);
    progressCell.appendChild(progressBarContainer);

    // 4. Результат
    const resultCell = document.createElement('td');
    if (task.status === 'COMPLETED' && task.result) {
        resultCell.textContent = task.result.piEstimate ? `Π ≈ ${task.result.piEstimate}` : JSON.stringify(task.result);
    } else if (task.status === 'FAILED' && task.result) {
        resultCell.textContent = task.result.error || 'Помилка';
    } else {
        resultCell.textContent = '...';
    }
    
    // 5. Кнопка Скасування
    const actionCell = document.createElement('td');
    if (task.status === 'PENDING' || task.status === 'RUNNING') {
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Скасувати';
        cancelButton.className = 'cancel-btn';
        cancelButton.onclick = () => handleCancelTask(task.taskId);
        actionCell.appendChild(cancelButton);
    }

    row.append(idCell, statusCell, progressCell, resultCell, actionCell);
    return row;
}

// --- 7. Запуск при завантаженні сторінки ---
document.addEventListener('DOMContentLoaded', () => {
    // Перевіряємо, чи є збережений токен
    const token = localStorage.getItem('jwtToken');
    const username = localStorage.getItem('username');
    if (token && username) {
        console.log('Знайдено збережену сесію.');
        showApp(token, username);
    } else {
        console.log('Сесія не знайдена, показуємо екран логіну.');
    }
});