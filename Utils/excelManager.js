const xlsx = require('xlsx');

// Fungsi untuk membaca Excel dan mengubahnya menjadi format JSON yang dimengerti robot
function readExcel(filePath) {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    // defval: "" memastikan sel kosong di Excel tidak membuat robot error
    return xlsx.utils.sheet_to_json(sheet, { defval: "" }); 
}

// (Opsional) Fungsi untuk menulis ulang log ke Excel jika dibutuhkan nanti
function writeExcel(data, filePath) {
    const newWorkbook = xlsx.utils.book_new();
    const newSheet = xlsx.utils.json_to_sheet(data);
    xlsx.utils.book_append_sheet(newWorkbook, newSheet, 'Data Log');
    xlsx.writeFile(newWorkbook, filePath);
}

// Wajib diexport agar bisa dipanggil di ckgsekolahfull.js
module.exports = { readExcel, writeExcel };