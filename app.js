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
        // console.log(userID);
        // const client = new Client({
        //     authStrategy: new LocalAuth({ clientId: userID })
        // });
        // client.on('ready', () => {
        //     console.log(`Client ${userID} is ready!`);
        //     socket.emit('status', `Client ${userID} is ready!`);
        //     socket.emit('user', `Yes Active session found for user ${userID}`);
        // });
        console.log(clients);
        const client = clients.get(userID);
        if (client) {
            console.log(`Yes Active session found for user ${userID}`);
            socket.emit('user', `Yes Active session found for user ${userID}`);
        } else {
            console.log(`No Active session found for user ${userID}`);
            socket.emit('user', `No active session found for user ${userID}`);
        }
    });
});


app.post('/send-message/:userID', upload.single('file'), async (req, res) => {
    const { userID } = req.params;
    const client = clients.get(userID);

    if (!client) {
        return res.status(400).json({ message: `No client found for user ${userID}` });
    }

    const { number, messageTemplate, json } = req.body;
    // const filePath = req.file ? req.file.path : null;
    const uploadedFile = req.file;
    const uploadedExcel = req.excel;
    const jsonData = JSON.parse(json)

    let filePath = null;

    if (uploadedFile) {
        // if (!['image/png', 'image/jpeg', 'video/mp4'].includes(req.file.mimetype)) {
        //     return res.status(400).json({ message: 'Invalid file format' });
        // }
        // Tambahkan ekstensi file asli ke file yang diunggah
        const fileExtension = path.extname(uploadedFile.originalname);
        filePath = `${uploadedFile.originalname}${fileExtension}`;
        fs.renameSync(uploadedFile.path, filePath);
    }

    // console.log(uploadedExcel);
    // console.log(number);
    // console.log(jsonData);
    // console.log(messageTemplate);
    // console.log(filePath);
    // console.log(uploadedFile);
    // process.exit(1);  // Menghentikan proses dengan status kesalahan

    let results = [];
    try {
        // Gunakan for...of untuk iterasi sinkron
        for (const data of jsonData) {
            const whatsapp = data[number]; // Ambil nomor telepon berdasarkan kolom yang dipilih
            const chatID = `${whatsapp}@c.us`; // Format WhatsApp ID
            if (filePath && messageTemplate) {
                // Kondisi 1: Ada file dan teks
                const media = MessageMedia.fromFilePath(filePath);
                const chatWa = replacePlaceholders(messageTemplate, data);
                await client.sendMessage(chatID, media, { caption: chatWa });
                results.push(`File and text sent to ${whatsapp}`);
            } else if (messageTemplate) {
                // Kondisi 2: Hanya teks
                const chatWa = replacePlaceholders(messageTemplate, data);
                await client.sendMessage(chatID, chatWa);
                results.push(`Text sent to ${whatsapp}`);
            } else if (filePath) {
                // Kondisi 3: Hanya file
                const media = MessageMedia.fromFilePath(filePath);
                await client.sendMessage(chatID, media);
                results.push(`File sent to ${whatsapp}`);
            } else {
                results.push(`No content to send for ${whatsapp}`);
            }
            // Tambahkan delay setelah setiap pengiriman pesan
            await delay(angka(5000, 10000));
        }

        console.log(results); // Menampilkan hasil dari semua pengiriman pesan
        res.json({ message: 'Messages processed.', results });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to send messages', error: error.message });
    } finally {
        // Delete the uploaded file after sending if it exists
        if (filePath) {
            delateFile(filePath);
        }
    }

});

server.listen(3000, () => {
    console.log('Server started on http://localhost:3000');
});
