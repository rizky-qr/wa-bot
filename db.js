const mysql = require('mysql2');

// Konfigurasi koneksi database
const pool = mysql.createPool({
    host: 'localhost',        // Ganti dengan host database kamu
    user: 'root',             // Ganti dengan username database kamu
    password: '',             // Ganti dengan password database kamu
    database: 'db_wabot',  // Ganti dengan nama database kamu
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Gunakan promise untuk mempermudah query
const promisePool = pool.promise();

module.exports = promisePool;
