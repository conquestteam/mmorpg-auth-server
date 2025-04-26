const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Подключение к PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Проверка подключения к базе
pool.connect((err) => {
    if (err) {
        console.error('Ошибка подключения к базе:', err.stack);
    } else {
        console.log('Подключено к PostgreSQL');
    }
});

// Эндпоинт для регистрации
app.post('/register', async (req, res) => {
    const { username, password, email } = req.body; // Добавили email
    if (!username || !password || !email) {
    return res.status(400).json({ error: 'Username, password, and email are required' });
}

	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (email && !emailRegex.test(email)) { // Проверяем, если email указан
        return res.status(400).json({ error: 'Invalid email format' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        // Вставляем пользователя в базу, включая email
        const result = await pool.query(
            'INSERT INTO users (username, password, email) VALUES ($1, $2, $3) RETURNING id',
            [username, hashedPassword, email] // email может быть null, если не указан
        );
        res.status(201).json({
            message: 'User registered successfully',
            userId: result.rows[0].id
        });
    } catch (error) {
        if (error.code === '23505') {
            res.status(409).json({ error: 'Username already exists' });
        } else {
            res.status(500).json({ error: 'Registration failed', details: error.message });
        }
    }
});

// Эндпоинт для логина (без изменений)
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }
        const user = result.rows[0];
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid password' });
        }
        res.status(200).json({
            message: 'Login successful',
            userId: user.id
        });
    } catch (error) {
        res.status(500).json({ error: 'Login failed', details: error.message });
    }
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});