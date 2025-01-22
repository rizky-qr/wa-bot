// app.js atau index.js
process.on('uncaughtException', (err) => {
    console.error('Unhandled Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});


const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const QRCode = require('qrcode');
const http = require('http');
const socketIo = require('socket.io');

const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const db = require('./db'); // Impor koneksi database

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const clients = new Map();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function angka(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function delateFile(path, retries = 5, delay = 20000) {
    // Menghapus file sesi lainnya
    fs.unlink(path, (err) => {
        if (err) {
            if (err.code === 'EBUSY' && retries > 0) {
                console.log(`File busy, retrying in ${delay}ms...`);
                setTimeout(() => delateFile(path, retries - 1, delay), delay);
            } else if (err.code === 'EPERM' && retries > 0) {
                console.log(`Permission issue, retrying in ${delay}ms...`);
                setTimeout(() => delateFile(path, retries - 1, delay), delay);
            } else {
                console.error('Error deleting file:', err.message);
            }
        } else {
            console.log('File deleted successfully');
        }
    });
}

// Fungsi untuk mengganti placeholder
function replacePlaceholders(template, data) {
    return template.replace(/{(.*?)}/g, (_, key) => data[key] || `{${key}}`);
}

const userSockets = new Map();
io.on('connection', (socket) => {
    console.log('New client connected');

    socket.on('register', (userID) => {
        if (!clients.has(userID)) {
            const client = new Client({
                authStrategy: new LocalAuth({ clientId: userID })
            });

            client.on('qr', (qr) => {
                const qrFilePath = `./public/qrcode-${userID}-${Date.now()}.png`;
                QRCode.toFile(qrFilePath, qr, { errorCorrectionLevel: 'H' }, (err) => {
                    if (err) {
                        console.error('Error generating QR code:', err);
                        return;
                    }
                    console.log(`QR Code generated for user ${userID}`);
                    socket.emit('qr', qrFilePath);
                });
            });

            client.on('ready', () => {
                console.log(`Client ${userID} is ready!`);
                socket.emit('status', `Client ${userID} is ready!`);
            });

            client.on('authenticated', () => {
                console.log(`Authenticated successfully for user ${userID}!`);
                socket.emit('status', `Authenticated successfully for user ${userID}!`);
            });

            client.on('auth_failure', msg => {
                console.error(`Authentication failed for user ${userID}:`, msg);
                socket.emit('status', `Authentication failed for user ${userID}!`);
            });

            client.on('disconnected', (reason) => {
                console.log(`Client ${userID} was logged out:`, reason);
                socket.emit('status', `Client ${userID} was logged out`);
                socket.emit('logout', userID);
                // Jika client terputus, coba untuk menginisialisasi ulang
                reconnectClient();
            });
            // Fungsi untuk mencoba login ulang dengan memunculkan QR code
            async function reconnectClient() {
                try {
                    console.log('Reconnecting client...');
                    // await client.initialize();  // Coba untuk inisialisasi ulang client
                } catch (error) {
                    console.error('Error reconnecting client:', error);
                }
            }

            // Inisialisasi client dan mulai menjalankan bot
            client.initialize().catch(err => console.log('Error during client initialization:', err));
            clients.set(userID, client);
        } else {
            console.log(`Client for user ${userID} already exists.`);
            socket.emit('status', `Client for user ${userID} already exists.`);
            // reconnectClient();
        }
    });

    socket.on('logout', (userID) => {
        console.log(userID);
        const client = clients.get(userID);
        if (client) {
            client.destroy();
            clients.delete(userID);
            const sessionDir = `./.wwebjs_auth/session-${userID}`;
            if (fs.existsSync(sessionDir)) {
                delateFile(sessionDir);
            }
        } else {
            socket.emit('status', `No active session found for user ${userID}`);
        }
    });

    socket.on('cek_user', (userID) => {
        const client = clients.get(userID);
        if (client) {
            userSockets.set(userID, socket);
            console.log(`Yes Active session found for user ${userID}`);
            socket.emit('user', `Yes Active session found for user ${userID}`);
        } else {
            console.log(`No Active session found for user ${userID}`);
            socket.emit('user', `No active session found for user ${userID}`);
            // const userID = [...userSockets.entries()].find(([_, s]) => s === socket)?.[0];
            // if (userID) {
            //     userSockets.delete(userID); // Hapus hubungan saat socket terputus
            //     console.log(`Socket disconnected for user: ${userID}`);
            // }
        }
    });
});

app.post('/send-message/:userID', upload.single('file'), async (req, res) => {
    const { userID } = req.params;
    const client = clients.get(userID);
    const userSocket = userSockets.get(userID); // Ambil socket berdasarkan userID

    if (!client) {
        return res.status(400).json({ message: `No client found for user ${userID}` });
    }

    const { number, messageTemplate, json } = req.body;
    // const filePath = req.file ? req.file.path : null;
    const uploadedFile = req.file;
    const uploadedExcel = req.excel;
    const jsonData = JSON.parse(json)


    try {
        const filePath = uploadedFile ? `${uploadedFile.originalname}${path.extname(uploadedFile.originalname)}` : null;
        const templateID = (messageTemplate || uploadedFile) ? (await db.query(
            'INSERT INTO message_templates (userID, template, file_name, file_path) VALUES (?, ?, ?, ?)',
            [userID, messageTemplate || '', uploadedFile?.originalname || null, uploadedFile ? filePath : null,
            ]))[0].insertId : null;


        let results = [];

        for (const data of jsonData) {
            const whatsapp = data[number];
            const chatID = `${whatsapp}@c.us`;
            let status = 'Success';

            try {
                if (filePath && messageTemplate) {
                    const media = MessageMedia.fromFilePath(filePath);
                    const chatWa = replacePlaceholders(messageTemplate, data);
                    await client.sendMessage(chatID, media, { caption: chatWa });
                } else if (messageTemplate) {
                    const chatWa = replacePlaceholders(messageTemplate, data);
                    await client.sendMessage(chatID, chatWa);
                } else if (filePath) {
                    const media = MessageMedia.fromFilePath(filePath);
                    await client.sendMessage(chatID, media);
                } else {
                    status = 'No content';
                }
            } catch (err) {
                console.error(`Failed to send to ${whatsapp}:`, err);
                status = 'Failed';
            }

            // Simpan riwayat pesan ke tabel `message_history`
            await db.query(
                'INSERT INTO message_history (userID, whatsapp, message, template_id, status, timestamp) VALUES (?, ?, ?, ?, ?, NOW())',
                [userID, whatsapp, messageTemplate || '', templateID, status]
            );

            results.push({ whatsapp, status });
            userSocket?.emit('alert', `${status} send to whatsapp : ${whatsapp}`);

            // Tambahkan delay setelah setiap pengiriman pesan
            await delay(angka(5000, 10000));
        }

        res.json({ message: 'Messages processed.', results });
    } catch (err) {
        console.error('Error processing messages:', err);
        res.status(500).json({ message: 'An error occurred.' });
    }

});

server.listen(3000, () => {
    console.log('Server started on http://localhost:3000');
});
