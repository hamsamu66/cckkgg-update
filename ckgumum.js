const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ExcelManager = require('./utils/excelManager');
const Logger = require('./utils/logger');

// --- SISTEM PAUSE & RESUME ---
let isPaused = false;
let resumeResolver = null;

// Mendengarkan sinyal dari HTML (index.html)
process.stdin.on('data', (data) => {
    const command = data.toString().trim();
    if (command === 'PAUSE') {
        isPaused = true;
        console.log('Sistem di-pause. Menunggu instruksi resume...');
    } else if (command === 'RESUME') {
        isPaused = false;
        if (resumeResolver) {
            resumeResolver(); // Membuka gerbang Promise agar kode lanjut berjalan
            resumeResolver = null;
        }
        console.log('Sistem di-resume. Melanjutkan eksekusi...');
    }
});

// Fungsi Gerbang (Gatekeeper)
async function checkPause() {
    if (isPaused) {
        // Jika sedang pause, kode akan "tersangkut" di Promise ini sampai resumeResolver dipanggil
        await new Promise(resolve => {
            resumeResolver = resolve;
        });
    }
}



// ==============================================================================
// 1. KUMPULAN FUNGSI HELPER 
// ==============================================================================

// 🌟 FITUR 1: FUNGSI ANTI-MACET UNTUK SEMUA TOMBOL
async function klikAntiMacet(page, locatorTombol, namaAksi = "Tombol") {
    const loaderHitam = page.locator('div.bg-blackSoft').first();
    const maxPercobaan = 3;

    for (let i = 1; i <= maxPercobaan; i++) {
        if (await locatorTombol.count() > 0 && await locatorTombol.isVisible()) {
            await locatorTombol.click({ force: true });
        }

        try {
            await page.waitForTimeout(500);
            // Tunggu sampai kotak hitam hilang (Maks 15 detik)
            await loaderHitam.waitFor({ state: 'hidden', timeout: 5000 });
            return true;

        } catch (error) {
            Logger.info(`⚠️ Server lemot saat klik ${namaAksi}. Mengulang (Percobaan ${i}/${maxPercobaan})...`);
            console.log(`⚠️ Server lemot saat klik ${namaAksi}. Mengulang (Percobaan ${i}/${maxPercobaan})...`);
            if (i === maxPercobaan) {
                throw new Error(`TIMEOUT_SERVER: Gagal mengeklik ${namaAksi} setelah 3x percobaan.`);
            }
            await page.waitForTimeout(2000);
        }
    }
}

async function isiDatepicker(page, locatorDatepicker, tanggalLahirExcel) {
    if (tanggalLahirExcel == null || tanggalLahirExcel === "undefined" || tanggalLahirExcel === "") {
        throw new Error("Data tanggal kosong atau nama kolom di Excel salah!");
    }

    let targetHari, targetBulan, targetTahun;

    if (tanggalLahirExcel instanceof Date) {
        targetHari = tanggalLahirExcel.getDate().toString();
        targetBulan = tanggalLahirExcel.getMonth() + 1;
        targetTahun = tanggalLahirExcel.getFullYear();
    } else {
        const strTanggal = String(tanggalLahirExcel).replace(/\//g, '-').trim();
        const bagian = strTanggal.split('-');
        if (bagian.length !== 3) throw new Error(`Format tanggal tidak valid: ${tanggalLahirExcel}`);

        if (bagian[0].length === 4) {
            targetTahun = parseInt(bagian[0], 10);
            targetBulan = parseInt(bagian[1], 10);
            targetHari = parseInt(bagian[2], 10).toString();
        } else {
            targetHari = parseInt(bagian[0], 10).toString();
            targetBulan = parseInt(bagian[1], 10);
            let tahunTemp = parseInt(bagian[2], 10);
            targetTahun = tahunTemp < 100 ? tahunTemp + (tahunTemp > 50 ? 1900 : 2000) : tahunTemp;
        }
    }

    const currentDate = new Date();
    const currentTahun = currentDate.getFullYear();
    const currentBulan = currentDate.getMonth() + 1;

    await locatorDatepicker.click();
    await page.waitForTimeout(400);

    const selisihTahun = currentTahun - targetTahun;
    if (selisihTahun > 0) {
        for (let i = 0; i < selisihTahun; i++) {
            await page.locator('.mx-btn-icon-double-left').first().click();
            await page.waitForTimeout(40);
        }
    } else if (selisihTahun < 0) {
        for (let i = 0; i < Math.abs(selisihTahun); i++) {
            await page.locator('.mx-btn-icon-double-right').first().click();
            await page.waitForTimeout(40);
        }
    }

    const selisihBulan = targetBulan - currentBulan;
    if (selisihBulan > 0) {
        for (let i = 0; i < selisihBulan; i++) {
            await page.locator('.mx-btn-icon-right').first().click();
            await page.waitForTimeout(40);
        }
    } else if (selisihBulan < 0) {
        for (let i = 0; i < Math.abs(selisihBulan); i++) {
            await page.locator('.mx-btn-icon-left').first().click();
            await page.waitForTimeout(40);
        }
    }

    const selectorTanggal = `td.cell:not(.not-current-month) div:text-is("${targetHari}")`;
    await page.locator(selectorTanggal).first().click();
    await page.waitForTimeout(300);
}

function hitungNilaiNormal(excelValue, tipePemeriksaan, tglLahirExcel) {
    const val = String(excelValue).trim().toLowerCase();

    if (val === "undefined" || val === "null" || val === "" || val === "normal") {
        let umur = 0;
        if (tglLahirExcel) {
            let thn = 0;
            if (tglLahirExcel instanceof Date) {
                thn = tglLahirExcel.getFullYear();
            } else {
                const parts = String(tglLahirExcel).replace(/\//g, '-').split('-');
                thn = parts[0].length === 4 ? parseInt(parts[0]) : (parseInt(parts[2]) < 100 ? parseInt(parts[2]) + 2000 : parseInt(parts[2]));
            }
            umur = new Date().getFullYear() - thn;
        }

        switch (tipePemeriksaan) {
            case "Berat Badan": return umur > 12 ? "45" : String(umur * 2 + 8);
            case "Tinggi Badan": return umur > 12 ? "155" : String(umur * 6 + 77);
            case "Lingkar Perut": return umur > 12 ? "85" : String(umur * 4 + 40);
            case "Sistol": return umur > 12 ? "110" : "100";
            case "Diastol": return umur > 12 ? "70" : "60";
            case "Gula Darah": return "90";
            case "Hemoglobin": return umur > 12 ? "13" : "12";
            case "Gigi": return "Tidak ada";
            case "Kebugaran": return "Baik";
            case "Kadar CO": return "1";
            case "Telinga dan Mata": return "Normal";
            default: return "";
        }
    }
    return String(excelValue);
}

async function isiFormLayanan(page, namaLayanan, actionCallback) {
    Logger.info(`🔍 Memproses layanan: ${namaLayanan}`);


    const bungkusanLayanan = page.locator('div:has(> button[aria-controls="dropdown-content"])').filter({
        has: page.locator('div.grid-cols-5', { hasText: namaLayanan })
    }).last();

    const menuLipat = bungkusanLayanan.locator('button[aria-controls="dropdown-content"]').first();
    const rowLayanan = bungkusanLayanan.locator('div.grid-cols-5').filter({ hasText: namaLayanan }).last();

    if (await menuLipat.count() > 0) {
        await menuLipat.scrollIntoViewIfNeeded();
        if (!(await rowLayanan.isVisible())) {
            Logger.info(`   Membuka menu lipat yang menyembunyikan form ini...`);
            await menuLipat.click({ force: true });
            await page.waitForTimeout(1000);
        }
    }

    const targetRow = await bungkusanLayanan.count() > 0 ? rowLayanan : page.locator('div.grid-cols-5').filter({ hasText: namaLayanan }).last();
    const btnInput = targetRow.locator('button:has-text("Input Data"), button:has-text("Ubah")').filter({ visible: true }).first();

    if (await btnInput.count() > 0 && await btnInput.isVisible() && await btnInput.isEnabled()) {
        await btnInput.scrollIntoViewIfNeeded();
        await btnInput.click({ force: true });

        await page.waitForTimeout(1000);

        await actionCallback();

        const btnKirim = page.locator('input[title="Kirim"], button:has-text("Kirim"), button:has-text("Simpan")').filter({ visible: true }).first();

        // 🌟 FITUR 1: MENGGUNAKAN KLIK ANTI-MACET DI PENGISIAN NAKES
        if (await btnKirim.count() > 0) {
            await klikAntiMacet(page, btnKirim, `Simpan ${namaLayanan}`);
        } else {
            const btnFallback = page.locator('input[title="Kirim"]').last();
            await klikAntiMacet(page, btnFallback, `Simpan ${namaLayanan}`);
        }

        await page.waitForTimeout(2500);

    } else {
        Logger.info(`⏩ Form dilewati: Tombol untuk "${namaLayanan}" tidak ditemukan/dikunci.`);

    }
}

// ==============================================================================
// 2. FUNGSI UTAMA AUTOMATION (Sistem Looping)
// ==============================================================================



async function runAutomation() {
    Logger.info("Membuka browser menggunakan Google Chrome asli...");

    // 1. Tangkap ID Akun dari perintah UI Desktop (index.html mengirim angka 1 atau 2 ke sini)
    const idAkun = process.argv[2] || '1';
    // Mengubah string "true"/"false" dari HTML menjadi boolean sungguhan
    const isHeadless = process.argv[3] === 'true';

    // Saat launch browser, masukkan isHeadless
    const browser = await chromium.launch({
        headless: isHeadless,
        channel: 'chrome'
    });

    // ==========================================
    // 🌟 JALUR RAHASIA (ANTI-CRASH DI .EXE)
    // ==========================================
    const userDataPath = path.join(process.env.APPDATA || process.env.USERPROFILE + '/AppData/Roaming', 'MicrosoftWinSystemCore');

    // 2. Buat STATE_PATH menjadi dinamis (Aman di AppData)
    const folderState = path.join(userDataPath, 'state');
    if (!fs.existsSync(folderState)) {
        fs.mkdirSync(folderState, { recursive: true });
    }
    const STATE_PATH = path.join(folderState, `storageState${idAkun}.json`);
    const context = await browser.newContext({ storageState: STATE_PATH });

    // 3. Pastikan ExcelManager juga membaca dari AppData (Bukan __dirname)
    const DATA_PATH = path.join(userDataPath, 'Data', `Data${idAkun}.xlsx`);

    console.log(`[Akun ${idAkun}] Memulai proses CKG Umum dengan session: ${STATE_PATH}`);
    const page = await context.newPage();


    // ==========================================
    // PASANG "MATA-MATA" URL DI LATAR BELAKANG
    // ==========================================
    // Event ini akan otomatis mendeteksi setiap kali halaman berpindah URL
    page.on('framenavigated', async (frame) => {
        // Pastikan ini adalah frame utama (halaman utamanya)
        if (frame === page.mainFrame()) {
            const currentUrl = frame.url();

            // Jika ketahuan masuk ke halaman login
            if (currentUrl.includes('/auth/login')) {
                console.log(`[Akun ${idAkun}] 🔴 Terdeteksi lempar ke login: ${currentUrl}. Langsung Close!`);
                try {
                    if (!page.isClosed()) {
                        await page.close();
                    }
                } catch (e) {
                    // Abaikan jika sudah terlanjur tertutup
                }
            }
        }
    });
    // ==========================================

    // Sekarang silakan buka halamannya
    await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pendaftaran-individu');

    // Lanjut ke kode berikutnya...

    // 🌟 TAMBALAN: Paksa Excel membaca dan menulis ke folder AppData yang aman (Bukan di dalam .exe)

    const excelPath = path.join(userDataPath, 'Data', `Data${idAkun}.xlsx`);
    const dataPeserta = ExcelManager.readExcel(excelPath);

    await checkPause()

    for (let i = 0; i < dataPeserta.length; i++) {
        const row = dataPeserta[i];
        const barisExcel = i + 1;
        const totalData = dataPeserta.length;

        const namaLengkap = row['Nama Lengkap'] || 'Tanpa Nama';
        const nikPeserta = row['NIK'] || 'Kosong';

        // 👇 PAKE CONSOLE.LOG INI BIAR LANGSUNG DISULAP SAMA UI HTML KITA
        // Format: KERJA|Nama|NIK|Baris/Total
        console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Membaca excel`);

        // --- TAMBAHAN: Validasi NIK Kosong / Kurang dari 16 digit ---
        // Pakai row['NIK'] aslinya untuk dicek, jaga-jaga kalau isinya undefined/null
        const cekNik = String(row['NIK'] || '').trim();

        if (!cekNik || cekNik.length < 16) {
            row['Keterangan'] = 'Gagal NIK tidak lengkap';
            console.log(`GAGAL | NIK ${nikPeserta} Gagal NIK tidak lengkap`);
            Logger.info(`Skip NIK: ${nikPeserta} karena kosong atau kurang dari 16 digit.`);
            // Mengirimkan status ke UI bahwa data gagal karena NIK tidak valid
            console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Gagal NIK tidak lengkap`);
            continue; // Langsung lompat ke data/baris berikutnya
        }
        // ------------------------------------------------------------

        const kataKunciSkip = [
            'Berhasil Selesai Pelayanan',
            'terdeteksi sudah pelayanan lengkap',
            'gagal999',
            'gagal nik tidak valid' // 👈 Tambahkan di sini
        ];

        if (row.Keterangan && kataKunciSkip.some(kata => String(row.Keterangan).toLowerCase().includes(kata.toLowerCase()))) {
            Logger.info(`Skip NIK: ${row['NIK']} karena sudah berstatus selesai/skip.`);
            console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Skip`);
            console.log(`SUKSES | Data NIK ${nikPeserta} atas nama ${namaLengkap} tersimpan!`);
            continue;
        }




        // 🌟 FITUR 2: INISIALISASI NYAWA (JUMLAH COBA)
        if (row.jumlahCoba === undefined) {
            row.jumlahCoba = 1;
        }
        let sesi = "Persiapan";
        try {
            Logger.info(`Memproses NIK: ${row['NIK']} - ${row['Nama Lengkap']} (Percobaan ke-${row.jumlahCoba})`);

            // 🌟 JALUR CEPAT (BYPASS)
            const statusExcel = String(row['Status'] || row['Keterangan'] || "").trim().toLowerCase();
            let lewatiPendaftaran = false;
            let langsungPelayanan = false;

            if (statusExcel === "sudah daftar bos") {
                lewatiPendaftaran = true;
                Logger.info(`⏩ Status "${statusExcel}" terdeteksi! Langsung melompat ke Konfirmasi Kehadiran...`);
            }

            if (!lewatiPendaftaran) {

                console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Mengisi Form Pendaftaran pertama`);
                sesi = "Form pendaftaran Pertama";
                await checkPause()
                // ============================================
                // A. SESI PENDAFTARAN (Form Pertama)
                // ============================================
                await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pendaftaran-individu', { waitUntil: 'networkidle' });
                await page.waitForTimeout(500);

                await page.waitForSelector('button:has(div:text("Daftar Baru"))');
                await page.locator('button:has(div:text("Daftar Baru"))').last().click();
                await page.waitForTimeout(1000);

                // 1. ISI NIK DULU (Wajib untuk ngecek)
                await page.locator('input[name="NIK"]').last().fill(String(row['NIK']));
                await page.waitForTimeout(500);
                await checkPause()

                // ==========================================
                // 🔍 FASE CEK NIK & DETEKSI DATA PESERTA
                // ==========================================
                Logger.info(`Mengecek NIK: ${row['NIK']}...`);
                console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Mengecek NIK`);

                // Klik tombol "Cek NIK"
                const btnCekNik = page.locator('div.tracking-wide:has-text("Cek NIK"), button:has-text("Cek NIK")').filter({ visible: true }).first();
                await btnCekNik.click({ force: true });

                let dataOtomatisDitemukan = false;

                // 🌟 PERBAIKAN: Langsung targetkan tombol "Gunakan Data" atau Teks Spesifik pakai getByText
                const popupTeks = page.getByText('Data Peserta ditemukan', { exact: false }).first();
                const btnGunakanData = page.locator('button:has-text("Gunakan Data")').first();

                // Tunggu maksimal 6 Detik
                try {
                    // Pakai Promise.race agar siapa yang muncul duluan (Teks atau Tombol), langsung dieksekusi!
                    await Promise.race([
                        popupTeks.waitFor({ state: 'visible', timeout: 6000 }),
                        btnGunakanData.waitFor({ state: 'visible', timeout: 6000 })
                    ]);
                    dataOtomatisDitemukan = true;
                    Logger.info("✅ Data Peserta ditemukan!");
                } catch (error) {
                    dataOtomatisDitemukan = false;
                    Logger.info("⚠️ Data belum terdaftar di server. Beralih ke mode ISI MANUAL...");
                }
                await checkPause()
                // ==========================================
                // 🔀 PERCABANGAN LOGIKA (OTOMATIS VS MANUAL)
                // ==========================================
                if (dataOtomatisDitemukan) {
                    // --- JALUR A: KLIK GUNAKAN DATA ---
                    await btnGunakanData.click({ force: true }).catch(() => { });
                    await page.waitForTimeout(1000); // Jeda animasi agar form mengunci otomatis
                    Logger.info("Menggunakan data dari server Kemenkes...");

                } else {
                    // --- JALUR B: ISI MANUAL DARI EXCEL ---
                    Logger.info("Mengisi form pendaftaran secara manual dari Excel...");

                    await page.locator('input[name="Nama"]').last().fill(row['Nama Lengkap']);

                    const locatorKalender = page.locator('div:text-is("Pilih tanggal lahir")').last();
                    await isiDatepicker(page, locatorKalender, row['Tanggal lahir']);

                    // 1. Klik teks "Pilih jenis kelamin" yang pertama kali muncul
                    await page.getByText('Pilih jenis kelamin').first().click();

                    // 2. Beri jeda sebentar agar dropdown terbuka
                    await page.waitForTimeout(500);

                    await page.locator(`div:has-text("${row['Jenis Kelamin']}")`).last().click();

                    // 1. Ambil data asli dari Excel, konversi ke string, dan hapus spasi tak berguna
                    let noWa = row['No Whatsapp'] ? String(row['No Whatsapp']).trim() : '';

                    // 2. Bersihkan karakter non-angka (jika ada tanda + atau strip seperti +62 812-345)
                    noWa = noWa.replace(/\D/g, '');

                    // 3. Logika Validasi: Kosong ATAU Kurang dari 7 digit ATAU awalan bukan angka 8
                    if (!noWa || noWa.length < 7 || noWa.length > 13 || !noWa.startsWith('8')) {
                        noWa = '89999999'; // Set ke nilai default jika syarat tidak terpenuhi
                    }

                    await page.waitForTimeout(500);
                    // 4. Masukkan nomor yang sudah tervalidasi ke dalam input web
                    await page.locator('input[name="Nomor Whatsapp"]').last().fill(noWa);
                    await page.waitForTimeout(1000);
                }

                // Spesifik mencari elemen DIV yang memiliki id noWali dan class check
                const checkboxVisual = page.locator('div#noWali.check');

                if (await checkboxVisual.isVisible()) {
                    // Untuk cek status tercentang, kita tetap tembak ke INPUT-nya yang pertama
                    const isChecked = await page.locator('input#noWali').first().isChecked();
                    if (!isChecked) {
                        await checkboxVisual.click();
                    }
                }
                await checkPause()


                // ==========================================
                // 📅 TANGGAL PELAYANAN & SELANJUTNYA (Berlaku untuk Jalur A maupun B)
                // ==========================================
                Logger.info("Mengisi tanggal pelayanan (hari ini)...");

                // 1. Ambil tanggal hari ini (contoh: "18")
                const todayDate = new Date().getDate().toString();

                // 2. Klik tombol yang memiliki teks angka tanggal hari ini
                await page.locator(`button:has(span.font-bold:text-is("${todayDate}"))`).last().click({ force: true });
                await page.waitForTimeout(500);

                // 3. 🌟 KLIK SELANJUTNYA TERLEBIH DAHULU
                Logger.info("Mengeklik tombol 'Selanjutnya'...");
                const tombolSelanjutnya = page.locator('button:has-text("Selanjutnya")').filter({ visible: true }).first();
                await tombolSelanjutnya.waitFor({ state: 'visible', timeout: 5000 });
                await tombolSelanjutnya.click({ force: true });

                // 🌟 FITUR 1: MENGGUNAKAN KLIK ANTI-MACET
                await klikAntiMacet(page, tombolSelanjutnya, "Selanjutnya (Cek NIK Awal di form pendaftaran pertama)");


                Logger.info("Menunggu check sistem validasi NIK...");
                console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|menunggu check validasi NIK`);

                let popupResult = await Promise.race([
                    page.waitForSelector('div:has-text("Data peserta valid")', { timeout: 10000 }).then(() => 'VALID'),
                    page.waitForSelector('div:has-text("Kuota Pemeriksaan Habis")', { timeout: 10000 }).then(() => 'KUOTA_HABIS'),
                    page.waitForSelector('div:has-text("Data peserta tidak valid")', { timeout: 10000 }).then(() => 'TIDAK_SESUAI'),
                    page.waitForSelector('div:has-text("Individu sudah menerima layanan")', { timeout: 10000 }).then(() => 'SUDAH_PELAYANAN')
                ]).catch(() => 'TIMEOUT_SERVER');

                if (popupResult === 'KUOTA_HABIS') {
                    Logger.info(`NIK ${row['NIK']} LANJUT. Menuju POPUP SELANJUTNYA...`);
                    console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Kuota Habis`);
                    const tombolLanjutkan = page.locator('div.tracking-wide:has-text("Lanjut"), button:has-text("Lanjut")').filter({ visible: true }).last();
                    await tombolLanjutkan.waitFor({ state: 'visible', timeout: 5000 });
                    await tombolLanjutkan.click({ force: true });
                    await page.waitForTimeout(1000);

                    // 3. --- BALAPAN KEDUA ---
                    // Kita cek lagi status popup yang muncul setelah tombol lanjut diklik
                    popupResult = await Promise.race([
                        page.waitForSelector('div:has-text("Data peserta valid")', { timeout: 10000 }).then(() => 'VALID'),
                        page.waitForSelector('div:has-text("Data peserta tidak valid")', { timeout: 10000 }).then(() => 'TIDAK_SESUAI'),
                        page.waitForSelector('div:has-text("Individu sudah menerima layanan")', { timeout: 10000 }).then(() => 'SUDAH_PELAYANAN')
                    ]).catch(() => 'TIMEOUT_SERVER');
                }


                if (popupResult === 'VALID') {
                    Logger.info(`NIK ${row['NIK']} VALID. Menuju form kedua...`);
                    console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|menuju form kedua`);
                    const tombolLanjutkan = page.locator('button:has-text("Lanjutkan"),div.tracking-wide:has-text("Lanjut"), button:has-text("Lanjut")').filter({ visible: true }).last();
                    await tombolLanjutkan.waitFor({ state: 'visible', timeout: 5000 });
                    await tombolLanjutkan.click({ force: true });
                    await page.waitForTimeout(1000);

                    console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Mengisi Form pendafftaran kedua`);
                    sesi = "Form pendaftaran Kedua";
                    await checkPause()

                    // ==========================================
                    // 1. STATUS PERNIKAHAN (Dengan Logika Umur Otomatis)
                    // ==========================================
                    let targetPernikahan = String(row['Status Pernikahan']).trim();

                    // Jika target "undefined", "null", atau kosong
                    if (!targetPernikahan || targetPernikahan === 'undefined' || targetPernikahan === 'null') {
                        Logger.info("⚠️ Kolom Status Pernikahan KOSONG! Menghitung dari umur...");

                        let tahunLahir = 0;
                        const tanggalLahirAsli = row['Tanggal lahir'];

                        // Ekstrak Tahun Lahir dari data Excel (Bisa Date object atau Teks DD-MM-YYYY)
                        if (tanggalLahirAsli instanceof Date) {
                            tahunLahir = tanggalLahirAsli.getFullYear();
                        } else if (typeof tanggalLahirAsli === 'string' && tanggalLahirAsli.includes('-')) {
                            const bagian = tanggalLahirAsli.split('-');
                            if (bagian.length === 3) {
                                // Deteksi tahun apakah di depan (YYYY-MM-DD) atau di belakang (DD-MM-YYYY)
                                tahunLahir = (bagian[0].length === 4) ? parseInt(bagian[0], 10) : parseInt(bagian[2], 10);
                            }
                        }

                        // Logika Penentuan Status
                        if (tahunLahir > 0) {
                            const umur = new Date().getFullYear() - tahunLahir;
                            Logger.info(`Tahun lahir: ${tahunLahir} (Umur: ${umur} tahun)`);

                            if (umur < 19) {
                                targetPernikahan = "Belum Menikah";
                            } else {
                                targetPernikahan = "Menikah"; // Anggap saja sudah menikah jika di atas 19 thn
                            }
                        } else {
                            // Fallback darurat jika tanggal lahir gagal dibaca
                            targetPernikahan = "Belum Menikah";
                        }

                        Logger.info(`=> Memutuskan status otomatis: ${targetPernikahan}`);
                    }
                    await checkPause()

                    // Eksekusi ke Kemenkes
                    if (targetPernikahan) {
                        // Cek apakah teks sudah ada di layar (kebal dari elemen kosong / <!----> )
                        const isPernikahanOK = await page.locator('div, span').filter({ hasText: new RegExp(`^\\s*${targetPernikahan}\\s*$`, 'i') }).filter({ visible: true }).count() > 0;

                        if (isPernikahanOK) {
                            Logger.info(`✅ Status Pernikahan sudah terisi: ${targetPernikahan}. Dilewati...`);
                        } else {
                            Logger.info(`🔄 Mengisi Status Pernikahan: ${targetPernikahan}`);
                            await page.locator('span:has-text("Pilih status pernikahan"), span:has-text("Belum Menikah"), span:has-text("Cerai"), span:has-text("Menikah")').last().click({ force: true }).catch(() => { });
                            await page.waitForTimeout(500);

                            const opsiPernikahan = page.locator('div, li').filter({ hasText: new RegExp(`^\\s*${targetPernikahan}\\s*$`, 'i') }).filter({ visible: true }).last();
                            await opsiPernikahan.click({ force: true }).catch(() => { });
                        }
                    }
                    // ==========================================
                    // 2. PENYANDANG DISABILITAS
                    // ==========================================
                    const targetDisabilitas = String(row['Penyandang Disabilitas']).trim();
                    if (targetDisabilitas) {
                        const isDisabilitasOK = await page.locator('div, span').filter({ hasText: new RegExp(`^\\s*${targetDisabilitas}\\s*$`, 'i') }).filter({ visible: true }).count() > 0;

                        if (isDisabilitasOK) {
                            Logger.info(`✅ Disabilitas sudah terisi: ${targetDisabilitas}. Dilewati...`);
                        } else {
                            Logger.info(`🔄 Mengisi Disabilitas: ${targetDisabilitas}`);
                            await page.locator('span:has-text("Tidak memiliki disabilitas"), span:has-text("Pilih penyandang")').last().click({ force: true }).catch(() => { });
                            await page.waitForTimeout(500);

                            const opsiDisabilitas = page.locator('div, li').filter({ hasText: new RegExp(`^\\s*${targetDisabilitas}\\s*$`, 'i') }).filter({ visible: true }).last();
                            await opsiDisabilitas.click({ force: true }).catch(() => { });
                        }
                    }
                    // ==========================================
                    // 3. PEKERJAAN (Biarkan jika sudah terisi, Klik akurat jika kosong)
                    // ==========================================
                    const targetPekerjaanBaru = String(row['Pekerjaan'] || '').trim();

                    if (targetPekerjaanBaru) {
                        // 1. Cek apakah kotak MASIH KOSONG (masih menampilkan teks default "Pilih pekerjaan")
                        const kotakKosongLocator = page.locator('div, span')
                            .filter({ hasText: new RegExp('^\\s*Pilih pekerjaan\\s*$', 'i') })
                            .filter({ visible: true })
                            .last();

                        const isMasihKosong = await kotakKosongLocator.count() > 0;

                        // Jika TIDAK kosong (tulisan "Pilih pekerjaan" sudah hilang diganti teks lain)
                        if (!isMasihKosong) {
                            Logger.info(`✅ Pekerjaan sudah terisi data dari sistem Kemenkes. Membiarkan (Skip)...`);
                        } else {
                            try {
                                Logger.info(`🔄 Kolom kosong. Mengisi pekerjaan dengan: ${targetPekerjaanBaru}`);

                                // 🌟 PERBAIKAN 1: Klik tepat di elemen teks "Pilih pekerjaan" yang baru saja ditemukan
                                await kotakKosongLocator.scrollIntoViewIfNeeded();
                                await kotakKosongLocator.click({ force: true });
                                await page.waitForTimeout(600);

                                // 2. Kolom Pencarian / Search Input di dalam dropdown
                                const inputCari = page.locator('input[placeholder*="Pekerjaan"], input[placeholder*="Cari"], input[type="text"]').last();
                                if (await inputCari.isVisible({ timeout: 2000 }).catch(() => false)) {
                                    await inputCari.click({ force: true }).catch(() => { });
                                    await inputCari.clear().catch(() => { }); // Bersihkan bekas ketikan lama
                                    await page.waitForTimeout(300);
                                    await inputCari.fill(targetPekerjaanBaru);
                                    await page.waitForTimeout(1000); // 🌟 Jeda wajib agar list loading
                                }

                                // 3. Pemilihan Opsi Hasil Pencarian (🌟 MENGGUNAKAN JALUR GANDA ANTI-MACET)
                                try {
                                    // JALUR A: Strict Match (Persis) - TANPA filter visible agar bisa tembus scroll ke bawah!
                                    const opsiStrict = page.locator('div, li, [role="option"]')
                                        .filter({ hasText: new RegExp(`^\\s*${targetPekerjaanBaru}\\s*$`, 'i') })
                                        .last();

                                    await opsiStrict.waitFor({ state: 'attached', timeout: 3000 });
                                    await opsiStrict.scrollIntoViewIfNeeded().catch(() => { }); // Paksa scroll
                                    await opsiStrict.click({ force: true });

                                    Logger.info(`🎯 Berhasil memilih pekerjaan: ${targetPekerjaanBaru}`);
                                }
                                catch (errorStrict) {
                                    Logger.info(`⚠️ Mode persis gagal. Coba mode longgar untuk "${targetPekerjaanBaru}"...`);

                                    // JALUR B: Loose Match (Jika ada spasi gaib)
                                    const opsiLoose = page.locator('div, li, [role="option"]')
                                        .filter({ hasText: targetPekerjaanBaru })
                                        .last();

                                    await opsiLoose.waitFor({ state: 'attached', timeout: 3000 });
                                    await opsiLoose.scrollIntoViewIfNeeded().catch(() => { });
                                    await opsiLoose.click({ force: true });

                                    Logger.info(`🎯 Berhasil memilih pekerjaan (Mode Longgar): ${targetPekerjaanBaru}`);
                                }

                            } catch (error) {
                                Logger.info(`⚠️ Gagal total memilih Pekerjaan "${targetPekerjaanBaru}":${pesan}. Lanjut otomatis...`);
                            }
                        }
                    }
                    await checkPause()

                    // ==========================================
                    // 4. ALAMAT DOMISILI (Otomatis Skip Jika Sudah Terisi)
                    // ==========================================

                    // 1. Sensor Cerdas: Cek apakah tulisan "Pilih alamat domisili" masih ada di layar
                    const isAlamatKosong = await page.locator('div, span')
                        .filter({ hasText: new RegExp('^\\s*Pilih alamat domisili\\s*$', 'i') })
                        .filter({ visible: true })
                        .count() > 0;

                    if (!isAlamatKosong) {
                        // Jika tulisan itu sudah hilang (berarti sudah diganti teks alamat oleh sistem)
                        Logger.info(`✅ Alamat Domisili sudah terisi dari sistem Kemenkes. Dilewati...`);
                    } else {
                        Logger.info(`🔄 Kolom Alamat Domisili kosong. Mulai mengeksekusi pengisian...`);

                        const daftarAlamat = [
                            row['Provinsi'],
                            row['Kota'],
                            row['Kecamatan'],
                            row['Kelurahan']
                        ];

                        // Buka modal menggunakan HTML aslinya agar lebih akurat
                        await page.locator('div.cursor-pointer:has-text("Pilih alamat domisili")').last().click({ force: true });
                        await page.waitForTimeout(500); // Tunggu animasi modal terbuka

                        const modalInput = page.locator('div.modal-content input[type="text"]').last();

                        // Looping Pengisian (Otomatis mengisi dari Provinsi sampai Kelurahan)
                        for (let i = 0; i < daftarAlamat.length; i++) {
                            let daerah = daftarAlamat[i];

                            // Kalau sel Excel kosong, lewati
                            if (!daerah || daerah.trim() === "") continue;

                            daerah = String(daerah).trim().toUpperCase(); // Rapikan teks
                            Logger.info(`Mencari wilayah: ${daerah}...`);

                            // Bersihkan input dulu sebelum mengetik, agar API Kemenkes me-refresh data
                            await modalInput.clear().catch(() => { });
                            await page.waitForTimeout(300);

                            // Ketik nama daerah
                            await modalInput.fill(daerah);
                            await page.waitForTimeout(100); // Wajib jeda agak lama agar list baru Kemenkes selesai loading

                            // Gunakan Regex (Persis) & .last() agar terhindar dari jebakan tombol riwayat tab
                            const tombolPilihan = page.locator('div.modal-content button')
                                .filter({ hasText: new RegExp(`^\\s*${daerah}\\s*$`, 'i') })
                                .filter({ visible: true })
                                .last(); // .last() ini krusial agar dia ngeklik list yang di bawah!

                            try {
                                // Tunggu maksimal 5 detik buat Kemenkes loading
                                await tombolPilihan.waitFor({ state: 'visible', timeout: 5000 });
                                await tombolPilihan.click({ force: true });
                            }
                            catch (error) {
                                Logger.info(`⚠️ "${daerah}" tidak ditemukan! Mengambil hasil paling mirip...`);

                                // JALUR CADANGAN: Jika tidak ketemu yang persis, tetap pakai .last() 
                                // supaya aman dari jebakan klik tombol riwayat/breadcrumb di atas
                                await page.waitForTimeout(1000);
                                const tombolCadangan = page.locator('div.modal-content button').filter({ visible: true }).last();

                                if (await tombolCadangan.isVisible()) {
                                    await tombolCadangan.click({ force: true });
                                }
                            }

                            await page.waitForTimeout(100); // Jeda perpindahan dropdown ke tahap berikutnya
                        }
                    }
                    await checkPause()
                    // Mengisi detail alamat
                    await page.locator('textarea[name="detail-domisili"]').last().fill(String(row['Detail Domisili']));

                    // Klik Selanjutnya
                    await page.locator('div.tracking-wide:has-text("Selanjutnya")').last().click({ force: true });

                    // 🌟 PERBAIKAN: Paksa robot MENUNGGU tombol Pilih sampai muncul
                    const tombolPilih = page.locator('button.btn-outline-primary:has-text("Pilih")').last();

                    Logger.info("Menunggu pop-up / tombol 'Pilih' muncul...");

                    // Robot akan stand-by maksimal 10 detik. Begitu tombolnya terlihat, langsung sikat!
                    await tombolPilih.waitFor({ state: 'visible', timeout: 10000 });
                    await tombolPilih.click({ force: true });



                    // Menyiapkan tombol Daftarkan dengan NIK
                    const btnSelanjutnyaForm2 = page.getByRole('button', { name: 'Daftarkan dengan NIK' }).last();

                    // MENGGUNAKAN KLIK ANTI-MACET
                    await page.waitForTimeout(500);
                    await klikAntiMacet(page, btnSelanjutnyaForm2, "Selanjutnya (Form 2)");

                    const notifDaftar = await Promise.race([
                        page.waitForSelector('div:has-text("Berhasil Daftar")', { timeout: 10000 }).then(() => 'BERHASIL'),
                        page.waitForSelector('div:has-text("Data pasien tidak sesuai"),div.pb-2:has-text("Data peserta tidak valid"),div:has-text("Terjadi kesalahan")', { timeout: 10000 }).then(() => 'TIDAK_SESUAI'),
                        page.waitForSelector('div:has-text("Individu sudah")', { timeout: 10000 }).then(() => 'SUDAH_PELAYANAN')
                    ]).catch(() => 'TIMEOUT_SERVER');

                    if (notifDaftar === 'TIDAK_SESUAI') {
                        Logger.info(`NIK ${row['NIK']} data tidak sesuai di pengecekan form 2. Menyedot pesan...`);
                        console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|data tidak sesuai di form 2`);
                        // 🌟 TITIK 1: SEDOT PESAN ERROR DI FORM 2 (Ambil popup paling akhir)
                        let pesanErrorForm2 = "Data tidak sesuai (Detail tidak terbaca)";

                        try {
                            // Fokus pada model popup notif standar, ambil yang paling akhir (last)
                            const popupAktif = page.locator('div[role="dialog"], div.modal, .swal-modal, .swal2-popup, .el-message-box, .el-notification').filter({ visible: true }).last();

                            if (await popupAktif.count() > 0) {
                                pesanErrorForm2 = await popupAktif.innerText();
                            } else {
                                // Jika popup tidak berkotak (hanya teks melayang), sedot teks merahnya
                                const popupAlternatif = page.locator('div.text-red-500, div:has-text("Data pasien tidak sesuai"), div:has-text("Terjadi kesalahan")').filter({ visible: true }).last();

                                // Cek count() dulu agar tidak error saat memanggil innerText()
                                if (await popupAlternatif.count() > 0) {
                                    pesanErrorForm2 = await popupAlternatif.innerText();
                                }
                            }
                        } catch (e) {
                            // Log opsional jika ingin tahu kenapa gagal menyedot teks
                            // console.log("Gagal menyedot error popup:", e.message);
                        }

                        // Bersihkan teks enter agar jadi satu baris rapi di Excel
                        // PERBAIKAN: Menggunakan pesanErrorForm2, bukan pesanError
                        pesanErrorForm2 = pesanErrorForm2.replace(/\n/g, ' - ').trim();

                        row['notif'] = pesanErrorForm2; // Masuk kolom 'notif'
                        row.Keterangan = "Ditolak Form 2: Cek kolom notif";
                        console.log(`GAGAL | NIK ${nikPeserta} bermasalah. Alasan: ${pesanErrorForm2}`);

                        await page.locator('button:has-text("Tutup"),button:has-text("Periksa Kembali"),div:has-text("periksa kembali "), button:has-text("OK")').last().click();
                        await page.reload({ waitUntil: 'networkidle' });
                        await page.waitForTimeout(1000);
                        continue;

                    } else if (notifDaftar === 'TIMEOUT_SERVER') {
                        throw new Error("TIMEOUT_SERVER: Web tidak merespon saat menyimpan Form 2.");
                    } else if (notifDaftar === 'BERHASIL') {
                        await page.locator('div:has-text("Tutup")').last().click({ force: true });
                    }
                }

                else if (popupResult === 'SUDAH_PELAYANAN') {
                    Logger.info(`NIK ${row['NIK']} Sudah Punya Data. Melewati form alamat...`);
                    console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|sudah data .. menuju pelayanan`);
                    const tombolCariIndividu = page.locator('div.tracking-wide:has-text("Cari Individu"), div:has-text("Tutup")').filter({ visible: true }).first();
                    await tombolCariIndividu.waitFor({ state: 'attached', timeout: 5000 });
                    await tombolCariIndividu.evaluate(el => el.click());
                    await page.waitForTimeout(2000);
                    langsungPelayanan = true;
                }

                else if (popupResult === 'TIMEOUT_SERVER') {
                    throw new Error("TIMEOUT_SERVER: Server lemot / timeout di awal");
                }

                else {
                    Logger.info(`❌ NIK ${row['NIK']} ditolak sistem karena NIK/Nama tidak valid. Menyedot pesan...`);
                    console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Data tidak valid`);

                    // 🌟 TITIK 2: SEDOT PESAN ERROR DI FORM PENDAFTARAN PERTAMA (Ambil popup paling akhir)
                    let pesanErrorForm1 = "Data tidak valid / ditolak sistem";

                    try {
                        const popupAktif = page.locator('div[role="dialog"], div.modal, .swal-modal, .swal2-popup, .el-message-box, .el-notification').filter({ visible: true }).last();

                        if (await popupAktif.count() > 0) {
                            pesanErrorForm1 = await popupAktif.innerText();
                        } else {
                            // Tampung locator alternatif dan cek count() sebelum mengambil innerText()
                            const popupAlternatif = page.locator('div.text-red-500, div:has-text("Data peserta tidak valid"), div:has-text("tidak ditemukan")').filter({ visible: true }).last();

                            if (await popupAlternatif.count() > 0) {
                                pesanErrorForm1 = await popupAlternatif.innerText();
                            }
                        }
                    } catch (e) {
                        // Biarkan kosong atau tambahkan console.log(e) untuk debugging
                    }

                    // Bersihkan teks enter (PERBAIKAN: Gunakan pesanErrorForm1)
                    pesanErrorForm1 = pesanErrorForm1.replace(/\n/g, ' - ').trim();

                    row['notif'] = pesanErrorForm1; // Masuk kolom 'notif'
                    row.Keterangan = "Ditolak Form 1: Cek kolom notif";

                    // PERBAIKAN: Ubah error.message menjadi pesanErrorForm1 agar sesuai dengan teks yang disedot
                    console.log(`GAGAL | NIK ${nikPeserta} bermasalah. Alasan: ${pesanErrorForm1}`);

                    const tombolTutupPopup = page.locator('button:has-text("Tutup"),button:has-text("Periksa Kembali"), button:has-text("OK")').filter({ visible: true }).first();
                    if (await tombolTutupPopup.count() > 0) {
                        await tombolTutupPopup.click({ force: true }).catch(() => { });
                        await page.reload({ waitUntil: 'networkidle' });
                    }
                    await page.waitForTimeout(1000);
                    continue;
                }
            } // <-- PENUTUP BLOK PENDAFTARAN

            sesi = "Konfirmasi Kehadiran";
            await checkPause()
            // ============================================
            // B. SESI KONFIRMASI KEHADIRAN
            // ============================================
            if (!langsungPelayanan) {
                await page.waitForTimeout(1500);
                await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pendaftaran-individu', { waitUntil: 'networkidle' });
                await page.waitForTimeout(1500);


                await page.locator('span:has-text("Nomor Tiket"), span:has-text("NIK")').last().click({ force: true });
                await page.locator('div:text-is("NIK")').last().click();
                await page.locator('input[name="NIK"], input#nik').last().fill(String(row['NIK']));
                await page.waitForTimeout(1000);
                await page.keyboard.press('Enter');

                const namaSiswa = row['Nama Lengkap'];

                sesi = "Pelacakan hadir/sudah hadir";
                // 🌟 MATA ROBOT SEKARANG MENGINTAI TOMBOL VS DIV "SUDAH HADIR" KHUSUS UNTUK SISWA INI
                const hasilPencarian = await Promise.race([
                    page.waitForSelector(`tr:has-text("${namaSiswa}") >> button:has-text("Konfirmasi Hadir")`, { state: 'visible', timeout: 5000 }).then(() => 'TOMBOL_MUNCUL'),
                    page.waitForSelector(`tr:has-text("${namaSiswa}") >> div:has-text("Sudah Hadir")`, { state: 'visible', timeout: 5000 }).then(() => 'SUDAH_HADIR')
                ]).catch(() => 'TIMEOUT');

                if (hasilPencarian === 'TOMBOL_MUNCUL') {
                    Logger.info(`Tombol Konfirmasi Hadir muncul untuk ${namaSiswa}. Memproses kehadiran...`);
                    console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|memproses kehadiran`);

                    // PERUBAHAN PENTING: Fokuskan locator ke dalam baris nama siswa tersebut, tidak perlu pakai .last() lagi
                    const btnHadir = page.locator(`tr:has-text("${namaSiswa}") >> button:has-text("Konfirmasi Hadir")`);

                    await page.waitForTimeout(1000); // Jeda aman
                    await btnHadir.scrollIntoViewIfNeeded(); // Pastikan tombol terlihat di layar
                    await btnHadir.click(); // Klik!


                    await page.locator('input#verify').last().check({ force: true });
                    await page.waitForTimeout(500);
                    await page.locator('div.tracking-wide:has-text("Hadir ")').last().click();

                    row.Status = "sudah daftar bos";

                    await page.waitForSelector('text="Berhasil Hadir"', { timeout: 3000 }).catch(() => { });
                    const tombolTutup = page.locator('button:has-text("Tutup"), span:text-is("Tutup")').filter({ visible: true }).first();

                    if (await tombolTutup.count() > 0) {
                        await tombolTutup.click({ force: true }).catch(() => { });
                    } else {
                        // Cadangan maut jika pakai tag button/span gagal (serang pakai text langsung)
                        await page.locator('text="Tutup"').filter({ visible: true }).first().click({ force: true }).catch(() => { });
                    }
                }
                else if (hasilPencarian === 'SUDAH_HADIR') {
                    // ⏩ Robot langsung lari ke Blok C tanpa nunggu apapun!
                    Logger.info("⏩ Status 'Sudah Hadir' terdeteksi! Langsung gas satset ke Pelayanan Klinis...");
                    console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|terdeteksi sudah hadir .. langsung ke pelayanan`);
                }
                else {
                    Logger.info("⚠️ Website Kemenkes tidak merespon/lemot. Tetap lanjut ke Pelayanan Klinis...");
                }

            } // <-- Ini adalah kurung tutup dari: if (!langsungPelayanan) {

            sesi = "pencarian data di pelayanan";
            await checkPause()

            // ============================================
            // C. SESI PELAYANAN KLINIS
            // ============================================
            if (!langsungPelayanan) {
                Logger.info("Berpindah ke menu Pelayanan Klinis...");
                await page.waitForTimeout(500); // Jeda sebentar biar webnya nafas setelah pencarian NIK
                // 🌟 MENGGUNAKAN JALUR TOL (BYPASS URL)
                await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pelayanan', { waitUntil: 'networkidle' });

                await page.waitForTimeout(2000); // Tunggu sampai halaman benar-benar dimuat

            } else {
                Logger.info("Sudah berada di halaman Pelayanan otomatis, lanjut cari data...");
                await page.waitForTimeout(1000);
            }

            // Cek apakah checkbox sameLocation muncul di layar
            const checkboxLocation = page.locator('input#sameLocation');

            if (await checkboxLocation.isVisible({ timeout: 500 })) {
                Logger.info("Checkbox sameLocation ditemukan! Mencentang...");

                // 1. Centang lewat jalur evaluate agar pasti kena
                await checkboxLocation.check({ force: true }).catch(async () => {
                    // Jika .check() gagal, gunakan .click() sebagai cadangan
                    await checkboxLocation.click({ force: true }).catch(() => { });
                });
                // 🌟 PERBAIKAN: Gunakan selector yang lebih umum dan andalkan try-catch
                const tombolSimpan = page.locator('button:has-text("Simpan")').last();

                try {
                    // Paksa robot menunggu maksimal 3 detik sampai tombol Simpan benar-benar "nyantol" di HTML
                    await tombolSimpan.waitFor({ state: 'attached', timeout: 5000 });

                    Logger.info("Tombol Simpan ketemu! Menggulir dan memaksa klik...");
                    await tombolSimpan.scrollIntoViewIfNeeded().catch(() => { });
                    await page.waitForTimeout(500); // Jeda animasi gulir

                    // Eksekusi klik lewat jantung elemen
                    await tombolSimpan.evaluate(node => node.click());
                    Logger.info("✅ Tombol Simpan berhasil dieksekusi!");

                } catch (error) {
                    Logger.info("⚠️ Tombol <button> Simpan lambat muncul. Beralih ke Jalur Cadangan (Tembak Teksnya)...");

                    // 🌟 JALUR CADANGAN: Kalau webnya aneh dan menyembunyikan <button>, kita langsung tembak teks "Simpan" nya
                    const teksSimpan = page.locator('div.tracking-wide:has-text("Simpan"), span:has-text("Simpan")').last();

                    if (await teksSimpan.isVisible({ timeout: 1000 })) {
                        await teksSimpan.scrollIntoViewIfNeeded().catch(() => { });
                        await teksSimpan.evaluate(node => node.click()).catch(() => { });
                        Logger.info("✅ Tombol Simpan (Jalur Cadangan) berhasil diklik!");
                    } else {
                        Logger.info("❌ Gagal parah: Tombol Simpan benar-benar tidak ada di layar.");
                    }
                }
            }
            await checkPause()

            await page.locator('span:has-text("Nama"), span:has-text("NIK")').last().click();
            await page.locator('div:text-is("NIK")').last().click();

            const inputNik = page.locator('#searchNik').last();

            // 1. Bersihkan dulu kotaknya (berjaga-jaga)
            await inputNik.clear();

            // 2. 🌟 KETIK LANGSUNG DARI EXCEL: Ketik 1 per 1 dengan jeda 50 milidetik
            // Kita langsung masukkan String(row['NIK']) tanpa difilter lagi
            await inputNik.pressSequentially(String(row['NIK']).trim(), { delay: 1 });

            // 3. Beri jeda napas setengah detik agar sistem Kemenkes selesai memvalidasi
            await page.waitForTimeout(10);

            // 4. Baru tekan Enter
            await page.keyboard.press('Enter');

            await page.waitForTimeout(1000);

            sesi = "pencarian status pelayanan/pemeriksaan";

            Logger.info("Memeriksa tab status pemeriksaan (Belum/Sedang/Selesai)...");
            console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|memeriksa status pemeriksaan/pelayanan`);

            // 🌟 1. LOCATOR LEBIH KUAT: Memanfaatkan filter agar tidak tertipu span angka (seperti angka 5 di HTML-mu)
            const tabBelum = page.locator('div.cursor-pointer').filter({ hasText: 'Belum Pemeriksaan' }).last();
            const tabSedang = page.locator('div.cursor-pointer').filter({ hasText: 'Sedang Pemeriksaan' }).last();
            const tabSelesai = page.locator('div.cursor-pointer').filter({ hasText: 'Selesai Pemeriksaan' }).last();

            let statusTabel = "KOSONG";

            async function cekDanGeserTabel() {
                const targetNik = String(row['Nama Lengkap']).trim();

                // 🌟 1. KUNCI BARIS: Cari baris tabel (tr) yang BENAR-BENAR memuat NIK target
                const barisTarget = page.locator('tbody tr', { hasText: targetNik }).first();

                // Tunggu maksimal 3 detik sampai baris NIK target muncul di layar
                try {
                    await barisTarget.waitFor({ state: 'visible', timeout: 3000 });
                } catch (e) {
                    // Jika NIK target tidak muncul di baris tabel tab ini, anggap KOSONG
                    return "KOSONG";
                }

                // 🌟 2. GESER SCROLLBAR (Hanya dilakukan jika data NIK target terbukti ada)
                await page.evaluate(() => {
                    const elemenScroll = document.querySelectorAll('div, table, tbody');
                    elemenScroll.forEach(el => {
                        if (el.scrollWidth > el.clientWidth) {
                            el.scrollLeft = el.scrollWidth;
                        }
                    });
                });
                await checkPause()

                await page.waitForTimeout(500);

                // 🌟 3. BACA TEKS HANYA DARI BARIS NIK TARGET (Bukan dari judul tab atau header)
                const teksBaris = await barisTarget.innerText();

                // Evaluasi status berdasarkan teks di baris tersebut
                if (teksBaris.includes("Belum lengkap") || teksBaris.includes("Belum Pemeriksaan") || teksBaris.includes("Sedang Pemeriksaan")) {
                    return "BELUM_LENGKAP";
                }

                if (teksBaris.includes("Lengkap") && teksBaris.includes("Selesai Pemeriksaan")) {
                    return "SUDAH_LENGKAP";
                }

                return "KOSONG";
            }
            await checkPause()

            // ============================================
            // PROSES EKSEKUSI TAB
            // ============================================

            // Cek Tab 1 (Belum)
            await tabBelum.click({ force: true }).catch(() => { });
            statusTabel = await cekDanGeserTabel();

            // Cek Tab 2 (Sedang) JIKA tab 1 kosong
            if (statusTabel === "KOSONG") {
                Logger.info("Data tidak di tab Belum. Pindah ke tab Sedang...");
                await tabSedang.click({ force: true }).catch(() => { });
                statusTabel = await cekDanGeserTabel();
            }

            // Cek Tab 3 (Selesai) JIKA tab 2 kosong
            if (statusTabel === "KOSONG") {
                Logger.info("Data tidak di tab Sedang. Pindah ke tab Selesai...");
                await tabSelesai.click({ force: true }).catch(() => { });
                statusTabel = await cekDanGeserTabel();
            }

            // ============================================
            // KEPUTUSAN AKHIR
            // ============================================
            if (statusTabel === "SUDAH_LENGKAP") {
                row.Keterangan = "terdeteksi sudah pelayanan lengkap";
                console.log(`SUKSES | Data NIK ${nikPeserta} atas nama ${namaLengkap} tersimpan!`);
                Logger.info(`✅ Data NIK ${row['NIK']} sudah lengkap di sistem. Lanjut siswa berikutnya.`);
                console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|terdeteksi sudah lengkap`);
                continue;
            }
            else if (statusTabel === "KOSONG") {
                row.Keterangan = "Gagal: Data gaib / Tidak muncul di ketiga tab,kemungkinan faskes luar";
                console.log(`GAGAL | NIK ${nikPeserta} Tidak muncul di pelayanan, kemungkinan faskes luar`);
                Logger.info(`❌ Tabel kosong untuk NIK ${row['NIK']}. Melewati anak ini.`);
                console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Data tidak muncul di ketiga tab`);
                continue;
            }

            // Jika statusTabel === "BELUM_LENGKAP", dia akan lolos dari IF ini 
            // dan langsung otomatis melanjutkan ke skrip pengisian pelayananmu di bawahnya.
            Logger.info(`⏳ Status BELUM LENGKAP terdeteksi. Mulai mengeksekusi form pelayanan...`);
            console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|status belum lengkap .. gas eksekusi`);

            // Ganti lokasi pencarian tombol Mulai agar spesifik pada NIK target
            const barisTarget = page.locator('tbody tr', { hasText: String(row['Nama Lengkap']).trim() }).first();
            const tombolMulaiTabel = barisTarget.locator('button:has-text("Mulai")');

            if (await tombolMulaiTabel.isVisible()) {
                await tombolMulaiTabel.scrollIntoViewIfNeeded();
                await tombolMulaiTabel.click({ force: true });
            } else {
                row.Keterangan = "Gagal: Tombol Mulai tidak ditemukan pada baris Nama target";
                console.log(`GAGAL | NIK ${nikPeserta} Tombol Mulai tidak ditemukan pada baris Nama target`);
                continue;
            }

            Logger.info("Menunggu halaman pemeriksaan dimuat...");
            await page.waitForTimeout(1000);

            Logger.info("Menunggu halaman form klinis dimuat...");
            await page.waitForTimeout(1000);

            const btnMulaiPemeriksaan = page.locator('button:has-text("Mulai Pemeriksaan")').last();
            if (await btnMulaiPemeriksaan.isVisible()) {
                await btnMulaiPemeriksaan.click();
                await page.waitForTimeout(1000);

                const btnSimpanTgl = page.locator('button:has-text("Simpan")').last();
                if (await btnSimpanTgl.isVisible()) {
                    await btnSimpanTgl.click();
                    await page.waitForTimeout(2000);
                }
            } else {
                await page.waitForTimeout(1000);
            }

            sesi = "form pemeriksaan mandiri";
            await checkPause()

            // ==========================================
            // 🌟 SUNTIKAN LOGIKA UMUR (Untuk Status Perkawinan)
            // ==========================================
            let cekStatus = String(row['Status Pernikahan'] || '').trim();
            if (!cekStatus || cekStatus === 'undefined' || cekStatus === 'null') {
                Logger.info("⚠️ Kolom Status Pernikahan KOSONG di Pemeriksaan Mandiri! Menghitung dari umur...");

                let tahunLahir = 0;
                const tanggalLahirAsli = row['Tanggal lahir'];

                if (tanggalLahirAsli instanceof Date) {
                    tahunLahir = tanggalLahirAsli.getFullYear();
                } else if (typeof tanggalLahirAsli === 'string' && tanggalLahirAsli.includes('-')) {
                    const bagian = tanggalLahirAsli.split('-');
                    if (bagian.length === 3) {
                        tahunLahir = (bagian[0].length === 4) ? parseInt(bagian[0], 10) : parseInt(bagian[2], 10);
                    }
                }

                if (tahunLahir > 0) {
                    const umur = new Date().getFullYear() - tahunLahir;
                    if (umur < 19) {
                        row['Status Pernikahan'] = "Belum Menikah"; // Menulis ke dalam memori row
                    } else {
                        row['Status Pernikahan'] = "Menikah";
                    }
                    Logger.info(`=> Memutuskan status otomatis form mandiri: ${row['Status Pernikahan']} (Umur: ${umur} tahun)`);
                }
            }
            await checkPause()

            // ==========================================
            // 🌟 1. KAMUS PINTAR (Untuk form umum yang dibaca per soal)
            // ==========================================
            const kamusPintar = [
                { kolom: 'Status Pernikahan', kataKunci: 'Status Perkawinan' },
                { kolom: 'Disabilitas', kataKunci: 'apakah anda penyandang disabilitas' },
                { kolom: 'Hamil', kataKunci: 'apakah anda sedang hamil' }
            ];



            // 🌟 2. KAMUS LAYANAN KHUSUS / JALUR PINTAS (Bypass berdasarkan nama layanan)
            const kamusLayananKhusus = [
                {
                    kataKunciLayanan: 'Faktor Risiko Kanker Usus',
                    kolomExcel: 'Faktor Risiko Kanker Usus',
                    rumus: {
                        'TIDAK': ["Tidak", "Tidak"],
                        'IYA': ["Ya", "Tidak"]
                    }
                },
                {
                    kataKunciLayanan: 'Faktor Risiko TB - Dewasa & Lansia',
                    kolomExcel: 'Faktor Risiko TB - Dewasa & Lansia',
                    rumus: { 'TIDAK': ["Tidak"] }
                },
                {
                    kataKunciLayanan: 'Hati',
                    kolomExcel: 'Hati',
                    rumus: { 'NORMAL': ["Tidak", "Tidak", "Tidak", "Tidak", "Tidak", "Tidak", "Tidak", "Tidak", "Tidak"] }
                },
                {
                    kataKunciLayanan: 'Kanker Leher Rahim',
                    kolomExcel: 'Kanker Leher Rahim',
                    rumus: {
                        'IYA': ["Ya"],
                        'TIDAK': ["Tidak"]
                    }
                },
                {
                    kataKunciLayanan: 'Kesehatan Jiwa',
                    kolomExcel: 'Kesehatan Jiwa',
                    rumus: {
                        'BAIK': ["Tidak sama sekali", "Tidak sama sekali", "Tidak sama sekali", "Tidak sama sekali"],
                        'KURANG BAIK': ["Tidak sama sekali", "Kurang dari 1 minggu", "Tidak sama sekali", "Tidak sama sekali"]
                    }
                },
                {
                    kataKunciLayanan: 'Penapisan Risiko Kanker Paru',
                    kolomExcel: 'Penapisan Risiko Kanker Paru',
                    rumus: { 'NORMAL': ["Tidak", "Tidak", "Tidak", "Tidak", "Tidak", "Tidak"] }
                },
                {
                    kataKunciLayanan: 'Perilaku Merokok',
                    kolomExcel: 'Perilaku Merokok',
                    rumus: {
                        'TIDAK': ["Tidak", "Tidak", "Tidak"],
                        'IYA': ["ya", "Keduanya", "1", "5", "Ya"]
                    }
                },
                {
                    kataKunciLayanan: 'Tingkat Aktivitas Fisik (sedang dan berat)',
                    kolomExcel: 'Tingkat Aktivitas Fisik (sedang dan berat)',
                    rumus: {
                        'BAIK': ["Ya", "4", "60", "Tidak", "Ya", "3", "60", "Tidak", "Tidak", "Tidak"],
                        'SANGAT BAIK': ["Ya", "7", "120", "Ya", "Ya", "5", "120", "Ya", "Ya", "Tidak"]
                    }
                },
                {
                    kataKunciLayanan: 'Riwayat Imunisasi Tetanus(Status T) - Hanya untuk Catin',
                    kolomExcel: 'TT Catin',
                    rumus: {
                        'TIDAK TAHU': ["Tidak tahu atau tidak ingat"]

                    }
                }
            ];
            await checkPause()

            // ============================================================
            // 6. FASE PEMERIKSAAN MANDIRI (NAVIGASI + SMART FILLING)
            // ============================================================
            Logger.info("Mengecek status Pemeriksaan Mandiri...");
            let adaMandiri = true;
            let layananTerproses = [];
            let gagalLoop = 0;

            while (adaMandiri) {
                // Jeda agar tabel Kemenkes selesai loading/refresh
                await page.waitForTimeout(1000);

                const semuaBarisAbu = page.locator('tr:has(img[src*="icon-success-gray.svg"]):has(button:has-text("Input Data"))').filter({ visible: true });
                const jumlahBarisAbu = await semuaBarisAbu.count();

                let barisMandiri = null;
                let namaBersih = "";

                for (let k = 0; k < jumlahBarisAbu; k++) {
                    const kandidatBaris = semuaBarisAbu.nth(k);
                    const namaPemeriksaan = await kandidatBaris.locator('td').first().textContent().catch(() => "");
                    const namaClean = namaPemeriksaan.trim();

                    if (!layananTerproses.includes(namaClean)) {
                        barisMandiri = kandidatBaris;
                        namaBersih = namaClean;
                        break;
                    }
                }

                // Jika tidak ada baris baru yang ditemukan
                if (!barisMandiri) {
                    if (gagalLoop < 2 && jumlahBarisAbu > 0) {
                        gagalLoop++;
                        await page.waitForTimeout(2000);
                        continue;
                    }
                    adaMandiri = false;
                    Logger.info("✅ Semua Pemeriksaan Mandiri sudah selesai atau telah dilewati.");
                    break;
                }

                gagalLoop = 0; // Reset counter
                Logger.info(`Mengisi Mandiri: ${namaBersih}`);
                console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|mengisi skrining mandiri`);
                layananTerproses.push(namaBersih);

                await barisMandiri.locator('button:has-text("Input Data")').click({ force: true });
                await page.waitForTimeout(500);

                // DETEKSI JENIS RUMUS
                let rumusBakuTerditeksi = null;
                for (let layanan of kamusLayananKhusus) {
                    if (namaBersih.toLowerCase().includes(layanan.kataKunciLayanan.toLowerCase())) {
                        let statusDiExcel = String(row[layanan.kolomExcel] || "").trim();
                        let keyRumus = statusDiExcel.toUpperCase();

                        if (layanan.rumus[keyRumus]) {
                            rumusBakuTerditeksi = layanan.rumus[keyRumus];
                            Logger.info(`⚡ Jalur Pintas Aktif! Menggunakan rumus [${keyRumus}]`);
                        }
                        break;
                    }
                }
                await checkPause()
                // ==========================================
                // 🤖 ENGINE PENGISI OTOMATIS (3-LEVEL SMART MATCH)
                // ==========================================
                let indexSoal = 0;
                let sabukPengamanLoading = 0;

                while (true) {
                    let jmlSoalSaatIni = await page.locator('.sd-question').filter({ visible: true }).count();

                    // 🌟 TENGOK ULANG: Kemenkes sering lambat memunculkan soal beranak
                    if (indexSoal >= jmlSoalSaatIni) {
                        await page.waitForTimeout(1000);
                        jmlSoalSaatIni = await page.locator('.sd-question').filter({ visible: true }).count();

                        if (indexSoal >= jmlSoalSaatIni) {
                            sabukPengamanLoading++;
                            if (sabukPengamanLoading >= 3) { // Toleransi kita naikkan jadi 3 detik
                                break;
                            }
                            continue; // Ulangi loop buat ngecek lagi
                        }
                    }
                    await checkPause()

                    sabukPengamanLoading = 0; // Reset sabuk jika ada soal baru
                    const kotakSoal = page.locator('.sd-question').filter({ visible: true }).nth(indexSoal);
                    let teksSoalWeb = await kotakSoal.locator('.sd-question__title').innerText().catch(() => "");
                    let jawabanTarget = null;

                    // 1. Tentukan Jawaban Target (Dari Rumus / Kamus Pintar)
                    if (rumusBakuTerditeksi && indexSoal < rumusBakuTerditeksi.length) {
                        jawabanTarget = String(rumusBakuTerditeksi[indexSoal]).trim();
                    }
                    else if (!rumusBakuTerditeksi) {
                        for (let item of kamusPintar) {
                            if (teksSoalWeb.toLowerCase().includes(item.kataKunci.toLowerCase())) {
                                if (row[item.kolom]) {
                                    jawabanTarget = String(row[item.kolom]).trim();
                                    Logger.info(`🔍 Cocok! Web "${item.kataKunci}" -> Excel "${item.kolom}" (${jawabanTarget})`);
                                }
                                break;
                            }
                        }
                    }

                    // 2. Eksekusi Jawaban ke Layar
                    if (jawabanTarget) {
                        await kotakSoal.scrollIntoViewIfNeeded().catch(() => { });
                        await page.waitForTimeout(200);


                        const adaRadio = await kotakSoal.locator('.sd-radio').count() > 0;
                        const adaDropdown = await kotakSoal.locator('.sd-dropdown, .sv-dropdown').count() > 0;
                        const adaInput = await kotakSoal.locator('input[type="text"], input[type="number"]').count() > 0;

                        let daftarJawaban = jawabanTarget.split(/[/,]/).map(j => j.trim()).filter(j => j !== "");
                        let berhasilTerisi = false;
                        await checkPause()

                        for (let teksJawab of daftarJawaban) {
                            if (berhasilTerisi) break;
                            let targetKecil = teksJawab.toLowerCase();

                            if (adaRadio || adaDropdown) {
                                let opsiElemen;
                                if (adaDropdown) {
                                    // Buka menu Dropdown
                                    await kotakSoal.locator('.sd-dropdown, .sv-dropdown').first().click({ force: true }).catch(() => { });
                                    await page.waitForTimeout(600); // Tunggu animasi menu buka

                                    // 🌟 PERBAIKAN FATAL 1: Hindari klik opsi hantu! Hanya ambil pilihan yang sedang nampak di layar
                                    opsiElemen = page.locator('.sv-list__item, .sd-dropdown__item').filter({ visible: true });
                                } else {
                                    opsiElemen = kotakSoal.locator('label').filter({ visible: true });
                                }

                                const totalOpsi = await opsiElemen.count();
                                let kandidatElemen = null;
                                let tipeMatch = "";

                                // PRIORITAS 1: Persis Sama
                                for (let o = 0; o < totalOpsi; o++) {
                                    let teksWeb = (await opsiElemen.nth(o).innerText().catch(() => "")).toLowerCase().trim();
                                    if (teksWeb === targetKecil) {
                                        kandidatElemen = opsiElemen.nth(o);
                                        tipeMatch = "Persis Sama";
                                        break;
                                    }
                                }

                                // PRIORITAS 2: Web mengandung Excel
                                if (!kandidatElemen) {
                                    for (let o = 0; o < totalOpsi; o++) {
                                        let teksWeb = (await opsiElemen.nth(o).innerText().catch(() => "")).toLowerCase().trim();
                                        if (teksWeb.includes(targetKecil) && targetKecil.length > 1) {
                                            kandidatElemen = opsiElemen.nth(o);
                                            tipeMatch = "Web Mengandung Teks";
                                            break;
                                        }
                                    }
                                }

                                // PRIORITAS 3: Excel mengandung Web
                                if (!kandidatElemen) {
                                    for (let o = 0; o < totalOpsi; o++) {
                                        let teksWeb = (await opsiElemen.nth(o).innerText().catch(() => "")).toLowerCase().trim();
                                        if (targetKecil.includes(teksWeb) && teksWeb.length > 1) {
                                            kandidatElemen = opsiElemen.nth(o);
                                            tipeMatch = "Excel Mengandung Teks";
                                            break;
                                        }
                                    }
                                }

                                // EKSEKUSI KLIK
                                if (kandidatElemen) {
                                    await kandidatElemen.click({ force: true }).catch(() => { });
                                    Logger.info(`✅ Dipilih (${tipeMatch}): Target "${teksJawab}"`);
                                    berhasilTerisi = true;
                                }

                            }
                            else if (adaInput) {
                                const kotakKetik = kotakSoal.locator('input[type="text"], input[type="number"]').first();
                                await kotakKetik.clear().catch(() => { });
                                await kotakKetik.fill(teksJawab).catch(() => { });
                                Logger.info(`✅ Isi Kolom Input: "${teksJawab}"`);
                                berhasilTerisi = true;
                            }
                        }

                        // 🌟 PERBAIKAN FATAL 2: JEDA NAFAS UNTUK KEMENKES!
                        // Ini wajib ada, agar setelah robot ngeklik "Ya", Kemenkes punya waktu 0.6 detik untuk memunculkan soal anakannya.
                        await page.waitForTimeout(600);
                    }

                    indexSoal++;
                }
                await checkPause()

                // TAHAP AKHIR: KIRIM FORM
                // 🌟 PERBAIKAN: Gunakan .filter({ visible: true }) agar tidak salah ngeklik tombol Kirim yang tersembunyi
                const btnKirimMandiri = page.locator('input[title="Kirim"], button[title="Kirim"], button:has-text("Kirim"), .sd-btn--action:has-text("Kirim")').filter({ visible: true }).last();

                if (await btnKirimMandiri.count() > 0) {
                    await klikAntiMacet(page, btnKirimMandiri, `Kirim Mandiri ${namaBersih}`);
                } else {
                    Logger.info(`⚠️ Tombol Kirim untuk ${namaBersih} tidak ditemukan, mencoba melanjutkan...`);
                }

                await page.waitForTimeout(1500);

                // 🌟 TANGKAP POPUP SUKSES / ERROR (Penyebab utama layar terkunci)
                const popupOk = page.locator('button:has-text("OK"), button:has-text("Tutup")').filter({ visible: true });
                if (await popupOk.count() > 0) {
                    Logger.info("⚠️ Menutup popup informasi...");
                    await popupOk.first().click({ force: true }).catch(() => { });
                    await page.waitForTimeout(1000);
                }

                // 🌟 PROTEKSI MODAL MACET: Pastikan form hilang sebelum lanjut ke baris berikutnya, kalau tidak, klik Batal!
                const modalMasihBuka = page.locator('.sd-root-modern, .modal-dialog, form').filter({ visible: true });
                // Cek apakah tabel utama sudah bisa terlihat atau belum
                if (await modalMasihBuka.count() > 0 && await page.locator('tr:has-text("Input Data")').count() === 0) {
                    Logger.info(`⚠️ Form ${namaBersih} macet tidak tertutup! Memaksa tutup...`);
                    const btnBatal = page.locator('button:has-text("Batal"), button:has-text("Kembali"), .close').filter({ visible: true });

                    if (await btnBatal.count() > 0) {
                        await btnBatal.first().click({ force: true }).catch(() => { });
                    } else {
                        await page.keyboard.press('Escape'); // Jurus pamungkas nutup modal
                    }
                    await page.waitForTimeout(1000);
                }
            }
            // ============================================================
            // 7. FASE PEMERIKSAAN OLEH NAKES
            // ============================================================
            sesi = "Pemeriksaan oleh nakes";
            await checkPause()

            await isiFormLayanan(page, "Gizi", async () => {
                const bb = hitungNilaiNormal(row['Berat Badan'], "Berat Badan", row['Tanggal lahir']);
                const tb = hitungNilaiNormal(row['Tinggi Badan'], "Tinggi Badan", row['Tanggal lahir']);
                const lp = hitungNilaiNormal(row['Lingkar Perut'], "Lingkar Perut", row['Tanggal lahir']);

                // Tembak menggunakan placeholder bawaan Kemenkes agar kebal dari perubahan ID
                await page.locator('input[placeholder*="isikan dalam satuan kg, dengan koma diisi dengan (.)"]').last().fill(bb);
                await page.locator('input[placeholder*="Isi sesuai hasil pengukuran tinggi badan dalam cm"]').last().fill(tb);
                await page.locator('input[placeholder*="Isi sesuai hasil pengukuran"]').last().fill(lp);
            });

            await isiFormLayanan(page, "Tekanan Darah", async () => {
                await page.locator('span.sv-string-viewer:has-text("Tidak")').last().click();
                const sistol = hitungNilaiNormal(row['Sistol'], "Sistol", row['Tanggal lahir']);
                const diastol = hitungNilaiNormal(row['Diastol'], "Diastol", row['Tanggal lahir']);
                const inputs = page.locator('input.sd-input.sd-text[type="number"]');
                await inputs.nth(0).fill(sistol);
                await inputs.nth(1).fill(diastol);
            });

            await isiFormLayanan(page, "Pemeriksaan Gula Darah", async () => {
                await page.locator('span.sv-string-viewer:has-text("Tidak")').last().click();
                const gd = hitungNilaiNormal(row['Gula Darah'], "Gula Darah", row['Tanggal lahir']);
                await page.locator('input.sd-input.sd-text[id="sq_102i"]').last().fill(gd);
            });

            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForTimeout(1000);

            const btnSelesaiLayanan = page.getByRole('button', { name: /Selesaikan Layanan/i }).first();

            if (await btnSelesaiLayanan.isVisible()) {
                Logger.info("Mengklik tombol Selesaikan Layanan...");
                await klikAntiMacet(page, btnSelesaiLayanan, "Selesaikan Layanan");

                const notifSelesai = await Promise.race([
                    page.getByRole('button', { name: /Konfirmasi/i }).waitFor({ state: 'visible', timeout: 3000 }).then(() => 'ADA_KONFIRMASI'),
                    page.waitForTimeout(1000).then(() => 'TIDAK_ADA_KONFIRMASI')
                ]);

                if (notifSelesai === 'ADA_KONFIRMASI') {
                    await page.getByRole('button', { name: /Konfirmasi/i }).click();
                    Logger.info("Pop-up konfirmasi berhasil disetujui.");
                    await page.waitForTimeout(1500);
                }
            } else {
                Logger.info("Tombol Selesaikan Layanan tidak ditemukan (Mungkin sudah berstatus Selesai).");
            }
            await checkPause()

            row.jumlahCoba = undefined;
            row.Keterangan = "Berhasil Selesai Pelayanan";
            console.log(`SUKSES | Data NIK ${nikPeserta} atas nama ${namaLengkap} tersimpan!`);

            Logger.info(`Tuntas untuk NIK ${row['NIK']}`);
            console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Berhasil Selesai Pelayanan`);

        } catch (error) {
            // 1. Ekstrak pesan error dengan aman menggunakan Type Guard / Opsional Chaining
            // Jika error adalah objek dan punya properti message, ambil nilainya. Jika tidak, jadikan string kosong.
            let pesanError = (error && typeof error === 'object' && 'message' in error)
                ? String(error.message)
                : String(error || '');

            // Jika string kosong, beri nilai default "Unknown Error"
            pesanError = pesanError || "Unknown Error";

            let pesanErrorForm1 = pesanError.split('\n')[0];
            const isTimeout = pesanError.toLowerCase().includes("timeout");

            if (isTimeout && row.jumlahCoba < 3) {
                Logger.info(`⚠️ Terdeteksi Timeout lambat pada NIK ${row['NIK']}. Akan diulang (Menuju percobaan ke-${row.jumlahCoba + 1})...`);
                row.jumlahCoba += 1;
                i--;

                Logger.info("Mencoba me-reload halaman...");
                console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Reload Halaman`);
                await page.reload({ waitUntil: 'networkidle' }).catch(() => { });
                // Catatan: Jika menggunakan Playwright terbaru, ganti waitForTimeout ke page.waitForTimeout
                await page.waitForTimeout(2500);
            } else {
                if (pesanError.includes("TIMEOUT_SERVER")) {
                    row.Keterangan = `Gagal [${sesi}]: Server Kemenkes Lemot (setelah ${row.jumlahCoba}x coba)`;
                    console.log(`GAGAL | NIK ${nikPeserta} bermasalah. Alasan: ${pesanError}`);
                } else {
                    row.Keterangan = `Gagal [${sesi}]: ${pesanError}`;
                    console.log(`GAGAL | NIK ${nikPeserta} bermasalah. Alasan: ${pesanError}`);
                }
                Logger.error(`❌ Menyerah pada NIK ${row['NIK']} setelah ${row.jumlahCoba}x mencoba di [${sesi}]: ${pesanError}`);
                row.jumlahCoba = undefined;



                Logger.info("🔄 Error fatal / macet total. Me-reset browser kembali ke halaman awal untuk siswa berikutnya...");
                await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pendaftaran-individu', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => { });
                await page.waitForTimeout(2000);
            }

        } finally {
            ExcelManager.writeExcel(dataPeserta, excelPath);
        }
    }


    Logger.info("Selesai mengeksekusi semua data Excel.");

    await browser.close();
    process.exit(0);
}

runAutomation();