require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

// Подключение к PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect((err) => {
    if (err) {
        console.error('Ошибка подключения к базе:', err.stack);
    } else {
        console.log('Подключено к PostgreSQL');
    }
});

// Настройка транспорта для отправки почты
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// Эндпоинт для регистрации
app.post('/register', async (req, res) => {
    const { username, password, email } = req.body;
    if (!username || !password || !email) {
        return res.status(400).json({ error: 'Username, password, and email are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        const userResult = await pool.query(
            'INSERT INTO users (username, password, email, confirmed) VALUES ($1, $2, $3, $4) RETURNING id',
            [username, hashedPassword, email, false]
        );

        const userId = userResult.rows[0].id;
        const token = uuidv4();

        await pool.query(
            'INSERT INTO email_confirmations (user_id, token) VALUES ($1, $2)',
            [userId, token]
        );

        const confirmationUrl = `https://mmorpg-auth-server.onrender.com/confirm?token=${token}`;

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Confirm your registration',
            text: `Please confirm your registration by clicking the following link: ${confirmationUrl}`
        });

        res.status(201).json({ message: 'User registered successfully. Please check your email to confirm!' });

    } catch (error) {
        console.error('Registration error:', error);

        if (error.code === '23505') {
            res.status(409).json({ error: 'Username or email already exists' });
        } else {
            res.status(500).json({ error: 'Registration failed', details: error.message });
        }
    }
});

// Эндпоинт для подтверждения почты
app.get('/confirm', async (req, res) => {
    const token = req.query.token;

    if (!token) {
        return res.status(400).send('Token is required');
    }

    try {
        const tokenResult = await pool.query(
            'SELECT user_id FROM email_confirmations WHERE token = $1',
            [token]
        );

        if (tokenResult.rows.length === 0) {
            return res.status(400).send('Invalid or expired token');
        }

        const userId = tokenResult.rows[0].user_id;

        await pool.query('UPDATE users SET confirmed = TRUE WHERE id = $1', [userId]);
        await pool.query('DELETE FROM email_confirmations WHERE user_id = $1', [userId]);

        res.status(200).send('Email confirmed successfully! You can now log in.');
    } catch (error) {
        console.error('Confirmation error:', error);
        res.status(500).send('Server error during confirmation');
    }
});

// Эндпоинт для логина
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

        if (!user.confirmed) {
            return res.status(403).json({ error: 'Please confirm your email before logging in' });
        }

        const isValid = await bcrypt.compare(password, user.password);

        if (!isValid) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        res.status(200).json({
            message: 'Login successful',
            player_id: user.id.toString()
        });

    } catch (error) {
        res.status(500).json({ error: 'Login failed', details: error.message });
    }
});

// Эндпоинт для сохранения персонажа
app.post('/api/character', async (req, res) => {
    const { player_id, character_name, character_class, character_appearance, hair_color, hair_style, eye_color, skin_color, height, body_type } = req.body;

    if (!player_id || !character_name || !character_class || !character_appearance || !hair_color || !hair_style || !eye_color || !skin_color || !height || !body_type) {
        return res.status(400).json({ error: 'All character fields are required' });
    }

    try {
        await pool.query(
            'INSERT INTO game.characters (player_id, character_name, character_class, character_appearance, hair_color, hair_style, eye_color, skin_color, height, body_type) ' +
            'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ' +
            'ON CONFLICT (player_id) DO UPDATE ' +
            'SET character_name = $2, character_class = $3, character_appearance = $4, hair_color = $5, hair_style = $6, eye_color = $7, skin_color = $8, height = $9, body_type = $10',
            [player_id, character_name, character_class, character_appearance, hair_color, hair_style, eye_color, skin_color, height, body_type]
        );

        res.status(200).json({ message: 'Character saved successfully' });
    } catch (error) {
        console.error('Error saving character:', error);
        res.status(500).json({ error: 'Failed to save character', details: error.message });
    }
});

// Эндпоинт для загрузки персонажа
app.get('/api/character', async (req, res) => {
    const playerId = req.query.player_id;

    if (!playerId) {
        return res.status(400).json({ error: 'player_id is required' });
    }

    try {
        const result = await pool.query('SELECT * FROM game.characters WHERE player_id = $1', [playerId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Character not found' });
        }

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Error loading character:', error);
        res.status(500).json({ error: 'Failed to load character', details: error.message });
    }
});

// Эндпоинт для отправки сообщений в чат
app.post('/api/chat', async (req, res) => {
    const { player_id, message } = req.body;

    if (!player_id || !message) {
        return res.status(400).json({ error: 'player_id and message are required' });
    }

    try {
        // Найдём персонажа, чтобы взять его имя
        const characterResult = await pool.query('SELECT character_name FROM game.characters WHERE player_id = $1', [player_id]);

        if (characterResult.rows.length === 0) {
            return res.status(404).json({ error: 'Character not found' });
        }

        const senderName = characterResult.rows[0].character_name;

        // Сохраняем сообщение в базу
        const messageResult = await pool.query(
            'INSERT INTO game.chat_messages (player_id, sender_name, message) VALUES ($1, $2, $3) RETURNING message_id, timestamp',
            [player_id, senderName, message]
        );

        const newMessage = {
            message_id: messageResult.rows[0].message_id,
            player_id,
            sender_name: senderName,
            message,
            timestamp: messageResult.rows[0].timestamp
        };

        res.status(200).json(newMessage);
    } catch (error) {
        console.error('Error saving chat message:', error);
        res.status(500).json({ error: 'Failed to save chat message', details: error.message });
    }
});

// Эндпоинт для получения сообщений чата
app.get('/api/chat', async (req, res) => {
    const { player_id } = req.query;

    if (!player_id) {
        return res.status(400).json({ error: 'player_id is required' });
    }

    try {
        // Получаем последние 50 сообщений (для оптимизации)
        const messagesResult = await pool.query(
            'SELECT message_id, player_id, sender_name, message, timestamp FROM game.chat_messages ORDER BY timestamp DESC LIMIT 50'
        );

        res.status(200).json({ messages: messagesResult.rows });
    } catch (error) {
        console.error('Error loading chat messages:', error);
        res.status(500).json({ error: 'Failed to load chat messages', details: error.message });
    }
});

// Эндпоинт для проверки активности сервера
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});