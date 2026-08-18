const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '../logs/proses.log');

// Fungsi aslimu (tetap dipertahankan)
function tulisLog(nik, nama, status, pesanError, url) {
    const waktu = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const logLine = `[${waktu}] NIK: ${nik} | Nama: ${nama} | Status: ${status} | Pesan: ${pesanError} | URL: ${url}\n`;
    
    if (!fs.existsSync(path.dirname(logPath))) fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, logLine, 'utf8');
    console.log(logLine.trim());
}

// Tambahan fungsi info() yang dicari oleh main.js
function info(pesan) {
    const waktu = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const logLine = `[${waktu}] [INFO] ${pesan}\n`;
    
    if (!fs.existsSync(path.dirname(logPath))) fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, logLine, 'utf8');
    console.log(logLine.trim());
}

// Tambahan fungsi error() yang dicari oleh main.js
function error(pesan) {
    const waktu = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const logLine = `[${waktu}] [ERROR] ${pesan}\n`;
    
    if (!fs.existsSync(path.dirname(logPath))) fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, logLine, 'utf8');
    console.error(logLine.trim());
}

// Export semua fungsinya agar bisa dibaca dari luar
module.exports = { tulisLog, info, error };