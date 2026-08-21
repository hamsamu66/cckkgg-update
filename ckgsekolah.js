const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ExcelManager = require('./utils/excelManager');
const Logger = require('./utils/logger');

/// 1. SISTEM PAUSE & RESUME (WAJIB ADA)
// ==========================================
let isPaused = false;
let resumeResolver = null;

process.stdin.on('data', (data) => {
    const command = data.toString().trim();
    if (command === 'PAUSE') {
        isPaused = true;
        console.log('Sistem di-pause. Menunggu instruksi resume...');
    } else if (command === 'RESUME') {
        isPaused = false;
        if (resumeResolver) {
            resumeResolver();
            resumeResolver = null;
        }
        console.log('Sistem di-resume. Melanjutkan eksekusi...');
    }
});

async function checkPause() {
    if (isPaused) {
        await new Promise(resolve => { resumeResolver = resolve; });
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
            await loaderHitam.waitFor({ state: 'hidden', timeout: 15000 });
            return true;

        } catch (error) {
            Logger.info(`⚠️ Server lemot saat klik ${namaAksi}. Mengulang (Percobaan ${i}/${maxPercobaan})...`);
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
    page.on('framenavigated', async (frame) => {
        if (frame === page.mainFrame()) {
            const currentUrl = frame.url();
            if (currentUrl.includes('/auth/login')) {
                console.log(`[Akun ${idAkun}] 🔴 Terdeteksi lempar ke login: ${currentUrl}. Langsung Close!`);
                try {
                    if (!page.isClosed()) {
                        await page.close();
                    }
                } catch (e) { }
            }
        }
    });
    // ==========================================

    await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pendaftaran-individu', { waitUntil: 'networkidle' });
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
            await checkPause();
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

                sesi = "Form pendaftaran Pertama";
                console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Mengisi Form Pendaftaran pertama`);
                sesi = "Form pendaftaran Pertama";
                await checkPause()
                // ============================================
                // A. SESI PENDAFTARAN (Form Pertama)
                // ============================================
                await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pendaftaran-anak-sekolah', { waitUntil: 'networkidle' });
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

                    await page.locator('span:has-text("Pilih jenis kelamin"), div:has-text("Pilih jenis kelamin")').last().click();
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

                const tombolSelanjutnya = page.locator('button:has-text("Selanjutnya")').filter({ visible: true }).first();
                await tombolSelanjutnya.waitFor({ state: 'visible', timeout: 5000 });


                // 🌟 FITUR 1: MENGGUNAKAN KLIK ANTI-MACET
                await klikAntiMacet(page, tombolSelanjutnya, "Selanjutnya (Cek NIK Awal di form pendaftaran pertama)");
                await checkPause()

                Logger.info("Menunggu check sistem validasi NIK...");
                console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|menunggu check validasi NIK`);

                // --- BALAPAN PERTAMA (TERMASUK DETEKSI KUOTA HABIS) ---
                let popupResult = await Promise.race([
                    page.waitForSelector('div:has-text("Data peserta valid")', { timeout: 10000 }).then(() => 'VALID'),
                    page.waitForSelector('div:has-text("Kuota Pemeriksaan Habis")', { timeout: 10000 }).then(() => 'KUOTA_HABIS'),
                    page.waitForSelector('div:has-text("Data peserta tidak valid")', { timeout: 10000 }).then(() => 'TIDAK_SESUAI'),
                    page.waitForSelector('div:has-text("Individu sudah menerima layanan")', { timeout: 10000 }).then(() => 'SUDAH_PELAYANAN')
                ]).catch(() => 'TIMEOUT_SERVER');

                // JIKA KENA LIMIT KUOTA, ROBOT AKAN MEMAKSA LANJUT (BYPASS)
                if (popupResult === 'KUOTA_HABIS') {
                    Logger.info(`⚠️ NIK ${row['NIK']} kena limit kuota harian. Memaksa lanjut (Bypass)...`);
                    console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Kuota Habis (Bypass)`);

                    const tombolLanjutkan = page.locator('div.tracking-wide:has-text("Lanjut"), button:has-text("Lanjut")').filter({ visible: true }).last();
                    await tombolLanjutkan.waitFor({ state: 'visible', timeout: 5000 });
                    await tombolLanjutkan.click({ force: true });
                    await page.waitForTimeout(1000);

                    // --- BALAPAN KEDUA (CEK STATUS SETELAH BYPASS) ---
                    popupResult = await Promise.race([
                        page.waitForSelector('div:has-text("Data peserta valid")', { timeout: 10000 }).then(() => 'VALID'),
                        page.waitForSelector('div:has-text("Data peserta tidak valid")', { timeout: 10000 }).then(() => 'TIDAK_SESUAI'),
                        page.waitForSelector('div:has-text("Individu sudah menerima layanan")', { timeout: 10000 }).then(() => 'SUDAH_PELAYANAN')
                    ]).catch(() => 'TIMEOUT_SERVER');
                }
                await checkPause()
                if (popupResult === 'VALID') {
                    Logger.info(`NIK ${row['NIK']} VALID. Menuju form kedua...`);
                    // Memastikan variabel namaLengkap, nikPeserta, dll sudah didefinisikan sebelumnya
                    console.log(`KERJA|${row['Nama Lengkap'] || 'Tanpa Nama'}|${row['NIK']}|Baris ke-${row.jumlahCoba}|menuju form kedua`);

                    try {
                        const Lanjutkan = page.locator('button:has-text("Lanjutkan")').filter({ visible: true }).first();
                        await Lanjutkan.waitFor({ state: 'visible', timeout: 5000 });
                        await klikAntiMacet(page, Lanjutkan, "Lanjutkan(Cek NIK Awal di form pendaftaran pertama)");
                    } catch (e) {
                        Logger.info("⚠️ Tombol Lanjutkan terlewat/sudah tertekan. Lanjut ke form 2...");
                    }

                    sesi = "Form pendaftaran Kedua";
                    await page.waitForTimeout(1500);
                    if (dataOtomatisDitemukan) {
                        // ==========================================
                        // 1. DISABILITAS (Diperbaiki agar tidak mencari teks "Pilih...")
                        // ==========================================
                        if (row['penyandang disabilitas']) {
                            try {
                                const targetDisabilitas = String(row['penyandang disabilitas']).trim();
                                // Tembak kotak disabilitas pakai XPath (mirip caramu di Sekolah)
                                const kotakDisabilitas = page.locator('xpath=//*[contains(text(), "Disabilitas")]/following::div[contains(@class, "cursor-pointer")][1]');

                                if (await kotakDisabilitas.isVisible({ timeout: 2000 })) {
                                    const teksSaatIni = (await kotakDisabilitas.innerText()).trim();

                                    if (teksSaatIni.toLowerCase() === targetDisabilitas.toLowerCase()) {
                                        Logger.info(`✅ [Disabilitas] Sudah sesuai (${teksSaatIni}).`);
                                    } else {
                                        Logger.info(`🔄 [Disabilitas] Ubah ke ${targetDisabilitas}...`);
                                        await kotakDisabilitas.click({ force: true, timeout: 2000 });
                                        await page.waitForTimeout(500);
                                        await page.locator(`div:has-text("${targetDisabilitas}")`).last().click({ force: true, timeout: 2000 });
                                    }
                                }
                            } catch (e) {
                                Logger.info(`⏩ [Disabilitas] Terkunci / Gagal. Lewati...`);
                            }
                        }

                        // ==========================================
                        // 2. PEKERJAAN (Diperbaiki dengan pembungkus try-catch penuh)
                        // ==========================================
                        if (row['pekerjaan']) {
                            try {
                                const targetPekerjaan = String(row['pekerjaan']).trim();
                                const pekerjaanSudahBenar = await page.locator(`div:text-is("${targetPekerjaan}")`).last().isVisible({ timeout: 2000 });

                                if (pekerjaanSudahBenar) {
                                    Logger.info(`✅ Pekerjaan otomatis terisi: ${targetPekerjaan}. Lanjut...`);
                                } else {
                                    Logger.info(`🔄 [Pekerjaan] Mengubah ke ${targetPekerjaan}...`);
                                    const searchInput = page.locator('input[placeholder="Cari pekerjaan"]');
                                    await searchInput.click({ force: true, timeout: 2000 }).catch(async () => {
                                        // Jika input tidak ada, klik dropdown-nya dulu
                                        await page.locator('xpath=//*[contains(text(), "Pekerjaan")]/following::div[contains(@class, "cursor-pointer")][1]').click({ force: true });
                                    });
                                    await page.waitForTimeout(500);
                                    await searchInput.fill(targetPekerjaan);
                                    await page.waitForTimeout(500);
                                    await page.locator(`div:text-is("${targetPekerjaan}")`).last().click({ force: true, timeout: 2000 });
                                }
                            } catch (error) {
                                Logger.info(`⚠️ Info: Gagal mengubah Pekerjaan. Mungkin dikunci sistem.`);
                            }
                        }

                        // ==========================================
                        // 3. NAMA SEKOLAH (Kodemu: SANGAT BAGUS!)
                        // ==========================================
                        if (row['Nama Sekolah']) {
                            try {
                                const targetSekolah = String(row['Nama Sekolah']).trim();
                                const kotakSekolah = page.locator('xpath=//*[contains(text(), "Nama Sekolah")]/following::div[contains(@class, "cursor-pointer")][1]');
                                await kotakSekolah.waitFor({ state: 'visible', timeout: 3000 });

                                const teksSaatIni = (await kotakSekolah.innerText()).trim();

                                if (teksSaatIni.toLowerCase() === targetSekolah.toLowerCase()) {
                                    Logger.info(`✅ [Nama Sekolah] Sudah sesuai (${teksSaatIni}). Skip...`);
                                } else {
                                    Logger.info(`🔄 [Nama Sekolah] Saat ini "${teksSaatIni}" -> Ubah ke "${targetSekolah}"`);
                                    await kotakSekolah.click({ force: true });
                                    await page.waitForTimeout(500);

                                    const searchInput = page.locator('input[placeholder*="Cari nama sekolah"]').last();
                                    await searchInput.waitFor({ state: 'visible', timeout: 3000 });
                                    await searchInput.fill(targetSekolah);
                                    await page.waitForTimeout(500);

                                    // Pilih hasil dari dropdown list
                                    const opsiSekolah = page.locator('button').filter({ hasText: targetSekolah }).last();
                                    await opsiSekolah.waitFor({ state: 'visible', timeout: 3000 });
                                    await opsiSekolah.click({ force: true });
                                }
                            } catch (e) {
                                Logger.info(`⏩ [Nama Sekolah] Terkunci / Gagal. Lewati...`);
                            }
                        }

                        // ==========================================
                        // 4. JENJANG PENDIDIKAN (Kodemu: SANGAT BAGUS!)
                        // ==========================================
                        const rawJenjang = String(row['Kelas / Jenjang'] || '');
                        const angkaJenjang = rawJenjang.match(/\d+/)?.[0];

                        if (angkaJenjang) {
                            try {
                                const kotakJenjang = page.locator('xpath=//*[contains(text(), "Jenjang")]/following::div[contains(@class, "cursor-pointer")][1]');
                                await kotakJenjang.waitFor({ state: 'visible', timeout: 3000 });

                                const teksSaatIni = (await kotakJenjang.innerText()).trim();

                                if (teksSaatIni.includes(angkaJenjang)) {
                                    Logger.info(`✅ [Jenjang Pendidikan] Sudah sesuai (${teksSaatIni}). Skip...`);
                                } else {
                                    Logger.info(`🔄 [Jenjang Pendidikan] Saat ini "${teksSaatIni}" -> Ubah ke Kelas ${angkaJenjang}`);
                                    await kotakJenjang.click({ force: true });
                                    await page.waitForTimeout(500);

                                    const searchInput = page.locator('input[placeholder*="Cari jenjang"]').last();
                                    await searchInput.waitFor({ state: 'visible', timeout: 3000 });
                                    await searchInput.fill(angkaJenjang);
                                    await page.waitForTimeout(500);

                                    // Pilih hasil dari dropdown list
                                    const opsiJenjang = page.locator('button').filter({ hasText: `Kelas ${angkaJenjang}` }).last();
                                    await opsiJenjang.waitFor({ state: 'visible', timeout: 3000 });
                                    await opsiJenjang.click({ force: true });
                                }
                            } catch (e) {
                                Logger.info(`⏩ [Jenjang Pendidikan] Terkunci / Gagal. Lewati...`);
                            }
                        }
                    }

                    // ==========================================
                    // 5. ALAMAT DOMISILI (Diperbaiki pakai .check() dan try-catch)
                    // ==========================================
                    try {
                        // Gunakan .check() BUKAN .click() agar tidak menghilangkan centang jika sudah tercentang
                        await page.locator('input[name="sameAddress"]').last().check({ force: true, timeout: 2000 });
                    } catch (e) {
                        Logger.info(`⏩ [Checkbox Alamat] Gagal / Tidak Ditemukan. Lewati...`);
                    }

                    if (row['Detail Domisili']) {
                        try {
                            await page.locator('textarea[name="detail-domisili"]').last().fill(String(row['Detail Domisili']), { timeout: 2000 });
                        } catch (e) {
                            Logger.info(`⏩ [Detail Domisili] Terkunci / Gagal. Lewati...`);
                        }
                    }

                    const btnSelanjutnyaForm2 = page.locator('div.tracking-wide:has-text("Selanjutnya")').last();
                    await checkPause()
                    // 🌟 FITUR 1: MENGGUNAKAN KLIK ANTI-MACET
                    await page.waitForTimeout(500);
                    await klikAntiMacet(page, btnSelanjutnyaForm2, "Selanjutnya (Form 2)");

                    const notifDaftar = await Promise.race([
                        page.waitForSelector('div:has-text("Berhasil Daftar")', { timeout: 10000 }).then(() => 'BERHASIL'),
                        page.waitForSelector('div:has-text("Data pasien tidak sesuai"),div.pb-2:has-text("Data peserta tidak valid"),div:has-text("Terjadi kesalahan")', { timeout: 10000 }).then(() => 'TIDAK_SESUAI'),
                        page.waitForSelector('div:has-text("Individu sudah")', { timeout: 10000 }).then(() => 'SUDAH_PELAYANAN')
                    ]).catch(() => 'TIMEOUT_SERVER');

                    if (notifDaftar === 'TIDAK_SESUAI') {
                        Logger.info(`NIK ${row['NIK']} data tidak sesuai di pengecekan form 2. Menyedot pesan...`);

                        // 🌟 TITIK 1: SEDOT PESAN ERROR DI FORM 2
                        // 🌟 TITIK 1: SEDOT PESAN ERROR DI FORM 2 (Ambil popup paling akhir)
                        let pesanErrorForm2 = "Data tidak sesuai (Detail tidak terbaca)";
                        try {
                            // Fokus pada model popup notif standar, ambil yang paling akhir (last)
                            const popupAktif = page.locator('div[role="dialog"], div.modal, .swal-modal, .swal2-popup, .el-message-box, .el-notification').filter({ visible: true }).last();

                            if (await popupAktif.count() > 0) {
                                pesanErrorForm2 = await popupAktif.innerText();
                            } else {
                                // Jika popup tidak berkotak (hanya teks melayang), sedot teks merahnya
                                pesanErrorForm2 = await page.locator('div.text-red-500, div:has-text("Data pasien tidak sesuai"), div:has-text("Terjadi kesalahan")').filter({ visible: true }).last().innerText();
                            }
                        } catch (e) { }

                        // Bersihkan teks enter agar jadi satu baris rapi di Excel
                        pesanErrorForm2 = pesanErrorForm2.replace(/\n/g, ' - ').trim();

                        row['notif'] = pesanErrorForm2; // Masuk kolom 'notif'
                        row.Keterangan = "Ditolak Form 2: Cek kolom notif";
                        console.log(`GAGAL | NIK ${nikPeserta} tidak valid. Alasan: ${pesanErrorForm2}`);

                        await page.locator('button:has-text("Tutup"),button:has-text("Periksa Kembali"),div:has-text("periksa kembali "), button:has-text("OK")').last().click();
                        await page.reload({ waitUntil: 'networkidle' });
                        await page.waitForTimeout(1000);
                        continue;
                        await checkPause()

                    } else if (notifDaftar === 'TIMEOUT_SERVER') {
                        throw new Error("TIMEOUT_SERVER: Web tidak merespon saat menyimpan Form 2.");
                    } else if (notifDaftar === 'BERHASIL') {
                        await page.locator('div:has-text("Tutup")').last().click({ force: true });
                    }
                }

                else if (popupResult === 'SUDAH_PELAYANAN') {
                    Logger.info(`NIK ${row['NIK']} Sudah Punya Data. Melewati form alamat...`);
                    console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|sudah ada data .. menuju pelayanan`);
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

                    // 🌟 TITIK 2: SEDOT PESAN ERROR DI FORM pendaftaran pertama
                    // 🌟 TITIK 2: SEDOT PESAN ERROR DI FORM PENDAFTARAN PERTAMA (Ambil popup paling akhir)
                    let pesanErrorForm1 = "Data tidak valid / ditolak sistem";
                    try {
                        const popupAktif = page.locator('div[role="dialog"], div.modal, .swal-modal, .swal2-popup, .el-message-box, .el-notification').filter({ visible: true }).last();

                        if (await popupAktif.count() > 0) {
                            pesanErrorForm1 = await popupAktif.innerText();
                        } else {
                            pesanErrorForm1 = await page.locator('div.text-red-500, div:has-text("Data peserta tidak valid"), div:has-text("tidak ditemukan")').filter({ visible: true }).last().innerText();
                        }
                    } catch (e) { }

                    // Bersihkan teks enter
                    pesanErrorForm1 = pesanErrorForm1.replace(/\n/g, ' - ').trim();
                    row['notif'] = pesanErrorForm1; // Masuk kolom 'notif'
                    row.Keterangan = "Ditolak Form 1: Cek kolom notif";
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
                await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pendaftaran-anak-sekolah', { waitUntil: 'networkidle' });
                await page.waitForTimeout(1500);
                await page.locator('div:has-text("Pilih sekolah")').last().click();
                await page.locator(`div:text-is("${row['Nama Sekolah']}")`).last().click();

                await page.locator('span:has-text("Pilih kelas")').last().click();
                await page.locator(`div:has-text("${row['Kelas / Jenjang']}")`).last().click();

                await page.locator('span:has-text("Nomor Tiket"), span:has-text("NIK")').last().click({ force: true });
                await page.locator('div:text-is("NIK")').last().click();
                await page.locator('input[name="NIK"], input#nik').last().fill(String(row['NIK']));
                await page.waitForTimeout(1000);
                await page.keyboard.press('Enter');

                const namaSiswa = row['Nama Lengkap'];

                sesi = "Pelacakan hadir/sudah hadir";
                await checkPause()
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


                    // 1. Ambil data asli dari Excel, konversi ke string, dan hapus spasi tak berguna
                    let noWa = row['No Whatsapp'] ? String(row['No Whatsapp']).trim() : '';

                    // 2. Bersihkan karakter non-angka (jika ada tanda + atau strip seperti +62 812-345)
                    noWa = noWa.replace(/\D/g, '');

                    // 3. Logika Validasi: Kosong ATAU Kurang dari 7 digit ATAU awalan bukan angka 8
                    if (!noWa || noWa.length < 7 || !noWa.startsWith('8')) {
                        noWa = '89999999'; // Set ke nilai default jika syarat tidak terpenuhi
                    }

                    // 4. Masukkan nomor yang sudah tervalidasi ke dalam input web
                    await page.locator('input[name="Nomor Whatsapp"]').last().fill(noWa);
                    // ==========================================
                    // 5. CHECKBOX ALAMAT SAMA DENGAN KTP
                    // ==========================================
                    try {
                        const checkboxAlamat = page.locator('input[name="sameAddress"]').last();

                        // Cek apakah checkbox sudah dalam kondisi tercentang
                        const sudahTercentang = await checkboxAlamat.isChecked();

                        if (sudahTercentang) {
                            Logger.info(`✅ [Checkbox Alamat] Sudah tercentang dari awal. Skip...`);
                        } else {
                            Logger.info(`🔄 [Checkbox Alamat] Belum tercentang. Mencentang sekarang...`);
                            // Gunakan .check() lebih aman daripada .click() khusus untuk checkbox
                            await checkboxAlamat.check({ force: true, timeout: 2000 });
                        }
                    } catch (e) {
                        Logger.info(`⏩ [Checkbox Alamat] Gagal / Tidak Ditemukan. Lewati...`);
                    }
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
                await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pelayanan-sekolah', { waitUntil: 'networkidle' });

                await page.waitForTimeout(2000); // Tunggu sampai halaman benar-benar dimuat

            } else {
                Logger.info("Sudah berada di halaman Pelayanan otomatis, lanjut pilih sekolah...");
                await page.waitForTimeout(1000);
            }
            const dropdownSekolah = page.locator('div:has(span:text-is("Pilih sekolah"))').last();
            await dropdownSekolah.waitFor({ state: 'visible', timeout: 5000 });
            await dropdownSekolah.last().click({ force: true });

            await page.waitForTimeout(100);

            const namaSekolahExcel = String(row['Nama Sekolah']).trim();
            await page.locator(`div:text-is("${namaSekolahExcel}")`).last().click({ force: true });

            await page.waitForTimeout(100);

            const dropdownKelas = page.locator('div:has(span:text-is("Pilih kelas"))').last();
            await dropdownKelas.waitFor({ state: 'visible', timeout: 5000 });
            await dropdownKelas.click({ force: true });

            await page.waitForTimeout(100);

            const kelasExcel = String(row['Kelas / Jenjang']).trim();
            await page.locator(`div:has-text("${kelasExcel}")`).last().click({ force: true });

            await page.waitForTimeout(500);
            await page.locator('text="Tampilkan Pencarian"').last().click();

            await page.locator('span:has-text("Nomor Tiket"), span:has-text("NIK")').last().click();
            await page.locator('div:text-is("NIK")').last().click();

            await page.locator('input[name="NIK"], input#nik').last().fill(String(row['NIK']));
            await page.keyboard.press('Enter');

            await page.waitForTimeout(2000);


            Logger.info("Memeriksa tab status pemeriksaan (Belum/Sedang/Selesai)...");
            console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|memeriksa status pemeriksaan/pelayanan`);

            const tabBelum = page.locator('div.cursor-pointer:has-text("Belum Pemeriksaan")').last();
            const tabSedang = page.locator('div.cursor-pointer:has-text("Sedang Pemeriksaan")').last();
            const tabSelesai = page.locator('div.cursor-pointer:has-text("Selesai Pemeriksaan")').last();

            let statusTabel = "KOSONG";

            // --- SUNTIKAN MATA PENEMBAK JITU ---
            async function cekDanGeserTabel() {
                const targetSiswa = String(row['Nama Lengkap']).trim();

                // 1. KUNCI BARIS: Cari baris tabel (tr) yang BENAR-BENAR memuat Nama Siswa target
                const barisTarget = page.locator('tbody tr', { hasText: targetSiswa }).first();

                try {
                    await barisTarget.waitFor({ state: 'visible', timeout: 3000 });
                } catch (e) {
                    return "KOSONG"; // Kalau nama siswa tidak ada di tab ini
                }

                // 2. GESER SCROLLBAR
                await page.evaluate(() => {
                    const elemenScroll = document.querySelectorAll('div, table, tbody');
                    elemenScroll.forEach(el => {
                        if (el.scrollWidth > el.clientWidth) el.scrollLeft = el.scrollWidth;
                    });
                });
                await page.waitForTimeout(500);

                // 3. BACA STATUS HANYA DARI BARIS SISWA TERSEBUT
                const teksBaris = await barisTarget.innerText();

                if (teksBaris.includes("Belum lengkap") || teksBaris.includes("Belum Pemeriksaan") || teksBaris.includes("Sedang Pemeriksaan")) {
                    return "BELUM_LENGKAP";
                }
                if (teksBaris.includes("Lengkap") && teksBaris.includes("Selesai Pemeriksaan")) {
                    return "SUDAH_LENGKAP";
                }
                return "KOSONG";
            }

            await tabBelum.click({ force: true });
            statusTabel = await cekDanGeserTabel();

            if (statusTabel === "KOSONG") {
                await tabSedang.click({ force: true });
                statusTabel = await cekDanGeserTabel();
            }

            if (statusTabel === "KOSONG") {
                await tabSelesai.click({ force: true });
                statusTabel = await cekDanGeserTabel();
            }

            if (statusTabel === "SUDAH_LENGKAP") {
                row.Keterangan = "terdeteksi sudah pelayanan lengkap";
                Logger.info(`Data NIK ${row['NIK']} sudah lengkap/selesai pelayanan. Lanjut ke siswa berikutnya.`);
                console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|terdeteksi sudah lengkap`);
                console.log(`SUKSES | Data NIK ${nikPeserta} atas nama ${namaLengkap} tersimpan!`);
                continue;
            }
            else if (statusTabel === "KOSONG") {
                row.Keterangan = "Gagal: Data tidak muncul di ketiga tab";
                Logger.info(`Tabel kosong untuk NIK ${row['NIK']}. Skip.`);
                console.log(`GAGAL | NIK ${nikPeserta} Tidak muncul di pelayanan, kemungkinan faskes luar`);
                continue;
            }

            // 🌟 MENGKLIK TOMBOL MULAI KHUSUS UNTUK SISWA TERSEBUT
            const barisTarget = page.locator('tbody tr', { hasText: String(row['Nama Lengkap']).trim() }).first();
            const tombolMulaiTabel = barisTarget.locator('button:has-text("Mulai")');

            if (await tombolMulaiTabel.isVisible()) {
                await tombolMulaiTabel.scrollIntoViewIfNeeded();
                await tombolMulaiTabel.click({ force: true });
            } else {
                row.Keterangan = "Gagal: Tombol Mulai tidak bisa ditemukan di baris anak ini";
                console.log(`GAGAL | NIK ${nikPeserta} Tombol Mulai tidak ditemukan pada baris Nama target`);
                continue;
            }


            Logger.info("Menunggu halaman form klinis dimuat...");
            await page.waitForTimeout(3000);

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
            // ============================================
            // 6. FASE PEMERIKSAAN MANDIRI 
            // ============================================
            Logger.info("Mengecek status Pemeriksaan Mandiri...");
            let adaMandiri = true;

            // 🌟 PROTEKSI MODAL MACET (Dari ckgumum.js)
            const modalMasihBuka = page.locator('.sd-root-modern, .modal-dialog, form').filter({ visible: true });
            if (await modalMasihBuka.count() > 0 && await page.locator('tr:has-text("Input Data")').count() === 0) {
                Logger.info(`⚠️ Form macet tidak tertutup! Memaksa tutup...`);
                const btnBatal = page.locator('button:has-text("Batal"), button:has-text("Kembali"), .close').filter({ visible: true });

                if (await btnBatal.count() > 0) {
                    await btnBatal.first().click({ force: true }).catch(() => { });
                } else {
                    await page.keyboard.press('Escape'); // Jurus pamungkas nutup modal
                }
                await page.waitForTimeout(1000);
            }

            while (adaMandiri) {
                const barisMandiri = page.locator('tr:has(img[src*="icon-success-gray.svg"]):has(button:has-text("Input Data"))').first();

                if (await barisMandiri.isVisible()) {
                    const namaPemeriksaan = await barisMandiri.locator('td').first().textContent();
                    Logger.info(`Mengisi Mandiri: ${namaPemeriksaan.trim()}`);

                    await barisMandiri.locator('button:has-text("Input Data")').click();
                    await page.waitForTimeout(1500);

                    let indexSoal = 0;
                    let cekTerus = true;

                    while (cekTerus) {
                        const radioContainers = page.locator('label, div.sd-item').filter({
                            has: page.locator('span.sv-string-viewer:has-text("Tidak")')
                                .or(page.locator('span.sv-string-viewer:has-text("Belum")'))
                        });
                        const jumlahSoal = await radioContainers.count();

                        if (indexSoal < jumlahSoal) {
                            const soalSaatIni = radioContainers.nth(indexSoal);

                            await soalSaatIni.scrollIntoViewIfNeeded();
                            await page.waitForTimeout(100);

                            const lingkaranRadio = soalSaatIni.locator('.sd-item__decorator, .sd-radio__decorator').first();
                            await lingkaranRadio.click({ force: true });

                            await page.waitForTimeout(100);
                            indexSoal++;
                        } else {
                            cekTerus = false;
                        }
                    }

                    const jawabanExcel = row[namaPemeriksaan.trim()];
                    if (jawabanExcel) {
                        const dropdown = page.locator('.sd-dropdown').first();
                        if (await dropdown.isVisible()) {
                            await dropdown.click();
                            await page.waitForTimeout(500);
                            await page.locator(`.sv-list__item:has-text("${jawabanExcel}")`).click();
                            await page.waitForTimeout(500);
                        }
                    }

                    const inputAngka = page.locator('input[type="number"]');
                    const jumlahInput = await inputAngka.count();
                    Logger.info(`Ditemukan ${jumlahInput} kotak input angka.`);

                    for (let j = 0; j < jumlahInput; j++) {
                        const kotak = inputAngka.nth(j);
                        const labelPlaceholder = (await kotak.getAttribute('placeholder') || "").trim();

                        Logger.info(`Mengecek kotak ke-${j + 1}, Placeholder: "${labelPlaceholder}"`);
                        const nilaiExcel = row[labelPlaceholder];

                        if (nilaiExcel !== undefined && nilaiExcel !== null && nilaiExcel !== "") {
                            await kotak.scrollIntoViewIfNeeded();
                            await kotak.fill(String(nilaiExcel));
                            Logger.info(`Berhasil mengisi: ${nilaiExcel} ke dalam "${labelPlaceholder}"`);
                            await page.waitForTimeout(300);
                        } else {
                            Logger.info(`Data tidak ditemukan di Excel untuk placeholder: "${labelPlaceholder}"`);
                        }
                    }

                    const btnKirimMandiri = page.locator('input[title="Kirim"]').last();

                    // 🌟 FITUR 1: MENGGUNAKAN KLIK ANTI-MACET
                    await klikAntiMacet(page, btnKirimMandiri, `Kirim Mandiri ${namaPemeriksaan.trim()}`);
                    await page.waitForTimeout(2500);

                } else {
                    adaMandiri = false;
                    Logger.info("Semua Pemeriksaan Mandiri sudah selesai (Hijau).");
                }
            }

            sesi = "Pemeriksaan oleh nakes";
            await checkPause()
            // --- EKSEKUSI FORM PELAYANAN OLEH NAKES ---
            await isiFormLayanan(page, "Gizi Anak", async () => {
                const bb = hitungNilaiNormal(row['Berat Badan'], "Berat Badan", row['Tanggal lahir']);
                const tb = hitungNilaiNormal(row['Tinggi Badan'], "Tinggi Badan", row['Tanggal lahir']);
                await page.locator('input[placeholder*="dalam kg"]').last().fill(bb);
                await page.locator('input[placeholder*="dalam cm"]').last().fill(tb);
            });

            await isiFormLayanan(page, "Tekanan Darah Anak dan Remaja", async () => {
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

            await isiFormLayanan(page, "Anemia", async () => {
                const hb = hitungNilaiNormal(row['Hemoglobin'], "Hemoglobin", row['Tanggal lahir']);
                await page.locator('input.sd-input.sd-text[type="number"]').last().fill(hb);
            });

            await isiFormLayanan(page, "Pemeriksaan Penyakit Frambusia", async () => {
                await page.locator('span.sv-string-viewer:has-text("Tidak")').last().click();
            });

            await isiFormLayanan(page, "Pemeriksaan Penyakit Kusta", async () => {
                await page.locator('input[placeholder="Select..."]').last().click({ force: true });
                await page.locator('span.sv-string-viewer:has-text("Tidak Ada")').last().click();
            });

            await isiFormLayanan(page, "Pemeriksaan Penyakit Skabies", async () => {
                await page.locator('input[placeholder="Select..."]').last().click({ force: true });
                await page.locator('span.sv-string-viewer:has-text("Tidak Ada")').last().click();
            });

            await isiFormLayanan(page, "Pemeriksaan Gigi - Anak", async () => {
                // 1. Ambil data asli
                let gigi = hitungNilaiNormal(row['Gigi'], "Gigi", row['Tanggal lahir']);

                // 2. Apapun tipe datanya di Excel (Text/Number), kita ubah jadi teks & hapus spasi nyasar
                const teksGigi = String(gigi).trim();

                // 3. Ekstrak angka dari teks tersebut
                const angkaGigi = parseInt(teksGigi);

                // 4. Jika sukses jadi angka DAN lebih dari 3
                if (!isNaN(angkaGigi) && angkaGigi > 3) {
                    gigi = ">3"; // Ubah menjadi format yang dibaca oleh website (Pastikan teks ">3" ini sama persis dengan di web)
                }

                // 5. Eksekusi klik di layar
                const locatorGigi = page.locator(`span.sv-string-viewer:has-text("${gigi}")`).last();
                await locatorGigi.click({ force: true });
            });

            await isiFormLayanan(page, "Skrining Telinga dan Mata", async () => {
                const status = hitungNilaiNormal(row['telinga dan mata'], "Telinga dan Mata", row['Tanggal lahir']);
                if (status.toLowerCase() === "normal") {
                    const opsiNormal = ["Normal", "Tidak ada serumen impaksi", "Tidak ada infeksi", "Tidak"];
                    for (const opsi of opsiNormal) {
                        const radios = page.locator(`span.sv-string-viewer:has-text("${opsi}")`);
                        const count = await radios.count();
                        for (let j = 0; j < count; j++) await radios.nth(j).click();
                    }
                }
            });

            await isiFormLayanan(page, "Hasil Pemeriksaan Kebugaran Jasmani", async () => {
                const kebugaran = hitungNilaiNormal(row['Kebugaran'], "Kebugaran", row['Tanggal lahir']);
                await page.locator('input[placeholder*="Pilih tingkat kebugaran berdasarkan hasil tes"]').last().click({ force: true });
                await page.locator(`span.sv-string-viewer:has-text("${kebugaran}")`).last().click();
            });

            await isiFormLayanan(page, "Pemeriksaan RDT Malaria", async () => {
                await page.locator('span.sv-string-viewer:has-text("Non-reaktif")').last().click();
            });

            await isiFormLayanan(page, "Pemeriksaan Hepatitis", async () => {
                await page.locator('span.sv-string-viewer:has-text("Non reaktif")').last().click();
            });

            await isiFormLayanan(page, "Pemeriksaan Kadar CO", async () => {
                const co = hitungNilaiNormal(row['Kadar CO'], "Kadar CO", row['Tanggal lahir']);
                const inputCO = page.locator('input[placeholder*="kadar CO pernapasan"]');
                if (await inputCO.isVisible()) await inputCO.last().fill(co);
            });

            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForTimeout(1000);

            const btnSelesaiLayanan = page.getByRole('button', { name: /Selesaikan Layanan/i }).first();

            if (await btnSelesaiLayanan.isVisible()) {
                Logger.info("Mengklik tombol Selesaikan Layanan...");

                // 🌟 FITUR 1: MENGGUNAKAN KLIK ANTI-MACET
                await klikAntiMacet(page, btnSelesaiLayanan, "Selesaikan Layanan");

                const notifSelesai = await Promise.race([
                    page.getByRole('button', { name: /Konfirmasi/i }).waitFor({ state: 'visible', timeout: 3000 }).then(() => 'ADA_KONFIRMASI'),
                    page.waitForTimeout(3000).then(() => 'TIDAK_ADA_KONFIRMASI')
                ]);

                if (notifSelesai === 'ADA_KONFIRMASI') {
                    await page.getByRole('button', { name: /Konfirmasi/i }).click();
                    Logger.info("Pop-up konfirmasi berhasil disetujui.");
                    await page.waitForTimeout(1500);
                }

            } else {
                Logger.info("Tombol Selesaikan Layanan tidak ditemukan (Mungkin sudah berstatus Selesai).");
            }

            // 🌟 SETELAH SELESAI, BERSIHKAN STATUS PERCOBAAN
            row.jumlahCoba = undefined;
            row.Keterangan = "Berhasil Selesai Pelayanan";
            Logger.info(`Tuntas untuk NIK ${row['NIK']}`);
            console.log(`SUKSES | Data NIK ${nikPeserta} atas nama ${namaLengkap} tersimpan!`);
            console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Berhasil Selesai Pelayanan`);

        } catch (error) {
            // Ekstrak pesan error dengan aman
            let pesanError = (error && typeof error === 'object' && 'message' in error)
                ? String(error.message)
                : String(error || '');
            pesanError = pesanError || "Unknown Error";

            let pesanErrorForm1 = pesanError.split('\n')[0];
            const isTimeout = pesanError.toLowerCase().includes("timeout");

            if (isTimeout && row.jumlahCoba < 3) {
                Logger.info(`⚠️ Terdeteksi Timeout lambat pada NIK ${row['NIK']}. Akan diulang...`);
                row.jumlahCoba += 1;
                i--;

                Logger.info("Mencoba me-reload halaman...");
                console.log(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Reload Halaman`);
                await page.reload({ waitUntil: 'networkidle' }).catch(() => { });
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

                Logger.info("🔄 Error fatal / macet total. Me-reset browser kembali ke halaman awal...");
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