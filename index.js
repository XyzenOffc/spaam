const crypto = require("crypto");
const fetch = require("node-fetch");
const TelegramBot = require("node-telegram-bot-api");
const sqlite3 = require("sqlite3").verbose();

// Inisialisasi bot
const token = '7361099428:AAHsbnKKUK_aYNsPZNX4BqMLPg3su79JG90'; // Ganti dengan token bot Anda
const bot = new TelegramBot(token, { polling: true });

// Inisialisasi database SQLite
const db = new sqlite3.Database('./users.db', (err) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log('Connected to the users database.');
    }
});

// Buat tabel untuk menyimpan data pengguna
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL UNIQUE,
    username TEXT,
    role TEXT DEFAULT 'user', -- 'admin' atau 'user'
    spam_count INTEGER DEFAULT 0 -- Jumlah spam yang dilakukan
)`);

// Array untuk menyimpan sesi spam
let spamSessions = [];
let currentSessionId = 1;

// Fungsi untuk mengirim pesan (tidak berubah)
const sendMessage = async (username, message, chatId, sessionId) => {
    let counter = 0;
    while (spamSessions[sessionId - 1]?.isActive) {
        try {
            const deviceId = crypto.randomBytes(21).toString("hex");
            const url = "https://ngl.link/api/submit";
            const headers = { /* sama seperti sebelumnya */ };
            const body = `username=${username}&question=${message}&deviceId=${deviceId}&gameSlug=&referrer=`;

            const response = await fetch(url, {
                method: "POST",
                headers,
                body,
                mode: "cors",
                credentials: "include"
            });

            if (response.status !== 200) {
                console.log(`[Error] Rate-limited, waiting 5 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            } else {
                counter++;
                console.log(`[Msg] Session ${sessionId}: Sent ${counter} messages.`);
                bot.sendMessage(chatId, `Session ${sessionId}: Sent ${counter} messages.`);
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.error(`[Error] ${error}`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
};

// Perintah /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    // Cek apakah pengguna sudah terdaftar
    db.get(`SELECT * FROM users WHERE telegram_id = ?`, [telegramId], (err, row) => {
        if (err) {
            console.error(err.message);
        } else if (!row) {
            // Jika belum terdaftar, tambahkan ke database
            db.run(`INSERT INTO users (telegram_id, username, role) VALUES (?, ?, ?)`, 
                [telegramId, msg.from.username || 'unknown', 'user'], 
                (err) => {
                    if (err) {
                        console.error(err.message);
                    } else {
                        bot.sendMessage(chatId, "Anda berhasil terdaftar sebagai pengguna biasa. Ketik /help untuk melihat opsi.");
                    }
                }
            );
        } else {
            bot.sendMessage(chatId, "Selamat datang kembali! Ketik /help untuk melihat opsi.");
        }
    });
});

// Perintah untuk memulai spam
bot.onText(/\/spam/, (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    db.get(`SELECT * FROM users WHERE telegram_id = ?`, [telegramId], (err, row) => {
        if (err) {
            console.error(err.message);
        } else if (!row) {
            bot.sendMessage(chatId, "Anda belum terdaftar. Ketik /start untuk mendaftar.");
        } else if (row.role !== 'admin' && row.spam_count >= 3) {
            bot.sendMessage(chatId, "Batas spam Anda telah tercapai. Hubungi admin untuk akses lebih lanjut.");
        } else {
            bot.sendMessage(chatId, "Masukkan username:");
            bot.once("message", (msg) => {
                const username = msg.text;
                bot.sendMessage(chatId, "Masukkan pesan:");
                bot.once("message", (msg) => {
                    const message = msg.text;
                    spamSessions.push({ id: currentSessionId, username, message, isActive: true });
                    sendMessage(username, message, chatId, currentSessionId);

                    bot.sendMessage(chatId, `Spam session ${currentSessionId} dimulai!`);
                    currentSessionId++;

                    // Tambahkan hitungan spam pengguna jika bukan admin
                    if (row.role !== 'admin') {
                        db.run(`UPDATE users SET spam_count = spam_count + 1 WHERE telegram_id = ?`, [telegramId]);
                    }
                });
            });
        }
    });
});

// Perintah untuk mempromosikan admin
bot.onText(/\/promote (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    // Pastikan hanya admin yang bisa mempromosikan pengguna lain
    db.get(`SELECT * FROM users WHERE telegram_id = ?`, [telegramId], (err, row) => {
        if (err) {
            console.error(err.message);
        } else if (row && row.role === 'admin') {
            const targetUsername = match[1];
            db.run(`UPDATE users SET role = 'admin' WHERE username = ?`, [targetUsername], function (err) {
                if (err) {
                    console.error(err.message);
                } else if (this.changes > 0) {
                    bot.sendMessage(chatId, `${targetUsername} telah dipromosikan menjadi admin.`);
                } else {
                    bot.sendMessage(chatId, `Pengguna ${targetUsername} tidak ditemukan.`);
                }
            });
        } else {
            bot.sendMessage(chatId, "Hanya admin yang dapat menggunakan perintah ini.");
        }
    });
});
