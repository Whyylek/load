
const API_BASE_URL = 'http://localhost:80'; 


let jwtToken = null;
let socket = null;


const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');


const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const taskForm = document.getElementById('task-form');


const authMessage = document.getElementById('auth-message');
const taskMessage = document.getElementById('task-message');
const welcomeMessage = document.getElementById('welcome-message');


const logoutButton = document.getElementById('logout-button');
const refreshTasksButton = document.getElementById('refresh-tasks-button');

const taskTableBody = document.getElementById('task-table-body');


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
        
       
        showApp(data.accessToken, username);

    } catch (err) {
        setAuthMessage(err.message, false);
    }
});


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
        
        showApp(data.accessToken, username);

    } catch (err) {
        setAuthMessage(err.message, false);
    }
});


logoutButton.addEventListener('click', () => {
    jwtToken = null;
    localStorage.removeItem('jwtToken');
    localStorage.removeItem('username');
    
    
    authContainer.style.display = 'block';
    appContainer.style.display = 'none';
    setAuthMessage('Ви успішно вийшли.', true);

    
    if (socket) {
        socket.disconnect();
        socket = null;
    }
});


function showApp(token, username) {
    jwtToken = token;
    localStorage.setItem('jwtToken', token);
    localStorage.setItem('username', username);

    welcomeMessage.textContent = `Вітаємо, ${username}!`;
    
    authContainer.style.display = 'none';
    appContainer.style.display = 'block';
    
    
    connectSocket();
    fetchTasks();
}


function setAuthMessage(message, isSuccess) {
    authMessage.textContent = message;
    authMessage.className = isSuccess ? 'message success' : 'message error';
}


function setTaskMessage(message, isSuccess) {
    taskMessage.textContent = message;
    taskMessage.className = isSuccess ? 'message success' : 'message error';
}



function connectSocket() {
    if (socket) {
        socket.disconnect();
    }

  
    socket = io(API_BASE_URL, {
        query: { token: jwtToken },
        path: '/socket.io/' 
    });

    socket.on('connect', () => {
        console.log('✅ [Socket.IO] Успішно підключено до сервера.');
    });

   
    socket.on('task_update', (task) => {
        console.log('[Socket.IO] Отримано оновлення:', task);
        
        updateTaskRow(task);
    });

    socket.on('disconnect', () => {
        console.log('🔌 [Socket.IO] Відключено від сервера.');
    });

    socket.on('connect_error', (err) => {
        console.error('❌ [Socket.IO] Помилка підключення:', err.message);
        
        if (err.message.includes('Invalid token')) {
            handleLogout();
            setAuthMessage('Сесія закінчилася. Будь ласка, увійдіть знову.', false);
        }
    });
}


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
        
     
        fetchTasks();

    } catch (err) {
        setTaskMessage(err.message, false);
    }
});


refreshTasksButton.addEventListener('click', fetchTasks);


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


async function handleCancelTask(taskId) {
    try {
        const res = await fetch(`${API_BASE_URL}/api/tasks/${taskId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${jwtToken}` }
        });

        if (!res.ok) throw new Error('Помилка скасування');

       
        setTaskMessage(`Завдання ${taskId} скасовано.`, true);

    } catch (err) {
        setTaskMessage(err.message, false);
    }
}


function renderTaskList(tasks) {
    taskTableBody.innerHTML = ''; 
    tasks.forEach(task => {
        const row = createTaskRowElement(task);
        taskTableBody.appendChild(row);
    });
}


function updateTaskRow(task) {
    const existingRow = document.getElementById(`task-${task.taskId}`);
    if (existingRow) {
        
        const newRow = createTaskRowElement(task);
        existingRow.innerHTML = newRow.innerHTML; 
    } else {
        
        const newRow = createTaskRowElement(task);
        taskTableBody.prepend(newRow); 
    }
}


function createTaskRowElement(task) {
    const row = document.createElement('tr');
    row.id = `task-${task.taskId}`;

    
    const idCell = document.createElement('td');
    idCell.textContent = task.taskId;
    
  
    const statusCell = document.createElement('td');
    statusCell.textContent = task.status;
    statusCell.className = `status-${task.status.toLowerCase()}`;
    
  
    const progressCell = document.createElement('td');
    const progressBarContainer = document.createElement('div');
    progressBarContainer.className = 'progress-bar-container';
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    progressBar.style.width = `${task.progress || 0}%`;
    progressBar.textContent = `${task.progress || 0}%`;
    progressBarContainer.appendChild(progressBar);
    progressCell.appendChild(progressBarContainer);

  
    const resultCell = document.createElement('td');
    if (task.status === 'COMPLETED' && task.result) {
        resultCell.textContent = task.result.piEstimate ? `Π ≈ ${task.result.piEstimate}` : JSON.stringify(task.result);
    } else if (task.status === 'FAILED' && task.result) {
        resultCell.textContent = task.result.error || 'Помилка';
    } else {
        resultCell.textContent = '...';
    }
    
 
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


document.addEventListener('DOMContentLoaded', () => {
    
    const token = localStorage.getItem('jwtToken');
    const username = localStorage.getItem('username');
    if (token && username) {
        console.log('Знайдено збережену сесію.');
        showApp(token, username);
    } else {
        console.log('Сесія не знайдена, показуємо екран логіну.');
    }
});